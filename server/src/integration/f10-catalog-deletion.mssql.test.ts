import "dotenv/config"

import { PrismaClient } from "@prisma/client"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildApp } from "../app.js"
import { loadConfig } from "../config/env.js"
import type { EmailSender } from "../delivery/email-sender.js"
import { PrismaAdminRepository } from "../repositories/prisma-admin-repository.js"
import { PrismaAuthRepository } from "../repositories/prisma-auth-repository.js"
import { PrismaOrganizationRepository } from "../repositories/prisma-organization-repository.js"
import { PrismaResourceRepository } from "../repositories/prisma-resource-repository.js"
import { PrismaResourceAssignmentRepository } from "../repositories/resource-assignment-repository.js"
import { PrismaSettingsRepository } from "../repositories/prisma-settings-repository.js"
import { PrismaVisitorOperationsRepository } from "../repositories/visitor-operations-repository.js"
import { PrismaGoodsMovementRepository } from "../repositories/goods-movement-repository.js"
import { PrismaTransportAssignmentRepository } from "../repositories/transport-assignment-repository.js"
import { PrismaReportsRepository } from "../repositories/reports-repository.js"

const describeMssql = process.env.RUN_MSSQL_INTEGRATION === "true" ? describe : describe.skip

/**
 * F10 — catalog/master-data records are permanently deletable, operational history is not.
 * Every case here asserts both halves: the catalog row is gone AND the history row survives with
 * its display snapshot intact and only its live catalog reference nulled.
 */
