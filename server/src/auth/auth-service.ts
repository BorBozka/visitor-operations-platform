import { invalidCredentialsError, validationError } from "../lib/api-error.js"
import { normalizeIdentity } from "../lib/names.js"
import type { AuthRepository } from "../repositories/auth-repository.js"
import { hashPassword, verifyPassword } from "./password.js"
import { createSessionToken, hashSessionToken } from "./session-token.js"
import { toSessionUser, type SessionUser } from "./auth-types.js"

export interface AuthServiceOptions {
  sessionTtlHours: number
  now?: () => Date
  createToken?: () => string
}

export interface LoginResult {
  user: SessionUser
  rawSessionToken: string
  expiresAt: Date
}

export class AuthService {
  private readonly now: () => Date
  private readonly createToken: () => string

  constructor(
    private readonly repository: AuthRepository,
    private readonly options: AuthServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date())
    this.createToken = options.createToken ?? createSessionToken
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.repository.findUserByUsernameNormalized(normalizeIdentity(username))
    if (!user || user.authenticationSource !== "LOCAL" || !user.active || !user.passwordHash) throw invalidCredentialsError()
    if (!await verifyPassword(user.passwordHash, password)) throw invalidCredentialsError()

    const createdAt = this.now()
    const expiresAt = new Date(createdAt.getTime() + this.options.sessionTtlHours * 60 * 60 * 1000)
    const rawSessionToken = this.createToken()
    await this.repository.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(rawSessionToken),
      createdAt,
      expiresAt,
    })

    return { user: toSessionUser(user), rawSessionToken, expiresAt }
  }

  async getCurrentSession(rawSessionToken: string | undefined): Promise<SessionUser | null> {
    if (!rawSessionToken) return null
    const tokenHash = hashSessionToken(rawSessionToken)
    const session = await this.repository.findSessionByTokenHash(tokenHash)
    const now = this.now()
    if (!session || session.revokedAt || session.expiresAt <= now || !session.user.active) return null
    await this.repository.touchSession(tokenHash, now)
    return toSessionUser(session.user)
  }

  async logout(rawSessionToken: string | undefined): Promise<void> {
    if (!rawSessionToken) return
    await this.repository.revokeSessionByTokenHash(hashSessionToken(rawSessionToken), this.now())
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, currentRawSessionToken: string): Promise<void> {
    if (!currentPassword || !newPassword || newPassword.length < 8 || newPassword === currentPassword) throw validationError()
    const user = await this.repository.findUserById(userId)
    if (!user || user.authenticationSource !== "LOCAL" || !user.active || !user.passwordHash) throw invalidCredentialsError()
    if (!await verifyPassword(user.passwordHash, currentPassword)) throw new Error("CURRENT_PASSWORD_INVALID")
    await this.repository.updatePasswordAndRevokeSessions({
      userId: user.id,
      passwordHash: await hashPassword(newPassword),
      revokedAt: this.now(),
      exceptSessionTokenHash: hashSessionToken(currentRawSessionToken),
    })
  }
}
