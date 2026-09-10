import { readFileSync } from "node:fs"

import type { PrismaClient } from "@prisma/client"
import { describe, expect, it } from "vitest"

import { verifyPassword } from "../auth/password.js"
import { decideBootstrap, readBootstrapInput, BootstrapInputError, type BootstrapDatabaseState, type BootstrapEnvironment } from "../../prisma/bootstrap-contract.js"
import { BootstrapStateError, runProductionBootstrap } from "../../prisma/bootstrap-runner.js"
import { demoSeedUsers } from "../../prisma/seed-data.js"

const validEnvironment: BootstrapEnvironment = {
  BOOTSTRAP_ENABLED: "true",
  BOOTSTRAP_COMPANY_NAME: "Örnek Şirket A.Ş.",
  BOOTSTRAP_FACILITY_NAME: "Merkez Tesis",
  BOOTSTRAP_ADMIN_USERNAME: "Kurulum.Admin",
  BOOTSTRAP_ADMIN_FULL_NAME: "Kurulum Yöneticisi",
  BOOTSTRAP_ADMIN_EMAIL: "Kurulum.Admin@example.test",
  BOOTSTRAP_ADMIN_PASSWORD: "sekiz-karakterden-uzun",
}

const input = readBootstrapInput(validEnvironment)

const emptyState: BootstrapDatabaseState = { userCount: 0, companies: [], adminUsers: [] }
const bootstrappedState: BootstrapDatabaseState = {
  userCount: 1,
  companies: [{ id: "company-1", nameNormalized: input.company.nameNormalized, facilities: [{ id: "facility-1", nameNormalized: input.facility.nameNormalized }] }],
  adminUsers: [{ id: "user-1", usernameNormalized: input.admin.usernameNormalized, active: true, authenticationSource: "LOCAL", companyScopeIds: ["company-1"] }],
}

