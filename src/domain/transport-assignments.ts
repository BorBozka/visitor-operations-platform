import type { DriverResource, VehicleResource } from "@/domain/resources"

export interface PlannedTransportAssignment {
  id: string
  companyId: string
  companyName: string
  facilityId: string
  facilityName: string
  plannedStart: string
  plannedEnd: string
  purpose: string
  // vehicleName/vehicleLicensePlate/driverName are the historical snapshot and always present;
  // the two resource ids are live catalog references and are null once that Resource was deleted.
  vehicleResourceId: string | null
  vehicleName: string
  vehicleLicensePlate: string
  driverResourceId: string | null
  driverName: string
  relatedMeetingId?: string
  relatedVisitId?: string
  status: "ACTIVE" | "CANCELLED"
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
