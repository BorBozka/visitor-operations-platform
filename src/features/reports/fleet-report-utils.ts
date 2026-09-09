import { differenceInMinutes, endOfDay, parse, startOfDay } from "date-fns"

import type { PlannedTransportAssignment } from "@/domain/transport-assignments"
import type { Meeting, Visit } from "@/domain/visits"
import { formatDurationMinutes } from "@/features/reports/report-format"
import type { ReportsScopeFilters } from "@/features/reports/reports-filters"
import { getPageCount as getPageCountShared, paginate } from "@/lib/pagination"
import { matchesReportSearch, sortReportRecords } from "@/features/reports/report-records-utils"
import type { SingleSortState } from "@/lib/sort"

// The records workspace has a deliberately fixed page size. Nine compact, two-line rows fit
// the viewport-filling report card at the manager shell's normal desktop height without giving
// the table body its own vertical scrollbar.
export const FLEET_REPORT_PAGE_SIZE = 8
export const MAX_FLEET_LOAD_RESOURCES = 10
export const FLEET_CATEGORY_AXIS_WIDTH = 164

const NICE_DURATION_STEPS = [30, 60, 120, 180, 240, 360, 480, 720, 1_440] as const

export type FleetReportDimension = "vehicles" | "drivers"
export type FleetReportView = "analysis" | "records"
export type FleetReportSortField = "date" | "purpose" | "vehicle" | "driver" | "planned" | "status"
export const fleetReportRecordsStatusFilters = ["all", "active", "cancelled"] as const
export type FleetReportRecordsStatusFilter = (typeof fleetReportRecordsStatusFilters)[number]

export interface FleetReportWorkspaceState {
  view: FleetReportView
  dimension: FleetReportDimension
  page: number
  search: string
  status: FleetReportRecordsStatusFilter
  sort: SingleSortState<FleetReportSortField>
}

export interface FleetReportMetrics {
  totalAssignments: number
  cancelledAssignments: number
  plannedLoadMinutes: number
  usedVehicleCount: number
  usedDriverCount: number
}

export type FleetMetricFavorableDirection = "increase" | "decrease"
export type FleetMetricDeltaTone = "positive" | "negative" | "neutral"

export interface FleetLoadResource {
  resourceId: string
  resourceName: string
  plannedMinutes: number
  assignmentCount: number
}

export interface FleetLoadComparisonResource extends FleetLoadResource {
  previousPlannedMinutes: number
  previousAssignmentCount: number
}

export interface FleetDurationScale {
  domainMax: number
  stepMinutes: number
  ticks: number[]
}

function toLocalDate(value: string) {
  return parse(value, "yyyy-MM-dd", new Date())
}

function getAssignmentDurationMinutes(assignment: PlannedTransportAssignment) {
  return Math.max(0, differenceInMinutes(new Date(assignment.plannedEnd), new Date(assignment.plannedStart)))
}

// Both dimensions deliberately share one category-axis width. Resource names are truncated by
// the chart tick renderer, so a longer driver or vehicle name can never move the plot origin.
export function getFleetCategoryAxisWidth(dimension: FleetReportDimension) {
  return { vehicles: FLEET_CATEGORY_AXIS_WIDTH, drivers: FLEET_CATEGORY_AXIS_WIDTH }[dimension]
}

export function truncateFleetCategoryLabel(label: string, maxCharacters = 22) {
  return label.length <= maxCharacters ? label : `${label.slice(0, maxCharacters - 1).trimEnd()}…`
}

// Fleet load is a duration domain, so a compact fixed family of minute/hour steps is more useful
// than generic decimal ticks. Padding is part of the domain (in addition to the SVG margin) to
// protect labels such as "12 sa · 14 görev" when the longest bar reaches the data maximum.
export function getNiceFleetDurationScale(maxMinutes: number, maxAssignmentCount = 0): FleetDurationScale {
  const safeMax = Math.max(0, Math.ceil(maxMinutes))
  if (safeMax === 0) return { domainMax: 60, stepMinutes: 30, ticks: [0, 30, 60] }

  const countDigits = String(Math.max(0, Math.floor(maxAssignmentCount))).length
  const paddingRatio = Math.min(0.32, 0.18 + Math.max(0, countDigits - 1) * 0.03)
  const paddedMax = safeMax + Math.max(30, Math.ceil(safeMax * paddingRatio))
  const minimumStep = safeMax <= 120 ? 30 : safeMax <= 360 ? 60 : safeMax <= 900 ? 120 : safeMax <= 1_440 ? 180 : 240
  const stepMinutes = NICE_DURATION_STEPS.find((step) => step >= minimumStep && Math.ceil(paddedMax / step) <= 8)
    ?? Math.ceil(paddedMax / (8 * 1_440)) * 1_440
  const domainMax = Math.max(stepMinutes, Math.ceil(paddedMax / stepMinutes) * stepMinutes)
  const ticks = Array.from({ length: domainMax / stepMinutes + 1 }, (_, index) => index * stepMinutes)

  return { domainMax, stepMinutes, ticks }
}

