import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import type { MeetingInput } from "../modules/visitor-operations/types.js"
import { CheckInConflictError, PrismaVisitorOperationsRepository, PublicInvitationInactiveError, VisitorCardConflictError } from "./visitor-operations-repository.js"

const sentAt = new Date("2026-09-02T08:00:00.000Z")
const updatedAt = new Date("2026-09-02T09:00:00.000Z")

interface FixtureVisitor {
  id: string
  firstName: string
  lastName: string
  email: string | null
  company: string
  phone: string | null
}

interface FixtureMeeting {
  id: string
  creatorEmployeeId: string
  visitTypeId: string
  hostEmployeeId: string | null
  hostEmployeeName: string
  hostCompanyId: string
  facilityId: string
  plannedStart: Date
  plannedEnd: Date
  note: string | null
  hasAdditionalRequirements: boolean
  additionalRequirementNote: string | null
  actualMeetingEnd: Date | null
  meetingEndSource: string | null
  createdAt: Date
  updatedAt: Date
  visitType: { name: string }
  hostCompany: { name: string }
  facility: { name: string }
  visits: FixtureVisit[]
}

interface FixtureVisit {
  id: string
  meetingId: string
  visitorId: string
  visitor: FixtureVisitor
  meeting: FixtureMeeting
  status: string
  invitationStatus: string
  invitationSentAt: Date | null
  invitationError: string | null
  actualCheckIn: Date | null
  actualCheckOut: Date | null
  visitorCardReturned: boolean | null
  visitorCardId: string | null
  visitorCardNumber: string | null
  vehiclePlate: string | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  ruleAcceptances: []
  hostCorrectionAudits: []
}

interface FixtureCard {
  id: string
  cardNumber: string
  status: string
  currentVisitId: string | null
  assignedVisitorName: string | null
  createdAt: Date
  updatedAt: Date
}

function createMeetingFixture(secondVisitStatus = "PLANNED") {
  const meeting: FixtureMeeting = {
    id: "meeting-1",
    creatorEmployeeId: "employee-1",
    visitTypeId: "type-1",
    hostEmployeeId: "host-1",
    hostEmployeeName: "Maya Kara",
    hostCompanyId: "company-1",
    facilityId: "facility-1",
    plannedStart: new Date("2026-09-03T09:00:00.000Z"),
    plannedEnd: new Date("2026-09-03T10:00:00.000Z"),
    note: null,
    hasAdditionalRequirements: false,
    additionalRequirementNote: null,
    actualMeetingEnd: null,
    meetingEndSource: null,
    createdAt: updatedAt,
    updatedAt,
    visitType: { name: "Toplantı" },
    hostCompany: { name: "BPLAS" },
    facility: { name: "Merkez" },
    visits: [],
  }
  const planned: FixtureVisit = {
    id: "visit-planned",
    meetingId: meeting.id,
    visitorId: "visitor-planned",
    visitor: { id: "visitor-planned", firstName: "Ada", lastName: "Yılmaz", email: "ada@example.test", company: "Acme", phone: null },
    meeting,
    status: "PLANNED",
    invitationStatus: "SENT",
    invitationSentAt: sentAt,
    invitationError: "historical planned error",
    actualCheckIn: null,
    actualCheckOut: null,
    visitorCardReturned: null,
    visitorCardId: null,
    visitorCardNumber: null,
    vehiclePlate: null,
    cancelledAt: null,
    createdAt: updatedAt,
    updatedAt,
    ruleAcceptances: [],
    hostCorrectionAudits: [],
  }
  const second: FixtureVisit = {
    ...planned,
    id: "visit-second",
    visitorId: "visitor-second",
    visitor: { id: "visitor-second", firstName: "Deniz", lastName: "Yılmaz", email: "deniz@example.test", company: "Acme", phone: null },
    status: secondVisitStatus,
    invitationError: "historical second error",
  }
  meeting.visits = [planned, second]
  const invitation = { visitId: planned.id, tokenHash: "existing-token-hash" }

  const meetingUpdate = vi.fn(async ({ data }: { data: Partial<FixtureMeeting> }) => Object.assign(meeting, data))
  const visitUpdateMany = vi.fn(async ({ where, data }: { where: { meetingId: string; status: string }; data: Partial<FixtureVisit> }) => {
    let count = 0
    for (const visit of meeting.visits) {
      if (visit.meetingId === where.meetingId && visit.status === where.status) {
        Object.assign(visit, data)
        count += 1
      }
    }
    return { count }
  })
  const tx = {
    meeting: { update: meetingUpdate },
    visit: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => meeting.visits.find((visit) => visit.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { meetingId: string } }) => meeting.visits.filter((visit) => visit.meetingId === where.meetingId).map((visit) => ({ status: visit.status }))),
      updateMany: visitUpdateMany,
    },
    visitor: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FixtureVisitor> }) => {
        const visit = meeting.visits.find((item) => item.visitorId === where.id)
        if (!visit) throw new Error("Missing fixture visitor.")
        return Object.assign(visit.visitor, data)
      }),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    meeting: { findUnique: vi.fn(async () => meeting) },
  } as unknown as PrismaClient

  return { invitation, meeting, meetingUpdate, planned, prisma, second, visitUpdateMany }
}

