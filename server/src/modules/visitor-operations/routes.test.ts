import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"

import type { AuthGuards } from "../../auth/auth-guards.js"
import type { ApplicationRole, SessionUser } from "../../auth/auth-types.js"
import type { EmailSender } from "../../delivery/email-sender.js"
import { ApiError } from "../../lib/api-error.js"
import { VisitorCardConflictError, type VisitorOperationsRepository } from "../../repositories/visitor-operations-repository.js"
import { registerVisitorOperationsRoutes } from "./routes.js"
import { VisitorOperationsService } from "./service.js"
import type { MeetingDto, VisitDto, VisitorCardDto } from "./types.js"

const at = "2026-09-08T09:00:00.000Z"
const meeting: MeetingDto = {
  id: "meeting-1", creatorEmployeeId: "employee-1", visitTypeId: "type-1", visitTypeName: "Toplantı",
  hostEmployeeName: "Maya Kara", hostCompanyId: "company-1", hostCompanyName: "BPLAS",
  facilityId: "facility-1", facilityName: "Merkez", plannedStart: at, plannedEnd: at,
  hasAdditionalRequirements: false, createdAt: at, updatedAt: at,
}
const checkedIn: VisitDto = {
  id: "visit-1", meetingId: meeting.id, visitor: { id: "visitor-1", firstName: "Ada", lastName: "Yılmaz", company: "Acme" },
  status: "CHECKED_IN", invitationStatus: "NOT_SENT", visitorCardId: "card-1", visitorCardNumber: "001",
  createdAt: at, updatedAt: at, meeting,
}
const inUseCard: VisitorCardDto = {
  id: "card-1", cardNumber: "001", status: "IN_USE", assignedVisitId: "visit-1", assignedVisitorName: "Ada Yılmaz",
  createdAt: at, updatedAt: at,
}
const availableCard: VisitorCardDto = { ...inUseCard, status: "AVAILABLE", assignedVisitId: undefined, assignedVisitorName: undefined }

const apps: Awaited<ReturnType<typeof Fastify>>[] = []

async function createApp(role: ApplicationRole, repository: Partial<VisitorOperationsRepository>) {
  const app = Fastify()
  apps.push(app)
  app.decorateRequest("currentUser", null)
  const user: SessionUser = {
    id: `${role.toLowerCase()}-1`, username: role.toLowerCase(), fullName: role, initials: role.slice(0, 1), role,
    roleLabel: role, authenticationSource: "LOCAL", authorizationScope: { companyIds: ["company-1"], facilityIds: ["facility-1"], securityGateIds: [] }, employeeId: "employee-1",
  }
  const authenticate = async (request: { currentUser: SessionUser | null }) => { request.currentUser = user }
  const guards: AuthGuards = { requireAuthentication: authenticate, requireRole: () => authenticate }
  const emailSender: EmailSender = { send: async () => undefined }
  await registerVisitorOperationsRoutes(app, { service: new VisitorOperationsService(repository as VisitorOperationsRepository, emailSender, "https://web.example.test"), guards })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } })
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR" } })
  })
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("visitor-card lifecycle HTTP conflicts", () => {
  it("returns 409 for a late return while the Visit is still CHECKED_IN", async () => {
    const app = await createApp("SECURITY", {
      findVisit: async () => checkedIn,
      lateReturn: async () => { throw new VisitorCardConflictError("INVALID_LATE_RETURN_STATE") },
    })

    const response = await app.inject({ method: "POST", url: "/api/security/visits/visit-1/late-card-return" })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: "INVALID_CARD_TRANSITION" } })
  })

  it("returns 409 for checkout when the card assignment no longer matches", async () => {
    const app = await createApp("SECURITY", {
      findVisit: async () => checkedIn,
      checkOut: async () => { throw new VisitorCardConflictError("INVALID_CARD_ASSIGNMENT") },
    })

    const response = await app.inject({ method: "POST", url: "/api/security/visits/visit-1/check-out", payload: { cardReturned: true } })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: "CARD_ASSIGNMENT_CONFLICT" } })
  })

  it.each([
    { method: "PATCH" as const, url: "/api/admin/visitor-cards/card-1/status", payload: { active: false } },
    { method: "PATCH" as const, url: "/api/admin/visitor-cards/card-1", payload: { cardNumber: "002", active: true } },
  ])("returns 409 for an IN_USE Admin mutation: $method $url", async (request) => {
    const app = await createApp("ADMIN", { findCard: async () => inUseCard })

    const response = await app.inject(request)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: "CARD_OPERATIONAL" } })
  })

  it("deletes an AVAILABLE card over HTTP with 204 and no body", async () => {
    const deletedIds: string[] = []
    const app = await createApp("ADMIN", { findCard: async () => availableCard, deleteCard: async (id: string) => { deletedIds.push(id) } })

    const response = await app.inject({ method: "DELETE", url: "/api/admin/visitor-cards/card-1" })

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe("")
    expect(deletedIds).toEqual(["card-1"])
  })

  it("returns 409 CARD_OPERATIONAL when deleting a card that is still in circulation", async () => {
    const app = await createApp("ADMIN", { findCard: async () => inUseCard })

    const response = await app.inject({ method: "DELETE", url: "/api/admin/visitor-cards/card-1" })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: "CARD_OPERATIONAL" } })
  })

  it("returns 409 when an Admin rename loses the card expected-state race", async () => {
    const app = await createApp("ADMIN", {
      findCard: async () => availableCard,
      updateCard: async () => { throw new VisitorCardConflictError("CARD_STATE_CHANGED") },
    })

    const response = await app.inject({ method: "PATCH", url: "/api/admin/visitor-cards/card-1", payload: { cardNumber: "002", active: true } })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: "CARD_STATE_CONFLICT" } })
  })
})
