import { describe, expect, it } from "vitest"

import type { FacilityResource } from "@/domain/resources"
import {
  defaultResourceFilters,
  filterResources,
  getResourcePageCount,
  getVisibleResourcePageNumbers,
  paginateResources,
  RESOURCE_PAGE_SIZE,
  sortResources,
  toggleResourceSort,
} from "@/features/resources/resource-filters"

const baseResource = {
  companyId: "bplas",
  companyName: "BPLAS A.Ş.",
  facilityId: "bplas-merkez",
  facilityName: "Merkez Tesis",
  isActive: true,
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
}

const resourceFixtures: FacilityResource[] = [
  { ...baseResource, id: "room-merkez", type: "ROOM", name: "Atlas Toplantı Odası" },
  { ...baseResource, id: "equipment-merkez", type: "POOLED_EQUIPMENT", name: "Notebook Havuzu", totalQuantity: 4 },
  { ...baseResource, id: "equipment-arge", type: "POOLED_EQUIPMENT", name: "Projektör Havuzu", facilityId: "bplas-arge", facilityName: "Ar-Ge Merkezi", totalQuantity: 2, isActive: false },
  { ...baseResource, id: "vehicle-transit", type: "VEHICLE", brand: "Ford", model: "Transit", licensePlate: "16 BPL 101" },
  { ...baseResource, id: "vehicle-megane", type: "VEHICLE", brand: "Renault", model: "Megane", licensePlate: "16 BPL 202", companyId: "bplas-otomotiv", companyName: "BPLAS Otomotiv A.Ş.", facilityId: "otomotiv-uretim", facilityName: "Üretim Tesisi", isActive: false },
  { ...baseResource, id: "driver-ayse", type: "DRIVER", fullName: "Ayşe Demir", licenseClasses: ["B"], documents: [], canDriveCommercialVehicles: false },
  { ...baseResource, id: "driver-mehmet", type: "DRIVER", fullName: "Mehmet Kaya", licenseClasses: ["B"], documents: [], canDriveCommercialVehicles: false, facilityId: "bplas-arge", facilityName: "Ar-Ge Merkezi" },
]

describe("resource catalog filters", () => {
  it("combines company, facility, type, and active filters", () => {
    const result = filterResources(resourceFixtures, {
      ...defaultResourceFilters,
      companyId: "bplas",
      facilityId: "bplas-arge",
      type: "POOLED_EQUIPMENT",
      active: "inactive",
    })

    expect(result.map((resource) => resource.id)).toEqual(["equipment-arge"])
  })

  it("filters resources by search query across name, company, facility, and details", () => {
    expect(filterResources(resourceFixtures, { ...defaultResourceFilters, search: "Transit" }).map((resource) => resource.id)).toEqual(["vehicle-transit"])
    expect(filterResources(resourceFixtures, { ...defaultResourceFilters, search: "Ayşe" }).map((resource) => resource.id)).toEqual(["driver-ayse"])
  })

  it("returns every resource for default filters", () => {
    expect(filterResources(resourceFixtures, defaultResourceFilters)).toHaveLength(resourceFixtures.length)
  })

  it("sorts resources in ascending groups by the selected column", () => {
    expect(sortResources(resourceFixtures, [{ field: "type", direction: "asc" }]).map((resource) => resource.type)).toEqual([
      "DRIVER", "DRIVER",
      "POOLED_EQUIPMENT", "POOLED_EQUIPMENT",
      "ROOM",
      "VEHICLE", "VEHICLE",
    ])
    expect(sortResources(resourceFixtures, [{ field: "status", direction: "asc" }]).map((resource) => resource.isActive)).toEqual([false, false, true, true, true, true, true])
  })

  it("cycles individual sorts without clearing other sort fields", () => {
    const first = toggleResourceSort([], "type")
    const second = toggleResourceSort(first, "status")
    const third = toggleResourceSort(second, "type")

    expect(first).toEqual([{ field: "type", direction: "asc" }])
    expect(second).toEqual([{ field: "type", direction: "asc" }, { field: "status", direction: "asc" }])
    expect(third).toEqual([{ field: "type", direction: "desc" }, { field: "status", direction: "asc" }])
    expect(toggleResourceSort(third, "type")).toEqual([{ field: "status", direction: "asc" }])
  })

  it("uses later active sorts inside equal primary-column groups", () => {
    const room = resourceFixtures.find((resource) => resource.type === "ROOM")!
    const equipment = resourceFixtures.find((resource) => resource.type === "POOLED_EQUIPMENT")!
    const resources = [
      { ...room, id: "room-active", isActive: true },
      { ...room, id: "room-inactive", isActive: false },
      { ...equipment, id: "equipment-active", isActive: true },
    ]

    expect(sortResources(resources, [
      { field: "type", direction: "asc" },
      { field: "status", direction: "asc" },
    ]).map((resource) => resource.id)).toEqual(["equipment-active", "room-inactive", "room-active"])
  })

  it.each([
    { type: "VEHICLE" as const, ids: ["vehicle-transit", "vehicle-megane"] },
    { type: "DRIVER" as const, ids: ["driver-ayse", "driver-mehmet"] },
  ])("filters $type resources", ({ type, ids }) => {
    expect(filterResources(resourceFixtures, { ...defaultResourceFilters, type }).map((resource) => resource.id)).toEqual(ids)
  })

  it("combines organization, driver type, and active status filters", () => {
    const result = filterResources(resourceFixtures, {
      ...defaultResourceFilters,
      companyId: "bplas",
      facilityId: "bplas-merkez",
      type: "DRIVER",
      active: "active",
    })

    expect(result.map((resource) => resource.id)).toEqual(["driver-ayse"])
  })

  it.each([
    { total: 0, expected: 1 },
    { total: 1, expected: 1 },
    { total: 8, expected: 1 },
    { total: 9, expected: 1 },
    { total: 28, expected: 4 },
  ])("calculates a viewport-friendly page count for $total resources", ({ total, expected }) => {
    expect(RESOURCE_PAGE_SIZE).toBe(9)
    expect(getResourcePageCount(total)).toBe(expected)
  })

  it("paginates resources and limits the visible page controls", () => {
    const resources = Array.from({ length: 20 }, (_, index) => ({
      ...resourceFixtures[index % resourceFixtures.length],
      id: `resource-${index}`,
    }))

    expect(paginateResources(resources, 1)).toHaveLength(9)
    expect(paginateResources(resources, 3)).toHaveLength(2)
    expect(getVisibleResourcePageNumbers(3, 5)).toEqual([2, 3, 4])
  })
})
