import { describe, expect, it } from "vitest"

import type { Visit } from "@/domain/visits"
import {
  ALL_VISITS_PAGE_SIZE,
  clearAllVisitsSearchParams,
  countVisitsWithAdditionalRequirements,
  filterAndSortVisits,
  getFacilitiesForCompany,
  getPageCount,
  paginateVisits,
  parseAllVisitsQuery,
  setAllVisitsRange,
  toggleVisitSort,
  updateAllVisitsSearchParams,
  type AllVisitsFilters,
  type VisitSort,
  type VisitSortField,
} from "@/features/manager/all-visits-utils"
import { visitReferenceDataFixture } from "@/test/fixtures/visit-reference-data"

const baseFilters: AllVisitsFilters = {
  search: "",
  startDate: "",
  endDate: "",
  companyId: "all",
  facilityId: "all",
  status: "all",
  visitTypeId: "all",
  hostEmployeeId: "all",
  additionalRequirement: "all",
}

const visits = [
  visit("1", "2026-08-10T08:00:00+03:00", { firstName: "Ayşe", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", visitorCompany: "Vega Endüstri" }),
  visit("2", "2026-08-11T10:00:00+03:00", { firstName: "Bora", companyId: "bplas", facilityId: "bplas-arge", employeeId: "emre-yilmaz", invitationStatus: "FAILED", hasAdditionalRequirements: true, visitorCompany: "Akın Tedarik" }),
  visit("3", "2026-08-12T12:00:00+03:00", { firstName: "Ceren", companyId: "bplas-otomotiv", facilityId: "otomotiv-uretim", employeeId: "selin-aydin", status: "CHECKED_IN", typeId: "audit", hasAdditionalRequirements: true, visitorCompany: "Marmara Lojistik" }),
  visit("4", "2026-08-13T09:00:00+03:00", { firstName: "Deniz", companyId: "bplas", facilityId: "bplas-merkez", employeeId: "maya-kara", invitationStatus: "NOT_SENT", hasAdditionalRequirements: true, visitorCompany: "Doğuş Mühendislik" }),
]

describe("all visits operations", () => {
  it("searches visitor, host, company and facility values", () => {
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, search: "Ayşe" }))).toEqual(["1"])
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, search: "Emre" }))).toEqual(["2"])
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, search: "Otomotiv" }))).toEqual(["3"])
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, search: "Ar-Ge" }))).toEqual(["2"])
  })

  it("uses inclusive local start and end date boundaries", () => {
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, startDate: "2026-08-11" }))).toEqual(["2", "3"])
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, endDate: "2026-08-11" }))).toEqual(["1", "2"])
    expect(filterAndSortVisits(visits, { ...baseFilters, startDate: "2026-08-12", endDate: "2026-08-10" })).toEqual([])
  })

  it("keeps facilities within the selected company", () => {
    expect(getFacilitiesForCompany(visitReferenceDataFixture, "bplas").map((facility) => facility.id)).toEqual(["bplas-merkez", "bplas-arge"])
    expect(parseAllVisitsQuery(new URLSearchParams("company=bplas&facility=otomotiv-uretim"), visitReferenceDataFixture).filters.facilityId).toBe("all")
  })

  it("filters status, visit type and additional requirement independently", () => {
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, status: "CHECKED_IN" }))).toEqual(["3"])
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, visitTypeId: "audit" }))).toEqual(["3"])
    expect(ids(filterAndSortVisits(visits, { ...baseFilters, additionalRequirement: "with" }))).toEqual(["2", "3"])
  })

  it("excludes visits whose invitation has not been sent from the operations list", () => {
    expect(ids(filterAndSortVisits(visits, baseFilters))).toEqual(["1", "2", "3"])
    expect(filterAndSortVisits(visits, { ...baseFilters, search: "Deniz" })).toEqual([])
  })

  it.each<VisitSortField>(["visitor", "visitorCompany", "visitType", "host", "companyFacility", "plannedStart", "status"])("cycles %s through asc, desc and removed without clearing other sorts", (field) => {
    const existing: VisitSort = field === "plannedStart"
      ? { field: "visitor", direction: "asc" }
      : { field: "plannedStart", direction: "asc" }
    let sorts: VisitSort[] = [existing]

    sorts = toggleVisitSort(sorts, field)
    expect(sorts).toEqual([existing, { field, direction: "asc" }])

    sorts = toggleVisitSort(sorts, field)
    expect(sorts).toEqual([existing, { field, direction: "desc" }])

    sorts = toggleVisitSort(sorts, field)
    expect(sorts).toEqual([existing])
  })

  it("sorts visit type, host, company/facility and status within active priorities", () => {
    expect(ids(filterAndSortVisits(visits, baseFilters, [{ field: "visitorCompany", direction: "asc" }]))).toEqual(["2", "3", "1"])
    expect(ids(filterAndSortVisits(visits, baseFilters, [{ field: "visitType", direction: "asc" }]))).toEqual(["3", "1", "2"])
    expect(ids(filterAndSortVisits(visits, baseFilters, [{ field: "host", direction: "asc" }]))).toEqual(["2", "1", "3"])
    expect(ids(filterAndSortVisits(visits, baseFilters, [{ field: "companyFacility", direction: "asc" }]))).toEqual(["2", "1", "3"])
    expect(ids(filterAndSortVisits(visits, baseFilters, [{ field: "status", direction: "asc" }, { field: "host", direction: "desc" }]))).toEqual(["3", "1", "2"])
    expect(ids(filterAndSortVisits(visits, baseFilters, [{ field: "visitType", direction: "asc" }, { field: "host", direction: "desc" }]))).toEqual(["3", "1", "2"])
  })

  it("calculates scope-aware count for visits with additional requirements", () => {
    // Total visits with additional requirements = 2 ("2" and "3")
    expect(countVisitsWithAdditionalRequirements(visits, baseFilters)).toBe(2)

    // Filtered by company "bplas" = only visit "2" has additional requirements
    expect(countVisitsWithAdditionalRequirements(visits, { ...baseFilters, companyId: "bplas" })).toBe(1)

    // Filtered by company "bplas-otomotiv" = only visit "3" has additional requirements
    expect(countVisitsWithAdditionalRequirements(visits, { ...baseFilters, companyId: "bplas-otomotiv" })).toBe(1)

    // Even when additionalRequirement is active ("with"), scope count remains stable (2)
    expect(countVisitsWithAdditionalRequirements(visits, { ...baseFilters, additionalRequirement: "with" })).toBe(2)
  })

  it("resets the page when a filter changes and clears known filters", () => {
    const changed = updateAllVisitsSearchParams(new URLSearchParams("page=3&status=PLANNED&invitation=FAILED&custom=kept"), "company", "bplas")
    expect(changed.get("page")).toBeNull()
    expect(changed.get("company")).toBe("bplas")
    expect(changed.get("custom")).toBe("kept")
    expect(clearAllVisitsSearchParams(changed).toString()).toBe("custom=kept")
  })

  it("sets both operational quick-range boundaries without applying report clamping", () => {
    const changed = setAllVisitsRange(new URLSearchParams("page=3&date=2026-08-01&custom=kept"), "2099-01-10", "2099-01-20")
    expect(changed.get("from")).toBe("2099-01-10")
    expect(changed.get("to")).toBe("2099-01-20")
    expect(changed.get("date")).toBeNull()
    expect(changed.get("page")).toBeNull()
    expect(changed.get("custom")).toBe("kept")
  })

  it("paginates 58 records into viewport-friendly pages", () => {
    const records = Array.from({ length: 58 }, (_, index) => ({ id: String(index) }))
    expect(ALL_VISITS_PAGE_SIZE).toBe(9)
    expect(getPageCount(records.length)).toBe(7)
    expect(paginateVisits(records as Visit[], 1)).toHaveLength(9)
    expect(paginateVisits(records as Visit[], 7)).toHaveLength(4)
  })

  it("supports legacy dashboard date/status params and ignores invalid values", () => {
    const legacy = parseAllVisitsQuery(new URLSearchParams("date=2026-08-11&status=PLANNED"), visitReferenceDataFixture)
    expect(legacy.filters).toMatchObject({ startDate: "2026-08-11", endDate: "2026-08-11", status: "PLANNED" })

    const invalid = parseAllVisitsQuery(new URLSearchParams("date=bad&status=UNKNOWN&company=missing&page=-4"), visitReferenceDataFixture)
    expect(invalid.filters).toMatchObject({ startDate: "", endDate: "", status: "all", companyId: "all" })
    expect(invalid.page).toBe(1)

    const staleInvitation = parseAllVisitsQuery(new URLSearchParams("invitation=FAILED"), visitReferenceDataFixture)
    expect(staleInvitation.filters).not.toHaveProperty("invitationStatus")
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
  typeId?: string
  invitationStatus?: Visit["invitationStatus"]
  hasAdditionalRequirements?: boolean
  visitorCompany?: string
}): Visit {
  const company = visitReferenceDataFixture.companies.find((item) => item.id === overrides.companyId)!
  const facility = visitReferenceDataFixture.facilities.find((item) => item.id === overrides.facilityId)!
  const employee = visitReferenceDataFixture.employees.find((item) => item.id === overrides.employeeId)!
  const typeId = overrides.typeId ?? "meeting"
  const type = visitReferenceDataFixture.visitTypes.find((item) => item.id === typeId)!
  return {
    id,
    meetingId: `meeting-${id}`,
    creatorEmployeeId: "creator-1",
    visitor: { id: `visitor-${id}`, firstName: overrides.firstName, lastName: "Test", email: `${id}@example.com`, company: overrides.visitorCompany ?? "Test A.Ş." },
    visitTypeId: typeId,
    visitTypeName: type.name,
    hostEmployeeId: employee.id,
    hostEmployeeName: employee.name,
    hostCompanyId: company.id,
    hostCompanyName: company.name,
    facilityId: facility.id,
    facilityName: facility.name,
    plannedStart,
    plannedEnd: plannedStart,
    status: overrides.status ?? "PLANNED",
    invitationStatus: overrides.invitationStatus ?? "SENT",
    hasAdditionalRequirements: overrides.hasAdditionalRequirements ?? false,
    createdAt: plannedStart,
    updatedAt: plannedStart,
  }
}
