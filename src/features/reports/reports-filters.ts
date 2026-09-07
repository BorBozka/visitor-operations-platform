import { addDays, differenceInCalendarDays, format, isValid, parse, subDays, subYears } from "date-fns"

import type { VisitReferenceData } from "@/domain/visits"
import { getQuickDateRangeOptions, matchesQuickDateRange, type QuickDateRangeKey, type QuickDateRangeOption } from "@/lib/quick-date-range"
import type { SingleSortState } from "@/lib/sort"
import { visitsReportRecordsStatusFilters, type VisitsReportRecordsStatusFilter, type VisitsReportSortField } from "@/features/reports/visits-report-utils"

// Identity/route values are unchanged; this array order is only the left-to-right display order
// of the tab strip. Default tab stays "visits" (see parseReportsQuery) and every `?tab=` deep
// link keeps working because tab resolution is membership-based, not positional.
export const reportTabs = ["visits", "goods", "vehicle"] as const
export type ReportTab = (typeof reportTabs)[number]
export const reportViews = ["analysis", "records"] as const
export type ReportView = (typeof reportViews)[number]
export const reportComparisonModes = ["none", "previous", "previous-year", "custom"] as const
export type ReportComparisonMode = (typeof reportComparisonModes)[number]
export const reportGranularities = ["daily", "weekly"] as const
export type ReportGranularity = (typeof reportGranularities)[number]

const REPORTS_SESSION_SEARCH_KEY = "manager-reports-search"

export interface ReportsScopeFilters {
  startDate: string
  endDate: string
  companyId: string
  facilityId: string
}

export interface ReportsQueryState {
  tab: ReportTab
  filters: ReportsScopeFilters
  view: ReportView
  page: number
  comparison: ReportComparisonMode
  compareFrom: string | null
  compareTo: string | null
  granularity: ReportGranularity
  search: string
  sort: SingleSortState<VisitsReportSortField>
  recordsStatus: VisitsReportRecordsStatusFilter
}

export type QuickRangeKey = QuickDateRangeKey
export type QuickRangeOption = QuickDateRangeOption

const isoDate = (date: Date) => format(date, "yyyy-MM-dd")

// Reports are historical analysis only — no filter or quick range may reach past today.
export function getMaxEndDate(now: Date): string {
  return isoDate(now)
}

export function getQuickRangeOptions(now: Date): QuickRangeOption[] {
  return getQuickDateRangeOptions(now)
}

export function getDefaultReportsRange(now: Date): Pick<ReportsScopeFilters, "startDate" | "endDate"> {
  const option = getQuickRangeOptions(now).find((item) => item.key === "30d")!
  return { startDate: option.startDate, endDate: option.endDate }
}

export function parseReportsQuery(searchParams: URLSearchParams, referenceData: VisitReferenceData, now: Date): ReportsQueryState {
  const tabParam = searchParams.get("tab")
  const tab: ReportTab = reportTabs.includes(tabParam as ReportTab) ? (tabParam as ReportTab) : "visits"

  const filters = parseReportsScopeFilters(searchParams, referenceData, now, reportsAnalysisScopeKeys)
  const view: ReportView = tab === "visits" && searchParams.get("view") === "records" ? "records" : "analysis"
  const comparisonParam = searchParams.get("comparison")
  const requestedComparison: ReportComparisonMode = reportComparisonModes.includes(comparisonParam as ReportComparisonMode) ? comparisonParam as ReportComparisonMode : "none"
  const granularity: ReportGranularity = searchParams.get("granularity") === "weekly" ? "weekly" : "daily"
  const rawSort = searchParams.get("visitSort")
  const validSort: VisitsReportSortField | null = ["date", "visitor", "company", "host", "planned", "duration", "status"].includes(rawSort ?? "") ? rawSort as VisitsReportSortField : null
  const statusParam = searchParams.get("visitStatus")
  const recordsStatus: VisitsReportRecordsStatusFilter = visitsReportRecordsStatusFilters.includes(statusParam as VisitsReportRecordsStatusFilter) ? statusParam as VisitsReportRecordsStatusFilter : "all"

  const comparisonPeriod = getComparisonPeriod(filters, requestedComparison, searchParams.get("compareFrom"), searchParams.get("compareTo"))
  // A custom comparison only exists once its equal-length range can be derived. This rejects
  // hand-authored or interrupted `comparison=custom` URLs as safely as the UI avoids creating them.
  const comparison: ReportComparisonMode = requestedComparison === "custom" && !comparisonPeriod ? "none" : requestedComparison
  return {
    tab,
    view,
    page: parsePageParameter(searchParams.get("page")),
    comparison,
    compareFrom: comparisonPeriod?.startDate ?? null,
    compareTo: comparisonPeriod?.endDate ?? null,
    granularity,
    search: searchParams.get("visitSearch")?.trim() ?? "",
    sort: validSort ? { field: validSort, direction: searchParams.get("visitDir") === "desc" ? "desc" : "asc" } : null,
    recordsStatus,
    filters,
  }
}

