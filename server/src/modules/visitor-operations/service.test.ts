import { describe, expect, it, vi } from "vitest"

import type { AccessContext } from "../../lib/authorization.js"
import type { EmailMessage, EmailSender } from "../../delivery/email-sender.js"
import { CheckInConflictError, NoActiveVisitorRuleError, PublicInvitationInactiveError, VisitorCardConflictError, type VisitorOperationsRepository } from "../../repositories/visitor-operations-repository.js"
import { INVITATION_SEND_STALE_AFTER_MS, isInvitationSendStale } from "./invitation-staleness.js"
import { assertMeetingPlanningUnlocked } from "./meeting-planning-lock.js"
import { VisitorOperationsService, hashToken } from "./service.js"
import type { InvitationStatus, MeetingDto, MeetingInput, SecurityCorrectionInput, VisitDto, VisitorCardDto, VisitorRuleDto, VisitStatus } from "./types.js"

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

/**
 * Persisted-state fixture for the send path (NEW-9). Unlike `invitationFixture` above — which
 * always hands back a successful claim — this one models what the repository actually guarantees:
 * `findVisit` derives `invitationSendStale` exactly the way `toVisit` does, and
 * `prepareInvitation` is a compare-and-set, so a caller whose snapshot is out of date loses the
 * claim and must not send. Every timestamp comes from `clock`, so nothing waits on real minutes.
 */
function sendClaimFixture(initial: { invitationStatus?: InvitationStatus; sendStartedAt?: Date | null } = {}) {
  const clock = { now }
  const state = {
    invitationStatus: initial.invitationStatus ?? ("NOT_SENT" as InvitationStatus),
    sendStartedAt: initial.sendStartedAt ?? null,
    invitationError: undefined as string | undefined,
  }
  const tokenHashes: string[] = []
  const read = () => visit({
    invitationStatus: state.invitationStatus,
    invitationSendStale: isInvitationSendStale(state.invitationStatus, state.sendStartedAt, clock.now) || undefined,
    invitationError: state.invitationError,
  })
  // Deliberately free of internal `await`s: the check and the write stay in one synchronous step,
  // the way the repository's transactional compare-and-set does.
  const claim = (tokenHash: string, at: Date) => {
    const claimable = state.invitationStatus === "NOT_SENT" || state.invitationStatus === "FAILED"
      || isInvitationSendStale(state.invitationStatus, state.sendStartedAt, at)
    if (!claimable) return { visit: read(), claimed: false }
    state.invitationStatus = "SENDING"
    state.sendStartedAt = at
    state.invitationError = undefined
    tokenHashes.push(tokenHash)
    return { visit: read(), claimed: true }
  }
  const repository = unusedRepository({
    findVisit: async () => read(),
    findMeeting: async () => ({ meeting, visits: [read()] }),
    prepareInvitation: async (_id: string, tokenHash: string, at: Date) => claim(tokenHash, at),
    finishInvitation: async (_id: string, succeeded: boolean) => {
      if (state.invitationStatus !== "SENDING") return
      state.invitationStatus = succeeded ? "SENT" : "FAILED"
      state.invitationError = succeeded ? undefined : "Davet teknik bir hata nedeniyle gönderilemedi."
    },
  })
  return { claim, clock, repository, state, tokenHashes }
}

const STALE_AGO = new Date(now.getTime() - INVITATION_SEND_STALE_AFTER_MS - 1_000)
const FRESH_AGO = new Date(now.getTime() - 1_000)