describeMssql.sequential("F10 MSSQL — catalog deletion keeps operational history", () => {
  const prisma = new PrismaClient()
  const testStartedAt = new Date()
  const suffix = Date.now().toString().slice(-9)

  const resourceIds: string[] = []
  const meetingIds: string[] = []
  const visitIds: string[] = []
  const visitorIds: string[] = []
  const transportIds: string[] = []
  const cardIds: string[] = []

  const fakeEmailSender: EmailSender = { send: async () => undefined }
  let app: FastifyInstance
  const cookies: Record<string, string> = {}

  const login = async (username: string, password: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } })
    expect(response.statusCode).toBe(200)
    const setCookie = response.headers["set-cookie"]
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? ""
  }
  const headers = (role: keyof typeof cookies) => ({ cookie: cookies[role] })
  const iso = (offsetMinutesFromNow: number) => new Date(testStartedAt.getTime() + offsetMinutesFromNow * 60_000).toISOString()

  const createResource = async (payload: Record<string, unknown>) => {
    const response = await app.inject({ method: "POST", url: "/api/resources", headers: headers("admin"), payload })
    expect(response.statusCode).toBe(201)
    resourceIds.push(response.json().id)
    return response.json().id as string
  }

  const createMeeting = async (plannedStart: string, plannedEnd: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/meetings",
      headers: headers("employee"),
      payload: {
        visitors: [{ firstName: "F10", lastName: `Ziyaretçi ${suffix}`, email: `f10-${suffix}-${meetingIds.length}@example.test`, company: "Acme" }],
        visitTypeId: "meeting", hostEmployeeId: "maya-kara", hostEmployeeName: "Maya Kara",
        hostCompanyId: "bplas", facilityId: "bplas-merkez", plannedStart, plannedEnd,
      },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json()
    meetingIds.push(body.meeting.id)
    visitIds.push(...body.visits.map((visit: { id: string }) => visit.id))
    visitorIds.push(...body.visits.map((visit: { visitor: { id: string } }) => visit.visitor.id))
    return { meetingId: body.meeting.id as string, visitId: body.visits[0].id as string }
  }

  /** Drives a Meeting into terminal history the way a finished visit day leaves it. */
  const closeMeetingAsHistory = async (meetingId: string) => {
    await prisma.visit.updateMany({ where: { meetingId }, data: { status: "CHECKED_OUT", actualCheckOut: testStartedAt } })
    await prisma.meeting.update({ where: { id: meetingId }, data: { actualMeetingEnd: testStartedAt, meetingEndSource: "MANUAL" } })
  }

  const createCard = async (cardNumber: string) => {
    const response = await app.inject({ method: "POST", url: "/api/admin/visitor-cards", headers: headers("admin"), payload: { cardNumber } })
    expect(response.statusCode).toBe(201)
    cardIds.push(response.json().id)
    return response.json().id as string
  }

  const deleteResource = (id: string) => app.inject({ method: "DELETE", url: `/api/resources/${id}`, headers: headers("admin") })
  const deleteCard = (id: string) => app.inject({ method: "DELETE", url: `/api/admin/visitor-cards/${id}`, headers: headers("admin") })

  beforeAll(async () => {
    const config = loadConfig()
    const resourceAssignmentRepository = new PrismaResourceAssignmentRepository(prisma)
    app = await buildApp(config, {
      authRepository: new PrismaAuthRepository(prisma),
      organizationRepository: new PrismaOrganizationRepository(prisma),
      adminRepository: new PrismaAdminRepository(prisma),
      settingsRepository: new PrismaSettingsRepository(prisma),
      resourceRepository: new PrismaResourceRepository(prisma),
      visitorOperationsRepository: new PrismaVisitorOperationsRepository(prisma, resourceAssignmentRepository),
      goodsMovementRepository: new PrismaGoodsMovementRepository(prisma),
      resourceAssignmentRepository,
      transportAssignmentRepository: new PrismaTransportAssignmentRepository(prisma),
      reportsRepository: new PrismaReportsRepository(prisma),
      emailSender: fakeEmailSender,
      checkDatabase: async () => { await prisma.$queryRawUnsafe("SELECT 1") },
    })
    cookies.admin = await login("admin", "admin")
    cookies.manager = await login("yonetici", "yonetici")
    cookies.security = await login("guvenlik", "guvenlik")
    cookies.employee = await login("calisan", "calisan")
  })

  afterAll(async () => {
    if (meetingIds.length > 0) await prisma.resourceAssignment.deleteMany({ where: { meetingId: { in: meetingIds } } })
    if (transportIds.length > 0) await prisma.transportAssignment.deleteMany({ where: { id: { in: transportIds } } })
    if (cardIds.length > 0) await prisma.visitorCard.updateMany({ where: { id: { in: cardIds } }, data: { currentVisitId: null } })
    if (visitIds.length > 0) await prisma.visitRuleAcceptance.deleteMany({ where: { visitId: { in: visitIds } } })
    if (visitIds.length > 0) await prisma.visit.deleteMany({ where: { id: { in: visitIds } } })
    if (meetingIds.length > 0) await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } })
    if (visitorIds.length > 0) await prisma.visitor.deleteMany({ where: { id: { in: visitorIds } } })
    if (cardIds.length > 0) await prisma.visitorCard.deleteMany({ where: { id: { in: cardIds } } })
    if (resourceIds.length > 0) {
      await prisma.driverLicenseClass.deleteMany({ where: { resourceId: { in: resourceIds } } })
      await prisma.driverDocument.deleteMany({ where: { resourceId: { in: resourceIds } } })
      await prisma.resource.deleteMany({ where: { id: { in: resourceIds } } })
    }
    for (const userId of ["current-admin-atahan-bozkurt", "current-manager-atahan-bozkurt", "current-security-atahan-bozkurt", "current-employee-maya-kara"]) {
      await prisma.session.deleteMany({ where: { userId, createdAt: { gte: testStartedAt } } })
    }
    await app.close()
    await prisma.$disconnect()
  })

  it("1: deletes a resource that was never used", async () => {
    const room = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F10 Kullanılmamış Oda ${suffix}` })

    expect((await deleteResource(room)).statusCode).toBe(204)
    expect(await prisma.resource.findUnique({ where: { id: room } })).toBeNull()
  })

  it("2 + 5 + 11: deletes resources held only by a closed Meeting, keeping both assignment snapshots", async () => {
    const room = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F10 Tarihsel Oda ${suffix}` })
    const equipment = await createResource({ type: "POOLED_EQUIPMENT", companyId: "bplas", facilityId: "bplas-merkez", name: `F10 Tarihsel Projektör ${suffix}`, totalQuantity: 5 })
    const { meetingId } = await createMeeting(iso(-240), iso(-180))
    expect((await app.inject({ method: "PUT", url: `/api/meetings/${meetingId}/resource-assignments`, headers: headers("manager"), payload: { roomResourceId: room, equipment: [{ resourceId: equipment, requestedQuantity: 2 }] } })).statusCode).toBe(200)
    await closeMeetingAsHistory(meetingId)

    expect((await deleteResource(room)).statusCode).toBe(204)
    expect((await deleteResource(equipment)).statusCode).toBe(204)

    expect(await prisma.resource.findMany({ where: { id: { in: [room, equipment] } } })).toHaveLength(0)
    const rows = await prisma.resourceAssignment.findMany({ where: { meetingId }, orderBy: { resourceType: "asc" } })
    // Two deleted resources on ONE meeting both hold resourceId = NULL without a unique conflict.
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.resourceId === null)).toBe(true)
    expect(rows.find((row) => row.resourceType === "POOLED_EQUIPMENT")).toMatchObject({
      resourceName: `F10 Tarihsel Projektör ${suffix}`, companyId: "bplas", facilityId: "bplas-merkez", totalQuantity: 5, requestedQuantity: 2,
    })
    expect(rows.find((row) => row.resourceType === "ROOM")).toMatchObject({ resourceName: `F10 Tarihsel Oda ${suffix}`, companyId: "bplas", facilityId: "bplas-merkez" })

    // The API still projects that history rather than failing on the missing catalog rows.
    const listed = await app.inject({ method: "GET", url: `/api/meetings/${meetingId}/resource-assignments`, headers: headers("manager") })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: null, resourceType: "ROOM", resourceName: `F10 Tarihsel Oda ${suffix}` }),
      expect.objectContaining({ resourceId: null, resourceType: "POOLED_EQUIPMENT", resourceName: `F10 Tarihsel Projektör ${suffix}`, totalQuantity: 5, requestedQuantity: 2 }),
    ]))
  })

  it("3 + 5: deletes a vehicle and driver held only by a cancelled transport assignment, keeping name/plate", async () => {
    const plate = `34 F10V ${suffix}`
    const vehicle = await createResource({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Ford", model: "Transit", licensePlate: plate })
    const driver = await createResource({ type: "DRIVER", companyId: "bplas", facilityId: "bplas-merkez", fullName: `F10 Şoför ${suffix}`, licenseClasses: ["B"], documents: ["SRC"], canDriveCommercialVehicles: false })
    const created = await app.inject({
      method: "POST", url: "/api/transport-assignments", headers: headers("manager"),
      payload: { companyId: "bplas", facilityId: "bplas-merkez", plannedStart: iso(-300), plannedEnd: iso(-240), purpose: `F10 sevkiyat ${suffix}`, vehicleResourceId: vehicle, driverResourceId: driver },
    })
    expect(created.statusCode).toBe(201)
    const assignmentId = created.json().id as string
    transportIds.push(assignmentId)
    expect((await app.inject({ method: "POST", url: `/api/transport-assignments/${assignmentId}/cancel`, headers: headers("manager") })).statusCode).toBe(200)

    expect((await deleteResource(vehicle)).statusCode).toBe(204)
    expect((await deleteResource(driver)).statusCode).toBe(204)

    expect(await prisma.resource.findMany({ where: { id: { in: [vehicle, driver] } } })).toHaveLength(0)
    expect(await prisma.driverLicenseClass.findMany({ where: { resourceId: driver } })).toHaveLength(0)
    expect(await prisma.driverDocument.findMany({ where: { resourceId: driver } })).toHaveLength(0)
    expect(await prisma.transportAssignment.findUnique({ where: { id: assignmentId } })).toMatchObject({
      vehicleResourceId: null, driverResourceId: null,
      vehicleName: "Ford Transit", vehicleLicensePlate: plate.toUpperCase(), driverName: `F10 Şoför ${suffix}`,
      companyId: "bplas", facilityId: "bplas-merkez", purpose: `F10 sevkiyat ${suffix}`, status: "CANCELLED",
    })

    const listed = await app.inject({ method: "GET", url: "/api/transport-assignments", headers: headers("manager") })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().find((item: { id: string }) => item.id === assignmentId)).toMatchObject({
      vehicleResourceId: null, driverResourceId: null, vehicleName: "Ford Transit", driverName: `F10 Şoför ${suffix}`,
    })
    expect((await app.inject({ method: "GET", url: "/api/reports/fleet", headers: headers("manager") })).statusCode).toBe(200)
  })

  it("4: refuses to delete a resource an open Meeting or an ACTIVE transport assignment still holds", async () => {
    const room = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F10 Aktif Oda ${suffix}` })
    const vehicle = await createResource({ type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Fiat", model: "Doblo", licensePlate: `34 F10A ${suffix}` })
    const driver = await createResource({ type: "DRIVER", companyId: "bplas", facilityId: "bplas-merkez", fullName: `F10 Aktif Şoför ${suffix}`, licenseClasses: ["B"], documents: [], canDriveCommercialVehicles: false })
    const { meetingId } = await createMeeting(iso(24 * 60), iso(25 * 60))
    expect((await app.inject({ method: "POST", url: `/api/meetings/${meetingId}/resource-assignments/room`, headers: headers("manager"), payload: { resourceId: room } })).statusCode).toBe(201)
    const created = await app.inject({
      method: "POST", url: "/api/transport-assignments", headers: headers("manager"),
      payload: { companyId: "bplas", facilityId: "bplas-merkez", plannedStart: iso(48 * 60), plannedEnd: iso(49 * 60), purpose: `F10 aktif ${suffix}`, vehicleResourceId: vehicle, driverResourceId: driver },
    })
    expect(created.statusCode).toBe(201)
    transportIds.push(created.json().id)

    for (const id of [room, vehicle, driver]) {
      const refused = await deleteResource(id)
      expect(refused.statusCode).toBe(409)
      expect(refused.json()).toMatchObject({ error: { code: "RESOURCE_IN_USE" } })
      expect(await prisma.resource.findUnique({ where: { id } })).not.toBeNull()
    }
  })

  it("6: deletes an unused AVAILABLE card and an unused DISABLED card", async () => {
    const available = await createCard(`F10-A-${suffix}`)
    const disabled = await createCard(`F10-D-${suffix}`)
    expect((await app.inject({ method: "PATCH", url: `/api/admin/visitor-cards/${disabled}/status`, headers: headers("admin"), payload: { active: false } })).json().status).toBe("DISABLED")

    expect((await deleteCard(available)).statusCode).toBe(204)
    expect((await deleteCard(disabled)).statusCode).toBe(204)
    expect(await prisma.visitorCard.findMany({ where: { id: { in: [available, disabled] } } })).toHaveLength(0)
  })

  it("7 + 9: deletes a returned card that has visit history, keeping the visit and its card-number snapshot", async () => {
    const cardNumber = `F10-H-${suffix}`
    const cardId = await createCard(cardNumber)
    const unplanned = await app.inject({
      method: "POST", url: "/api/security/unplanned-visits", headers: headers("security"),
      payload: {
        firstName: "F10", lastName: `Plansız ${suffix}`, company: "Acme", hostEmployeeName: "Maya Kara",
        visitTypeId: "meeting", durationMinutes: 60, visitorCardId: cardId, rulesAccepted: true,
        companyId: "bplas", facilityId: "bplas-merkez",
      },
    })
    expect(unplanned.statusCode).toBe(201)
    const visit = unplanned.json()
    visitIds.push(visit.id)
    visitorIds.push(visit.visitor.id)
    meetingIds.push(visit.meetingId)
    expect((await app.inject({ method: "POST", url: `/api/security/visits/${visit.id}/check-out`, headers: headers("security"), payload: { cardReturned: true } })).statusCode).toBe(200)

    expect((await deleteCard(cardId)).statusCode).toBe(204)

    expect(await prisma.visitorCard.findUnique({ where: { id: cardId } })).toBeNull()
    expect(await prisma.visit.findUnique({ where: { id: visit.id } })).toMatchObject({
      status: "CHECKED_OUT", visitorCardId: null, visitorCardNumber: cardNumber, visitorCardReturned: true,
    })

    const detail = await app.inject({ method: "GET", url: `/api/visits/${visit.id}`, headers: headers("manager") })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({ visitorCardNumber: cardNumber })
    expect(detail.json().visitorCardId).toBeUndefined()
    const list = await app.inject({ method: "GET", url: "/api/visits", headers: headers("manager") })
    expect(list.statusCode).toBe(200)
    expect(list.json().find((item: { id: string }) => item.id === visit.id)).toMatchObject({ visitorCardNumber: cardNumber })
  })

  it("8: refuses to delete a card that is still in circulation", async () => {
    const inUseCard = await createCard(`F10-U-${suffix}`)
    const notReturnedCard = await createCard(`F10-N-${suffix}`)

    const inside = await app.inject({
      method: "POST", url: "/api/security/unplanned-visits", headers: headers("security"),
      payload: { firstName: "F10", lastName: `İçeride ${suffix}`, company: "Acme", hostEmployeeName: "Maya Kara", visitTypeId: "meeting", durationMinutes: 60, visitorCardId: inUseCard, rulesAccepted: true, companyId: "bplas", facilityId: "bplas-merkez" },
    })
    expect(inside.statusCode).toBe(201)
    visitIds.push(inside.json().id); visitorIds.push(inside.json().visitor.id); meetingIds.push(inside.json().meetingId)

    const unreturned = await app.inject({
      method: "POST", url: "/api/security/unplanned-visits", headers: headers("security"),
      payload: { firstName: "F10", lastName: `İadesiz ${suffix}`, company: "Acme", hostEmployeeName: "Maya Kara", visitTypeId: "meeting", durationMinutes: 60, visitorCardId: notReturnedCard, rulesAccepted: true, companyId: "bplas", facilityId: "bplas-merkez" },
    })
    expect(unreturned.statusCode).toBe(201)
    visitIds.push(unreturned.json().id); visitorIds.push(unreturned.json().visitor.id); meetingIds.push(unreturned.json().meetingId)
    expect((await app.inject({ method: "POST", url: `/api/security/visits/${unreturned.json().id}/check-out`, headers: headers("security"), payload: { cardReturned: false } })).statusCode).toBe(200)
    const lost = await app.inject({ method: "POST", url: `/api/admin/visitor-cards/${notReturnedCard}/mark-lost`, headers: headers("admin") })

    for (const [id, status] of [[inUseCard, "IN_USE"], [notReturnedCard, lost.json().status]] as const) {
      const refused = await deleteCard(id)
      expect(refused.statusCode, `${status} must not be deletable`).toBe(409)
      expect(refused.json()).toMatchObject({ error: { code: "CARD_OPERATIONAL" } })
      expect(await prisma.visitorCard.findUnique({ where: { id } })).not.toBeNull()
    }
  })

  it("12: still rejects a duplicate live (meetingId, resourceId) assignment at the database level", async () => {
    const room = await createResource({ type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `F10 Tekil Oda ${suffix}` })
    const { meetingId } = await createMeeting(iso(72 * 60), iso(73 * 60))
    expect((await app.inject({ method: "POST", url: `/api/meetings/${meetingId}/resource-assignments/room`, headers: headers("manager"), payload: { resourceId: room } })).statusCode).toBe(201)

    await expect(prisma.resourceAssignment.create({
      data: { meetingId, resourceId: room, resourceType: "ROOM", resourceName: "Kopya", companyId: "bplas", facilityId: "bplas-merkez" },
    })).rejects.toThrow()
    expect(await prisma.resourceAssignment.count({ where: { meetingId } })).toBe(1)
  })
})
