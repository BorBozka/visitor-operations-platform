import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { ResourceInput } from "../modules/resources/types.js"
import { PrismaResourceRepository } from "./prisma-resource-repository.js"

const timestamp = new Date("2026-09-02T09:00:00.000Z")

function rowFor(input: ResourceInput) {
  return {
    id: "resource-1",
    type: input.type,
    companyId: input.companyId,
    facilityId: input.facilityId,
    name: input.type === "ROOM" || input.type === "POOLED_EQUIPMENT" ? input.name : null,
    totalQuantity: input.type === "POOLED_EQUIPMENT" ? input.totalQuantity : null,
    brand: input.type === "VEHICLE" ? input.brand : null,
    model: input.type === "VEHICLE" ? input.model : null,
    licensePlate: input.type === "VEHICLE" ? input.licensePlate : null,
    fullName: input.type === "DRIVER" ? input.fullName : null,
    canDriveCommercialVehicles: input.type === "DRIVER" ? input.canDriveCommercialVehicles : null,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    company: { name: "Acme" },
    facility: { name: "Merkez" },
    driverLicenseClasses: input.type === "DRIVER" ? input.licenseClasses.map((value) => ({ value })) : [],
    driverDocuments: input.type === "DRIVER" ? input.documents.map((name) => ({ name })) : [],
  }
}

function repositoryFor(input: ResourceInput) {
  const create = vi.fn().mockResolvedValue(rowFor(input))
  const update = vi.fn().mockResolvedValue(rowFor(input))
  const tx = {
    resource: { create, update, findUnique: vi.fn().mockResolvedValue({ companyId: input.companyId, facilityId: input.facilityId }) },
    resourceAssignment: { count: vi.fn().mockResolvedValue(0) },
    transportAssignment: { count: vi.fn().mockResolvedValue(0) },
  }
  const prisma = { ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaClient
  return { repository: new PrismaResourceRepository(prisma), create, update }
}

function deleteRepositoryFor(liveReferences: { assignments: number; transports: number }) {
  const calls: string[] = []
  const tx = {
    resourceAssignment: { count: async () => { calls.push("count:resourceAssignment"); return liveReferences.assignments } },
    transportAssignment: {
      count: async () => { calls.push("count:transportAssignment"); return liveReferences.transports },
      updateMany: async ({ where }: { where: Record<string, unknown> }) => { calls.push(`null:${Object.keys(where)[0]}`); return { count: 1 } },
    },
    driverLicenseClass: { deleteMany: async () => { calls.push("delete:driverLicenseClass"); return { count: 0 } } },
    driverDocument: { deleteMany: async () => { calls.push("delete:driverDocument"); return { count: 0 } } },
    resource: { delete: async () => { calls.push("delete:resource"); return {} } },
  }
  const prisma = { $transaction: async (run: (client: typeof tx) => Promise<boolean>) => run(tx) } as unknown as PrismaClient
  return { repository: new PrismaResourceRepository(prisma), calls }
}

describe("PrismaResourceRepository hard delete", () => {
  it("nulls the transport snapshots' catalog references and deletes owned driver sub-rows", async () => {
    const { repository, calls } = deleteRepositoryFor({ assignments: 0, transports: 0 })

    await expect(repository.delete("resource-1")).resolves.toBe(true)

    expect(calls).toEqual([
      "count:resourceAssignment", "count:transportAssignment",
      "null:vehicleResourceId", "null:driverResourceId",
      "delete:driverLicenseClass", "delete:driverDocument", "delete:resource",
    ])
  })

  it.each([
    { label: "an open Meeting's resource assignment", liveReferences: { assignments: 1, transports: 0 } },
    { label: "an ACTIVE transport assignment", liveReferences: { assignments: 0, transports: 1 } },
  ])("writes nothing when the resource is still held by $label", async ({ liveReferences }) => {
    const { repository, calls } = deleteRepositoryFor(liveReferences)

    await expect(repository.delete("resource-1")).resolves.toBe(false)

    expect(calls.every((call) => call.startsWith("count:"))).toBe(true)
  })
})

describe("PrismaResourceRepository resource relation payloads", () => {
  it.each([
    { type: "ROOM", companyId: "company-1", facilityId: "facility-1", name: "Toplantı Odası" },
    { type: "POOLED_EQUIPMENT", companyId: "company-1", facilityId: "facility-1", name: "Projektör", totalQuantity: 3 },
    { type: "VEHICLE", companyId: "company-1", facilityId: "facility-1", brand: "Ford", model: "Transit", licensePlate: "34 ABC 123" },
  ] satisfies ResourceInput[])("does not send driver relation mutations when creating $type", async (input) => {
    const { repository, create } = repositoryFor(input)

    await repository.save(input)

    const data = create.mock.calls[0][0].data
    expect(data).not.toHaveProperty("driverLicenseClasses")
    expect(data).not.toHaveProperty("driverDocuments")
  })

  it("uses nested create only when creating a driver", async () => {
    const input = { type: "DRIVER", companyId: "company-1", facilityId: "facility-1", fullName: "Ayşe Yılmaz", licenseClasses: ["B", "D"], documents: ["SRC", "Psikoteknik"], canDriveCommercialVehicles: true } satisfies ResourceInput
    const { repository, create } = repositoryFor(input)

    await repository.save(input)

    const data = create.mock.calls[0][0].data
    expect(data.driverLicenseClasses).toEqual({ create: [{ value: "B" }, { value: "D" }] })
    expect(data.driverDocuments).toEqual({ create: [{ name: "SRC" }, { name: "Psikoteknik" }] })
    expect(data.driverLicenseClasses).not.toHaveProperty("deleteMany")
    expect(data.driverDocuments).not.toHaveProperty("deleteMany")
  })

  it("replaces driver relations when updating a driver", async () => {
    const input = { type: "DRIVER", companyId: "company-1", facilityId: "facility-1", fullName: "Ayşe Yılmaz", licenseClasses: ["E"], documents: ["Yeni Belge"], canDriveCommercialVehicles: true } satisfies ResourceInput
    const { repository, update } = repositoryFor(input)

    await repository.save(input, "resource-1")

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "resource-1" },
      data: expect.objectContaining({
        type: "DRIVER",
        driverLicenseClasses: { deleteMany: {}, create: [{ value: "E" }] },
        driverDocuments: { deleteMany: {}, create: [{ name: "Yeni Belge" }] },
      }),
    }))
  })
})

