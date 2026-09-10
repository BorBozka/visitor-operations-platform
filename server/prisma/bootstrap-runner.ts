import type { Prisma, PrismaClient } from "@prisma/client"

import { hashPassword } from "../src/auth/password.js"
import { decideBootstrap, type BootstrapDatabaseState, type BootstrapInput, type BootstrapRoot } from "./bootstrap-contract.js"

export class BootstrapStateError extends Error {
  constructor(reason: string) {
    super(`Bootstrap çalıştırılmadı: ${reason}`)
    this.name = "BootstrapStateError"
  }
}

export type BootstrapOutcome = { status: "CREATED" | "ALREADY_BOOTSTRAPPED"; root: BootstrapRoot }

async function readState(transaction: Prisma.TransactionClient): Promise<BootstrapDatabaseState> {
  const userCount = await transaction.user.count()
  const companies = await transaction.company.findMany({ select: { id: true, nameNormalized: true, facilities: { select: { id: true, nameNormalized: true } } } })
  const adminUsers = await transaction.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true, usernameNormalized: true, active: true, authenticationSource: true, companyScopes: { select: { companyId: true } } },
  })
  return {
    userCount,
    companies,
    adminUsers: adminUsers.map((user) => ({ id: user.id, usernameNormalized: user.usernameNormalized, active: user.active, authenticationSource: user.authenticationSource, companyScopeIds: user.companyScopes.map((scope) => scope.companyId) })),
  }
}

/**
 * Creates the minimum administrative root a clean production database needs before anyone can log
 * in: the first Company, one Facility under it, and the first ADMIN user with a company-level
 * authorization scope.
 *
 * Everything else — further facilities, departments, security gates, visit types, visitor cards,
 * operational settings, the active visitor rule, and every other account — is created afterwards
 * by that Admin through the normal API/UI, and is deliberately absent here.
 *
 * The Admin's scope is `companyIds: [company]` with no facility or gate assignment, which is the
 * broadest scope this authorization model can express (an empty facility/gate list is
 * "unconstrained inside the scoped companies", see `isWithinAuthorizationScope`). It is an
 * ordinary LOCAL account with an ordinary ADMIN role — no bootstrap-only runtime role exists, and
 * the operator signs in through the normal `/api/auth/login` flow. ADMIN needs no Employee
 * profile (`roleRequiresEmployeeProfile`), so none is created.
 *
 * The state check and every write share one SERIALIZABLE transaction, matching
 * `PrismaAdminRepository`: a run either leaves the full root behind or leaves the database
 * untouched. A half-bootstrapped state (company without Admin, Admin without scope) cannot be
 * committed.
 */
export async function runProductionBootstrap(prisma: PrismaClient, input: BootstrapInput): Promise<BootstrapOutcome> {
  // Argon2id is intentionally slow; hashing before the transaction opens keeps that cost off the
  // database locks. The plain password is not referenced again after this line.
  const passwordHash = await hashPassword(input.adminPassword)

  return prisma.$transaction(async (transaction) => {
    const decision = decideBootstrap(await readState(transaction), input)
    if (decision.kind === "REFUSE") throw new BootstrapStateError(decision.reason)
    if (decision.kind === "ALREADY_BOOTSTRAPPED") return { status: "ALREADY_BOOTSTRAPPED", root: decision.root }

    const company = await transaction.company.create({ data: { name: input.company.name, nameNormalized: input.company.nameNormalized, active: true } })
    const facility = await transaction.facility.create({ data: { companyId: company.id, name: input.facility.name, nameNormalized: input.facility.nameNormalized, active: true } })
    const admin = await transaction.user.create({
      data: {
        username: input.admin.username,
        usernameNormalized: input.admin.usernameNormalized,
        fullName: input.admin.fullName,
        email: input.admin.email,
        emailNormalized: input.admin.emailNormalized,
        passwordHash,
        role: "ADMIN",
        authenticationSource: "LOCAL",
        active: true,
        companyScopes: { create: [{ companyId: company.id }] },
      },
    })
    return { status: "CREATED", root: { companyId: company.id, facilityId: facility.id, adminUserId: admin.id } }
  }, { isolationLevel: "Serializable" })
}