// Records and analysis deliberately keep their report context in different URL keys. It prevents
// returning to Records from inheriting an analysis-only filter (and vice versa), while preserving
// a shareable URL for each workspace.
export function parseRecordsReportFilters(searchParams: URLSearchParams, referenceData: VisitReferenceData, now: Date): ReportsScopeFilters {
  return parseReportsScopeFilters(searchParams, referenceData, now, reportsRecordsScopeKeys)
}

export function updateReportsSearchParams(current: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(current)
  if (!value || value === "all") next.delete(key)
  else next.set(key, value)
  if (key === "company") next.delete("facility")
  clearReportPages(next)
  return next
}

export function setReportsTab(current: URLSearchParams, tab: ReportTab) {
  const next = new URLSearchParams(current)
  if (tab === "visits") next.delete("tab")
  else next.set("tab", tab)
  return next
}

export function updateRecordsReportSearchParams(current: URLSearchParams, key: "from" | "to" | "company" | "facility", value: string) {
  const next = new URLSearchParams(current)
  const param = reportsRecordsScopeKeys[key]
  if (!value || value === "all") next.delete(param)
  else next.set(param, value)
  if (key === "company") next.delete(reportsRecordsScopeKeys.facility)
  clearReportPages(next)
  return next
}

export function setReportsRange(current: URLSearchParams, startDate: string, endDate: string) {
  const next = new URLSearchParams(current)
  if (startDate) next.set("from", startDate)
  else next.delete("from")
  if (endDate) next.set("to", endDate)
  else next.delete("to")
  clearReportPages(next)
  return next
}

export function setReportsView(current: URLSearchParams, view: ReportView) {
  const next = new URLSearchParams(current)
  if (view === "analysis") next.delete("view")
  else next.set("view", view)
  next.delete("page")
  return next
}

export function setRecordsReportRange(current: URLSearchParams, startDate: string, endDate: string) {
  const next = new URLSearchParams(current)
  setScopeRange(next, reportsRecordsScopeKeys, startDate, endDate)
  clearReportPages(next)
  return next
}

export function setVisitsReportRecordsWorkspace(current: URLSearchParams, nextState: { search?: string; sort?: SingleSortState<VisitsReportSortField>; status?: VisitsReportRecordsStatusFilter }) {
  const next = new URLSearchParams(current)
  if (nextState.search !== undefined) { if (nextState.search.trim()) next.set("visitSearch", nextState.search.trim()); else next.delete("visitSearch") }
  if (nextState.sort !== undefined) { if (nextState.sort) { next.set("visitSort", nextState.sort.field); next.set("visitDir", nextState.sort.direction) } else { next.delete("visitSort"); next.delete("visitDir") } }
  if (nextState.status !== undefined) { if (nextState.status === "all") next.delete("visitStatus"); else next.set("visitStatus", nextState.status) }
  next.delete("page")
  return next
}

export function setReportsPage(current: URLSearchParams, page: number) {
  const next = new URLSearchParams(current)
  if (page <= 1) next.delete("page")
  else next.set("page", String(Math.floor(page)))
  return next
}

