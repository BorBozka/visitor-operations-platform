import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"

import type { AuthGuards } from "../../auth/auth-guards.js"
import type { SessionUser } from "../../auth/auth-types.js"
import type { EmailSender } from "../../delivery/email-sender.js"
import { ApiError, forbiddenError, unauthorizedError } from "../../lib/api-error.js"
import type { VisitorOperationsRepository } from "../../repositories/visitor-operations-repository.js"
import { registerVisitorOperationsRoutes } from "../visitor-operations/routes.js"
import { VisitorOperationsService } from "../visitor-operations/service.js"
import type { EmployeeActor, MeetingDto, MeetingInput, MeetingWithVisitsDto, VisitDto } from "../visitor-operations/types.js"
import { registerAdminRoutes } from "./routes.js"
import { AdminService } from "./service.js"
import { InMemoryAdminRepository } from "./testing/in-memory-admin-repository.js"
import type { AdminUser } from "./types.js"

const timestamp = "2026-01-01T09:00:00.000Z"
const admin: AdminUser = { id: "admin-1", fullName: "Admin", username: "admin", email: "admin@example.com", authenticationSource: "LOCAL", role: "ADMIN", authorizationScope: { companyIds: ["company-1"], facilityIds: [], securityGateIds: [] }, active: true, createdAt: timestamp, updatedAt: timestamp }
const references = { companyIds: ["company-1"], facilities: [{ id: "facility-1", companyId: "company-1" }], gates: [] }
const scope = { companyIds: ["company-1"], facilityIds: ["facility-1"], securityGateIds: [] }
const apps: Awaited<ReturnType<typeof Fastify>>[] = []

