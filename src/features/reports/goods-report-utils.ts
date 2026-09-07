import { differenceInCalendarDays, eachDayOfInterval, endOfDay, parse, startOfDay } from "date-fns"

import { getGoodsMovementDisplayStatus, type GoodsMovement } from "@/domain/goods-movements"
import type { ReportsScopeFilters } from "@/features/reports/reports-filters"
import { calculateVisitsTrendYAxis } from "@/features/reports/visits-report-utils"
import { formatTr } from "@/lib/date"
import { getPageCount as getPageCountShared, paginate } from "@/lib/pagination"
import { matchesReportSearch, sortReportRecords } from "@/features/reports/report-records-utils"
import type { SingleSortState } from "@/lib/sort"

export const GOODS_REPORT_PAGE_SIZE = 8
export type GoodsReportView = "analysis" | "records"
export type GoodsReportGranularity = "daily" | "weekly"
export type GoodsTrendGranularity = GoodsReportGranularity | "hourly"
export type GoodsReportSortField = "direction" | "scope" | "counterparty" | "planned" | "actual" | "status" | "reference" | "driver"
export const goodsReportRecordsStatusFilters = ["all", "inbound", "outbound", "late"] as const
export type GoodsReportRecordsStatusFilter = (typeof goodsReportRecordsStatusFilters)[number]

export interface GoodsReportWorkspaceState { view: GoodsReportView; page: number; search: string; status: GoodsReportRecordsStatusFilter; sort: SingleSortState<GoodsReportSortField> }
export interface GoodsReportKpis { total: number; inbound: number; outbound: number; lateCount: number }
export interface GoodsMovementTrendPoint { date: string; label: string; periodDayCount?: number; INBOUND: number; OUTBOUND: number }
export interface GoodsMovementTrendChartPoint extends GoodsMovementTrendPoint { TOTAL: number; TREND: number | null; ONGOING: number | null; isToday: boolean; isOngoing: boolean }
export interface GoodsMovementTrendSeries { points: GoodsMovementTrendChartPoint[]; completedMax: number; ongoingIndex: number }
export interface GoodsTrendAxes { total: ReturnType<typeof calculateGoodsTrendYAxis> }

export const GOODS_REPORT_STATUS_LABELS: Record<ReturnType<typeof getGoodsMovementDisplayStatus>, string> = {
  PLANNED: "Planlandı", COMPLETED: "Tamamlandı", CANCELLED: "İptal", LATE: "Gecikti",
}

function toLocalDate(value: string) { return parse(value, "yyyy-MM-dd", new Date()) }
function dateKey(date: Date) { return formatTr(date, "yyyy-MM-dd") }

export function filterGoodsMovementsForReport(movements: GoodsMovement[], filters: ReportsScopeFilters): GoodsMovement[] {
  const rangeStart = filters.startDate ? startOfDay(toLocalDate(filters.startDate)) : null
  const rangeEnd = filters.endDate ? endOfDay(toLocalDate(filters.endDate)) : null
  const filtered = movements.filter((movement) => {
    const planned = new Date(`${movement.plannedDate}T12:00:00`)
    return (filters.companyId === "all" || movement.companyId === filters.companyId)
      && (filters.facilityId === "all" || movement.facilityId === filters.facilityId)
      && (!rangeStart || planned >= rangeStart) && (!rangeEnd || planned <= rangeEnd)
  })
  return [...filtered].sort((left, right) => `${right.plannedDate}${right.plannedTime ?? ""}`.localeCompare(`${left.plannedDate}${left.plannedTime ?? ""}`))
}

export function searchGoodsReportRecords(movements: GoodsMovement[], search: string) {
  return movements.filter((movement) => matchesReportSearch(search, [movement.counterpartyName, movement.referenceNumber, movement.actualPlate, movement.actualDriverName, movement.companyName, movement.facilityName]))
}

export function filterGoodsReportRecordsByStatus(movements: GoodsMovement[], status: GoodsReportRecordsStatusFilter, now = new Date()): GoodsMovement[] {
  if (status === "all") return movements
  if (status === "inbound") return movements.filter((movement) => movement.direction === "INBOUND")
  if (status === "outbound") return movements.filter((movement) => movement.direction === "OUTBOUND")
  return movements.filter((movement) => getGoodsMovementDisplayStatus(movement, now) === "LATE")
}