describe("PrismaResourceRepository vehicle plate uniqueness", () => {
  const vehicle = { type: "VEHICLE", companyId: "company-1", facilityId: "facility-1", brand: "Ford", model: "Transit", licensePlate: "34 ABC 123" } satisfies ResourceInput
  const duplicatePlateError = {
    code: "P2002",
    meta: { target: "Resource_companyId_licensePlate_key" },
    message: "Unique constraint failed on Resource_companyId_licensePlate_key",
  }

  it.each([
    { operation: "create", id: undefined },
    { operation: "update", id: "resource-1" },
  ])("maps a $operation race on the filtered index to the plate-specific 409", async ({ id }) => {
    const create = vi.fn().mockRejectedValue(duplicatePlateError)
    const update = vi.fn().mockRejectedValue(duplicatePlateError)
    const tx = {
      resource: { create, update, findUnique: vi.fn().mockResolvedValue({ companyId: vehicle.companyId, facilityId: vehicle.facilityId }) },
      resourceAssignment: { count: vi.fn().mockResolvedValue(0) },
      transportAssignment: { count: vi.fn().mockResolvedValue(0) },
    }
    const repository = new PrismaResourceRepository({
      ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as PrismaClient)

    await expect(repository.save(vehicle, id)).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_LICENSE_PLATE" })
  })

  it("blocks disabling or moving a resource held by a live assignment", async () => {
    const update = vi.fn()
    const tx = {
      resource: { update, findUnique: vi.fn().mockResolvedValue({ id: "resource-1", companyId: "company-1", facilityId: "facility-1" }) },
      resourceAssignment: { count: vi.fn().mockResolvedValue(1) },
      transportAssignment: { count: vi.fn().mockResolvedValue(0) },
    }
    const repository = new PrismaResourceRepository({
      ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as PrismaClient)

    await expect(repository.setActive("resource-1", false)).rejects.toMatchObject({ statusCode: 409, code: "RESOURCE_IN_USE" })
    await expect(repository.save({ ...vehicle, facilityId: "facility-2" }, "resource-1")).rejects.toMatchObject({ statusCode: 409, code: "RESOURCE_IN_USE" })
    expect(update).not.toHaveBeenCalled()
  })

  it("does not misclassify a different unique constraint", async () => {
    const otherUniqueError = { code: "P2002", meta: { target: ["resourceId", "name"] } }
    const repository = new PrismaResourceRepository({
      resource: { create: vi.fn().mockRejectedValue(otherUniqueError) },
    } as unknown as PrismaClient)

    await expect(repository.save(vehicle)).rejects.toBe(otherUniqueError)
  })
})
