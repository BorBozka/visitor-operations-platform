import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import { PrismaGoodsMovementRepository } from "./goods-movement-repository.js"

const baseRow = {
  id: "goods-1",
  direction: "INBOUND",
  companyId: "c1",
  facilityId: "f1",
  counterpartyName: "Tedarik",
  plannedDate: new Date("2026-09-02T00:00:00.000Z"),
  plannedTime: "09:30",
  goodsDescription: "Palet",
  referenceNumber: null,
  note: null,
  status: "PLANNED",
  actualAt: null,
  actualPlate: null,
  actualDriverName: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  company: { name: "C1" },
  facility: { name: "F1" },
}

const persistInput = {
  direction: "INBOUND",
  companyId: "c1",
  facilityId: "f1",
  counterpartyName: "Tedarik",
  plannedDate: "2026-09-02",
  plannedTime: "09:30",
  goodsDescription: "Palet",
  createdByUserId: "user-1",
}

describe("PrismaGoodsMovementRepository", () => {
  it("writes plannedDate as a UTC-midnight date and projects it back as yyyy-MM-dd", async () => {
    const create = vi.fn().mockResolvedValue(baseRow)
    const prisma = { goodsMovement: { create } } as unknown as PrismaClient
    const repository = new PrismaGoodsMovementRepository(prisma)

    const dto = await repository.create(persistInput)

    expect(create.mock.calls[0][0].data.plannedDate).toEqual(new Date("2026-09-02T00:00:00.000Z"))
    expect(dto.plannedDate).toBe("2026-09-02")
    expect(dto.status).toBe("PLANNED")
  })

  it("returns null from update/cancel/complete when the optimistic PLANNED guard matches nothing", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const findUnique = vi.fn()
    const prisma = { goodsMovement: { updateMany, findUnique } } as unknown as PrismaClient
    const repository = new PrismaGoodsMovementRepository(prisma)

    await expect(repository.update("goods-1", persistInput)).resolves.toBeNull()
    await expect(repository.cancel("goods-1")).resolves.toBeNull()
    await expect(repository.complete("goods-1", { actualAt: new Date() })).resolves.toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledTimes(3)
    for (const call of updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ id: "goods-1", status: "PLANNED" })
    }
  })
})