const meetingInput: MeetingInput = {
  visitors: [
    { visitId: "visit-planned", firstName: "Ada", lastName: "Yılmaz", email: "ada@example.test", company: "Acme" },
    { visitId: "visit-second", firstName: "Deniz", lastName: "Yılmaz", email: "deniz@example.test", company: "Acme" },
  ],
  visitTypeId: "type-1",
  hostEmployeeId: "host-1",
  hostEmployeeName: "Maya Kara",
  hostCompanyId: "company-1",
  facilityId: "facility-1",
  plannedStart: "2026-09-04T09:00:00.000Z",
  plannedEnd: "2026-09-04T10:00:00.000Z",
}

describe("PrismaVisitorOperationsRepository invitation resets", () => {
  it("resets planned invitations atomically with a meeting edit and preserves the token", async () => {
    const fixture = createMeetingFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    const result = await repository.updateMeeting("meeting-1", meetingInput, "host-1")

    for (const id of ["visit-planned", "visit-second"]) {
      expect(result.visits.find((visit) => visit.id === id)).toMatchObject({
        invitationStatus: "NOT_SENT",
        invitationSentAt: undefined,
        invitationError: undefined,
      })
    }
    expect(fixture.invitation).toEqual({ visitId: "visit-planned", tokenHash: "existing-token-hash" })
    expect(fixture.visitUpdateMany).toHaveBeenCalledWith({
      where: { meetingId: "meeting-1", status: "PLANNED" },
      data: { invitationStatus: "NOT_SENT", invitationSentAt: null, invitationError: null },
    })
  })

  it("resets a sent planned invitation atomically with rescheduling", async () => {
    const fixture = createMeetingFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)
    const nextStart = new Date("2026-09-05T09:00:00.000Z")
    const nextEnd = new Date("2026-09-05T10:00:00.000Z")

    await repository.updateMeetingTimes("meeting-1", nextStart, nextEnd)

    expect(fixture.meeting).toMatchObject({ plannedStart: nextStart, plannedEnd: nextEnd })
    expect(fixture.planned).toMatchObject({ invitationStatus: "NOT_SENT", invitationSentAt: null, invitationError: null })
    expect(fixture.second).toMatchObject({ invitationStatus: "NOT_SENT", invitationSentAt: null, invitationError: null })
    expect(fixture.prisma.$transaction).toHaveBeenCalledOnce()
  })
})

