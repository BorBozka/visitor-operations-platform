import { describe, expect, it } from "vitest"

import type { AccessContext } from "../../lib/authorization.js"
import { AdminService } from "./service.js"
import { InMemoryAdminRepository } from "./testing/in-memory-admin-repository.js"
import type { ApplicationRole, AuthorizationScope, CreateAdminUserInput } from "./types.js"

const at = "2026-01-01T00:00:00.000Z"
const admin = { id: "admin-1", fullName: "Admin Kullanıcı", username: "admin", email: "admin@example.com", authenticationSource: "LOCAL" as const, role: "ADMIN" as const, authorizationScope: { companyIds: ["company-1"], facilityIds: [], securityGateIds: [] }, active: true, createdAt: at, updatedAt: at }
const references = { companyIds: ["company-1"], facilities: [{ id: "facility-1", companyId: "company-1" }, { id: "facility-2", companyId: "company-1" }], gates: [{ id: "gate-1", facilityId: "facility-1", companyId: "company-1" }] }
const context = (userId: string, scope = admin.authorizationScope): AccessContext => ({ userId, role: "ADMIN", employeeId: null, scope })
const ACTING = context(admin.id)
const OTHER_ADMIN = context("another-admin")
const operationalScope: AuthorizationScope = { companyIds: ["company-1"], facilityIds: ["facility-1"], securityGateIds: [] }
const createInput = (role: ApplicationRole, suffix: string, authorizationScope = operationalScope): CreateAdminUserInput => ({ fullName: `Yeni ${role}`, username: `yeni-${suffix}`, email: `yeni-${suffix}@example.com`, password: "temporary-password", role, active: true, authorizationScope })

describe("AdminService", () => {
  it("creates LOCAL users only and writes their validated scopes", async () => {
    const repository = new InMemoryAdminRepository([admin], references)
    const service = new AdminService(repository)
    const user = await service.createUser({ fullName: "Yeni Kullanıcı", username: "yeni", email: "yeni@example.com", password: "temporary-password", role: "SECURITY", active: true, authorizationScope: { companyIds: ["company-1", "company-1"], facilityIds: ["facility-1"], securityGateIds: ["gate-1"] } }, ACTING)
    expect(user.authenticationSource).toBe("LOCAL")
    expect(user.authorizationScope).toEqual({ companyIds: ["company-1"], facilityIds: ["facility-1"], securityGateIds: ["gate-1"] })
    expect(await repository.findEmployeeProfileByUserId(user.id)).toMatchObject({ userId: user.id, fullName: "Yeni Kullanıcı", companyId: "company-1", facilityIds: ["facility-1"], active: true })
  })

  it.each(["EMPLOYEE", "MANAGER", "SECURITY"] as const)("creates an Employee profile for %s", async (role) => {
    const repository = new InMemoryAdminRepository([admin], references)
    const user = await new AdminService(repository).createUser(createInput(role, role.toLowerCase()), ACTING)
    expect(await repository.findEmployeeProfileByUserId(user.id)).toMatchObject({ userId: user.id, companyId: "company-1", facilityIds: ["facility-1"] })
  })

  it("keeps a pure Admin account free of an Employee profile", async () => {
    const repository = new InMemoryAdminRepository([admin], references)
    const user = await new AdminService(repository).createUser(createInput("ADMIN", "admin", { companyIds: ["company-1"], facilityIds: [], securityGateIds: [] }), ACTING)
    expect(await repository.findEmployeeProfileByUserId(user.id)).toBeNull()
  })

  it.each([
    { facilityIds: [], label: "missing" },
    { facilityIds: ["facility-1", "facility-2"], label: "multiple" },
  ])("rejects $label facility scope for an Employee-requiring role", async ({ facilityIds }) => {
    const service = new AdminService(new InMemoryAdminRepository([admin], references))
    await expect(service.createUser(createInput("EMPLOYEE", facilityIds.length.toString(), { ...operationalScope, facilityIds }), ACTING)).rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_FACILITY_SCOPE_REQUIRED" })
  })

  it("rolls User creation back when Employee creation fails", async () => {
    const repository = new InMemoryAdminRepository([admin], references)
    repository.failNextEmployeeCreation()
    const service = new AdminService(repository)
    await expect(service.createUser(createInput("EMPLOYEE", "rollback"), ACTING)).rejects.toThrow("Employee creation failed")
    expect(await repository.findUserByUsernameNormalized("yeni-rollback")).toBeNull()
  })

  it("creates, preserves and retires one Employee identity across role transitions", async () => {
    const repository = new InMemoryAdminRepository([admin], references)
    const service = new AdminService(repository)
    const target = await service.createUser(createInput("ADMIN", "transition", { companyIds: ["company-1"], facilityIds: [], securityGateIds: [] }), ACTING)

    await service.updateUser(target.id, { role: "EMPLOYEE", authorizationScope: operationalScope }, ACTING)
    const employee = await repository.findEmployeeProfileByUserId(target.id)
    expect(employee).toMatchObject({ fullName: "Yeni ADMIN", active: true, facilityIds: ["facility-1"] })

    await service.updateUser(target.id, { role: "MANAGER", fullName: "Güncel Çalışan", active: false }, ACTING)
    expect(await repository.findEmployeeProfileByUserId(target.id)).toMatchObject({ id: employee!.id, fullName: "Güncel Çalışan", active: false })

    await service.updateUser(target.id, { role: "ADMIN", active: true }, ACTING)
    expect(await repository.findEmployeeProfileByUserId(target.id)).toMatchObject({ id: employee!.id, fullName: "Güncel Çalışan", active: false, facilityIds: ["facility-1"] })
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
