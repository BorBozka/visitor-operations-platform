import type { Meeting, Visit, VisitReferenceData } from "@/domain/visits"
import { createSessionGuard } from "@/lib/session-guard"
import type { VisitService } from "@/services"

/** The reads the provider performs; writes stay in the provider. */
export type VisitReadService = Pick<VisitService, "listMeetings" | "listVisits" | "getReferenceData">

export interface VisitState {
  meetings: Meeting[]
  visits: Visit[]
  referenceData: VisitReferenceData | null
  isLoading: boolean
  error: string | null
}

/** Loading until the first session settles, so no screen renders "no visits" before the load runs. */
export const INITIAL_VISIT_STATE: VisitState = {
  meetings: [],
  visits: [],
  referenceData: null,
  isLoading: true,
  error: null,
}

export interface VisitLoader {
  /** Session changed: drop the previous account's visits, then load for the new one if signed in. */
  applySession(signedIn: boolean): Promise<void>
  /** Manual reload inside the current session — keeps the visible data until the new data lands. */
  reload(signedIn: boolean): Promise<void>
  /** Post-write refresh. Rejects to the caller like before, but never writes into a newer session. */
  refresh(): Promise<void>
}

export function createVisitLoader(
  service: VisitReadService,
  commit: (patch: Partial<VisitState>) => void,
): VisitLoader {
  const guard = createSessionGuard()

  const load = async (signedIn: boolean, token: number) => {
    // Identity is resolved server-side for the signed-in user, so there is nothing to request
    // while signed out.
    if (!signedIn) return
    commit({ isLoading: true, error: null })
    try {
      const [meetings, visits, referenceData] = await Promise.all([
        service.listMeetings(),
        service.listVisits(),
        service.getReferenceData(),
      ])
      if (guard.isCurrent(token)) commit({ meetings, visits, referenceData, isLoading: false })
    } catch (loadError) {
      if (guard.isCurrent(token)) {
        commit({ error: loadError instanceof Error ? loadError.message : "Ziyaretler yüklenemedi.", isLoading: false })
      }
    }
  }

  return {
    applySession: (signedIn) => {
      const token = guard.begin()
      commit({ meetings: [], visits: [], referenceData: null, isLoading: signedIn, error: null })
      return load(signedIn, token)
    },
    reload: (signedIn) => load(signedIn, guard.current()),
    refresh: async () => {
      const token = guard.current()
      const [meetings, visits] = await Promise.all([service.listMeetings(), service.listVisits()])
      if (guard.isCurrent(token)) commit({ meetings, visits })
    },
  }
}
