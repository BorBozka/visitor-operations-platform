import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import type { NewAssignment } from "../modules/resource-assignments/conflicts.js"
import type { ResourceAssignmentView } from "../modules/resource-assignments/types.js"
import { assignmentViewsToNew, PrismaResourceAssignmentRepository } from "./resource-assignment-repository.js"

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

const meetingRow = {
  id: "meeting-1", hostCompanyId: "company-1", facilityId: "facility-1",
  plannedStart: new Date("2026-09-09T09:00:00.000Z"), plannedEnd: new Date("2026-09-09T10:00:00.000Z"),
  actualMeetingEnd: null, visits: [],
}

const requestedRoom: NewAssignment = {
  resourceId: "room-1", resourceType: "ROOM", resourceName: "Stale Oda",
  companyId: "stale-company", facilityId: "stale-facility", totalQuantity: null, requestedQuantity: null,
}

function assignmentRepositoryFor(resource: {
  id: string
  type: string
  companyId: string
  facilityId: string
  name: string | null
  totalQuantity: number | null
  active: boolean
} | null) {
  let written: Array<Record<string, unknown>> = []
  const deleteMany = vi.fn().mockImplementation(async () => { written = []; return { count: 0 } })
  const createMany = vi.fn().mockImplementation(async ({ data }: { data: Array<Record<string, unknown>> }) => { written = data; return { count: data.length } })
  const resourceFindMany = vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => "id" in where ? (resource ? [resource] : []) : [])
  const assignmentFindMany = vi.fn().mockImplementation(async () => written.map((data, index) => ({
    id: `assignment-${index + 1}`, ...data, createdAt: new Date("2026-09-09T08:00:00.000Z"),
  })))
  const tx = {
    meeting: {
      findUnique: vi.fn().mockResolvedValue(meetingRow),
      findMany: vi.fn().mockResolvedValue([]),
    },
    resource: { findMany: resourceFindMany },
    resourceAssignment: { findMany: assignmentFindMany, deleteMany, createMany },
  }
  const prisma = {
    ...tx,
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as PrismaClient
  return { repository: new PrismaResourceAssignmentRepository(prisma), deleteMany, createMany }
}

describe("PrismaResourceAssignmentRepository in-transaction resource validation", () => {
  it("writes ROOM snapshots from the transaction re-read instead of the stale request", async () => {
    const { repository, createMany } = assignmentRepositoryFor({
      id: "room-1", type: "ROOM", companyId: "company-1", facilityId: "facility-1",
      name: "Gerçek Oda", totalQuantity: null, active: true,
    })

    await expect(repository.commitMeetingAssignments("meeting-1", [requestedRoom])).resolves.toMatchObject([
      { resourceId: "room-1", resourceName: "Gerçek Oda", companyId: "company-1", facilityId: "facility-1" },
    ])
    expect(createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ resourceName: "Gerçek Oda", companyId: "company-1", facilityId: "facility-1" })] })
  })

  it.each([
    { label: "missing", resource: null },
    { label: "inactive", resource: { id: "room-1", type: "ROOM", companyId: "company-1", facilityId: "facility-1", name: "Oda", totalQuantity: null, active: false } },
    { label: "wrong type", resource: { id: "room-1", type: "DRIVER", companyId: "company-1", facilityId: "facility-1", name: null, totalQuantity: null, active: true } },
    { label: "wrong company", resource: { id: "room-1", type: "ROOM", companyId: "company-2", facilityId: "facility-1", name: "Oda", totalQuantity: null, active: true } },
    { label: "wrong facility", resource: { id: "room-1", type: "ROOM", companyId: "company-1", facilityId: "facility-2", name: "Oda", totalQuantity: null, active: true } },
  ])("rejects a $label resource before replacing assignments", async ({ resource }) => {
    const { repository, deleteMany, createMany } = assignmentRepositoryFor(resource)

    await expect(repository.commitMeetingAssignments("meeting-1", [requestedRoom])).rejects.toMatchObject({
      statusCode: 409, code: "RESOURCE_ASSIGNMENT_CONFLICT",
    })
    expect(deleteMany).not.toHaveBeenCalled()
    expect(createMany).not.toHaveBeenCalled()
  })

  it("uses the transaction's current equipment capacity", async () => {
    const { repository, deleteMany } = assignmentRepositoryFor({
      id: "equipment-1", type: "POOLED_EQUIPMENT", companyId: "company-1", facilityId: "facility-1",
      name: "Projektör", totalQuantity: 2, active: true,
    })
    const requested: NewAssignment = {
      resourceId: "equipment-1", resourceType: "POOLED_EQUIPMENT", resourceName: "Stale",
      companyId: "company-1", facilityId: "facility-1", totalQuantity: 100, requestedQuantity: 3,
    }

    await expect(repository.commitMeetingAssignments("meeting-1", [requested])).rejects.toMatchObject({
      statusCode: 409, code: "EQUIPMENT_CAPACITY",
    })
    expect(deleteMany).not.toHaveBeenCalled()
  })
})
