import { describe, expect, it } from "vitest"

import type { OperationalSettings, OrganizationSnapshot } from "@/domain/admin"
import { createAdminLoader, EMPTY_ADMIN_DATA, getAdminDataScope, type AdminData, type AdminReadService } from "@/features/admin/admin-loader"
import { getSessionKey } from "@/features/auth/session-identity"
import type { SessionUser } from "@/services/session-service"

function sessionUser(id: string, role: SessionUser["role"]): SessionUser {
  return { id, username: id, fullName: id, initials: "XX", role, roleLabel: role, authenticationSource: "LOCAL" }
}

const emptyOrganization: OrganizationSnapshot = { companies: [], facilities: [], departments: [], securityGates: [] }

function settings(minutes: number): OperationalSettings {
  return { overdueToleranceMinutes: minutes, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" }
}

/**
 * A read stub that records every call and can hold its responses open, so a response belonging to
 * a previous session can be made to land after the next session already started.
 */
function createReadStub() {
  const calls: string[] = []
  const pending: Array<() => void> = []
  let userLabel = "a"
  let tolerance = 15
  let hold = false

  const answer = <T,>(name: string, value: T): Promise<T> => {
    calls.push(name)
    if (!hold) return Promise.resolve(value)
    return new Promise<T>((resolve) => pending.push(() => resolve(value)))
  }

  const service: AdminReadService = {
    getUsers: () =>
      answer("getUsers", [
        {
          id: `user-${userLabel}`,
          fullName: userLabel,
          username: userLabel,
          email: `${userLabel}@example.test`,
          authenticationSource: "LOCAL" as const,
          role: "ADMIN" as const,
          authorizationScope: { companyIds: [], facilityIds: [], securityGateIds: [] },
          active: true,
        },
      ]),
    getOrganization: () => answer("getOrganization", emptyOrganization),
    getVisitTypes: () => answer("getVisitTypes", []),
    getVisitorCards: () => answer("getVisitorCards", []),
    getVisitorRuleVersions: () => answer("getVisitorRuleVersions", []),
    getOperationalSettings: () => answer("getOperationalSettings", settings(tolerance)),
  }

  return {
    service,
    calls,
    setPayload(nextUserLabel: string, nextTolerance: number) {
      userLabel = nextUserLabel
      tolerance = nextTolerance
    },
    /** Requests issued from now on are parked until released. */
    holdResponses() {
      hold = true
    },
    /** New requests answer immediately again; already-parked ones stay parked. */
    answerImmediately() {
      hold = false
    },
    /** Lets the parked requests finally resolve. */
    releaseHeldResponses() {
      hold = false
      for (const release of pending.splice(0)) release()
    },
  }
}

/** Drives the loader the way the AdminProvider effect does: re-run whenever the session changes. */
function mountProvider(service: AdminReadService) {
  let data: AdminData = EMPTY_ADMIN_DATA
  const loader = createAdminLoader(service, (next) => {
    data = next
  })
  let key: string | null | undefined
  return {
    get data() {
      return data
    },
    loader,
    signIn(user: SessionUser | null): Promise<void> {
      const nextKey = getSessionKey(user)
      if (nextKey === key) return Promise.resolve()
      key = nextKey
      return loader.applySession(getAdminDataScope(user))
    },
  }
}

const ADMIN_ONLY_CALLS = ["getUsers", "getVisitorCards", "getVisitorRuleVersions"]

describe("getAdminDataScope", () => {
  it("reads nothing while signed out", () => {
    expect(getAdminDataScope(null)).toBe("NONE")
  })

  it("reads the full Admin surface for an Admin", () => {
    expect(getAdminDataScope(sessionUser("a", "ADMIN"))).toBe("FULL")
  })

  it("reads only the authenticated operational settings for a Manager", () => {
    expect(getAdminDataScope(sessionUser("m", "MANAGER"))).toBe("SETTINGS_ONLY")
  })

  it("reads nothing for roles that consume no Admin data", () => {
    expect(getAdminDataScope(sessionUser("e", "EMPLOYEE"))).toBe("NONE")
    expect(getAdminDataScope(sessionUser("s", "SECURITY"))).toBe("NONE")
  })
})

describe("AdminProvider load lifecycle", () => {
  it("issues no request on a signed-out cold mount", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    await provider.signIn(null)

    expect(stub.calls).toEqual([])
    expect(provider.data).toEqual(EMPTY_ADMIN_DATA)
  })

  it("loads the Admin workspace once an Admin signs in", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    await provider.signIn(null)
    expect(stub.calls).toEqual([])

    await provider.signIn(sessionUser("admin-1", "ADMIN"))

    expect(stub.calls).toEqual(expect.arrayContaining(ADMIN_ONLY_CALLS))
    expect(provider.data.users).toHaveLength(1)
    expect(provider.data.settings).not.toBeNull()
  })

  it("loads only the operational settings for a Manager, never an Admin-only endpoint", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    await provider.signIn(sessionUser("manager-1", "MANAGER"))

    expect(stub.calls).toEqual(["getOperationalSettings"])
    expect(provider.data.settings).toEqual(settings(15))
    expect(provider.data.users).toEqual([])
  })

  it("issues no request for Employee and Security sessions", async () => {
    for (const role of ["EMPLOYEE", "SECURITY"] as const) {
      const stub = createReadStub()
      const provider = mountProvider(stub.service)

      await provider.signIn(sessionUser(`${role}-1`, role))

      expect(stub.calls).toEqual([])
      expect(provider.data).toEqual(EMPTY_ADMIN_DATA)
    }
  })

  it("clears the previous account's data on logout", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    await provider.signIn(sessionUser("admin-1", "ADMIN"))
    expect(provider.data.users).toHaveLength(1)

    await provider.signIn(null)

    expect(provider.data).toEqual(EMPTY_ADMIN_DATA)
  })

  it("does not show account A data to account B and reloads for B", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    stub.setPayload("a", 15)
    await provider.signIn(sessionUser("manager-a", "MANAGER"))
    expect(provider.data.settings).toEqual(settings(15))

    stub.setPayload("b", 45)
    stub.calls.length = 0
    const switched = provider.signIn(sessionUser("manager-b", "MANAGER"))
    // Cleared synchronously, before anything for B can arrive.
    expect(provider.data).toEqual(EMPTY_ADMIN_DATA)
    await switched

    expect(stub.calls).toEqual(["getOperationalSettings"])
    expect(provider.data.settings).toEqual(settings(45))
  })

  it("drops account A late response instead of overwriting account B state", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    stub.setPayload("a", 15)
    stub.holdResponses()
    const staleLoad = provider.signIn(sessionUser("manager-a", "MANAGER"))

    // B signs in and finishes loading while A request is still parked.
    stub.setPayload("b", 45)
    stub.answerImmediately()
    await provider.signIn(sessionUser("manager-b", "MANAGER"))
    expect(provider.data.settings).toEqual(settings(45))

    // Only now does A request come back.
    stub.releaseHeldResponses()
    await staleLoad

    expect(provider.data.settings).toEqual(settings(45))
  })

  it("never rejects into the effect when a load fails", async () => {
    const stub = createReadStub()
    const failing: AdminReadService = { ...stub.service, getOperationalSettings: () => Promise.reject(new Error("boom")) }
    let data: AdminData = EMPTY_ADMIN_DATA
    const loader = createAdminLoader(failing, (next) => {
      data = next
    })

    await expect(loader.applySession("SETTINGS_ONLY")).resolves.toBeUndefined()
    await expect(loader.refresh("SETTINGS_ONLY")).resolves.toBeUndefined()
    expect(data).toEqual(EMPTY_ADMIN_DATA)
  })

  it("drops a post-write refetch that finishes after the session changed", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    await provider.signIn(sessionUser("admin-1", "ADMIN"))

    stub.holdResponses()
    let applied = false
    const followUp = provider.loader.commitIfCurrent(
      () => stub.service.getVisitorCards(),
      () => {
        applied = true
      },
    )

    await provider.signIn(null)
    stub.releaseHeldResponses()
    await followUp

    expect(applied).toBe(false)
    expect(provider.data).toEqual(EMPTY_ADMIN_DATA)
  })
})
