import { describe, expect, it } from "vitest"

import type { AccessContext } from "../../lib/authorization.js"
import { AdminService } from "./service.js"
import { InMemoryAdminRepository } from "./testing/in-memory-admin-repository.js"

const at = "2026-01-01T00:00:00.000Z"
const admin = { id: "admin-1", fullName: "Admin Kullanıcı", username: "admin", email: "admin@example.com", authenticationSource: "LOCAL" as const, role: "ADMIN" as const, authorizationScope: { companyIds: ["company-1"], facilityIds: [], securityGateIds: [] }, active: true, createdAt: at, updatedAt: at }
const references = { companyIds: ["company-1"], facilities: [{ id: "facility-1", companyId: "company-1" }], gates: [{ id: "gate-1", facilityId: "facility-1", companyId: "company-1" }] }
const context = (userId: string, scope = admin.authorizationScope): AccessContext => ({ userId, role: "ADMIN", employeeId: null, scope })
const ACTING = context(admin.id)
const OTHER_ADMIN = context("another-admin")

describe("AdminService", () => {
  it("creates LOCAL users only and writes their validated scopes", async () => {
    const service = new AdminService(new InMemoryAdminRepository([admin], references))
    const user = await service.createUser({ fullName: "Yeni Kullanıcı", username: "yeni", email: "yeni@example.com", password: "temporary-password", role: "SECURITY", active: true, authorizationScope: { companyIds: ["company-1", "company-1"], facilityIds: ["facility-1"], securityGateIds: ["gate-1"] } }, ACTING)
    expect(user.authenticationSource).toBe("LOCAL")
    expect(user.authorizationScope).toEqual({ companyIds: ["company-1"], facilityIds: ["facility-1"], securityGateIds: ["gate-1"] })
  })

  it("rejects out-of-company scope assignments and the last active Admin's deactivation", async () => {
    const service = new AdminService(new InMemoryAdminRepository([admin], references))
    await expect(service.updateUser(admin.id, { authorizationScope: { companyIds: ["company-1"], facilityIds: [], securityGateIds: ["missing"] } }, OTHER_ADMIN)).rejects.toMatchObject({ code: "INVALID_SCOPE" })
    await expect(service.updateUser(admin.id, { active: false }, OTHER_ADMIN)).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMIN" })
  })

  it("prevents self-demotion", async () => {
    const service = new AdminService(new InMemoryAdminRepository([admin], references))
    await expect(service.updateUser(admin.id, { role: "MANAGER" }, ACTING)).rejects.toMatchObject({ code: "SELF_ADMIN_DEMOTION" })
  })
})
