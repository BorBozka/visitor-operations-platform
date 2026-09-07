import { describe, expect, it } from "vitest"

import type { PlannedTransportAssignment } from "@/domain/transport-assignments"
import type { Meeting, Visit } from "@/domain/visits"
import type { ReportsScopeFilters } from "@/features/reports/reports-filters"
import {
  aggregateFleetResourceLoad,
  buildFleetMetadata,
  calculateFleetReportMetrics,
  filterFleetReportRecordsByStatus,
  filterAssignmentsForReport,
  FLEET_CATEGORY_AXIS_WIDTH,
  FLEET_REPORT_PAGE_SIZE,
  getFleetCategoryAxisWidth,
  getFleetMetricDeltaTone,
  getFleetReportPageCount,
  getNiceFleetDurationScale,
  getRelatedRecordLabel,
  isFleetRecordActivationKey,
  mergeFleetLoadComparison,
  paginateFleetReport,
  parseFleetReportWorkspace,
  setFleetReportPage,
  setFleetReportWorkspace,
  searchFleetReportRecords,
  sortFleetReportRecords,
  sortFleetLoadResources,
} from "@/features/reports/fleet-report-utils"

const baseFilters: ReportsScopeFilters = { startDate: "", endDate: "", companyId: "all", facilityId: "all" }

const reportAssignments = [
  assignment("a1", { plannedStart: "2026-08-10T08:00:00+03:00", plannedEnd: "2026-08-10T10:00:00+03:00", vehicleResourceId: "vehicle-transit", vehicleName: "Ford Transit", driverResourceId: "driver-ayse", driverName: "Ayşe Demir" }),
  assignment("a2", { plannedStart: "2026-08-10T11:00:00+03:00", plannedEnd: "2026-08-10T12:30:00+03:00", vehicleResourceId: "vehicle-transit", vehicleName: "Ford Transit", driverResourceId: "driver-ayse", driverName: "Ayşe Demir" }),
  assignment("a3", { plannedStart: "2026-08-11T08:00:00+03:00", plannedEnd: "2026-08-11T09:00:00+03:00", vehicleResourceId: "vehicle-sprinter", vehicleName: "Mercedes Sprinter", driverResourceId: "driver-zeynep", driverName: "Zeynep Arslan" }),
  assignment("a4", { plannedStart: "2026-08-12T08:00:00+03:00", plannedEnd: "2026-08-12T12:00:00+03:00", vehicleResourceId: "vehicle-cancelled", vehicleName: "İptal Araç", driverResourceId: "driver-cancelled", driverName: "İptal Şoför", status: "CANCELLED", companyId: "bplas-otomotiv", facilityId: "otomotiv-uretim" }),
]

describe("fleet report filtering and metrics", () => {
  it("applies date/company/facility filters and keeps records newest-first", () => {
    expect(ids(filterAssignmentsForReport(reportAssignments, baseFilters))).toEqual(["a4", "a3", "a2", "a1"])
    expect(ids(filterAssignmentsForReport(reportAssignments, { ...baseFilters, startDate: "2026-08-10", endDate: "2026-08-11" }))).toEqual(["a3", "a2", "a1"])
    expect(ids(filterAssignmentsForReport(reportAssignments, { ...baseFilters, companyId: "bplas-otomotiv" }))).toEqual(["a4"])
    expect(filterAssignmentsForReport(reportAssignments, { ...baseFilters, startDate: "2026-08-13", endDate: "2026-08-10" })).toEqual([])
  })

  it("counts cancelled assignments in metadata but excludes them from planned load", () => {
    expect(calculateFleetReportMetrics(reportAssignments)).toEqual({ totalAssignments: 4, cancelledAssignments: 1, plannedLoadMinutes: 270, usedVehicleCount: 2, usedDriverCount: 2 })
  })

  it("keeps an empty dataset safe", () => {
    expect(calculateFleetReportMetrics([])).toEqual({ totalAssignments: 0, cancelledAssignments: 0, plannedLoadMinutes: 0, usedVehicleCount: 0, usedDriverCount: 0 })
  })
})

describe("fleet records search and sort", () => {
  it("finds vehicle, plate, driver and purpose text case-insensitively", () => {
    expect(ids(searchFleetReportRecords(reportAssignments, "ayşe"))).toEqual(["a1", "a2"])
    expect(ids(searchFleetReportRecords(reportAssignments, "İPTAL ARAÇ"))).toEqual(["a4"])
    expect(searchFleetReportRecords(reportAssignments, "")).toHaveLength(4)
  })

  it("sorts records deterministically and returns to default order when cleared", () => {
    expect(ids(sortFleetReportRecords(reportAssignments, { field: "driver", direction: "asc" }))).toEqual(["a1", "a2", "a4", "a3"])
    expect(ids(sortFleetReportRecords(reportAssignments, { field: "date", direction: "desc" }))).toEqual(["a4", "a3", "a2", "a1"])
    expect(sortFleetReportRecords(reportAssignments, null)).toEqual(reportAssignments)
  })
})

