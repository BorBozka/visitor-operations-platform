import type { PrismaClient } from "@prisma/client"

import type { AuthorizationScope } from "../lib/scope.js"
import type { EmployeeRecord, OrganizationEntity, OrganizationKind, SaveOrganizationInput } from "../modules/organization/types.js"
import type { EmployeeScopeFilter, OrganizationRepository } from "./organization-repository.js"

function toEntity(row: { id: string; name: string; active: boolean; createdAt: Date; updatedAt: Date }, parentId?: string): OrganizationEntity {
  return { id: row.id, name: row.name, active: row.active, ...(parentId ? { parentId } : {}), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}

/** Facility-dimension predicate — an empty assigned facility scope leaves facilities unconstrained. */
function facilityIdWhere(scope: AuthorizationScope, field: string) {
  return scope.facilityIds.length > 0 ? { [field]: { in: scope.facilityIds } } : {}
}

/**
 * The caller's scope translated into a `where` clause per organization kind, mirroring
 * `isWithinAuthorizationScope`: the company must be in scope, and the facility / gate dimensions
 * narrow further only when they carry an explicit assignment.
 */
function scopeWhere(kind: OrganizationKind, scope: AuthorizationScope) {
  switch (kind) {
    case "COMPANY": return { id: { in: scope.companyIds } }
    case "FACILITY": return { companyId: { in: scope.companyIds }, ...facilityIdWhere(scope, "id") }
    case "DEPARTMENT": return { companyId: { in: scope.companyIds } }
    case "SECURITY_GATE": return {
      facility: { companyId: { in: scope.companyIds } },
      ...facilityIdWhere(scope, "facilityId"),
      ...(scope.securityGateIds.length > 0 ? { id: { in: scope.securityGateIds } } : {}),
    }
  }
}

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(kind: OrganizationKind, includeInactive: boolean, scope: AuthorizationScope): Promise<OrganizationEntity[]> {
    const where = { ...(includeInactive ? {} : { active: true }), ...scopeWhere(kind, scope) }
    switch (kind) {
      case "COMPANY": return (await this.prisma.company.findMany({ where, orderBy: { name: "asc" } })).map((row) => toEntity(row))
      case "FACILITY": return (await this.prisma.facility.findMany({ where, orderBy: { name: "asc" } })).map((row) => toEntity(row, row.companyId))
      case "DEPARTMENT": return (await this.prisma.department.findMany({ where, orderBy: { name: "asc" } })).map((row) => toEntity(row, row.companyId))
      case "SECURITY_GATE": return (await this.prisma.securityGate.findMany({ where, orderBy: { name: "asc" } })).map((row) => toEntity(row, row.facilityId))
    }
  }

  async find(kind: OrganizationKind, id: string, scope: AuthorizationScope): Promise<OrganizationEntity | null> {
    const where = { id, ...scopeWhere(kind, scope) }
    switch (kind) {
      case "COMPANY": { const row = await this.prisma.company.findFirst({ where }); return row ? toEntity(row) : null }
      case "FACILITY": { const row = await this.prisma.facility.findFirst({ where }); return row ? toEntity(row, row.companyId) : null }
      case "DEPARTMENT": { const row = await this.prisma.department.findFirst({ where }); return row ? toEntity(row, row.companyId) : null }
      case "SECURITY_GATE": { const row = await this.prisma.securityGate.findFirst({ where }); return row ? toEntity(row, row.facilityId) : null }
    }
  }

  async save(kind: OrganizationKind, input: SaveOrganizationInput & { nameNormalized: string }): Promise<OrganizationEntity> {
    const data = { name: input.name, nameNormalized: input.nameNormalized, active: input.active }
    switch (kind) {
      case "COMPANY": { const row = input.id ? await this.prisma.company.update({ where: { id: input.id }, data }) : await this.prisma.company.create({ data }); return toEntity(row) }
      case "FACILITY": { const row = input.id ? await this.prisma.facility.update({ where: { id: input.id }, data }) : await this.prisma.facility.create({ data: { ...data, companyId: input.parentId! } }); return toEntity(row, row.companyId) }
      case "DEPARTMENT": { const row = input.id ? await this.prisma.department.update({ where: { id: input.id }, data }) : await this.prisma.department.create({ data: { ...data, companyId: input.parentId! } }); return toEntity(row, row.companyId) }
      case "SECURITY_GATE": { const row = input.id ? await this.prisma.securityGate.update({ where: { id: input.id }, data }) : await this.prisma.securityGate.create({ data: { ...data, facilityId: input.parentId! } }); return toEntity(row, row.facilityId) }
    }
  }

  async hasActiveChildren(kind: OrganizationKind, id: string): Promise<boolean> {
    if (kind === "COMPANY") return Boolean(await this.prisma.facility.count({ where: { companyId: id, active: true } }) || await this.prisma.department.count({ where: { companyId: id, active: true } }))
    if (kind === "FACILITY") return (await this.prisma.securityGate.count({ where: { facilityId: id, active: true } })) > 0
    return false
  }

  async findSibling(kind: OrganizationKind, parentId: string | undefined, nameNormalized: string): Promise<OrganizationEntity | null> {
    switch (kind) {
      case "COMPANY": { const row = await this.prisma.company.findFirst({ where: { nameNormalized } }); return row ? toEntity(row) : null }
      case "FACILITY": { const row = await this.prisma.facility.findFirst({ where: { nameNormalized, companyId: parentId } }); return row ? toEntity(row, row.companyId) : null }
      case "DEPARTMENT": { const row = await this.prisma.department.findFirst({ where: { nameNormalized, companyId: parentId } }); return row ? toEntity(row, row.companyId) : null }
      case "SECURITY_GATE": { const row = await this.prisma.securityGate.findFirst({ where: { nameNormalized, facilityId: parentId } }); return row ? toEntity(row, row.facilityId) : null }
    }
  }

  async listEmployees(filter: EmployeeScopeFilter): Promise<EmployeeRecord[]> {
    const rows = await this.prisma.employee.findMany({
      where: {
        ...(filter.includeInactive ? {} : { active: true }),
        companyId: { in: filter.companyIds },
        ...(filter.facilityIds ? { facilityScopes: { some: { facilityId: { in: filter.facilityIds } } } } : {}),
      },
      include: { facilityScopes: { select: { facilityId: true } } }, orderBy: { fullName: "asc" },
    })
    return rows.map(toEmployee)
  }

  async findEmployee(id: string, scope: AuthorizationScope): Promise<EmployeeRecord | null> {
    const row = await this.prisma.employee.findFirst({
      where: {
        id,
        companyId: { in: scope.companyIds },
        ...(scope.facilityIds.length > 0 ? { facilityScopes: { some: { facilityId: { in: scope.facilityIds } } } } : {}),
      },
      include: { facilityScopes: { select: { facilityId: true } } },
    })
    return row ? toEmployee(row) : null
  }
}

function toEmployee(row: { id: string; userId: string | null; fullName: string; companyId: string; departmentId: string | null; active: boolean; createdAt: Date; updatedAt: Date } & { facilityScopes: { facilityId: string }[] }): EmployeeRecord {
  return { id: row.id, userId: row.userId, fullName: row.fullName, companyId: row.companyId, departmentId: row.departmentId, facilityIds: row.facilityScopes.map((scope) => scope.facilityId), active: row.active, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}