describe("VisitorOperationsService stale SENDING recovery", () => {
  function serviceFor(fixture: ReturnType<typeof sendClaimFixture>, email: FakeEmailSender, token = "recovery-token") {
    return new VisitorOperationsService(fixture.repository, email, "https://web.example.test", undefined, () => fixture.clock.now, () => token)
  }

  it("sends a NOT_SENT invitation and dates the send attempt it claimed", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture()

    await expect(serviceFor(fixture, email).sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })
    expect(email.messages).toHaveLength(1)
    expect(fixture.state.sendStartedAt).toEqual(now)
  })

  it("records a failed send attempt as FAILED with the safe public message", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture(); email.fail = true

    await expect(serviceFor(fixture, email).sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({
      invitationStatus: "FAILED", invitationError: "Davet teknik bir hata nedeniyle gönderilemedi.",
    })
    expect(email.messages).toHaveLength(1)
  })

  it("leaves a still in-flight SENDING alone instead of starting a second SMTP send", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture({ invitationStatus: "SENDING", sendStartedAt: FRESH_AGO })

    await expect(serviceFor(fixture, email).sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENDING" })
    expect(email.messages).toHaveLength(0)
    expect(fixture.tokenHashes).toHaveLength(0)
    expect(fixture.state.sendStartedAt).toEqual(FRESH_AGO)
  })

  it("lets a manual retry re-claim a stale SENDING and reports SENT when it succeeds", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture({ invitationStatus: "SENDING", sendStartedAt: STALE_AGO })

    await expect(serviceFor(fixture, email).sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })
    expect(email.messages).toHaveLength(1)
    expect(fixture.state.sendStartedAt).toEqual(now)
  })

  it("reports FAILED when the retry of a stale SENDING cannot be delivered", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture({ invitationStatus: "SENDING", sendStartedAt: STALE_AGO }); email.fail = true

    await expect(serviceFor(fixture, email).sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({
      invitationStatus: "FAILED", invitationError: "Davet teknik bir hata nedeniyle gönderilemedi.",
    })
    expect(email.messages).toHaveLength(1)
  })

  it("gives only one of two concurrent retries the right to send the same stale SENDING", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture({ invitationStatus: "SENDING", sendStartedAt: STALE_AGO })
    const service = serviceFor(fixture, email)

    await Promise.all([service.sendVisitInvitation("visit-1", OWNER), service.sendVisitInvitation("visit-1", OWNER)])

    expect(email.messages).toHaveLength(1)
    expect(fixture.tokenHashes).toHaveLength(1)
  })

  it("recovers a send the process abandoned after claiming it, but only once past the threshold", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture()
    const service = serviceFor(fixture, email)

    // Process death model: the claim commits and then nothing ever records its result.
    fixture.claim("abandoned-token-hash", now)
    expect(fixture.state.invitationStatus).toBe("SENDING")

    fixture.clock.now = new Date(now.getTime() + INVITATION_SEND_STALE_AFTER_MS - 1_000)
    await expect(service.sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENDING" })
    expect(email.messages).toHaveLength(0)

    fixture.clock.now = new Date(now.getTime() + INVITATION_SEND_STALE_AFTER_MS)
    await expect(service.sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })
    expect(email.messages).toHaveLength(1)
  })

  it("issues a fresh token when it re-claims a stale SENDING instead of reviving the abandoned one", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture()

    fixture.claim("abandoned-token-hash", STALE_AGO)
    await expect(serviceFor(fixture, email, "recovered-raw-token").sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })

    expect(fixture.tokenHashes).toEqual(["abandoned-token-hash", hashToken("recovered-raw-token")])
    expect(email.messages[0].text).toContain("token=recovered-raw-token")
    expect(email.messages[0].text).not.toContain("abandoned-token-hash")
  })

  it("keeps a reset invitation revoked: recovery resumes nothing and mints a new token", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture()

    fixture.claim("revoked-token-hash", STALE_AGO)
    // The reset (reschedule / meeting edit) deletes the invitation row and returns the visit to
    // NOT_SENT. The recovery path must treat that as a fresh send, never as an attempt to resume.
    fixture.state.invitationStatus = "NOT_SENT"
    fixture.state.sendStartedAt = null

    await expect(serviceFor(fixture, email, "post-reset-token").sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })
    expect(fixture.tokenHashes).toEqual(["revoked-token-hash", hashToken("post-reset-token")])
  })

  it("retries a stale SENDING from a meeting batch send", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture({ invitationStatus: "SENDING", sendStartedAt: STALE_AGO })

    const results = await serviceFor(fixture, email).sendMeetingInvitations("meeting-1", OWNER)

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ invitationStatus: "SENT" })
    expect(email.messages).toHaveLength(1)
  })

  it("skips a still in-flight SENDING during a meeting batch send", async () => {
    const email = new FakeEmailSender(), fixture = sendClaimFixture({ invitationStatus: "SENDING", sendStartedAt: FRESH_AGO })

    await expect(serviceFor(fixture, email).sendMeetingInvitations("meeting-1", OWNER)).resolves.toEqual([])
    expect(email.messages).toHaveLength(0)
    expect(fixture.tokenHashes).toHaveLength(0)
  })
})

