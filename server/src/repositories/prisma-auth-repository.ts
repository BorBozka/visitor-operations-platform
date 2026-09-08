import type { PrismaClient } from "@prisma/client"

import { parseApplicationRole, parseAuthenticationSource, type AuthUserRecord, type SessionRecord, type SessionWithUser } from "../auth/auth-types.js"
import type { AuthRepository, CreateSessionInput, UpdatePasswordAndRevokeSessionsInput } from "./auth-repository.js"

const userSelect = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  authenticationSource: true,
  active: true,
  passwordHash: true,
  companyScopes: { select: { companyId: true } },
  facilityScopes: { select: { facilityId: true } },
  securityGateScopes: { select: { securityGateId: true } },
  employeeProfile: { select: { id: true } },
} as const

function toUserRecord(user: {
  id: string
  username: string
  fullName: string
  role: string
  authenticationSource: string
  active: boolean
  passwordHash: string | null
  companyScopes: { companyId: string }[]
  facilityScopes: { facilityId: string }[]
  securityGateScopes: { securityGateId: string }[]
  employeeProfile: { id: string } | null
}): AuthUserRecord {
  const role = parseApplicationRole(user.role)
  const authenticationSource = parseAuthenticationSource(user.authenticationSource)
  if (!role || !authenticationSource) throw new Error("Unsupported persisted user role or authentication source.")
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role,
    authenticationSource,
    active: user.active,
    passwordHash: user.passwordHash,
    authorizationScope: {
      companyIds: user.companyScopes.map((scope) => scope.companyId),
      facilityIds: user.facilityScopes.map((scope) => scope.facilityId),
      securityGateIds: user.securityGateScopes.map((scope) => scope.securityGateId),
    },
    employeeId: user.employeeProfile?.id ?? null,
  }
}

function toSessionRecord(session: {
  id: string
  userId: string
  tokenHash: string
  createdAt: Date
  expiresAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}): SessionRecord {
  return session
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserByUsernameNormalized(usernameNormalized: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({ where: { usernameNormalized }, select: userSelect })
    return user ? toUserRecord(user) : null
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: userSelect })
    return user ? toUserRecord(user) : null
  }

  async updatePasswordAndRevokeSessions(input: UpdatePasswordAndRevokeSessionsInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id: input.userId }, data: { passwordHash: input.passwordHash } })
      await transaction.session.updateMany({
        where: {
          userId: input.userId,
          revokedAt: null,
          ...(input.exceptSessionTokenHash ? { tokenHash: { not: input.exceptSessionTokenHash } } : {}),
        },
        data: { revokedAt: input.revokedAt },
      })
    }, { isolationLevel: "Serializable" })
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const session = await this.prisma.session.create({ data: input })
    return toSessionRecord(session)
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: { select: userSelect } },
    })
    return session ? { ...toSessionRecord(session), user: toUserRecord(session.user) } : null
  }

  async touchSession(tokenHash: string, usedAt: Date): Promise<void> {
    await this.prisma.session.updateMany({ where: { tokenHash, revokedAt: null }, data: { lastUsedAt: usedAt } })
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.prisma.session.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt } })
  }
}
