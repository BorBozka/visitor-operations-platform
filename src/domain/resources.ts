export const resourceTypes = ["ROOM", "POOLED_EQUIPMENT", "VEHICLE", "DRIVER"] as const

export type ResourceType = (typeof resourceTypes)[number]

interface ResourceBase {
  id: string
  type: ResourceType
  companyId: string
  companyName: string
  facilityId: string
  facilityName: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface RoomResource extends ResourceBase {
  type: "ROOM"
  name: string
}

export interface PooledEquipmentResource extends ResourceBase {
  type: "POOLED_EQUIPMENT"
  name: string
  totalQuantity: number
}

export interface VehicleResource extends ResourceBase {
  type: "VEHICLE"
  brand: string
  model: string
  licensePlate: string
}

export interface DriverResource extends ResourceBase {
  type: "DRIVER"
  fullName: string
  licenseClasses: string[]
  documents: string[]
  canDriveCommercialVehicles: boolean
}

export type FacilityResource = RoomResource | PooledEquipmentResource | VehicleResource | DriverResource

interface ResourceInputBase {
  type: ResourceType
  companyId: string
  facilityId: string
}

export interface RoomResourceInput extends ResourceInputBase {
  type: "ROOM"
  name: string
}

export interface PooledEquipmentResourceInput extends ResourceInputBase {
  type: "POOLED_EQUIPMENT"
  name: string
  totalQuantity: number
}

export interface VehicleResourceInput extends ResourceInputBase {
  type: "VEHICLE"
  brand: string
  model: string
  licensePlate: string
}

export interface DriverResourceInput extends ResourceInputBase {
  type: "DRIVER"
  fullName: string
  licenseClasses: string[]
  documents: string[]
  canDriveCommercialVehicles: boolean
}

export type ResourceInput = RoomResourceInput | PooledEquipmentResourceInput | VehicleResourceInput | DriverResourceInput

export const resourceTypeLabels: Record<ResourceType, string> = {
  ROOM: "Oda",
  POOLED_EQUIPMENT: "Ekipman havuzu",
  VEHICLE: "Araç",
  DRIVER: "Şoför",
}

export function getResourceDisplayName(resource: FacilityResource | ResourceInput) {
  switch (resource.type) {
    case "ROOM":
    case "POOLED_EQUIPMENT":
      return resource.name
    case "VEHICLE":
      return `${resource.brand} ${resource.model}`.trim()
    case "DRIVER":
      return resource.fullName
  }
}

// ---------------------------------------------------------------------------
// Resource Assignments
// Stored records retain immutable identity details for historical projection.
// ---------------------------------------------------------------------------

interface ResourceAssignmentSnapshot {
  resourceName: string
  companyId: string
  facilityId: string
}

export interface RoomAssignment extends ResourceAssignmentSnapshot {
  id: string
  meetingId: string
  /** Live catalog reference; null once that Resource was deleted. resourceName still applies. */
  resourceId: string | null
  resourceType: "ROOM"
  createdAt: string
}

export interface EquipmentAssignment extends ResourceAssignmentSnapshot {
  id: string
  meetingId: string
  /** Live catalog reference; null once that Resource was deleted. resourceName still applies. */
  resourceId: string | null
  resourceType: "POOLED_EQUIPMENT"
  totalQuantity: number
  requestedQuantity: number
  createdAt: string
}

export type ResourceAssignment = RoomAssignment | EquipmentAssignment

// Input types for assignment operations
export interface AssignRoomInput {
  resourceId: string
}

export interface AssignEquipmentInput {
  resourceId: string
  requestedQuantity: number
}

// Projected views are served from the immutable assignment snapshot.
export type RoomAssignmentView = RoomAssignment

export type EquipmentAssignmentView = EquipmentAssignment

export type ResourceAssignmentView = RoomAssignmentView | EquipmentAssignmentView

// Availability information returned for the eligible-resource selectors
export interface RoomAvailabilityInfo {
  resource: RoomResource
  isAvailable: boolean
  conflictReason?: string
}

export interface EquipmentAvailabilityInfo {
  resource: PooledEquipmentResource
  usedQuantity: number
  remainingQuantity: number
}

/**
 * The complete desired resource state the Manager wants to persist for a Meeting.
 * Sent to saveMeetingAssignments for atomic validation and replacement.
 */
export interface DesiredResourceState {
  /** null means remove any existing room assignment. */
  roomResourceId: string | null
  /** Each entry is a unique resourceId + positive quantity. */
  equipment: { resourceId: string; requestedQuantity: number }[]
}