describe("production bootstrap input contract", () => {
  it("fails closed when the explicit acknowledgement or any required value is missing", () => {
    expect(() => readBootstrapInput({})).toThrow(BootstrapInputError)
    expect(() => readBootstrapInput({ ...validEnvironment, BOOTSTRAP_ENABLED: undefined })).toThrow("BOOTSTRAP_ENABLED=true")
    expect(() => readBootstrapInput({ ...validEnvironment, BOOTSTRAP_ENABLED: "false" })).toThrow("BOOTSTRAP_ENABLED=true")
    for (const key of ["BOOTSTRAP_COMPANY_NAME", "BOOTSTRAP_FACILITY_NAME", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_FULL_NAME", "BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PASSWORD"] as const) {
      expect(() => readBootstrapInput({ ...validEnvironment, [key]: undefined })).toThrow(key)
      expect(() => readBootstrapInput({ ...validEnvironment, [key]: "   " })).toThrow(key)
    }
  })

  it("rejects a password below the local-account policy the application already enforces", () => {
    const weak = "kisa123"
    expect(() => readBootstrapInput({ ...validEnvironment, BOOTSTRAP_ADMIN_PASSWORD: weak })).toThrow("en az sekiz karakter")
    // The rejection must name the field, never the value.
    let message = ""
    try {
      readBootstrapInput({ ...validEnvironment, BOOTSTRAP_ADMIN_PASSWORD: weak })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("BOOTSTRAP_ADMIN_PASSWORD")
    expect(message).not.toContain(weak)
    expect(readBootstrapInput({ ...validEnvironment, BOOTSTRAP_ADMIN_PASSWORD: "sekizkrk" }).adminPassword).toBe("sekizkrk")
  })

  it("rejects a malformed admin e-mail and normalizes identities the way the application does", () => {
    expect(() => readBootstrapInput({ ...validEnvironment, BOOTSTRAP_ADMIN_EMAIL: "kurulum-admin" })).toThrow("e-posta")
    expect(input.admin.usernameNormalized).toBe("kurulum.admin")
    expect(input.admin.emailNormalized).toBe("kurulum.admin@example.test")
    expect(input.company.nameNormalized).toBe("örnek şirket a.ş.")
  })
})

describe("production bootstrap safe-state rules", () => {
  it("bootstraps only a database with no company and no user at all", () => {
    expect(decideBootstrap(emptyState, input)).toEqual({ kind: "CREATE" })
    expect(decideBootstrap({ ...emptyState, userCount: 1 }, input).kind).toBe("REFUSE")
  })

  it("reports an untouched already-bootstrapped database instead of writing again", () => {
    expect(decideBootstrap(bootstrappedState, input)).toEqual({ kind: "ALREADY_BOOTSTRAPPED", root: { companyId: "company-1", facilityId: "facility-1", adminUserId: "user-1" } })
    // Extra non-Admin accounts and extra facilities are the normal result of using the app.
    expect(decideBootstrap({
      ...bootstrappedState,
      userCount: 12,
      companies: [{ ...bootstrappedState.companies[0], facilities: [...bootstrappedState.companies[0].facilities, { id: "facility-2", nameNormalized: "ikinci tesis" }] }],
    }, input).kind).toBe("ALREADY_BOOTSTRAPPED")
  })

  it("refuses every ambiguous or partially provisioned database", () => {
    const refusals: BootstrapDatabaseState[] = [
      { ...bootstrappedState, companies: [...bootstrappedState.companies, { id: "company-2", nameNormalized: "başka şirket", facilities: [] }] },
      { ...bootstrappedState, adminUsers: [...bootstrappedState.adminUsers, { id: "user-2", usernameNormalized: "baska.admin", active: true, authenticationSource: "LOCAL", companyScopeIds: ["company-1"] }] },
      { ...bootstrappedState, adminUsers: [] },
      { ...bootstrappedState, companies: [{ ...bootstrappedState.companies[0], nameNormalized: "başka şirket" }] },
      { ...bootstrappedState, companies: [{ ...bootstrappedState.companies[0], facilities: [{ id: "facility-9", nameNormalized: "başka tesis" }] }] },
      { ...bootstrappedState, adminUsers: [{ ...bootstrappedState.adminUsers[0], usernameNormalized: "baska.admin" }] },
      { ...bootstrappedState, adminUsers: [{ ...bootstrappedState.adminUsers[0], active: false }] },
      { ...bootstrappedState, adminUsers: [{ ...bootstrappedState.adminUsers[0], authenticationSource: "ACTIVE_DIRECTORY" }] },
      { ...bootstrappedState, adminUsers: [{ ...bootstrappedState.adminUsers[0], companyScopeIds: [] }] },
      { ...emptyState, userCount: 3 },
    ]
    for (const state of refusals) expect(decideBootstrap(state, input).kind).toBe("REFUSE")
  })
})

interface StoredFacility { id: string; name: string; nameNormalized: string; active: boolean }
interface StoredCompany { id: string; name: string; nameNormalized: string; active: boolean; facilities: StoredFacility[] }
interface StoredUser { id: string; username: string; usernameNormalized: string; fullName: string; email: string; emailNormalized: string; passwordHash: string; role: string; authenticationSource: string; active: boolean; companyScopes: { companyId: string }[] }
interface UserCreateData extends Omit<StoredUser, "id" | "companyScopes"> { companyScopes: { create: { companyId: string }[] } }

/**
 * A Prisma double whose draft is committed only once the transaction callback resolves — the same
 * shape `prisma-admin-repository.test.ts` uses — so a rejected bootstrap is observably a no-op.
 * It exposes only the three models the bootstrap may touch; reaching for any other model (visit
 * types, visitor cards, rule versions, settings, employees, gates) throws.
 */
function createTransactionalPrisma(initial: { companies?: StoredCompany[]; users?: StoredUser[] } = {}) {
  let state = { companies: initial.companies ?? [], users: initial.users ?? [] }
  const transactionOptions: unknown[] = []
  let failFacilityCreation = false

  const client = {
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>, options: unknown) => {
      transactionOptions.push(options)
      const draft = structuredClone(state)
      const transaction = {
        user: {
          count: async () => draft.users.length,
          findMany: async ({ where }: { where?: { role?: string } }) => draft.users.filter((user) => !where?.role || user.role === where.role),
          create: async ({ data }: { data: UserCreateData }) => {
            const user: StoredUser = { ...data, id: `user-${draft.users.length + 1}`, companyScopes: data.companyScopes.create }
            draft.users.push(user)
            return user
          },
        },
        company: {
          findMany: async () => draft.companies,
          create: async ({ data }: { data: Omit<StoredCompany, "id" | "facilities"> }) => {
            const company: StoredCompany = { ...data, id: `company-${draft.companies.length + 1}`, facilities: [] }
            draft.companies.push(company)
            return company
          },
        },
        facility: {
          create: async ({ data }: { data: { companyId: string; name: string; nameNormalized: string; active: boolean } }) => {
            if (failFacilityCreation) throw new Error("Facility creation failed")
            const company = draft.companies.find((candidate) => candidate.id === data.companyId)
            if (!company) throw new Error("Company not found")
            const facility: StoredFacility = { id: `facility-${company.facilities.length + 1}`, name: data.name, nameNormalized: data.nameNormalized, active: data.active }
            company.facilities.push(facility)
            return { ...facility, companyId: company.id }
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
    transactionOptions,
    failFacilityCreation: () => { failFacilityCreation = true },
  }
}

describe("production bootstrap writes", () => {
  it("creates the company, facility and ADMIN in one Serializable transaction", async () => {
    const fake = createTransactionalPrisma()

    const outcome = await runProductionBootstrap(fake.prisma, input)

    expect(outcome.status).toBe("CREATED")
    expect(fake.transactionOptions).toEqual([{ isolationLevel: "Serializable" }])
    const persisted = fake.state()
    expect(persisted.companies).toEqual([expect.objectContaining({
      name: "Örnek Şirket A.Ş.",
      nameNormalized: "örnek şirket a.ş.",
      active: true,
      facilities: [expect.objectContaining({ name: "Merkez Tesis", nameNormalized: "merkez tesis", active: true })],
    })])
    expect(persisted.users).toEqual([expect.objectContaining({
      username: "Kurulum.Admin",
      usernameNormalized: "kurulum.admin",
      email: "Kurulum.Admin@example.test",
      emailNormalized: "kurulum.admin@example.test",
      fullName: "Kurulum Yöneticisi",
    })])
  })

  it("gives the first Admin an ordinary ADMIN role at the broadest company scope the model allows", async () => {
    const fake = createTransactionalPrisma()
    const outcome = await runProductionBootstrap(fake.prisma, input)

    const admin = fake.state().users[0]
    expect(admin).toMatchObject({ role: "ADMIN", authenticationSource: "LOCAL", active: true })
    // Company-level scope with no facility/gate assignment: unconstrained inside that company.
    expect(admin.companyScopes).toEqual([{ companyId: outcome.root.companyId }])
  })

  it("stores the password through the Argon2id path and never in plain text", async () => {
    const fake = createTransactionalPrisma()
    await runProductionBootstrap(fake.prisma, input)

    const { passwordHash } = fake.state().users[0]
    expect(passwordHash.startsWith("$argon2id$")).toBe(true)
    expect(await verifyPassword(passwordHash, input.adminPassword)).toBe(true)
    expect(JSON.stringify(fake.state())).not.toContain(input.adminPassword)
  })

  it("creates no demo account and no development reference data", async () => {
    const fake = createTransactionalPrisma()
    await runProductionBootstrap(fake.prisma, input)

    const persisted = fake.state()
    expect(persisted.users).toHaveLength(1)
    expect(persisted.companies).toHaveLength(1)
    expect(persisted.companies[0].facilities).toHaveLength(1)
    const usernames = persisted.users.map((user) => user.usernameNormalized)
    for (const demoUser of demoSeedUsers) expect(usernames).not.toContain(demoUser.username)
  })

  it("leaves the database untouched when any step of the root fails", async () => {
    const fake = createTransactionalPrisma()
    fake.failFacilityCreation()

    await expect(runProductionBootstrap(fake.prisma, input)).rejects.toThrow("Facility creation failed")
    expect(fake.state()).toEqual({ companies: [], users: [] })
  })

  it("is a safe no-op on a second run: no duplicate, no password rotation", async () => {
    const fake = createTransactionalPrisma()
    const first = await runProductionBootstrap(fake.prisma, input)
    const afterFirst = fake.state()

    const second = await runProductionBootstrap(fake.prisma, { ...input, adminPassword: "tamamen-baska-bir-parola" })

    expect(second).toEqual({ status: "ALREADY_BOOTSTRAPPED", root: first.root })
    expect(fake.state()).toEqual(afterFirst)
  })

  it("refuses to write into a database that already holds other organization data", async () => {
    const fake = createTransactionalPrisma({ companies: [{ id: "company-existing", name: "Mevcut", nameNormalized: "mevcut", active: true, facilities: [] }] })

    await expect(runProductionBootstrap(fake.prisma, input)).rejects.toThrow(BootstrapStateError)
    expect(fake.state().users).toEqual([])
    expect(fake.state().companies).toHaveLength(1)
  })
})

describe("production bootstrap isolation from the demo seed and the runtime", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

  it("keeps the development demo seed guard and its separation from the bootstrap", () => {
    const seed = read("../../prisma/seed.ts")
    expect(seed).toContain("shouldSeedDemoData(process.env)")
    expect(seed).not.toContain("bootstrap")
    expect(read("../../prisma/seed-data.ts")).toContain('environment.NODE_ENV === "development" && environment.DEMO_SEED_ENABLED === "true"')
  })

  it("is reachable only through its own command, never from server startup or the API", () => {
    expect(read("../server.ts")).not.toContain("bootstrap")
    expect(read("../app.ts")).not.toContain("bootstrap")
    const scripts = JSON.parse(read("../../package.json")).scripts
    expect(scripts["db:bootstrap"]).toBe("tsx prisma/bootstrap.ts")
    expect(scripts["db:seed"]).toBe("tsx prisma/seed.ts")
  })
})
