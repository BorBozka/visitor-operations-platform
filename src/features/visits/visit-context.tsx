import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import type { Meeting, MeetingInput, MeetingWithVisits, RescheduleVisitInput, Visit, VisitReferenceData } from "@/domain/visits"
import { useAuth } from "@/features/auth/auth-context"
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
  const currentUserId = currentUser?.id ?? null
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [referenceData, setReferenceData] = useState<VisitReferenceData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Identity is resolved server-side for the signed-in user.
    // Skip while signed out and re-run when the user changes so stale data never leaks across logins.
    if (!currentUserId) {
      setMeetings([])
      setVisits([])
      setReferenceData(null)
      setError(null)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const [nextMeetings, nextVisits, nextReferenceData] = await Promise.all([
        service.listMeetings(),
        service.listVisits(),
        service.getReferenceData(),
      ])
      setMeetings(nextMeetings)
      setVisits(nextVisits)
      setReferenceData(nextReferenceData)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Ziyaretler yüklenemedi.")
    } finally {
      setIsLoading(false)
    }
  }, [service, currentUserId])

  useEffect(() => {
    void load()
  }, [load])

  const refreshData = useCallback(async () => {
    const [nextMeetings, nextVisits] = await Promise.all([service.listMeetings(), service.listVisits()])
    setMeetings(nextMeetings)
    setVisits(nextVisits)
  }, [service])

  const createMeeting = useCallback(
    async (input: MeetingInput) => {
      const created = await service.createMeeting(input)
      await refreshData()
      return created
    },
    [refreshData, service],
  )

  const updateMeeting = useCallback(
    async (id: string, input: MeetingInput) => {
      const updated = await service.updateMeeting(id, input)
      await refreshData()
      return updated
    },
    [refreshData, service],
  )

  const sendMeetingInvitations = useCallback(
    async (id: string) => {
      const updated = await service.sendMeetingInvitations(id)
      await refreshData()
      return updated
    },
    [refreshData, service],
  )

  const sendVisitInvitation = useCallback(
    async (id: string) => {
      const updated = await service.sendVisitInvitation(id)
      await refreshData()
      return updated
    },
    [refreshData, service],
  )

  const rescheduleVisit = useCallback(
    async (id: string, input: RescheduleVisitInput) => {
      const updated = await service.rescheduleVisit(id, input)
      await refreshData()
      return updated
    },
    [refreshData, service],
  )

  const cancelVisit = useCallback(
    async (id: string) => {
      const updated = await service.cancelVisit(id)
      await refreshData()
      return updated
    },
    [refreshData, service],
  )

  const cancelMeeting = useCallback(
    async (id: string) => {
      const updated = await service.cancelMeeting(id)
      await refreshData()
      return updated
    },
    [refreshData, service],
  )

  const value = useMemo(
    () => ({
      meetings,
      visits,
      referenceData,
      isLoading,
      error,
      reload: load,
      createMeeting,
      updateMeeting,
      sendMeetingInvitations,
      sendVisitInvitation,
      rescheduleVisit,
      cancelVisit,
      cancelMeeting,
    }),
    [meetings, visits, referenceData, isLoading, error, load, createMeeting, updateMeeting, sendMeetingInvitations, sendVisitInvitation, rescheduleVisit, cancelVisit, cancelMeeting],
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
