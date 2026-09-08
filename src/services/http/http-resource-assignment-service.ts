import { apiClient } from "@/lib/http"
import type {
  AssignEquipmentInput,
  AssignRoomInput,
  DesiredResourceState,
  EquipmentAssignmentView,
  EquipmentAvailabilityInfo,
  ResourceAssignmentView,
  RoomAssignmentView,
  RoomAvailabilityInfo,
} from "@/domain/resources"
import type { ResourceAssignmentService } from "@/services/resource-assignment-service"

/**
 * Meeting room / pooled-equipment assignments over `/api/meetings/:id/resource-assignments`
 * and `/api/resource-assignments/:id`. All conflict/capacity checks are server-side and land
 * as `409` `ApiClientError`s; the panel renders their Turkish message.
 */
export class HttpResourceAssignmentService implements ResourceAssignmentService {
  listAssignmentsForMeeting(meetingId: string): Promise<ResourceAssignmentView[]> {
    return apiClient.get<ResourceAssignmentView[]>(`/meetings/${encodeURIComponent(meetingId)}/resource-assignments`)
  }

  assignRoom(meetingId: string, input: AssignRoomInput): Promise<RoomAssignmentView> {
    return apiClient.post<RoomAssignmentView>(`/meetings/${encodeURIComponent(meetingId)}/resource-assignments/room`, input)
  }

  assignEquipment(meetingId: string, input: AssignEquipmentInput): Promise<EquipmentAssignmentView> {
    return apiClient.post<EquipmentAssignmentView>(
      `/meetings/${encodeURIComponent(meetingId)}/resource-assignments/equipment`,
      input,
    )
  }

  updateEquipmentAssignment(assignmentId: string, requestedQuantity: number): Promise<EquipmentAssignmentView> {
    return apiClient.patch<EquipmentAssignmentView>(`/resource-assignments/${encodeURIComponent(assignmentId)}`, {
      requestedQuantity,
    })
  }

  async removeAssignment(assignmentId: string): Promise<void> {
    await apiClient.delete<void>(`/resource-assignments/${encodeURIComponent(assignmentId)}`)
  }

  getEligibleRooms(meetingId: string): Promise<RoomAvailabilityInfo[]> {
    return apiClient.get<RoomAvailabilityInfo[]>(`/meetings/${encodeURIComponent(meetingId)}/eligible-rooms`)
  }

  getEligibleEquipment(meetingId: string): Promise<EquipmentAvailabilityInfo[]> {
    return apiClient.get<EquipmentAvailabilityInfo[]>(`/meetings/${encodeURIComponent(meetingId)}/eligible-equipment`)
  }

  saveMeetingAssignments(meetingId: string, desired: DesiredResourceState): Promise<ResourceAssignmentView[]> {
    return apiClient.put<ResourceAssignmentView[]>(
      `/meetings/${encodeURIComponent(meetingId)}/resource-assignments`,
      desired,
    )
  }
}
