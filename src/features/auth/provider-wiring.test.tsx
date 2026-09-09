// @vitest-environment happy-dom
//
// The rest of the suite runs without a DOM (see CLAUDE.md): plain functions are tested directly and
// JSX facts are asserted against source text. These provider tests are the exception — the thing
// under test *is* the React wiring (effect dependencies, clear-on-session-change, no eager fetch),
// which only exists once the components actually mount. They render the real providers with
// `react-dom/client` and drive them through the real `AuthProvider` and a fake `SessionService`;
// no rendering library is involved, and the DOM environment is scoped to this file.
import { act, StrictMode, useEffect, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it } from "vitest"

import type { AdminUser, OperationalSettings, OrganizationSnapshot } from "@/domain/admin"
import type { FacilityResource } from "@/domain/resources"
import type { Meeting, VisitReferenceData } from "@/domain/visits"
import { AdminProvider, useAdmin } from "@/features/admin/admin-context"
import { AuthProvider, useAuth } from "@/features/auth/auth-context"
import { ResourceProvider, useResources } from "@/features/resources/resource-context"
import { VisitProvider, useVisits } from "@/features/visits/visit-context"
import type { AdminService } from "@/services/admin-service"
import type { ResourceCatalogService } from "@/services/resource-catalog-service"
import type { SessionService, SessionUser } from "@/services/session-service"
import type { VisitService } from "@/services/visit-service"

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sessionUser(id: string, role: SessionUser["role"]): SessionUser {
  return { id, username: id, fullName: id, initials: "XX", role, roleLabel: role, authenticationSource: "LOCAL" }
}

const ADMIN = sessionUser("admin-1", "ADMIN")
const MANAGER_A = sessionUser("manager-a", "MANAGER")
const MANAGER_B = sessionUser("manager-b", "MANAGER")
const EMPLOYEE = sessionUser("employee-1", "EMPLOYEE")
const SECURITY = sessionUser("security-1", "SECURITY")

