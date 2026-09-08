import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../../app.js"
import { AuthService } from "../../auth/auth-service.js"
import type { AuthUserRecord } from "../../auth/auth-types.js"
import { hashPassword } from "../../auth/password.js"
import { InMemoryAuthRepository } from "../../auth/testing/in-memory-auth-repository.js"
import { loadConfig } from "../../config/env.js"
import type { EmailSender } from "../../delivery/email-sender.js"
import { InMemoryAdminRepository } from "../admin/testing/in-memory-admin-repository.js"
import { InMemoryOrganizationRepository } from "../organization/testing/in-memory-organization-repository.js"
import { InMemorySettingsRepository } from "./testing/in-memory-settings-repository.js"
import type { VisitorOperationsRepository } from "../../repositories/visitor-operations-repository.js"
import type { GoodsMovementRepository } from "../../repositories/goods-movement-repository.js"

const config = loadConfig({
  DATABASE_URL: "sqlserver://localhost:1433;database=visitor_operations;user=sa;password=placeholder;encrypt=true;trustServerCertificate=true",
  NODE_ENV: "test",
})

const at = "2026-01-01T00:00:00.000Z"

describe("/api/settings/operational authorization", () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const cookies: Record<string, string> = {}

  beforeAll(async () => {
    const passwordHash = await hashPassword("password")

    const authRepository = new InMemoryAuthRepository([
      { id: "admin-1", username: "admin", fullName: "Admin User", role: "ADMIN", authenticationSource: "LOCAL", active: true, passwordHash, authorizationScope: { companyIds: [], facilityIds: [], securityGateIds: [] }, employeeId: null },
      { id: "manager-1", username: "manager", fullName: "Manager User", role: "MANAGER", authenticationSource: "LOCAL", active: true, passwordHash, authorizationScope: { companyIds: [], facilityIds: [], securityGateIds: [] }, employeeId: null },
      { id: "security-1", username: "security", fullName: "Security User", role: "SECURITY", authenticationSource: "LOCAL", active: true, passwordHash, authorizationScope: { companyIds: [], facilityIds: [], securityGateIds: [] }, employeeId: null },
    ] as AuthUserRecord[])

    const adminRepository = new InMemoryAdminRepository(
      [
        { id: "admin-1", fullName: "Admin User", username: "admin", email: "admin@test", authenticationSource: "LOCAL", role: "ADMIN", authorizationScope: { companyIds: [], facilityIds: [], securityGateIds: [] }, active: true, createdAt: at, updatedAt: at },
        { id: "manager-1", fullName: "Manager User", username: "manager", email: "manager@test", authenticationSource: "LOCAL", role: "MANAGER", authorizationScope: { companyIds: [], facilityIds: [], securityGateIds: [] }, active: true, createdAt: at, updatedAt: at },
        { id: "security-1", fullName: "Security User", username: "security", email: "security@test", authenticationSource: "LOCAL", role: "SECURITY", authorizationScope: { companyIds: [], facilityIds: [], securityGateIds: [] }, active: true, createdAt: at, updatedAt: at },
      ],
      { companyIds: [], facilities: [], gates: [] }
    )

    const organizationRepository = new InMemoryOrganizationRepository({ companies: [], facilities: [], departments: [], securityGates: [] }, [])
    const settingsRepository = new InMemorySettingsRepository()

    const emailSender: EmailSender = { send: async () => undefined }
    const visitorOperationsRepository: VisitorOperationsRepository = {} as VisitorOperationsRepository
    const goodsMovementRepository: GoodsMovementRepository = {} as GoodsMovementRepository

    app = await buildApp(config, {
      authRepository,
      authService: new AuthService(authRepository, { sessionTtlHours: 8 }),
      adminRepository,
      organizationRepository,
      settingsRepository,
      visitorOperationsRepository,
      goodsMovementRepository,
      emailSender,
    })

    for (const [key, user] of Object.entries({ admin: "admin", manager: "manager", security: "security" })) {
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: user, password: "password" } })
      const setCookie = login.headers["set-cookie"]
      cookies[key] = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]
    }
  })

  afterAll(async () => {
    await app?.close()
  })

  describe("GET /api/settings/operational", () => {
    it("returns 200 for authenticated SECURITY user", async () => {
      const response = await app.inject({ method: "GET", url: "/api/settings/operational", headers: { cookie: cookies.security } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ overdueToleranceMinutes: 15, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" })
    })

    it("returns 200 for authenticated MANAGER user", async () => {
      const response = await app.inject({ method: "GET", url: "/api/settings/operational", headers: { cookie: cookies.manager } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ overdueToleranceMinutes: 15, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" })
    })

    it("returns 200 for authenticated ADMIN user", async () => {
      const response = await app.inject({ method: "GET", url: "/api/settings/operational", headers: { cookie: cookies.admin } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ overdueToleranceMinutes: 15, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" })
    })

    it("returns 401 for unauthenticated request", async () => {
      const response = await app.inject({ method: "GET", url: "/api/settings/operational" })
      expect(response.statusCode).toBe(401)
    })
  })

  describe("PUT /api/settings/operational", () => {
    it("returns 403 for SECURITY user", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/settings/operational",
        headers: { cookie: cookies.security },
        payload: { overdueToleranceMinutes: 20, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" },
      })
      expect(response.statusCode).toBe(403)
    })

    it("returns 403 for MANAGER user", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/settings/operational",
        headers: { cookie: cookies.manager },
        payload: { overdueToleranceMinutes: 20, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" },
      })
      expect(response.statusCode).toBe(403)
    })

    it("returns 200 for ADMIN user and updates settings", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/settings/operational",
        headers: { cookie: cookies.admin },
        payload: { overdueToleranceMinutes: 25, overdueAlertRepeatMinutes: 12, workdayEndTime: "19:00" },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ overdueToleranceMinutes: 25, overdueAlertRepeatMinutes: 12, workdayEndTime: "19:00" })
    })

    it("returns 401 for unauthenticated request", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/settings/operational",
        payload: { overdueToleranceMinutes: 20, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" },
      })
      expect(response.statusCode).toBe(401)
    })
  })
})