describe("fleet resource load aggregation", () => {
  it("groups vehicle load by immutable vehicle resource ID", () => {
    expect(aggregateFleetResourceLoad(reportAssignments, "vehicles")).toEqual([
      { resourceId: "vehicle-transit", resourceName: "Ford Transit", plannedMinutes: 210, assignmentCount: 2 },
      { resourceId: "vehicle-sprinter", resourceName: "Mercedes Sprinter", plannedMinutes: 60, assignmentCount: 1 },
    ])
  })

  it("groups driver load separately and excludes cancelled resource load", () => {
    expect(aggregateFleetResourceLoad(reportAssignments, "drivers")).toEqual([
      { resourceId: "driver-ayse", resourceName: "Ayşe Demir", plannedMinutes: 210, assignmentCount: 2 },
      { resourceId: "driver-zeynep", resourceName: "Zeynep Arslan", plannedMinutes: 60, assignmentCount: 1 },
    ])
  })

  it("sorts deterministically by duration, assignment count, then resource name", () => {
    expect(sortFleetLoadResources([
      { resourceId: "z", resourceName: "Zeynep", plannedMinutes: 60, assignmentCount: 1 },
      { resourceId: "a", resourceName: "Ayşe", plannedMinutes: 60, assignmentCount: 1 },
      { resourceId: "many", resourceName: "Mert", plannedMinutes: 60, assignmentCount: 2 },
    ]).map((resource) => resource.resourceId)).toEqual(["many", "a", "z"])
  })

  it("merges current and previous resource sets with zero counterparts", () => {
    const current = aggregateFleetResourceLoad(reportAssignments.slice(0, 2), "vehicles")
    const previous = aggregateFleetResourceLoad(reportAssignments.slice(2, 3), "vehicles")
    expect(mergeFleetLoadComparison(current, previous)).toEqual([
      { resourceId: "vehicle-transit", resourceName: "Ford Transit", plannedMinutes: 210, assignmentCount: 2, previousPlannedMinutes: 0, previousAssignmentCount: 0 },
      { resourceId: "vehicle-sprinter", resourceName: "Mercedes Sprinter", plannedMinutes: 0, assignmentCount: 0, previousPlannedMinutes: 60, previousAssignmentCount: 1 },
    ])
  })
})

describe("fleet metadata and delta tone", () => {
  const current = calculateFleetReportMetrics(reportAssignments)
  const previous = calculateFleetReportMetrics(reportAssignments.slice(0, 2))

  it("formats absolute, non-percentage metadata deltas", () => {
    expect(buildFleetMetadata(current, previous)).toBe("4 görev +2 · 1 iptal +1 · 4 sa 30 dk planlama yükü +1 sa · 2 araç +1 · 2 şoför +1")
  })

  it("uses the same cancelled definition for records filtering and the KPI", () => {
    const scoped = filterAssignmentsForReport(reportAssignments, { ...baseFilters, startDate: "2026-08-12", endDate: "2026-08-12", companyId: "bplas-otomotiv", facilityId: "otomotiv-uretim" })
    const cancelled = filterFleetReportRecordsByStatus(scoped, "cancelled")

    expect(ids(searchFleetReportRecords(cancelled, "iptal"))).toEqual(["a4"])
    expect(calculateFleetReportMetrics(scoped).cancelledAssignments).toBe(cancelled.length)
  })

  it("treats an increase in cancellations as negative while more assignments remain positive", () => {
    expect(getFleetMetricDeltaTone(1, "decrease")).toBe("negative")
    expect(getFleetMetricDeltaTone(-1, "decrease")).toBe("positive")
    expect(getFleetMetricDeltaTone(1, "increase")).toBe("positive")
  })

})

describe("fleet chart scale and interaction helpers", () => {
  it("uses the same fixed category-axis width for vehicle and driver dimensions", () => {
    expect(getFleetCategoryAxisWidth("vehicles")).toBe(FLEET_CATEGORY_AXIS_WIDTH)
    expect(getFleetCategoryAxisWidth("drivers")).toBe(FLEET_CATEGORY_AXIS_WIDTH)
  })

  it("builds human-readable duration ticks and pads the domain for bar-end labels", () => {
    expect(getNiceFleetDurationScale(45, 1)).toEqual({ domainMax: 90, stepMinutes: 30, ticks: [0, 30, 60, 90] })
    expect(getNiceFleetDurationScale(180, 1)).toEqual({ domainMax: 240, stepMinutes: 60, ticks: [0, 60, 120, 180, 240] })
    const longLabelScale = getNiceFleetDurationScale(720, 14)
    expect(longLabelScale.domainMax).toBeGreaterThan(720)
    expect(longLabelScale.ticks).toContain(120)
    expect(longLabelScale.ticks).not.toContain(45)
  })

  it("accepts Enter and Space as row activation keys", () => {
    expect(isFleetRecordActivationKey("Enter")).toBe(true)
    expect(isFleetRecordActivationKey(" ")).toBe(true)
    expect(isFleetRecordActivationKey("Escape")).toBe(false)
  })
})

