import { describe, expect, it } from "vitest"

import {
  getDefaultReportsRange,
  getComparisonPeriod,
  getCustomComparisonPreview,
  getMaxEndDate,
  getPreviousPeriod,
  getQuickRangeOptions,
  matchesQuickRange,
  parseRecordsReportFilters,
  parseReportsQuery,
  reportTabs,
  resetRecordsReportFilters,
  resetReportsFilters,
  setReportsComparison,
  setReportsCustomComparison,
  setReportsGranularity,
  setReportsPage,
  setReportsRange,
  setReportsTab,
  setReportsView,
  setVisitsReportRecordsWorkspace,
  setRecordsReportRange,
  updateRecordsReportSearchParams,
  updateReportsSearchParams,
} from "@/features/reports/reports-filters"
import { mockVisitReferenceData } from "@/services/mock-visit-data"

const now = new Date("2026-08-17T12:00:00+03:00")

describe("reports quick ranges", () => {
  it("computes today, 7 day, 30 day and this-month ranges", () => {
    const [today, sevenDays, thirtyDays, month] = getQuickRangeOptions(now)
    expect(today).toMatchObject({ key: "today", startDate: "2026-08-17", endDate: "2026-08-17" })
    expect(sevenDays).toMatchObject({ key: "7d", startDate: "2026-08-11", endDate: "2026-08-17" })
    expect(thirtyDays).toMatchObject({ key: "30d", startDate: "2026-07-19", endDate: "2026-08-17" })
    expect(month).toMatchObject({ key: "month", startDate: "2026-08-01", endDate: "2026-08-17" })
  })

  it("defaults the reports range to the last 30 days", () => {
    expect(getDefaultReportsRange(now)).toEqual({ startDate: "2026-07-19", endDate: "2026-08-17" })
  })

  it("matches filters against a quick range option", () => {
    const option = getQuickRangeOptions(now)[0]
    expect(matchesQuickRange({ startDate: "2026-08-17", endDate: "2026-08-17" }, option)).toBe(true)
    expect(matchesQuickRange({ startDate: "2026-08-16", endDate: "2026-08-17" }, option)).toBe(false)
  })

  it("never lets a quick range's end date land in the future", () => {
    for (const option of getQuickRangeOptions(now)) {
      expect(option.endDate <= getMaxEndDate(now)).toBe(true)
    }
  })
})

describe("getMaxEndDate", () => {
  it("returns today as an ISO date", () => {
    expect(getMaxEndDate(now)).toBe("2026-08-17")
  })
})

describe("getPreviousPeriod", () => {
  it("mirrors the same-length period immediately preceding the range", () => {
    expect(getPreviousPeriod({ startDate: "2026-08-10", endDate: "2026-08-19" })).toEqual({ startDate: "2026-07-31", endDate: "2026-08-09" })
  })

  it("handles a single-day range", () => {
    expect(getPreviousPeriod({ startDate: "2026-08-19", endDate: "2026-08-19" })).toEqual({ startDate: "2026-08-18", endDate: "2026-08-18" })
  })

  it("returns null for an open-ended or inverted range", () => {
    expect(getPreviousPeriod({ startDate: "", endDate: "2026-08-19" })).toBeNull()
    expect(getPreviousPeriod({ startDate: "2026-08-19", endDate: "" })).toBeNull()
    expect(getPreviousPeriod({ startDate: "2026-08-19", endDate: "2026-08-01" })).toBeNull()
  })
})