describe("PrismaVisitorOperationsRepository shared planning invariant", () => {
  const plannedMeeting = {
    visitTypeId: "type-1",
    hostEmployeeName: "Maya Kara",
    hostCompanyId: "company-1",
    facilityId: "facility-1",
    plannedStart: new Date("2026-09-03T09:00:00.000Z"),
    plannedEnd: new Date("2026-09-03T10:00:00.000Z"),
  }
  const lockingStatuses = ["CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"]

  it.each(lockingStatuses)("rejects a meeting edit while a %s visit is in the group", async (status) => {
    const fixture = createMeetingFixture(status)
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.updateMeeting("meeting-1", meetingInput, "host-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "MEETING_VISITS_NOT_PLANNED",
    })
    expect(fixture.meetingUpdate).not.toHaveBeenCalled()
    expect(fixture.visitUpdateMany).not.toHaveBeenCalled()
    expect(fixture.meeting).toMatchObject(plannedMeeting)
  })

  it.each(lockingStatuses)("rejects a reschedule while a %s visit is in the group", async (status) => {
    const fixture = createMeetingFixture(status)
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.updateMeetingTimes("meeting-1", new Date("2026-09-05T09:00:00.000Z"), new Date("2026-09-05T10:00:00.000Z"))).rejects.toMatchObject({
      statusCode: 409,
      code: "MEETING_VISITS_NOT_PLANNED",
    })
    expect(fixture.meetingUpdate).not.toHaveBeenCalled()
    expect(fixture.meeting).toMatchObject(plannedMeeting)
  })

  it("blocks a shared edit when a visit is checked in after the caller validated an all-PLANNED snapshot", async () => {
    const fixture = createMeetingFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)
    expect(fixture.meeting.visits.map((visit) => visit.status)).toEqual(["PLANNED", "PLANNED"])

    // A Security check-in commits after the service validated its snapshot: only the re-read
    // inside the write transaction can still see it.
    fixture.second.status = "CHECKED_IN"

    await expect(repository.updateMeeting("meeting-1", meetingInput, "host-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "MEETING_VISITS_NOT_PLANNED",
    })
    expect(fixture.meetingUpdate).not.toHaveBeenCalled()
    expect(fixture.meeting).toMatchObject(plannedMeeting)
  })

  it("maps a transaction write conflict to a planning conflict", async () => {
    const prisma = {
      $transaction: vi.fn(async () => { throw Object.assign(new Error("write conflict"), { code: "P2034" }) }),
    } as unknown as PrismaClient
    const repository = new PrismaVisitorOperationsRepository(prisma)

    await expect(repository.updateMeetingTimes("meeting-1", new Date("2026-09-05T09:00:00.000Z"), new Date("2026-09-05T10:00:00.000Z"))).rejects.toMatchObject({
      statusCode: 409,
      code: "MEETING_PLANNING_CONFLICT",
    })
  })
})

function createCardMutationFixture(initial: Partial<FixtureCard> = {}) {
  let card: FixtureCard = {
    id: "card-1", cardNumber: "001", status: "AVAILABLE", currentVisitId: null,
    assignedVisitorName: null, createdAt: updatedAt, updatedAt, ...initial,
  }
  let beforeNextWrite: (() => void) | undefined
  const updateMany = vi.fn(async ({ where, data }: { where: { id: string; status: string; currentVisitId: string | null }; data: Partial<FixtureCard> }) => {
    beforeNextWrite?.()
    beforeNextWrite = undefined
    if (card.id !== where.id || card.status !== where.status || card.currentVisitId !== where.currentVisitId) return { count: 0 }
    card = { ...card, ...data, updatedAt }
    return { count: 1 }
  })
  const prisma = {
    visitorCard: {
      findUnique: vi.fn(async () => card),
      updateMany,
    },
  } as unknown as PrismaClient
  return {
    prisma,
    updateMany,
    card: () => card,
    beforeWrite: (operation: () => void) => { beforeNextWrite = operation },
    replace: (next: Partial<FixtureCard>) => { card = { ...card, ...next } },
  }
}

function createSecurityLifecycleFixture() {
  const base = createMeetingFixture()
  const visit = base.planned
  let beforeNextCardWrite: (() => void) | undefined
  const card: FixtureCard = {
    id: "card-1", cardNumber: "001", status: "AVAILABLE", currentVisitId: null,
    assignedVisitorName: null, createdAt: updatedAt, updatedAt,
  }
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => row[key] === value)
  const tx = {
    visit: {
      findUnique: vi.fn(async () => visit),
      findUniqueOrThrow: vi.fn(async () => visit),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FixtureVisit> }) => {
        if (!matches(visit as unknown as Record<string, unknown>, where)) return { count: 0 }
        Object.assign(visit, data)
        return { count: 1 }
      }),
      count: vi.fn(async () => base.meeting.visits.filter((item) => item.status === "CHECKED_IN").length),
    },
    visitor: { update: vi.fn(async ({ data }: { data: Partial<FixtureVisitor> }) => Object.assign(visit.visitor, data)) },
    visitorCard: {
      findUnique: vi.fn(async () => card),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FixtureCard> }) => {
        beforeNextCardWrite?.()
        beforeNextCardWrite = undefined
        if (!matches(card as unknown as Record<string, unknown>, where)) return { count: 0 }
        Object.assign(card, data)
        return { count: 1 }
      }),
    },
    visitRuleAcceptance: { findFirst: vi.fn(async () => ({ id: "acceptance-1" })) },
    meeting: { update: vi.fn(async ({ data }: { data: Partial<FixtureMeeting> }) => Object.assign(base.meeting, data)) },
  }
  const prisma = {
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => {
      const visitSnapshot = { ...visit }
      const visitorSnapshot = { ...visit.visitor }
      const meetingSnapshot = { ...base.meeting }
      try {
        return await operation(tx)
      } catch (error) {
        Object.assign(visit, visitSnapshot)
        Object.assign(visit.visitor, visitorSnapshot)
        Object.assign(base.meeting, meetingSnapshot)
        throw error
      }
    }),
  } as unknown as PrismaClient
  return { card, prisma, tx, visit, beforeCardWrite: (operation: () => void) => { beforeNextCardWrite = operation } }
}

