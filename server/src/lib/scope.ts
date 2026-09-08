export interface AuthorizationScope {
  companyIds: string[]
  facilityIds: string[]
  securityGateIds: string[]
}

export function isWithinAuthorizationScope(
  scope: AuthorizationScope,
  target: { companyId: string; facilityId?: string; securityGateId?: string },
): boolean {
  if (!scope.companyIds.includes(target.companyId)) return false
  if (scope.facilityIds.length > 0 && target.facilityId && !scope.facilityIds.includes(target.facilityId)) return false
  if (scope.securityGateIds.length > 0 && target.securityGateId && !scope.securityGateIds.includes(target.securityGateId)) return false
  return true
}

/**
 * Is `inner` entirely contained by `outer` — i.e. does it grant nothing `outer` does not already
 * grant? Used to bound what an acting Admin may hand out or keep visible: their own assigned
 * scope is their maximum authority, so a user whose scope reaches further is neither theirs to
 * read nor theirs to write.
 *
 * Empty means "unconstrained" on the facility/gate dimensions (mirroring
 * {@link isWithinAuthorizationScope}), so an empty `inner` list inside a constrained `outer` list
 * is *broader*, not narrower, and is therefore not contained. An empty `companyIds` grants
 * nothing at all, so it is contained by anything.
 */
export function isScopeWithin(inner: AuthorizationScope, outer: AuthorizationScope): boolean {
  const contains = (outerIds: string[], innerIds: string[]) =>
    outerIds.length === 0 ? true : innerIds.length > 0 && innerIds.every((id) => outerIds.includes(id))
  if (!inner.companyIds.every((companyId) => outer.companyIds.includes(companyId))) return false
  return contains(outer.facilityIds, inner.facilityIds) && contains(outer.securityGateIds, inner.securityGateIds)
}