export function filterAssignmentsForReport(assignments: PlannedTransportAssignment[], filters: ReportsScopeFilters): PlannedTransportAssignment[] {
  const rangeStart = filters.startDate ? startOfDay(toLocalDate(filters.startDate)) : null
  const rangeEnd = filters.endDate ? endOfDay(toLocalDate(filters.endDate)) : null

  const filtered = assignments.filter((assignment) => {
    const planned = new Date(assignment.plannedStart)
    return (filters.companyId === "all" || assignment.companyId === filters.companyId)
      && (filters.facilityId === "all" || assignment.facilityId === filters.facilityId)
      && (!rangeStart || planned >= rangeStart)
      && (!rangeEnd || planned <= rangeEnd)
  })

  return [...filtered].sort((left, right) => new Date(right.plannedStart).getTime() - new Date(left.plannedStart).getTime())
}

export function searchFleetReportRecords(assignments: PlannedTransportAssignment[], search: string, getRelatedLabel?: (assignment: PlannedTransportAssignment) => string) {
  return assignments.filter((assignment) => matchesReportSearch(search, [assignment.vehicleName, assignment.vehicleLicensePlate, assignment.driverName, assignment.purpose, getRelatedLabel?.(assignment)]))
}

export function filterFleetReportRecordsByStatus(assignments: PlannedTransportAssignment[], status: FleetReportRecordsStatusFilter): PlannedTransportAssignment[] {
  if (status === "all") return assignments
  return assignments.filter((assignment) => status === "active" ? assignment.status === "ACTIVE" : assignment.status === "CANCELLED")
}

export function sortFleetReportRecords(assignments: PlannedTransportAssignment[], sort: SingleSortState<FleetReportSortField>) {
  return sortReportRecords(assignments, sort, (assignment, field) => {
    if (field === "date" || field === "planned") return new Date(assignment.plannedStart).getTime()
    if (field === "purpose") return assignment.purpose
    if (field === "vehicle") return `${assignment.vehicleName} ${assignment.vehicleLicensePlate}`
    if (field === "driver") return assignment.driverName
    return assignment.status === "ACTIVE" ? 0 : 1
  })
}

// Metadata deliberately counts every filtered assignment, including cancelled records. The
// planned-load duration and resource counts are different on purpose: a cancelled assignment is
// historical report evidence, but it must not look like active load on a vehicle or driver.
export function calculateFleetReportMetrics(assignments: PlannedTransportAssignment[]): FleetReportMetrics {
  const activeAssignments = filterFleetReportRecordsByStatus(assignments, "active")
  return {
    totalAssignments: assignments.length,
    cancelledAssignments: filterFleetReportRecordsByStatus(assignments, "cancelled").length,
    plannedLoadMinutes: activeAssignments.reduce((sum, assignment) => sum + getAssignmentDurationMinutes(assignment), 0),
    usedVehicleCount: new Set(activeAssignments.map((assignment) => assignment.vehicleResourceId)).size,
    usedDriverCount: new Set(activeAssignments.map((assignment) => assignment.driverResourceId)).size,
  }
}

// Retained for existing consumers while the report UI uses calculateFleetReportMetrics. This is
// deliberately a presentation-agnostic historical calculation; it does not reintroduce the old
// four-card KPI layout or change the active-load semantics used by the analysis workspace.
export function calculateFleetReportKpis(assignments: PlannedTransportAssignment[]) {
  const total = assignments.length
  const cancelled = assignments.filter((assignment) => assignment.status === "CANCELLED").length
  const durations = assignments.map(getAssignmentDurationMinutes)
  return {
    total,
    cancelled,
    cancelRate: total === 0 ? 0 : (cancelled / total) * 100,
    averagePlannedDurationMinutes: durations.length === 0 ? null : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
  }
}

