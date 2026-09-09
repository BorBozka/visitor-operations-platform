import "dotenv/config"

import { PrismaClient } from "@prisma/client"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildApp } from "../app.js"
import { loadConfig } from "../config/env.js"
import { PrismaAdminRepository } from "../repositories/prisma-admin-repository.js"
import { PrismaAuthRepository } from "../repositories/prisma-auth-repository.js"

const describeMssql = process.env.RUN_MSSQL_INTEGRATION === "true" ? describe : describe.skip

const SEED_ADMIN_ID = "current-admin-atahan-bozkurt"
const RACER_PASSWORD = "yarisci-parola"

/**
 * The last-active-Admin invariant under *real* MSSQL concurrency.
 *
 * An in-process Promise race proves nothing here: the failure mode being guarded against is a
 * database write skew, where two transactions each read the *other* Admin as still active because
 * neither has committed yet. So this drives two genuinely concurrent HTTP requests through the
 * real Fastify app, real Prisma repositories and one real SQL Server database, and asserts on the
 * committed state afterwards.
 *
 * To reach the boundary the two racers must be the only active Admins in the whole system, so the
 * demo seed's `admin` account is parked inactive for the duration and restored in `afterAll`.
 */
describeMssql.sequential("Last active Admin MSSQL concurrency", () => {
  const prisma = new PrismaClient()
  const suffix = Date.now().toString().slice(-9)
  const racers = [
    { key: "a", username: `yarisci-a-${suffix}`, id: "", cookie: "" },
    { key: "b", username: `yarisci-b-${suffix}`, id: "", cookie: "" },
  ]
  let app: FastifyInstance

  const login = async (username: string, password: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } })
    expect(response.statusCode).toBe(200)
    const setCookie = response.headers["set-cookie"]
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? ""
  }

  const countActiveAdmins = () => prisma.user.count({ where: { role: "ADMIN", active: true } })

  /** Restores both racers to active ADMIN and asserts they are the only two in the system. */
  const armRace = async () => {
    await prisma.user.updateMany({ where: { id: { in: racers.map((racer) => racer.id) } }, data: { role: "ADMIN", active: true } })
    expect(await countActiveAdmins()).toBe(2)
  }

  beforeAll(async () => {
    app = await buildApp(loadConfig(), {
      authRepository: new PrismaAuthRepository(prisma),
      adminRepository: new PrismaAdminRepository(prisma),
      checkDatabase: async () => { await prisma.$queryRawUnsafe("SELECT 1") },
    })

    const seedAdminCookie = await login("admin", "admin")
    for (const racer of racers) {
      const created = await app.inject({
        method: "POST",
        url: "/api/admin/users",
        headers: { cookie: seedAdminCookie },
        payload: {
          fullName: `Yarışçı ${racer.key.toUpperCase()}`,
          username: racer.username,
          email: `${racer.username}@example.test`,
          password: RACER_PASSWORD,
          role: "ADMIN",
          active: true,
          // Mirrors the seed Admin's scope exactly: an empty facility/gate list would read as
          // *unconstrained* and land outside it. The single facility also keeps the ADMIN →
          // MANAGER demotion below a legal Employee provisioning.
          authorizationScope: { companyIds: ["bplas"], facilityIds: ["bplas-merkez"], securityGateIds: ["gate-bplas-merkez-ana-giris"] },
        },
      })
      expect(created.statusCode).toBe(201)
      racer.id = created.json().id
      racer.cookie = await login(racer.username, RACER_PASSWORD)
    }

    // Park the seed Admin so the two racers are the system's only active Admins.
    await prisma.user.update({ where: { id: SEED_ADMIN_ID }, data: { active: false } })
  })

  afterAll(async () => {
    const racerIds = racers.map((racer) => racer.id).filter(Boolean)
    if (racerIds.length > 0) {
      const employees = await prisma.employee.findMany({ where: { userId: { in: racerIds } }, select: { id: true } })
      const employeeIds = employees.map((employee) => employee.id)
      await prisma.employeeFacilityScope.deleteMany({ where: { employeeId: { in: employeeIds } } })
      await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } })
      await prisma.session.deleteMany({ where: { userId: { in: racerIds } } })
      await prisma.userSecurityGateScope.deleteMany({ where: { userId: { in: racerIds } } })
      await prisma.userFacilityScope.deleteMany({ where: { userId: { in: racerIds } } })
      await prisma.userCompanyScope.deleteMany({ where: { userId: { in: racerIds } } })
      await prisma.user.deleteMany({ where: { id: { in: racerIds } } })
    }
    await prisma.user.update({ where: { id: SEED_ADMIN_ID }, data: { active: true } })
    await app.close()
    await prisma.$disconnect()
  })

  it.each([
    { label: "deactivation", path: "status", payload: { active: false } },
    { label: "role removal", path: "role", payload: { role: "MANAGER" } },
  ])("lets only one of two concurrent Admin $label requests through", async ({ path, payload }) => {
    await armRace()
    const [first, second] = racers

    // Each request strips the *other* racer, so neither is blocked by the self-mutation rules and
    // both would pass a service-side count taken before the write.
    const responses = await Promise.all([
      app.inject({ method: "PATCH", url: `/api/admin/users/${second.id}/${path}`, headers: { cookie: first.cookie }, payload }),
      app.inject({ method: "PATCH", url: `/api/admin/users/${first.id}/${path}`, headers: { cookie: second.cookie }, payload }),
    ])

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])
    const loser = responses.find((response) => response.statusCode === 409)!
    expect(loser.json().error.code).toBe("LAST_ACTIVE_ADMIN")

    // The committed state — not the in-flight snapshots — is what the invariant is about.
    expect(await countActiveAdmins()).toBe(1)
    const survivors = await prisma.user.findMany({ where: { id: { in: racers.map((racer) => racer.id) }, role: "ADMIN", active: true }, select: { id: true } })
    expect(survivors).toHaveLength(1)

    // The rejected transaction left nothing half-written: no Employee was provisioned for the
    // survivor by the demotion attempt that lost.
    expect(await prisma.employee.count({ where: { userId: survivors[0].id } })).toBe(0)
  })
})
