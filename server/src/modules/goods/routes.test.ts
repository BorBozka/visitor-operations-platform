import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"

import type { AuthGuards } from "../../auth/auth-guards.js"
import type { SessionUser } from "../../auth/auth-types.js"
import { ApiError } from "../../lib/api-error.js"
import { registerGoodsMovementRoutes } from "./routes.js"
import { GoodsMovementService } from "./service.js"
import { InMemoryGoodsMovementRepository } from "./testing/in-memory-goods-movement-repository.js"

const apps: Awaited<ReturnType<typeof Fastify>>[] = []
const employee: SessionUser = {
  id: "employee-user",
  username: "employee",
  fullName: "Employee",
  initials: "E",
  role: "EMPLOYEE",
  roleLabel: "Çalışan",
  authenticationSource: "LOCAL",
  authorizationScope: { companyIds: ["c1"], facilityIds: ["f1"], securityGateIds: [] },
  employeeId: "e1",
}
const securityUser: SessionUser = {
  id: "security-user",
  username: "security",
  fullName: "Security",
  initials: "S",
  role: "SECURITY",
  roleLabel: "Güvenlik",
  authenticationSource: "LOCAL",
  authorizationScope: { companyIds: ["c1"], facilityIds: ["f1"], securityGateIds: [] },
  employeeId: "e2",
}

async function createApp(currentUser: SessionUser = employee) {
  const app = Fastify()
  apps.push(app)
  app.decorateRequest("currentUser", null)
  const authenticate = async (request: { currentUser: SessionUser | null }) => { request.currentUser = currentUser }
  const guards: AuthGuards = { requireAuthentication: authenticate, requireRole: () => authenticate }
  const repository = new InMemoryGoodsMovementRepository([], [{ companyId: "c1", facilityId: "f1" }], { [securityUser.id]: securityUser.authorizationScope })
  await registerGoodsMovementRoutes(app, { service: new GoodsMovementService(repository), guards })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.status(error.statusCode).send({ error: { code: error.code } })
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR" } })
  })
  return app
}

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

describe("employee planned goods delivery routes", () => {
  it("creates an untimed inbound delivery and returns it only from the authenticated user's calendar list", async () => {
    const app = await createApp()
    const response = await app.inject({
      method: "POST",
      url: "/api/goods-movements",
      payload: { direction: "INBOUND", companyId: "c1", facilityId: "f1", counterpartyName: "Tedarik", plannedDate: "2026-09-10", goodsDescription: "Palet" },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ status: "PLANNED" })
    expect(response.json().plannedTime).toBeUndefined()

    const mine = await app.inject({ method: "GET", url: "/api/goods-movements/mine" })
    expect(mine.json().map((item: { id: string }) => item.id)).toEqual([response.json().id])
  })

  it("rejects a client-supplied creator identity", async () => {
    const app = await createApp()
    const response = await app.inject({
      method: "POST",
      url: "/api/goods-movements",
      payload: { direction: "INBOUND", companyId: "c1", facilityId: "f1", counterpartyName: "Tedarik", plannedDate: "2026-09-10", goodsDescription: "Palet", createdByUserId: "attacker" },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe("security unplanned goods movement route", () => {
  it("creates and immediately completes an unplanned movement for the authenticated Security user", async () => {
    const app = await createApp(securityUser)
    const response = await app.inject({
      method: "POST",
      url: "/api/security/goods-movements/unplanned",
      payload: { direction: "OUTBOUND", companyId: "c1", facilityId: "f1", counterpartyName: "Nakliye", goodsDescription: "Sevkiyat" },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ direction: "OUTBOUND", status: "COMPLETED" })
  })

  it("rejects an out-of-scope company/facility", async () => {
    const app = await createApp(securityUser)
    const response = await app.inject({
      method: "POST",
      url: "/api/security/goods-movements/unplanned",
      payload: { direction: "INBOUND", companyId: "other-company", facilityId: "other-facility", counterpartyName: "Tedarik", goodsDescription: "Palet" },
    })
    expect(response.statusCode).toBe(403)
  })
})
