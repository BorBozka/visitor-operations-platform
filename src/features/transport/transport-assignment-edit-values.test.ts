import { describe, expect, it } from "vitest"

import type { PlannedTransportAssignment } from "@/domain/transport-assignments"
import { getTransportAssignmentEditValues } from "@/features/transport/transport-assignment-edit-values"

const assignmentFixture: PlannedTransportAssignment = {
  id: "assignment-1",
  companyId: "bplas",
  companyName: "BPLAS A.Ş.",
  facilityId: "bplas-merkez",
  facilityName: "Merkez Tesis",
  plannedStart: "2026-08-10T08:00:00+03:00",
  plannedEnd: "2026-08-10T09:00:00+03:00",
  purpose: "Tedarikçi saha ziyareti",
  vehicleResourceId: "vehicle-1",
  vehicleName: "Transit",
  vehicleLicensePlate: "16 BPL 101",
  driverResourceId: "driver-1",
  driverName: "Ayşe Demir",
  status: "ACTIVE",
  createdAt: "2026-08-01T09:00:00+03:00",
}

describe("transport assignment edit values", () => {
  it("preserves every editable assignment field when detail switches to edit mode", () => {
    const assignment = {
      ...assignmentFixture,
      relatedMeetingId: "meeting-1",
    }

    expect(getTransportAssignmentEditValues(assignment)).toEqual({
      companyId: assignment.companyId,
      facilityId: assignment.facilityId,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      startTime: expect.stringMatching(/^\d{2}:\d{2}$/),
      endTime: expect.stringMatching(/^\d{2}:\d{2}$/),
      purpose: assignment.purpose,
      vehicleResourceId: assignment.vehicleResourceId,
      driverResourceId: assignment.driverResourceId,
      relatedKind: "meeting",
      relatedId: "meeting-1",
    })
  })
})
