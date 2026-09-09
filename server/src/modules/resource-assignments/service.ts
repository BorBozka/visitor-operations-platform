import { ApiError } from "../../lib/api-error.js"
import { scopeAllows, type AccessContext } from "../../lib/authorization.js"
import {
  assignmentViewsToNew,
  type AssignmentMeetingContext,
  type ResourceAssignmentRepository,
} from "../../repositories/resource-assignment-repository.js"
import type { PooledEquipmentResource, RoomResource } from "../resources/types.js"
import {
  assertAssignmentSetValid,
  assertExtensionConflictFree,
  assertMeetingResourcesMutable,
  computeUsedEquipmentQuantity,
  findRoomConflict,
  formatTimeRange,
  type NewAssignment,
} from "./conflicts.js"
import type {
  AssignEquipmentInput,
  AssignRoomInput,
  DesiredResourceState,
  EquipmentAssignmentView,
  EquipmentAvailabilityInfo,
  ResourceAssignmentView,
  RoomAssignmentView,
  RoomAvailabilityInfo,
} from "./types.js"

export class ResourceAssignmentService {
  constructor(private readonly repository: ResourceAssignmentRepository) {}

  async listAssignmentsForMeeting(meetingId: string, ctx?: AccessContext) {
    if (ctx) await this.loadContext(meetingId, ctx)
    return this.repository.listAssignmentsForMeeting(meetingId)
  }

  async getEligibleRooms(meetingId: string, ctx?: AccessContext): Promise<RoomAvailabilityInfo[]> {
    const context = await this.loadContext(meetingId, ctx)
    return context.eligibleRooms.map((room) => {
      const conflict = findRoomConflict(room.id, context.meeting, context.others)
      return conflict
        ? { resource: room, isAvailable: false, conflictReason: `Bu oda başka bir toplantıyla çakışıyor (${formatTimeRange(conflict)}).` }
        : { resource: room, isAvailable: true }
    })
  }

  async getEligibleEquipment(meetingId: string, ctx?: AccessContext): Promise<EquipmentAvailabilityInfo[]> {
    const context = await this.loadContext(meetingId, ctx)
    return context.eligibleEquipment.map((equipment) => {
      const usedQuantity = computeUsedEquipmentQuantity(equipment.id, context.meeting, context.others)
      return { resource: equipment, usedQuantity, remainingQuantity: equipment.totalQuantity - usedQuantity }
    })
  }

  async assignRoom(meetingId: string, input: AssignRoomInput, ctx?: AccessContext): Promise<RoomAssignmentView> {
    const context = await this.loadContext(meetingId, ctx)
    assertMeetingResourcesMutable(context.meeting)
    const room = await this.requireRoom(input.resourceId, context.meeting.facilityId)
    const next = [roomToNew(room), ...equipmentAssignments(context)]
    const views = await this.commit(meetingId, context, next)
    return views.find((view): view is RoomAssignmentView => view.resourceType === "ROOM")!
  }

  async assignEquipment(meetingId: string, input: AssignEquipmentInput, ctx?: AccessContext): Promise<EquipmentAssignmentView> {
    assertPositiveQuantity(input.requestedQuantity)
    const context = await this.loadContext(meetingId, ctx)
    assertMeetingResourcesMutable(context.meeting)
    if (context.currentAssignments.some((view) => view.resourceType === "POOLED_EQUIPMENT" && view.resourceId === input.resourceId)) {
      throw new ApiError(409, "EQUIPMENT_ALREADY_ASSIGNED", "Bu ekipman zaten atandı. Miktarını güncellemek için düzenleyin.")
    }
    const equipment = await this.requireEquipment(input.resourceId, context.meeting.facilityId)
    const next = [
      ...roomAssignment(context),
      ...equipmentAssignments(context),
      equipmentToNew(equipment, input.requestedQuantity),
    ]
    const views = await this.commit(meetingId, context, next)
    return views.find((view): view is EquipmentAssignmentView =>
      view.resourceType === "POOLED_EQUIPMENT" && view.resourceId === input.resourceId)!
  }

  async updateEquipmentAssignment(assignmentId: string, requestedQuantity: number, ctx?: AccessContext): Promise<EquipmentAssignmentView> {
    assertPositiveQuantity(requestedQuantity)
    const current = await this.repository.findAssignment(assignmentId)
    if (!current) throw new ApiError(404, "NOT_FOUND", "Atama bulunamadı.")
    if (current.resourceType !== "POOLED_EQUIPMENT") {
      throw new ApiError(400, "VALIDATION_ERROR", "Bu atama bir ekipman havuzu ataması değil.")
    }
    const context = await this.loadContext(current.meetingId, ctx)
    assertMeetingResourcesMutable(context.meeting)
    const next = assignmentViewsToNew(context.currentAssignments).map((assignment) =>
      assignment.resourceType === "POOLED_EQUIPMENT" && assignment.resourceId === current.resourceId
        ? { ...assignment, requestedQuantity }
        : assignment,
    )
    const views = await this.commit(current.meetingId, context, next)
    return views.find((view): view is EquipmentAssignmentView =>
      view.resourceType === "POOLED_EQUIPMENT" && view.resourceId === current.resourceId)!
  }

