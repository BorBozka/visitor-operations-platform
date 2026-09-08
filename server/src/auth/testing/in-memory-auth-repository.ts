import type { AuthUserRecord, SessionRecord, SessionWithUser } from "../auth-types.js"
import type { AuthRepository, CreateSessionInput, UpdatePasswordAndRevokeSessionsInput } from "../../repositories/auth-repository.js"

export class InMemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUserRecord>()
  readonly sessions = new Map<string, SessionRecord>()
  private sequence = 0
  private passwordSessionFailure: "password" | "revoke" | null = null

  constructor(users: AuthUserRecord[] = []) {
    users.forEach((user) => this.users.set(user.id, { ...user }))
  }

  async findUserByUsernameNormalized(usernameNormalized: string): Promise<AuthUserRecord | null> {
    const user = [...this.users.values()].find((candidate) => candidate.username.trim().toLowerCase() === usernameNormalized)
    return user ? { ...user } : null
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const user = this.users.get(id)
    return user ? { ...user } : null
  }

  async updatePasswordAndRevokeSessions(input: UpdatePasswordAndRevokeSessionsInput): Promise<void> {
    const user = this.users.get(input.userId)
    if (!user) throw new Error("User not found")
    if (this.passwordSessionFailure === "password") {
      this.passwordSessionFailure = null
      throw new Error("Password update failed")
    }

    const nextUser = { ...user, passwordHash: input.passwordHash }
    const nextSessions = new Map(this.sessions)
    for (const [tokenHash, session] of nextSessions) {
      if (session.userId === input.userId && !session.revokedAt && tokenHash !== input.exceptSessionTokenHash) {
        nextSessions.set(tokenHash, { ...session, revokedAt: input.revokedAt })
      }
    }
    if (this.passwordSessionFailure === "revoke") {
      this.passwordSessionFailure = null
      throw new Error("Session revoke failed")
    }

    this.users.set(input.userId, nextUser)
    this.sessions.clear()
    nextSessions.forEach((session, tokenHash) => this.sessions.set(tokenHash, session))
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const session: SessionRecord = { id: `session-${++this.sequence}`, ...input, lastUsedAt: null, revokedAt: null }
    this.sessions.set(session.tokenHash, session)
    return { ...session }
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    const session = this.sessions.get(tokenHash)
    const user = session ? this.users.get(session.userId) : undefined
    return session && user ? { ...session, user: { ...user } } : null
  }

  async touchSession(tokenHash: string, usedAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash)
    if (session) this.sessions.set(tokenHash, { ...session, lastUsedAt: usedAt })
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash)
    if (session && !session.revokedAt) this.sessions.set(tokenHash, { ...session, revokedAt })
  }

  failNextPasswordUpdate(): void { this.passwordSessionFailure = "password" }
  failNextSessionRevoke(): void { this.passwordSessionFailure = "revoke" }
}
