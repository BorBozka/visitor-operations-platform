import { describe, expect, it, vi } from "vitest"

import type { AccessContext } from "../../lib/authorization.js"
import type { EmailMessage, EmailSender } from "../../delivery/email-sender.js"
import { CheckInConflictError, NoActiveVisitorRuleError, PublicInvitationInactiveError, VisitorCardConflictError, type VisitorOperationsRepository } from "../../repositories/visitor-operations-repository.js"
import { assertMeetingPlanningUnlocked } from "./meeting-planning-lock.js"
import { VisitorOperationsService, hashToken } from "./service.js"
import type { MeetingDto, MeetingInput, VisitDto, VisitorCardDto, VisitorRuleDto, VisitStatus } from "./types.js"

const now = new Date("2026-09-02T10:00:00.000Z")
const scope = { companyIds: ["company-1"], facilityIds: [], securityGateIds: [] }
// Fixture meetings are created by employee-1 in company-1; these contexts own / operate on them.
const OWNER: AccessContext = { userId: "user-1", role: "EMPLOYEE", employeeId: "employee-1", scope }
const SECURITY_CTX: AccessContext = { userId: "user-1", role: "SECURITY", employeeId: "security-1", scope }
const meeting: MeetingDto = { id: "meeting-1", creatorEmployeeId: "employee-1", visitTypeId: "type-1", visitTypeName: "Toplantı", hostEmployeeId: "host-1", hostEmployeeName: "Maya Kara", hostCompanyId: "company-1", hostCompanyName: "BPLAS", facilityId: "facility-1", facilityName: "Merkez", plannedStart: "2026-09-03T09:00:00.000Z", plannedEnd: "2026-09-03T10:00:00.000Z", hasAdditionalRequirements: false, createdAt: now.toISOString(), updatedAt: now.toISOString() }
function visit(overrides: Partial<VisitDto> = {}): VisitDto { return { id: "visit-1", meetingId: meeting.id, visitor: { id: "visitor-1", firstName: "Ada", lastName: "Yılmaz", email: "ada@example.test", company: "Acme" }, status: "PLANNED", invitationStatus: "NOT_SENT", createdAt: now.toISOString(), updatedAt: now.toISOString(), meeting, ...overrides } }

class FakeEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = []
  fail = false
  async send(message: EmailMessage) { this.messages.push(message); if (this.fail) throw new Error("smtp connection refused") }
}

function unusedRepository(overrides: Record<string, unknown>): VisitorOperationsRepository {
  return {
    listVisitTypes: async () => [], findVisitType: async () => null, saveVisitType: async () => { throw new Error("unused") }, listMeetings: async () => [], listVisits: async () => [], findMeeting: async () => null, findVisit: async () => null,
    findEmployeeByUserId: async () => null, findEmployeeById: async () => null, findActiveEmployeeByName: async () => null, getReferenceData: async () => ({}), createMeeting: async () => { throw new Error("unused") }, updateMeeting: async () => { throw new Error("unused") }, updateMeetingTimes: async () => undefined, extendMeetingTimes: async () => undefined, cancelVisit: async () => undefined, cancelMeeting: async () => undefined, closeMeeting: async () => undefined,
    prepareInvitation: async () => { throw new Error("unused") }, finishInvitation: async () => undefined, findPublicPreRegistration: async () => null, updatePublicVisitor: async () => undefined, acceptPublicRule: async () => { throw new Error("unused") }, listRules: async () => [], getActiveRule: async () => null, publishRule: async () => { throw new Error("unused") }, listCards: async () => [], findCard: async () => null, saveCard: async () => { throw new Error("unused") }, updateCard: async () => { throw new Error("unused") }, setCardStatus: async () => { throw new Error("unused") }, deleteCard: async () => undefined, checkIn: async () => { throw new Error("unused") }, checkOut: async () => undefined, listUnreturnedIssues: async () => [], lateReturn: async () => undefined, createUnplanned: async () => { throw new Error("unused") }, correctVisitor: async () => undefined,
    ...overrides,
  } as VisitorOperationsRepository
}

const cardAt = "2026-09-08T09:00:00.000Z"
function card(overrides: Partial<VisitorCardDto> = {}): VisitorCardDto {
  return { id: "card-1", cardNumber: "001", status: "AVAILABLE", createdAt: cardAt, updatedAt: cardAt, ...overrides }
}