describe("parseReportsQuery", () => {
  it("defaults to the visits tab, last-30-days range and unscoped company/facility", () => {
    const state = parseReportsQuery(new URLSearchParams(""), mockVisitReferenceData, now)
    expect(state.tab).toBe("visits")
    expect(state).toMatchObject({ view: "analysis", page: 1, comparison: "none", granularity: "daily" })
    expect(state.filters).toEqual({ startDate: "2026-07-19", endDate: "2026-08-17", companyId: "all", facilityId: "all" })
  })

  it("falls back to the visits tab for unknown or disabled tab values", () => {
    expect(parseReportsQuery(new URLSearchParams("tab=unknown"), mockVisitReferenceData, now).tab).toBe("visits")
    expect(parseReportsQuery(new URLSearchParams("tab=vehicle"), mockVisitReferenceData, now).tab).toBe("vehicle")
    expect(parseReportsQuery(new URLSearchParams("tab=goods"), mockVisitReferenceData, now).tab).toBe("goods")
  })

  it("uses the explicit range once either boundary is provided, leaving the other open", () => {
    const both = parseReportsQuery(new URLSearchParams("from=2026-08-01&to=2026-08-05"), mockVisitReferenceData, now)
    expect(both.filters).toMatchObject({ startDate: "2026-08-01", endDate: "2026-08-05" })

    const openEnded = parseReportsQuery(new URLSearchParams("from=2026-08-01"), mockVisitReferenceData, now)
    expect(openEnded.filters).toMatchObject({ startDate: "2026-08-01", endDate: "" })

    const invalid = parseReportsQuery(new URLSearchParams("from=not-a-date"), mockVisitReferenceData, now)
    expect(invalid.filters).toMatchObject({ startDate: "2026-07-19", endDate: "2026-08-17" })
  })

  it("clamps a future end date from the URL to today, since reports are historical", () => {
    const future = parseReportsQuery(new URLSearchParams("from=2026-08-01&to=2099-01-01"), mockVisitReferenceData, now)
    expect(future.filters).toMatchObject({ startDate: "2026-08-01", endDate: "2026-08-17" })
  })

  it("validates company and clears a facility that no longer matches the company", () => {
    const scoped = parseReportsQuery(new URLSearchParams("company=bplas&facility=otomotiv-uretim"), mockVisitReferenceData, now)
    expect(scoped.filters.companyId).toBe("bplas")
    expect(scoped.filters.facilityId).toBe("all")

    const unknownCompany = parseReportsQuery(new URLSearchParams("company=missing"), mockVisitReferenceData, now)
    expect(unknownCompany.filters.companyId).toBe("all")
  })

  it("parses records state from the URL and safely falls back for invalid values", () => {
    expect(parseReportsQuery(new URLSearchParams("view=records&page=2&comparison=previous&granularity=weekly"), mockVisitReferenceData, now)).toMatchObject({
      view: "records",
      page: 2,
      comparison: "previous",
      granularity: "weekly",
    })
    expect(parseReportsQuery(new URLSearchParams("view=unknown&page=0&comparison=other&granularity=monthly"), mockVisitReferenceData, now)).toMatchObject({
      view: "analysis",
      page: 1,
      comparison: "none",
      granularity: "daily",
    })
    expect(parseReportsQuery(new URLSearchParams("tab=vehicle&view=records"), mockVisitReferenceData, now).view).toBe("analysis")
  })

  it("keeps visits records search and sort in their own URL state", () => {
    const state = parseReportsQuery(new URLSearchParams("view=records&visitSearch=Mehmet%20Kaya&visitSort=visitor&visitDir=desc"), mockVisitReferenceData, now)
    expect(state).toMatchObject({ search: "Mehmet Kaya", sort: { field: "visitor", direction: "desc" } })
    const next = setVisitsReportRecordsWorkspace(new URLSearchParams("page=3&fleetPage=4"), { search: "Ayşe", sort: { field: "status", direction: "asc" } })
    expect(next.get("fleetPage")).toBe("4")
    expect(next.get("visitSearch")).toBe("Ayşe")
    expect(next.get("visitSort")).toBe("status")
    expect(next.get("visitDir")).toBe("asc")
    expect(setVisitsReportRecordsWorkspace(next, { search: "", sort: null }).toString()).toBe("fleetPage=4")
  })

  it("keeps the records status filter in its own shareable URL key and clears it for all records", () => {
    expect(parseReportsQuery(new URLSearchParams("view=records&visitStatus=late-arrival"), mockVisitReferenceData, now).recordsStatus).toBe("late-arrival")
    expect(parseReportsQuery(new URLSearchParams("visitStatus=unknown"), mockVisitReferenceData, now).recordsStatus).toBe("all")
    const filtered = setVisitsReportRecordsWorkspace(new URLSearchParams("page=2&visitSearch=Ayşe"), { status: "completed" })
    expect(filtered.toString()).toBe("visitSearch=Ay%C5%9Fe&visitStatus=completed")
    expect(setVisitsReportRecordsWorkspace(filtered, { status: "all" }).toString()).toBe("visitSearch=Ay%C5%9Fe")
  })

  it("rejects an incomplete custom comparison from the URL", () => {
    expect(parseReportsQuery(new URLSearchParams("comparison=custom"), mockVisitReferenceData, now)).toMatchObject({ comparison: "none", compareFrom: null, compareTo: null })
    expect(parseReportsQuery(new URLSearchParams("comparison=custom&compareFrom=2025-07-19"), mockVisitReferenceData, now)).toMatchObject({ comparison: "custom", compareFrom: "2025-07-19", compareTo: "2025-08-17" })
    expect(parseReportsQuery(new URLSearchParams("comparison=custom&compareFrom=2025-07-19&compareTo=2025-07-31"), mockVisitReferenceData, now)).toMatchObject({ comparison: "custom", compareFrom: "2025-07-19", compareTo: "2025-07-31" })
  })
})

