import { describe, expect, it } from "vitest"

import type { Visit } from "@/domain/visits"
import type { ReportsScopeFilters } from "@/features/reports/reports-filters"
import {
  calculateSharedTrendYAxisMax,
  calculateVisitsReportDailyTrend,
  calculateVisitsReportHourlyTrendWithStatus,
  calculateVisitsReportKpis,
  calculateVisitsReportTrendWithStatus,
  calculateVisitsReportWeeklyTrendWithStatus,
  buildVisitsTrendSeries,
  calculateVisitsTrendAxes,
  calculateVisitsTrendYAxis,
  formatVisitsReportDelta,
  getVisitsMetricDeltaTone,
  filterVisitsForReport,
  filterVisitsReportRecordsByStatus,
  getReportPageRange,
  getVisitsTrendBarSizing,
  getVisitsTrendTooltipPeriodContext,
  getReportPageCount,
  getVisitDelayMinutes,
  getVisitLateDepartureMinutes,
  getVisitDurationMinutes,
  getVisitReportStatusGroup,
  groupVisitsReportDailyTrendByOutcome,
  paginateReportVisits,
  searchVisitsReportRecords,
  sortVisitsReportRecords,
  withVisitsTrendOngoingSegment,
  VISITS_REPORT_PAGE_SIZE,
  VISITS_REPORT_STATUS_LABELS,
} from "@/features/reports/visits-report-utils"
import { mockVisitReferenceData } from "@/services/mock-visit-data"

const baseFilters: ReportsScopeFilters = { startDate: "", endDate: "", companyId: "all", facilityId: "all" }

