import { describe, expect, it } from "vitest"

import type { ResourceAssignmentView } from "../modules/resource-assignments/types.js"
import { assignmentViewsToNew } from "./resource-assignment-repository.js"

const at = "2026-09-08T09:00:00.000Z"
const base = { meetingId: "meeting-1", companyId: "company-1", facilityId: "facility-1", createdAt: at }

const liveRoom: ResourceAssignmentView = { ...base, id: "assignment-1", resourceId: "room-1", resourceType: "ROOM", resourceName: "Oda A" }
const deletedRoom: ResourceAssignmentView = { ...base, id: "assignment-2", resourceId: null, resourceType: "ROOM", resourceName: "Silinmiş Oda" }
const deletedEquipment: ResourceAssignmentView = { ...base, id: "assignment-3", resourceId: null, resourceType: "POOLED_EQUIPMENT", resourceName: "Silinmiş Projektör", totalQuantity: 4, requestedQuantity: 2 }

describe("assignmentViewsToNew", () => {
  it("keeps assignments that still point at a live catalog resource", () => {
    expect(assignmentViewsToNew([liveRoom])).toEqual([{
      resourceId: "room-1", resourceType: "ROOM", resourceName: "Oda A",
      companyId: "company-1", facilityId: "facility-1", totalQuantity: null, requestedQuantity: null,
    }])
  })

  it("drops assignments whose catalog resource was hard-deleted, so nothing re-commits a null reference", () => {
    expect(assignmentViewsToNew([deletedRoom, liveRoom, deletedEquipment]).map((assignment) => assignment.resourceId)).toEqual(["room-1"])
  })
})
