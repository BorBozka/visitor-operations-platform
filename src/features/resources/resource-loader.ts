import type { FacilityResource } from "@/domain/resources"
import { createSessionGuard } from "@/lib/session-guard"
import type { ResourceCatalogService } from "@/services"
import type { SessionUser } from "@/services/session-service"

/** The single read the provider performs; writes stay in the provider. */
export type ResourceReadService = Pick<ResourceCatalogService, "listResources">

export interface ResourceState {
  resources: FacilityResource[]
  isLoading: boolean
  error: string | null
}

/** Loading until the first session settles, so the catalog does not flash an empty list. */
export const INITIAL_RESOURCE_STATE: ResourceState = { resources: [], isLoading: true, error: null }

/**
 * `/api/resources` is guarded by `requireRole("ADMIN", "MANAGER")` on the backend. Every other
 * session — signed out, Employee, Security — reads nothing here and must not issue the request.
 */
export function canLoadResources(user: SessionUser | null): boolean {
  return user?.role === "ADMIN" || user?.role === "MANAGER"
}

export interface ResourceLoader {
  /** Session changed: drop the previous account's resources, then load if the new one may read them. */
  applySession(allowed: boolean): Promise<void>
  /** Manual reload inside the current session — keeps the visible list until the new one lands. */
  reload(allowed: boolean): Promise<void>
  /** Post-write refresh. Rejects to the caller like before, but never writes into a newer session. */
  refresh(): Promise<void>
}

export function createResourceLoader(
  service: ResourceReadService,
  commit: (patch: Partial<ResourceState>) => void,
): ResourceLoader {
  const guard = createSessionGuard()

  const load = async (allowed: boolean, token: number) => {
    if (!allowed) return
    commit({ isLoading: true, error: null })
    try {
      const resources = await service.listResources()
      if (guard.isCurrent(token)) commit({ resources, isLoading: false })
    } catch (loadError) {
      if (guard.isCurrent(token)) {
        commit({ error: loadError instanceof Error ? loadError.message : "Kaynaklar yüklenemedi.", isLoading: false })
      }
    }
  }

  return {
    applySession: (allowed) => {
      const token = guard.begin()
      commit({ resources: [], isLoading: allowed, error: null })
      return load(allowed, token)
    },
    reload: (allowed) => load(allowed, guard.current()),
    refresh: async () => {
      const token = guard.current()
      const resources = await service.listResources()
      if (guard.isCurrent(token)) commit({ resources })
    },
  }
}
