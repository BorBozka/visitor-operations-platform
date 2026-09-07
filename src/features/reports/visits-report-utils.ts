import { differenceInCalendarDays, differenceInMinutes, eachDayOfInterval, parse } from "date-fns"

import type { Visit, VisitStatus } from "@/domain/visits"
import { filterVisits, type AllVisitsFilters } from "@/features/manager/all-visits-utils"
import type { ReportsScopeFilters } from "@/features/reports/reports-filters"
import { formatTr, getIstanbulHour } from "@/lib/date"
import { getPageCount as getPageCountShared, paginate } from "@/lib/pagination"
import { sortReportRecords, matchesReportSearch } from "@/features/reports/report-records-utils"
import type { SingleSortState } from "@/lib/sort"

export const VISITS_REPORT_PAGE_SIZE = 8
export type VisitsReportSortField = "date" | "visitor" | "company" | "host" | "planned" | "duration" | "status"
export const visitsReportRecordsStatusFilters = ["all", "planned", "completed", "no-show", "cancelled", "late-arrival", "late-departure"] as const
export type VisitsReportRecordsStatusFilter = (typeof visitsReportRecordsStatusFilters)[number]

const VISITS_STATUS_SORT_ORDER: Record<VisitStatus, number> = { PLANNED: 0, CHECKED_IN: 1, CHECKED_OUT: 2, NO_SHOW: 3, CANCELLED: 4 }

function toFullFilters(filters: ReportsScopeFilters): AllVisitsFilters {
  return {
    search: "",
    startDate: filters.startDate,
    endDate: filters.endDate,
    companyId: filters.companyId,
    facilityId: filters.facilityId,
    status: "all",
    visitTypeId: "all",
    hostEmployeeId: "all",
    additionalRequirement: "all",
  }
}

// Unlike Manager All Visits, reports must stay complete for audit purposes: NOT_SENT
// invitations are not excluded here, so this deliberately reuses filterVisits (the shared
// core) rather than filterAndSortVisits (which applies the All Visits operational exclusion).
export function filterVisitsForReport(visits: Visit[], filters: ReportsScopeFilters): Visit[] {
  const filtered = filterVisits(visits, toFullFilters(filters))
  return [...filtered].sort((left, right) => new Date(right.plannedStart).getTime() - new Date(left.plannedStart).getTime())
}

export function searchVisitsReportRecords(visits: Visit[], search: string) {
  return visits.filter((visit) => matchesReportSearch(search, [
    `${visit.visitor.firstName} ${visit.visitor.lastName}`,
    visit.visitor.company,
    visit.hostEmployeeName,
  ]))
}

export function sortVisitsReportRecords(visits: Visit[], sort: SingleSortState<VisitsReportSortField>) {
  return sortReportRecords(visits, sort, (visit, field) => {
    if (field === "date" || field === "planned") return new Date(visit.plannedStart).getTime()
    if (field === "visitor") return `${visit.visitor.firstName} ${visit.visitor.lastName}`
    if (field === "company") return visit.visitor.company
    if (field === "host") return visit.hostEmployeeName
    if (field === "duration") return getVisitDurationMinutes(visit)
    return VISITS_STATUS_SORT_ORDER[visit.status]
  })
}

export function getVisitDelayMinutes(visit: Visit): number | null {
  if (!visit.actualCheckIn) return null
  return Math.max(0, differenceInMinutes(new Date(visit.actualCheckIn), new Date(visit.plannedStart)))
}

export function filterVisitsReportRecordsByStatus(visits: Visit[], status: VisitsReportRecordsStatusFilter): Visit[] {
  if (status === "all") return visits
  if (status === "planned") return visits.filter((visit) => visit.status === "PLANNED")
  if (status === "completed") return visits.filter((visit) => Boolean(visit.actualCheckIn))
  if (status === "no-show") return visits.filter((visit) => visit.status === "NO_SHOW")
  if (status === "cancelled") return visits.filter((visit) => visit.status === "CANCELLED")
  if (status === "late-arrival") return visits.filter((visit) => getVisitDelayMinutes(visit) !== null && getVisitDelayMinutes(visit)! > 0)
  return visits.filter((visit) => getVisitLateDepartureMinutes(visit) !== null && getVisitLateDepartureMinutes(visit)! > 0)
}

