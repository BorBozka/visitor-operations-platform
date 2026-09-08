import type { PrismaClient } from "@prisma/client"
import { describe, expect, it } from "vitest"

import type { PersistedAdminUserInput } from "./admin-repository.js"
import { PrismaAdminRepository } from "./prisma-admin-repository.js"
import type { AuthorizationScope } from "../modules/admin/types.js"

const at = new Date("2026-01-01T00:00:00.000Z")

interface StoredUser extends PersistedAdminUserInput {
  id: string
  authenticationSource: string
  companyIds: string[]
  facilityIds: string[]
  securityGateIds: string[]
  createdAt: Date
  updatedAt: Date
}

interface StoredEmployee {
  id: string
  userId: string
  fullName: string
  companyId: string
  active: boolean
  facilityIds: string[]
}

interface DatabaseState {
  users: StoredUser[]
  employees: StoredEmployee[]
  facilities: { id: string; companyId: string }[]
}

interface UserCreateData extends Omit<PersistedAdminUserInput, "role"> {
  role: StoredUser["role"]
  authenticationSource: string
  companyScopes: { create: { companyId: string }[] }
  facilityScopes: { create: { facilityId: string }[] }
  securityGateScopes: { create: { securityGateId: string }[] }
}

type ScopeUpdate<T> = { deleteMany: object; create: T[] }
interface UserUpdateData extends Partial<PersistedAdminUserInput> {
  companyScopes?: ScopeUpdate<{ companyId: string }>
  facilityScopes?: ScopeUpdate<{ facilityId: string }>
  securityGateScopes?: ScopeUpdate<{ securityGateId: string }>
}

interface EmployeeWriteData {
  userId: string
  fullName: string
  companyId: string
  active: boolean
  facilityScopes: { create: { facilityId: string } }
}

interface EmployeeUpdateData {
  fullName?: string
  companyId?: string
  active?: boolean
  facilityScopes?: { deleteMany: object; create: { facilityId: string } }
}

function createTransactionalPrisma() {
  let state: DatabaseState = { users: [], employees: [], facilities: [{ id: "facility-1", companyId: "company-from-facility" }] }
  let failEmployeeCreation = false
  const transactionOptions: unknown[] = []

  const toUserRow = (user: StoredUser, database: DatabaseState) => ({
    ...user,
    companyScopes: user.companyIds.map((companyId) => ({ companyId })),
    facilityScopes: user.facilityIds.map((facilityId) => ({ facilityId })),
    securityGateScopes: user.securityGateIds.map((securityGateId) => ({ securityGateId })),
    employeeProfile: database.employees.find((employee) => employee.userId === user.id) ?? null,
  })

  const client = {
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>, options: unknown) => {
      transactionOptions.push(options)
      const draft = structuredClone(state)
      const transaction = {
        facility: {
          findUnique: async ({ where }: { where: { id: string } }) => draft.facilities.find((facility) => facility.id === where.id) ?? null,
        },
        user: {
          create: async ({ data }: { data: UserCreateData }) => {
            const user: StoredUser = {
              id: `user-${draft.users.length + 1}`,
              fullName: data.fullName,
              username: data.username,
              usernameNormalized: data.usernameNormalized,
              email: data.email,
              emailNormalized: data.emailNormalized,
              passwordHash: data.passwordHash,
              role: data.role,
              authenticationSource: data.authenticationSource,
              active: data.active,
              companyIds: data.companyScopes.create.map((scope) => scope.companyId),
              facilityIds: data.facilityScopes.create.map((scope) => scope.facilityId),
              securityGateIds: data.securityGateScopes.create.map((scope) => scope.securityGateId),
              createdAt: at,
              updatedAt: at,
            }
            draft.users.push(user)
            return toUserRow(user, draft)
          },
          update: async ({ where, data }: { where: { id: string }; data: UserUpdateData }) => {
            const user = draft.users.find((candidate) => candidate.id === where.id)
            if (!user) throw new Error("User not found")
            Object.assign(user, {
              ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
              ...(data.username !== undefined ? { username: data.username, usernameNormalized: data.usernameNormalized! } : {}),
              ...(data.email !== undefined ? { email: data.email, emailNormalized: data.emailNormalized! } : {}),
              ...(data.role !== undefined ? { role: data.role } : {}),
              ...(data.active !== undefined ? { active: data.active } : {}),
              ...(data.companyScopes ? { companyIds: data.companyScopes.create.map((scope) => scope.companyId) } : {}),
              ...(data.facilityScopes ? { facilityIds: data.facilityScopes.create.map((scope) => scope.facilityId) } : {}),
              ...(data.securityGateScopes ? { securityGateIds: data.securityGateScopes.create.map((scope) => scope.securityGateId) } : {}),
              updatedAt: at,
            })
            return toUserRow(user, draft)
          },
        },
        employee: {
          create: async ({ data }: { data: EmployeeWriteData }) => {
            if (failEmployeeCreation) throw new Error("Employee creation failed")
            const employee: StoredEmployee = { id: `employee-${draft.employees.length + 1}`, userId: data.userId, fullName: data.fullName, companyId: data.companyId, active: data.active, facilityIds: [data.facilityScopes.create.facilityId] }
            draft.employees.push(employee)
            return employee
          },
          update: async ({ where, data }: { where: { id: string }; data: EmployeeUpdateData }) => {
            const employee = draft.employees.find((candidate) => candidate.id === where.id)
            if (!employee) throw new Error("Employee not found")
            Object.assign(employee, {
              ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
              ...(data.companyId !== undefined ? { companyId: data.companyId } : {}),
              ...(data.active !== undefined ? { active: data.active } : {}),
              ...(data.facilityScopes ? { facilityIds: [data.facilityScopes.create.facilityId] } : {}),
            })
            return employee
          },
        },
      }

      const result = await operation(transaction)
      state = draft
      return result
    },
  }

  return {
    prisma: client as unknown as PrismaClient,
    state: () => structuredClone(state),
    failEmployeeCreation: () => { failEmployeeCreation = true },
    transactionOptions,
  }
}

