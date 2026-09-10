import { useCallback, useEffect, useRef, useState } from "react"

import type { InvitationStatus, Visit } from "@/domain/visits"
import { useVisits } from "@/features/visits/visit-context"

// How long a row keeps showing its "Davet gönderildi" result before it clears itself. The
// sidebar Bildirimler panel drops the sent row when its dropdown closes; the always-open
// İşlem gerekenler overlay has no such moment, so it lingers on a short timer instead.
const SENT_RESULT_LINGER_MS = 3000

function withId(ids: ReadonlySet<string>, id: string) {
  const next = new Set(ids)
  next.add(id)
  return next
}

function withoutId(ids: ReadonlySet<string>, id: string) {
  const next = new Set(ids)
  next.delete(id)
  return next
}

// Direct "send this one invitation" flow, shared by every notification surface: it drives the
// existing `sendVisitInvitation` service call, guards against a double click while a send is in
// flight, and tracks the per-visit result so a row can show success/failure and offer a retry
// without opening the visit form.
export function useInvitationSend() {
  const { sendVisitInvitation } = useVisits()
  const [sendingIds, setSendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [sentIds, setSentIds] = useState<ReadonlySet<string>>(() => new Set())
  const inFlightRef = useRef(new Set<string>())
  const timersRef = useRef(new Set<number>())

  useEffect(() => () => { timersRef.current.forEach((timer) => window.clearTimeout(timer)) }, [])

  const sendInvitation = useCallback(async (visitId: string) => {
    if (inFlightRef.current.has(visitId)) return

    inFlightRef.current.add(visitId)
    setSendingIds(new Set(inFlightRef.current))
    setFailedIds((current) => withoutId(current, visitId))
    try {
      const result = await sendVisitInvitation(visitId)
      if (result.invitationStatus === "FAILED") {
        setFailedIds((current) => withId(current, visitId))
      } else if (result.invitationStatus === "SENT") {
        setSentIds((current) => withId(current, visitId))
        const timer = window.setTimeout(() => {
          timersRef.current.delete(timer)
          setSentIds((current) => withoutId(current, visitId))
        }, SENT_RESULT_LINGER_MS)
        timersRef.current.add(timer)
      }
      // A result still `SENDING` is neither: this request lost the send claim to a concurrent
      // sender, so it must not paint the row "Davet gönderildi" for an email it never sent. Left
      // out of both sets, the row falls back to `resolveStatus`'s reading of the reloaded record —
      // a spinner while the winner's attempt is in flight, a retry once it is stale or failed.
    } catch {
      setFailedIds((current) => withId(current, visitId))
    } finally {
      inFlightRef.current.delete(visitId)
      setSendingIds(new Set(inFlightRef.current))
    }
  }, [sendVisitInvitation])

  const resolveStatus = useCallback((visit: Pick<Visit, "id" | "invitationStatus" | "invitationSendStale">): InvitationStatus => {
    if ((visit.invitationStatus === "SENDING" && !visit.invitationSendStale) || sendingIds.has(visit.id)) return "SENDING"
    if (failedIds.has(visit.id)) return "FAILED"
    if (sentIds.has(visit.id)) return "SENT"
    // Still `SENDING` here means the backend flagged the attempt stale — a send lost to a process
    // restart, not one in flight. Reporting it as a failure gives the row back its retry action,
    // which the backend's send endpoint honours by re-claiming the record.
    return visit.invitationStatus === "SENDING" ? "FAILED" : visit.invitationStatus
  }, [sendingIds, failedIds, sentIds])

  return { sendInvitation, resolveStatus, sentIds }
}