export function getVisitLateDepartureMinutes(visit: Visit): number | null {
  if (!visit.actualCheckOut) return null
  return Math.max(0, differenceInMinutes(new Date(visit.actualCheckOut), new Date(visit.plannedEnd)))
}

export function getVisitDurationMinutes(visit: Visit): number | null {
  if (!visit.actualCheckIn || !visit.actualCheckOut) return null
  return differenceInMinutes(new Date(visit.actualCheckOut), new Date(visit.actualCheckIn))
}

export interface VisitsReportKpis {
  total: number
  completed: number
  actuallyCheckedIn: number
  averageDurationMinutes: number | null
  lateArrivals: number
  lateDepartures: number
}

export function calculateVisitsReportKpis(visits: Visit[]): VisitsReportKpis {
  const total = visits.length
  const completed = visits.filter((visit) => visit.status === "CHECKED_OUT").length
  const actuallyCheckedIn = visits.filter((visit) => visit.actualCheckIn).length
  const lateArrivals = visits.filter((visit) => getVisitDelayMinutes(visit) !== null && getVisitDelayMinutes(visit)! > 0).length
  const lateDepartures = visits.filter((visit) => getVisitLateDepartureMinutes(visit) !== null && getVisitLateDepartureMinutes(visit)! > 0).length

  const durations = visits
    .map((visit) => getVisitDurationMinutes(visit))
    .filter((duration): duration is number => duration !== null)
  const averageDurationMinutes = durations.length === 0
    ? null
    : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)

  return { total, completed, actuallyCheckedIn, averageDurationMinutes, lateArrivals, lateDepartures }
}

export function paginateReportVisits(visits: Visit[], page: number, pageSize = VISITS_REPORT_PAGE_SIZE) {
  return paginate(visits, page, pageSize)
}

export function getReportPageCount(total: number, pageSize = VISITS_REPORT_PAGE_SIZE) {
  return getPageCountShared(total, pageSize)
}

export function getReportPageRange(total: number, page: number, pageSize = VISITS_REPORT_PAGE_SIZE) {
  if (total === 0) return { start: 0, end: 0 }
  return {
    start: (page - 1) * pageSize + 1,
    end: Math.min(page * pageSize, total),
  }
}

export function getVisibleReportPageNumbers(page: number, pageCount: number) {
  const start = Math.max(1, Math.min(page - 1, pageCount - 2))
  return Array.from({ length: Math.min(3, pageCount) }, (_, index) => start + index)
}

export interface VisitsReportDailyTrendPoint {
  date: string
  label: string
  count: number
}

export interface VisitsReportDailyTrendWithStatusPoint {
  date: string
  label: string
  periodDayCount?: number
  PLANNED: number
  CHECKED_IN: number
  CHECKED_OUT: number
  NO_SHOW: number
  CANCELLED: number
}

export type VisitsReportTrendGranularity = "hourly" | "daily" | "weekly"

function toLocalDate(value: string) {
  return parse(value, "yyyy-MM-dd", new Date())
}

// Fills every day in the filter range with visitors when the range is bounded on both ends;
// falls back to only the days that actually have visits when either bound is left open, since
// an unbounded range has no natural day count to fill zeros for.
export function calculateVisitsReportDailyTrend(visits: Visit[], filters: ReportsScopeFilters): VisitsReportDailyTrendPoint[] {
  const countsByDay = new Map<string, number>()
  for (const visit of visits) {
    const day = formatTr(new Date(visit.plannedStart), "yyyy-MM-dd")
    countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1)
  }

  if (filters.startDate && filters.endDate) {
    return eachDayOfInterval({ start: toLocalDate(filters.startDate), end: toLocalDate(filters.endDate) }).map((day) => {
      const key = formatTr(day, "yyyy-MM-dd")
      return { date: key, label: formatTr(day, "d MMM"), count: countsByDay.get(key) ?? 0 }
    })
  }

  return [...countsByDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, label: formatTr(new Date(`${date}T12:00:00`), "d MMM"), count }))
}

