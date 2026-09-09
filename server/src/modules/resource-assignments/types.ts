import type { PooledEquipmentResource, RoomResource } from "../resources/types.js"

// Immutable assignment snapshot. Historical projections are produced entirely from these
// stored values, so a later rename/deactivate/delete of the catalog resource never rewrites
// what a past Meeting assignment showed. `resourceId` is the live catalog reference only, and is
// null once that Resource has been hard-deleted; the snapshot fields below still describe it.
export interface RoomAssignmentView {
  id: string
  meetingId: string
  resourceId: string | null
  resourceType: "ROOM"
  resourceName: string
  companyId: string
  facilityId: string
  createdAt: string
}

export interface EquipmentAssignmentView {
  id: string
  meetingId: string
  resourceId: string | null
  resourceType: "POOLED_EQUIPMENT"
  resourceName: string
  companyId: string
  facilityId: string
  totalQuantity: number
  requestedQuantity: number
  createdAt: string
}

export type ResourceAssignmentView = RoomAssignmentView | EquipmentAssignmentView

export interface AssignRoomInput {
  resourceId: string
}

export interface AssignEquipmentInput {
  resourceId: string
  requestedQuantity: number
}

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
 * Complete desired resource state for a Meeting. `roomResourceId: null` means "no room".
 * Every equipment entry must have a unique resourceId and a positive integer quantity.
 */
export interface DesiredResourceState {
  roomResourceId: string | null
  equipment: { resourceId: string; requestedQuantity: number }[]
}
