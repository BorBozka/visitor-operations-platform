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
      } else {
        setSentIds((current) => withId(current, visitId))
        const timer = window.setTimeout(() => {
          timersRef.current.delete(timer)
          setSentIds((current) => withoutId(current, visitId))
        }, SENT_RESULT_LINGER_MS)
        timersRef.current.add(timer)
      }
    } catch {
      setFailedIds((current) => withId(current, visitId))
    } finally {
      inFlightRef.current.delete(visitId)
      setSendingIds(new Set(inFlightRef.current))
    }
  }, [sendVisitInvitation])

  const resolveStatus = useCallback((visit: Pick<Visit, "id" | "invitationStatus">): InvitationStatus => {
    if (visit.invitationStatus === "SENDING" || sendingIds.has(visit.id)) return "SENDING"
    if (failedIds.has(visit.id)) return "FAILED"
    if (sentIds.has(visit.id)) return "SENT"
    return visit.invitationStatus
  }, [sendingIds, failedIds, sentIds])

  return { sendInvitation, resolveStatus, sentIds }
}
