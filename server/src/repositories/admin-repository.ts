import type { AdminUser, AuthorizationScope } from "../modules/admin/types.js"

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
  countActiveAdmins(excludeUserId?: string): Promise<number>
  createLocalUser(input: PersistedAdminUserInput & { scope: AuthorizationScope }): Promise<AdminUser>
  updateUser(id: string, input: Partial<PersistedAdminUserInput> & { scope?: AuthorizationScope }): Promise<AdminUser>
  findScopeReferences(scope: AuthorizationScope): Promise<{ companyIds: string[]; facilities: { id: string; companyId: string }[]; gates: { id: string; facilityId: string; companyId: string }[] }>
}
