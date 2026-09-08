import type { AuthUserRecord, SessionRecord, SessionWithUser } from "../auth/auth-types.js"

export interface CreateSessionInput {
  userId: string
  tokenHash: string
  createdAt: Date
  expiresAt: Date
}

export interface UpdatePasswordAndRevokeSessionsInput {
  userId: string
  passwordHash: string
  revokedAt: Date
  exceptSessionTokenHash?: string
}

/** Authentication's persistence boundary. Services remain unit-testable without MSSQL. */
export interface AuthRepository {
  findUserByUsernameNormalized(usernameNormalized: string): Promise<AuthUserRecord | null>
  findUserById(id: string): Promise<AuthUserRecord | null>
  updatePasswordAndRevokeSessions(input: UpdatePasswordAndRevokeSessionsInput): Promise<void>
  createSession(input: CreateSessionInput): Promise<SessionRecord>
  findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null>
  touchSession(tokenHash: string, usedAt: Date): Promise<void>
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>
}