describe("VisitorOperationsService card deletion", () => {
  it.each(["AVAILABLE", "DISABLED"] as const)("deletes an out-of-circulation %s card, asserting its expected state", async (status) => {
    const deleted: { id: string; expected: unknown }[] = []
    const service = new VisitorOperationsService(unusedRepository({
      findCard: async () => card({ status }),
      deleteCard: async (id: string, expected: unknown) => { deleted.push({ id, expected }) },
    }), new FakeEmailSender(), "https://web.example.test")

    await expect(service.deleteCard("card-1")).resolves.toBeUndefined()
    expect(deleted).toEqual([{ id: "card-1", expected: { status, currentVisitId: null } }])
  })

  it.each(["IN_USE", "NOT_RETURNED", "LOST"] as const)("refuses to delete a %s card so its lifecycle cannot be bypassed", async (status) => {
    const service = new VisitorOperationsService(unusedRepository({
      findCard: async () => card({ status, assignedVisitId: "visit-1" }),
      deleteCard: async () => { throw new Error("must not delete") },
    }), new FakeEmailSender(), "https://web.example.test")

    await expect(service.deleteCard("card-1")).rejects.toMatchObject({ statusCode: 409, code: "CARD_OPERATIONAL" })
  })

  it("maps a lost expected-state race to a card conflict instead of deleting", async () => {
    const service = new VisitorOperationsService(unusedRepository({
      findCard: async () => card(),
      deleteCard: async () => { throw new VisitorCardConflictError("CARD_STATE_CHANGED") },
    }), new FakeEmailSender(), "https://web.example.test")

    await expect(service.deleteCard("card-1")).rejects.toMatchObject({ statusCode: 409, code: "CARD_STATE_CONFLICT" })
  })
})

function invitationFixture(initial = visit()) {
  let current = initial
  let tokenHash: string | undefined
  const repository = unusedRepository({
    findVisit: async () => current,
    prepareInvitation: async (_id: string, value: string) => { tokenHash = value; current = { ...current, invitationStatus: "SENDING" }; return { visit: current, claimed: true } },
    finishInvitation: async (_id: string, succeeded: boolean) => { current = { ...current, invitationStatus: succeeded ? "SENT" : "FAILED", invitationError: succeeded ? undefined : "Davet teknik bir hata nedeniyle gönderilemedi." } },
  })
  return { repository, get: () => current, tokenHash: () => tokenHash }
}

describe("VisitorOperationsService invitations", () => {
  it("sends an email using a raw opaque token while persisting only its hash", async () => {
    const email = new FakeEmailSender(), fixture = invitationFixture()
    const service = new VisitorOperationsService(fixture.repository, email, "https://web.example.test", undefined, () => now, () => "opaque-token-value")

    const result = await service.sendVisitInvitation("visit-1", OWNER)

    expect(result.invitationStatus).toBe("SENT")
    expect(email.messages).toHaveLength(1)
    expect(email.messages[0].text).toContain("token=opaque-token-value")
    expect(fixture.tokenHash()).toBe(hashToken("opaque-token-value"))
    expect(fixture.tokenHash()).not.toContain("opaque-token-value")
  })

  it("marks a failed delivery with the safe public error and supports retry", async () => {
    const email = new FakeEmailSender(), fixture = invitationFixture(); email.fail = true
    const service = new VisitorOperationsService(fixture.repository, email, "https://web.example.test", undefined, () => now, () => "retry-token")
    await expect(service.sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "FAILED", invitationError: "Davet teknik bir hata nedeniyle gönderilemedi." })
    email.fail = false
    await expect(service.sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })
    expect(email.messages).toHaveLength(2)
  })

  it("does not send duplicate SENT invitations and skips no-email visitors in a meeting batch", async () => {
    const email = new FakeEmailSender()
    const sent = visit({ id: "sent", invitationStatus: "SENT" })
    const noEmail = visit({ id: "none", visitor: { ...visit().visitor, email: undefined } })
    const ready = visit({ id: "ready" })
    let current = ready
    const repository = unusedRepository({
      findMeeting: async () => ({ meeting, visits: [sent, noEmail, current] }),
      findVisit: async (id: string) => id === "ready" ? current : id === "sent" ? sent : noEmail,
      prepareInvitation: async () => { current = { ...current, invitationStatus: "SENDING" }; return { visit: current, claimed: true } },
      finishInvitation: async (_id: string, succeeded: boolean) => { current = { ...current, invitationStatus: succeeded ? "SENT" : "FAILED" } },
    })
    const service = new VisitorOperationsService(repository, email, "https://web.example.test", undefined, () => now, () => "batch-token")

    const results = await service.sendMeetingInvitations("meeting-1", OWNER)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe("ready")
    expect(email.messages).toHaveLength(1)
    await expect(service.sendVisitInvitation("sent", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })
    expect(email.messages).toHaveLength(1)
  })

  it("resets a sent invitation during reschedule and allows it to be sent again", async () => {
    const email = new FakeEmailSender()
    let current = visit({ invitationStatus: "SENT", invitationSentAt: "2026-09-02T08:00:00.000Z" })
    const repository = unusedRepository({
      findEmployeeByUserId: async () => ({ id: "employee-1", userId: "user-1", fullName: "Ada", companyId: "company-1", facilityIds: ["facility-1"] }),
      findVisit: async () => current,
      findMeeting: async () => ({ meeting, visits: [current] }),
      updateMeetingTimes: async (_id: string, plannedStart: Date, plannedEnd: Date) => {
        current = { ...current, invitationStatus: "NOT_SENT", invitationSentAt: undefined, invitationError: undefined, meeting: { ...current.meeting, plannedStart: plannedStart.toISOString(), plannedEnd: plannedEnd.toISOString() } }
      },
      prepareInvitation: async () => {
        current = { ...current, invitationStatus: "SENDING" }
        return { visit: current, claimed: true }
      },
      finishInvitation: async (_id: string, succeeded: boolean) => {
        current = { ...current, invitationStatus: succeeded ? "SENT" : "FAILED", invitationSentAt: succeeded ? now.toISOString() : undefined }
      },
    })
    const service = new VisitorOperationsService(repository, email, "https://web.example.test", undefined, () => now, () => "resend-token")

    await expect(service.rescheduleVisit("visit-1", { plannedStart: "2026-09-04T09:00:00.000Z", plannedEnd: "2026-09-04T10:00:00.000Z" }, OWNER)).resolves.toMatchObject({ invitationStatus: "NOT_SENT" })
    await expect(service.sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })
    expect(email.messages).toHaveLength(1)
    expect(email.messages[0].text).toContain("token=resend-token")
  })
})

