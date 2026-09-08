import { EmployeeProvisioningScopeError, type AdminRepository, type PersistedAdminUserInput } from "../../../repositories/admin-repository.js"
import { roleRequiresEmployeeProfile, type AdminUser, type AuthorizationScope } from "../types.js"

const clone = <T>(value: T): T => structuredClone(value)

export interface InMemoryEmployeeProfile {
  id: string
  userId: string
  fullName: string
  companyId: string
  facilityIds: string[]
  active: boolean
}

export class InMemoryAdminRepository implements AdminRepository {
  private sequence = 0
  private employeeSequence = 0
  private users: AdminUser[]
  private employees: InMemoryEmployeeProfile[]
  private employeeCreationFailure: Error | null = null
  readonly passwordHashes = new Map<string, string | null>()
  constructor(
    users: AdminUser[] = [],
    private readonly references = { companyIds: [] as string[], facilities: [] as { id: string; companyId: string }[], gates: [] as { id: string; facilityId: string; companyId: string }[] },
    employees: InMemoryEmployeeProfile[] = [],
  ) {
    this.users = clone(users)
    this.employees = clone(employees)
    this.employeeSequence = employees.length
  }
  async listUsers() { return clone(this.users) }
  async findUser(id: string) { const user = this.users.find((candidate) => candidate.id === id); return user ? clone(user) : null }
  async findEmployeeProfileByUserId(userId: string) { const employee = this.employees.find((candidate) => candidate.userId === userId); return employee ? clone(employee) : null }
  async findUserByUsernameNormalized(value: string) { const user = this.users.find((candidate) => candidate.username.trim().toLowerCase() === value); return user ? clone(user) : null }
  async findUserByEmailNormalized(value: string) { const user = this.users.find((candidate) => candidate.email.trim().toLowerCase() === value); return user ? clone(user) : null }
  async countActiveAdmins(excludeUserId?: string) { return this.users.filter((user) => user.id !== excludeUserId && user.active && user.role === "ADMIN").length }
  async createLocalUser(input: PersistedAdminUserInput & { scope: AuthorizationScope }) {
    const now = new Date("2026-01-01T00:00:00.000Z").toISOString()
    const user: AdminUser = { id: `user-${this.sequence + 1}`, fullName: input.fullName, username: input.username, email: input.email, authenticationSource: "LOCAL", role: input.role, authorizationScope: clone(input.scope), active: input.active, createdAt: now, updatedAt: now }
    const employee = this.synchronizedEmployee(user, null)
    this.sequence += 1
    this.users.push(user)
    if (employee) { this.employeeSequence += 1; this.employees.push(employee) }
    this.passwordHashes.set(user.id, input.passwordHash)
    return clone(user)
  }
  async updateUser(id: string, input: Partial<PersistedAdminUserInput> & { scope?: AuthorizationScope }) {
    const current = this.users.find((user) => user.id === id)
    if (!current) throw new Error("User not found")
    const next: AdminUser = { ...current, ...(input.fullName !== undefined ? { fullName: input.fullName } : {}), ...(input.username !== undefined ? { username: input.username } : {}), ...(input.email !== undefined ? { email: input.email } : {}), ...(input.role !== undefined ? { role: input.role } : {}), ...(input.active !== undefined ? { active: input.active } : {}), ...(input.scope ? { authorizationScope: clone(input.scope) } : {}), updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString() }
    const currentEmployee = this.employees.find((employee) => employee.userId === id) ?? null
    const nextEmployee = this.synchronizedEmployee(next, currentEmployee)
    this.users = this.users.map((user) => user.id === id ? next : user)
    if (currentEmployee && nextEmployee) this.employees = this.employees.map((employee) => employee.id === currentEmployee.id ? nextEmployee : employee)
    else if (nextEmployee) { this.employeeSequence += 1; this.employees.push(nextEmployee) }
    return clone(next)
  }
  async findScopeReferences(scope: AuthorizationScope) { return { companyIds: this.references.companyIds.filter((id) => scope.companyIds.includes(id)), facilities: this.references.facilities.filter((item) => scope.facilityIds.includes(item.id)), gates: this.references.gates.filter((item) => scope.securityGateIds.includes(item.id)) } }
  failNextEmployeeCreation(error = new Error("Employee creation failed")) { this.employeeCreationFailure = error }

  private synchronizedEmployee(user: AdminUser, current: InMemoryEmployeeProfile | null): InMemoryEmployeeProfile | null {
    if (!roleRequiresEmployeeProfile(user.role)) return current ? { ...current, fullName: user.fullName, active: false } : null
    const facilityId = user.authorizationScope.facilityIds.length === 1 ? user.authorizationScope.facilityIds[0] : null
    const facility = facilityId ? this.references.facilities.find((candidate) => candidate.id === facilityId) : null
    if (!facility || !user.authorizationScope.companyIds.includes(facility.companyId)) throw new EmployeeProvisioningScopeError()
    if (!current && this.employeeCreationFailure) { const error = this.employeeCreationFailure; this.employeeCreationFailure = null; throw error }
    return { id: current?.id ?? `employee-${this.employeeSequence + 1}`, userId: user.id, fullName: user.fullName, companyId: facility.companyId, facilityIds: [facility.id], active: user.active }
  }
}