describe("report tab strip", () => {
  it("displays the tabs as Ziyaretler, then Mal Hareketi, then Araç / Şoför", () => {
    expect([...reportTabs]).toEqual(["visits", "goods", "vehicle"])
  })

  it("keeps visits as the default tab and every tab deep link working after the reorder", () => {
    expect(parseReportsQuery(new URLSearchParams(""), mockVisitReferenceData, now).tab).toBe("visits")
    expect(parseReportsQuery(new URLSearchParams("tab=goods"), mockVisitReferenceData, now).tab).toBe("goods")
    expect(parseReportsQuery(new URLSearchParams("tab=vehicle&comparison=previous"), mockVisitReferenceData, now)).toMatchObject({ tab: "vehicle", comparison: "previous" })
  })
})

describe("records report scope filters", () => {
  it("defaults independently from an analysis scope stored in the same URL", () => {
    const params = new URLSearchParams("from=2026-08-01&to=2026-08-05&company=bplas&facility=bplas-merkez&comparison=previous")

    expect(parseReportsQuery(params, mockVisitReferenceData, now).filters).toMatchObject({ startDate: "2026-08-01", endDate: "2026-08-05", companyId: "bplas", facilityId: "bplas-merkez" })
    expect(parseRecordsReportFilters(params, mockVisitReferenceData, now)).toEqual({ startDate: "2026-07-19", endDate: "2026-08-17", companyId: "all", facilityId: "all" })
  })

  it("validates its own prefixed URL values without reading analysis filters", () => {
    const filters = parseRecordsReportFilters(new URLSearchParams("from=2026-08-01&recordsFrom=2026-08-03&recordsTo=2099-01-01&recordsCompany=bplas&recordsFacility=bplas-merkez"), mockVisitReferenceData, now)

    expect(filters).toEqual({ startDate: "2026-08-03", endDate: "2026-08-17", companyId: "bplas", facilityId: "bplas-merkez" })
  })
})

