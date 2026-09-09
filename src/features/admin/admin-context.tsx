/* eslint-disable react-refresh/only-export-components -- context hook belongs beside its provider. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { DEFAULT_OVERDUE_TOLERANCE_MINUTES, type AdminUser, type OperationalSettings, type OrganizationEntity, type OrganizationKind, type OrganizationSnapshot, type VisitTypeDefinition, type VisitorCardInventoryItem, type VisitorRuleVersion } from "@/domain/admin"
import { createAdminLoader, EMPTY_ADMIN_DATA, getAdminDataScope } from "@/features/admin/admin-loader"
import { useAuth } from "@/features/auth/auth-context"
import { getSessionKey } from "@/features/auth/session-identity"
import type { AdminService } from "@/services/admin-service"

interface AdminContextValue {
  users: AdminUser[]
  organization: OrganizationSnapshot | null
  visitTypes: VisitTypeDefinition[]
  visitorCards: VisitorCardInventoryItem[]
  visitorRules: VisitorRuleVersion[]
  settings: OperationalSettings | null
  reload(): Promise<void>
  saveOrganizationEntity(kind: OrganizationKind, entity: Omit<OrganizationEntity, "id"> & { id?: string }): Promise<OrganizationEntity>
  markVisitorCardLost(id: string): Promise<VisitorCardInventoryItem>
  restoreVisitorCard(id: string): Promise<VisitorCardInventoryItem>
  deleteVisitorCard(id: string): Promise<void>
}

const AdminContext = createContext<AdminContextValue | null>(null)

export function AdminProvider({ service, children }: { service: AdminService; children: ReactNode }) {
  const { currentUser } = useAuth()
  const sessionKey = getSessionKey(currentUser)
  const scope = getAdminDataScope(currentUser)
  const [data, setData] = useState(EMPTY_ADMIN_DATA)
  // One loader per provider instance: its session guard must outlive individual loads so a late
  // response from a previous session is still recognised as stale.
  const [loader] = useState(() => createAdminLoader(service, setData))

  // Keyed on the session as well as the scope: switching between two Managers keeps the same
  // scope but must still drop the previous account's data and reload.
  useEffect(() => { void loader.applySession(scope) }, [loader, scope, sessionKey])

  const reload = useCallback(() => loader.refresh(scope), [loader, scope])
  const saveOrganizationEntity = useCallback(async (kind: OrganizationKind, entity: Omit<OrganizationEntity, "id"> & { id?: string }) => {
    const saved = await service.saveOrganizationEntity(kind, entity)
    await loader.commitIfCurrent(() => service.getOrganization(), (organization) => setData((previous) => ({ ...previous, organization })))
    return saved
  }, [loader, service])
  const markVisitorCardLost = useCallback(async (id: string) => {
    const updated = await service.markVisitorCardLost(id)
    await loader.commitIfCurrent(() => service.getVisitorCards(), (visitorCards) => setData((previous) => ({ ...previous, visitorCards })))
    return updated
  }, [loader, service])
  const restoreVisitorCard = useCallback(async (id: string) => {
    const updated = await service.restoreVisitorCard(id)
    await loader.commitIfCurrent(() => service.getVisitorCards(), (visitorCards) => setData((previous) => ({ ...previous, visitorCards })))
    return updated
  }, [loader, service])
  const deleteVisitorCard = useCallback(async (id: string) => {
    await service.deleteVisitorCard(id)
    await loader.commitIfCurrent(() => service.getVisitorCards(), (visitorCards) => setData((previous) => ({ ...previous, visitorCards })))
  }, [loader, service])
  const value = useMemo(() => ({ ...data, reload, saveOrganizationEntity, markVisitorCardLost, restoreVisitorCard, deleteVisitorCard }), [data, reload, saveOrganizationEntity, markVisitorCardLost, restoreVisitorCard, deleteVisitorCard])
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) throw new Error("useAdmin must be used inside AdminProvider")
  return context
}

/**
 * Narrow view for non-Admin screens (e.g. Manager Dashboard) that only need the
 * operational settings, without exposing the full Admin surface. Falls back to the
 * seeded defaults until the shared AdminProvider finishes its initial load.
 */
export function useOperationalSettings(): OperationalSettings {
  const { settings } = useAdmin()
  return useMemo(
    () => settings ?? { overdueToleranceMinutes: DEFAULT_OVERDUE_TOLERANCE_MINUTES, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" },
    [settings],
  )
}