export function calculateVisitsReportDailyTrendWithStatus(visits: Visit[], filters: ReportsScopeFilters): VisitsReportDailyTrendWithStatusPoint[] {
  const countsByDayAndStatus = new Map<string, Record<VisitStatus, number>>()

  for (const visit of visits) {
    const day = formatTr(new Date(visit.plannedStart), "yyyy-MM-dd")
    if (!countsByDayAndStatus.has(day)) {
      countsByDayAndStatus.set(day, {
        PLANNED: 0,
        CHECKED_IN: 0,
        CHECKED_OUT: 0,
        NO_SHOW: 0,
        CANCELLED: 0,
      })
    }
    const dayStatus = countsByDayAndStatus.get(day)!
    dayStatus[visit.status]++
  }

  if (filters.startDate && filters.endDate) {
    return eachDayOfInterval({ start: toLocalDate(filters.startDate), end: toLocalDate(filters.endDate) }).map((day) => {
      const key = formatTr(day, "yyyy-MM-dd")
      const status = countsByDayAndStatus.get(key) ?? {
        PLANNED: 0,
        CHECKED_IN: 0,
        CHECKED_OUT: 0,
        NO_SHOW: 0,
        CANCELLED: 0,
      }
      return { date: key, label: formatTr(day, "d MMM"), ...status }
    })
  }

  return [...countsByDayAndStatus.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, status]) => ({
      date,
      label: formatTr(new Date(`${date}T12:00:00`), "d MMM"),
      ...status,
    }))
}

export interface VisitsReportDailyTrendGroupedPoint {
  date: string
  label: string
  periodDayCount?: number
  PLANNED: number
  COMPLETED: number
  NO_SHOW: number
  CANCELLED: number
}

export type VisitsReportStatusGroup = "PLANNED" | "COMPLETED" | "NO_SHOW" | "CANCELLED"

// Reporting groups CHECKED_IN and CHECKED_OUT into a single "Gerçekleşti" outcome across the
// chart, the records table and the summary text; VisitRecord.status itself keeps the finer
// distinction for operational screens (VisitStatusBadge), this only affects report presentation.
const REPORT_STATUS_GROUP: Record<VisitStatus, VisitsReportStatusGroup> = {
  PLANNED: "PLANNED",
  CHECKED_IN: "COMPLETED",
  CHECKED_OUT: "COMPLETED",
  NO_SHOW: "NO_SHOW",
  CANCELLED: "CANCELLED",
}

export function getVisitReportStatusGroup(status: VisitStatus): VisitsReportStatusGroup {
  return REPORT_STATUS_GROUP[status]
}

// Single source of truth for report status color/label so the trend chart legend and the
// records table status pill always read as the same four outcomes.
export const VISITS_REPORT_STATUS_LABELS: Record<VisitsReportStatusGroup, string> = {
  PLANNED: "Planlandı",
  COMPLETED: "Gerçekleşti",
  NO_SHOW: "Gerçekleşmedi",
  CANCELLED: "İptal",
}

export const VISITS_REPORT_STATUS_COLORS: Record<VisitsReportStatusGroup, string> = {
  PLANNED: "#94a3b8",
  COMPLETED: "#10b981",
  NO_SHOW: "#ef4444",
  CANCELLED: "#8b5cf6",
}

