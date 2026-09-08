import type {
  AssignEquipmentInput,
  AssignRoomInput,
  DesiredResourceState,
  EquipmentAvailabilityInfo,
  EquipmentAssignmentView,
  ResourceAssignmentView,
  RoomAssignmentView,
  RoomAvailabilityInfo,
} from "@/domain/resources"

export interface ResourceAssignmentService {
  /** All assignments for a given meeting, projected from their immutable resource snapshots. */
  listAssignmentsForMeeting(meetingId: string): Promise<ResourceAssignmentView[]>

  /**
   * Assign a room to a meeting.
   * If the meeting already has a room, this atomically replaces it:
   *  - validates the new room first,
   *  - if valid removes the old one and stores the new one,
   *  - if the new room conflicts the existing assignment is preserved and an error is thrown.
   */
  assignRoom(meetingId: string, input: AssignRoomInput): Promise<RoomAssignmentView>

  /** Assign pooled equipment to a meeting. */
  assignEquipment(meetingId: string, input: AssignEquipmentInput): Promise<EquipmentAssignmentView>

  /** Update the requested quantity for an existing equipment assignment. */
  updateEquipmentAssignment(assignmentId: string, requestedQuantity: number): Promise<EquipmentAssignmentView>

  /** Remove any assignment by id. */
  removeAssignment(assignmentId: string): Promise<void>

  /** Eligible ROOM resources for the meeting's facility with availability status. */
  getEligibleRooms(meetingId: string): Promise<RoomAvailabilityInfo[]>

  /** Eligible POOLED_EQUIPMENT resources for the meeting's facility with remaining capacity. */
  getEligibleEquipment(meetingId: string): Promise<EquipmentAvailabilityInfo[]>

  /**
   * Atomically replaces ALL resource assignments for a Meeting with the
   * supplied desired state.
   *
   * Guarantees:
   *  - Validates the Meeting exists and is not completed.
   *  - Validates every room/equipment item against current catalog data
   *    (active, correct facility, no time conflicts with OTHER meetings).
   *  - Validates unique equipment resourceIds and positive quantities.
   *  - Only if ALL validation passes, replaces the Meeting's persisted
   *    assignments in a single operation.
   *  - If any validation fails, persisted state is unchanged and an
   *    error is thrown.
   *
   * Returns the projected assignment views of the new persisted state.
   */
  saveMeetingAssignments(
    meetingId: string,
    desired: DesiredResourceState,
  ): Promise<ResourceAssignmentView[]>

}