/**
 * NEW-16: what the *losing* side of a claim race is allowed to report.
 *
 * Two actors retrying the same stale `SENDING` both pass the cheap sendability guard, and the
 * compare-and-set then hands the send right to exactly one of them (NEW-9). The loser mails
 * nothing, yet the record it reads back is the winner's fresh `SENDING` — a state that is neither
 * this request's success nor its failure. So the direct send must hand that `SENDING` back
 * verbatim (never the winner's eventual outcome), and the batch send must leave the loser out of
 * its results entirely, so no caller can count it as a delivered invitation.
 *
 * Both actors run against `sendClaimFixture`, whose claim is a single synchronous check-and-write
 * and whose every other step resolves on the microtask queue — the race is ordered by the runtime's
 * own interleaving, with no timers and nothing waiting on real elapsed time. Each assertion reads
 * the pair of outcomes as an unordered set, so it holds whichever actor happens to win.
 */
describe("VisitorOperationsService concurrent invitation claim feedback", () => {
  function serviceFor(fixture: ReturnType<typeof sendClaimFixture>, email: FakeEmailSender) {
    return new VisitorOperationsService(fixture.repository, email, "https://web.example.test", undefined, () => fixture.clock.now, () => "race-token")
  }

  function staleRace(winnerFails: boolean) {
    const email = new FakeEmailSender(); email.fail = winnerFails
    const fixture = sendClaimFixture({ invitationStatus: "SENDING", sendStartedAt: STALE_AGO })
    return { email, fixture, service: serviceFor(fixture, email) }
  }

  /** Exactly one claim, so exactly one SMTP attempt and exactly one fresh token. */
  function expectSingleAttempt(email: FakeEmailSender, fixture: ReturnType<typeof sendClaimFixture>) {
    expect(email.messages).toHaveLength(1)
    expect(fixture.tokenHashes).toHaveLength(1)
  }

  it.each([
    { label: "succeeds", winnerFails: false, winnerStatus: "SENT" as InvitationStatus },
    { label: "fails", winnerFails: true, winnerStatus: "FAILED" as InvitationStatus },
  ])("hands the direct-send claim loser the in-flight SENDING when the winner's send $label", async ({ winnerFails, winnerStatus }) => {
    const { email, fixture, service } = staleRace(winnerFails)

    const results = await Promise.all([
      service.sendVisitInvitation("visit-1", OWNER),
      service.sendVisitInvitation("visit-1", OWNER),
    ])

    expectSingleAttempt(email, fixture)
    // One `SENDING` — the loser, which sent nothing — and one winner outcome. Never two of either:
    // a second `SENT` would be the false confirmation this guards against.
    expect(results.map((item) => item.invitationStatus).sort()).toEqual([winnerStatus, "SENDING"].sort())
  })

  it.each([
    { label: "succeeds", winnerFails: false, winnerStatus: "SENT" as InvitationStatus },
    { label: "fails", winnerFails: true, winnerStatus: "FAILED" as InvitationStatus },
  ])("leaves the batch-send claim loser with no results when the winner's send $label", async ({ winnerFails, winnerStatus }) => {
    const { email, fixture, service } = staleRace(winnerFails)

    const batches = await Promise.all([
      service.sendMeetingInvitations("meeting-1", OWNER),
      service.sendMeetingInvitations("meeting-1", OWNER),
    ])

    expectSingleAttempt(email, fixture)
    const statuses = batches.map((batch) => batch.map((item) => item.invitationStatus))
    // The loser's batch is empty — NEW-10 then reports it as "nothing to send" rather than as a
    // send of its own — and only the actor that actually claimed reports an outcome.
    expect(statuses.sort()).toEqual([[], [winnerStatus]].sort())
    expect(batches.flat().some((item) => item.invitationStatus === "SENDING")).toBe(false)
  })
})

/**
 * Claim-race fixture for the invitation *content* authority (NEW-15).
 *
 * `prepareInvitation` applies the pending edit and claims in one indivisible step, the way the
 * repository's transaction does, and hands back the state as of that claim. So a `editBeforeClaim`
 * edit is visible to the claim and its snapshot, and invisible to the read the service already
 * took — exactly the window a planner edit commits in, ordered by the fixture rather than by
 * timing. `tokenHash` is the persisted invitation row: `null` means revoked.
 */
