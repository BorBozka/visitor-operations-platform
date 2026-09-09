import type { ResourceRepository } from "../../../repositories/resource-repository.js"
import type { FacilityResource, ResourceInput } from "../types.js"

const clone = <T>(value: T): T => structuredClone(value)
export class InMemoryResourceRepository implements ResourceRepository {
  private resources: FacilityResource[]; private sequence = 0
  constructor(resources: FacilityResource[] = [], private readonly validScopes: { companyId: string; facilityId: string }[] = [], private readonly liveReferenceIds: string[] = []) { this.resources = clone(resources) }
  async list(filters: { includeInactive: boolean; companyId?: string; facilityId?: string; type?: string }) { return clone(this.resources.filter((resource) => (filters.includeInactive || resource.isActive) && (!filters.companyId || resource.companyId === filters.companyId) && (!filters.facilityId || resource.facilityId === filters.facilityId) && (!filters.type || resource.type === filters.type))) }
  async find(id: string) { const resource = this.resources.find((candidate) => candidate.id === id); return resource ? clone(resource) : null }
  async save(input: ResourceInput, id?: string, active = true) {
    const old = id ? this.resources.find((candidate) => candidate.id === id) : undefined
    const now = new Date("2026-01-01T00:00:00.000Z").toISOString()
    const base = { id: id ?? `resource-${++this.sequence}`, companyId: input.companyId, facilityId: input.facilityId, companyName: input.companyId, facilityName: input.facilityId, isActive: active, createdAt: old?.createdAt ?? now, updatedAt: now }
    const resource: FacilityResource = input.type === "ROOM" ? { ...base, type: "ROOM", name: input.name }
      : input.type === "POOLED_EQUIPMENT" ? { ...base, type: "POOLED_EQUIPMENT", name: input.name, totalQuantity: input.totalQuantity }
        : input.type === "VEHICLE" ? { ...base, type: "VEHICLE", brand: input.brand, model: input.model, licensePlate: input.licensePlate }
          : { ...base, type: "DRIVER", fullName: input.fullName, licenseClasses: input.licenseClasses, documents: input.documents, canDriveCommercialVehicles: input.canDriveCommercialVehicles }
    this.resources = old ? this.resources.map((candidate) => candidate.id === id ? resource : candidate) : [...this.resources, resource]
    return clone(resource)
  }
  async setActive(id: string, active: boolean) { const old = await this.find(id); if (!old) throw new Error("Resource not found"); const updated = { ...old, isActive: active }; this.resources = this.resources.map((candidate) => candidate.id === id ? updated : candidate); return updated }
  /** `liveReferenceIds` stands in for the repository's in-transaction live-reference check. */
  async delete(id: string) { if (this.liveReferenceIds.includes(id)) return false; this.resources = this.resources.filter((candidate) => candidate.id !== id); return true }
  async companyAndFacilityExist(companyId: string, facilityId: string) { return this.validScopes.some((scope) => scope.companyId === companyId && scope.facilityId === facilityId) }
  async findVehicleByCompanyAndPlate(companyId: string, licensePlate: string, excludeId?: string) { const resource = this.resources.find((candidate) => candidate.id !== excludeId && candidate.type === "VEHICLE" && candidate.companyId === companyId && candidate.licensePlate === licensePlate); return resource ? clone(resource) : null }
}
