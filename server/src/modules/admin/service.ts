import { ApiError } from "../../lib/api-error.js"
import { normalizeIdentity } from "../../lib/names.js"
import { isScopeWithin } from "../../lib/scope.js"
import type { AccessContext } from "../../lib/authorization.js"
import { hashPassword } from "../../auth/password.js"
import type { AuthRepository } from "../../repositories/auth-repository.js"
import { EmployeeProvisioningScopeError, LastActiveAdminError, type AdminRepository, type PersistedAdminUserInput } from "../../repositories/admin-repository.js"
import { roleRequiresEmployeeProfile, type AdminUser, type AuthorizationScope, type CreateAdminUserInput, type UpdateAdminUserInput } from "./types.js"

function uniqueIds(values: string[]) { return [...new Set(values)] }
function normalizedScope(scope: AuthorizationScope): AuthorizationScope { return { companyIds: uniqueIds(scope.companyIds), facilityIds: uniqueIds(scope.facilityIds), securityGateIds: uniqueIds(scope.securityGateIds) } }

const outOfScopeError = () => new ApiError(403, "OUT_OF_SCOPE", "Kendi yetki kapsamınızın dışına yetki veremezsiniz.")

/**
 * User administration, bounded by the acting Admin's own assigned scope. ADMIN is *not* a global
 * super-admin here: the acting Admin's scope is their maximum authority, so
 *
 * - a user account is visible/editable only when its whole scope sits inside the acting Admin's
 *   (an account reaching further belongs to another tenant and reads as 404, never revealing that
 *   it exists), and
 * - any scope written — to a new user, to another user, or to the acting Admin's own account —
 *   must itself sit inside the acting Admin's current scope, which is what stops both lateral
 *   grants and self-escalation. Existence of the referenced ids is checked as well, but it is
 *   never sufficient on its own.
 *
 * "At least one active Admin must remain" is deliberately global — a system-integrity invariant,
 * not a per-tenant one — and it is *not* decided here: the repository enforces it inside the same
 * transaction as the write, because a count read before the write cannot see a concurrent one.
 */