function settings(minutes: number): OperationalSettings {
  return { overdueToleranceMinutes: minutes, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" }
}

function adminUserRecord(id: string): AdminUser {
  return {
    id,
    fullName: id,
    username: id,
    email: `${id}@example.test`,
    authenticationSource: "LOCAL",
    role: "ADMIN",
    authorizationScope: { companyIds: [], facilityIds: [], securityGateIds: [] },
    active: true,
  }
}

const emptyOrganization: OrganizationSnapshot = { companies: [], facilities: [], departments: [], securityGates: [] }

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

const referenceData: VisitReferenceData = {
  companies: [],
  facilities: [],
  employees: [],
  visitTypes: [],
  currentEmployee: { employeeId: "emp-1", companyId: "c-1", facilityId: "f-1", role: "EMPLOYEE" },
}

function notCalled(name: string): () => never {
  return () => {
    throw new Error(`Unexpected service call: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// Fake services
// ---------------------------------------------------------------------------

/** The real `AuthProvider` hydrates from `getCurrentSession()` and follows `subscribe()`. */
function createFakeSessionService(initial: SessionUser | null) {
  let session = initial
  const listeners = new Set<(next: SessionUser | null) => void>()

  const service: SessionService = {
    login: async (username) => {
      session = sessionUser(username, "MANAGER")
      for (const listener of listeners) listener(session)
      return session
    },
    logout: async () => {
      session = null
      for (const listener of listeners) listener(null)
    },
    getCurrentSession: async () => session,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return {
    service,
    /** Pushes a new session through the subscription, the way the real service does. */
    emit(next: SessionUser | null) {
      session = next
      for (const listener of listeners) listener(next)
    },
  }
}

function createFakeAdminService() {
  const calls: string[] = []
  let label = "a"
  let tolerance = 15

  const service: AdminService = {
    getUsers: async () => {
      calls.push("getUsers")
      return [adminUserRecord(`user-${label}`)]
    },
    getOrganization: async () => {
      calls.push("getOrganization")
      return emptyOrganization
    },
    getVisitTypes: async () => {
      calls.push("getVisitTypes")
      return []
    },
    getVisitorCards: async () => {
      calls.push("getVisitorCards")
      return []
    },
    getVisitorRuleVersions: async () => {
      calls.push("getVisitorRuleVersions")
      return []
    },
    getOperationalSettings: async () => {
      calls.push("getOperationalSettings")
      return settings(tolerance)
    },
    saveUser: notCalled("saveUser"),
    resetLocalUserPassword: notCalled("resetLocalUserPassword"),
    saveOrganizationEntity: notCalled("saveOrganizationEntity"),
    saveVisitType: notCalled("saveVisitType"),
    createVisitorCard: notCalled("createVisitorCard"),
    updateVisitorCardInventory: notCalled("updateVisitorCardInventory"),
    markVisitorCardLost: notCalled("markVisitorCardLost"),
    restoreVisitorCard: notCalled("restoreVisitorCard"),
    deleteVisitorCard: notCalled("deleteVisitorCard"),
    publishVisitorRule: notCalled("publishVisitorRule"),
    saveOperationalSettings: notCalled("saveOperationalSettings"),
  }

  return {
    service,
    calls,
    setPayload(nextLabel: string, nextTolerance: number) {
      label = nextLabel
      tolerance = nextTolerance
    },
  }
}

function createFakeResourceService() {
  const calls: string[] = []
  let payload = [room("a-room")]

  const service: ResourceCatalogService = {
    listResources: async () => {
      calls.push("listResources")
      return payload
    },
    createResource: notCalled("createResource"),
    updateResource: notCalled("updateResource"),
    setResourceActive: notCalled("setResourceActive"),
    deleteResource: notCalled("deleteResource"),
  }

  return {
    service,
    calls,
    setPayload(next: FacilityResource[]) {
      payload = next
    },
  }
}

function createFakeVisitService() {
  const calls: string[] = []

  const service: VisitService = {
    listMeetings: async () => {
      calls.push("listMeetings")
      return [meeting("meeting-1")]
    },
    listVisits: async () => {
      calls.push("listVisits")
      return []
    },
    getReferenceData: async () => {
      calls.push("getReferenceData")
      return referenceData
    },
    createMeeting: notCalled("createMeeting"),
    updateMeeting: notCalled("updateMeeting"),
    sendMeetingInvitations: notCalled("sendMeetingInvitations"),
    sendVisitInvitation: notCalled("sendVisitInvitation"),
    rescheduleVisit: notCalled("rescheduleVisit"),
    cancelVisit: notCalled("cancelVisit"),
    cancelMeeting: notCalled("cancelMeeting"),
    extendMeeting: notCalled("extendMeeting"),
    closeMeeting: notCalled("closeMeeting"),
    checkoutVisit: notCalled("checkoutVisit"),
  }

  return { service, calls }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function mount(tree: ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<StrictMode>{tree}</StrictMode>)
  })
  return {
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}

/** Records every value the context published, so intermediate states stay observable. */
function createRecorder<T>() {
  const history: T[] = []
  return {
    history,
    get latest() {
      return history[history.length - 1]
    },
    record(value: T) {
      history.push(value)
    },
  }
}

// The probes read the real context hooks and publish each committed value from an effect, so a
// value is recorded once per commit rather than once per render attempt.
function makeProbe<T>(useValue: () => T, recorder: ReturnType<typeof createRecorder<T>>) {
  return function Probe() {
    const value = useValue()
    useEffect(() => {
      recorder.record(value)
    }, [value])
    return null
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdminProvider wiring", () => {
  it("issues no Admin service call on a signed-out mount", async () => {
    const auth = createFakeSessionService(null)
    const admin = createFakeAdminService()
    const recorder = createRecorder<ReturnType<typeof useAdmin>>()
    const Probe = makeProbe(useAdmin, recorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <AdminProvider service={admin.service}>
          <Probe />
        </AdminProvider>
      </AuthProvider>,
    )

    expect(admin.calls).toEqual([])
    expect(recorder.latest.users).toEqual([])
    expect(recorder.latest.settings).toBeNull()
    await tree.unmount()
  })

  it("starts the full Admin load once an ADMIN session exists", async () => {
    const auth = createFakeSessionService(null)
    const admin = createFakeAdminService()
    const recorder = createRecorder<ReturnType<typeof useAdmin>>()
    const Probe = makeProbe(useAdmin, recorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <AdminProvider service={admin.service}>
          <Probe />
        </AdminProvider>
      </AuthProvider>,
    )
    expect(admin.calls).toEqual([])

    await act(async () => {
      auth.emit(ADMIN)
    })

    expect(admin.calls).toEqual(
      expect.arrayContaining(["getUsers", "getOrganization", "getVisitTypes", "getVisitorCards", "getVisitorRuleVersions", "getOperationalSettings"]),
    )
    expect(recorder.latest.users).toHaveLength(1)
    expect(recorder.latest.organization).toEqual(emptyOrganization)
    await tree.unmount()
  })

  it("loads only the operational settings for a MANAGER session", async () => {
    const auth = createFakeSessionService(MANAGER_A)
    const admin = createFakeAdminService()
    const recorder = createRecorder<ReturnType<typeof useAdmin>>()
    const Probe = makeProbe(useAdmin, recorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <AdminProvider service={admin.service}>
          <Probe />
        </AdminProvider>
      </AuthProvider>,
    )

    expect(admin.calls).toEqual(["getOperationalSettings"])
    expect(recorder.latest.settings).toEqual(settings(15))
    expect(recorder.latest.users).toEqual([])
    await tree.unmount()
  })

  it("clears the exposed Admin state on logout", async () => {
    const auth = createFakeSessionService(ADMIN)
    const admin = createFakeAdminService()
    const recorder = createRecorder<ReturnType<typeof useAdmin>>()
    const AdminProbe = makeProbe(useAdmin, recorder)
    const authRecorder = createRecorder<ReturnType<typeof useAuth>>()
    const AuthProbe = makeProbe(useAuth, authRecorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <AuthProbe />
        <AdminProvider service={admin.service}>
          <AdminProbe />
        </AdminProvider>
      </AuthProvider>,
    )
    expect(recorder.latest.users).toHaveLength(1)

    // Signs out through the real AuthProvider, which calls the session service and clears the user.
    await act(async () => {
      await authRecorder.latest.logout()
    })

    expect(authRecorder.latest.authenticated).toBe(false)
    expect(recorder.latest.users).toEqual([])
    expect(recorder.latest.organization).toBeNull()
    expect(recorder.latest.settings).toBeNull()
    await tree.unmount()
  })
})

describe("ResourceProvider wiring", () => {
  it("does not call the resource service on a signed-out mount", async () => {
    const auth = createFakeSessionService(null)
    const resources = createFakeResourceService()
    const recorder = createRecorder<ReturnType<typeof useResources>>()
    const Probe = makeProbe(useResources, recorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <ResourceProvider service={resources.service}>
          <Probe />
        </ResourceProvider>
      </AuthProvider>,
    )

    expect(resources.calls).toEqual([])
    expect(recorder.latest.resources).toEqual([])
    expect(recorder.latest.isLoading).toBe(false)
    await tree.unmount()
  })

  it("loads resources for MANAGER and ADMIN sessions", async () => {
    for (const user of [MANAGER_A, ADMIN]) {
      const auth = createFakeSessionService(null)
      const resources = createFakeResourceService()
      const recorder = createRecorder<ReturnType<typeof useResources>>()
      const Probe = makeProbe(useResources, recorder)

      const tree = await mount(
        <AuthProvider service={auth.service}>
          <ResourceProvider service={resources.service}>
            <Probe />
          </ResourceProvider>
        </AuthProvider>,
      )
      expect(resources.calls).toEqual([])

      await act(async () => {
        auth.emit(user)
      })

      expect(resources.calls).toEqual(["listResources"])
      expect(recorder.latest.resources).toEqual([room("a-room")])
      expect(recorder.latest.isLoading).toBe(false)
      await tree.unmount()
    }
  })

  it("clears resources and issues no new request when the session becomes EMPLOYEE or SECURITY", async () => {
    for (const user of [EMPLOYEE, SECURITY]) {
      const auth = createFakeSessionService(MANAGER_A)
      const resources = createFakeResourceService()
      const recorder = createRecorder<ReturnType<typeof useResources>>()
      const Probe = makeProbe(useResources, recorder)

      const tree = await mount(
        <AuthProvider service={auth.service}>
          <ResourceProvider service={resources.service}>
            <Probe />
          </ResourceProvider>
        </AuthProvider>,
      )
      expect(recorder.latest.resources).toHaveLength(1)
      resources.calls.length = 0

      await act(async () => {
        auth.emit(user)
      })

      expect(resources.calls).toEqual([])
      expect(recorder.latest.resources).toEqual([])
      expect(recorder.latest.isLoading).toBe(false)
      await tree.unmount()
    }
  })

  it("re-runs the effect on an account switch, clearing A before loading B", async () => {
    const auth = createFakeSessionService(MANAGER_A)
    const resources = createFakeResourceService()
    const recorder = createRecorder<ReturnType<typeof useResources>>()
    const Probe = makeProbe(useResources, recorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <ResourceProvider service={resources.service}>
          <Probe />
        </ResourceProvider>
      </AuthProvider>,
    )
    expect(recorder.latest.resources).toEqual([room("a-room")])
    resources.calls.length = 0
    const committedBeforeSwitch = recorder.history.length

    // Same role, different account: only the session identity changes.
    resources.setPayload([room("b-room")])
    await act(async () => {
      auth.emit(MANAGER_B)
    })

    expect(resources.calls).toEqual(["listResources"])
    expect(recorder.latest.resources).toEqual([room("b-room")])
    // A's list was dropped before B's arrived, so it was never shown to B.
    const afterSwitch = recorder.history.slice(committedBeforeSwitch)
    expect(afterSwitch.some((value) => value.resources.length === 0)).toBe(true)
    expect(afterSwitch.every((value) => !value.resources.some((resource) => resource.id === "a-room"))).toBe(true)
    await tree.unmount()
  })
})

describe("VisitProvider wiring", () => {
  it("exposes empty state and issues no request while signed out", async () => {
    const auth = createFakeSessionService(null)
    const visits = createFakeVisitService()
    const recorder = createRecorder<ReturnType<typeof useVisits>>()
    const Probe = makeProbe(useVisits, recorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <VisitProvider service={visits.service}>
          <Probe />
        </VisitProvider>
      </AuthProvider>,
    )

    expect(visits.calls).toEqual([])
    expect(recorder.latest.meetings).toEqual([])
    expect(recorder.latest.visits).toEqual([])
    expect(recorder.latest.referenceData).toBeNull()
    expect(recorder.latest.isLoading).toBe(false)
    await tree.unmount()
  })

  it("loads meetings, visits and reference data once a session exists", async () => {
    const auth = createFakeSessionService(null)
    const visits = createFakeVisitService()
    const recorder = createRecorder<ReturnType<typeof useVisits>>()
    const Probe = makeProbe(useVisits, recorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <VisitProvider service={visits.service}>
          <Probe />
        </VisitProvider>
      </AuthProvider>,
    )
    expect(visits.calls).toEqual([])

    await act(async () => {
      auth.emit(EMPLOYEE)
    })

    expect(visits.calls).toEqual(expect.arrayContaining(["listMeetings", "listVisits", "getReferenceData"]))
    expect(recorder.latest.meetings).toEqual([meeting("meeting-1")])
    expect(recorder.latest.referenceData).toEqual(referenceData)
    await tree.unmount()
  })

  it("clears visit state on logout", async () => {
    const auth = createFakeSessionService(EMPLOYEE)
    const visits = createFakeVisitService()
    const recorder = createRecorder<ReturnType<typeof useVisits>>()
    const VisitProbe = makeProbe(useVisits, recorder)
    const authRecorder = createRecorder<ReturnType<typeof useAuth>>()
    const AuthProbe = makeProbe(useAuth, authRecorder)

    const tree = await mount(
      <AuthProvider service={auth.service}>
        <AuthProbe />
        <VisitProvider service={visits.service}>
          <VisitProbe />
        </VisitProvider>
      </AuthProvider>,
    )
    expect(recorder.latest.meetings).toHaveLength(1)

    await act(async () => {
      await authRecorder.latest.logout()
    })

    expect(recorder.latest.meetings).toEqual([])
    expect(recorder.latest.visits).toEqual([])
    expect(recorder.latest.referenceData).toBeNull()
    await tree.unmount()
  })
})