async function createApp() {
  const repository = new InMemoryAdminRepository([admin], references)
  let meetingCreatorEmployeeId: string | null = null
  let unplannedCreatorEmployeeId: string | null = null

  const employeeActor = async (userId: string): Promise<EmployeeActor | null> => {
    const [user, profile] = await Promise.all([repository.findUser(userId), repository.findEmployeeProfileByUserId(userId)])
    return user && profile ? { id: profile.id, userId, fullName: profile.fullName, companyId: profile.companyId, facilityIds: profile.facilityIds, email: user.email, role: user.role } : null
  }
  const meeting = (input: MeetingInput, creatorEmployeeId: string, hostEmployeeId: string | null): MeetingWithVisitsDto => {
    const dto: MeetingDto = { id: "meeting-1", creatorEmployeeId, visitTypeId: input.visitTypeId, visitTypeName: "Toplantı", ...(hostEmployeeId ? { hostEmployeeId } : {}), hostEmployeeName: input.hostEmployeeName, hostCompanyId: input.hostCompanyId, hostCompanyName: "Şirket", facilityId: input.facilityId, facilityName: "Tesis", plannedStart: input.plannedStart, plannedEnd: input.plannedEnd, hasAdditionalRequirements: false, createdAt: timestamp, updatedAt: timestamp }
    const visit: VisitDto = { id: "visit-1", meetingId: dto.id, visitor: { id: "visitor-1", firstName: input.visitors[0].firstName, lastName: input.visitors[0].lastName, company: input.visitors[0].company }, status: "PLANNED", invitationStatus: "NOT_SENT", createdAt: timestamp, updatedAt: timestamp, meeting: dto }
    return { meeting: dto, visits: [visit] }
  }

  const visitorRepository = {
    findEmployeeByUserId: employeeActor,
    findEmployeeById: async (id: string) => {
      const users = await repository.listUsers()
      for (const user of users) {
        const actor = await employeeActor(user.id)
        if (actor?.id === id) return actor
      }
      return null
    },
    findVisitType: async () => ({ id: "type-1", name: "Toplantı", active: true, createdAt: timestamp, updatedAt: timestamp }),
    createMeeting: async (input: MeetingInput, creatorEmployeeId: string, hostEmployeeId: string | null) => { meetingCreatorEmployeeId = creatorEmployeeId; return meeting(input, creatorEmployeeId, hostEmployeeId) },
    createUnplanned: async (input: { firstName: string; lastName: string; company: string; companyId: string; facilityId: string }, creatorEmployeeId: string) => {
      unplannedCreatorEmployeeId = creatorEmployeeId
      const parent: MeetingDto = { id: "meeting-unplanned", creatorEmployeeId, visitTypeId: "type-1", visitTypeName: "Toplantı", hostEmployeeName: "Danışma", hostCompanyId: input.companyId, hostCompanyName: "Şirket", facilityId: input.facilityId, facilityName: "Tesis", plannedStart: timestamp, plannedEnd: timestamp, hasAdditionalRequirements: false, createdAt: timestamp, updatedAt: timestamp }
      return { id: "visit-unplanned", meetingId: parent.id, visitor: { id: "visitor-unplanned", firstName: input.firstName, lastName: input.lastName, company: input.company }, status: "CHECKED_IN", invitationStatus: "NOT_SENT", actualCheckIn: timestamp, createdAt: timestamp, updatedAt: timestamp, meeting: parent } satisfies VisitDto
    },
  } as unknown as VisitorOperationsRepository

  const sessionFor = async (userId: string): Promise<SessionUser | null> => {
    const user = await repository.findUser(userId)
    if (!user) return null
    const profile = await repository.findEmployeeProfileByUserId(userId)
    return { id: user.id, username: user.username, fullName: user.fullName, initials: "U", role: user.role, roleLabel: user.role, authenticationSource: user.authenticationSource, authorizationScope: user.authorizationScope, employeeId: profile?.id ?? null }
  }
  const authenticate = async (request: { headers: Record<string, unknown>; currentUser: SessionUser | null }) => {
    const userId = String(request.headers["x-test-user"] ?? "")
    const user = await sessionFor(userId)
    if (!user) throw unauthorizedError()
    request.currentUser = user
  }
  const guards: AuthGuards = {
    requireAuthentication: authenticate,
    requireRole: (...roles) => async (request) => { await authenticate(request); if (!request.currentUser || !roles.includes(request.currentUser.role)) throw forbiddenError() },
  }

  const app = Fastify()
  apps.push(app)
  app.decorateRequest("currentUser", null)
  await registerAdminRoutes(app, { service: new AdminService(repository), guards })
  const emailSender: EmailSender = { send: async () => undefined }
  await registerVisitorOperationsRoutes(app, { service: new VisitorOperationsService(visitorRepository, emailSender, "https://web.example.test", undefined, () => new Date(timestamp)), guards })
  app.setErrorHandler((error, _request, reply) => error instanceof ApiError ? reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } }) : reply.status(500).send({ error: { code: "INTERNAL_ERROR" } }))
  return { app, repository, meetingCreator: () => meetingCreatorEmployeeId, unplannedCreator: () => unplannedCreatorEmployeeId }
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe("newly provisioned operational users", () => {
  it("resolves a newly created EMPLOYEE as the actor of a basic Visit creation route", async () => {
    const { app, repository, meetingCreator } = await createApp()
    const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: { "x-test-user": admin.id }, payload: { fullName: "Yeni Çalışan", username: "calisan", email: "calisan@example.com", password: "temporary-password", role: "EMPLOYEE", authorizationScope: scope, active: true } })
    expect(created.statusCode).toBe(201)
    const user = created.json<AdminUser>()
    const profile = await repository.findEmployeeProfileByUserId(user.id)

    const response = await app.inject({ method: "POST", url: "/api/meetings", headers: { "x-test-user": user.id }, payload: { visitors: [{ firstName: "Ada", lastName: "Yılmaz", company: "Acme" }], visitTypeId: "type-1", hostEmployeeId: profile!.id, hostEmployeeName: user.fullName, hostCompanyId: "company-1", facilityId: "facility-1", plannedStart: "2026-01-01T09:00:00.000Z", plannedEnd: "2026-01-01T10:00:00.000Z" } })

    expect(response.statusCode).toBe(201)
    expect(meetingCreator()).toBe(profile!.id)
  })

  it("resolves a newly created SECURITY user for unplanned Visit creation without EMPLOYEE_PROFILE_REQUIRED", async () => {
    const { app, repository, unplannedCreator } = await createApp()
    const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: { "x-test-user": admin.id }, payload: { fullName: "Yeni Güvenlik", username: "security", email: "security@example.com", password: "temporary-password", role: "SECURITY", authorizationScope: scope, active: true } })
    expect(created.statusCode).toBe(201)
    const user = created.json<AdminUser>()
    const profile = await repository.findEmployeeProfileByUserId(user.id)

    const response = await app.inject({ method: "POST", url: "/api/security/unplanned-visits", headers: { "x-test-user": user.id }, payload: { firstName: "Ada", lastName: "Yılmaz", company: "Acme", hostEmployeeName: "Danışma", visitTypeId: "type-1", durationMinutes: 30, visitorCardId: "card-1", rulesAccepted: true, companyId: "company-1", facilityId: "facility-1" } })

    expect(response.statusCode).toBe(201)
    expect(response.json()).not.toMatchObject({ error: { code: "EMPLOYEE_PROFILE_REQUIRED" } })
    expect(unplannedCreator()).toBe(profile!.id)
  })
})
