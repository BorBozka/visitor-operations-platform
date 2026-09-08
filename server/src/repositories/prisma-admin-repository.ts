import type { Prisma, PrismaClient } from "@prisma/client"

import { parseApplicationRole, roleRequiresEmployeeProfile, type AdminUser, type AuthorizationScope } from "../modules/admin/types.js"
import { EmployeeProvisioningScopeError, type AdminRepository, type PersistedAdminUserInput } from "./admin-repository.js"

const userInclude = { companyScopes: { select: { companyId: true } }, facilityScopes: { select: { facilityId: true } }, securityGateScopes: { select: { securityGateId: true } } } as const
const provisioningUserInclude = { ...userInclude, employeeProfile: { select: { id: true } } } as const

function toUser(row: { id: string; fullName: string; username: string; email: string; authenticationSource: string; role: string; active: boolean; createdAt: Date; updatedAt: Date } & { companyScopes: { companyId: string }[]; facilityScopes: { facilityId: string }[]; securityGateScopes: { securityGateId: string }[] }): AdminUser {
  const role = parseApplicationRole(row.role)
  if (!role || (row.authenticationSource !== "LOCAL" && row.authenticationSource !== "ACTIVE_DIRECTORY")) throw new Error("Unsupported persisted user role or authentication source.")
  return { id: row.id, fullName: row.fullName, username: row.username, email: row.email, authenticationSource: row.authenticationSource, role, authorizationScope: { companyIds: row.companyScopes.map((scope) => scope.companyId), facilityIds: row.facilityScopes.map((scope) => scope.facilityId), securityGateIds: row.securityGateScopes.map((scope) => scope.securityGateId) }, active: row.active, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}

function scopeWrites(scope: AuthorizationScope) {
  return { companyScopes: { deleteMany: {}, create: scope.companyIds.map((companyId) => ({ companyId })) }, facilityScopes: { deleteMany: {}, create: scope.facilityIds.map((facilityId) => ({ facilityId })) }, securityGateScopes: { deleteMany: {}, create: scope.securityGateIds.map((securityGateId) => ({ securityGateId })) } }
}

async function requireEmployeeFacility(transaction: Prisma.TransactionClient, role: AdminUser["role"], scope: AuthorizationScope) {
  if (!roleRequiresEmployeeProfile(role)) return null
  if (scope.facilityIds.length !== 1) throw new EmployeeProvisioningScopeError()
  const facility = await transaction.facility.findUnique({ where: { id: scope.facilityIds[0] }, select: { id: true, companyId: true } })
  if (!facility || !scope.companyIds.includes(facility.companyId)) throw new EmployeeProvisioningScopeError()
  return facility
}

async function synchronizeEmployeeProfile(
  transaction: Prisma.TransactionClient,
  user: { id: string; fullName: string; role: string; active: boolean; employeeProfile: { id: string } | null; companyScopes: { companyId: string }[]; facilityScopes: { facilityId: string }[] },
) {
  const role = parseApplicationRole(user.role)
  if (!role) throw new Error("Unsupported persisted user role.")
  const scope = { companyIds: user.companyScopes.map((item) => item.companyId), facilityIds: user.facilityScopes.map((item) => item.facilityId), securityGateIds: [] }
  const facility = await requireEmployeeFacility(transaction, role, scope)

  if (!facility) {
    if (user.employeeProfile) await transaction.employee.update({ where: { id: user.employeeProfile.id }, data: { fullName: user.fullName, active: false } })
    return
  }

  const profile = { fullName: user.fullName, companyId: facility.companyId, active: user.active }
  if (user.employeeProfile) {
    await transaction.employee.update({ where: { id: user.employeeProfile.id }, data: { ...profile, facilityScopes: { deleteMany: {}, create: { facilityId: facility.id } } } })
    return
  }
  await transaction.employee.create({ data: { userId: user.id, ...profile, facilityScopes: { create: { facilityId: facility.id } } } })
}

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async listUsers() { return (await this.prisma.user.findMany({ include: userInclude, orderBy: { fullName: "asc" } })).map(toUser) }
  async findUser(id: string) { const row = await this.prisma.user.findUnique({ where: { id }, include: userInclude }); return row ? toUser(row) : null }
  async findUserByUsernameNormalized(value: string) { const row = await this.prisma.user.findUnique({ where: { usernameNormalized: value }, include: userInclude }); return row ? toUser(row) : null }
  async findUserByEmailNormalized(value: string) { const row = await this.prisma.user.findUnique({ where: { emailNormalized: value }, include: userInclude }); return row ? toUser(row) : null }
  countActiveAdmins(excludeUserId?: string) { return this.prisma.user.count({ where: { role: "ADMIN", active: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) } }) }
  async createLocalUser(input: PersistedAdminUserInput & { scope: AuthorizationScope }) {
    const row = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { fullName: input.fullName, username: input.username, usernameNormalized: input.usernameNormalized, email: input.email, emailNormalized: input.emailNormalized, passwordHash: input.passwordHash, role: input.role, authenticationSource: "LOCAL", active: input.active, companyScopes: { create: input.scope.companyIds.map((companyId) => ({ companyId })) }, facilityScopes: { create: input.scope.facilityIds.map((facilityId) => ({ facilityId })) }, securityGateScopes: { create: input.scope.securityGateIds.map((securityGateId) => ({ securityGateId })) } }, include: provisioningUserInclude })
      await synchronizeEmployeeProfile(transaction, user)
      return user
    }, { isolationLevel: "Serializable" })
    return toUser(row)
  }
  async updateUser(id: string, input: Partial<PersistedAdminUserInput> & { scope?: AuthorizationScope }) {
    const row = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({ where: { id }, data: { ...(input.fullName !== undefined ? { fullName: input.fullName } : {}), ...(input.username !== undefined ? { username: input.username, usernameNormalized: input.usernameNormalized } : {}), ...(input.email !== undefined ? { email: input.email, emailNormalized: input.emailNormalized } : {}), ...(input.role !== undefined ? { role: input.role } : {}), ...(input.active !== undefined ? { active: input.active } : {}), ...(input.scope ? scopeWrites(input.scope) : {}) }, include: provisioningUserInclude })
      await synchronizeEmployeeProfile(transaction, user)
      return user
    }, { isolationLevel: "Serializable" })
    return toUser(row)
  }
  async findScopeReferences(scope: AuthorizationScope) {
    const [companies, facilities, gates] = await Promise.all([this.prisma.company.findMany({ where: { id: { in: scope.companyIds } }, select: { id: true } }), this.prisma.facility.findMany({ where: { id: { in: scope.facilityIds } }, select: { id: true, companyId: true } }), this.prisma.securityGate.findMany({ where: { id: { in: scope.securityGateIds } }, select: { id: true, facilityId: true, facility: { select: { companyId: true } } } })])
    return { companyIds: companies.map((item) => item.id), facilities, gates: gates.map((item) => ({ id: item.id, facilityId: item.facilityId, companyId: item.facility.companyId })) }
  }
}
