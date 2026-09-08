import { describe, expect, it } from "vitest"

import { getSessionKey } from "@/features/auth/session-identity"
import type { SessionUser } from "@/services/session-service"

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u-1",
    username: "ayse",
    fullName: "Ayşe Yılmaz",
    initials: "AY",
    role: "MANAGER",
    roleLabel: "Yönetici",
    authenticationSource: "LOCAL",
    ...overrides,
  }
}

describe("getSessionKey", () => {
  it("is null while signed out", () => {
    expect(getSessionKey(null)).toBeNull()
  })

  it("is stable for the same identity across new session objects", () => {
    expect(getSessionKey(user())).toBe(getSessionKey(user({ fullName: "Ayşe Y." })))
  })

  it("changes when the account switches", () => {
    expect(getSessionKey(user({ id: "u-2" }))).not.toBe(getSessionKey(user()))
  })

  it("changes when the same account's role changes", () => {
    expect(getSessionKey(user({ role: "ADMIN" }))).not.toBe(getSessionKey(user()))
  })
})