function claimRaceFixture(initial: VisitDto = visit(), existingTokenHash: string | null = null) {
  const state = { visit: initial, tokenHash: existingTokenHash }
  let pendingEdit: (() => void) | undefined
  const repository = unusedRepository({
    findVisit: async () => state.visit,
    findMeeting: async () => ({ meeting: state.visit.meeting, visits: [state.visit] }),
    prepareInvitation: async (_id: string, tokenHash: string) => {
      pendingEdit?.()
      pendingEdit = undefined
      const claimable = state.visit.invitationStatus === "NOT_SENT" || state.visit.invitationStatus === "FAILED"
        || (state.visit.invitationStatus === "SENDING" && state.visit.invitationSendStale === true)
      if (!claimable) return { visit: state.visit, claimed: false }
      state.tokenHash = tokenHash
      state.visit = { ...state.visit, invitationStatus: "SENDING", invitationSendStale: undefined }
      return { visit: state.visit, claimed: true }
    },
    finishInvitation: async (_id: string, succeeded: boolean) => {
      state.visit = { ...state.visit, invitationStatus: succeeded ? "SENT" : "FAILED", invitationError: succeeded ? undefined : "Davet teknik bir hata nedeniyle gönderilemedi." }
    },
  })
  return { repository, state, editBeforeClaim: (edit: () => void) => { pendingEdit = edit } }
}

/** The planner edit: replacement visitor and meeting details, old token revoked, invitation reset. */
function commitPlannerEdit(fixture: ReturnType<typeof claimRaceFixture>) {
  fixture.state.visit = {
    ...fixture.state.visit,
    visitor: { id: "visitor-1", firstName: "Bora", lastName: "Demir", email: "bora@example.test", company: "Beta" },
    meeting: { ...fixture.state.visit.meeting, facilityName: "Kuzey Tesisi", hostEmployeeName: "Deniz Ak", plannedStart: "2026-09-05T13:00:00.000Z", plannedEnd: "2026-09-05T14:00:00.000Z" },
    invitationStatus: "NOT_SENT",
    invitationSendStale: undefined,
  }
  fixture.state.tokenHash = null
}

