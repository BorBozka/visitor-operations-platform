import type { ApplicationRole, SessionUser } from "../auth/auth-types.js"
import { isWithinAuthorizationScope, type AuthorizationScope } from "./scope.js"

/**
 * Per-request authorization context. Routes build this from the session (`request.currentUser`)
 * and hand it to services so read filtering and mutation checks derive entirely from the
 * authenticated user — never from a client-supplied actor id or a `companyId=all` bypass.
 */
export interface AccessContext {
  userId: string
  role: ApplicationRole
  /** Linked Employee id, or `null` for a pure Admin account. */
  employeeId: string | null
  /** Raw assigned scope. Every role is company-scoped: an empty `companyIds` sees nothing. */
  scope: AuthorizationScope
}

export function toAccessContext(user: SessionUser): AccessContext {
  return { userId: user.id, role: user.role, employeeId: user.employeeId, scope: user.authorizationScope }
}

/** Does this context's assigned scope reach the given company (and facility / gate, if given)? */
export function scopeAllows(
  ctx: AccessContext,
  target: { companyId: string; facilityId?: string; securityGateId?: string },
): boolean {
  return isWithinAuthorizationScope(ctx.scope, target)
}

/**
 * Resolve a report/list filter's `companyId`/`facilityId` (which may be `"all"`, `""`, or
 * `undefined`) into the concrete id sets the query may return, always intersected with the
 * context's assigned scope. `"all"` therefore means "everything I am allowed to see", never
 * "everything". A concrete id outside scope collapses the result to empty rather than leaking.
 */
export function resolveScopeFilter(
  ctx: AccessContext,
  requested: { companyId?: string; facilityId?: string },
): { companyIds: string[]; facilityIds: string[] | null } {
  const wildcard = (value: string | undefined) => value === undefined || value === "" || value === "all"

  const companyIds = wildcard(requested.companyId)
    ? [...ctx.scope.companyIds]
    : ctx.scope.companyIds.includes(requested.companyId!)
      ? [requested.companyId!]
      : []

  // An empty assigned facility scope means "any facility inside the allowed companies".
  const assignedFacilities = ctx.scope.facilityIds
  let facilityIds: string[] | null
  if (wildcard(requested.facilityId)) {
    facilityIds = assignedFacilities.length > 0 ? [...assignedFacilities] : null
  } else if (assignedFacilities.length === 0 || assignedFacilities.includes(requested.facilityId!)) {
    facilityIds = [requested.facilityId!]
  } else {
    facilityIds = []
  }

  return { companyIds, facilityIds }
}

/** A row is visible when its company is in the allowed set and (if constrained) its facility too. */
export function matchesScopeFilter(
  filter: { companyIds: string[]; facilityIds: string[] | null },
  row: { companyId: string; facilityId: string },
): boolean {
  if (!filter.companyIds.includes(row.companyId)) return false
  if (filter.facilityIds !== null && !filter.facilityIds.includes(row.facilityId)) return false
  return true
}
