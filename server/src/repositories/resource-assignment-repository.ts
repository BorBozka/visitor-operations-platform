import type { Prisma, PrismaClient } from "@prisma/client"

import { ApiError } from "../lib/api-error.js"
import { isWriteConflictError, withWriteConflictRetry } from "../lib/prisma-conflict.js"
import {
  assertAssignmentSetValid,
  assertExtensionConflictFree,
  assertMeetingResourcesMutable,
  type MeetingContext,
  type NewAssignment,
  type OtherMeetingAssignments,
} from "../modules/resource-assignments/conflicts.js"
import type { ResourceAssignmentView } from "../modules/resource-assignments/types.js"
import type { FacilityResource, PooledEquipmentResource, RoomResource } from "../modules/resources/types.js"
import { RESOURCE_INCLUDE, toFacilityResource, type ResourceRow } from "./resource-projection.js"

const TERMINAL_VISIT_STATUSES = new Set(["CHECKED_OUT", "CANCELLED", "NO_SHOW"])

export interface AssignmentMeetingContext {
  meeting: MeetingContext
  currentAssignments: ResourceAssignmentView[]
  others: OtherMeetingAssignments[]
  eligibleRooms: RoomResource[]
  eligibleEquipment: PooledEquipmentResource[]
}

/**
 * Lets the visitor-operations extension flow re-validate a Meeting's resource assignments
 * inside its own serializable transaction, so validation and the plannedEnd update commit
 * atomically.
 */
export interface ResourceExtensionGuard {
  assertExtensionSafe(tx: Prisma.TransactionClient, meetingId: string, newPlannedEnd: Date): Promise<void>
}

export interface ResourceAssignmentRepository extends ResourceExtensionGuard {
  loadMeetingContext(meetingId: string): Promise<AssignmentMeetingContext | null>
  findResource(resourceId: string): Promise<FacilityResource | null>
  findAssignment(assignmentId: string): Promise<ResourceAssignmentView | null>
  listAssignmentsForMeeting(meetingId: string): Promise<ResourceAssignmentView[]>
  /** Atomically replaces the Meeting's whole assignment set; re-validates inside the tx. */
  commitMeetingAssignments(meetingId: string, assignments: NewAssignment[]): Promise<ResourceAssignmentView[]>
}

type AssignmentRow = {
  id: string
  meetingId: string
  resourceId: string | null
  resourceType: string
  resourceName: string
  companyId: string
  facilityId: string
  totalQuantity: number | null
  requestedQuantity: number | null
  createdAt: Date
}

function toAssignmentView(row: AssignmentRow): ResourceAssignmentView {
  const base = {
    id: row.id,
    meetingId: row.meetingId,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    companyId: row.companyId,
    facilityId: row.facilityId,
    createdAt: row.createdAt.toISOString(),
  }
  if (row.resourceType === "ROOM") return { ...base, resourceType: "ROOM" }
  return { ...base, resourceType: "POOLED_EQUIPMENT", totalQuantity: row.totalQuantity ?? 0, requestedQuantity: row.requestedQuantity ?? 0 }
}

/**
 * The re-committable part of a Meeting's current assignments. A view whose catalog Resource was
 * hard-deleted has no live `resourceId`, so it can never take part in a new write and is dropped:
 * a Meeting holding one is already closed/terminal history, which `assertMeetingResourcesMutable`
 * refuses to modify anyway.
 */
export function assignmentViewsToNew(views: ResourceAssignmentView[]): NewAssignment[] {
  return views.flatMap((view) => view.resourceId === null ? [] : [{
    resourceId: view.resourceId,
    resourceType: view.resourceType,
    resourceName: view.resourceName,
    companyId: view.companyId,
    facilityId: view.facilityId,
    totalQuantity: view.resourceType === "POOLED_EQUIPMENT" ? view.totalQuantity : null,
    requestedQuantity: view.resourceType === "POOLED_EQUIPMENT" ? view.requestedQuantity : null,
  }])
}

function visitsAllTerminal(visits: { status: string }[]): boolean {
  return visits.length > 0 && visits.every((visit) => TERMINAL_VISIT_STATUSES.has(visit.status))
}

function visitsAllCancelled(visits: { status: string }[]): boolean {
  return visits.length > 0 && visits.every((visit) => visit.status === "CANCELLED")
}

type PrismaLike = PrismaClient | Prisma.TransactionClient

