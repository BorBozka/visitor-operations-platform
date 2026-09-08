import type { EmployeeRecord, OrganizationEntity, OrganizationKind, SaveOrganizationInput } from "../modules/organization/types.js"
import type { AuthorizationScope } from "../lib/scope.js"

/**
 * Company/facility id sets a read is confined to, as produced by `resolveScopeFilter`. An empty
 * `companyIds` matches nothing; a `null` `facilityIds` means "any facility inside those companies".
 */
export interface EmployeeScopeFilter {
  companyIds: string[]
  facilityIds: string[] | null
  includeInactive: boolean
}

/**
 * Every read takes the caller's assigned scope and applies it in the query itself, so an
 * out-of-scope row is never loaded (and a single-entity read comes back `null`, which the service
 * reports as 404 rather than leaking the record's existence).
 */
export interface OrganizationRepository {
  list(kind: OrganizationKind, includeInactive: boolean, scope: AuthorizationScope): Promise<OrganizationEntity[]>
  find(kind: OrganizationKind, id: string, scope: AuthorizationScope): Promise<OrganizationEntity | null>
  save(kind: OrganizationKind, input: SaveOrganizationInput & { nameNormalized: string }): Promise<OrganizationEntity>
  hasActiveChildren(kind: OrganizationKind, id: string): Promise<boolean>
  /** Same-parent name collision check. Unscoped on purpose: it mirrors the DB unique constraint,
   * which a caller must not be able to violate through a sibling their scope hides. */
  findSibling(kind: OrganizationKind, parentId: string | undefined, nameNormalized: string): Promise<OrganizationEntity | null>
  listEmployees(filter: EmployeeScopeFilter): Promise<EmployeeRecord[]>
  findEmployee(id: string, scope: AuthorizationScope): Promise<EmployeeRecord | null>
}