describe("PrismaVisitorOperationsRepository visitor-card compare-and-set", () => {
  it("disables AVAILABLE and enables DISABLED cards using status/currentVisitId predicates", async () => {
    const fixture = createCardMutationFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.setCardStatus("card-1", "DISABLED", { status: "AVAILABLE", currentVisitId: null })).resolves.toMatchObject({ status: "DISABLED" })
    await expect(repository.setCardStatus("card-1", "AVAILABLE", { status: "DISABLED", currentVisitId: null })).resolves.toMatchObject({ status: "AVAILABLE" })
    await expect(repository.updateCard("card-1", { cardNumber: "002", cardNumberNormalized: "002", status: "AVAILABLE" }, { status: "AVAILABLE", currentVisitId: null })).resolves.toMatchObject({ cardNumber: "002", status: "AVAILABLE" })
    expect(fixture.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "card-1", status: "AVAILABLE", currentVisitId: null },
      data: { status: "DISABLED", currentVisitId: null, assignedVisitorName: null },
    })
  })

  it("keeps assignment on LOST and clears it only when restored to AVAILABLE", async () => {
    const fixture = createCardMutationFixture({ status: "NOT_RETURNED", currentVisitId: "visit-1", assignedVisitorName: "Ada Yılmaz" })
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.setCardStatus("card-1", "LOST", { status: "NOT_RETURNED", currentVisitId: "visit-1" })).resolves.toMatchObject({ status: "LOST", assignedVisitId: "visit-1", assignedVisitorName: "Ada Yılmaz" })
    await expect(repository.setCardStatus("card-1", "AVAILABLE", { status: "LOST", currentVisitId: "visit-1" })).resolves.toMatchObject({ status: "AVAILABLE", assignedVisitId: undefined, assignedVisitorName: undefined })
  })

  it("cannot overwrite a Security check-in committed after the Admin snapshot", async () => {
    const fixture = createCardMutationFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)
    const adminSnapshot = await repository.findCard("card-1")
    fixture.beforeWrite(() => fixture.replace({ status: "IN_USE", currentVisitId: "visit-1", assignedVisitorName: "Ada Yılmaz" }))

    await expect(repository.updateCard("card-1", { cardNumber: "002", cardNumberNormalized: "002", status: "DISABLED" }, { status: adminSnapshot!.status, currentVisitId: adminSnapshot!.assignedVisitId ?? null })).rejects.toEqual(expect.objectContaining({ reason: "CARD_STATE_CHANGED" }))

    expect(fixture.card()).toMatchObject({ cardNumber: "001", status: "IN_USE", currentVisitId: "visit-1", assignedVisitorName: "Ada Yılmaz" })
    expect(fixture.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "card-1", status: "AVAILABLE", currentVisitId: null } }))
  })
})

