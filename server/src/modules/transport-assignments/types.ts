import type { DriverResource, VehicleResource } from "../resources/types.js"

export const transportAssignmentStatuses = ["ACTIVE", "CANCELLED"] as const
export type TransportAssignmentStatus = (typeof transportAssignmentStatuses)[number]

/**
 * Historical projection. vehicleName/vehicleLicensePlate/driverName are the authoritative snapshot;
 * the two resource ids are live catalog references and are null once that Resource was deleted.
 */
export interface PlannedTransportAssignmentDto {
  id: string
  companyId: string
  companyName: string
  facilityId: string
  facilityName: string
  plannedStart: string
  plannedEnd: string
  purpose: string
  vehicleResourceId: string | null
  vehicleName: string
  vehicleLicensePlate: string
  driverResourceId: string | null
  driverName: string
  relatedMeetingId?: string
  relatedVisitId?: string
  status: TransportAssignmentStatus
  createdAt: string
}

export interface CreatePlannedTransportAssignmentInput {
  companyId: string
  facilityId: string
  plannedStart: string
  plannedEnd: string
  purpose: string
  vehicleResourceId: string
  driverResourceId: string
  relatedMeetingId?: string
  relatedVisitId?: string
}

export interface TransportAvailabilityInput {
  companyId: string
  facilityId: string
  plannedStart: string
  plannedEnd: string
  excludeAssignmentId?: string
}

export interface TransportAvailability {
  vehicles: VehicleResource[]
  drivers: DriverResource[]
}
