import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { demoLoginAccounts, isDemoLoginEnabled } from "@/config/demo-login"

const seedSource = readFileSync(resolve(process.cwd(), "server/prisma/seed-data.ts"), "utf8")

describe("isDemoLoginEnabled", () => {
  it("is disabled when the flag is unset or empty", () => {
    expect(isDemoLoginEnabled(undefined)).toBe(false)
    expect(isDemoLoginEnabled(null)).toBe(false)
    expect(isDemoLoginEnabled("")).toBe(false)
  })

  it("is enabled only for the exact string true", () => {
    expect(isDemoLoginEnabled("true")).toBe(true)
    expect(isDemoLoginEnabled(" true ")).toBe(true)
    expect(isDemoLoginEnabled("false")).toBe(false)
    expect(isDemoLoginEnabled("1")).toBe(false)
    expect(isDemoLoginEnabled("TRUE")).toBe(false)
  })
})

describe("demo login accounts", () => {
  it("covers the four basic roles in a stable order", () => {
    expect(demoLoginAccounts.map((account) => account.label)).toEqual(["Admin", "Yönetici", "Çalışan", "Güvenlik"])
  })

  // The credentials must stay in step with the development-only seed that provisions them;
  // there is no build-time import path from the frontend into the backend workspace.
  it.each(demoLoginAccounts.map((account) => [account.label, account.username, account.password] as const))(
    "matches the development seed definition for %s",
    (_label, username, password) => {
      expect(seedSource).toContain(`username: "${username}", password: "${password}"`)
    },
  )
})