describe("VisitorOperationsService security delivery boundary", () => {
  it("commits planned check-in despite host email failure", async () => {
    const email = new FakeEmailSender(); email.fail = true
    const checkedIn = visit({ status: "CHECKED_IN", actualCheckIn: now.toISOString(), ruleAcceptance: { id: "acceptance-1", ruleId: "rule-1", ruleVersion: 1, acceptedAt: now.toISOString(), method: "INVITATION_LINK", contentSnapshot: "Kural" } })
    const checkIn = vi.fn(async () => ({ visit: checkedIn, hostEmail: "host@example.test", hostName: "Maya Kara" }))
    const repository = unusedRepository({ findVisit: async () => visit({ ruleAcceptance: checkedIn.ruleAcceptance }), findCard: async () => ({ id: "card-1", cardNumber: "001", status: "AVAILABLE", createdAt: now.toISOString(), updatedAt: now.toISOString() }), checkIn })
    const service = new VisitorOperationsService(repository, email, "https://web.example.test", undefined, () => now)

    await expect(service.checkInVisit("visit-1", { visitorCardId: "card-1" }, SECURITY_CTX)).resolves.toEqual(checkedIn)
    await new Promise((resolve) => setImmediate(resolve))
    expect(checkIn).toHaveBeenCalledOnce()
    expect(email.messages).toHaveLength(1)
  })

  it("does not attempt host notification for unplanned free-text hosts", async () => {
    const email = new FakeEmailSender()
    const repository = unusedRepository({
      findEmployeeByUserId: async () => ({ id: "security-1", userId: "user-1", fullName: "Güvenlik", companyId: "company-1", facilityIds: ["facility-1"] }),
      findVisitType: async () => ({ id: "type-1", name: "Toplantı", active: true, createdAt: now.toISOString(), updatedAt: now.toISOString() }),
      createUnplanned: async () => visit({ status: "CHECKED_IN", actualCheckIn: now.toISOString() }),
    })
    const service = new VisitorOperationsService(repository, email, "https://web.example.test", undefined, () => now)
    await service.createAndCheckInUnplanned({ firstName: "Ada", lastName: "Yılmaz", company: "Acme", hostEmployeeName: "Serbest Ev Sahibi", visitTypeId: "type-1", durationMinutes: 30, visitorCardId: "card-1", rulesAccepted: true, companyId: "company-1", facilityId: "facility-1" }, SECURITY_CTX)
    expect(email.messages).toHaveLength(0)
  })

  it("maps a missing active visitor rule to the existing conflict contract", async () => {
    const repository = unusedRepository({
      findEmployeeByUserId: async () => ({ id: "security-1", userId: "user-1", fullName: "Güvenlik", companyId: "company-1", facilityIds: ["facility-1"] }),
      findVisitType: async () => ({ id: "type-1", name: "Toplantı", active: true, createdAt: now.toISOString(), updatedAt: now.toISOString() }),
      createUnplanned: async () => { throw new NoActiveVisitorRuleError() },
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await expect(service.createAndCheckInUnplanned({ firstName: "Ada", lastName: "Yılmaz", company: "Acme", hostEmployeeName: "Serbest Ev Sahibi", visitTypeId: "type-1", durationMinutes: 30, visitorCardId: "card-1", rulesAccepted: true, companyId: "company-1", facilityId: "facility-1" }, SECURITY_CTX)).rejects.toMatchObject({
      statusCode: 409,
      code: "NO_ACTIVE_RULE",
      message: "Aktif ziyaretçi kuralı bulunmuyor.",
    })
  })

  it("keeps unrelated unplanned repository errors as unexpected failures", async () => {
    const repository = unusedRepository({
      findEmployeeByUserId: async () => ({ id: "security-1", userId: "user-1", fullName: "Güvenlik", companyId: "company-1", facilityIds: ["facility-1"] }),
      findVisitType: async () => ({ id: "type-1", name: "Toplantı", active: true, createdAt: now.toISOString(), updatedAt: now.toISOString() }),
      createUnplanned: async () => { throw new Error("database unavailable") },
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await expect(service.createAndCheckInUnplanned({ firstName: "Ada", lastName: "Yılmaz", company: "Acme", hostEmployeeName: "Serbest Ev Sahibi", visitTypeId: "type-1", durationMinutes: 30, visitorCardId: "card-1", rulesAccepted: true, companyId: "company-1", facilityId: "facility-1" }, SECURITY_CTX)).rejects.toThrow("database unavailable")
  })

  it("maps a concurrent check-in loser to a safe conflict", async () => {
    const accepted = { id: "acceptance-1", ruleId: "rule-1", ruleVersion: 1, acceptedAt: now.toISOString(), method: "INVITATION_LINK" as const, contentSnapshot: "Kural" }
    const repository = unusedRepository({
      findVisit: async () => visit({ ruleAcceptance: accepted }),
      findCard: async () => ({ id: "card-1", cardNumber: "001", status: "AVAILABLE", createdAt: now.toISOString(), updatedAt: now.toISOString() }),
      checkIn: async () => { throw new CheckInConflictError() },
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await expect(service.checkInVisit("visit-1", { visitorCardId: "card-1" }, SECURITY_CTX)).rejects.toMatchObject({
      statusCode: 409,
      code: "CHECK_IN_CONFLICT",
      message: "Ziyaret veya kart durumu değişti. Güncel durumu kontrol edip yeniden deneyin.",
    })
  })
})

describe("Visitor operations state guards", () => {
  it("keeps inactive types usable in history but rejects them for a new meeting", async () => {
    const email = new FakeEmailSender()
    const inactive = { id: "type-1", name: "Eski", active: false, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    const repository = unusedRepository({ listVisitTypes: async () => [inactive], findVisitType: async () => inactive, findEmployeeByUserId: async () => ({ id: "employee-1", userId: "user-1", fullName: "Maya", companyId: "company-1", facilityIds: ["facility-1"] }), findActiveEmployeeByName: async () => ({ id: "host-1", userId: "host-user", fullName: "Maya", companyId: "company-1", facilityIds: ["facility-1"] }) })
    const service = new VisitorOperationsService(repository, email, "https://web.example.test", undefined, () => now)
    await expect(service.createMeeting({ visitors: [{ firstName: "Ada", lastName: "Yılmaz", company: "Acme" }], visitTypeId: "type-1", hostEmployeeName: "Maya", hostCompanyId: "company-1", facilityId: "facility-1", plannedStart: "2026-09-03T09:00:00.000Z", plannedEnd: "2026-09-03T10:00:00.000Z" }, OWNER)).rejects.toMatchObject({ code: "INACTIVE_VISIT_TYPE" })
  })

  it("allows only NOT_RETURNED to LOST and LOST to AVAILABLE", async () => {
    const email = new FakeEmailSender(), setStatus = vi.fn(async (_id: string, status: string) => ({ id: "card-1", cardNumber: "001", status: status as "LOST", createdAt: now.toISOString(), updatedAt: now.toISOString() }))
    const repository = unusedRepository({ findCard: async () => ({ id: "card-1", cardNumber: "001", status: "NOT_RETURNED", assignedVisitId: "visit-1", createdAt: now.toISOString(), updatedAt: now.toISOString() }), setCardStatus: setStatus })
    const service = new VisitorOperationsService(repository, email, "https://web.example.test", undefined, () => now)
    await expect(service.markCardLost("card-1")).resolves.toMatchObject({ status: "LOST" })
    expect(setStatus).toHaveBeenCalledWith("card-1", "LOST", { status: "NOT_RETURNED", currentVisitId: "visit-1" })
  })

  it("disables AVAILABLE cards and enables DISABLED cards with their expected state", async () => {
    let status: "AVAILABLE" | "DISABLED" = "AVAILABLE"
    const setCardStatus = vi.fn(async (_id: string, next: "AVAILABLE" | "DISABLED") => {
      status = next
      return { id: "card-1", cardNumber: "001", status, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    })
    const repository = unusedRepository({
      findCard: async () => ({ id: "card-1", cardNumber: "001", status, createdAt: now.toISOString(), updatedAt: now.toISOString() }),
      setCardStatus,
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await expect(service.setCardActive("card-1", false)).resolves.toMatchObject({ status: "DISABLED" })
    await expect(service.setCardActive("card-1", true)).resolves.toMatchObject({ status: "AVAILABLE" })
    expect(setCardStatus).toHaveBeenNthCalledWith(1, "card-1", "DISABLED", { status: "AVAILABLE", currentVisitId: null })
    expect(setCardStatus).toHaveBeenNthCalledWith(2, "card-1", "AVAILABLE", { status: "DISABLED", currentVisitId: null })
  })

  it("returns 409 when an Admin mutation loses its expected-state race", async () => {
    const repository = unusedRepository({
      findCard: async () => ({ id: "card-1", cardNumber: "001", status: "AVAILABLE", createdAt: now.toISOString(), updatedAt: now.toISOString() }),
      setCardStatus: async () => { throw new VisitorCardConflictError("CARD_STATE_CHANGED") },
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await expect(service.setCardActive("card-1", false)).rejects.toMatchObject({ statusCode: 409, code: "CARD_STATE_CONFLICT" })
  })

  it("returns 409 for operational-card Admin disable and rename attempts", async () => {
    const updateCard = vi.fn()
    const setCardStatus = vi.fn()
    const repository = unusedRepository({
      findCard: async () => ({ id: "card-1", cardNumber: "001", status: "IN_USE", assignedVisitId: "visit-1", createdAt: now.toISOString(), updatedAt: now.toISOString() }),
      updateCard,
      setCardStatus,
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await expect(service.setCardActive("card-1", false)).rejects.toMatchObject({ statusCode: 409, code: "CARD_OPERATIONAL" })
    await expect(service.updateCard("card-1", { cardNumber: "002", active: true })).rejects.toMatchObject({ statusCode: 409, code: "CARD_OPERATIONAL" })
    expect(updateCard).not.toHaveBeenCalled()
    expect(setCardStatus).not.toHaveBeenCalled()
  })

  it("returns 409 instead of 500 for invalid checkout assignment and late-return state", async () => {
    const checkedIn = visit({ status: "CHECKED_IN", visitorCardId: "card-1", visitorCardNumber: "001" })
    const repository = unusedRepository({
      findVisit: async () => checkedIn,
      checkOut: async () => { throw new VisitorCardConflictError("INVALID_CARD_ASSIGNMENT") },
      lateReturn: async () => { throw new VisitorCardConflictError("INVALID_LATE_RETURN_STATE") },
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await expect(service.checkOutVisit("visit-1", true, SECURITY_CTX)).rejects.toMatchObject({ statusCode: 409, code: "CARD_ASSIGNMENT_CONFLICT" })
    await expect(service.receiveLateCardReturn("visit-1", SECURITY_CTX)).rejects.toMatchObject({ statusCode: 409, code: "INVALID_CARD_TRANSITION" })
  })
})

describe("Meeting shared planning invariant", () => {
  const host = { id: "host-1", userId: "host-user", fullName: "Maya Kara", companyId: "company-1", facilityIds: ["facility-1"] }
  const visitType = { id: "type-1", name: "Toplantı", active: true, createdAt: now.toISOString(), updatedAt: now.toISOString() }
  const lockingStatuses: VisitStatus[] = ["CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"]
  const editInput: MeetingInput = {
    visitors: [
      { visitId: "visit-1", firstName: "Ada", lastName: "Yılmaz", email: "ada@example.test", company: "Acme" },
      { visitId: "visit-2", firstName: "Deniz", lastName: "Yılmaz", email: "deniz@example.test", company: "Acme" },
    ],
    visitTypeId: "type-1", hostEmployeeId: "host-1", hostEmployeeName: "Maya Kara", hostCompanyId: "company-1", facilityId: "facility-1",
    plannedStart: "2026-09-04T13:00:00.000Z", plannedEnd: "2026-09-04T14:00:00.000Z",
  }
  const reschedule = { plannedStart: "2026-09-05T09:00:00.000Z", plannedEnd: "2026-09-05T10:00:00.000Z" }

  /** A meeting group of two visits: the first stays PLANNED, the second carries `secondStatus`. */
  function planningFixture(secondStatus: VisitStatus) {
    const first = visit({ id: "visit-1" })
    const second = visit({ id: "visit-2", status: secondStatus, visitor: { id: "visitor-2", firstName: "Deniz", lastName: "Yılmaz", company: "Acme" } })
    let submitted: MeetingInput | undefined
    const updateMeeting = vi.fn(async (_id: string, input: MeetingInput) => { submitted = input; return { meeting, visits: [first, second] } })
    const updateMeetingTimes = vi.fn(async () => undefined)
    const repository = unusedRepository({
      findMeeting: async () => ({ meeting, visits: [first, second] }),
      findVisit: async (id: string) => (id === "visit-2" ? second : first),
      findVisitType: async () => visitType,
      findEmployeeById: async () => host,
      findActiveEmployeeByName: async () => host,
      updateMeeting,
      updateMeetingTimes,
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)
    return { service, submitted: () => submitted, updateMeeting, updateMeetingTimes }
  }

  it("edits the shared meeting fields while every visit is still PLANNED", async () => {
    const fixture = planningFixture("PLANNED")

    await fixture.service.updateMeeting("meeting-1", editInput, OWNER)

    expect(fixture.updateMeeting).toHaveBeenCalledOnce()
    expect(fixture.submitted()).toMatchObject({ plannedStart: "2026-09-04T13:00:00.000Z", plannedEnd: "2026-09-04T14:00:00.000Z", hostEmployeeName: "Maya Kara" })
  })

  it("reschedules the meeting time window while every visit is still PLANNED", async () => {
    const fixture = planningFixture("PLANNED")

    await fixture.service.rescheduleVisit("visit-1", reschedule, OWNER)

    expect(fixture.updateMeetingTimes).toHaveBeenCalledWith("meeting-1", new Date(reschedule.plannedStart), new Date(reschedule.plannedEnd))
  })

  it.each(lockingStatuses)("rejects a meeting edit while a %s visit is in the group", async (status) => {
    const fixture = planningFixture(status)

    await expect(fixture.service.updateMeeting("meeting-1", editInput, OWNER)).rejects.toMatchObject({ statusCode: 409, code: "MEETING_VISITS_NOT_PLANNED" })

    expect(fixture.updateMeeting).not.toHaveBeenCalled()
    expect(meeting).toMatchObject({ plannedStart: "2026-09-03T09:00:00.000Z", plannedEnd: "2026-09-03T10:00:00.000Z", hostEmployeeId: "host-1", hostEmployeeName: "Maya Kara", hostCompanyId: "company-1", facilityId: "facility-1", visitTypeId: "type-1" })
  })

  it.each(lockingStatuses)("rejects rescheduling the still PLANNED visit while a %s visit is in the group", async (status) => {
    const fixture = planningFixture(status)

    await expect(fixture.service.rescheduleVisit("visit-1", reschedule, OWNER)).rejects.toMatchObject({ statusCode: 409, code: "MEETING_VISITS_NOT_PLANNED" })

    expect(fixture.updateMeetingTimes).not.toHaveBeenCalled()
    expect(meeting).toMatchObject({ plannedStart: "2026-09-03T09:00:00.000Z", plannedEnd: "2026-09-03T10:00:00.000Z" })
  })

  it("surfaces the repository guard when a visit stops being PLANNED after the service snapshot", async () => {
    const first = visit({ id: "visit-1" })
    let second = visit({ id: "visit-2", visitor: { id: "visitor-2", firstName: "Deniz", lastName: "Yılmaz", company: "Acme" } })
    // The repository re-checks the invariant inside its write transaction; this fake stands in
    // for that re-read, so the check-in below cannot be missed the way the snapshot misses it.
    const updateMeeting = vi.fn(async () => { assertMeetingPlanningUnlocked([first.status, second.status]); return { meeting, visits: [first, second] } })
    const repository = unusedRepository({
      findMeeting: async () => {
        const snapshot = { meeting, visits: [first, second] }
        second = { ...second, status: "CHECKED_IN" } // a Security check-in commits right after the read
        return snapshot
      },
      findVisit: async () => first,
      findVisitType: async () => visitType,
      findEmployeeById: async () => host,
      findActiveEmployeeByName: async () => host,
      updateMeeting,
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await expect(service.updateMeeting("meeting-1", editInput, OWNER)).rejects.toMatchObject({ statusCode: 409, code: "MEETING_VISITS_NOT_PLANNED" })
    expect(meeting).toMatchObject({ plannedStart: "2026-09-03T09:00:00.000Z", plannedEnd: "2026-09-03T10:00:00.000Z" })
  })
})

/**
 * The public pre-registration surface. The service's own `getActivePublicInvitation` pre-check
 * runs on a snapshot, so this fake repository behaves like the real one: every public write
 * re-validates the *persisted* visit and invitation state inside its transaction and rejects with
 * `PublicInvitationInactiveError` unless they remain `PLANNED` and `SENT`. `beforeWrite` lets a
 * test commit a cancel, check-in, or invitation reset in exactly the window the old code wrote through.
 */
function publicInvitationFixture(options: { activeRule?: VisitorRuleDto | null } = {}) {
  const activeRule = options.activeRule === undefined ? { id: "rule-1", version: 2, content: "Ziyaretçi kuralı", publishedAt: now.toISOString(), active: true } : options.activeRule
  const state = { status: "PLANNED" as VisitStatus, invitationStatus: "SENT" as VisitDto["invitationStatus"], visitor: visit().visitor, vehiclePlate: undefined as string | undefined, acceptances: 0 }
  const tokenHashes: string[] = []
  let beforeNextWrite: (() => void) | undefined
  let writeFailure: Error | undefined
  const revalidate = () => {
    beforeNextWrite?.()
    beforeNextWrite = undefined
    if (writeFailure) throw writeFailure
    if (state.status !== "PLANNED" || state.invitationStatus !== "SENT") throw new PublicInvitationInactiveError()
  }
  const repository = unusedRepository({
    findPublicPreRegistration: async (tokenHash: string) => {
      tokenHashes.push(tokenHash)
      if (tokenHash !== hashToken("public-token")) return null
      return { visit: visit({ status: state.status, invitationStatus: state.invitationStatus, visitor: state.visitor, vehiclePlate: state.vehiclePlate }), activeRule }
    },
    updatePublicVisitor: async (tokenHash: string, input: { firstName: string; lastName: string; email?: string; company: string; phone?: string; vehiclePlate?: string }) => {
      tokenHashes.push(tokenHash)
      revalidate()
      state.visitor = { ...state.visitor, firstName: input.firstName, lastName: input.lastName, email: input.email, company: input.company, phone: input.phone }
      state.vehiclePlate = input.vehiclePlate
    },
    acceptPublicRule: async (tokenHash: string) => {
      tokenHashes.push(tokenHash)
      revalidate()
      state.acceptances += 1
      return { id: "acceptance-1", ruleId: activeRule!.id, ruleVersion: activeRule!.version, acceptedAt: now.toISOString(), method: "INVITATION_LINK" as const, contentSnapshot: activeRule!.content }
    },
  })
  const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)
  return {
    service, state,
    tokenHashes: () => tokenHashes,
    beforeWrite: (operation: () => void) => { beforeNextWrite = operation },
    failWriteWith: (error: Error) => { writeFailure = error },
  }
}

const publicInput = { firstName: "Ada Güncel", lastName: "Yılmaz", company: "Acme A.Ş.", email: "ada.guncel@example.test", phone: "5550000000", vehiclePlate: "16 ABC 123" }
const invitationNotFoundBody = { statusCode: 404, code: "INVITATION_NOT_FOUND", message: "Davet bağlantısı geçersiz veya süresi dolmuş." }

describe("VisitorOperationsService public invitation mutations", () => {
  it("updates the visitor and accepts the rule for a PLANNED visit, sending only the token hash", async () => {
    const fixture = publicInvitationFixture()

    await expect(fixture.service.updatePublicPreRegistration("public-token", publicInput)).resolves.toMatchObject({
      visitor: { firstName: "Ada Güncel", company: "Acme A.Ş.", phone: "5550000000" },
      visit: { vehiclePlate: "16 ABC 123" },
    })
    await expect(fixture.service.acceptPublicRule("public-token", "203.0.113.7")).resolves.toMatchObject({ ruleId: "rule-1", ruleVersion: 2 })

    expect(fixture.state.acceptances).toBe(1)
    expect(fixture.tokenHashes().every((hash) => hash === hashToken("public-token"))).toBe(true)
    expect(fixture.tokenHashes()).not.toContain("public-token")
  })

  it.each(["CANCELLED", "CHECKED_IN"] as const)("maps a visit that turned %s before the write onto the public 404", async (status) => {
    const fixture = publicInvitationFixture()
    // The service pre-check passes on the PLANNED snapshot; the repository transaction is the one
    // that sees the committed cancel / check-in.
    fixture.beforeWrite(() => { fixture.state.status = status })

    await expect(fixture.service.updatePublicPreRegistration("public-token", publicInput)).rejects.toMatchObject(invitationNotFoundBody)

    expect(fixture.state.visitor).toMatchObject({ firstName: "Ada", company: "Acme" })
    expect(fixture.state.vehiclePlate).toBeUndefined()

    fixture.state.status = "PLANNED"
    fixture.beforeWrite(() => { fixture.state.status = status })
    await expect(fixture.service.acceptPublicRule("public-token")).rejects.toMatchObject(invitationNotFoundBody)
    expect(fixture.state.acceptances).toBe(0)
  })

  it.each(["CANCELLED", "CHECKED_IN"] as const)("refuses a public mutation on an already %s visit", async (status) => {
    const fixture = publicInvitationFixture()
    fixture.state.status = status

    await expect(fixture.service.updatePublicPreRegistration("public-token", publicInput)).rejects.toMatchObject(invitationNotFoundBody)
    await expect(fixture.service.acceptPublicRule("public-token")).rejects.toMatchObject(invitationNotFoundBody)
    await expect(fixture.service.getPublicPreRegistration("public-token")).rejects.toMatchObject(invitationNotFoundBody)
    expect(fixture.state.acceptances).toBe(0)
  })

  it.each(["NOT_SENT", "SENDING", "FAILED"] as const)("refuses every public operation when invitation state is %s", async (invitationStatus) => {
    const fixture = publicInvitationFixture()
    fixture.state.invitationStatus = invitationStatus

    await expect(fixture.service.getPublicPreRegistration("public-token")).rejects.toMatchObject(invitationNotFoundBody)
    await expect(fixture.service.updatePublicPreRegistration("public-token", publicInput)).rejects.toMatchObject(invitationNotFoundBody)
    await expect(fixture.service.acceptPublicRule("public-token")).rejects.toMatchObject(invitationNotFoundBody)
    expect(fixture.state.visitor).toMatchObject({ firstName: "Ada", company: "Acme" })
    expect(fixture.state.acceptances).toBe(0)
  })

  it("maps an invitation reset after the public pre-check onto the public 404", async () => {
    const fixture = publicInvitationFixture()
    fixture.beforeWrite(() => { fixture.state.invitationStatus = "NOT_SENT" })

    await expect(fixture.service.updatePublicPreRegistration("public-token", publicInput)).rejects.toMatchObject(invitationNotFoundBody)
    expect(fixture.state.visitor).toMatchObject({ firstName: "Ada", company: "Acme" })
    expect(fixture.state.vehiclePlate).toBeUndefined()
  })

  it("keeps hiding an unknown token behind the same 404", async () => {
    const fixture = publicInvitationFixture()

    await expect(fixture.service.getPublicPreRegistration("wrong-token")).rejects.toMatchObject(invitationNotFoundBody)
    await expect(fixture.service.updatePublicPreRegistration("wrong-token", publicInput)).rejects.toMatchObject(invitationNotFoundBody)
    await expect(fixture.service.acceptPublicRule("wrong-token")).rejects.toMatchObject(invitationNotFoundBody)
  })

  it("does not disguise an unexpected repository failure as an expired invitation", async () => {
    const fixture = publicInvitationFixture()
    fixture.failWriteWith(new Error("connection reset by peer"))

    await expect(fixture.service.updatePublicPreRegistration("public-token", publicInput)).rejects.toThrow("connection reset by peer")
    await expect(fixture.service.acceptPublicRule("public-token")).rejects.toThrow("connection reset by peer")
  })

  it("still reports a missing active rule as NO_ACTIVE_RULE, not as an expired invitation", async () => {
    const fixture = publicInvitationFixture({ activeRule: null })

    await expect(fixture.service.acceptPublicRule("public-token")).rejects.toMatchObject({ statusCode: 409, code: "NO_ACTIVE_RULE" })
    expect(fixture.state.acceptances).toBe(0)
  })
})