export function aggregateFleetResourceLoad(assignments: PlannedTransportAssignment[], dimension: FleetReportDimension): FleetLoadResource[] {
  const grouped = new Map<string, FleetLoadResource>()

  for (const assignment of assignments) {
    if (assignment.status === "CANCELLED") continue
    const resourceId = dimension === "vehicles" ? assignment.vehicleResourceId : assignment.driverResourceId
    // Load is grouped by immutable resource id, so an assignment that lost its catalog reference
    // cannot be grouped. A deleted resource never has an ACTIVE assignment left, so nothing that
    // still carries load is dropped here.
    if (resourceId === null) continue
    const resourceName = dimension === "vehicles" ? assignment.vehicleName : assignment.driverName
    const current = grouped.get(resourceId)
    const plannedMinutes = getAssignmentDurationMinutes(assignment)
    grouped.set(resourceId, current
      ? { ...current, plannedMinutes: current.plannedMinutes + plannedMinutes, assignmentCount: current.assignmentCount + 1 }
      : { resourceId, resourceName, plannedMinutes, assignmentCount: 1 })
  }

  return sortFleetLoadResources([...grouped.values()])
}

export function sortFleetLoadResources(resources: FleetLoadResource[]): FleetLoadResource[] {
  return [...resources].sort((left, right) => right.plannedMinutes - left.plannedMinutes
    || right.assignmentCount - left.assignmentCount
    || left.resourceName.localeCompare(right.resourceName, "tr")
    || left.resourceId.localeCompare(right.resourceId, "tr"))
}

// Merges the two periods by immutable resource ID. A resource that is only present in one period
// remains visible with a zero counterpart so bar comparisons cannot silently omit a changed load.
export function mergeFleetLoadComparison(current: FleetLoadResource[], previous: FleetLoadResource[]): FleetLoadComparisonResource[] {
  const previousById = new Map(previous.map((resource) => [resource.resourceId, resource]))
  const currentById = new Map(current.map((resource) => [resource.resourceId, resource]))
  const resourceIds = new Set([...currentById.keys(), ...previousById.keys()])

  return [...resourceIds].map((resourceId) => {
    const currentResource = currentById.get(resourceId)
    const previousResource = previousById.get(resourceId)
    const preferred = currentResource ?? previousResource!
    return {
      resourceId,
      resourceName: preferred.resourceName,
      plannedMinutes: currentResource?.plannedMinutes ?? 0,
      assignmentCount: currentResource?.assignmentCount ?? 0,
      previousPlannedMinutes: previousResource?.plannedMinutes ?? 0,
      previousAssignmentCount: previousResource?.assignmentCount ?? 0,
    }
  }).sort((left, right) => right.plannedMinutes - left.plannedMinutes
    || right.previousPlannedMinutes - left.previousPlannedMinutes
    || right.assignmentCount - left.assignmentCount
    || right.previousAssignmentCount - left.previousAssignmentCount
    || left.resourceName.localeCompare(right.resourceName, "tr")
    || left.resourceId.localeCompare(right.resourceId, "tr"))
}

export function getFleetLoadChartResources<T extends FleetLoadResource>(resources: T[]): T[] {
  return resources.slice(0, MAX_FLEET_LOAD_RESOURCES)
}

function formatCountDelta(current: number, previous: number) {
  const delta = current - previous
  return delta === 0 ? "değişmedi" : `${delta > 0 ? "+" : ""}${delta}`
}

function formatDurationDelta(current: number, previous: number) {
  const delta = current - previous
  return delta === 0 ? "değişmedi" : `${delta > 0 ? "+" : "-"}${formatDurationMinutes(Math.abs(delta))}`
}

export function getFleetMetricDeltaTone(difference: number, favorableDirection: FleetMetricFavorableDirection): FleetMetricDeltaTone {
  if (difference === 0) return "neutral"
  return (favorableDirection === "increase" && difference > 0) || (favorableDirection === "decrease" && difference < 0)
    ? "positive"
    : "negative"
}

