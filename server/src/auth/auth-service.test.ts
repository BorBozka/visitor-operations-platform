import { describe, expect, it } from "vitest"

import { ApiError } from "../lib/api-error.js"
import { hashPassword, verifyPassword } from "./password.js"
import { AuthService } from "./auth-service.js"
import { hashSessionToken } from "./session-token.js"
import type { AuthUserRecord } from "./auth-types.js"
import { InMemoryAuthRepository } from "./testing/in-memory-auth-repository.js"

async function createUser(overrides: Partial<AuthUserRecord> = {}): Promise<AuthUserRecord> {
  return {
    id: "user-1",
    username: "calisan",
    fullName: "Maya Kara",
    role: "EMPLOYEE",
    authenticationSource: "LOCAL",
    active: true,
    passwordHash: await hashPassword("calisan"),
    authorizationScope: { companyIds: ["bplas"], facilityIds: [], securityGateIds: [] },
    employeeId: "maya-kara",
    ...overrides,
  }
}

function createService(repository: InMemoryAuthRepository, now: () => Date, tokens = ["raw-session-token"]) {
  let tokenIndex = 0
  return new AuthService(repository, { sessionTtlHours: 8, now, createToken: () => tokens[tokenIndex++] ?? `raw-session-token-${tokenIndex}` })
}

describe("password hashing", () => {
  it("hashes with Argon2id and verifies only the matching password", async () => {
    const passwordHash = await hashPassword("longenough1")
    expect(passwordHash).not.toContain("longenough1")
    await expect(verifyPassword(passwordHash, "longenough1")).resolves.toBe(true)
    await expect(verifyPassword(passwordHash, "different1")).resolves.toBe(false)
  })
})

describe("AuthService", () => {
  it("creates a valid LOCAL login session and stores only its hash", async () => {
    const repository = new InMemoryAuthRepository([await createUser()])
    const now = new Date("2026-09-01T09:00:00.000Z")
    const result = await createService(repository, () => now).login("  CALISAN ", "calisan")

    expect(result.user).toMatchObject({ username: "calisan", initials: "MK", role: "EMPLOYEE", authenticationSource: "LOCAL" })
    expect(result.rawSessionToken).toBe("raw-session-token")
    expect([...repository.sessions.values()]).toEqual([expect.objectContaining({ tokenHash: hashSessionToken("raw-session-token") })])
    expect([...repository.sessions.values()][0].tokenHash).not.toBe(result.rawSessionToken)
  })

  it("returns the same generic failure for unknown and wrong credentials", async () => {
    const repository = new InMemoryAuthRepository([await createUser()])
    const service = createService(repository, () => new Date("2026-09-01T09:00:00.000Z"))

    const failures = await Promise.allSettled([service.login("missing", "calisan"), service.login("calisan", "wrong")])
    const errors = failures.map((result) => result.status === "rejected" ? result.reason : null)
    expect(errors).toEqual(errors.map(() => expect.objectContaining({ statusCode: 401, code: "INVALID_CREDENTIALS", message: "Kullanıcı adı veya şifre hatalı." })))
  })

  it("does not authenticate an inactive account", async () => {
    const repository = new InMemoryAuthRepository([await createUser({ active: false })])
    await expect(createService(repository, () => new Date()).login("calisan", "calisan")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" })
  })

  it("rejects an expired session and revokes a logged-out session", async () => {
    const repository = new InMemoryAuthRepository([await createUser()])
    let now = new Date("2026-09-01T09:00:00.000Z")
    const service = createService(repository, () => now)
    await service.login("calisan", "calisan")

    now = new Date("2026-09-01T18:00:01.000Z")
    await expect(service.getCurrentSession("raw-session-token")).resolves.toBeNull()

    now = new Date("2026-09-01T09:30:00.000Z")
    const second = await service.login("calisan", "calisan")
    await service.logout(second.rawSessionToken)
    await expect(service.getCurrentSession(second.rawSessionToken)).resolves.toBeNull()
    expect([...repository.sessions.values()].some((session) => session.revokedAt !== null)).toBe(true)
  })

  it("keeps the current session, revokes the user's other sessions, and replaces the login password", async () => {
    const repository = new InMemoryAuthRepository([await createUser()])
    const service = createService(repository, () => new Date(), ["session-a", "session-b", "session-new"])
    const sessionA = await service.login("calisan", "calisan")
    const sessionB = await service.login("calisan", "calisan")

    await service.changePassword("user-1", "calisan", "yeni-parola", sessionA.rawSessionToken)

    await expect(service.getCurrentSession(sessionA.rawSessionToken)).resolves.toMatchObject({ id: "user-1" })
    await expect(service.getCurrentSession(sessionB.rawSessionToken)).resolves.toBeNull()
    await expect(service.login("calisan", "calisan")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" })
    await expect(service.login("calisan", "yeni-parola")).resolves.toMatchObject({ user: { id: "user-1" } })
  })

  it("leaves the password and every session unchanged when the current password is wrong", async () => {
    const repository = new InMemoryAuthRepository([await createUser()])
    const service = createService(repository, () => new Date(), ["session-a", "session-b"])
    const sessionA = await service.login("calisan", "calisan")
    const sessionB = await service.login("calisan", "calisan")
    const originalHash = repository.users.get("user-1")!.passwordHash

    await expect(service.changePassword("user-1", "wrong", "yeni-parola", sessionA.rawSessionToken)).rejects.toThrow("CURRENT_PASSWORD_INVALID")
    expect(repository.users.get("user-1")!.passwordHash).toBe(originalHash)
    await expect(service.getCurrentSession(sessionA.rawSessionToken)).resolves.toMatchObject({ id: "user-1" })
    await expect(service.getCurrentSession(sessionB.rawSessionToken)).resolves.toMatchObject({ id: "user-1" })
    await expect(service.changePassword("user-1", "calisan", "calisan", sessionA.rawSessionToken)).rejects.toBeInstanceOf(ApiError)
  })

  it.each([
    { stage: "password update", fail: (repository: InMemoryAuthRepository) => repository.failNextPasswordUpdate() },
    { stage: "session revoke", fail: (repository: InMemoryAuthRepository) => repository.failNextSessionRevoke() },
  ])("leaves no partial security state when $stage fails", async ({ fail }) => {
    const repository = new InMemoryAuthRepository([await createUser()])
    const service = createService(repository, () => new Date(), ["session-a", "session-b"])
    const sessionA = await service.login("calisan", "calisan")
    const sessionB = await service.login("calisan", "calisan")
    fail(repository)

    await expect(service.changePassword("user-1", "calisan", "yeni-parola", sessionA.rawSessionToken)).rejects.toThrow()

    await expect(verifyPassword(repository.users.get("user-1")!.passwordHash!, "calisan")).resolves.toBe(true)
    await expect(verifyPassword(repository.users.get("user-1")!.passwordHash!, "yeni-parola")).resolves.toBe(false)
    await expect(service.getCurrentSession(sessionA.rawSessionToken)).resolves.toMatchObject({ id: "user-1" })
    await expect(service.getCurrentSession(sessionB.rawSessionToken)).resolves.toMatchObject({ id: "user-1" })
  })
})
