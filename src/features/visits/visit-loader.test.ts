import { describe, expect, it } from "vitest"

import type { Meeting, VisitReferenceData } from "@/domain/visits"
import { getSessionKey } from "@/features/auth/session-identity"
import { createVisitLoader, INITIAL_VISIT_STATE, type VisitReadService, type VisitState } from "@/features/visits/visit-loader"
import type { SessionUser } from "@/services/session-service"

function sessionUser(id: string, role: SessionUser["role"]): SessionUser {
  return { id, username: id, fullName: id, initials: "XX", role, roleLabel: role, authenticationSource: "LOCAL" }
}

function meeting(id: string): Meeting {
  return {
    id,
    createdAt: "2026-01-01T08:00:00+03:00",
    updatedAt: "2026-01-01T08:00:00+03:00",
    creatorEmployeeId: "emp-1",
    visitTypeId: "vt-1",
    visitTypeName: "Toplantı",
    hostEmployeeId: "emp-1",
    hostEmployeeName: "Host",
    hostCompanyId: "c-1",
    hostCompanyName: "BPLAS",
    facilityId: "f-1",
    facilityName: "Fabrika",
    plannedStart: "2026-01-02T09:00:00+03:00",
    plannedEnd: "2026-01-02T10:00:00+03:00",
    hasAdditionalRequirements: false,
  }
}

function referenceData(employeeId: string): VisitReferenceData {
  return {
    companies: [],
    facilities: [],
    employees: [],
    visitTypes: [],
    currentEmployee: { employeeId, companyId: "c-1", facilityId: "f-1", role: "EMPLOYEE" },
  }
}

/** Records the visit reads and can hold responses open to force a late arrival. */
function createReadStub() {
  const calls: string[] = []
  const pending: Array<() => void> = []
  let label = "a"
  let hold = false

  const answer = <T,>(name: string, read: () => T): Promise<T> => {
    calls.push(name)
    const value = read()
    if (!hold) return Promise.resolve(value)
    return new Promise<T>((resolve) => pending.push(() => resolve(value)))
  }

  const service: VisitReadService = {
    listMeetings: () => answer("listMeetings", () => [meeting(`meeting-${label}`)]),
    listVisits: () => answer("listVisits", () => []),
    getReferenceData: () => answer("getReferenceData", () => referenceData(`emp-${label}`)),
  }

  return {
    service,
    calls,
    setPayload(next: string) {
      label = next
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

/** Drives the loader the way the VisitProvider effect does. */
function mountProvider(service: VisitReadService) {
  let state: VisitState = INITIAL_VISIT_STATE
  const loader = createVisitLoader(service, (patch) => {
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
      return loader.applySession(nextKey !== null)
    },
  }
}

describe("VisitProvider load lifecycle", () => {
  it("issues no request on a signed-out cold mount", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    await provider.signIn(null)

    expect(stub.calls).toEqual([])
    expect(provider.state).toEqual({ meetings: [], visits: [], referenceData: null, isLoading: false, error: null })
  })

  it("loads once a user signs in", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    await provider.signIn(null)
    expect(stub.calls).toEqual([])

    await provider.signIn(sessionUser("employee-1", "EMPLOYEE"))

    expect(stub.calls).toEqual(["listMeetings", "listVisits", "getReferenceData"])
    expect(provider.state.meetings).toEqual([meeting("meeting-a")])
    expect(provider.state.isLoading).toBe(false)
  })

  it("clears the previous account data on logout", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    await provider.signIn(sessionUser("employee-1", "EMPLOYEE"))
    expect(provider.state.meetings).toHaveLength(1)

    await provider.signIn(null)

    expect(provider.state).toEqual({ meetings: [], visits: [], referenceData: null, isLoading: false, error: null })
  })

  it("drops account A data on switch to B and reloads for B", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    await provider.signIn(sessionUser("employee-a", "EMPLOYEE"))
    stub.calls.length = 0
    stub.setPayload("b")

    const switched = provider.signIn(sessionUser("employee-b", "EMPLOYEE"))
    expect(provider.state.meetings).toEqual([])
    expect(provider.state.referenceData).toBeNull()
    await switched

    expect(stub.calls).toEqual(["listMeetings", "listVisits", "getReferenceData"])
    expect(provider.state.meetings).toEqual([meeting("meeting-b")])
    expect(provider.state.referenceData).toEqual(referenceData("emp-b"))
  })

  it("drops account A late response instead of overwriting account B state", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)

    stub.setPayload("a")
    stub.holdResponses()
    const staleLoad = provider.signIn(sessionUser("employee-a", "EMPLOYEE"))

    // B signs in and finishes loading while A request is still parked.
    stub.setPayload("b")
    stub.answerImmediately()
    await provider.signIn(sessionUser("employee-b", "EMPLOYEE"))
    expect(provider.state.referenceData).toEqual(referenceData("emp-b"))

    // Only now does A request come back.
    stub.releaseHeldResponses()
    await staleLoad

    expect(provider.state.meetings).toEqual([meeting("meeting-b")])
    expect(provider.state.referenceData).toEqual(referenceData("emp-b"))
  })

  it("drops a post-write refresh that finishes after the session changed", async () => {
    const stub = createReadStub()
    const provider = mountProvider(stub.service)
    await provider.signIn(sessionUser("employee-a", "EMPLOYEE"))

    stub.holdResponses()
    const followUp = provider.loader.refresh()

    await provider.signIn(null)
    stub.releaseHeldResponses()
    await followUp

    expect(provider.state.meetings).toEqual([])
  })

  it("still rejects a post-write refresh to its caller", async () => {
    const failing: VisitReadService = {
      listMeetings: () => Promise.reject(new Error("boom")),
      listVisits: () => Promise.resolve([]),
      getReferenceData: () => Promise.reject(new Error("boom")),
    }
    const loader = createVisitLoader(failing, () => {})

    await expect(loader.refresh()).rejects.toThrow("boom")
  })

  it("surfaces a load failure as an error instead of rejecting into the effect", async () => {
    let state: VisitState = INITIAL_VISIT_STATE
    const failing: VisitReadService = {
      listMeetings: () => Promise.reject(new Error("Ziyaretler yüklenemedi.")),
      listVisits: () => Promise.resolve([]),
      getReferenceData: () => Promise.resolve(referenceData("emp-a")),
    }
    const loader = createVisitLoader(failing, (patch) => {
      state = { ...state, ...patch }
    })

    await expect(loader.applySession(true)).resolves.toBeUndefined()

    expect(state.error).toBe("Ziyaretler yüklenemedi.")
    expect(state.isLoading).toBe(false)
    expect(state.meetings).toEqual([])
  })
})