  async removeAssignment(assignmentId: string, ctx?: AccessContext): Promise<void> {
    const current = await this.repository.findAssignment(assignmentId)
    if (!current) throw new ApiError(404, "NOT_FOUND", "Atama bulunamadı.")
    const context = await this.loadContext(current.meetingId, ctx)
    assertMeetingResourcesMutable(context.meeting)
    const next = assignmentViewsToNew(context.currentAssignments.filter((view) => view.id !== assignmentId))
    await this.commit(current.meetingId, context, next)
  }

  async saveMeetingAssignments(meetingId: string, desired: DesiredResourceState, ctx?: AccessContext): Promise<ResourceAssignmentView[]> {
    const context = await this.loadContext(meetingId, ctx)
    assertMeetingResourcesMutable(context.meeting)

    const next: NewAssignment[] = []
    if (desired.roomResourceId !== null) {
      next.push(roomToNew(await this.requireRoom(desired.roomResourceId, context.meeting.facilityId)))
    }
    const seen = new Set<string>()
    for (const item of desired.equipment) {
      assertPositiveQuantity(item.requestedQuantity)
      if (seen.has(item.resourceId)) throw new ApiError(400, "VALIDATION_ERROR", "Aynı ekipman birden fazla kez eklenemez.")
      seen.add(item.resourceId)
      next.push(equipmentToNew(await this.requireEquipment(item.resourceId, context.meeting.facilityId), item.requestedQuantity))
    }
    return this.commit(meetingId, context, next)
  }

  async validateExtension(meetingId: string, newPlannedEnd: string): Promise<void> {
    const context = await this.loadContext(meetingId)
    assertExtensionConflictFree({
      meetingId,
      facilityId: context.meeting.facilityId,
      plannedStart: context.meeting.plannedStart,
      newPlannedEnd,
      currentAssignments: assignmentViewsToNew(context.currentAssignments),
      others: context.others,
    })
  }

  private async loadContext(meetingId: string, ctx?: AccessContext): Promise<AssignmentMeetingContext> {
    const context = await this.repository.loadMeetingContext(meetingId)
    if (!context) throw new ApiError(404, "NOT_FOUND", "Toplantı bulunamadı.")
    // An out-of-scope meeting is reported as 404, never as a cross-scope leak.
    if (ctx && !scopeAllows(ctx, { companyId: context.meeting.hostCompanyId, facilityId: context.meeting.facilityId })) {
      throw new ApiError(404, "NOT_FOUND", "Toplantı bulunamadı.")
    }
    return context
  }

  private async commit(meetingId: string, context: AssignmentMeetingContext, next: NewAssignment[]) {
    assertAssignmentSetValid({
      window: context.meeting,
      facilityId: context.meeting.facilityId,
      others: context.others,
      assignments: next,
    })
    return this.repository.commitMeetingAssignments(meetingId, next)
  }

  private async requireRoom(resourceId: string, facilityId: string): Promise<RoomResource> {
    const resource = await this.repository.findResource(resourceId)
    if (!resource || resource.type !== "ROOM") throw new ApiError(404, "RESOURCE_NOT_FOUND", "Oda kaynağı bulunamadı.")
    if (!resource.isActive) throw new ApiError(409, "RESOURCE_INACTIVE", "Atanacak oda aktif değil.")
    if (resource.facilityId !== facilityId) throw new ApiError(400, "INVALID_SCOPE", "Oda bu toplantının tesisine ait değil.")
    return resource
  }

  private async requireEquipment(resourceId: string, facilityId: string): Promise<PooledEquipmentResource> {
    const resource = await this.repository.findResource(resourceId)
    if (!resource || resource.type !== "POOLED_EQUIPMENT") throw new ApiError(404, "RESOURCE_NOT_FOUND", "Ekipman havuzu bulunamadı.")
    if (!resource.isActive) throw new ApiError(409, "RESOURCE_INACTIVE", "Atanacak ekipman havuzu aktif değil.")
    if (resource.facilityId !== facilityId) throw new ApiError(400, "INVALID_SCOPE", "Ekipman bu toplantının tesisine ait değil.")
    return resource
  }
}

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "İstenen miktar pozitif bir tam sayı olmalıdır.")
  }
}

function roomAssignment(context: AssignmentMeetingContext): NewAssignment[] {
  return assignmentViewsToNew(context.currentAssignments.filter((view) => view.resourceType === "ROOM"))
}

function equipmentAssignments(context: AssignmentMeetingContext): NewAssignment[] {
  return assignmentViewsToNew(context.currentAssignments.filter((view) => view.resourceType === "POOLED_EQUIPMENT"))
}

function roomToNew(room: RoomResource): NewAssignment {
  return {
    resourceId: room.id,
    resourceType: "ROOM",
    resourceName: room.name,
    companyId: room.companyId,
    facilityId: room.facilityId,
    totalQuantity: null,
    requestedQuantity: null,
  }
}

function equipmentToNew(equipment: PooledEquipmentResource, requestedQuantity: number): NewAssignment {
  return {
    resourceId: equipment.id,
    resourceType: "POOLED_EQUIPMENT",
    resourceName: equipment.name,
    companyId: equipment.companyId,
    facilityId: equipment.facilityId,
    totalQuantity: equipment.totalQuantity,
    requestedQuantity,
  }
}