describe("fleet report URL state and pagination", () => {
  it("defaults invalid workspace parameters and persists non-default state", () => {
    expect(parseFleetReportWorkspace(new URLSearchParams("fleetView=wrong&fleetDimension=wrong&fleetPage=0"))).toEqual({ view: "analysis", dimension: "vehicles", page: 1, search: "", status: "all", sort: null })
    const records = setFleetReportWorkspace(new URLSearchParams("tab=vehicle&granularity=daily&page=3"), { view: "records", dimension: "drivers" })
    expect(records.toString()).toBe("tab=vehicle&granularity=daily&page=3&fleetView=records&fleetDimension=drivers")
    expect(setFleetReportPage(records, 2).toString()).toBe("tab=vehicle&granularity=daily&page=3&fleetView=records&fleetDimension=drivers&fleetPage=2")
    expect(parseFleetReportWorkspace(new URLSearchParams("fleetStatus=cancelled")).status).toBe("cancelled")
    expect(setFleetReportWorkspace(new URLSearchParams("fleetPage=2&fleetSearch=Ford"), { status: "cancelled" }).toString()).toBe("fleetSearch=Ford&fleetStatus=cancelled")
    expect(setFleetReportWorkspace(new URLSearchParams("fleetStatus=cancelled"), { status: "all" }).toString()).toBe("")
  })

  it("ignores visits workspace keys so tab switches cannot overwrite fleet state", () => {
    expect(parseFleetReportWorkspace(new URLSearchParams("view=records&page=4&fleetView=records&fleetPage=3"))).toEqual({ view: "records", dimension: "vehicles", page: 3, search: "", status: "all", sort: null })
  })

  it("uses the fixed eight-row records page size", () => {
    const records = Array.from({ length: 25 }, (_, index) => ({ id: String(index) }))
    expect(FLEET_REPORT_PAGE_SIZE).toBe(8)
    expect(getFleetReportPageCount(records.length)).toBe(4)
    expect(paginateFleetReport(records as PlannedTransportAssignment[], 4)).toHaveLength(1)
  })
})

describe("getRelatedRecordLabel", () => {
  const meetings = [meeting("meeting-1", "Maya Kara")]
  const visits = [visit("visit-1", "Ayşe", "Test")]

  it("resolves related meeting and visit labels without adding a record dialog", () => {
    expect(getRelatedRecordLabel(assignment("meeting", { relatedMeetingId: "meeting-1" }), meetings, visits)).toBe("Toplantı · Maya Kara")
    expect(getRelatedRecordLabel(assignment("visit", { relatedVisitId: "visit-1" }), meetings, visits)).toBe("Ziyaret · Ayşe Test")
    expect(getRelatedRecordLabel(assignment("none"), meetings, visits)).toBe("—")
  })
})

function ids(records: PlannedTransportAssignment[]) { return records.map((record) => record.id) }

function assignment(id: string, overrides: Partial<PlannedTransportAssignment> = {}): PlannedTransportAssignment {
  return { id, companyId: "bplas", companyName: "BPLAS A.Ş.", facilityId: "bplas-merkez", facilityName: "Merkez Tesis", plannedStart: "2026-08-10T08:00:00+03:00", plannedEnd: "2026-08-10T09:00:00+03:00", purpose: "Test görevi", vehicleResourceId: "vehicle-1", vehicleName: "Transit", vehicleLicensePlate: "16 BPL 101", driverResourceId: "driver-1", driverName: "Ayşe Demir", status: "ACTIVE", createdAt: "2026-08-10T08:00:00+03:00", ...overrides }
}

function meeting(id: string, hostEmployeeName: string): Meeting {
  return { id, creatorEmployeeId: "creator-1", visitTypeId: "meeting", visitTypeName: "Toplantı", hostEmployeeId: "host-1", hostEmployeeName, hostCompanyId: "bplas", hostCompanyName: "BPLAS A.Ş.", facilityId: "bplas-merkez", facilityName: "Merkez Tesis", plannedStart: "2026-08-10T08:00:00+03:00", plannedEnd: "2026-08-10T09:00:00+03:00", hasAdditionalRequirements: false, createdAt: "2026-08-10T08:00:00+03:00", updatedAt: "2026-08-10T08:00:00+03:00" }
}

function visit(id: string, firstName: string, lastName: string): Visit {
  return { id, meetingId: `meeting-for-${id}`, creatorEmployeeId: "creator-1", visitor: { id: `visitor-${id}`, firstName, lastName, email: `${id}@example.com`, company: "Test A.Ş." }, visitTypeId: "meeting", visitTypeName: "Toplantı", hostEmployeeId: "host-1", hostEmployeeName: "Maya Kara", hostCompanyId: "bplas", hostCompanyName: "BPLAS A.Ş.", facilityId: "bplas-merkez", facilityName: "Merkez Tesis", plannedStart: "2026-08-10T08:00:00+03:00", plannedEnd: "2026-08-10T09:00:00+03:00", status: "PLANNED", invitationStatus: "SENT", hasAdditionalRequirements: false, createdAt: "2026-08-10T08:00:00+03:00", updatedAt: "2026-08-10T08:00:00+03:00" }
}