describe("shared comparison periods", () => {
  const filters = { startDate: "2026-06-01", endDate: "2026-08-31" }

  it("supports previous, previous-year, equal-length custom and explicit custom periods", () => {
    expect(getComparisonPeriod(filters, "previous")).toEqual({ startDate: "2026-03-01", endDate: "2026-05-31" })
    expect(getComparisonPeriod(filters, "previous-year")).toEqual({ startDate: "2025-06-01", endDate: "2025-08-31" })
    expect(getComparisonPeriod(filters, "custom", "2025-06-01")).toEqual({ startDate: "2025-06-01", endDate: "2025-08-31" })
    expect(getComparisonPeriod(filters, "custom", "2025-06-01", "2025-07-15")).toEqual({ startDate: "2025-06-01", endDate: "2025-07-15" })
    expect(getComparisonPeriod(filters, "custom", "2025-06-01", "2025-05-31")).toBeNull()
  })

  it("handles leap-day ranges without producing an invalid date", () => {
    expect(getComparisonPeriod({ startDate: "2024-02-29", endDate: "2024-03-02" }, "previous-year")).toEqual({ startDate: "2023-02-28", endDate: "2023-03-02" })
  })

  it("cleans stale custom parameters when comparison changes", () => {
    expect(setReportsComparison(new URLSearchParams("comparison=custom&compareFrom=2025-06-01&compareTo=2025-08-31"), "previous").toString()).toBe("comparison=previous")
    expect(setReportsCustomComparison(new URLSearchParams(""), filters, "2025-06-01").toString()).toBe("comparison=custom&compareFrom=2025-06-01")
    expect(setReportsCustomComparison(new URLSearchParams(""), filters, "2025-06-01", "2025-07-15").toString()).toBe("comparison=custom&compareFrom=2025-06-01&compareTo=2025-07-15")
  })

  it("does not commit an incomplete custom draft and preserves the previous comparison", () => {
    const previous = new URLSearchParams("comparison=previous")
    expect(setReportsCustomComparison(previous, filters, "").toString()).toBe("comparison=previous")
    expect(setReportsCustomComparison(previous, filters, "2025-06-01", "2025-05-31").toString()).toBe("comparison=previous")
    expect(setReportsCustomComparison(new URLSearchParams("comparison=custom&compareFrom=2025-06-01&compareTo=2025-08-31"), filters, "").toString()).toBe("comparison=custom&compareFrom=2025-06-01&compareTo=2025-08-31")
  })

  it("builds no custom preview before a date is entered and flags only unequal period lengths", () => {
    expect(getCustomComparisonPreview(filters, "", "")).toBeNull()
    expect(getCustomComparisonPreview(filters, "2025-06-01", "2025-08-31")).toEqual({
      period: { startDate: "2025-06-01", endDate: "2025-08-31" },
      hasDifferentLength: false,
    })
    expect(getCustomComparisonPreview(filters, "2025-06-01", "2025-07-15")).toEqual({
      period: { startDate: "2025-06-01", endDate: "2025-07-15" },
      hasDifferentLength: true,
    })
  })
})

