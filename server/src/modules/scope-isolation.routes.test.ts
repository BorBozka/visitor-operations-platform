import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildApp } from "../app.js"
import { AuthService } from "../auth/auth-service.js"
import type { AuthUserRecord } from "../auth/auth-types.js"
import { hashPassword } from "../auth/password.js"
import { InMemoryAuthRepository } from "../auth/testing/in-memory-auth-repository.js"
import { loadConfig } from "../config/env.js"
import type { EmailSender } from "../delivery/email-sender.js"
import type { AuthorizationScope } from "../lib/scope.js"
import { InMemoryAdminRepository } from "./admin/testing/in-memory-admin-repository.js"
import type { AdminUser } from "./admin/types.js"
import { InMemoryOrganizationRepository } from "./organization/testing/in-memory-organization-repository.js"
import type { EmployeeRecord } from "./organization/types.js"
import type { VisitorOperationsRepository } from "../repositories/visitor-operations-repository.js"
import type { MeetingDto, VisitDto, VisitorCardDto } from "./visitor-operations/types.js"

/**
 * Cross-company isolation for every scope-aware endpoint, driven through the real HTTP stack
 * (`buildApp` + `inject`) so a route that forgets to hand its service the session's
 * `AccessContext` fails here. ADMIN is not a global super-admin: an Admin scoped to `company-1`
 * is bounded by that scope for reads *and* writes, and out-of-scope records must be
 * indistinguishable from absent ones (404, never 403 — a 403 would confirm they exist).
 */

const config = loadConfig({
  DATABASE_URL: "sqlserver://localhost:1433;database=visitor_operations;user=sa;password=placeholder;encrypt=true;trustServerCertificate=true",
  NODE_ENV: "test",
})

const at = "2026-01-01T00:00:00.000Z"
const scope = (companyIds: string[], facilityIds: string[] = [], securityGateIds: string[] = []): AuthorizationScope => ({ companyIds, facilityIds, securityGateIds })
const entity = (id: string, name: string, parentId?: string) => ({ id, name, active: true, ...(parentId ? { parentId } : {}), createdAt: at, updatedAt: at })

const employee = (id: string, fullName: string, companyId: string, facilityId: string): EmployeeRecord =>
  ({ id, userId: null, fullName, companyId, departmentId: null, facilityIds: [facilityId], active: true, createdAt: at, updatedAt: at })

/** Same person modelled twice: an auth record (login/session) and an admin record (user management). */
const person = (id: string, username: string, role: AdminUser["role"], assigned: AuthorizationScope) => ({
  auth: (passwordHash: string): AuthUserRecord => ({ id, username, fullName: `${username} Kullanıcı`, role, authenticationSource: "LOCAL", active: true, passwordHash, authorizationScope: assigned, employeeId: null }),
  admin: (): AdminUser => ({ id, fullName: `${username} Kullanıcı`, username, email: `${username}@example.test`, authenticationSource: "LOCAL", role, authorizationScope: assigned, active: true, createdAt: at, updatedAt: at }),
})

const people = {
  adminA: person("admin-a", "admina", "ADMIN", scope(["company-1"])),
  adminB: person("admin-b", "adminb", "ADMIN", scope(["company-2"])),
  /** Narrower still: an Admin bounded to one facility *inside* `company-1`. */
  adminC: person("admin-c", "adminc", "ADMIN", scope(["company-1"], ["facility-1"])),
  managerA: person("manager-a", "managera", "MANAGER", scope(["company-1"], ["facility-1"])),
  managerB: person("manager-b", "managerb", "MANAGER", scope(["company-2"], ["facility-2"])),
  securityA: person("security-a", "securitya", "SECURITY", scope(["company-1"], ["facility-1"])),
}

function meeting(id: string, companyId: string, facilityId: string): MeetingDto {
  return { id, creatorEmployeeId: "employee-x", visitTypeId: "type-1", visitTypeName: "Toplantı", hostEmployeeName: "Ev Sahibi", hostCompanyId: companyId, hostCompanyName: companyId, facilityId, facilityName: facilityId, plannedStart: at, plannedEnd: at, hasAdditionalRequirements: false, createdAt: at, updatedAt: at }
}

function cardIssue(suffix: string, companyId: string, facilityId: string): { card: VisitorCardDto; visit: VisitDto } {
  const parent = meeting(`meeting-${suffix}`, companyId, facilityId)
  const visit: VisitDto = { id: `visit-${suffix}`, meetingId: parent.id, visitor: { id: `visitor-${suffix}`, firstName: "Ada", lastName: suffix, company: "Acme" }, status: "CHECKED_OUT", invitationStatus: "NOT_SENT", visitorCardReturned: false, createdAt: at, updatedAt: at, meeting: parent }
  return { card: { id: `card-${suffix}`, cardNumber: suffix, status: "NOT_RETURNED", assignedVisitId: visit.id, createdAt: at, updatedAt: at }, visit }
}