// Reporting groups CHECKED_IN and CHECKED_OUT into a single "Gerçekleşti" outcome so the chart
// reads as planned vs. completed vs. no-show vs. cancelled; VisitRecord.status itself keeps the
// finer distinction for operational screens, this only affects the report presentation.
export function groupVisitsReportDailyTrendByOutcome(points: VisitsReportDailyTrendWithStatusPoint[]): VisitsReportDailyTrendGroupedPoint[] {
  return points.map(({ date, label, periodDayCount, PLANNED, CHECKED_IN, CHECKED_OUT, NO_SHOW, CANCELLED }) => ({
    date,
    label,
    ...(periodDayCount ? { periodDayCount } : {}),
    PLANNED,
    COMPLETED: CHECKED_IN + CHECKED_OUT,
    NO_SHOW,
    CANCELLED,
  }))
}

// Shared Y-axis ceiling for the "selected period" and "previous period" trend charts, so a
// comparison reads honestly instead of each chart auto-scaling to its own data (which would
// make a smaller previous period look deceptively similar in bar height). Rounded up to the
// next multiple of 5 for a little headroom above the tallest stacked bar.
export function calculateSharedTrendYAxisMax(...pointGroups: VisitsReportDailyTrendGroupedPoint[][]): number {
  const rawMax = pointGroups.reduce((max, points) => {
    const groupMax = points.reduce((inner, point) => Math.max(inner, point.PLANNED + point.COMPLETED + point.NO_SHOW + point.CANCELLED), 0)
    return Math.max(max, groupMax)
  }, 0)
  return calculateVisitsTrendYAxis(rawMax).max
}

export interface VisitsTrendYAxis {
  max: number
  ticks: number[]
}

// Prefers even, human-readable grid steps (normally 4–6 ticks) over Recharts' uneven automatic values.
export function calculateVisitsTrendYAxis(rawMax: number): VisitsTrendYAxis {
  const candidates = [5, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100]
  const scale = rawMax > 100 ? Math.pow(10, Math.floor(Math.log10(rawMax)) - 1) : 1
  const max = (candidates.map((candidate) => candidate * scale).find((candidate) => candidate >= rawMax) ?? Math.ceil(rawMax / (100 * scale)) * 100 * scale) || 5
  const intervalCount = max % 5 === 0 ? 5 : 4
  const step = max / intervalCount
  return { max, ticks: Array.from({ length: intervalCount + 1 }, (_, index) => index * step) }
}

export interface VisitsTrendChartPoint extends VisitsReportDailyTrendGroupedPoint {
  TOTAL: number
  TREND: number | null
  ONGOING: number | null
  isToday: boolean
  isOngoing: boolean
}

export interface VisitsTrendSeries {
  points: VisitsTrendChartPoint[]
  completedMax: number
  ongoingIndex: number
}

export interface VisitsTrendAxes {
  total: VisitsTrendYAxis
}

// Headroom above the tallest completed bucket, so the trend line never runs along the top gridline.
const VISITS_TREND_AXIS_HEADROOM = 1.1

// A bucket counts as today when the selected granularity puts today inside it: every hourly
// bucket belongs to today, a daily bucket matches the date outright, and a weekly bucket covers
// today when the offset from its first day is still inside the bucket's own day count.
export function isVisitsTrendTodayPoint(point: VisitsReportDailyTrendGroupedPoint, todayDate: string): boolean {
  if (point.date.startsWith("hour-")) return true
  if (point.date === todayDate) return true

  const weeklyStart = /^week-\d+-(\d{4}-\d{2}-\d{2})$/.exec(point.date)?.[1]
  if (!weeklyStart || !point.periodDayCount) return false
  const offset = differenceInCalendarDays(parse(todayDate, "yyyy-MM-dd", new Date()), parse(weeklyStart, "yyyy-MM-dd", new Date()))
  return offset >= 0 && offset < point.periodDayCount
}