export function sortGoodsReportRecords(movements: GoodsMovement[], sort: SingleSortState<GoodsReportSortField>) {
  return sortReportRecords(movements, sort, (movement, field) => {
    if (field === "direction") return movement.direction
    if (field === "scope") return `${movement.companyName} ${movement.facilityName}`
    if (field === "counterparty") return movement.counterpartyName
    if (field === "planned") return new Date(`${movement.plannedDate}T${movement.plannedTime ?? "00:00"}:00`).getTime()
    if (field === "actual") return movement.actualAt ? new Date(movement.actualAt).getTime() : null
    if (field === "status") return { PLANNED: 0, COMPLETED: 1, LATE: 2, CANCELLED: 3 }[getGoodsMovementDisplayStatus(movement)]
    if (field === "reference") return movement.referenceNumber
    const driverLabel = [movement.actualPlate, movement.actualDriverName].filter(Boolean).join(" ")
    return driverLabel || null
  })
}

export function calculateGoodsReportKpis(movements: GoodsMovement[], now = new Date()): GoodsReportKpis {
  const total = movements.length
  const inbound = filterGoodsReportRecordsByStatus(movements, "inbound", now).length
  const lateCount = filterGoodsReportRecordsByStatus(movements, "late", now).length
  return { total, inbound, outbound: total - inbound, lateCount }
}

function emptyPoint(date: string, label: string): GoodsMovementTrendPoint { return { date, label, INBOUND: 0, OUTBOUND: 0 } }

export function calculateGoodsMovementTrend(movements: GoodsMovement[], filters: ReportsScopeFilters, granularity: GoodsTrendGranularity): GoodsMovementTrendPoint[] {
  if (granularity === "hourly") return calculateGoodsMovementHourlyTrend(movements)
  const daily = calculateGoodsMovementDailyTrend(movements, filters)
  return granularity === "weekly" ? calculateGoodsMovementWeeklyTrend(daily, filters) : daily
}

export function calculateGoodsMovementDailyTrend(movements: GoodsMovement[], filters: ReportsScopeFilters): GoodsMovementTrendPoint[] {
  const totals = new Map<string, Pick<GoodsMovementTrendPoint, "INBOUND" | "OUTBOUND">>()
  for (const movement of movements) {
    const current = totals.get(movement.plannedDate) ?? { INBOUND: 0, OUTBOUND: 0 }
    current[movement.direction]++
    totals.set(movement.plannedDate, current)
  }
  if (filters.startDate && filters.endDate) {
    const start = toLocalDate(filters.startDate); const end = toLocalDate(filters.endDate)
    if (start > end) return []
    return eachDayOfInterval({ start, end }).map((day) => {
      const key = dateKey(day)
      return { ...emptyPoint(key, formatTr(day, "d MMM")), ...(totals.get(key) ?? {}) }
    })
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, totalsForDay]) => ({ ...emptyPoint(date, formatTr(toLocalDate(date), "d MMM")), ...totalsForDay }))
}

export function calculateGoodsMovementHourlyTrend(movements: GoodsMovement[]): GoodsMovementTrendPoint[] {
  const totals = new Map<number, Pick<GoodsMovementTrendPoint, "INBOUND" | "OUTBOUND">>()
  const unscheduled = { INBOUND: 0, OUTBOUND: 0 }
  for (const movement of movements) {
    if (!movement.plannedTime) { unscheduled[movement.direction]++; continue }
    const hour = Number(movement.plannedTime.slice(0, 2))
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue
    const current = totals.get(hour) ?? { INBOUND: 0, OUTBOUND: 0 }
    current[movement.direction]++
    totals.set(hour, current)
  }
  const hours = [...totals.keys()].sort((left, right) => left - right)
  if (hours.length === 0 && unscheduled.INBOUND + unscheduled.OUTBOUND === 0) return []
  const scheduled = hours.length === 0 ? [] : Array.from({ length: hours.at(-1)! - hours[0] + 1 }, (_, index) => {
    const hour = hours[0] + index
    return { ...emptyPoint(`hour-${String(hour).padStart(2, "0")}`, `${String(hour).padStart(2, "0")}:00`), ...(totals.get(hour) ?? {}) }
  })
  return unscheduled.INBOUND + unscheduled.OUTBOUND > 0 ? [...scheduled, { ...emptyPoint("hour-unscheduled", "Saat yok"), ...unscheduled }] : scheduled
}

