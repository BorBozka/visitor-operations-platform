import { describe, expect, it } from "vitest"

import type { Visit, VisitStatus } from "@/domain/visits"
import { formatInvitationSentAt, getActionRequiredInvitationVisits, getInvitationActionLabel, getPendingInvitationVisits, isInvitationRetryable } from "@/features/visits/invitation-status"

function makeVisit(id: string, status: VisitStatus, overrides: Partial<Visit> = {}): Visit {
  return {
    id,
    meetingId: `meeting-${id}`,
    creatorEmployeeId: "creator-1",
    visitor: { id: `visitor-${id}`, firstName: id, lastName: "Ziyaretçi", email: "visitor@example.com", company: "Örnek Firma" },
    visitTypeId: "meeting",
    visitTypeName: "Toplantı",
    hostEmployeeId: "host-1",
    hostEmployeeName: "İpek Işık",
    hostCompanyId: "bplas",
    hostCompanyName: "BPLAS A.Ş.",
    facilityId: "bplas-merkez",
    facilityName: "Merkez Tesis",
    plannedStart: "2026-08-28T12:30:00+03:00",
    plannedEnd: "2026-08-28T13:00:00+03:00",
    status,
    invitationStatus: "NOT_SENT",
    hasAdditionalRequirements: false,
    createdAt: "2026-08-28T09:00:00+03:00",
    updatedAt: "2026-08-28T09:00:00+03:00",
    ...overrides,
  }
}

describe("getPendingInvitationVisits", () => {
  it("excludes a PLANNED visit whose visitor has no email", () => {
    const noEmail = makeVisit("no-email", "PLANNED", { visitor: { id: "v1", firstName: "A", lastName: "B", email: undefined, company: "C" } })
    const withEmail = makeVisit("with-email", "PLANNED")
    expect(getPendingInvitationVisits([noEmail, withEmail]).map((visit) => visit.id)).toEqual(["with-email"])
  })
})

describe("getActionRequiredInvitationVisits", () => {
  it("never returns a visit whose visitor has no email, even when otherwise action-required", () => {
    const noEmail = makeVisit("no-email", "PLANNED", { creatorEmployeeId: "creator-1", visitor: { id: "v1", firstName: "A", lastName: "B", email: undefined, company: "C" } })
    const withEmail = makeVisit("with-email", "PLANNED", { creatorEmployeeId: "creator-1" })
    expect(getActionRequiredInvitationVisits([noEmail, withEmail], "creator-1").map((visit) => visit.id)).toEqual(["with-email"])
  })
})

/**
 * Stale-`SENDING` recovery reaching the UI (NEW-9). A `SENDING` invitation whose send attempt the
 * backend has written off must regain its action instead of sitting on a spinner forever; a
 * `SENDING` attempt still in flight must keep it hidden so a second send is never triggered.
 * Staleness is always the backend's `invitationSendStale`, never a date comparison made here.
 */
describe("isInvitationRetryable", () => {
  it.each(["NOT_SENT", "FAILED"] as const)("offers the action for a %s invitation", (invitationStatus) => {
    expect(isInvitationRetryable(makeVisit("v", "PLANNED", { invitationStatus }))).toBe(true)
  })

  it("withholds the action while a send is still in flight", () => {
    expect(isInvitationRetryable(makeVisit("v", "PLANNED", { invitationStatus: "SENDING" }))).toBe(false)
  })

  it("offers the action once the backend marks the send attempt stale", () => {
    expect(isInvitationRetryable(makeVisit("v", "PLANNED", { invitationStatus: "SENDING", invitationSendStale: true }))).toBe(true)
  })

  it("never offers the action for an invitation already sent", () => {
    expect(isInvitationRetryable(makeVisit("v", "PLANNED", { invitationStatus: "SENT", invitationSendStale: true }))).toBe(false)
  })
})

describe("getActionRequiredInvitationVisits stale recovery", () => {
  it("surfaces a stale SENDING visit and keeps an in-flight one out", () => {
    const stale = makeVisit("stale", "PLANNED", { invitationStatus: "SENDING", invitationSendStale: true })
    const inFlight = makeVisit("in-flight", "PLANNED", { invitationStatus: "SENDING" })

    expect(getActionRequiredInvitationVisits([stale, inFlight], "creator-1").map((visit) => visit.id)).toEqual(["stale"])
  })
})

describe("getInvitationActionLabel", () => {
  it("keeps a send in flight labelled as sending", () => {
    expect(getInvitationActionLabel(makeVisit("v", "PLANNED", { invitationStatus: "SENDING" }))).toBe("Gönderiliyor…")
  })

  it("labels a stale SENDING as a retry so the operator can recover it", () => {
    expect(getInvitationActionLabel(makeVisit("v", "PLANNED", { invitationStatus: "SENDING", invitationSendStale: true }))).toBe("Yeniden gönder")
  })

  it("still reports a locally in-flight send as sending regardless of the stored state", () => {
    expect(getInvitationActionLabel(makeVisit("v", "PLANNED", { invitationStatus: "SENDING", invitationSendStale: true }), true)).toBe("Gönderiliyor…")
  })
})

describe("formatInvitationSentAt", () => {
  it("uses the long Turkish month format the details dialog shows dates in", () => {
    expect(formatInvitationSentAt(new Date(2026, 8, 1, 9, 15).toISOString())).toBe("1 Eylül 2026 · 09:15")
  })
})