const cardIssues = [cardIssue("a", "company-1", "facility-1"), cardIssue("b", "company-2", "facility-2")]

/** Only `listUnreturnedIssues` is exercised; everything else must never be reached. */
const visitorOperationsRepository = {
  listUnreturnedIssues: async () => cardIssues,
} as unknown as VisitorOperationsRepository

const emailSender: EmailSender = { send: async () => undefined }

describe("cross-company authorization scope isolation", () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const cookies: Record<string, string> = {}
  const as = (who: keyof typeof people) => ({ cookie: cookies[who] })

  beforeAll(async () => {
    const passwordHash = await hashPassword("gecerli-parola")
    const authRepository = new InMemoryAuthRepository(Object.values(people).map((candidate) => candidate.auth(passwordHash)))
    const adminRepository = new InMemoryAdminRepository(Object.values(people).map((candidate) => candidate.admin()), {
      companyIds: ["company-1", "company-2"],
      facilities: [{ id: "facility-1", companyId: "company-1" }, { id: "facility-1b", companyId: "company-1" }, { id: "facility-2", companyId: "company-2" }],
      gates: [{ id: "gate-1", facilityId: "facility-1", companyId: "company-1" }, { id: "gate-2", facilityId: "facility-2", companyId: "company-2" }],
    })
    const organizationRepository = new InMemoryOrganizationRepository({
      companies: [entity("company-1", "Birinci"), entity("company-2", "İkinci")],
      facilities: [entity("facility-1", "Merkez", "company-1"), entity("facility-1b", "Şube", "company-1"), entity("facility-2", "Merkez", "company-2")],
      departments: [entity("department-1", "Üretim", "company-1"), entity("department-2", "Üretim", "company-2")],
      securityGates: [entity("gate-1", "Ana Kapı", "facility-1"), entity("gate-2", "Ana Kapı", "facility-2")],
    }, [employee("employee-1", "Maya Kara", "company-1", "facility-1"), employee("employee-2", "Selin Aksoy", "company-2", "facility-2")])

    app = await buildApp(config, {
      authRepository,
      authService: new AuthService(authRepository, { sessionTtlHours: 8 }),
      adminRepository,
      organizationRepository,
      visitorOperationsRepository,
      emailSender,
    })

    for (const [key, candidate] of Object.entries(people)) {
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: candidate.admin().username, password: "gecerli-parola" } })
      expect(login.statusCode).toBe(200)
      const setCookie = login.headers["set-cookie"]
      cookies[key] = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]
    }
  })

  afterAll(async () => { await app?.close() })

  const ids = (response: { json: () => unknown }) => (response.json() as { id: string }[]).map((row) => row.id)

  it("confines organization list reads to the caller's companies", async () => {
    const snapshot = await app.inject({ method: "GET", url: "/api/organization?includeInactive=true", headers: as("adminA") })
    expect(snapshot.statusCode).toBe(200)
    expect(snapshot.json()).toEqual({
      companies: [expect.objectContaining({ id: "company-1" })],
      facilities: [expect.objectContaining({ id: "facility-1" }), expect.objectContaining({ id: "facility-1b" })],
      departments: [expect.objectContaining({ id: "department-1" })],
      securityGates: [expect.objectContaining({ id: "gate-1" })],
    })

    expect(ids(await app.inject({ method: "GET", url: "/api/companies", headers: as("adminA") }))).toEqual(["company-1"])
    // A facility-bounded Admin sees only their facility, not the company's other one.
    expect(ids(await app.inject({ method: "GET", url: "/api/facilities", headers: as("adminC") }))).toEqual(["facility-1"])
    expect(ids(await app.inject({ method: "GET", url: "/api/facilities", headers: as("adminB") }))).toEqual(["facility-2"])
    // Non-Admin roles are bounded by the same scope, not by the frontend's company selector.
    expect(ids(await app.inject({ method: "GET", url: "/api/departments", headers: as("securityA") }))).toEqual(["department-1"])
    expect(ids(await app.inject({ method: "GET", url: "/api/security-gates", headers: as("managerB") }))).toEqual(["gate-2"])
  })

  it("reports an out-of-scope organization record as absent rather than forbidden", async () => {
    for (const url of ["/api/companies/company-2", "/api/facilities/facility-2", "/api/departments/department-2", "/api/security-gates/gate-2"]) {
      const response = await app.inject({ method: "GET", url, headers: as("adminA") })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } })
    }
    expect((await app.inject({ method: "GET", url: "/api/companies/company-1", headers: as("adminA") })).statusCode).toBe(200)
    // Same-company but out-of-facility is hidden from a facility-bounded Admin too.
    expect((await app.inject({ method: "GET", url: "/api/facilities/facility-1b", headers: as("adminC") })).statusCode).toBe(404)
  })

  it("confines employee reads to the caller's scope and ignores a widening filter", async () => {
    expect(ids(await app.inject({ method: "GET", url: "/api/employees", headers: as("adminA") }))).toEqual(["employee-1"])
    // A client-supplied companyId may narrow within the scope; it can never reach past it.
    expect(ids(await app.inject({ method: "GET", url: "/api/employees?companyId=company-2", headers: as("adminA") }))).toEqual([])
    expect(ids(await app.inject({ method: "GET", url: "/api/employees?companyId=company-1", headers: as("adminA") }))).toEqual(["employee-1"])

    const crossCompany = await app.inject({ method: "GET", url: "/api/employees/employee-2", headers: as("adminA") })
    expect(crossCompany.statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: "/api/employees/employee-1", headers: as("adminA") })).statusCode).toBe(200)
  })

  it("returns only in-scope unreturned visitor-card issues to a Security user", async () => {
    const response = await app.inject({ method: "GET", url: "/api/security/visitor-card-issues", headers: as("securityA") })
    expect(response.statusCode).toBe(200)
    expect((response.json() as { card: { id: string } }[]).map((row) => row.card.id)).toEqual(["card-a"])
  })

  it("hides users outside the acting Admin's authority from reads and writes", async () => {
    expect(ids(await app.inject({ method: "GET", url: "/api/admin/users", headers: as("adminA") })).sort()).toEqual(["admin-a", "admin-c", "manager-a", "security-a"])
    // Containment runs both ways: `adminA` is unbounded on facilities, so it reaches past the
    // facility-bounded `adminC` and stays hidden from it.
    expect(ids(await app.inject({ method: "GET", url: "/api/admin/users", headers: as("adminC") })).sort()).toEqual(["admin-c", "manager-a", "security-a"])
    expect((await app.inject({ method: "GET", url: "/api/admin/users/admin-a", headers: as("adminC") })).statusCode).toBe(404)

    for (const request of [
      { method: "GET" as const, url: "/api/admin/users/manager-b" },
      { method: "PATCH" as const, url: "/api/admin/users/manager-b", payload: { fullName: "Ele Geçirildi" } },
      { method: "PATCH" as const, url: "/api/admin/users/manager-b/status", payload: { active: false } },
      { method: "PATCH" as const, url: "/api/admin/users/manager-b/role", payload: { role: "ADMIN" } },
      { method: "PUT" as const, url: "/api/admin/users/manager-b/scopes", payload: { companyIds: ["company-2"], facilityIds: [], securityGateIds: [] } },
      { method: "POST" as const, url: "/api/admin/users/manager-b/reset-password", payload: { password: "yeni-parola-123" } },
    ]) {
      const response = await app.inject({ ...request, headers: as("adminA") })
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } })
    }
  })

  it("refuses to grant a new or existing user a scope outside the acting Admin's own", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/admin/users", headers: as("adminA"),
      payload: { fullName: "Sızdıran Kullanıcı", username: "sizdiran", email: "sizdiran@example.test", password: "gecerli-parola", role: "MANAGER", active: true, authorizationScope: { companyIds: ["company-2"], facilityIds: [], securityGateIds: [] } },
    })
    expect(created.statusCode).toBe(403)
    expect(created.json()).toMatchObject({ error: { code: "OUT_OF_SCOPE" } })

    // Widening an in-scope user past the acting Admin's boundary is refused the same way.
    const widened = await app.inject({ method: "PUT", url: "/api/admin/users/manager-a/scopes", headers: as("adminA"), payload: { companyIds: ["company-1", "company-2"], facilityIds: [], securityGateIds: [] } })
    expect(widened.statusCode).toBe(403)
    expect(widened.json()).toMatchObject({ error: { code: "OUT_OF_SCOPE" } })

    // Existence and structural consistency are not authority: `facility-1b` exists and does belong
    // to the company being granted, yet lies outside the facility-bounded Admin's own scope.
    const sibling = await app.inject({ method: "PUT", url: "/api/admin/users/manager-a/scopes", headers: as("adminC"), payload: { companyIds: ["company-1"], facilityIds: ["facility-1b"], securityGateIds: [] } })
    expect(sibling.statusCode).toBe(403)
    expect(sibling.json()).toMatchObject({ error: { code: "OUT_OF_SCOPE" } })
  })

  it("refuses to let an Admin widen their own scope", async () => {
    const escalation = await app.inject({ method: "PUT", url: "/api/admin/users/admin-a/scopes", headers: as("adminA"), payload: { companyIds: ["company-1", "company-2"], facilityIds: [], securityGateIds: [] } })
    expect(escalation.statusCode).toBe(403)
    expect(escalation.json()).toMatchObject({ error: { code: "OUT_OF_SCOPE" } })

    const stillScoped = await app.inject({ method: "GET", url: "/api/admin/users/admin-a", headers: as("adminA") })
    expect(stillScoped.json()).toMatchObject({ authorizationScope: { companyIds: ["company-1"] } })

    // Dropping a facility restriction widens the scope just as adding a company does.
    const unbounded = await app.inject({ method: "PUT", url: "/api/admin/users/admin-c/scopes", headers: as("adminC"), payload: { companyIds: ["company-1"], facilityIds: [], securityGateIds: [] } })
    expect(unbounded.statusCode).toBe(403)
    expect(unbounded.json()).toMatchObject({ error: { code: "OUT_OF_SCOPE" } })
  })

  it("refuses organization writes that reach outside the acting Admin's scope", async () => {
    const renamed = await app.inject({ method: "PATCH", url: "/api/companies/company-2", headers: as("adminA"), payload: { name: "Ele Geçirildi", active: true } })
    expect(renamed.statusCode).toBe(404)

    const grafted = await app.inject({ method: "POST", url: "/api/facilities", headers: as("adminA"), payload: { parentId: "company-2", name: "Yeni Tesis", active: true } })
    expect(grafted.statusCode).toBe(404)
    expect(grafted.json()).toMatchObject({ error: { code: "PARENT_NOT_FOUND" } })
  })

  it("refuses root Company creation while leaving in-scope Company edits and child creation intact", async () => {
    const created = await app.inject({ method: "POST", url: "/api/companies", headers: as("adminA"), payload: { name: "Üçüncü Şirket", active: true } })
    expect(created.statusCode).toBe(403)
    expect(created.json()).toMatchObject({ error: { code: "OUT_OF_SCOPE" } })
    // No client-supplied id can dress the creation up as an edit of a record they cannot see.
    const smuggled = await app.inject({ method: "POST", url: "/api/companies", headers: as("adminA"), payload: { id: "company-2", name: "Üçüncü Şirket", active: true } })
    expect(smuggled.statusCode).toBe(400)
    expect(ids(await app.inject({ method: "GET", url: "/api/companies", headers: as("adminA") }))).toEqual(["company-1"])

    const edited = await app.inject({ method: "PATCH", url: "/api/companies/company-1", headers: as("adminA"), payload: { name: "Birinci Holding", active: true } })
    expect(edited.statusCode).toBe(200)
    expect(edited.json()).toMatchObject({ id: "company-1", name: "Birinci Holding" })

    const child = await app.inject({ method: "POST", url: "/api/facilities", headers: as("adminA"), payload: { parentId: "company-1", name: "Üçüncü Tesis", active: true } })
    expect(child.statusCode).toBe(201)
    expect(child.json()).toMatchObject({ parentId: "company-1", name: "Üçüncü Tesis" })
  })

  it("keeps in-scope Admin operations working", async () => {
    const facility = await app.inject({ method: "POST", url: "/api/facilities", headers: as("adminA"), payload: { parentId: "company-1", name: "İkinci Tesis", active: true } })
    expect(facility.statusCode).toBe(201)

    const renamed = await app.inject({ method: "PATCH", url: "/api/companies/company-1", headers: as("adminA"), payload: { name: "Birinci AŞ", active: true } })
    expect(renamed.statusCode).toBe(200)

    const created = await app.inject({
      method: "POST", url: "/api/admin/users", headers: as("adminA"),
      payload: { fullName: "Yeni Kullanıcı", username: "yenikullanici", email: "yeni@example.test", password: "gecerli-parola", role: "SECURITY", active: true, authorizationScope: { companyIds: ["company-1"], facilityIds: ["facility-1"], securityGateIds: ["gate-1"] } },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ authorizationScope: { companyIds: ["company-1"], facilityIds: ["facility-1"], securityGateIds: ["gate-1"] } })

    const updated = await app.inject({ method: "PATCH", url: "/api/admin/users/manager-a", headers: as("adminA"), payload: { fullName: "Yönetici Kullanıcı" } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ fullName: "Yönetici Kullanıcı" })

    const reset = await app.inject({ method: "POST", url: "/api/admin/users/manager-a/reset-password", headers: as("adminA"), payload: { password: "yeni-parola-123" } })
    expect(reset.statusCode).toBe(204)

    // The other tenant's Admin keeps working inside their own scope, unaffected by any of this.
    expect(ids(await app.inject({ method: "GET", url: "/api/admin/users", headers: as("adminB") })).sort()).toEqual(["admin-b", "manager-b"])
    expect((await app.inject({ method: "GET", url: "/api/companies/company-2", headers: as("adminB") })).statusCode).toBe(200)
  })
})