const visits = [
  visit("1", "2026-08-10T08:00:00+03:00", { firstName: "Ayşe", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara" }),
  visit("2", "2026-08-11T10:00:00+03:00", { firstName: "Bora", companyId: "bplas", facilityId: "bplas-arge", employeeId: "emre-yilmaz", invitationStatus: "FAILED" }),
  visit("3", "2026-08-12T12:00:00+03:00", { firstName: "Ceren", companyId: "bplas-otomotiv", facilityId: "otomotiv-uretim", employeeId: "selin-aydin", status: "CHECKED_IN" }),
  visit("4", "2026-08-13T09:00:00+03:00", { firstName: "Deniz", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", invitationStatus: "NOT_SENT" }),
]

describe("filterVisitsForReport", () => {
  it("includes NOT_SENT invitations, unlike the All Visits operational list", () => {
    expect(ids(filterVisitsForReport(visits, baseFilters))).toEqual(expect.arrayContaining(["4"]))
    expect(filterVisitsForReport(visits, baseFilters)).toHaveLength(4)
  })

  it("applies the shared date-range and company/facility filters", () => {
    expect(ids(filterVisitsForReport(visits, { ...baseFilters, startDate: "2026-08-11", endDate: "2026-08-12" }))).toEqual(["3", "2"])
    expect(ids(filterVisitsForReport(visits, { ...baseFilters, companyId: "bplas-otomotiv" }))).toEqual(["3"])
    expect(ids(filterVisitsForReport(visits, { ...baseFilters, facilityId: "bplas-arge" }))).toEqual(["2"])
  })

  it("returns an empty set for an inverted date range", () => {
    expect(filterVisitsForReport(visits, { ...baseFilters, startDate: "2026-08-13", endDate: "2026-08-10" })).toEqual([])
  })

  it("sorts by planned start descending, most recent first", () => {
    expect(ids(filterVisitsForReport(visits, baseFilters))).toEqual(["4", "3", "2", "1"])
  })
})

describe("visits records search and sort", () => {
  it("searches visitor, visitor company and host with Turkish case handling", () => {
    expect(ids(searchVisitsReportRecords(visits, "ayşe"))).toEqual(["1"])
    expect(ids(searchVisitsReportRecords(visits, "TEST A.Ş."))).toEqual(["1", "2", "3", "4"])
    expect(ids(searchVisitsReportRecords(visits, "selin"))).toEqual(["3"])
    expect(searchVisitsReportRecords(visits, "")).toHaveLength(4)
  })

  it("sorts representative string, date and status fields", () => {
    expect(ids(sortVisitsReportRecords(visits, { field: "visitor", direction: "desc" }))).toEqual(["4", "3", "2", "1"])
    expect(ids(sortVisitsReportRecords(visits, { field: "date", direction: "desc" }))).toEqual(["4", "3", "2", "1"])
    expect(ids(sortVisitsReportRecords(visits, { field: "status", direction: "asc" }))).toEqual(["1", "2", "4", "3"])
  })
})

describe("getVisitDelayMinutes", () => {
  it("returns null when the visitor never checked in", () => {
    expect(getVisitDelayMinutes(visit("x", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara" }))).toBeNull()
  })

  it("measures minutes late relative to planned start", () => {
    const late = visit("x", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", actualCheckIn: "2026-08-10T08:12:00+03:00" })
    expect(getVisitDelayMinutes(late)).toBe(12)
  })

  it("clamps early arrivals to zero instead of a negative delay", () => {
    const early = visit("x", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", actualCheckIn: "2026-08-10T07:45:00+03:00" })
    expect(getVisitDelayMinutes(early)).toBe(0)
  })
})

describe("filterVisitsReportRecordsByStatus", () => {
  const filteredVisits = [
    visit("late-arrival", "2026-08-10T08:00:00+03:00", { firstName: "Ayşe", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", actualCheckIn: "2026-08-10T08:15:00+03:00" }),
    visit("completed", "2026-08-10T08:00:00+03:00", { firstName: "Bora", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CHECKED_OUT", actualCheckIn: "2026-08-10T08:00:00+03:00" }),
    visit("other-company", "2026-08-10T08:00:00+03:00", { firstName: "Ayşe", companyId: "bplas-otomotiv", facilityId: "otomotiv-uretim", employeeId: "selin-aydin", actualCheckIn: "2026-08-10T08:20:00+03:00" }),
  ]

  it("applies status after the date/company scope and before the records search with AND semantics", () => {
    const scoped = filterVisitsForReport(filteredVisits, { ...baseFilters, companyId: "bplas" })
    const lateArrivals = filterVisitsReportRecordsByStatus(scoped, "late-arrival")
    expect(ids(searchVisitsReportRecords(lateArrivals, "ayşe"))).toEqual(["late-arrival"])
  })

  it("uses the same late-arrival helper outcome as the KPI count", () => {
    const kpis = calculateVisitsReportKpis(filteredVisits)
    expect(filterVisitsReportRecordsByStatus(filteredVisits, "late-arrival")).toHaveLength(kpis.lateArrivals)
  })
})

describe("getVisitLateDepartureMinutes", () => {
  it("excludes visits without a recorded check-out", () => {
    expect(getVisitLateDepartureMinutes(visit("x", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara" }))).toBeNull()
  })

  it("clamps an early check-out to zero and returns positive minutes after the planned end", () => {
    const early = visit("early", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", plannedEnd: "2026-08-10T09:00:00+03:00", actualCheckOut: "2026-08-10T08:45:00+03:00" })
    const late = visit("late", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", plannedEnd: "2026-08-10T09:00:00+03:00", actualCheckOut: "2026-08-10T09:15:00+03:00" })
    expect(getVisitLateDepartureMinutes(early)).toBe(0)
    expect(getVisitLateDepartureMinutes(late)).toBe(15)
  })
})

describe("getVisitDurationMinutes", () => {
  it("returns null when either actual timestamp is missing", () => {
    expect(getVisitDurationMinutes(visit("x", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara" }))).toBeNull()
    expect(getVisitDurationMinutes(visit("x", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", actualCheckIn: "2026-08-10T08:00:00+03:00" }))).toBeNull()
  })

  it("measures minutes between actual check-in and check-out", () => {
    const done = visit("x", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", actualCheckIn: "2026-08-10T08:00:00+03:00", actualCheckOut: "2026-08-10T09:15:00+03:00" })
    expect(getVisitDurationMinutes(done)).toBe(75)
  })
})

describe("getVisitReportStatusGroup", () => {
  it("groups CHECKED_IN and CHECKED_OUT into COMPLETED, and keeps the other statuses as-is", () => {
    expect(getVisitReportStatusGroup("PLANNED")).toBe("PLANNED")
    expect(getVisitReportStatusGroup("CHECKED_IN")).toBe("COMPLETED")
    expect(getVisitReportStatusGroup("CHECKED_OUT")).toBe("COMPLETED")
    expect(getVisitReportStatusGroup("NO_SHOW")).toBe("NO_SHOW")
    expect(getVisitReportStatusGroup("CANCELLED")).toBe("CANCELLED")
  })

  it("presents NO_SHOW as Gerçekleşmedi without changing the domain status", () => {
    expect(VISITS_REPORT_STATUS_LABELS[getVisitReportStatusGroup("NO_SHOW")]).toBe("Gerçekleşmedi")
  })
})

describe("calculateVisitsReportKpis", () => {
  it("computes totals, completion count, actually checked in and average duration", () => {
    const kpiVisits = [
      visit("a", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CHECKED_OUT", actualCheckIn: "2026-08-10T08:00:00+03:00", actualCheckOut: "2026-08-10T09:00:00+03:00" }),
      visit("b", "2026-08-10T08:00:00+03:00", { firstName: "B", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CHECKED_OUT", actualCheckIn: "2026-08-10T08:00:00+03:00", actualCheckOut: "2026-08-10T08:30:00+03:00" }),
      visit("c", "2026-08-10T08:00:00+03:00", { firstName: "C", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "NO_SHOW" }),
      visit("d", "2026-08-10T08:00:00+03:00", { firstName: "D", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CANCELLED" }),
    ]
    const kpis = calculateVisitsReportKpis(kpiVisits)
    expect(kpis.total).toBe(4)
    expect(kpis.completed).toBe(2)
    expect(kpis.actuallyCheckedIn).toBe(2)
    expect(kpis.averageDurationMinutes).toBe(45)
    expect(kpis.lateArrivals).toBe(0)
    expect(kpis.lateDepartures).toBe(2)
  })

  it("reports a null average duration and zero counts when there is no data", () => {
    expect(calculateVisitsReportKpis([])).toEqual({ total: 0, completed: 0, actuallyCheckedIn: 0, averageDurationMinutes: null, lateArrivals: 0, lateDepartures: 0 })
  })

  it("counts lateArrivals only for visits with an actual check-in that is after the planned start", () => {
    const kpiVisits = [
      visit("a", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "PLANNED" }),
      visit("b", "2026-08-10T08:00:00+03:00", { firstName: "B", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CHECKED_IN", actualCheckIn: "2026-08-10T08:15:00+03:00" }),
      visit("c", "2026-08-10T08:00:00+03:00", { firstName: "C", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CHECKED_IN", actualCheckIn: "2026-08-10T07:50:00+03:00" }),
    ]
    expect(calculateVisitsReportKpis(kpiVisits).lateArrivals).toBe(1)
  })

  it("counts late departures only after the planned end and never for open visits", () => {
    const kpiVisits = [
      visit("open", "2026-08-10T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CHECKED_IN" }),
      visit("early", "2026-08-10T08:00:00+03:00", { firstName: "B", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", plannedEnd: "2026-08-10T09:00:00+03:00", status: "CHECKED_OUT", actualCheckOut: "2026-08-10T08:50:00+03:00" }),
      visit("late", "2026-08-10T08:00:00+03:00", { firstName: "C", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", plannedEnd: "2026-08-10T09:00:00+03:00", status: "CHECKED_OUT", actualCheckOut: "2026-08-10T09:10:00+03:00" }),
    ]
    expect(calculateVisitsReportKpis(kpiVisits).lateDepartures).toBe(1)
  })
})

describe("groupVisitsReportDailyTrendByOutcome", () => {
  it("merges CHECKED_IN and CHECKED_OUT into a single COMPLETED count and keeps other statuses as-is", () => {
    const points = [
      { date: "2026-08-10", label: "10 Ağu", PLANNED: 2, CHECKED_IN: 3, CHECKED_OUT: 1, NO_SHOW: 4, CANCELLED: 5 },
    ]
    expect(groupVisitsReportDailyTrendByOutcome(points)).toEqual([
      { date: "2026-08-10", label: "10 Ağu", PLANNED: 2, COMPLETED: 4, NO_SHOW: 4, CANCELLED: 5 },
    ])
  })
})

describe("calculateVisitsReportDailyTrend", () => {
  it("fills every day in a bounded range with zero counts where there is no data", () => {
    const trendVisits = [visit("a", "2026-08-11T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara" })]
    const trend = calculateVisitsReportDailyTrend(trendVisits, { ...baseFilters, startDate: "2026-08-10", endDate: "2026-08-12" })
    expect(trend.map((point) => point.date)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"])
    expect(trend.map((point) => point.count)).toEqual([0, 1, 0])
  })

  it("only returns days that have visits when the range is unbounded", () => {
    const trendVisits = [
      visit("a", "2026-08-11T08:00:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara" }),
      visit("b", "2026-08-13T08:00:00+03:00", { firstName: "B", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara" }),
    ]
    const trend = calculateVisitsReportDailyTrend(trendVisits, baseFilters)
    expect(trend.map((point) => point.date)).toEqual(["2026-08-11", "2026-08-13"])
    expect(trend.map((point) => point.count)).toEqual([1, 1])
  })
})

describe("report pagination", () => {
  it("uses a fixed eight-record page size with stable ranges", () => {
    const records = Array.from({ length: 24 }, (_, index) => ({ id: String(index) }))
    expect(VISITS_REPORT_PAGE_SIZE).toBe(8)
    expect(getReportPageCount(records.length)).toBe(3)
    expect(paginateReportVisits(records as Visit[], 1)).toHaveLength(8)
    expect(paginateReportVisits(records as Visit[], 2)).toHaveLength(8)
    expect(paginateReportVisits(records as Visit[], 3)).toHaveLength(8)
    expect(getReportPageRange(24, 1)).toEqual({ start: 1, end: 8 })
    expect(getReportPageRange(24, 2)).toEqual({ start: 9, end: 16 })
    expect(getReportPageRange(24, 3)).toEqual({ start: 17, end: 24 })
  })
})

describe("calculateSharedTrendYAxisMax", () => {
  it("uses the larger of the two periods' tallest stacked-bar totals, rounded up to a multiple of 5", () => {
    const current = [{ date: "2026-08-10", label: "10 Ağu", PLANNED: 3, COMPLETED: 4, NO_SHOW: 1, CANCELLED: 0 }]
    const previous = [{ date: "2026-07-10", label: "10 Tem", PLANNED: 1, COMPLETED: 1, NO_SHOW: 0, CANCELLED: 0 }]
    // current day total = 8 -> rounds up to 10
    expect(calculateSharedTrendYAxisMax(current, previous)).toBe(10)
  })

  it("picks up the previous period's total when it is the larger one", () => {
    const current = [{ date: "2026-08-10", label: "10 Ağu", PLANNED: 1, COMPLETED: 1, NO_SHOW: 0, CANCELLED: 0 }]
    const previous = [{ date: "2026-07-10", label: "10 Tem", PLANNED: 5, COMPLETED: 5, NO_SHOW: 5, CANCELLED: 0 }]
    // previous day total = 15, already a multiple of 5
    expect(calculateSharedTrendYAxisMax(current, previous)).toBe(15)
  })

  it("returns a small positive default when both periods are entirely empty", () => {
    expect(calculateSharedTrendYAxisMax([], [])).toBe(5)
  })
})

describe("visits trend chart sizing", () => {
  it("returns evenly spaced deterministic Y ticks for a shared comparison axis", () => {
    expect(calculateVisitsTrendYAxis(10)).toEqual({ max: 10, ticks: [0, 2, 4, 6, 8, 10] })
    expect(calculateVisitsTrendYAxis(12)).toEqual({ max: 12, ticks: [0, 3, 6, 9, 12] })
  })

  it("keeps a single-bucket bar compact and applies one sizing strategy across densities", () => {
    expect(getVisitsTrendBarSizing(1)).toEqual({ maxBarSize: 24, barCategoryGap: "80%" })
    expect(getVisitsTrendBarSizing(7)).toEqual({ maxBarSize: 28, barCategoryGap: "38%" })
    expect(getVisitsTrendBarSizing(30).maxBarSize).toBeLessThan(getVisitsTrendBarSizing(7).maxBarSize)
  })
})

describe("formatVisitsReportDelta", () => {
  it("returns only a neutral absolute delta for metadata", () => {
    expect(formatVisitsReportDelta(5, 0)).toEqual({ difference: 5, label: "+5" })
    expect(formatVisitsReportDelta(12, 10)).toEqual({ difference: 2, label: "+2" })
    expect(formatVisitsReportDelta(8, 10)).toEqual({ difference: -2, label: "−2" })
  })
})

describe("getVisitsMetricDeltaTone", () => {
  it("treats increases by metric meaning instead of coloring every increase positively", () => {
    expect(getVisitsMetricDeltaTone(2, "increase")).toBe("positive")
    expect(getVisitsMetricDeltaTone(-2, "increase")).toBe("negative")
    expect(getVisitsMetricDeltaTone(2, "decrease")).toBe("negative")
    expect(getVisitsMetricDeltaTone(-2, "decrease")).toBe("positive")
    expect(getVisitsMetricDeltaTone(0, "decrease")).toBe("neutral")
  })
})

describe("report trend aggregation", () => {
  const trendVisits = [
    visit("morning", "2026-08-10T08:15:00+03:00", { firstName: "A", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara" }),
    visit("late", "2026-08-10T10:45:00+03:00", { firstName: "B", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CHECKED_IN" }),
    visit("week-two", "2026-08-17T09:00:00+03:00", { firstName: "C", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", status: "CANCELLED" }),
  ]

  it("uses planned Istanbul wall-clock hours for today's hourly buckets", () => {
    expect(calculateVisitsReportHourlyTrendWithStatus(trendVisits.slice(0, 2))).toEqual([
      { date: "hour-08", label: "08:00", PLANNED: 1, CHECKED_IN: 0, CHECKED_OUT: 0, NO_SHOW: 0, CANCELLED: 0 },
      { date: "hour-09", label: "09:00", PLANNED: 0, CHECKED_IN: 0, CHECKED_OUT: 0, NO_SHOW: 0, CANCELLED: 0 },
      { date: "hour-10", label: "10:00", PLANNED: 0, CHECKED_IN: 1, CHECKED_OUT: 0, NO_SHOW: 0, CANCELLED: 0 },
    ])
  })

  it("keeps daily aggregation outside the hourly mode", () => {
    const filters = { ...baseFilters, startDate: "2026-08-10", endDate: "2026-08-10" }
    expect(calculateVisitsReportTrendWithStatus(trendVisits, filters, "daily")).toHaveLength(1)
    expect(calculateVisitsReportTrendWithStatus(trendVisits, filters, "daily")[0].label).toBe("10 Ağu")
  })

  it("anchors weekly buckets to the selected start instead of calendar weeks", () => {
    const filters = { ...baseFilters, startDate: "2026-08-18", endDate: "2026-08-24" }
    const weekly = calculateVisitsReportWeeklyTrendWithStatus([], filters)
    expect(weekly).toHaveLength(1)
    expect(weekly[0].label).toBe("18 Ağu–24 Ağu")
    expect(weekly[0].periodDayCount).toBe(7)
  })

  it("splits a 30-day range into consecutive seven-day buckets and one remainder", () => {
    const filters = { ...baseFilters, startDate: "2026-08-01", endDate: "2026-08-30" }
    const weekly = calculateVisitsReportWeeklyTrendWithStatus([], filters)
    expect(weekly.map((point) => point.label)).toEqual([
      "1 Ağu–7 Ağu",
      "8 Ağu–14 Ağu",
      "15 Ağu–21 Ağu",
      "22 Ağu–28 Ağu",
      "29 Ağu–30 Ağu",
    ])
    expect(weekly.map((point) => point.periodDayCount)).toEqual([7, 7, 7, 7, 2])
    const grouped = groupVisitsReportDailyTrendByOutcome(weekly)
    expect(getVisitsTrendTooltipPeriodContext(grouped[3])).toBeNull()
    expect(getVisitsTrendTooltipPeriodContext(grouped[4])).toBe("2 günlük dönem")
  })

  it("uses the same start-anchored strategy for the comparison period", () => {
    const currentFilters = { ...baseFilters, startDate: "2026-08-18", endDate: "2026-08-24" }
    const previousFilters = { ...baseFilters, startDate: "2026-08-11", endDate: "2026-08-17" }
    expect(calculateVisitsReportWeeklyTrendWithStatus([], currentFilters).map((point) => point.label)).toEqual(["18 Ağu–24 Ağu"])
    expect(calculateVisitsReportWeeklyTrendWithStatus([], previousFilters).map((point) => point.label)).toEqual(["11 Ağu–17 Ağu"])
  })

  it("does not include visits outside the selected range", () => {
    const filters = { ...baseFilters, startDate: "2026-08-10", endDate: "2026-08-17" }
    const weekly = calculateVisitsReportWeeklyTrendWithStatus(trendVisits, filters)
    expect(weekly).toMatchObject([
      { label: "10 Ağu–16 Ağu", PLANNED: 1, CHECKED_IN: 1 },
      { label: "17 Ağu–17 Ağu", CANCELLED: 1 },
    ])
  })
})

function ids(records: Visit[]) {
  return records.map((record) => record.id)
}

function visit(id: string, plannedStart: string, overrides: {
  firstName: string
  companyId: string
  facilityId: string
  employeeId: string
  status?: Visit["status"]
  invitationStatus?: Visit["invitationStatus"]
  plannedEnd?: string
  actualCheckIn?: string
  actualCheckOut?: string
}): Visit {
  const company = mockVisitReferenceData.companies.find((item) => item.id === overrides.companyId)!
  const facility = mockVisitReferenceData.facilities.find((item) => item.id === overrides.facilityId)!
  const employee = mockVisitReferenceData.employees.find((item) => item.id === overrides.employeeId)!
  const type = mockVisitReferenceData.visitTypes.find((item) => item.id === "meeting")!
  return {
    id,
    meetingId: `meeting-${id}`,
    creatorEmployeeId: "creator-1",
    visitor: { id: `visitor-${id}`, firstName: overrides.firstName, lastName: "Test", email: `${id}@example.com`, company: "Test A.Ş." },
    visitTypeId: type.id,
    visitTypeName: type.name,
    hostEmployeeId: employee.id,
    hostEmployeeName: employee.name,
    hostCompanyId: company.id,
    hostCompanyName: company.name,
    facilityId: facility.id,
    facilityName: facility.name,
    plannedStart,
    plannedEnd: overrides.plannedEnd ?? plannedStart,
    status: overrides.status ?? "PLANNED",
    invitationStatus: overrides.invitationStatus ?? "SENT",
    hasAdditionalRequirements: false,
    actualCheckIn: overrides.actualCheckIn,
    actualCheckOut: overrides.actualCheckOut,
    createdAt: plannedStart,
    updatedAt: plannedStart,
  }
}
describe("visits trend series and axes", () => {
  const day = (date: string, planned: number, completed: number, noShow = 0, cancelled = 0) => ({
    date,
    label: date,
    PLANNED: planned,
    COMPLETED: completed,
    NO_SHOW: noShow,
    CANCELLED: cancelled,
  })
  // A finished 8, a finished 12 and a still-running today at 33, mostly still PLANNED.
  const runningPeriod = [day("2026-09-05", 0, 8), day("2026-09-06", 1, 11), day("2026-09-07", 30, 3)]

  it("marks only the trailing bucket as ongoing and keeps it out of the completed maximum", () => {
    const series = buildVisitsTrendSeries(runningPeriod, "2026-09-07")
    expect(series.ongoingIndex).toBe(2)
    expect(series.points[2].TOTAL).toBe(33)
    expect(series.completedMax).toBe(12)
    expect(series.points.map((point) => point.TREND)).toEqual([8, 12, null])
    expect(series.points.map((point) => point.isOngoing)).toEqual([false, false, true])
  })

  it("treats every bucket as complete when the range stops before today", () => {
    const series = buildVisitsTrendSeries([day("2026-09-01", 0, 4), day("2026-09-02", 0, 6)], "2026-09-07")
    expect(series.ongoingIndex).toBe(-1)
    expect(series.completedMax).toBe(6)
    expect(series.points.map((point) => point.TREND)).toEqual([4, 6])
  })

  it("falls back to the ongoing bucket when nothing in the range has finished yet", () => {
    const series = buildVisitsTrendSeries([day("2026-09-07", 20, 1)], "2026-09-07")
    expect(series.ongoingIndex).toBe(0)
    expect(series.completedMax).toBe(21)
  })

  it("keeps the today tooltip note on every bucket of an hourly range but runs only the last one", () => {
    const hourly = [{ ...day("hour-09", 0, 4), label: "09:00" }, { ...day("hour-10", 2, 1), label: "10:00" }]
    const series = buildVisitsTrendSeries(hourly, "2026-09-07")
    expect(series.points.map((point) => point.isToday)).toEqual([true, true])
    expect(series.ongoingIndex).toBe(1)
  })

  it("derives the ceiling from the completed buckets and ignores a far larger ongoing day", () => {
    const withToday = calculateVisitsTrendAxes(buildVisitsTrendSeries(runningPeriod, "2026-09-07"))
    const withoutToday = calculateVisitsTrendAxes(buildVisitsTrendSeries(runningPeriod.slice(0, 2), "2026-09-07"))
    expect(withToday.total.max).toBe(withoutToday.total.max)
    expect(withToday.total.max).toBe(15)
    expect(withToday.total.max).toBeLessThan(33)
  })

  it("leaves readable headroom above the tallest completed bucket instead of a fixed ceiling", () => {
    expect(calculateVisitsTrendAxes(buildVisitsTrendSeries([day("2026-09-06", 0, 12)])).total.max).toBe(15)
    expect(calculateVisitsTrendAxes(buildVisitsTrendSeries([day("2026-09-06", 0, 4)])).total.max).toBe(5)
    expect(calculateVisitsTrendAxes(buildVisitsTrendSeries([day("2026-09-06", 0, 18)])).total.max).toBe(20)
    expect(calculateVisitsTrendAxes(buildVisitsTrendSeries([])).total.max).toBe(5)
  })

  it("shares one ceiling across both comparison periods", () => {
    const current = buildVisitsTrendSeries([day("2026-09-06", 0, 4)])
    const previous = buildVisitsTrendSeries([day("2026-08-06", 0, 18)])
    expect(calculateVisitsTrendAxes(current, previous).total.max).toBe(calculateVisitsTrendAxes(previous).total.max)
    expect(calculateVisitsTrendAxes(current, previous).total.max).toBe(20)
  })

  it("builds only the total-scale axis, with no separate issue band", () => {
    const axes = calculateVisitsTrendAxes(buildVisitsTrendSeries([day("2026-09-06", 0, 12)]))
    expect(axes.total.max).toBe(15)
    expect("issue" in axes).toBe(false)
    expect("ISSUE" in buildVisitsTrendSeries([day("2026-09-06", 0, 12)]).points[0]).toBe(false)
  })

  it("draws the ongoing bucket as a two-point segment clamped inside the plot area", () => {
    const series = buildVisitsTrendSeries(runningPeriod, "2026-09-07")
    const axes = calculateVisitsTrendAxes(series)
    expect(withVisitsTrendOngoingSegment(series, axes.total.max).map((point) => point.ONGOING)).toEqual([null, 12, 15])
  })

  it("adds no segment when the range has no ongoing bucket", () => {
    const series = buildVisitsTrendSeries([day("2026-09-01", 0, 4), day("2026-09-02", 0, 6)], "2026-09-07")
    expect(withVisitsTrendOngoingSegment(series, 10).map((point) => point.ONGOING)).toEqual([null, null])
  })
})