export function setReportsComparison(current: URLSearchParams, comparison: ReportComparisonMode) {
  const next = new URLSearchParams(current)
  if (comparison === "none") next.delete("comparison")
  else next.set("comparison", comparison)
  if (comparison !== "custom") {
    next.delete("compareFrom")
    next.delete("compareTo")
  }
  return next
}

export function setReportsCustomComparison(current: URLSearchParams, filters: Pick<ReportsScopeFilters, "startDate" | "endDate">, compareFrom: string, compareTo = "") {
  const period = getComparisonPeriod(filters, "custom", compareFrom, compareTo)
  // Do not manufacture an incomplete custom comparison. The caller may be holding a date
  // field draft, but URL state remains the previously committed comparison until it is valid.
  if (!period) return new URLSearchParams(current)
  const next = setReportsComparison(current, "custom")
  next.set("compareFrom", period.startDate)
  if (compareTo) next.set("compareTo", period.endDate)
  else next.delete("compareTo")
  clearReportPages(next)
  return next
}

export function setReportsGranularity(current: URLSearchParams, granularity: ReportGranularity) {
  const next = new URLSearchParams(current)
  if (granularity === "daily") next.delete("granularity")
  else next.set("granularity", granularity)
  return next
}

export function resetReportsFilters(current: URLSearchParams) {
  const next = new URLSearchParams(current)
  for (const key of ["from", "to", "company", "facility", "comparison", "compareFrom", "compareTo", "granularity"]) {
    next.delete(key)
  }
  clearReportPages(next)
  return next
}

export function resetRecordsReportFilters(current: URLSearchParams) {
  const next = new URLSearchParams(current)
  for (const key of Object.values(reportsRecordsScopeKeys)) next.delete(key)
  clearReportPages(next)
  return next
}

function clearReportPages(params: URLSearchParams) {
  params.delete("page")
  params.delete("fleetPage")
  params.delete("goodsPage")
}

const reportsAnalysisScopeKeys = {
  from: "from",
  to: "to",
  company: "company",
  facility: "facility",
} as const

const reportsRecordsScopeKeys = {
  from: "recordsFrom",
  to: "recordsTo",
  company: "recordsCompany",
  facility: "recordsFacility",
} as const

type ReportsScopeKeyMap = typeof reportsAnalysisScopeKeys | typeof reportsRecordsScopeKeys

function parseReportsScopeFilters(searchParams: URLSearchParams, referenceData: VisitReferenceData, now: Date, keys: ReportsScopeKeyMap): ReportsScopeFilters {
  const fromParam = parseDateParameter(searchParams.get(keys.from))
  const rawToParam = parseDateParameter(searchParams.get(keys.to))
  const maxEndDate = getMaxEndDate(now)
  // Clamp here (the single source of truth for scope filters) rather than only in the date-picker's
  // onChange, so a hand-edited URL or bookmark can't sneak a future end date into a report.
  const toParam = rawToParam && rawToParam > maxEndDate ? maxEndDate : rawToParam
  const hasExplicitRange = Boolean(fromParam || toParam)
  const defaultRange = getDefaultReportsRange(now)

  const companyParam = searchParams.get(keys.company)
  const companyId = referenceData.companies.some((company) => company.id === companyParam) ? companyParam! : "all"
  const facilityParam = searchParams.get(keys.facility)
  const facility = referenceData.facilities.find((item) => item.id === facilityParam)
  const facilityId = facility && (companyId === "all" || facility.companyId === companyId) ? facility.id : "all"

  return {
    startDate: hasExplicitRange ? fromParam ?? "" : defaultRange.startDate,
    endDate: hasExplicitRange ? toParam ?? "" : defaultRange.endDate,
    companyId,
    facilityId,
  }
}

function setScopeRange(params: URLSearchParams, keys: ReportsScopeKeyMap, startDate: string, endDate: string) {
  if (startDate) params.set(keys.from, startDate)
  else params.delete(keys.from)
  if (endDate) params.set(keys.to, endDate)
  else params.delete(keys.to)
}

export function saveReportsSearch(searchParams: URLSearchParams) {
  if (typeof window === "undefined") return
  const value = searchParams.toString()
  if (value) window.sessionStorage.setItem(REPORTS_SESSION_SEARCH_KEY, value)
  else window.sessionStorage.removeItem(REPORTS_SESSION_SEARCH_KEY)
}