describe("PrismaVisitorOperationsRepository Security card lifecycle", () => {
  it("checks in with an atomic AVAILABLE-to-IN_USE assignment", async () => {
    const fixture = createSecurityLifecycleFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.checkIn("visit-planned", { visitorCardId: "card-1" }, updatedAt)).resolves.toMatchObject({ visit: { status: "CHECKED_IN", visitorCardId: "card-1" } })
    expect(fixture.card).toMatchObject({ status: "IN_USE", currentVisitId: "visit-planned", assignedVisitorName: "Ada Yılmaz" })
    expect(fixture.tx.visitorCard.updateMany).toHaveBeenCalledWith({ where: { id: "card-1", status: "AVAILABLE", currentVisitId: null }, data: { status: "IN_USE", currentVisitId: "visit-planned", assignedVisitorName: "Ada Yılmaz" } })
  })

  it.each([
    { returned: true, expectedCardStatus: "AVAILABLE", expectedAssignment: null },
    { returned: false, expectedCardStatus: "NOT_RETURNED", expectedAssignment: "visit-planned" },
  ])("checks out with returned=$returned and preserves the card invariant", async ({ returned, expectedCardStatus, expectedAssignment }) => {
    const fixture = createSecurityLifecycleFixture()
    fixture.visit.status = "CHECKED_IN"
    fixture.visit.visitorCardId = "card-1"
    fixture.visit.visitorCardNumber = "001"
    fixture.card.status = "IN_USE"
    fixture.card.currentVisitId = "visit-planned"
    fixture.card.assignedVisitorName = "Ada Yılmaz"
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await repository.checkOut("visit-planned", returned, updatedAt)

    expect(fixture.visit).toMatchObject({ status: "CHECKED_OUT", visitorCardReturned: returned })
    expect(fixture.card).toMatchObject({ status: expectedCardStatus, currentVisitId: expectedAssignment })
  })

  it("receives a late return only from the matching NOT_RETURNED assignment", async () => {
    const fixture = createSecurityLifecycleFixture()
    fixture.visit.status = "CHECKED_OUT"
    fixture.visit.visitorCardId = "card-1"
    fixture.visit.visitorCardReturned = false
    fixture.card.status = "NOT_RETURNED"
    fixture.card.currentVisitId = "visit-planned"
    fixture.card.assignedVisitorName = "Ada Yılmaz"
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await repository.lateReturn("visit-planned", updatedAt)

    expect(fixture.visit.visitorCardReturned).toBe(true)
    expect(fixture.card).toMatchObject({ status: "AVAILABLE", currentVisitId: null, assignedVisitorName: null })
  })

  it("rejects a wrong checkout assignment with a typed conflict", async () => {
    const fixture = createSecurityLifecycleFixture()
    fixture.visit.status = "CHECKED_IN"
    fixture.visit.visitorCardId = "card-1"
    fixture.card.status = "IN_USE"
    fixture.card.currentVisitId = "visit-other"
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.checkOut("visit-planned", true, updatedAt)).rejects.toEqual(expect.objectContaining<Partial<VisitorCardConflictError>>({ reason: "INVALID_CARD_ASSIGNMENT" }))
  })

  it("rejects a CHECKED_IN late return with a typed conflict", async () => {
    const fixture = createSecurityLifecycleFixture()
    fixture.visit.status = "CHECKED_IN"
    fixture.visit.visitorCardId = "card-1"
    fixture.card.status = "IN_USE"
    fixture.card.currentVisitId = "visit-planned"
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.lateReturn("visit-planned", updatedAt)).rejects.toEqual(expect.objectContaining<Partial<VisitorCardConflictError>>({ reason: "INVALID_LATE_RETURN_STATE" }))
  })

  it("does not erase an Admin state change that wins a late-return race", async () => {
    const fixture = createSecurityLifecycleFixture()
    fixture.visit.status = "CHECKED_OUT"
    fixture.visit.visitorCardId = "card-1"
    fixture.visit.visitorCardReturned = false
    fixture.card.status = "NOT_RETURNED"
    fixture.card.currentVisitId = "visit-planned"
    fixture.card.assignedVisitorName = "Ada Yılmaz"
    fixture.beforeCardWrite(() => { fixture.card.status = "LOST" })
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.lateReturn("visit-planned", updatedAt)).rejects.toEqual(expect.objectContaining<Partial<VisitorCardConflictError>>({ reason: "INVALID_CARD_ASSIGNMENT" }))

    expect(fixture.visit.visitorCardReturned).toBe(false)
    expect(fixture.card).toMatchObject({ status: "LOST", currentVisitId: "visit-planned", assignedVisitorName: "Ada Yılmaz" })
  })

  it("turns a lost check-in CAS into CheckInConflictError without overwriting assignment", async () => {
    const fixture = createSecurityLifecycleFixture()
    fixture.tx.visitorCard.findUnique.mockImplementationOnce(async () => {
      const snapshot = { ...fixture.card }
      fixture.card.status = "DISABLED"
      return snapshot
    })
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.checkIn("visit-planned", { visitorCardId: "card-1" }, updatedAt)).rejects.toBeInstanceOf(CheckInConflictError)
    expect(fixture.visit).toMatchObject({ status: "PLANNED", visitorCardId: null })
    expect(fixture.card).toMatchObject({ status: "DISABLED", currentVisitId: null })
  })
})