export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly authRepository: AuthRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listUsers(ctx: AccessContext) {
    return (await this.repository.listUsers()).filter((user) => isScopeWithin(user.authorizationScope, ctx.scope))
  }
  async getUser(id: string, ctx: AccessContext) { return this.requireUser(id, ctx) }

  async createUser(input: CreateAdminUserInput, ctx: AccessContext): Promise<AdminUser> {
    const user = this.validateCreate(input)
    await this.assertIdentityAvailable(user.usernameNormalized, user.emailNormalized)
    const scope = await this.validateScope(input.role, input.authorizationScope, ctx)
    const passwordHash = await hashPassword(input.password)
    return this.withProvisioningError(() => this.repository.createLocalUser({ ...user, passwordHash, scope }))
  }

  async updateUser(id: string, input: UpdateAdminUserInput, ctx: AccessContext): Promise<AdminUser> {
    const actingUserId = ctx.userId
    const existing = await this.requireUser(id, ctx)
    const next = { fullName: input.fullName?.trim() ?? existing.fullName, username: input.username?.trim() ?? existing.username, email: input.email?.trim() ?? existing.email, role: input.role ?? existing.role, active: input.active ?? existing.active, authorizationScope: input.authorizationScope ?? existing.authorizationScope }
    if (!next.fullName || !next.username || !next.email) throw new ApiError(400, "VALIDATION_ERROR", "Ad soyad, kullanıcı adı ve e-posta zorunludur.")
    if (existing.authenticationSource === "ACTIVE_DIRECTORY" && (input.fullName !== undefined || input.username !== undefined || input.email !== undefined)) throw new ApiError(409, "IDENTITY_MANAGED_EXTERNALLY", "Active Directory kullanıcılarının kimlik alanları düzenlenemez.")
    if (id === actingUserId && existing.active && !next.active) throw new ApiError(409, "SELF_DEACTIVATION", "Kendi hesabınızı pasif hale getiremezsiniz.")
    if (id === actingUserId && existing.role === "ADMIN" && next.role !== "ADMIN") throw new ApiError(409, "SELF_ADMIN_DEMOTION", "Kendi Admin rolünüzü kaldıramazsınız.")
    const usernameNormalized = normalizeIdentity(next.username)
    const emailNormalized = normalizeIdentity(next.email)
    await this.assertIdentityAvailable(usernameNormalized, emailNormalized, id)
    const scope = await this.validateScope(next.role, next.authorizationScope, ctx)
    const persisted: Partial<PersistedAdminUserInput> & { scope?: AuthorizationScope } = { role: next.role, active: next.active, scope }
    if (existing.authenticationSource === "LOCAL") Object.assign(persisted, { fullName: next.fullName, username: next.username, usernameNormalized, email: next.email, emailNormalized })
    try {
      return await this.withProvisioningError(() => this.repository.updateUser(id, persisted))
    } catch (error) {
      // Raised by the repository transaction that actually wrote the row, so a concurrent request
      // stripping the *other* Admin has already been accounted for by the time we get here.
      if (error instanceof LastActiveAdminError) throw new ApiError(409, "LAST_ACTIVE_ADMIN", "Sistemde en az bir aktif Admin bulunmalıdır.")
      throw error
    }
  }

  async resetLocalUserPassword(id: string, password: string, ctx: AccessContext): Promise<void> {
    const user = await this.requireUser(id, ctx)
    if (user.authenticationSource !== "LOCAL") throw new ApiError(409, "LOCAL_AUTH_REQUIRED", "Active Directory kullanıcıları için parola sıfırlama desteklenmiyor.")
    if (password.length < 8) throw new ApiError(400, "VALIDATION_ERROR", "Geçici parola en az sekiz karakter olmalıdır.")
    await this.authRepository.updatePasswordAndRevokeSessions({
      userId: id,
      passwordHash: await hashPassword(password),
      revokedAt: this.now(),
    })
  }

  private validateCreate(input: CreateAdminUserInput): Omit<PersistedAdminUserInput, "passwordHash"> {
    const fullName = input.fullName.trim(); const username = input.username.trim(); const email = input.email.trim()
    if (!fullName || !username || !email || input.password.length < 8) throw new ApiError(400, "VALIDATION_ERROR", "Ad soyad, kullanıcı adı, e-posta ve en az sekiz karakter parola zorunludur.")
    return { fullName, username, usernameNormalized: normalizeIdentity(username), email, emailNormalized: normalizeIdentity(email), role: input.role, active: input.active }
  }

  private async assertIdentityAvailable(usernameNormalized: string, emailNormalized: string, excludeId?: string) {
    const [username, email] = await Promise.all([this.repository.findUserByUsernameNormalized(usernameNormalized), this.repository.findUserByEmailNormalized(emailNormalized)])
    if (username && username.id !== excludeId) throw new ApiError(409, "USERNAME_TAKEN", "Bu kullanıcı adı zaten kullanılıyor.")
    if (email && email.id !== excludeId) throw new ApiError(409, "EMAIL_TAKEN", "Bu e-posta adresi zaten kullanılıyor.")
  }

  private async validateScope(role: AdminUser["role"], scope: AuthorizationScope, ctx: AccessContext): Promise<AuthorizationScope> {
    const normalized = normalizedScope(scope)
    if (normalized.companyIds.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "En az bir şirket kapsamı seçilmelidir.")
    // Existence alone is not authority: the scope being written must also sit inside the acting
    // Admin's own, so it can never reach a company/facility/gate they do not themselves hold.
    if (!isScopeWithin(normalized, ctx.scope)) throw outOfScopeError()
    const found = await this.repository.findScopeReferences(normalized)
    if (found.companyIds.length !== normalized.companyIds.length || found.facilities.length !== normalized.facilityIds.length || found.gates.length !== normalized.securityGateIds.length) throw new ApiError(400, "INVALID_SCOPE", "Kapsamda bilinmeyen organizasyon kaydı bulunuyor.")
    if (found.facilities.some((facility) => !normalized.companyIds.includes(facility.companyId)) || found.gates.some((gate) => !normalized.companyIds.includes(gate.companyId))) throw new ApiError(400, "INVALID_SCOPE", "Tesis ve güvenlik kapısı kapsamı seçili şirket kapsamıyla uyumlu olmalıdır.")
    if (roleRequiresEmployeeProfile(role) && normalized.facilityIds.length !== 1) throw this.employeeFacilityScopeError()
    return normalized
  }

  private employeeFacilityScopeError() {
    return new ApiError(400, "EMPLOYEE_FACILITY_SCOPE_REQUIRED", "Çalışan profili gerektiren roller için tam olarak bir tesis kapsamı seçilmelidir.")
  }

  private async withProvisioningError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof EmployeeProvisioningScopeError) throw this.employeeFacilityScopeError()
      throw error
    }
  }

  /** An account outside the acting Admin's authority is reported as absent, never as forbidden. */
  private async requireUser(id: string, ctx: AccessContext) {
    const user = await this.repository.findUser(id)
    if (!user || !isScopeWithin(user.authorizationScope, ctx.scope)) throw new ApiError(404, "NOT_FOUND", "Kullanıcı bulunamadı.")
    return user
  }
}