describe("reports search param helpers", () => {
  it("clears the facility and page when the company changes", () => {
    const changed = updateReportsSearchParams(new URLSearchParams("page=3&facility=bplas-merkez&custom=kept"), "company", "bplas")
    expect(changed.get("company")).toBe("bplas")
    expect(changed.get("facility")).toBeNull()
    expect(changed.get("page")).toBeNull()
    expect(changed.get("custom")).toBe("kept")
  })

  it("removes a param when set back to an empty or 'all' value", () => {
    const cleared = updateReportsSearchParams(new URLSearchParams("company=bplas"), "company", "all")
    expect(cleared.get("company")).toBeNull()
  })

  it("omits the tab param for the default visits tab and sets it otherwise", () => {
    expect(setReportsTab(new URLSearchParams("tab=vehicle"), "visits").get("tab")).toBeNull()
    expect(setReportsTab(new URLSearchParams(""), "vehicle").get("tab")).toBe("vehicle")
  })

  it("updates records scope without changing analysis scope", () => {
    const current = new URLSearchParams("from=2026-08-01&to=2026-08-05&company=bplas&comparison=previous&page=2&fleetPage=3")
    const changed = updateRecordsReportSearchParams(current, "company", "anadolu")

    expect(changed.get("company")).toBe("bplas")
    expect(changed.get("comparison")).toBe("previous")
    expect(changed.get("recordsCompany")).toBe("anadolu")
    expect(changed.get("recordsFacility")).toBeNull()
    expect(changed.get("page")).toBeNull()
    expect(changed.get("fleetPage")).toBeNull()
  })

  it("preserves each report's independent workspace state while switching tabs", () => {
    const current = new URLSearchParams("tab=vehicle&view=records&page=2&fleetView=records&fleetPage=4&goodsView=records&goodsPage=3")
    const visits = setReportsTab(current, "visits")
    expect(visits.toString()).toBe("view=records&page=2&fleetView=records&fleetPage=4&goodsView=records&goodsPage=3")
    expect(setReportsTab(visits, "vehicle").toString()).toBe("view=records&page=2&fleetView=records&fleetPage=4&goodsView=records&goodsPage=3&tab=vehicle")
  })

  it("sets or clears the from/to range params together", () => {
    const withRange = setReportsRange(new URLSearchParams(""), "2026-08-01", "2026-08-05")
    expect(withRange.get("from")).toBe("2026-08-01")
    expect(withRange.get("to")).toBe("2026-08-05")

    const cleared = setReportsRange(withRange, "", "")
    expect(cleared.get("from")).toBeNull()
    expect(cleared.get("to")).toBeNull()
    expect(cleared.get("page")).toBeNull()
  })

  it("sets and resets records scope without touching analysis state", () => {
    const current = new URLSearchParams("from=2026-08-01&to=2026-08-05&company=bplas&comparison=previous&granularity=weekly&recordsCompany=anadolu&recordsFacility=anadolu-depo&page=2")
    const withRange = setRecordsReportRange(current, "2026-08-10", "2026-08-12")
    expect(withRange.get("recordsFrom")).toBe("2026-08-10")
    expect(withRange.get("recordsTo")).toBe("2026-08-12")
    expect(withRange.get("from")).toBe("2026-08-01")
    expect(withRange.get("page")).toBeNull()

    const reset = resetRecordsReportFilters(withRange)
    expect(reset.get("recordsFrom")).toBeNull()
    expect(reset.get("recordsTo")).toBeNull()
    expect(reset.get("recordsCompany")).toBeNull()
    expect(reset.get("recordsFacility")).toBeNull()
    expect(reset.get("from")).toBe("2026-08-01")
    expect(reset.get("to")).toBe("2026-08-05")
    expect(reset.get("company")).toBe("bplas")
    expect(reset.get("comparison")).toBe("previous")
    expect(reset.get("granularity")).toBe("weekly")
  })

  it("keeps records state in URL helpers and resets only page when filters change", () => {
    const records = setReportsView(new URLSearchParams("page=2"), "records")
    expect(records.get("view")).toBe("records")
    expect(records.get("page")).toBeNull()

    const secondPage = setReportsPage(records, 2)
    expect(secondPage.get("page")).toBe("2")
    expect(setReportsPage(secondPage, 1).get("page")).toBeNull()
    expect(updateReportsSearchParams(secondPage, "company", "bplas").get("page")).toBeNull()

    expect(setReportsComparison(new URLSearchParams("page=2"), "previous").get("page")).toBe("2")
    expect(setReportsGranularity(new URLSearchParams("page=2"), "weekly").get("page")).toBe("2")
  })

  it("resets filters but preserves the selected report workspace", () => {
    const reset = resetReportsFilters(new URLSearchParams("tab=vehicle&view=records&page=2&from=2026-08-01&to=2026-08-05&company=bplas&facility=bplas-merkez&comparison=previous&granularity=weekly&recordsFrom=2026-08-10&recordsTo=2026-08-12&recordsCompany=anadolu"))
    expect(reset.toString()).toBe("tab=vehicle&view=records&recordsFrom=2026-08-10&recordsTo=2026-08-12&recordsCompany=anadolu")
  })
})