const input = (role: PersistedAdminUserInput["role"], scope: AuthorizationScope): PersistedAdminUserInput & { scope: AuthorizationScope } => ({
  fullName: "Yeni Kullanıcı",
  username: "yeni",
  usernameNormalized: "yeni",
  email: "yeni@example.com",
  emailNormalized: "yeni@example.com",
  passwordHash: "hash",
  role,
  active: true,
  scope,
})

const operationalScope: AuthorizationScope = { companyIds: ["company-from-facility"], facilityIds: ["facility-1"], securityGateIds: [] }

describe("PrismaAdminRepository Employee provisioning", () => {
  it("creates User scopes, Employee and EmployeeFacilityScope in one Serializable transaction", async () => {
    const fake = createTransactionalPrisma()
    const user = await new PrismaAdminRepository(fake.prisma).createLocalUser(input("EMPLOYEE", operationalScope))

    expect(user.authorizationScope).toEqual(operationalScope)
    expect(fake.state().employees).toEqual([expect.objectContaining({ userId: user.id, fullName: user.fullName, companyId: "company-from-facility", facilityIds: ["facility-1"], active: true })])
    expect(fake.transactionOptions).toEqual([{ isolationLevel: "Serializable" }])
  })

  it("rolls the staged User and scopes back when Employee creation fails", async () => {
    const fake = createTransactionalPrisma()
    fake.failEmployeeCreation()
    const repository = new PrismaAdminRepository(fake.prisma)

    await expect(repository.createLocalUser(input("SECURITY", operationalScope))).rejects.toThrow("Employee creation failed")
    expect(fake.state().users).toEqual([])
    expect(fake.state().employees).toEqual([])
  })

  it("does not create an Employee profile for ADMIN", async () => {
    const fake = createTransactionalPrisma()
    await new PrismaAdminRepository(fake.prisma).createLocalUser(input("ADMIN", { ...operationalScope, facilityIds: [] }))
    expect(fake.state().employees).toEqual([])
  })

  it("preserves the Employee id across operational roles and ADMIN history", async () => {
    const fake = createTransactionalPrisma()
    const repository = new PrismaAdminRepository(fake.prisma)
    const user = await repository.createLocalUser(input("EMPLOYEE", operationalScope))
    const employeeId = fake.state().employees[0].id

    await repository.updateUser(user.id, { role: "MANAGER", fullName: "Güncel Ad", active: false, scope: operationalScope })
    expect(fake.state().employees[0]).toMatchObject({ id: employeeId, fullName: "Güncel Ad", active: false })

    await repository.updateUser(user.id, { role: "ADMIN", active: true, scope: operationalScope })
    expect(fake.state().employees[0]).toMatchObject({ id: employeeId, fullName: "Güncel Ad", active: false, facilityIds: ["facility-1"] })

    await repository.updateUser(user.id, { role: "SECURITY", scope: operationalScope })
    expect(fake.state().employees[0]).toMatchObject({ id: employeeId, active: true, facilityIds: ["facility-1"] })
  })
})