export function getSavedReportsHref(basePath = "/manager") {
  if (typeof window === "undefined") return `${basePath}/reports`
  const value = window.sessionStorage.getItem(REPORTS_SESSION_SEARCH_KEY)
  return value ? `${basePath}/reports?${value}` : `${basePath}/reports`
}

export function matchesQuickRange(filters: Pick<ReportsScopeFilters, "startDate" | "endDate">, option: QuickRangeOption) {
  return matchesQuickDateRange(filters, option)
}

// The immediately preceding period of the same length, e.g. 10–19 Aug (10 days) compares against
// 31 Jul–9 Aug. Returns null for an open-ended or inverted range, since neither has a natural
// length to mirror.
export function getPreviousPeriod(filters: Pick<ReportsScopeFilters, "startDate" | "endDate">): { startDate: string; endDate: string } | null {
  if (!filters.startDate || !filters.endDate) return null
  const start = parse(filters.startDate, "yyyy-MM-dd", new Date())
  const end = parse(filters.endDate, "yyyy-MM-dd", new Date())
  if (start > end) return null

  const lengthDays = differenceInCalendarDays(end, start) + 1
  const previousEnd = subDays(start, 1)
  const previousStart = subDays(previousEnd, lengthDays - 1)
  return { startDate: isoDate(previousStart), endDate: isoDate(previousEnd) }
}

function parseDateParameter(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

// Shared comparison range model for every report surface. All ranges are inclusive. A custom
// end may be selected independently; leaving it empty retains the equal-length fallback.
export function getComparisonPeriod(filters: Pick<ReportsScopeFilters, "startDate" | "endDate">, mode: ReportComparisonMode, customStart?: string | null, customEnd?: string | null): { startDate: string; endDate: string } | null {
  if (mode === "none") return null
  if (mode === "previous") return getPreviousPeriod(filters)
  if (!filters.startDate || !filters.endDate) return null
  const start = parse(filters.startDate, "yyyy-MM-dd", new Date())
  const end = parse(filters.endDate, "yyyy-MM-dd", new Date())
  if (!isValid(start) || !isValid(end) || start > end) return null
  if (mode === "previous-year") return { startDate: isoDate(subYears(start, 1)), endDate: isoDate(subYears(end, 1)) }
  if (!customStart || !/^\d{4}-\d{2}-\d{2}$/.test(customStart)) return null
  const custom = parse(customStart, "yyyy-MM-dd", new Date())
  if (!isValid(custom)) return null
  if (!customEnd) return { startDate: isoDate(custom), endDate: isoDate(addDays(custom, differenceInCalendarDays(end, start))) }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) return null
  const customEndDate = parse(customEnd, "yyyy-MM-dd", new Date())
  if (!isValid(customEndDate) || customEndDate < custom) return null
  return { startDate: isoDate(custom), endDate: isoDate(customEndDate) }
}

export interface CustomComparisonPreview {
  period: { startDate: string; endDate: string }
  hasDifferentLength: boolean
}

// This preview deliberately uses the same inclusive range calculation as the committed custom
// comparison. It gives the menu live feedback without changing URL state for a partial draft.
export function getCustomComparisonPreview(filters: Pick<ReportsScopeFilters, "startDate" | "endDate">, customStart: string, customEnd: string): CustomComparisonPreview | null {
  const period = getComparisonPeriod(filters, "custom", customStart, customEnd)
  if (!period) return null

  const mainStart = parse(filters.startDate, "yyyy-MM-dd", new Date())
  const mainEnd = parse(filters.endDate, "yyyy-MM-dd", new Date())
  const comparisonStart = parse(period.startDate, "yyyy-MM-dd", new Date())
  const comparisonEnd = parse(period.endDate, "yyyy-MM-dd", new Date())
  if (![mainStart, mainEnd, comparisonStart, comparisonEnd].every(isValid)) return null

  return {
    period,
    hasDifferentLength: differenceInCalendarDays(mainEnd, mainStart) !== differenceInCalendarDays(comparisonEnd, comparisonStart),
  }
}

function parsePageParameter(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}
