import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildApp } from "../../app.js"
import { InMemoryAuthRepository } from "../../auth/testing/in-memory-auth-repository.js"
import { loadConfig } from "../../config/env.js"
import type { EmailSender } from "../../delivery/email-sender.js"
import { PublicInvitationInactiveError, type VisitorOperationsRepository } from "../../repositories/visitor-operations-repository.js"
import { hashToken } from "./service.js"
import type { InvitationStatus, MeetingDto, VisitDto, VisitStatus } from "./types.js"

/**
 * The unauthenticated pre-registration endpoints, driven through the real HTTP stack.
 *
 * A visit that leaves `PLANNED` or whose invitation stops being `SENT` between the service's
 * pre-check and the repository's write
 * transaction must surface as exactly the same `404 INVITATION_NOT_FOUND` an unknown token gets —
 * a public caller may not learn that the visit exists but was cancelled or already checked in.
 */

const config = loadConfig({
  DATABASE_URL: "sqlserver://localhost:1433;database=visitor_operations;user=sa;password=placeholder;encrypt=true;trustServerCertificate=true",
  NODE_ENV: "test",
})

const at = "2026-01-01T00:00:00.000Z"
const RAW_TOKEN = "public-invitation-token-value"
const meeting: MeetingDto = { id: "meeting-1", creatorEmployeeId: "employee-1", visitTypeId: "type-1", visitTypeName: "Toplantı", hostEmployeeName: "Maya Kara", hostCompanyId: "company-1", hostCompanyName: "BPLAS", facilityId: "facility-1", facilityName: "Merkez", plannedStart: at, plannedEnd: at, hasAdditionalRequirements: false, createdAt: at, updatedAt: at }
const activeRule = { id: "rule-1", version: 1, content: "Ziyaretçi kuralı", publishedAt: at, active: true }

/** Mirrors the production repository: persisted Visit and invitation states are re-checked at write time. */
function publicRepository(state: { status: VisitStatus; invitationStatus: InvitationStatus; statusAtWriteTime?: VisitStatus; invitationStatusAtWriteTime?: InvitationStatus }) {
  const visitor = { id: "visitor-1", firstName: "Ada", lastName: "Yılmaz", email: "ada@example.test", company: "Acme" }
  const writeStatus = () => state.statusAtWriteTime ?? state.status
  const writeInvitationStatus = () => state.invitationStatusAtWriteTime ?? state.invitationStatus
  const revalidate = () => { if (writeStatus() !== "PLANNED" || writeInvitationStatus() !== "SENT") throw new PublicInvitationInactiveError() }
  const visit = (): VisitDto => ({ id: "visit-1", meetingId: meeting.id, visitor, status: state.status, invitationStatus: state.invitationStatus, createdAt: at, updatedAt: at, meeting })
  return {
    findPublicPreRegistration: async (tokenHash: string) => tokenHash === hashToken(RAW_TOKEN) ? { visit: visit(), activeRule } : null,
    updatePublicVisitor: async () => { revalidate() },
    acceptPublicRule: async () => { revalidate(); return { id: "acceptance-1", ruleId: activeRule.id, ruleVersion: activeRule.version, acceptedAt: at, method: "INVITATION_LINK" as const, contentSnapshot: activeRule.content } },
  } as unknown as VisitorOperationsRepository
}

const emailSender: EmailSender = { send: async () => undefined }
const visitorPayload = { firstName: "Ada", lastName: "Yılmaz", company: "Acme", vehiclePlate: "16 ABC 123" }

describe("public invitation routes", () => {
  const state: { status: VisitStatus; invitationStatus: InvitationStatus; statusAtWriteTime?: VisitStatus; invitationStatusAtWriteTime?: InvitationStatus } = { status: "PLANNED", invitationStatus: "SENT" }
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    app = await buildApp(config, { authRepository: new InMemoryAuthRepository(), visitorOperationsRepository: publicRepository(state), emailSender })
  })
  afterAll(async () => { await app.close() })

  it("serves and mutates a PLANNED invitation", async () => {
    state.status = "PLANNED"; state.invitationStatus = "SENT"; state.statusAtWriteTime = undefined; state.invitationStatusAtWriteTime = undefined

    expect((await app.inject({ method: "GET", url: `/api/public/invitations/${RAW_TOKEN}` })).statusCode).toBe(200)
    expect((await app.inject({ method: "PATCH", url: `/api/public/invitations/${RAW_TOKEN}`, payload: visitorPayload })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `/api/public/invitations/${RAW_TOKEN}/rule-acceptances` })).statusCode).toBe(200)
  })

  it.each(["CANCELLED", "CHECKED_IN"] as const)("hides a visit that turned %s at write time behind the unknown-token 404", async (status) => {
    // The pre-check still reads PLANNED; only the repository's write sees the committed change.
    state.status = "PLANNED"; state.invitationStatus = "SENT"; state.statusAtWriteTime = status; state.invitationStatusAtWriteTime = undefined

    for (const request of [
      { method: "PATCH" as const, url: `/api/public/invitations/${RAW_TOKEN}`, payload: visitorPayload },
      { method: "POST" as const, url: `/api/public/invitations/${RAW_TOKEN}/rule-acceptances` },
    ]) {
      const response = await app.inject(request)
      const unknownToken = await app.inject({ ...request, url: request.url.replace(RAW_TOKEN, "unknown-invitation-token-value") })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: { code: "INVITATION_NOT_FOUND", message: "Davet bağlantısı geçersiz veya süresi dolmuş." } })
      expect(response.json()).toEqual(unknownToken.json())
    }
  })

  it("hides a reset PLANNED invitation from GET, PATCH, and rule acceptance without leaking why", async () => {
    state.status = "PLANNED"; state.invitationStatus = "NOT_SENT"; state.statusAtWriteTime = undefined; state.invitationStatusAtWriteTime = undefined

    for (const request of [
      { method: "GET" as const, url: `/api/public/invitations/${RAW_TOKEN}` },
      { method: "PATCH" as const, url: `/api/public/invitations/${RAW_TOKEN}`, payload: visitorPayload },
      { method: "POST" as const, url: `/api/public/invitations/${RAW_TOKEN}/rule-acceptances` },
    ]) {
      const response = await app.inject(request)
      const unknownToken = await app.inject({ ...request, url: request.url.replace(RAW_TOKEN, "unknown-invitation-token-value") })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: { code: "INVITATION_NOT_FOUND", message: "Davet bağlantısı geçersiz veya süresi dolmuş." } })
      expect(response.json()).toEqual(unknownToken.json())
    }
  })

  it("hides an invitation reset that commits after the public mutation pre-check", async () => {
    state.status = "PLANNED"; state.invitationStatus = "SENT"; state.statusAtWriteTime = undefined; state.invitationStatusAtWriteTime = "NOT_SENT"

    for (const request of [
      { method: "PATCH" as const, url: `/api/public/invitations/${RAW_TOKEN}`, payload: visitorPayload },
      { method: "POST" as const, url: `/api/public/invitations/${RAW_TOKEN}/rule-acceptances` },
    ]) {
      const response = await app.inject(request)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: { code: "INVITATION_NOT_FOUND", message: "Davet bağlantısı geçersiz veya süresi dolmuş." } })
    }
  })
})
