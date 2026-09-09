import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiClientError } from "@/lib/http"
import { HttpAccountService } from "@/services/http/http-account-service"
import { HttpAdminService } from "@/services/http/http-admin-service"
import { HttpGoodsMovementService } from "@/services/http/http-goods-movement-service"
import { HttpReportsService } from "@/services/http/http-reports-service"
import { HttpResourceAssignmentService } from "@/services/http/http-resource-assignment-service"
import { HttpResourceCatalogService } from "@/services/http/http-resource-catalog-service"
import { HttpSecurityService } from "@/services/http/http-security-service"
import { HttpTransportAssignmentService } from "@/services/http/http-transport-assignment-service"
import { HttpVisitService } from "@/services/http/http-visit-service"

const BASE = "http://localhost:3001/api"

interface Recorded {
  url: string
  method: string
  credentials?: RequestCredentials
  body: unknown
}

let calls: Recorded[]
let responder: (call: Recorded) => Response

function respondJson(status: number, body: unknown): Response {
  if (status === 204 || status === 205 || status === 304) return new Response(null, { status })
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
  calls = []
  responder = () => respondJson(200, {})
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Recorded = {
      url: String(input),
      method: init?.method ?? "GET",
      credentials: init?.credentials,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    return responder(call)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const last = () => calls[calls.length - 1]

/* --------------------------------- Account -------------------------------- */

describe("HttpAccountService", () => {
  it("POSTs change-password without a target user id, credentials included", async () => {
    responder = () => respondJson(204, undefined)
    await new HttpAccountService().changePassword({ userId: "u1", currentPassword: "old12345", newPassword: "new12345" })
    expect(last().url).toBe(`${BASE}/account/change-password`)
    expect(last().method).toBe("POST")
    expect(last().credentials).toBe("include")
    expect(last().body).toEqual({ currentPassword: "old12345", newPassword: "new12345" })
    expect(last().body).not.toHaveProperty("userId")
  })
})

/* ---------------------------------- Visit --------------------------------- */

const meetingDto = {
  id: "m1", creatorEmployeeId: "e1", visitTypeId: "vt1", visitTypeName: "Toplantı",
  hostEmployeeName: "Host", hostCompanyId: "c1", hostCompanyName: "C1", facilityId: "f1", facilityName: "F1",
  plannedStart: "2026-09-02T09:00:00.000Z", plannedEnd: "2026-09-02T10:00:00.000Z",
  hasAdditionalRequirements: false, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
}
const visitDto = {
  id: "v1", meetingId: "m1", visitor: { id: "vr1", firstName: "Ada", lastName: "Yılmaz", company: "Acme" },
  status: "PLANNED", invitationStatus: "NOT_SENT", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  ruleAcceptance: { id: "ra1", ruleId: "r1", ruleVersion: 1, acceptedAt: "2026-09-01T00:00:00.000Z", method: "INVITATION_LINK", contentSnapshot: "Kural" },
  meeting: meetingDto,
}

describe("HttpVisitService", () => {
  it("lists visits and flattens the nested meeting, dropping the rule-acceptance id", async () => {
    responder = () => respondJson(200, [visitDto])
    const [visit] = await new HttpVisitService().listVisits()
    expect(last().url).toBe(`${BASE}/visits`)
    expect(visit.id).toBe("v1")
    expect(visit.hostCompanyId).toBe("c1")
    expect(visit).not.toHaveProperty("meeting")
    expect(visit.ruleAcceptance).toEqual({ ruleId: "r1", ruleVersion: 1, acceptedAt: "2026-09-01T00:00:00.000Z", method: "INVITATION_LINK", contentSnapshot: "Kural" })
  })

  it("maps an Admin session's null currentEmployee to a neutral placeholder", async () => {
    responder = () => respondJson(200, { companies: [], facilities: [], employees: [], visitTypes: [{ id: "vt1", name: "T", active: true }], currentEmployee: null })
    const reference = await new HttpVisitService().getReferenceData()
    expect(reference.currentEmployee).toEqual({ employeeId: "", companyId: "", facilityId: "", role: "MANAGER" })
    expect(reference.visitTypes).toEqual([{ id: "vt1", name: "T", active: true }])
  })

  it("extend sends only the minute count and returns the mapped meeting", async () => {
    responder = () => respondJson(200, { meeting: { ...meetingDto, actualMeetingEnd: undefined }, visits: [visitDto] })
    const meeting = await new HttpVisitService().extendMeeting("m1", { extensionMinutes: 15, actorEmployeeId: "e1", currentTime: "2026-09-02T10:00:00.000Z" })
    expect(last().url).toBe(`${BASE}/meetings/m1/extend`)
    expect(last().body).toEqual({ extensionMinutes: 15 })
    expect(meeting.id).toBe("m1")
  })

  it("cancelMeeting returns the meeting's visit projections", async () => {
    responder = () => respondJson(200, { meeting: meetingDto, visits: [visitDto] })
    const visits = await new HttpVisitService().cancelMeeting("m1")
    expect(last().url).toBe(`${BASE}/meetings/m1/cancel`)
    expect(visits).toHaveLength(1)
  })
})

/* -------------------------------- Security -------------------------------- */

describe("HttpSecurityService", () => {
  it("strips creatorEmployeeId from an unplanned-visit create", async () => {
    responder = () => respondJson(201, visitDto)
    await new HttpSecurityService().createAndCheckInUnplannedVisit({
      firstName: "Ada", lastName: "Y", company: "Acme", hostEmployeeName: "Host", visitTypeId: "vt1",
      durationMinutes: 30, visitorCardId: "card1", rulesAccepted: true, companyId: "c1", facilityId: "f1",
      creatorEmployeeId: "SHOULD_NOT_BE_SENT",
    })
    expect(last().url).toBe(`${BASE}/security/unplanned-visits`)
    expect(last().body).not.toHaveProperty("creatorEmployeeId")
    expect(last().body).toMatchObject({ companyId: "c1", facilityId: "f1" })
  })

  it("routes check-in by visit id and sends only card/plate/phone", async () => {
    responder = () => respondJson(200, { ...visitDto, status: "CHECKED_IN" })
    await new HttpSecurityService().checkInVisit({ visitId: "v9", visitorCardId: "card1", vehiclePlate: "34ABC" })
    expect(last().url).toBe(`${BASE}/security/visits/v9/check-in`)
    expect(last().body).toEqual({ visitorCardId: "card1", vehiclePlate: "34ABC", phone: undefined })
  })

  it("returns null when there is no active rule", async () => {
    responder = () => respondJson(200, null)
    await expect(new HttpSecurityService().getActiveVisitorRule()).resolves.toBeNull()
  })
})

/* --------------------------------- Admin --------------------------------- */

const adminUserDto = {
  id: "u1", fullName: "Ada", username: "ada", email: "ada@x.test", authenticationSource: "LOCAL",
  role: "MANAGER", authorizationScope: { companyIds: ["c1"], facilityIds: [], securityGateIds: [] },
  active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("HttpAdminService", () => {
  it("creates a user with the temporary password from the options bag", async () => {
    responder = () => respondJson(201, adminUserDto)
    await new HttpAdminService().saveUser(
      { fullName: "Ada", username: "ada", email: "ada@x.test", authenticationSource: "LOCAL", role: "MANAGER", authorizationScope: { companyIds: ["c1"], facilityIds: [], securityGateIds: [] }, active: true },
      { actingUserId: "self", temporaryPassword: "secret-123" },
    )
    expect(last().url).toBe(`${BASE}/admin/users`)
    expect(last().method).toBe("POST")
    expect(last().body).toMatchObject({ username: "ada", password: "secret-123" })
    expect(last().body).not.toHaveProperty("actingUserId")
  })

  it("omits identity fields when updating an Active Directory user", async () => {
    responder = () => respondJson(200, { ...adminUserDto, authenticationSource: "ACTIVE_DIRECTORY" })
    await new HttpAdminService().saveUser(
      { id: "u1", fullName: "New", username: "new", email: "new@x.test", authenticationSource: "ACTIVE_DIRECTORY", role: "ADMIN", authorizationScope: { companyIds: ["c1"], facilityIds: [], securityGateIds: [] }, active: false },
      { actingUserId: "self" },
    )
    expect(last().url).toBe(`${BASE}/admin/users/u1`)
    expect(last().method).toBe("PATCH")
    expect(last().body).toEqual({ role: "ADMIN", authorizationScope: { companyIds: ["c1"], facilityIds: [], securityGateIds: [] }, active: false })
  })

  it("maps organization children through the parent-id assertion and drops timestamps", async () => {
    responder = () => respondJson(200, {
      companies: [{ id: "c1", name: "C1", active: true, createdAt: "x", updatedAt: "y" }],
      facilities: [{ id: "f1", parentId: "c1", name: "F1", active: true, createdAt: "x", updatedAt: "y" }],
      departments: [], securityGates: [],
    })
    const snapshot = await new HttpAdminService().getOrganization()
    expect(last().url).toBe(`${BASE}/organization?includeInactive=true`)
    expect(snapshot.companies[0]).toEqual({ id: "c1", parentId: undefined, name: "C1", active: true })
    expect(snapshot.facilities[0]).toEqual({ id: "f1", parentId: "c1", name: "F1", active: true })
  })

  it("PUTs operational settings without the updatedAt field", async () => {
    responder = () => respondJson(200, { overdueToleranceMinutes: 15, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15", updatedAt: "x" })
    const saved = await new HttpAdminService().saveOperationalSettings({ overdueToleranceMinutes: 15, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" })
    expect(last().method).toBe("PUT")
    expect(last().body).toEqual({ overdueToleranceMinutes: 15, overdueAlertRepeatMinutes: 10, workdayEndTime: "18:15" })
    expect(saved).not.toHaveProperty("updatedAt")
  })
})

/* --------------------- Resources / goods / transport --------------------- */

describe("catalog / goods / transport adapters", () => {
  it("resource catalog list requests inactive rows too", async () => {
    responder = () => respondJson(200, [])
    await new HttpResourceCatalogService().listResources()
    expect(last().url).toBe(`${BASE}/resources?includeInactive=true`)
  })

  it("resource delete resolves on 204", async () => {
    responder = () => respondJson(204, undefined)
    await expect(new HttpResourceCatalogService().deleteResource("r1")).resolves.toBeUndefined()
    expect(last().url).toBe(`${BASE}/resources/r1`)
    expect(last().method).toBe("DELETE")
  })

  it("security goods list uses the scoped endpoint", async () => {
    responder = () => respondJson(200, [])
    await new HttpGoodsMovementService().listSecurityGoodsMovements()
    expect(last().url).toBe(`${BASE}/security/goods-movements`)
  })

  it("calendar goods list uses the authenticated ownership endpoint", async () => {
    responder = () => respondJson(200, [])
    await new HttpGoodsMovementService().listMyGoodsMovements()
    expect(last().url).toBe(`${BASE}/goods-movements/mine`)
  })

  it("transport availability POSTs the planning window", async () => {
    responder = () => respondJson(200, { vehicles: [], drivers: [] })
    await new HttpTransportAssignmentService().getAvailability({ companyId: "c1", facilityId: "f1", plannedStart: "2026-09-02T09:00:00.000Z", plannedEnd: "2026-09-02T10:00:00.000Z" })
    expect(last().url).toBe(`${BASE}/transport-assignments/availability`)
    expect(last().method).toBe("POST")
  })

  it("resource-assignment save PUTs the desired state", async () => {
    responder = () => respondJson(200, [])
    await new HttpResourceAssignmentService().saveMeetingAssignments("m1", { roomResourceId: "r1", equipment: [{ resourceId: "eq1", requestedQuantity: 2 }] })
    expect(last().url).toBe(`${BASE}/meetings/m1/resource-assignments`)
    expect(last().method).toBe("PUT")
    expect(last().body).toEqual({ roomResourceId: "r1", equipment: [{ resourceId: "eq1", requestedQuantity: 2 }] })
  })
})

/* --------------------------------- Reports -------------------------------- */

describe("HttpReportsService", () => {
  it("passes the date range as query params and unwraps { visits }", async () => {
    responder = () => respondJson(200, { visits: [visitDto] })
    const visits = await new HttpReportsService().getVisitsDataset({ startDate: "2026-09-01", endDate: "2026-09-30", companyId: "all" })
    expect(last().url).toBe(`${BASE}/reports/visits?startDate=2026-09-01&endDate=2026-09-30&companyId=all`)
    expect(visits[0].id).toBe("v1")
  })

  it("unwraps { assignments } / { movements } for fleet and goods", async () => {
    responder = (call) => respondJson(200, call.url.includes("/fleet") ? { assignments: [{ id: "a1" }] } : { movements: [{ id: "g1" }] })
    expect(await new HttpReportsService().getFleetDataset({})).toEqual([{ id: "a1" }])
    expect(await new HttpReportsService().getGoodsDataset({})).toEqual([{ id: "g1" }])
  })
})

/* ------------------------- shared error behaviour ------------------------ */

describe("adapter error mapping", () => {
  it("surfaces a backend 409 as an ApiClientError with the same code/message", async () => {
    responder = () => respondJson(409, { error: { code: "ROOM_CONFLICT", message: "Oda çakışması." } })
    const error = await new HttpResourceAssignmentService().assignRoom("m1", { resourceId: "r1" }).catch((cause) => cause)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({ code: "ROOM_CONFLICT", message: "Oda çakışması.", status: 409 })
  })

  it("surfaces a 401 as an unauthorized ApiClientError", async () => {
    responder = () => respondJson(401, { error: { code: "UNAUTHENTICATED", message: "Oturum gerekli." } })
    const error = await new HttpVisitService().listVisits().catch((cause) => cause) as ApiClientError
    expect(error.isUnauthorized).toBe(true)
  })
})
