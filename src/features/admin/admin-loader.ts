import type { AdminUser, OperationalSettings, OrganizationSnapshot, VisitTypeDefinition, VisitorCardInventoryItem, VisitorRuleVersion } from "@/domain/admin"
import { createSessionGuard } from "@/lib/session-guard"
import type { AdminService } from "@/services/admin-service"
import type { SessionUser } from "@/services/session-service"

/** The reads the provider performs — the loader never writes, so it asks for nothing more. */
export type AdminReadService = Pick<AdminService, "getUsers" | "getOrganization" | "getVisitTypes" | "getVisitorCards" | "getVisitorRuleVersions" | "getOperationalSettings">

export interface AdminData {
  users: AdminUser[]
  organization: OrganizationSnapshot | null
  visitTypes: VisitTypeDefinition[]
  visitorCards: VisitorCardInventoryItem[]
  visitorRules: VisitorRuleVersion[]
  settings: OperationalSettings | null
}

export const EMPTY_ADMIN_DATA: AdminData = {
  users: [],
  organization: null,
  visitTypes: [],
  visitorCards: [],
  visitorRules: [],
  settings: null,
}

/**
 * How much of the Admin surface the signed-in session may read.
 * - `NONE` — signed out, or a role that reads nothing from this provider. No request is issued, so
 *   a cold `/login` load stays quiet instead of firing calls the backend would reject.
 * - `SETTINGS_ONLY` — Manager: just `GET /api/settings/operational`, which the backend guards with
 *   `requireAuthentication`. It is the single value non-Admin screens read from here
 *   (`useOperationalSettings()` in the Manager Dashboard); the Admin-only endpoints stay untouched.
 * - `FULL` — Admin: the whole Admin workspace, including the `/api/admin/*` endpoints that the
 *   backend guards with `requireRole("ADMIN")`.
 */
export type AdminDataScope = "NONE" | "SETTINGS_ONLY" | "FULL"

export function getAdminDataScope(user: SessionUser | null): AdminDataScope {
  if (!user) return "NONE"
  if (user.role === "ADMIN") return "FULL"
  return user.role === "MANAGER" ? "SETTINGS_ONLY" : "NONE"
}

async function fetchAdminData(service: AdminReadService, scope: AdminDataScope): Promise<AdminData> {
  if (scope === "SETTINGS_ONLY") {
    return { ...EMPTY_ADMIN_DATA, settings: await service.getOperationalSettings() }
  }
  const [users, organization, visitTypes, visitorCards, visitorRules, settings] = await Promise.all([
    service.getUsers(),
    service.getOrganization(),
    service.getVisitTypes(),
    service.getVisitorCards(),
    service.getVisitorRuleVersions(),
    service.getOperationalSettings(),
  ])
  return { users, organization, visitTypes, visitorCards, visitorRules, settings }
}

export interface AdminLoader {
  /** Session changed: drop the previous account's data, then load what the new scope allows. */
  applySession(scope: AdminDataScope): Promise<void>
  /** Manual refresh inside the current session — keeps the visible data until the new data lands. */
  refresh(scope: AdminDataScope): Promise<void>
  /** Applies a follow-up fetch (after a write) only while the session that issued it is current. */
  commitIfCurrent<T>(fetch: () => Promise<T>, apply: (value: T) => void): Promise<void>
}

export function createAdminLoader(service: AdminReadService, commit: (data: AdminData) => void): AdminLoader {
  const guard = createSessionGuard()

  const load = async (scope: AdminDataScope, token: number) => {
    if (scope === "NONE") return
    try {
      const data = await fetchAdminData(service, scope)
      if (guard.isCurrent(token)) commit(data)
    } catch {
      // A failed load must not reject into the effect that started it. The previous session's data
      // was already cleared, so the screen falls back to its empty/default state.
    }
  }

  return {
    applySession: (scope) => {
      const token = guard.begin()
      commit(EMPTY_ADMIN_DATA)
      return load(scope, token)
    },
    refresh: (scope) => load(scope, guard.current()),
    commitIfCurrent: async (fetch, apply) => {
      const token = guard.current()
      const value = await fetch()
      if (guard.isCurrent(token)) apply(value)
    },
  }
}
