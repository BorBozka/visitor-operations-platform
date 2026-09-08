import { describe, expect, it } from "vitest"

import type { FacilityResource } from "@/domain/resources"
import { getSessionKey } from "@/features/auth/session-identity"
import { canLoadResources, createResourceLoader, INITIAL_RESOURCE_STATE, type ResourceReadService, type ResourceState } from "@/features/resources/resource-loader"
import type { SessionUser } from "@/services/session-service"

function sessionUser(id: string, role: SessionUser["role"]): SessionUser {
  return { id, username: id, fullName: id, initials: "XX", role, roleLabel: role, authenticationSource: "LOCAL" }
}

function room(id: string): FacilityResource {
  return {
    id,
    type: "ROOM",
    name: id,
    companyId: "c-1",
    companyName: "BPLAS",
    facilityId: "f-1",
    facilityName: "Fabrika",
    isActive: true,
    createdAt: "2026-01-01T08:00:00+03:00",
    updatedAt: "2026-01-01T08:00:00+03:00",
  }
}

/** Records every `/api/resources` read and can hold responses open to force a late arrival. */
function createReadStub() {
  const pending: Array<() => void> = []
  let payload: FacilityResource[] = [room("a-room")]
  let hold = false
  let calls = 0

  const service: ResourceReadService = {
    listResources: () => {
      calls += 1
      const value = payload
      if (!hold) return Promise.resolve(value)
      return new Promise<FacilityResource[]>((resolve) => pending.push(() => resolve(value)))
    },
  }

  return {
    service,
    get calls() {
      return calls
    },
    resetCalls() {
      calls = 0
    },
    setPayload(next: FacilityResource[]) {
      payload = next
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

/** Drives the loader the way the ResourceProvider effect does. */
function mountProvider(service: ResourceReadService) {
  let state: ResourceState = INITIAL_RESOURCE_STATE
  const loader = createResourceLoader(service, (patch) => {
    state = { ...state, ...patch }
  })
  let key: string | null | undefined
  return {
    get state() {
      return state
    },
    loader,
    signIn(user: SessionUser | null): Promise<void> {
      const nextKey = getSessionKey(user)
      if (nextKey === key) return Promise.resolve()
      key = nextKey
      return loader.applySession(canLoadResources(user))
    },
  }
}

describe("canLoadResources", () => {
  it("mirrors the backend guard on /api/resources", () => {
    expect(canLoadResources(sessionUser("a", "ADMIN"))).toBe(true)
    expect(canLoadResources(sessionUser("m", "MANAGER"))).toBe(true)
    expect(canLoadResources(sessionUser("e", "EMPLOYEE"))).toBe(false)
    expect(canLoadResources(sessionUser("s", "SECURITY"))).toBe(false)
    expect(canLoadResources(null)).toBe(false)
  })
})

describe("ResourceProvider load lifecycle", () => {
  it("issues no request on a signed-out cold mount and stops loading", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    await provider.signIn(null)

    expect(stub.calls).toBe(0)
    expect(provider.state).toEqual({ resources: [], isLoading: false, error: null })
  })

  it("loads for Admin and Manager sessions", async () => {
    for (const role of ["ADMIN", "MANAGER"] as const) {
      const stub = createReadStub()
      const provider = mountProvider(stub.service)

      await provider.signIn(sessionUser(`${role}-1`, role))

      expect(stub.calls).toBe(1)
      expect(provider.state.resources).toHaveLength(1)
      expect(provider.state.isLoading).toBe(false)
    }
  })

  it("issues no request for Employee and Security sessions", async () => {
    for (const role of ["EMPLOYEE", "SECURITY"] as const) {
      const stub = createReadStub()
      const provider = mountProvider(stub.service)

      await provider.signIn(sessionUser(`${role}-1`, role))

      expect(stub.calls).toBe(0)
      expect(provider.state).toEqual({ resources: [], isLoading: false, error: null })
    }
  })

  it("clears the previous account resources on logout", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    await provider.signIn(sessionUser("manager-a", "MANAGER"))
    expect(provider.state.resources).toHaveLength(1)

    await provider.signIn(null)

    expect(provider.state).toEqual({ resources: [], isLoading: false, error: null })
  })

  it("drops account A resources on switch to B and reloads for B", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    await provider.signIn(sessionUser("manager-a", "MANAGER"))
    stub.resetCalls()
    stub.setPayload([room("b-room")])

    const switched = provider.signIn(sessionUser("manager-b", "MANAGER"))
    expect(provider.state.resources).toEqual([])
    await switched

    expect(stub.calls).toBe(1)
    expect(provider.state.resources).toEqual([room("b-room")])
  })

  it("drops account A late response instead of overwriting account B state", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    stub.setPayload([room("a-room")])
    stub.holdResponses()
    const staleLoad = provider.signIn(sessionUser("manager-a", "MANAGER"))

    // B signs in and finishes loading while A request is still parked.
    stub.setPayload([room("b-room")])
    stub.answerImmediately()
    await provider.signIn(sessionUser("manager-b", "MANAGER"))
    expect(provider.state.resources).toEqual([room("b-room")])

    // Only now does A request come back.
    stub.releaseHeldResponses()
    await staleLoad

    expect(provider.state.resources).toEqual([room("b-room")])
  })

  it("drops a post-write refresh that finishes after the session changed", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    await provider.signIn(sessionUser("manager-a", "MANAGER"))

    stub.holdResponses()
    const followUp = provider.loader.refresh()

    await provider.signIn(null)
    stub.releaseHeldResponses()
    await followUp

    expect(provider.state.resources).toEqual([])
  })

  it("surfaces a load failure as an error instead of rejecting into the effect", async () => {
    let state: ResourceState = INITIAL_RESOURCE_STATE
    const loader = createResourceLoader({ listResources: () => Promise.reject(new Error("Kaynaklar yüklenemedi.")) }, (patch) => {
      state = { ...state, ...patch }
    })

    await expect(loader.applySession(true)).resolves.toBeUndefined()

    expect(state).toEqual({ resources: [], isLoading: false, error: "Kaynaklar yüklenemedi." })
  })
})
