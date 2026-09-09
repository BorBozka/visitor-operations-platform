import { ApiError } from "../../../lib/api-error.js"
import {
  assignmentViewsToNew,
  type AssignmentMeetingContext,
  type ResourceAssignmentRepository,
} from "../../../repositories/resource-assignment-repository.js"
import type { FacilityResource, PooledEquipmentResource, RoomResource } from "../../resources/types.js"
import { assertAssignmentSetValid, assertMeetingResourcesMutable, type NewAssignment, type OtherMeetingAssignments } from "../conflicts.js"
import type { ResourceAssignmentView } from "../types.js"

const clone = <T>(value: T): T => structuredClone(value)
const TERMINAL = new Set(["CHECKED_OUT", "CANCELLED", "NO_SHOW"])

export interface FixtureMeeting {
  id: string
  hostCompanyId?: string
  facilityId: string
  plannedStart: string
  plannedEnd: string
  actualMeetingEnd?: string | null
  visitStatuses: string[]
}

export interface ResourceAssignmentFixture {
  meetings: FixtureMeeting[]
  resources: FacilityResource[]
  assignments?: ResourceAssignmentView[]
}

export class InMemoryResourceAssignmentRepository implements ResourceAssignmentRepository {
  private readonly meetings: FixtureMeeting[]
  private readonly resources: FacilityResource[]
  private assignments: ResourceAssignmentView[]
  private sequence = 0

  constructor(fixture: ResourceAssignmentFixture) {
    this.meetings = clone(fixture.meetings)
    this.resources = clone(fixture.resources)
    this.assignments = clone(fixture.assignments ?? [])
  }

  async loadMeetingContext(meetingId: string) {
    return this.buildContext(meetingId)
  }

  async findResource(resourceId: string) {
    const resource = this.resources.find((item) => item.id === resourceId)
    return resource ? clone(resource) : null
  }

  async findAssignment(assignmentId: string) {
    const assignment = this.assignments.find((item) => item.id === assignmentId)
    return assignment ? clone(assignment) : null
  }

  async listAssignmentsForMeeting(meetingId: string) {
    return clone(this.assignments.filter((item) => item.meetingId === meetingId))
  }

  async commitMeetingAssignments(meetingId: string, next: NewAssignment[]) {
    const context = this.buildContext(meetingId)
    if (!context) throw new ApiError(404, "NOT_FOUND", "Toplantı bulunamadı.")
    assertMeetingResourcesMutable(context.meeting)
    assertAssignmentSetValid({ window: context.meeting, facilityId: context.meeting.facilityId, others: context.others, assignments: next })

    const now = new Date("2026-01-01T00:00:00.000Z").toISOString()
    const rebuilt = next.map((assignment) => this.toView(meetingId, assignment, now))
    this.assignments = [...this.assignments.filter((item) => item.meetingId !== meetingId), ...rebuilt]
    return clone(rebuilt)
  }

  async assertExtensionSafe() {
    // The visitor-operations extension flow is exercised against the real Prisma repository
    // in the MSSQL integration test; unit coverage uses the service's validateExtension.
  }

  private buildContext(meetingId: string): AssignmentMeetingContext | null {
    const meeting = this.meetings.find((item) => item.id === meetingId)
    if (!meeting) return null
    const eligible = this.resources.filter((resource) => resource.isActive && resource.facilityId === meeting.facilityId)
    return {
      meeting: {
        id: meeting.id,
        hostCompanyId: meeting.hostCompanyId ?? "company-1",
        facilityId: meeting.facilityId,
        plannedStart: meeting.plannedStart,
        plannedEnd: meeting.plannedEnd,
        actualMeetingEnd: meeting.actualMeetingEnd ?? null,
        allVisitsTerminal: meeting.visitStatuses.length > 0 && meeting.visitStatuses.every((status) => TERMINAL.has(status)),
      },
      currentAssignments: clone(this.assignments.filter((item) => item.meetingId === meetingId)),
      others: this.meetings
        .filter((other) => other.id !== meetingId)
        .map<OtherMeetingAssignments>((other) => ({
          id: other.id,
          plannedStart: other.plannedStart,
          plannedEnd: other.plannedEnd,
          excludedFromCapacity: Boolean(other.actualMeetingEnd)
            || (other.visitStatuses.length > 0 && other.visitStatuses.every((status) => status === "CANCELLED")),
          assignments: this.assignments
            .filter((item) => item.meetingId === other.id)
            .flatMap((item) => item.resourceId === null ? [] : [{
              resourceId: item.resourceId,
              resourceType: item.resourceType,
              requestedQuantity: item.resourceType === "POOLED_EQUIPMENT" ? item.requestedQuantity : null,
            }]),
        }))
        .filter((other) => other.assignments.length > 0),
      eligibleRooms: eligible.filter((resource): resource is RoomResource => resource.type === "ROOM"),
      eligibleEquipment: eligible.filter((resource): resource is PooledEquipmentResource => resource.type === "POOLED_EQUIPMENT"),
    }
  }

  private toView(meetingId: string, assignment: NewAssignment, createdAt: string): ResourceAssignmentView {
    const base = {
      id: `assignment-${++this.sequence}`,
      meetingId,
      resourceId: assignment.resourceId,
      resourceName: assignment.resourceName,
      companyId: assignment.companyId,
      facilityId: assignment.facilityId,
      createdAt,
    }
    return assignment.resourceType === "ROOM"
      ? { ...base, resourceType: "ROOM" }
      : { ...base, resourceType: "POOLED_EQUIPMENT", totalQuantity: assignment.totalQuantity ?? 0, requestedQuantity: assignment.requestedQuantity ?? 0 }
  }
}

// Re-exported so unit tests do not need to reach into conflicts.ts for the enum helper.
export { assignmentViewsToNew }