export class PrismaResourceAssignmentRepository implements ResourceAssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  loadMeetingContext(meetingId: string) {
    return this.loadContextWith(this.prisma, meetingId)
  }

  async findResource(resourceId: string) {
    const row = await this.prisma.resource.findUnique({ where: { id: resourceId }, include: RESOURCE_INCLUDE })
    return row ? toFacilityResource(row as ResourceRow) : null
  }

  async findAssignment(assignmentId: string) {
    const row = await this.prisma.resourceAssignment.findUnique({ where: { id: assignmentId } })
    return row ? toAssignmentView(row) : null
  }

  async listAssignmentsForMeeting(meetingId: string) {
    const rows = await this.prisma.resourceAssignment.findMany({ where: { meetingId }, orderBy: { createdAt: "asc" } })
    return rows.map(toAssignmentView)
  }

  async commitMeetingAssignments(meetingId: string, assignments: NewAssignment[]) {
    try {
      await withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
        const context = await this.loadContextWith(tx, meetingId)
        if (!context) throw new ApiError(404, "NOT_FOUND", "Toplantı bulunamadı.")
        assertMeetingResourcesMutable(context.meeting)
        assertAssignmentSetValid({
          window: context.meeting,
          facilityId: context.meeting.facilityId,
          others: context.others,
          assignments,
        })
        await tx.resourceAssignment.deleteMany({ where: { meetingId } })
        if (assignments.length > 0) {
          await tx.resourceAssignment.createMany({
            data: assignments.map((assignment) => ({
              meetingId,
              resourceId: assignment.resourceId,
              resourceType: assignment.resourceType,
              resourceName: assignment.resourceName,
              companyId: assignment.companyId,
              facilityId: assignment.facilityId,
              totalQuantity: assignment.totalQuantity,
              requestedQuantity: assignment.requestedQuantity,
            })),
          })
        }
      }, { isolationLevel: "Serializable" }))
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (isWriteConflictError(error)) {
        throw new ApiError(409, "RESOURCE_ASSIGNMENT_CONFLICT", "Kaynak durumu değişti, lütfen tekrar deneyin.")
      }
      throw error
    }
    return this.listAssignmentsForMeeting(meetingId)
  }

  async assertExtensionSafe(tx: Prisma.TransactionClient, meetingId: string, newPlannedEnd: Date) {
    const context = await this.loadContextWith(tx, meetingId)
    if (!context) return
    assertExtensionConflictFree({
      meetingId,
      facilityId: context.meeting.facilityId,
      plannedStart: context.meeting.plannedStart,
      newPlannedEnd: newPlannedEnd.toISOString(),
      currentAssignments: assignmentViewsToNew(context.currentAssignments),
      others: context.others,
    })
  }

  private async loadContextWith(client: PrismaLike, meetingId: string): Promise<AssignmentMeetingContext | null> {
    const meeting = await client.meeting.findUnique({ where: { id: meetingId }, include: { visits: { select: { status: true } } } })
    if (!meeting) return null

    const [assignmentRows, otherMeetingRows, resourceRows] = await Promise.all([
      client.resourceAssignment.findMany({ where: { meetingId }, orderBy: { createdAt: "asc" } }),
      client.meeting.findMany({
        where: { id: { not: meetingId }, resourceAssignments: { some: {} } },
        include: {
          visits: { select: { status: true } },
          resourceAssignments: { select: { resourceId: true, resourceType: true, requestedQuantity: true } },
        },
      }),
      client.resource.findMany({
        where: { facilityId: meeting.facilityId, active: true, type: { in: ["ROOM", "POOLED_EQUIPMENT"] } },
        include: RESOURCE_INCLUDE,
        orderBy: { createdAt: "asc" },
      }),
    ])

    const eligible = resourceRows.map((row) => toFacilityResource(row as ResourceRow))
    return {
      meeting: {
        id: meeting.id,
        hostCompanyId: meeting.hostCompanyId,
        facilityId: meeting.facilityId,
        plannedStart: meeting.plannedStart.toISOString(),
        plannedEnd: meeting.plannedEnd.toISOString(),
        actualMeetingEnd: meeting.actualMeetingEnd ? meeting.actualMeetingEnd.toISOString() : null,
        allVisitsTerminal: visitsAllTerminal(meeting.visits),
      },
      currentAssignments: assignmentRows.map(toAssignmentView),
      others: otherMeetingRows.map((row) => ({
        id: row.id,
        plannedStart: row.plannedStart.toISOString(),
        plannedEnd: row.plannedEnd.toISOString(),
        excludedFromCapacity: row.actualMeetingEnd !== null || visitsAllCancelled(row.visits),
        // Assignments whose catalog Resource was deleted are dropped: they consume no capacity
        // and, being all-NULL, would otherwise compare equal to each other in the conflict math.
        assignments: row.resourceAssignments.flatMap((assignment) => assignment.resourceId === null ? [] : [{
          resourceId: assignment.resourceId,
          resourceType: assignment.resourceType,
          requestedQuantity: assignment.requestedQuantity,
        }]),
      })),
      eligibleRooms: eligible.filter((resource): resource is RoomResource => resource.type === "ROOM"),
      eligibleEquipment: eligible.filter((resource): resource is PooledEquipmentResource => resource.type === "POOLED_EQUIPMENT"),
    }
  }
}
