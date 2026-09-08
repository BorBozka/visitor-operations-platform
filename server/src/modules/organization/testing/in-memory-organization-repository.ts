import type { EmployeeRecord, OrganizationEntity, OrganizationKind, SaveOrganizationInput } from "../types.js"
import type { AuthorizationScope } from "../../../lib/scope.js"
import type { EmployeeScopeFilter, OrganizationRepository } from "../../../repositories/organization-repository.js"

const clone = <T>(value: T): T => structuredClone(value)
const keyByKind: Record<OrganizationKind, "companies" | "facilities" | "departments" | "securityGates"> = { COMPANY: "companies", FACILITY: "facilities", DEPARTMENT: "departments", SECURITY_GATE: "securityGates" }

export class InMemoryOrganizationRepository implements OrganizationRepository {
  private sequence = 0
  private readonly data: Record<"companies" | "facilities" | "departments" | "securityGates", OrganizationEntity[]>
  private readonly employees: EmployeeRecord[]

  constructor(initial: Partial<Record<"companies" | "facilities" | "departments" | "securityGates", OrganizationEntity[]>> = {}, employees: EmployeeRecord[] = []) {
    this.data = { companies: clone(initial.companies ?? []), facilities: clone(initial.facilities ?? []), departments: clone(initial.departments ?? []), securityGates: clone(initial.securityGates ?? []) }
    this.employees = clone(employees)
  }

  /** Mirrors the Prisma repository's per-kind scope predicate (see `scopeWhere` there). */
  private inScope(kind: OrganizationKind, entity: OrganizationEntity, scope: AuthorizationScope): boolean {
    const facilityAllowed = (facilityId: string) => scope.facilityIds.length === 0 || scope.facilityIds.includes(facilityId)
    switch (kind) {
      case "COMPANY": return scope.companyIds.includes(entity.id)
      case "FACILITY": return scope.companyIds.includes(entity.parentId ?? "") && facilityAllowed(entity.id)
      case "DEPARTMENT": return scope.companyIds.includes(entity.parentId ?? "")
      case "SECURITY_GATE": {
        const facility = this.data.facilities.find((item) => item.id === entity.parentId)
        if (!facility || !scope.companyIds.includes(facility.parentId ?? "") || !facilityAllowed(facility.id)) return false
        return scope.securityGateIds.length === 0 || scope.securityGateIds.includes(entity.id)
      }
    }
  }

  async list(kind: OrganizationKind, includeInactive: boolean, scope: AuthorizationScope) {
    return clone(this.data[keyByKind[kind]].filter((item) => (includeInactive || item.active) && this.inScope(kind, item, scope)))
  }
  async find(kind: OrganizationKind, id: string, scope: AuthorizationScope) {
    const item = this.data[keyByKind[kind]].find((candidate) => candidate.id === id)
    return item && this.inScope(kind, item, scope) ? clone(item) : null
  }
  async save(kind: OrganizationKind, input: SaveOrganizationInput & { nameNormalized: string }) {
    const key = keyByKind[kind]
    const existing = input.id ? this.data[key].find((item) => item.id === input.id) : undefined
    const now = new Date("2026-01-01T00:00:00.000Z").toISOString()
    const entity: OrganizationEntity = { id: existing?.id ?? `${kind.toLowerCase()}-${++this.sequence}`, name: input.name, active: input.active, ...(input.parentId ? { parentId: input.parentId } : {}), createdAt: existing?.createdAt ?? now, updatedAt: now }
    this.data[key] = existing ? this.data[key].map((item) => item.id === entity.id ? entity : item) : [...this.data[key], entity]
    return clone(entity)
  }
  async hasActiveChildren(kind: OrganizationKind, id: string) {
    if (kind === "COMPANY") return [...this.data.facilities, ...this.data.departments].some((item) => item.parentId === id && item.active)
    return kind === "FACILITY" && this.data.securityGates.some((item) => item.parentId === id && item.active)
  }
  async findSibling(kind: OrganizationKind, parentId: string | undefined, nameNormalized: string) {
    const sibling = this.data[keyByKind[kind]].find((item) => item.parentId === parentId && item.name.trim().toLocaleLowerCase("tr-TR") === nameNormalized)
    return sibling ? clone(sibling) : null
  }
  async listEmployees(filter: EmployeeScopeFilter) {
    return clone(this.employees.filter((employee) => (filter.includeInactive || employee.active)
      && filter.companyIds.includes(employee.companyId)
      && (!filter.facilityIds || employee.facilityIds.some((facilityId) => filter.facilityIds!.includes(facilityId)))))
  }
  async findEmployee(id: string, scope: AuthorizationScope) {
    const employee = this.employees.find((candidate) => candidate.id === id)
    if (!employee || !scope.companyIds.includes(employee.companyId)) return null
    if (scope.facilityIds.length > 0 && !employee.facilityIds.some((facilityId) => scope.facilityIds.includes(facilityId))) return null
    return clone(employee)
  }
}