interface FixtureRule { id: string; version: number; content: string }
interface FixtureAcceptance { id: string; visitId: string; visitorId: string; visitorRuleVersionId: string; ruleVersion: number; acceptedAt: Date; method: string; contentSnapshot: string; ipAddress: string | null }

/**
 * Public pre-registration fixture. `$transaction` snapshots and restores the mutable rows so a
 * throw inside it behaves like a real rollback — which is what the TOCTOU guard relies on.
 */
function createPublicInvitationFixture(options: { visitStatus?: string; activeRule?: FixtureRule | null } = {}) {
  const visitor = { id: "visitor-1", firstName: "Ada", lastName: "Yılmaz", email: "ada@example.test" as string | null, company: "Acme", phone: null as string | null }
  const visit = { id: "visit-1", visitorId: visitor.id, status: options.visitStatus ?? "PLANNED", vehiclePlate: null as string | null }
  const rule = options.activeRule === undefined ? { id: "rule-1", version: 3, content: "Ziyaretçi kuralı" } : options.activeRule
  let acceptances: FixtureAcceptance[] = []
  let beforeNextVisitWrite: (() => void) | undefined
  let failVisitorUpdate = false
  let failAcceptanceCreate = false

  const tx = {
    invitation: { findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => where.tokenHash === "token-hash" ? { visitId: visit.id, tokenHash: where.tokenHash, visit: { id: visit.id, status: visit.status, visitorId: visit.visitorId } } : null) },
    visit: {
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: { vehiclePlate?: string } }) => {
        beforeNextVisitWrite?.()
        beforeNextVisitWrite = undefined
        if (visit.id !== where.id || visit.status !== where.status) return { count: 0 }
        Object.assign(visit, data)
        return { count: 1 }
      }),
    },
    visitor: {
      update: vi.fn(async ({ data }: { data: Partial<typeof visitor> }) => {
        if (failVisitorUpdate) throw new Error("visitor write failed")
        return Object.assign(visitor, data)
      }),
    },
    visitorRuleVersion: { findFirst: vi.fn(async () => rule) },
    visitRuleAcceptance: {
      findUnique: vi.fn(async ({ where }: { where: { visitId_visitorRuleVersionId: { visitId: string; visitorRuleVersionId: string } } }) => acceptances.find((item) => item.visitId === where.visitId_visitorRuleVersionId.visitId && item.visitorRuleVersionId === where.visitId_visitorRuleVersionId.visitorRuleVersionId) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<FixtureAcceptance, "id"> }) => {
        const row = { id: `acceptance-${acceptances.length + 1}`, ...data }
        acceptances.push(row)
        if (failAcceptanceCreate) throw new Error("acceptance write failed")
        return row
      }),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => {
      // Only this transaction's own writes roll back: `status` models a *foreign* committed
      // cancel / check-in, which must survive the rollback exactly as it does in the database.
      const plateSnapshot = visit.vehiclePlate, visitorSnapshot = { ...visitor }, acceptanceSnapshot = [...acceptances]
      try {
        return await operation(tx)
      } catch (error) {
        visit.vehiclePlate = plateSnapshot
        Object.assign(visitor, visitorSnapshot)
        acceptances = acceptanceSnapshot
        throw error
      }
    }),
  } as unknown as PrismaClient

  return {
    prisma, tx, visit, visitor,
    acceptances: () => acceptances,
    beforeVisitWrite: (operation: () => void) => { beforeNextVisitWrite = operation },
    failVisitorUpdate: () => { failVisitorUpdate = true },
    failAcceptanceCreate: () => { failAcceptanceCreate = true },
  }
}

const publicVisitorInput = { firstName: "Ada Güncel", lastName: "Yılmaz", company: "Acme A.Ş.", email: "ada.guncel@example.test", phone: "5550000000", vehiclePlate: "16ABC123" }