export function calculateGoodsMovementWeeklyTrend(daily: GoodsMovementTrendPoint[], filters: ReportsScopeFilters): GoodsMovementTrendPoint[] {
  if (daily.length === 0) return []
  const anchor = toLocalDate(filters.startDate || daily[0].date)
  const grouped = new Map<number, { first: GoodsMovementTrendPoint; last: GoodsMovementTrendPoint; INBOUND: number; OUTBOUND: number }>()
  for (const point of daily) {
    const index = Math.floor(differenceInCalendarDays(toLocalDate(point.date), anchor) / 7)
    if (index < 0) continue
    const current = grouped.get(index) ?? { first: point, last: point, INBOUND: 0, OUTBOUND: 0 }
    current.last = point; current.INBOUND += point.INBOUND; current.OUTBOUND += point.OUTBOUND
    grouped.set(index, current)
  }
  return [...grouped.entries()].map(([index, bucket]) => ({
    date: `week-${index + 1}-${bucket.first.date}`,
    label: `${formatTr(toLocalDate(bucket.first.date), "d MMM")}–${formatTr(toLocalDate(bucket.last.date), "d MMM")}`,
    periodDayCount: differenceInCalendarDays(toLocalDate(bucket.last.date), toLocalDate(bucket.first.date)) + 1,
    INBOUND: bucket.INBOUND, OUTBOUND: bucket.OUTBOUND,
  }))
}

export function calculateGoodsTrendYAxis(rawMax: number) { return calculateVisitsTrendYAxis(rawMax) }
const GOODS_TREND_AXIS_HEADROOM = 1.1

export function isGoodsMovementTrendTodayPoint(point: GoodsMovementTrendPoint, todayDate: string): boolean {
  if (point.date.startsWith("hour-")) return true
  if (point.date === todayDate) return true

  const weeklyStart = /^week-\d+-(\d{4}-\d{2}-\d{2})$/.exec(point.date)?.[1]
  if (!weeklyStart || !point.periodDayCount) return false
  const offset = differenceInCalendarDays(parse(todayDate, "yyyy-MM-dd", new Date()), parse(weeklyStart, "yyyy-MM-dd", new Date()))
  return offset >= 0 && offset < point.periodDayCount
}

// The unfinished trailing bucket may include a day full of planned movements. Hold it out of the
// ceiling calculation so completed days remain readable, while retaining its real total for the
// dashed continuation and tooltip.
export function buildGoodsMovementTrendSeries(points: GoodsMovementTrendPoint[], todayDate?: string): GoodsMovementTrendSeries {
  const lastIndex = points.length - 1
  const ongoingIndex = todayDate !== undefined && lastIndex >= 0 && isGoodsMovementTrendTodayPoint(points[lastIndex], todayDate) ? lastIndex : -1
  const chartPoints = points.map((point, index): GoodsMovementTrendChartPoint => {
    const total = point.INBOUND + point.OUTBOUND
    const isOngoing = index === ongoingIndex
    return { ...point, TOTAL: total, TREND: isOngoing ? null : total, ONGOING: null, isToday: todayDate !== undefined && isGoodsMovementTrendTodayPoint(point, todayDate), isOngoing }
  })
  const scaleSource = chartPoints.some((point) => !point.isOngoing) ? chartPoints.filter((point) => !point.isOngoing) : chartPoints
  return { points: chartPoints, completedMax: scaleSource.reduce((max, point) => Math.max(max, point.TOTAL), 0), ongoingIndex }
}