describe("VisitorOperationsService invitation content authority", () => {
  function serviceFor(fixture: ReturnType<typeof claimRaceFixture>, email: FakeEmailSender, token = "content-token") {
    return new VisitorOperationsService(fixture.repository, email, "https://web.example.test", undefined, () => now, () => token)
  }

  it("addresses and words an ordinary send from the state its claim returned", async () => {
    const email = new FakeEmailSender(), fixture = claimRaceFixture()

    await expect(serviceFor(fixture, email).sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })

    expect(email.messages).toHaveLength(1)
    expect(email.messages[0].to).toEqual({ address: "ada@example.test", name: "Ada Yılmaz" })
    expect(email.messages[0].text).toContain("Merhaba Ada,")
    expect(email.messages[0].text).toContain("Merkez tesisindeki Maya Kara")
    expect(email.messages[0].text).toContain("2026-09-03T09:00:00.000Z - 2026-09-03T10:00:00.000Z")
  })

  it("mails the edited address and never the one the pre-claim read still held", async () => {
    const email = new FakeEmailSender(), fixture = claimRaceFixture()
    fixture.editBeforeClaim(() => commitPlannerEdit(fixture))

    await expect(serviceFor(fixture, email, "post-edit-token").sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })

    expect(email.messages).toHaveLength(1)
    expect(email.messages[0].to).toEqual({ address: "bora@example.test", name: "Bora Demir" })
    expect(email.messages.some((message) => message.to.address === "ada@example.test")).toBe(false)
  })

  it("carries the edited visitor and meeting details into the body it mails", async () => {
    const email = new FakeEmailSender(), fixture = claimRaceFixture()
    fixture.editBeforeClaim(() => commitPlannerEdit(fixture))

    await serviceFor(fixture, email, "post-edit-token").sendVisitInvitation("visit-1", OWNER)

    const [message] = email.messages
    expect(message.text).toContain("Merhaba Bora,")
    expect(message.text).toContain("Kuzey Tesisi tesisindeki Deniz Ak")
    expect(message.text).toContain("2026-09-05T13:00:00.000Z - 2026-09-05T14:00:00.000Z")
    expect(message.text).not.toContain("Ada")
    expect(message.text).not.toContain("Merkez")
    expect(message.text).not.toContain("Maya Kara")
    expect(message.text).not.toContain("2026-09-03T09:00:00.000Z")
  })

  it("mints a fresh token for the claim and never mails the one the edit revoked", async () => {
    const email = new FakeEmailSender(), fixture = claimRaceFixture(visit({ invitationStatus: "FAILED" }), hashToken("revoked-token"))
    fixture.editBeforeClaim(() => commitPlannerEdit(fixture))

    await serviceFor(fixture, email, "post-edit-token").sendVisitInvitation("visit-1", OWNER)

    expect(fixture.state.tokenHash).toBe(hashToken("post-edit-token"))
    expect(email.messages[0].text).toContain("token=post-edit-token")
    expect(email.messages[0].text).not.toContain("revoked-token")
  })

  it("recovers a stale SENDING onto the edited state, not the snapshot that found it stale", async () => {
    const email = new FakeEmailSender()
    const fixture = claimRaceFixture(visit({ invitationStatus: "SENDING", invitationSendStale: true }), hashToken("abandoned-token"))
    fixture.editBeforeClaim(() => commitPlannerEdit(fixture))

    await expect(serviceFor(fixture, email, "recovered-token").sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "SENT" })

    expect(email.messages).toHaveLength(1)
    expect(email.messages[0].to.address).toBe("bora@example.test")
    expect(email.messages[0].text).toContain("Kuzey Tesisi tesisindeki Deniz Ak")
    expect(email.messages[0].text).toContain("token=recovered-token")
    expect(fixture.state.tokenHash).toBe(hashToken("recovered-token"))
  })

  it("sends nothing and reports the claim's snapshot when the claim is lost", async () => {
    const email = new FakeEmailSender(), fixture = claimRaceFixture()
    // A concurrent sender claims first and edits land with it: this attempt has no send rights.
    fixture.editBeforeClaim(() => {
      commitPlannerEdit(fixture)
      fixture.state.visit = { ...fixture.state.visit, invitationStatus: "SENDING" }
    })

    const result = await serviceFor(fixture, email).sendVisitInvitation("visit-1", OWNER)

    expect(email.messages).toHaveLength(0)
    expect(result).toMatchObject({ invitationStatus: "SENDING", visitor: { email: "bora@example.test" } })
  })

  it("fails the claimed attempt instead of mailing the address the edit removed", async () => {
    const email = new FakeEmailSender(), fixture = claimRaceFixture()
    fixture.editBeforeClaim(() => {
      fixture.state.visit = { ...fixture.state.visit, visitor: { ...fixture.state.visit.visitor, email: undefined } }
    })

    await expect(serviceFor(fixture, email).sendVisitInvitation("visit-1", OWNER)).resolves.toMatchObject({ invitationStatus: "FAILED" })
    expect(email.messages).toHaveLength(0)
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

describe("Visitor correction scope", () => {
  it("forwards visitor fields and the permitted host display-name correction without visit type", async () => {
    let submitted: SecurityCorrectionInput | undefined
    const current = visit({ status: "CHECKED_IN" })
    const repository = unusedRepository({
      findVisit: async () => current,
      findEmployeeByUserId: async () => ({ id: "security-1", userId: "user-1", fullName: "Güvenlik", companyId: "company-1", facilityIds: ["facility-1"] }),
      correctVisitor: async (_id: string, input: SecurityCorrectionInput) => { submitted = input },
    })
    const service = new VisitorOperationsService(repository, new FakeEmailSender(), "https://web.example.test", undefined, () => now)

    await service.correctVisitor("visit-1", { firstName: " Ada ", lastName: "Yılmaz", company: " Acme ", phone: " 555 ", hostEmployeeName: " Yeni Ev Sahibi " }, SECURITY_CTX)

    expect(submitted).toEqual({ firstName: "Ada", lastName: "Yılmaz", company: "Acme", email: undefined, phone: "555", hostEmployeeName: "Yeni Ev Sahibi" })
    expect(submitted).not.toHaveProperty("visitTypeId")
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
