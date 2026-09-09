import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import { PrismaTransportAssignmentRepository, type PersistTransportAssignmentInput } from "./transport-assignment-repository.js"

const input: PersistTransportAssignmentInput = {
  companyId: "company-1", facilityId: "facility-1",
  plannedStart: "2026-09-09T09:00:00.000Z", plannedEnd: "2026-09-09T10:00:00.000Z",
  purpose: "Sevkiyat", vehicleResourceId: "vehicle-1", vehicleName: "Stale Araç", vehicleLicensePlate: "STALE",
  driverResourceId: "driver-1", driverName: "Stale Şoför",
}

const activeResources = [
  { id: "vehicle-1", type: "VEHICLE", companyId: "company-1", facilityId: "facility-1", active: true, brand: "Ford", model: "Transit", licensePlate: "34 ABC 123", fullName: null },
  { id: "driver-1", type: "DRIVER", companyId: "company-1", facilityId: "facility-1", active: true, brand: null, model: null, licensePlate: null, fullName: "Ayşe Yılmaz" },
]

function transportRepositoryFor(resources: typeof activeResources) {
  const create = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "assignment-1", ...data, createdAt: new Date("2026-09-09T08:00:00.000Z"), updatedAt: new Date(),
    company: { name: "Acme" }, facility: { name: "Merkez" },
  }))
  const update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "assignment-1", status: "ACTIVE", ...data, createdAt: new Date("2026-09-09T08:00:00.000Z"), updatedAt: new Date(),
    company: { name: "Acme" }, facility: { name: "Merkez" },
  }))
  const tx = {
    resource: { findMany: vi.fn().mockResolvedValue(resources) },
    transportAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
      create,
      update,
    },
  }
  const prisma = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaClient
  return { repository: new PrismaTransportAssignmentRepository(prisma), create, update }
}

describe("PrismaTransportAssignmentRepository in-transaction resource validation", () => {
  it("creates from the vehicle and driver snapshots re-read in the transaction", async () => {
    const { repository, create } = transportRepositoryFor(activeResources)

    await expect(repository.create(input)).resolves.toMatchObject({
      vehicleName: "Ford Transit", vehicleLicensePlate: "34 ABC 123", driverName: "Ayşe Yılmaz",
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vehicleName: "Ford Transit", vehicleLicensePlate: "34 ABC 123", driverName: "Ayşe Yılmaz" }),
    }))
  })

  it.each([
    { label: "missing vehicle", resources: activeResources.slice(1) },
    { label: "inactive vehicle", resources: [{ ...activeResources[0], active: false }, activeResources[1]] },
    { label: "wrong vehicle type", resources: [{ ...activeResources[0], type: "ROOM" }, activeResources[1]] },
    { label: "moved driver", resources: [activeResources[0], { ...activeResources[1], facilityId: "facility-2" }] },
  ])("rejects $label before create", async ({ resources }) => {
    const { repository, create } = transportRepositoryFor(resources)

    await expect(repository.create(input)).rejects.toMatchObject({ statusCode: 409, code: "TRANSPORT_ASSIGNMENT_CONFLICT" })
    expect(create).not.toHaveBeenCalled()
  })

  it("revalidates resources on update before writing", async () => {
    const { repository, update } = transportRepositoryFor([activeResources[0], { ...activeResources[1], companyId: "company-2" }])

    await expect(repository.update("assignment-1", input)).rejects.toMatchObject({ statusCode: 409, code: "TRANSPORT_ASSIGNMENT_CONFLICT" })
    expect(update).not.toHaveBeenCalled()
  })
})
