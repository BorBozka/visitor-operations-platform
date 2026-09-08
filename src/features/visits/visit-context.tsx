import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import type { Meeting, MeetingInput, MeetingWithVisits, RescheduleVisitInput, Visit, VisitReferenceData } from "@/domain/visits"
import { useAuth } from "@/features/auth/auth-context"
import { getSessionKey } from "@/features/auth/session-identity"
import { createVisitLoader, INITIAL_VISIT_STATE, type VisitState } from "@/features/visits/visit-loader"
import type { VisitService } from "@/services"

interface VisitContextValue {
  meetings: Meeting[]
  visits: Visit[]
  referenceData: VisitReferenceData | null
  isLoading: boolean
  error: string | null
  reload(): Promise<void>
  createMeeting(input: MeetingInput): Promise<MeetingWithVisits>
  updateMeeting(id: string, input: MeetingInput): Promise<MeetingWithVisits>
  sendMeetingInvitations(id: string): Promise<Visit[]>
  sendVisitInvitation(id: string): Promise<Visit>
  rescheduleVisit(id: string, input: RescheduleVisitInput): Promise<Visit>
  cancelVisit(id: string): Promise<Visit>
  cancelMeeting(id: string): Promise<Visit[]>
}

const VisitContext = createContext<VisitContextValue | null>(null)

export function VisitProvider({ service, children }: { service: VisitService; children: React.ReactNode }) {
  const { currentUser } = useAuth()
  const sessionKey = getSessionKey(currentUser)
  const signedIn = sessionKey !== null
  const [state, setState] = useState<VisitState>(INITIAL_VISIT_STATE)
  // One loader per provider instance: its session guard must outlive individual loads so a late
  // response from a previous session is still recognised as stale.
  const [loader] = useState(() =>
    createVisitLoader(service, (patch) => setState((previous) => ({ ...previous, ...patch }))),
  )

  // Keyed on the session so a logout clears immediately and an account switch reloads for the
  // account that is signed in now.
  useEffect(() => { void loader.applySession(signedIn) }, [loader, signedIn, sessionKey])

  const reload = useCallback(() => loader.reload(signedIn), [loader, signedIn])

  const createMeeting = useCallback(
    async (input: MeetingInput) => {
      const created = await service.createMeeting(input)
      await loader.refresh()
      return created
    },
    [loader, service],
  )

  const updateMeeting = useCallback(
    async (id: string, input: MeetingInput) => {
      const updated = await service.updateMeeting(id, input)
      await loader.refresh()
      return updated
    },
    [loader, service],
  )

  const sendMeetingInvitations = useCallback(
    async (id: string) => {
      const updated = await service.sendMeetingInvitations(id)
      await loader.refresh()
      return updated
    },
    [loader, service],
  )

  const sendVisitInvitation = useCallback(
    async (id: string) => {
      const updated = await service.sendVisitInvitation(id)
      await loader.refresh()
      return updated
    },
    [loader, service],
  )

  const rescheduleVisit = useCallback(
    async (id: string, input: RescheduleVisitInput) => {
      const updated = await service.rescheduleVisit(id, input)
      await loader.refresh()
      return updated
    },
    [loader, service],
  )

  const cancelVisit = useCallback(
    async (id: string) => {
      const updated = await service.cancelVisit(id)
      await loader.refresh()
      return updated
    },
    [loader, service],
  )

  const cancelMeeting = useCallback(
    async (id: string) => {
      const updated = await service.cancelMeeting(id)
      await loader.refresh()
      return updated
    },
    [loader, service],
  )

  const value = useMemo(
    () => ({
      ...state,
      reload,
      createMeeting,
      updateMeeting,
      sendMeetingInvitations,
      sendVisitInvitation,
      rescheduleVisit,
      cancelVisit,
      cancelMeeting,
    }),
    [state, reload, createMeeting, updateMeeting, sendMeetingInvitations, sendVisitInvitation, rescheduleVisit, cancelVisit, cancelMeeting],
  )

  return <VisitContext.Provider value={value}>{children}</VisitContext.Provider>
}

// The hook intentionally shares this module with its provider so the context remains private.
// eslint-disable-next-line react-refresh/only-export-components
export function useVisits() {
  const context = useContext(VisitContext)
  if (!context) throw new Error("useVisits, VisitProvider içinde kullanılmalıdır.")
  return context
}