// Only the trailing bucket can still be running, so only it is held out of the axis maths: an
// unfinished day whose count is dominated by PLANNED records must not decide how tall a finished
// day looks. Everything before it is complete and stays part of the scale.
export function buildVisitsTrendSeries(points: VisitsReportDailyTrendGroupedPoint[], todayDate?: string): VisitsTrendSeries {
  const lastIndex = points.length - 1
  const ongoingIndex = todayDate !== undefined && lastIndex >= 0 && isVisitsTrendTodayPoint(points[lastIndex], todayDate) ? lastIndex : -1

  const chartPoints = points.map((point, index): VisitsTrendChartPoint => {
    const total = point.PLANNED + point.COMPLETED + point.NO_SHOW + point.CANCELLED
    const isOngoing = index === ongoingIndex
    return {
      ...point,
      TOTAL: total,
      TREND: isOngoing ? null : total,
      ONGOING: null,
      isToday: todayDate !== undefined && isVisitsTrendTodayPoint(point, todayDate),
      isOngoing,
    }
  })

  // With nothing completed yet there is no undistorted reference to scale against, so the ongoing
  // bucket is allowed to set the ceiling rather than being clamped against an arbitrary floor.
  const scaleSource = chartPoints.some((point) => !point.isOngoing) ? chartPoints.filter((point) => !point.isOngoing) : chartPoints
  return {
    points: chartPoints,
    completedMax: scaleSource.reduce((max, point) => Math.max(max, point.TOTAL), 0),
    ongoingIndex,
  }
}

// One axis for however many series are drawn together: passing both comparison periods here is
// what makes the two stacked charts share a scale, so equal heights mean equal values.
export function calculateVisitsTrendAxes(...series: VisitsTrendSeries[]): VisitsTrendAxes {
  const completedMax = series.reduce((max, item) => Math.max(max, item.completedMax), 0)
  return {
    total: calculateVisitsTrendYAxis(completedMax * VISITS_TREND_AXIS_HEADROOM),
  }
}

// The ongoing bucket is drawn as its own segment starting at the last completed bucket, which is
// why both ends carry a value. Its height is clamped to the ceiling so a day that already runs
// above the completed scale stays visible at the top of the plot instead of being clipped away
// outside the axis; the tooltip keeps reporting the real counts.
export function withVisitsTrendOngoingSegment(series: VisitsTrendSeries, axisMax: number): VisitsTrendChartPoint[] {
  if (series.ongoingIndex < 0) return series.points
  return series.points.map((point, index) => index === series.ongoingIndex || index === series.ongoingIndex - 1
    ? { ...point, ONGOING: Math.min(point.TOTAL, axisMax) }
    : point)
}

export interface VisitsTrendBarSizing {
  maxBarSize: number
  barCategoryGap: string
}

// One density rule is shared by hourly, daily and weekly modes; one bucket remains compact.
export function getVisitsTrendBarSizing(pointCount: number): VisitsTrendBarSizing {
  if (pointCount <= 1) return { maxBarSize: 24, barCategoryGap: "80%" }
  if (pointCount <= 7) return { maxBarSize: 28, barCategoryGap: "38%" }
  if (pointCount <= 14) return { maxBarSize: 22, barCategoryGap: "26%" }
  if (pointCount <= 31) return { maxBarSize: 16, barCategoryGap: "18%" }
  return { maxBarSize: 12, barCategoryGap: "12%" }
}

export interface VisitsReportDelta {
  difference: number
  label: string
}

export type VisitsMetricFavorableDirection = "increase" | "decrease"
export type VisitsMetricDeltaTone = "positive" | "negative" | "neutral"

// Comparison metadata is deliberately absolute and neutral; it does not imply good/bad
// direction and does not duplicate the same change as a percentage.
export function formatVisitsReportDelta(current: number, previous: number): VisitsReportDelta {
  const difference = current - previous
  const absolute = difference > 0 ? `+${difference}` : difference < 0 ? `−${Math.abs(difference)}` : "0"
  return { difference, label: absolute }
}

export function getVisitsMetricDeltaTone(difference: number, favorableDirection: VisitsMetricFavorableDirection): VisitsMetricDeltaTone {
  if (difference === 0) return "neutral"
  const isPositive = favorableDirection === "increase" ? difference > 0 : difference < 0
  return isPositive ? "positive" : "negative"
}

