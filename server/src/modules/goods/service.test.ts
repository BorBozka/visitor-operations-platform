import { describe, expect, it } from "vitest"

import type { AuthorizationScope } from "../../lib/scope.js"
import type { AccessContext } from "../../lib/authorization.js"
import { GoodsMovementService } from "./service.js"
import { InMemoryGoodsMovementRepository } from "./testing/in-memory-goods-movement-repository.js"
import type { GoodsMovementInput } from "./types.js"

const SCOPES = [
  { companyId: "bplas", facilityId: "bplas-merkez", companyName: "BPLAS A.Ş.", facilityName: "Merkez Tesis" },
  { companyId: "bplas", facilityId: "bplas-ege", companyName: "BPLAS A.Ş.", facilityName: "Ege Tesis" },
]
const SECURITY_SCOPE: AuthorizationScope = { companyIds: ["bplas"], facilityIds: ["bplas-merkez"], securityGateIds: [] }
const MANAGER_CONTEXT: AccessContext = { userId: "user-manager", employeeId: "employee-manager", role: "MANAGER", scope: { companyIds: ["bplas"], facilityIds: [], securityGateIds: [] } }
const EMPLOYEE_CONTEXT: AccessContext = { userId: "user-employee", employeeId: "employee-1", role: "EMPLOYEE", scope: SECURITY_SCOPE }

const validInput: GoodsMovementInput = {
  direction: "INBOUND",
  companyId: "bplas",
  facilityId: "bplas-merkez",
  counterpartyName: "Tedarik A.Ş.",
  plannedDate: "2026-09-02",
  plannedTime: "09:30",
  goodsDescription: "Ham madde paleti",
  referenceNumber: "IRS-1",
}

function makeService(options: { now?: Date } = {}) {
  const repository = new InMemoryGoodsMovementRepository([], SCOPES, { "user-security": SECURITY_SCOPE })
  const service = new GoodsMovementService(repository, () => options.now ?? new Date("2026-09-02T07:00:00.000Z"))
  return { repository, service }
}

describe("GoodsMovementService create/update/cancel", () => {
  it("lets an Employee create an inbound delivery and derives ownership from the authenticated context", async () => {
    const { service } = makeService()
    const created = await service.create(validInput, EMPLOYEE_CONTEXT)

    expect((await service.listOwn(EMPLOYEE_CONTEXT)).map((item) => item.id)).toEqual([created.id])
    expect(await service.listOwn({ ...EMPLOYEE_CONTEXT, userId: "another-user" })).toEqual([])
    expect((await service.listSecurityOperational("user-security")).map((item) => item.id)).toEqual([created.id])
  })

  it("keeps employee delivery time optional and enforces required fields, direction, and scope", async () => {
    const { service } = makeService()
    await expect(service.create({ ...validInput, plannedTime: undefined }, EMPLOYEE_CONTEXT))
      .resolves.toMatchObject({ plannedTime: undefined, status: "PLANNED" })
    await expect(service.create({ ...validInput, counterpartyName: " " }, EMPLOYEE_CONTEXT))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    await expect(service.create({ ...validInput, goodsDescription: "" }, EMPLOYEE_CONTEXT))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    await expect(service.create({ ...validInput, direction: "OUTBOUND" }, EMPLOYEE_CONTEXT))
      .rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(service.create({ ...validInput, facilityId: "bplas-ege" }, EMPLOYEE_CONTEXT))
      .rejects.toMatchObject({ code: "OUT_OF_SCOPE" })
  })

  it("creates a PLANNED movement, projecting company/facility display names", async () => {
    const { service } = makeService()
    const created = await service.create(validInput, MANAGER_CONTEXT)
    expect(created).toMatchObject({
      direction: "INBOUND",
      companyName: "BPLAS A.Ş.",
      facilityName: "Merkez Tesis",
      counterpartyName: "Tedarik A.Ş.",
      status: "PLANNED",
      plannedTime: "09:30",
    })
    expect(created.actualAt).toBeUndefined()
  })

  it("trims text fields and drops blank optionals", async () => {
    const { service } = makeService()
    const created = await service.create({ ...validInput, counterpartyName: "  Tedarik  ", goodsDescription: " Palet ", referenceNumber: "  ", note: "   " }, MANAGER_CONTEXT)
    expect(created).toMatchObject({ counterpartyName: "Tedarik", goodsDescription: "Palet" })
    expect(created.referenceNumber).toBeUndefined()
    expect(created.note).toBeUndefined()
  })

  it("rejects missing counterparty/description, invalid time, and company/facility mismatch", async () => {
    const { service } = makeService()
    await expect(service.create({ ...validInput, counterpartyName: " " }, MANAGER_CONTEXT)).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    await expect(service.create({ ...validInput, goodsDescription: "" }, MANAGER_CONTEXT)).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    await expect(service.create({ ...validInput, plannedTime: "9:5" }, MANAGER_CONTEXT)).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    await expect(service.create({ ...validInput, plannedDate: "2026-13-40" }, MANAGER_CONTEXT)).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    await expect(service.create({ ...validInput, facilityId: "unknown" }, MANAGER_CONTEXT)).rejects.toMatchObject({ code: "INVALID_SCOPE" })
  })

  it("rejects a well-formed but non-existent calendar plannedDate (strict validation regression)", async () => {
    const { service } = makeService()
    await expect(service.create({ ...validInput, plannedDate: "2026-02-31" }, MANAGER_CONTEXT)).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    await expect(service.create({ ...validInput, plannedDate: "2025-02-29" }, MANAGER_CONTEXT)).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    // A real leap day still passes.
    await expect(service.create({ ...validInput, plannedDate: "2028-02-29" }, MANAGER_CONTEXT)).resolves.toMatchObject({ plannedDate: "2028-02-29" })
  })

  it("updates only while PLANNED and blocks edits after completion", async () => {
    const { service } = makeService()
    const created = await service.create(validInput, MANAGER_CONTEXT)
    const updated = await service.update(created.id, { ...validInput, goodsDescription: "Güncel açıklama" })
    expect(updated.goodsDescription).toBe("Güncel açıklama")

    await service.complete(created.id, "user-security", { companyId: "bplas", facilityId: "bplas-merkez" })
    await expect(service.update(created.id, validInput)).rejects.toMatchObject({ code: "GOODS_MOVEMENT_NOT_EDITABLE" })
  })

  it("cancels a PLANNED record without physical deletion and rejects a second cancel", async () => {
    const { repository, service } = makeService()
    const created = await service.create(validInput, MANAGER_CONTEXT)
    const cancelled = await service.cancel(created.id)
    expect(cancelled.status).toBe("CANCELLED")
    expect(await repository.find(created.id)).not.toBeNull()
    await expect(service.cancel(created.id)).rejects.toMatchObject({ code: "GOODS_MOVEMENT_NOT_EDITABLE" })
  })
})