describe("PrismaVisitorOperationsRepository public invitation revalidation", () => {
  it("updates the visitor and plate for a still-PLANNED visit", async () => {
    const fixture = createPublicInvitationFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await repository.updatePublicVisitor("token-hash", publicVisitorInput)

    expect(fixture.visitor).toMatchObject({ firstName: "Ada Güncel", lastName: "Yılmaz", company: "Acme A.Ş.", email: "ada.guncel@example.test", phone: "5550000000" })
    expect(fixture.visit.vehiclePlate).toBe("16ABC123")
    expect(fixture.tx.visit.updateMany).toHaveBeenCalledWith({ where: { id: "visit-1", status: "PLANNED" }, data: { vehiclePlate: "16ABC123" } })
  })

  it("accepts the active rule for a still-PLANNED visit and stays idempotent", async () => {
    const fixture = createPublicInvitationFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    const first = await repository.acceptPublicRule("token-hash", "203.0.113.7")
    const second = await repository.acceptPublicRule("token-hash", "203.0.113.7")

    expect(first).toMatchObject({ ruleId: "rule-1", ruleVersion: 3, method: "INVITATION_LINK", contentSnapshot: "Ziyaretçi kuralı" })
    expect(second.id).toBe(first.id)
    expect(fixture.acceptances()).toHaveLength(1)
  })

  it.each(["CANCELLED", "CHECKED_IN"])("writes nothing when the persisted visit is already %s", async (status) => {
    const fixture = createPublicInvitationFixture({ visitStatus: status })
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.updatePublicVisitor("token-hash", publicVisitorInput)).rejects.toBeInstanceOf(PublicInvitationInactiveError)
    await expect(repository.acceptPublicRule("token-hash")).rejects.toBeInstanceOf(PublicInvitationInactiveError)

    expect(fixture.visitor).toMatchObject({ firstName: "Ada", lastName: "Yılmaz", company: "Acme", email: "ada@example.test", phone: null })
    expect(fixture.visit.vehiclePlate).toBeNull()
    expect(fixture.tx.visit.updateMany).not.toHaveBeenCalled()
    expect(fixture.tx.visitor.update).not.toHaveBeenCalled()
    expect(fixture.acceptances()).toEqual([])
  })

  it("rejects an unknown token hash as an inactive invitation", async () => {
    const fixture = createPublicInvitationFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.updatePublicVisitor("other-token-hash", publicVisitorInput)).rejects.toBeInstanceOf(PublicInvitationInactiveError)
    await expect(repository.acceptPublicRule("other-token-hash")).rejects.toBeInstanceOf(PublicInvitationInactiveError)
    expect(fixture.tx.visitor.update).not.toHaveBeenCalled()
    expect(fixture.acceptances()).toEqual([])
  })

  it("cannot commit a public visitor write once a cancel lands between the in-transaction read and the write", async () => {
    const fixture = createPublicInvitationFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)
    fixture.beforeVisitWrite(() => { fixture.visit.status = "CANCELLED" })

    await expect(repository.updatePublicVisitor("token-hash", publicVisitorInput)).rejects.toBeInstanceOf(PublicInvitationInactiveError)

    expect(fixture.visit).toMatchObject({ status: "CANCELLED", vehiclePlate: null })
    expect(fixture.visitor).toMatchObject({ firstName: "Ada", company: "Acme", phone: null })
    expect(fixture.tx.visitor.update).not.toHaveBeenCalled()
  })

  it("rolls the plate back when the visitor half of the public write fails", async () => {
    const fixture = createPublicInvitationFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)
    fixture.failVisitorUpdate()

    await expect(repository.updatePublicVisitor("token-hash", publicVisitorInput)).rejects.toThrow("visitor write failed")

    expect(fixture.visit.vehiclePlate).toBeNull()
    expect(fixture.visitor).toMatchObject({ firstName: "Ada", company: "Acme", phone: null })
  })

  it("leaves no rule acceptance behind when the acceptance write fails", async () => {
    const fixture = createPublicInvitationFixture()
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)
    fixture.failAcceptanceCreate()

    await expect(repository.acceptPublicRule("token-hash")).rejects.toThrow("acceptance write failed")

    expect(fixture.acceptances()).toEqual([])
  })

  it("keeps a missing active rule distinct from an inactive invitation", async () => {
    const fixture = createPublicInvitationFixture({ activeRule: null })
    const repository = new PrismaVisitorOperationsRepository(fixture.prisma)

    await expect(repository.acceptPublicRule("token-hash")).rejects.not.toBeInstanceOf(PublicInvitationInactiveError)
    expect(fixture.acceptances()).toEqual([])
  })
})