function emptyStatusCounts(): Record<VisitStatus, number> {
  return { PLANNED: 0, CHECKED_IN: 0, CHECKED_OUT: 0, NO_SHOW: 0, CANCELLED: 0 }
}

// Today follows the report's planned-time semantics and the Dashboard's Istanbul wall-clock
// bucketing, while only retaining the operational span that actually contains visits.
export function calculateVisitsReportHourlyTrendWithStatus(visits: Visit[]): VisitsReportDailyTrendWithStatusPoint[] {
  const countsByHour = new Map<number, Record<VisitStatus, number>>()
  for (const visit of visits) {
    const hour = getIstanbulHour(visit.plannedStart)
    if (hour === null) continue
    const status = countsByHour.get(hour) ?? emptyStatusCounts()
    status[visit.status]++
    countsByHour.set(hour, status)
  }

  const hours = [...countsByHour.keys()].sort((left, right) => left - right)
  if (hours.length === 0) return []

  const firstHour = hours[0]
  const lastHour = hours[hours.length - 1]
  return Array.from({ length: lastHour - firstHour + 1 }, (_, index) => {
    const hour = firstHour + index
    return {
      date: `hour-${String(hour).padStart(2, "0")}`,
      label: `${String(hour).padStart(2, "0")}:00`,
      ...(countsByHour.get(hour) ?? emptyStatusCounts()),
    }
  })
}

// Groups the already-filtered daily data into consecutive seven-day windows anchored to the
// selected report start. This intentionally does not use calendar weeks: 18–24 August is one
// bucket, and a longer range continues as days 1–7, 8–14, 15–21, and so on.
export function calculateVisitsReportWeeklyTrendWithStatus(visits: Visit[], filters: ReportsScopeFilters): VisitsReportDailyTrendWithStatusPoint[] {
  const dailyPoints = calculateVisitsReportDailyTrendWithStatus(visits, filters)
  if (dailyPoints.length === 0) return []

  const anchor = toLocalDate(filters.startDate || dailyPoints[0].date)
  const weeks = new Map<number, { firstDate: string; lastDate: string; status: Record<VisitStatus, number> }>()
  for (const point of dailyPoints) {
    const day = toLocalDate(point.date)
    const bucketIndex = Math.floor(differenceInCalendarDays(day, anchor) / 7)
    if (bucketIndex < 0) continue
    const week = weeks.get(bucketIndex) ?? { firstDate: point.date, lastDate: point.date, status: emptyStatusCounts() }
    week.lastDate = point.date
    week.status.PLANNED += point.PLANNED
    week.status.CHECKED_IN += point.CHECKED_IN
    week.status.CHECKED_OUT += point.CHECKED_OUT
    week.status.NO_SHOW += point.NO_SHOW
    week.status.CANCELLED += point.CANCELLED
    weeks.set(bucketIndex, week)
  }

  return [...weeks.entries()].map(([bucketIndex, week]) => ({
    date: `week-${bucketIndex + 1}-${week.firstDate}`,
    label: `${formatTr(toLocalDate(week.firstDate), "d MMM")}–${formatTr(toLocalDate(week.lastDate), "d MMM")}`,
    periodDayCount: differenceInCalendarDays(toLocalDate(week.lastDate), toLocalDate(week.firstDate)) + 1,
    ...week.status,
  }))
}

export function getVisitsTrendTooltipPeriodContext(point: VisitsReportDailyTrendGroupedPoint | undefined): string | null {
  if (!point?.periodDayCount || point.periodDayCount >= 7) return null
  return `${point.periodDayCount} günlük dönem`
}

export function calculateVisitsReportTrendWithStatus(visits: Visit[], filters: ReportsScopeFilters, granularity: VisitsReportTrendGranularity): VisitsReportDailyTrendWithStatusPoint[] {
  if (granularity === "hourly") return calculateVisitsReportHourlyTrendWithStatus(visits)
  if (granularity === "weekly") return calculateVisitsReportWeeklyTrendWithStatus(visits, filters)
  return calculateVisitsReportDailyTrendWithStatus(visits, filters)
}
