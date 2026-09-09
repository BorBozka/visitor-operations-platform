import type { AdminUser, AuthorizationScope } from "../modules/admin/types.js"

/**
 * The system-wide "at least one active ADMIN must remain" invariant was about to be broken by a
 * user write. Raised from inside the repository transaction that decided it, so the decision
 * always rests on persisted state rather than on a snapshot read before the write.
 */
export class LastActiveAdminError extends Error {
  constructor() {
    super("At least one active ADMIN user must remain.")
    this.name = "LastActiveAdminError"
  }
}

export class EmployeeProvisioningScopeError extends Error {
  constructor() {
    super("Employee provisioning requires one facility whose company is inside the user scope.")
    this.name = "EmployeeProvisioningScopeError"
  }
}

export interface PersistedAdminUserInput {
  fullName: string
  username: string
  usernameNormalized: string
  email: string
  emailNormalized: string
  passwordHash: string | null
  role: AdminUser["role"]
  active: boolean
}

export interface AdminRepository {
  listUsers(): Promise<AdminUser[]>
  findUser(id: string): Promise<AdminUser | null>
  findUserByUsernameNormalized(value: string): Promise<AdminUser | null>
  findUserByEmailNormalized(value: string): Promise<AdminUser | null>
  createLocalUser(input: PersistedAdminUserInput & { scope: AuthorizationScope }): Promise<AdminUser>
  /** Atomic: rejects with {@link LastActiveAdminError} when the write would leave no active ADMIN. */
  updateUser(id: string, input: Partial<PersistedAdminUserInput> & { scope?: AuthorizationScope }): Promise<AdminUser>
  findScopeReferences(scope: AuthorizationScope): Promise<{ companyIds: string[]; facilities: { id: string; companyId: string }[]; gates: { id: string; facilityId: string; companyId: string }[] }>
}
