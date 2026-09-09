import type { FacilityResource, ResourceInput } from "../modules/resources/types.js"

export interface ResourceRepository {
  list(filters: { includeInactive: boolean; companyId?: string; facilityId?: string; type?: string }): Promise<FacilityResource[]>
  find(id: string): Promise<FacilityResource | null>
  save(input: ResourceInput, id?: string, active?: boolean): Promise<FacilityResource>
  setActive(id: string, active: boolean): Promise<FacilityResource>
  /**
   * Hard delete, including owned driver license-class / document sub-rows. Historical assignment
   * rows survive with their catalog reference nulled. Resolves `false` — without deleting
   * anything — when the resource is still held by a live operation; that check runs inside the
   * delete transaction, so it cannot be raced by a concurrent booking.
   */
  delete(id: string): Promise<boolean>
  companyAndFacilityExist(companyId: string, facilityId: string): Promise<boolean>
  findVehicleByCompanyAndPlate(companyId: string, licensePlate: string, excludeId?: string): Promise<FacilityResource | null>
}