describe("GoodsMovementService security completion", () => {
  it("completes a PLANNED movement with a server timestamp and optional actual plate/driver", async () => {
    const now = new Date("2026-09-02T08:15:00.000Z")
    const { service } = makeService({ now })
    const created = await service.create(validInput, MANAGER_CONTEXT)

    const completed = await service.complete(created.id, "user-security", {
      companyId: "bplas",
      facilityId: "bplas-merkez",
      actualPlate: " 34 abc 12 ",
      actualDriverName: "  Ali Veli  ",
    })

    expect(completed).toMatchObject({ status: "COMPLETED", actualAt: now.toISOString(), actualPlate: "34 abc 12", actualDriverName: "Ali Veli" })
  })

  it("rejects completion of a non-PLANNED movement", async () => {
    const { service } = makeService()
    const created = await service.create(validInput, MANAGER_CONTEXT)
    await service.cancel(created.id)
    await expect(service.complete(created.id, "user-security", { companyId: "bplas", facilityId: "bplas-merkez" }))
      .rejects.toMatchObject({ code: "GOODS_MOVEMENT_NOT_EDITABLE" })
  })

  it("rejects a completion context outside the Security user's authorization scope", async () => {
    const { service } = makeService()
    const created = await service.create({ ...validInput, facilityId: "bplas-ege" }, MANAGER_CONTEXT)
    // Movement is at bplas-ege; the Security user is only scoped to bplas-merkez.
    await expect(service.complete(created.id, "user-security", { companyId: "bplas", facilityId: "bplas-ege" }))
      .rejects.toMatchObject({ code: "GOODS_MOVEMENT_OUT_OF_SCOPE" })
  })

  it("rejects a completion when the claimed context does not match the movement", async () => {
    const { service } = makeService()
    const created = await service.create(validInput, MANAGER_CONTEXT) // bplas-merkez
    await expect(service.complete(created.id, "user-security", { companyId: "bplas", facilityId: "bplas-ege" }))
      .rejects.toMatchObject({ code: "GOODS_MOVEMENT_OUT_OF_SCOPE" })
  })

  it("rejects completion for a user with no resolvable scope", async () => {
    const { service } = makeService()
    const created = await service.create(validInput, MANAGER_CONTEXT)
    await expect(service.complete(created.id, "user-unknown", { companyId: "bplas", facilityId: "bplas-merkez" }))
      .rejects.toMatchObject({ code: "GOODS_MOVEMENT_OUT_OF_SCOPE" })
  })
})

describe("GoodsMovementService security operational list", () => {
  it("returns only today's PLANNED movements inside the user's scope", async () => {
    const now = new Date("2026-09-02T07:00:00.000Z")
    const { service } = makeService({ now })
    const today = toLocalKey(now)

    const inScopeToday = await service.create({ ...validInput, plannedDate: today, direction: "OUTBOUND" }, MANAGER_CONTEXT)
    await service.create({ ...validInput, plannedDate: today, facilityId: "bplas-ege" }, MANAGER_CONTEXT) // out of scope
    await service.create({ ...validInput, plannedDate: "2026-08-15" }, MANAGER_CONTEXT) // not today
    const cancelledToday = await service.create({ ...validInput, plannedDate: today }, MANAGER_CONTEXT)
    await service.cancel(cancelledToday.id)

    const list = await service.listSecurityOperational("user-security")
    expect(list.map((movement) => movement.id)).toEqual([inScopeToday.id])
  })
})

function toLocalKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
