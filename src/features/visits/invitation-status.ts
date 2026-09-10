import { hasVisitorEmail, type Visit } from "@/domain/visits"
import { formatTr } from "@/lib/date"

// A visitor without an email address can never have a pending invitation — there is nothing to
// send. Every "is this invitation actionable" filter below routes through this one helper so
// email eligibility isn't reimplemented per call site.
export function getPendingInvitationVisits(visits: Visit[]) {
  return visits.filter((visit) =>
    visit.status === "PLANNED" &&
    hasVisitorEmail(visit.visitor) &&
    (visit.invitationStatus === "NOT_SENT" || visit.invitationStatus === "SENDING" || visit.invitationStatus === "FAILED"),
  )
}

export function getVisiblePendingInvitationVisits(visits: Visit[], dismissedVisitIds: ReadonlySet<string>) {
  return getPendingInvitationVisits(visits).filter((visit) => !dismissedVisitIds.has(visit.id))
}

// Can the operator act on this invitation right now? `SENT` is done and a send still in flight
// must be left alone, but a `SENDING` record the backend flags as stale lost its attempt to a
// process restart and would otherwise sit on a spinner forever — the send endpoints re-claim such
// a record, so every surface offers the retry instead of hiding the action. Staleness is the
// server's call (`invitationSendStale`); nothing here compares timestamps.
export function isInvitationRetryable(visit: Pick<Visit, "invitationStatus" | "invitationSendStale">) {
  if (visit.invitationStatus === "NOT_SENT" || visit.invitationStatus === "FAILED") return true
  return visit.invitationStatus === "SENDING" && visit.invitationSendStale === true
}

export function getActionRequiredInvitationVisits(visits: Visit[], currentEmployeeId?: string) {
  if (!currentEmployeeId) return []

  return visits.filter((visit) =>
    visit.creatorEmployeeId === currentEmployeeId &&
    visit.status === "PLANNED" &&
    hasVisitorEmail(visit.visitor) &&
    isInvitationRetryable(visit),
  )
}

export function getInvitationActionLabel(visit: Visit, isSending = false) {
  if (isSending) return "Gönderiliyor…"
  if (visit.invitationStatus === "SENDING") return visit.invitationSendStale ? "Yeniden gönder" : "Gönderiliyor…"
  if (visit.invitationStatus === "FAILED") return "Yeniden gönder"
  if (visit.invitationStatus === "SENT") return "Davet gönderildi"
  return "Daveti gönder"
}

// The details dialog shows the send time next to the invitation badge, in the same long-month
// format the rest of that dialog uses for dates.
export function formatInvitationSentAt(sentAt: string) {
  return formatTr(new Date(sentAt), "d MMMM yyyy · HH:mm")
}
