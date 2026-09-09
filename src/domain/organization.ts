/**
 * Canonical organization model shared by Admin, Visits, and future Security work.
 * Parent IDs deliberately use the established operational IDs, rather than the former
 * Admin-only `company-*` / `facility-*` identifiers.
 */
export interface OrganizationEntity {
  id: string
  parentId?: string
  name: string
  active: boolean
}

export type Company = OrganizationEntity
export type Facility = OrganizationEntity & { parentId: string }
export type Department = OrganizationEntity & { parentId: string }
export type SecurityGate = OrganizationEntity & { parentId: string }

export type OrganizationKind = "COMPANY" | "FACILITY" | "DEPARTMENT" | "SECURITY_GATE"

export interface OrganizationSnapshot {
  companies: Company[]
  facilities: Facility[]
  departments: Department[]
  securityGates: SecurityGate[]
}
