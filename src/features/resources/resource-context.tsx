import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import type { FacilityResource, ResourceInput } from "@/domain/resources"
import { useAuth } from "@/features/auth/auth-context"
import { getSessionKey } from "@/features/auth/session-identity"
import { canLoadResources, createResourceLoader, INITIAL_RESOURCE_STATE, type ResourceState } from "@/features/resources/resource-loader"
import type { ResourceCatalogService } from "@/services"

interface ResourceContextValue {
  resources: FacilityResource[]
  isLoading: boolean
  error: string | null
  reload(): Promise<void>
  createResource(input: ResourceInput): Promise<FacilityResource>
  updateResource(id: string, input: ResourceInput): Promise<FacilityResource>
  setResourceActive(id: string, isActive: boolean): Promise<FacilityResource>
  deleteResource(id: string): Promise<void>
}

const ResourceContext = createContext<ResourceContextValue | null>(null)

export function ResourceProvider({ service, children }: { service: ResourceCatalogService; children: React.ReactNode }) {
  const { currentUser } = useAuth()
  const sessionKey = getSessionKey(currentUser)
  const allowed = canLoadResources(currentUser)
  const [state, setState] = useState<ResourceState>(INITIAL_RESOURCE_STATE)
  // One loader per provider instance: its session guard must outlive individual loads so a late
  // response from a previous session is still recognised as stale.
  const [loader] = useState(() =>
    createResourceLoader(service, (patch) => setState((previous) => ({ ...previous, ...patch }))),
  )

  // Keyed on the session as well as the permission: switching between two Managers stays allowed
  // but must still drop the previous account's resources and reload.
  useEffect(() => { void loader.applySession(allowed) }, [loader, allowed, sessionKey])

  const reload = useCallback(() => loader.reload(allowed), [loader, allowed])

  const createResource = useCallback(async (input: ResourceInput) => {
    const created = await service.createResource(input)
    await loader.refresh()
    return created
  }, [loader, service])

  const updateResource = useCallback(async (id: string, input: ResourceInput) => {
    const updated = await service.updateResource(id, input)
    await loader.refresh()
    return updated
  }, [loader, service])

  const setResourceActive = useCallback(async (id: string, isActive: boolean) => {
    const updated = await service.setResourceActive(id, isActive)
    await loader.refresh()
    return updated
  }, [loader, service])

  const deleteResource = useCallback(async (id: string) => {
    await service.deleteResource(id)
    await loader.refresh()
  }, [loader, service])

  const value = useMemo(() => ({
    ...state,
    reload,
    createResource,
    updateResource,
    setResourceActive,
    deleteResource,
  }), [state, reload, createResource, updateResource, setResourceActive, deleteResource])

  return <ResourceContext.Provider value={value}>{children}</ResourceContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useResources() {
  const context = useContext(ResourceContext)
  if (!context) throw new Error("useResources, ResourceProvider içinde kullanılmalıdır.")
  return context
}
