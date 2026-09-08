import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import type { MeetingInput } from "../modules/visitor-operations/types.js"
import { PrismaVisitorOperationsRepository } from "./visitor-operations-repository.js"

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

describe("PrismaVisitorOperationsRepository card audit identity", () => {
  it("keeps assignment on LOST and clears it only when restored to AVAILABLE", async () => {
    let card: FixtureCard = {
      id: "card-1",
      cardNumber: "001",
      status: "NOT_RETURNED",
      currentVisitId: "visit-1",
      assignedVisitorName: "Ada Yılmaz",
      createdAt: updatedAt,
      updatedAt,
    }
    const prisma = {
      visitorCard: {
        update: vi.fn(async ({ data }: { data: Partial<FixtureCard> }) => {
          card = { ...card, ...data }
          return card
        }),
      },
    } as unknown as PrismaClient
    const repository = new PrismaVisitorOperationsRepository(prisma)

    await expect(repository.setCardStatus("card-1", "LOST")).resolves.toMatchObject({
      status: "LOST",
      assignedVisitId: "visit-1",
      assignedVisitorName: "Ada Yılmaz",
    })
    await expect(repository.setCardStatus("card-1", "AVAILABLE")).resolves.toMatchObject({
      status: "AVAILABLE",
      assignedVisitId: undefined,
      assignedVisitorName: undefined,
    })
  })
})