export function buildFleetMetadata(current: FleetReportMetrics, previous: FleetReportMetrics | null): string {
  const values = [
    `${current.totalAssignments} görev`,
    `${current.cancelledAssignments} iptal`,
    `${formatDurationMinutes(current.plannedLoadMinutes)} planlama yükü`,
    `${current.usedVehicleCount} araç`,
    `${current.usedDriverCount} şoför`,
  ]
  if (!previous) return values.join(" · ")

  return [
    `${values[0]} ${formatCountDelta(current.totalAssignments, previous.totalAssignments)}`,
    `${values[1]} ${formatCountDelta(current.cancelledAssignments, previous.cancelledAssignments)}`,
    `${values[2]} ${formatDurationDelta(current.plannedLoadMinutes, previous.plannedLoadMinutes)}`,
    `${values[3]} ${formatCountDelta(current.usedVehicleCount, previous.usedVehicleCount)}`,
    `${values[4]} ${formatCountDelta(current.usedDriverCount, previous.usedDriverCount)}`,
  ].join(" · ")
}

export function isFleetRecordActivationKey(key: string) {
  return key === "Enter" || key === " "
}

export function parseFleetReportWorkspace(searchParams: URLSearchParams): FleetReportWorkspaceState {
  const rawView = searchParams.get("fleetView")
  const rawDimension = searchParams.get("fleetDimension")
  const rawPage = Number(searchParams.get("fleetPage"))
  const rawSort = searchParams.get("fleetSort")
  const rawStatus = searchParams.get("fleetStatus")
  const validSort: FleetReportSortField | null = ["date", "purpose", "vehicle", "driver", "planned", "status"].includes(rawSort ?? "") ? rawSort as FleetReportSortField : null
  return {
    view: rawView === "records" ? "records" : "analysis",
    dimension: rawDimension === "drivers" ? "drivers" : "vehicles",
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    search: searchParams.get("fleetSearch")?.trim() ?? "",
    status: fleetReportRecordsStatusFilters.includes(rawStatus as FleetReportRecordsStatusFilter) ? rawStatus as FleetReportRecordsStatusFilter : "all",
    sort: validSort ? { field: validSort, direction: searchParams.get("fleetDir") === "desc" ? "desc" : "asc" } : null,
  }
}

export function setFleetReportWorkspace(current: URLSearchParams, nextState: Partial<Pick<FleetReportWorkspaceState, "view" | "dimension" | "search" | "status" | "sort">>) {
  const next = new URLSearchParams(current)
  if (nextState.view) {
    if (nextState.view === "analysis") next.delete("fleetView")
    else next.set("fleetView", nextState.view)
  }
  if (nextState.dimension) {
    if (nextState.dimension === "vehicles") next.delete("fleetDimension")
    else next.set("fleetDimension", nextState.dimension)
  }
  if (nextState.search !== undefined) { if (nextState.search.trim()) next.set("fleetSearch", nextState.search.trim()); else next.delete("fleetSearch") }
  if (nextState.status !== undefined) { if (nextState.status === "all") next.delete("fleetStatus"); else next.set("fleetStatus", nextState.status) }
  if (nextState.sort !== undefined) { if (nextState.sort) { next.set("fleetSort", nextState.sort.field); next.set("fleetDir", nextState.sort.direction) } else { next.delete("fleetSort"); next.delete("fleetDir") } }
  next.delete("fleetPage")
  return next
}

export function setFleetReportPage(current: URLSearchParams, page: number) {
  const next = new URLSearchParams(current)
  if (page <= 1) next.delete("fleetPage")
  else next.set("fleetPage", String(page))
  return next
}

export function getRelatedRecordLabel(assignment: PlannedTransportAssignment, meetings: Meeting[], visits: Visit[]): string {
  if (assignment.relatedMeetingId) {
    const meeting = meetings.find((item) => item.id === assignment.relatedMeetingId)
    return meeting ? `Toplantı · ${meeting.hostEmployeeName}` : "—"
  }
  if (assignment.relatedVisitId) {
    const visit = visits.find((item) => item.id === assignment.relatedVisitId)
    return visit ? `Ziyaret · ${visit.visitor.firstName} ${visit.visitor.lastName}` : "—"
  }
  return "—"
}

export function paginateFleetReport(assignments: PlannedTransportAssignment[], page: number, pageSize = FLEET_REPORT_PAGE_SIZE) {
  return paginate(assignments, page, pageSize)
}

export function getFleetReportPageCount(total: number, pageSize = FLEET_REPORT_PAGE_SIZE) {
  return getPageCountShared(total, pageSize)
}

export function getVisibleFleetReportPageNumbers(page: number, pageCount: number) {
  const start = Math.max(1, Math.min(page - 1, pageCount - 2))
  return Array.from({ length: Math.min(3, pageCount) }, (_, index) => start + index)
}