export function calculateGoodsTrendAxes(...series: GoodsMovementTrendSeries[]): GoodsTrendAxes {
  const completedMax = series.reduce((max, item) => Math.max(max, item.completedMax), 0)
  return { total: calculateGoodsTrendYAxis(completedMax * GOODS_TREND_AXIS_HEADROOM) }
}

export function calculateSharedGoodsTrendYAxis(current: GoodsMovementTrendPoint[], previous: GoodsMovementTrendPoint[], todayDate?: string) {
  return calculateGoodsTrendAxes(buildGoodsMovementTrendSeries(current, todayDate), buildGoodsMovementTrendSeries(previous))
}

export function withGoodsMovementTrendOngoingSegment(series: GoodsMovementTrendSeries, axisMax: number): GoodsMovementTrendChartPoint[] {
  if (series.ongoingIndex < 0) return series.points
  return series.points.map((point, index) => index === series.ongoingIndex || index === series.ongoingIndex - 1
    ? { ...point, ONGOING: Math.min(point.TOTAL, axisMax) }
    : point)
}

export function formatGoodsReportDelta(current: number, previous: number) {
  const difference = current - previous
  return { difference, label: difference > 0 ? `+${difference}` : difference < 0 ? `−${Math.abs(difference)}` : "değişmedi" }
}

export function isGoodsRecordActivationKey(key: string) { return key === "Enter" || key === " " }

export function parseGoodsReportWorkspace(searchParams: URLSearchParams): GoodsReportWorkspaceState {
  const rawPage = Number(searchParams.get("goodsPage"))
  const rawSort = searchParams.get("goodsSort")
  const rawStatus = searchParams.get("goodsStatus")
  const validSort: GoodsReportSortField | null = ["direction", "scope", "counterparty", "planned", "actual", "status", "reference", "driver"].includes(rawSort ?? "") ? rawSort as GoodsReportSortField : null
  const status: GoodsReportRecordsStatusFilter = goodsReportRecordsStatusFilters.includes(rawStatus as GoodsReportRecordsStatusFilter) ? rawStatus as GoodsReportRecordsStatusFilter : "all"
  return { view: searchParams.get("goodsView") === "records" ? "records" : "analysis", page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1, search: searchParams.get("goodsSearch")?.trim() ?? "", status, sort: validSort ? { field: validSort, direction: searchParams.get("goodsDir") === "desc" ? "desc" : "asc" } : null }
}

export function setGoodsReportWorkspace(current: URLSearchParams, nextState: Partial<Pick<GoodsReportWorkspaceState, "view" | "search" | "status" | "sort">>) {
  const next = new URLSearchParams(current)
  if (nextState.view) { if (nextState.view === "analysis") next.delete("goodsView"); else next.set("goodsView", nextState.view) }
  if (nextState.search !== undefined) { if (nextState.search.trim()) next.set("goodsSearch", nextState.search.trim()); else next.delete("goodsSearch") }
  if (nextState.status !== undefined) { if (nextState.status === "all") next.delete("goodsStatus"); else next.set("goodsStatus", nextState.status) }
  if (nextState.sort !== undefined) { if (nextState.sort) { next.set("goodsSort", nextState.sort.field); next.set("goodsDir", nextState.sort.direction) } else { next.delete("goodsSort"); next.delete("goodsDir") } }
  next.delete("goodsPage")
  return next
}

export function setGoodsReportPage(current: URLSearchParams, page: number) {
  const next = new URLSearchParams(current)
  if (page <= 1) next.delete("goodsPage"); else next.set("goodsPage", String(Math.floor(page)))
  return next
}

export function paginateGoodsReport(movements: GoodsMovement[], page: number, pageSize = GOODS_REPORT_PAGE_SIZE) { return paginate(movements, page, pageSize) }
export function getGoodsReportPageCount(total: number, pageSize = GOODS_REPORT_PAGE_SIZE) { return getPageCountShared(total, pageSize) }
export function getVisibleGoodsReportPageNumbers(page: number, pageCount: number) {
  const start = Math.max(1, Math.min(page - 1, pageCount - 2))
  return Array.from({ length: Math.min(3, pageCount) }, (_, index) => start + index)
}
