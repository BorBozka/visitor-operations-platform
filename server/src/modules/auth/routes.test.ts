import { afterEach, describe, expect, it } from "vitest"

import { buildApp } from "../../app.js"
import { AuthService } from "../../auth/auth-service.js"
import { hashPassword } from "../../auth/password.js"
import { InMemoryAuthRepository } from "../../auth/testing/in-memory-auth-repository.js"
import { loadConfig } from "../../config/env.js"
import { InMemoryAdminRepository } from "../admin/testing/in-memory-admin-repository.js"
import type { AdminUser } from "../admin/types.js"

const config = loadConfig({
  DATABASE_URL: "sqlserver://localhost:1433;database=visitor_operations;user=sa;password=placeholder;encrypt=true;trustServerCertificate=true",
  NODE_ENV: "test",
})

describe("auth and account HTTP routes", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = []

  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  it("sets an HttpOnly cookie, returns the session projection, and never accepts a target user id for password change", async () => {
    const repository = new InMemoryAuthRepository([{
      id: "user-1",
      username: "calisan",
      fullName: "Maya Kara",
      role: "EMPLOYEE",
      authenticationSource: "LOCAL",
      active: true,
      passwordHash: await hashPassword("calisan"),
      authorizationScope: { companyIds: ["bplas"], facilityIds: [], securityGateIds: [] },
      employeeId: "maya-kara",
    }])
    const authService = new AuthService(repository, { sessionTtlHours: 8, createToken: () => "raw-session-token" })
    const app = await buildApp(config, { authRepository: repository, authService })
    apps.push(app)

    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "calisan", password: "calisan" } })
    expect(login.statusCode).toBe(200)
    expect(login.json()).toMatchObject({
      user: {
        id: "user-1",
        initials: "MK",
        role: "EMPLOYEE",
        employeeId: "maya-kara",
        authorizationScope: { companyIds: ["bplas"], facilityIds: [], securityGateIds: [] },
      },
    })
    const setCookie = login.headers["set-cookie"] as string
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Lax")
    const cookie = setCookie.split(";")[0]

    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })
    expect(session.json()).toMatchObject({ user: { username: "calisan" } })

    const invalidChange = await app.inject({
      method: "POST",
      url: "/api/account/change-password",
      headers: { cookie },
      payload: { currentPassword: "calisan", newPassword: "yeni-parola", userId: "another-user" },
    })
    expect(invalidChange.statusCode).toBe(400)
    expect(invalidChange.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } })
  })

  it("keeps the self-change cookie authenticated and rejects the user's other old cookie", async () => {
    const repository = new InMemoryAuthRepository([{
      id: "user-1",
      username: "calisan",
      fullName: "Maya Kara",
      role: "EMPLOYEE",
      authenticationSource: "LOCAL",
      active: true,
      passwordHash: await hashPassword("old-password"),
      authorizationScope: { companyIds: ["bplas"], facilityIds: ["facility-1"], securityGateIds: [] },
      employeeId: "maya-kara",
    }])
    const tokens = ["session-a", "session-b"]
    let tokenIndex = 0
    const authService = new AuthService(repository, { sessionTtlHours: 8, createToken: () => tokens[tokenIndex++] })
    const app = await buildApp(config, { authRepository: repository, authService })
    apps.push(app)

    const loginA = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "calisan", password: "old-password" } })
    const loginB = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "calisan", password: "old-password" } })
    const cookieA = String(loginA.headers["set-cookie"]).split(";")[0]
    const cookieB = String(loginB.headers["set-cookie"]).split(";")[0]

    const changed = await app.inject({ method: "POST", url: "/api/account/change-password", headers: { cookie: cookieA }, payload: { currentPassword: "old-password", newPassword: "new-password" } })
    expect(changed.statusCode).toBe(204)
    expect((await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieA } })).json()).toMatchObject({ user: { id: "user-1" } })
    expect((await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieB } })).json()).toEqual({ user: null })

    const currentCookieProtectedRequest = await app.inject({ method: "POST", url: "/api/account/change-password", headers: { cookie: cookieA }, payload: { currentPassword: "new-password", newPassword: "newest-password" } })
    expect(currentCookieProtectedRequest.statusCode).toBe(204)
    const revokedCookieProtectedRequest = await app.inject({ method: "POST", url: "/api/account/change-password", headers: { cookie: cookieB }, payload: { currentPassword: "old-password", newPassword: "irrelevant-password" } })
    expect(revokedCookieProtectedRequest.statusCode).toBe(401)
  })

  it("revokes every target-user cookie after an Admin password reset", async () => {
    const scope = { companyIds: ["bplas"], facilityIds: ["facility-1"], securityGateIds: [] }
    const timestamp = "2026-01-01T00:00:00.000Z"
    const admin: AdminUser = { id: "admin-1", username: "admin", fullName: "Admin", email: "admin@example.com", role: "ADMIN", authenticationSource: "LOCAL", active: true, authorizationScope: scope, createdAt: timestamp, updatedAt: timestamp }
    const target: AdminUser = { id: "target-1", username: "target", fullName: "Target", email: "target@example.com", role: "EMPLOYEE", authenticationSource: "LOCAL", active: true, authorizationScope: scope, createdAt: timestamp, updatedAt: timestamp }
    const repository = new InMemoryAuthRepository([
      { ...admin, passwordHash: await hashPassword("admin-password"), employeeId: null },
      { ...target, passwordHash: await hashPassword("old-password"), employeeId: "target-employee" },
    ])
    const tokens = ["admin-session", "target-session-a", "target-session-b", "target-session-new"]
    let tokenIndex = 0
    const authService = new AuthService(repository, { sessionTtlHours: 8, createToken: () => tokens[tokenIndex++] })
    const app = await buildApp(config, {
      authRepository: repository,
      authService,
      adminRepository: new InMemoryAdminRepository([admin, target]),
    })
    apps.push(app)

    const adminLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "admin-password" } })
    const targetLoginA = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "target", password: "old-password" } })
    const targetLoginB = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "target", password: "old-password" } })
    const adminCookie = String(adminLogin.headers["set-cookie"]).split(";")[0]
    const targetCookieA = String(targetLoginA.headers["set-cookie"]).split(";")[0]
    const targetCookieB = String(targetLoginB.headers["set-cookie"]).split(";")[0]

    const reset = await app.inject({ method: "POST", url: `/api/admin/users/${target.id}/reset-password`, headers: { cookie: adminCookie }, payload: { password: "new-password" } })
    expect(reset.statusCode).toBe(204)
    expect((await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: targetCookieA } })).json()).toEqual({ user: null })
    expect((await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: targetCookieB } })).json()).toEqual({ user: null })
    expect((await app.inject({ method: "POST", url: "/api/account/change-password", headers: { cookie: targetCookieA }, payload: { currentPassword: "old-password", newPassword: "irrelevant-password" } })).statusCode).toBe(401)
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "target", password: "old-password" } })).statusCode).toBe(401)
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "target", password: "new-password" } })).statusCode).toBe(200)
  })
})
