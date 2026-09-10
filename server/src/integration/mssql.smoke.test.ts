import "dotenv/config"

import { PrismaClient } from "@prisma/client"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildApp } from "../app.js"
import { verifyPassword } from "../auth/password.js"
import { loadConfig } from "../config/env.js"
import { PrismaAdminRepository } from "../repositories/prisma-admin-repository.js"
import { PrismaAuthRepository } from "../repositories/prisma-auth-repository.js"
import { PrismaOrganizationRepository } from "../repositories/prisma-organization-repository.js"
import { PrismaResourceRepository } from "../repositories/prisma-resource-repository.js"
import { PrismaSettingsRepository } from "../repositories/prisma-settings-repository.js"
import { PrismaVisitorOperationsRepository } from "../repositories/visitor-operations-repository.js"
import { demoSeedUsers, demoSeedUserScopes } from "../../prisma/seed-data.js"
import type { EmailMessage, EmailSender } from "../delivery/email-sender.js"

const describeMssql = process.env.RUN_MSSQL_INTEGRATION === "true" ? describe : describe.skip

describeMssql.sequential("Phase 1-3 MSSQL smoke", () => {
  const prisma = new PrismaClient()
  const testStartedAt = new Date()
  const resourceIds: string[] = []
  const visitorIds: string[] = []
  const meetingIds: string[] = []
  const visitIds: string[] = []
  const cardIds: string[] = []
  const ruleIds: string[] = []
  const previouslyActiveRuleIds: string[] = []
  const sentEmails: EmailMessage[] = []
  const fakeEmailSender: EmailSender = { send: async (message) => { sentEmails.push(message) } }
  let app: FastifyInstance
  let sessionCookie = ""
  let originalSettings: {
    overdueToleranceMinutes: number
    overdueAlertRepeatMinutes: number
    workdayEndTime: string
  } | null = null

  beforeAll(async () => {
    const config = loadConfig()
    app = await buildApp(config, {
      authRepository: new PrismaAuthRepository(prisma),
      organizationRepository: new PrismaOrganizationRepository(prisma),
      adminRepository: new PrismaAdminRepository(prisma),
      settingsRepository: new PrismaSettingsRepository(prisma),
      resourceRepository: new PrismaResourceRepository(prisma),
      visitorOperationsRepository: new PrismaVisitorOperationsRepository(prisma),
      emailSender: fakeEmailSender,
      checkDatabase: async () => { await prisma.$queryRawUnsafe("SELECT 1") },
    })
    const settings = await prisma.operationalSettings.findUnique({ where: { id: "default" } })
    previouslyActiveRuleIds.push(...(await prisma.visitorRuleVersion.findMany({ where: { active: true }, select: { id: true } })).map((item) => item.id))
    if (settings) {
      originalSettings = {
        overdueToleranceMinutes: settings.overdueToleranceMinutes,
        overdueAlertRepeatMinutes: settings.overdueAlertRepeatMinutes,
        workdayEndTime: settings.workdayEndTime,
      }
    }
  })

  afterAll(async () => {
    if (visitIds.length > 0) {
      await prisma.$transaction([
        prisma.hostCorrectionAudit.deleteMany({ where: { visitId: { in: visitIds } } }),
        prisma.visitRuleAcceptance.deleteMany({ where: { visitId: { in: visitIds } } }),
        prisma.invitation.deleteMany({ where: { visitId: { in: visitIds } } }),
        prisma.visitorCard.updateMany({ where: { currentVisitId: { in: visitIds } }, data: { currentVisitId: null, assignedVisitorName: null, status: "AVAILABLE" } }),
        prisma.visit.deleteMany({ where: { id: { in: visitIds } } }),
      ])
    }
    if (meetingIds.length > 0) await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } })
    if (visitorIds.length > 0) await prisma.visitor.deleteMany({ where: { id: { in: visitorIds } } })
    if (cardIds.length > 0) await prisma.visitorCard.deleteMany({ where: { id: { in: cardIds } } })
    if (ruleIds.length > 0) await prisma.visitorRuleVersion.deleteMany({ where: { id: { in: ruleIds } } })
    if (previouslyActiveRuleIds.length > 0) await prisma.visitorRuleVersion.updateMany({ where: { id: { in: previouslyActiveRuleIds } }, data: { active: true } })
    if (resourceIds.length > 0) {
      await prisma.$transaction([
        prisma.driverLicenseClass.deleteMany({ where: { resourceId: { in: resourceIds } } }),
        prisma.driverDocument.deleteMany({ where: { resourceId: { in: resourceIds } } }),
        prisma.resource.deleteMany({ where: { id: { in: resourceIds } } }),
      ])
    }
    if (originalSettings) {
      await prisma.operationalSettings.update({ where: { id: "default" }, data: originalSettings })
    }
    await prisma.session.deleteMany({
      where: { userId: "current-admin-atahan-bozkurt", createdAt: { gte: testStartedAt } },
    })
    await app.close()
    await prisma.$disconnect()
  })

  it("has the expected idempotent development seed data", async () => {
    const [company, facility, department, gate, settings] = await Promise.all([
      prisma.company.findUnique({ where: { id: "bplas" } }),
      prisma.facility.findUnique({ where: { id: "bplas-merkez" } }),
      prisma.department.findUnique({ where: { id: "department-bplas-yonetim" } }),
      prisma.securityGate.findUnique({ where: { id: "gate-bplas-merkez-ana-giris" } }),
      prisma.operationalSettings.findUnique({ where: { id: "default" } }),
    ])

    expect(company).toMatchObject({ active: true })
    expect(facility).toMatchObject({ companyId: "bplas", active: true })
    expect(department).toMatchObject({ companyId: "bplas", active: true })
    expect(gate).toMatchObject({ facilityId: "bplas-merkez", active: true })
    expect(settings).toMatchObject({
      overdueToleranceMinutes: 15,
      overdueAlertRepeatMinutes: 10,
      workdayEndTime: "18:15",
    })

    for (const definition of demoSeedUsers) {
      const user = await prisma.user.findUnique({
        where: { id: definition.id },
        include: { companyScopes: true, facilityScopes: true, securityGateScopes: true },
      })
      expect(user).toMatchObject({
        username: definition.username,
        role: definition.role,
        authenticationSource: "LOCAL",
        active: true,
      })
      expect(user?.passwordHash).toBeTruthy()
      expect(await verifyPassword(user!.passwordHash!, definition.password)).toBe(true)
      const expectedCompany = demoSeedUserScopes[definition.id]?.companyId ?? "bplas"
      const expectedFacility = demoSeedUserScopes[definition.id]?.facilityId ?? "bplas-merkez"
      const expectedGate = expectedCompany === "bplas-otomotiv" ? "gate-bplas-otomotiv-merkez-ana-giris" : "gate-bplas-merkez-ana-giris"
      expect(user?.companyScopes).toEqual([expect.objectContaining({ companyId: expectedCompany })])
      expect(user?.facilityScopes).toEqual([expect.objectContaining({ facilityId: expectedFacility })])
      expect(user?.securityGateScopes).toEqual([expect.objectContaining({ securityGateId: expectedGate })])
    }
  })

  it("serves readiness, LOCAL login, and session hydration", async () => {
    const ready = await app.inject({ method: "GET", url: "/api/ready" })
    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toEqual({ status: "ok" })

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin" },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json()).toMatchObject({ user: { username: "admin", role: "ADMIN" } })
    const setCookie = login.headers["set-cookie"]
    const rawSetCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie
    sessionCookie = rawSetCookie?.split(";", 1)[0] ?? ""
    expect(sessionCookie).not.toBe("")

    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: sessionCookie } })
    expect(session.statusCode).toBe(200)
    expect(session.json()).toMatchObject({ user: { username: "admin", role: "ADMIN" } })
  })

  it("reads organization, admin users, and operational settings and updates settings", async () => {
    const headers = { cookie: sessionCookie }
    const [organization, users, settings] = await Promise.all([
      app.inject({ method: "GET", url: "/api/organization", headers }),
      app.inject({ method: "GET", url: "/api/admin/users", headers }),
      app.inject({ method: "GET", url: "/api/settings/operational", headers }),
    ])

    expect(organization.statusCode).toBe(200)
    const organizationBody = organization.json()
    expect(organizationBody.companies).toEqual(expect.arrayContaining([expect.objectContaining({ id: "bplas" })]))
    expect(organizationBody.facilities).toEqual(expect.arrayContaining([expect.objectContaining({ id: "bplas-merkez", parentId: "bplas" })]))
    expect(organizationBody.departments).toEqual(expect.arrayContaining([expect.objectContaining({ id: "department-bplas-yonetim", parentId: "bplas" })]))
    expect(organizationBody.securityGates).toEqual(expect.arrayContaining([expect.objectContaining({ id: "gate-bplas-merkez-ana-giris", parentId: "bplas-merkez" })]))
    expect(users.statusCode).toBe(200)
    expect(users.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "current-admin-atahan-bozkurt", role: "ADMIN" }),
    ]))
    expect(settings.statusCode).toBe(200)
    expect(settings.json()).toMatchObject(originalSettings!)

    const update = await app.inject({
      method: "PUT",
      url: "/api/settings/operational",
      headers,
      payload: { overdueToleranceMinutes: 17, overdueAlertRepeatMinutes: 11, workdayEndTime: "19:05" },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json()).toMatchObject({
      overdueToleranceMinutes: 17,
      overdueAlertRepeatMinutes: 11,
      workdayEndTime: "19:05",
    })
    expect(await prisma.operationalSettings.findUnique({ where: { id: "default" } })).toMatchObject({
      overdueToleranceMinutes: 17,
      overdueAlertRepeatMinutes: 11,
      workdayEndTime: "19:05",
    })
  })

  it("creates and reads ROOM, VEHICLE, and DRIVER resources and replaces DRIVER relations", async () => {
    const headers = { cookie: sessionCookie }
    const suffix = Date.now().toString().slice(-8)
    const resources = [
      { type: "ROOM", companyId: "bplas", facilityId: "bplas-merkez", name: `MSSQL Oda ${suffix}` },
      { type: "VEHICLE", companyId: "bplas", facilityId: "bplas-merkez", brand: "Ford", model: "Focus", licensePlate: `16 DB ${suffix}` },
      { type: "DRIVER", companyId: "bplas", facilityId: "bplas-merkez", fullName: `MSSQL Şoför ${suffix}`, licenseClasses: ["B", "C"], documents: ["SRC 2"], canDriveCommercialVehicles: true },
    ] as const

    const created = []
    for (const payload of resources) {
      const response = await app.inject({ method: "POST", url: "/api/resources", headers, payload })
      expect(response.statusCode).toBe(201)
      const resource = response.json()
      resourceIds.push(resource.id)
      created.push(resource)

      const read = await app.inject({ method: "GET", url: `/api/resources/${resource.id}`, headers })
      expect(read.statusCode).toBe(200)
      expect(read.json()).toMatchObject({ id: resource.id, type: payload.type })
    }

    const driver = created.find((resource) => resource.type === "DRIVER")!
    expect(driver).toMatchObject({ licenseClasses: ["B", "C"], documents: ["SRC 2"] })

    const update = await app.inject({
      method: "PATCH",
      url: `/api/resources/${driver.id}`,
      headers,
      payload: {
        type: "DRIVER",
        companyId: "bplas",
        facilityId: "bplas-merkez",
        fullName: `MSSQL Şoför Güncel ${suffix}`,
        licenseClasses: ["D", "E"],
        documents: ["SRC 4", "Psikoteknik"],
        canDriveCommercialVehicles: false,
      },
    })
    expect(update.statusCode).toBe(200)
    const updatedDriver = update.json()
    expect(updatedDriver).toMatchObject({
      id: driver.id,
      type: "DRIVER",
      canDriveCommercialVehicles: false,
    })
    expect([...updatedDriver.licenseClasses].sort()).toEqual(["D", "E"])
    expect([...updatedDriver.documents].sort()).toEqual(["Psikoteknik", "SRC 4"])

    const [licenseClasses, documents] = await Promise.all([
      prisma.driverLicenseClass.findMany({ where: { resourceId: driver.id }, orderBy: { value: "asc" } }),
      prisma.driverDocument.findMany({ where: { resourceId: driver.id }, orderBy: { name: "asc" } }),
    ])
    expect(licenseClasses.map(({ value }) => value)).toEqual(["D", "E"])
    expect(documents.map(({ name }) => name)).toEqual(["Psikoteknik", "SRC 4"])
  })

  it("runs the Phase 3 visitor, invitation, security, card, audit, and rule flow against MSSQL", async () => {
    const adminHeaders = { cookie: sessionCookie }
    const login = async (username: string, password: string) => {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } })
      expect(response.statusCode).toBe(200)
      const setCookie = response.headers["set-cookie"]
      return { cookie: (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? "" }
    }
    const employeeHeaders = await login("calisan", "calisan")
    const securityHeaders = await login("guvenlik", "guvenlik")
    const suffix = Date.now().toString().slice(-8)

    const rule = await app.inject({ method: "POST", url: "/api/admin/visitor-rules", headers: adminHeaders, payload: { content: `MSSQL rule ${suffix}` } })
    expect(rule.statusCode).toBe(201); ruleIds.push(rule.json().id)
    const card = await app.inject({ method: "POST", url: "/api/admin/visitor-cards", headers: adminHeaders, payload: { cardNumber: `MSSQL-${suffix}` } })
    expect(card.statusCode).toBe(201); cardIds.push(card.json().id)
    const secondCard = await app.inject({ method: "POST", url: "/api/admin/visitor-cards", headers: adminHeaders, payload: { cardNumber: `MSSQL-B-${suffix}` } })
    expect(secondCard.statusCode).toBe(201); cardIds.push(secondCard.json().id)
    const thirdCard = await app.inject({ method: "POST", url: "/api/admin/visitor-cards", headers: adminHeaders, payload: { cardNumber: `MSSQL-C-${suffix}` } })
    expect(thirdCard.statusCode).toBe(201); cardIds.push(thirdCard.json().id)

    const created = await app.inject({ method: "POST", url: "/api/meetings", headers: employeeHeaders, payload: { visitors: [{ firstName: "MSSQL Ada", lastName: "Yılmaz", email: `ada-${suffix}@example.test`, company: "Acme" }, { firstName: "MSSQL Deniz", lastName: "Yılmaz", email: `deniz-${suffix}@example.test`, company: "Acme" }, { firstName: "MSSQL Ece", lastName: "Yılmaz", email: `ece-${suffix}@example.test`, company: "Acme" }], visitTypeId: "meeting", hostEmployeeId: "maya-kara", hostEmployeeName: "Maya Kara", hostCompanyId: "bplas", facilityId: "bplas-merkez", plannedStart: "2026-10-03T09:00:00.000Z", plannedEnd: "2026-10-03T10:00:00.000Z" } })
    expect(created.statusCode).toBe(201)
    const body = created.json(); meetingIds.push(body.meeting.id); visitIds.push(...body.visits.map((item: { id: string }) => item.id)); visitorIds.push(...body.visits.map((item: { visitor: { id: string } }) => item.visitor.id))
    const [firstVisit, secondVisit, thirdVisit] = body.visits

    const invitation = await app.inject({ method: "POST", url: `/api/visits/${firstVisit.id}/invitation`, headers: employeeHeaders })
    expect(invitation.statusCode).toBe(200); expect(invitation.json()).toMatchObject({ invitationStatus: "SENT" })
    const url = new URL(sentEmails.at(-1)!.text.match(/https?:\/\/\S+/)![0])
    const rawToken = url.searchParams.get("token")!
    expect(rawToken).toBeTruthy()
    const invitationBeforeReset = await prisma.invitation.findFirst({ where: { visitId: firstVisit.id } })
    expect(invitationBeforeReset).toMatchObject({ tokenHash: expect.not.stringContaining(rawToken) })
    const rescheduled = await app.inject({ method: "PATCH", url: `/api/visits/${firstVisit.id}/reschedule`, headers: employeeHeaders, payload: { plannedStart: "2026-10-03T11:00:00.000Z", plannedEnd: "2026-10-03T12:00:00.000Z" } })
    expect(rescheduled.statusCode).toBe(200)
    expect(rescheduled.json()).toMatchObject({ invitationStatus: "NOT_SENT", meeting: { plannedStart: "2026-10-03T11:00:00.000Z", plannedEnd: "2026-10-03T12:00:00.000Z" } })
    expect(await prisma.invitation.findFirst({ where: { visitId: firstVisit.id } })).toBeNull()
    expect((await app.inject({ method: "GET", url: `/api/public/invitations/${rawToken}` })).statusCode).toBe(404)
    expect((await app.inject({ method: "PATCH", url: `/api/public/invitations/${rawToken}`, payload: { firstName: "Stale", lastName: "Visitor", company: "Stale", vehiclePlate: "34 OLD 34" } })).statusCode).toBe(404)
    expect((await app.inject({ method: "POST", url: `/api/public/invitations/${rawToken}/rule-acceptances` })).statusCode).toBe(404)
    const resentInvitation = await app.inject({ method: "POST", url: `/api/visits/${firstVisit.id}/invitation`, headers: employeeHeaders })
    expect(resentInvitation.statusCode).toBe(200); expect(resentInvitation.json()).toMatchObject({ invitationStatus: "SENT" })
    const resentToken = new URL(sentEmails.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!
    expect(resentToken).not.toBe(rawToken)
    expect((await app.inject({ method: "GET", url: `/api/public/invitations/${rawToken}` })).statusCode).toBe(404)
    const publicDetails = await app.inject({ method: "GET", url: `/api/public/invitations/${resentToken}` })
    expect(publicDetails.statusCode).toBe(200); expect(publicDetails.json()).toMatchObject({ visit: { facilityName: "Merkez Tesis" } })
    expect((await app.inject({ method: "POST", url: `/api/public/invitations/${resentToken}/rule-acceptances` })).statusCode).toBe(200)

    const checkedIn = await app.inject({ method: "POST", url: `/api/security/visits/${firstVisit.id}/check-in`, headers: securityHeaders, payload: { visitorCardId: card.json().id } })
    expect(checkedIn.statusCode).toBe(200); expect(checkedIn.json()).toMatchObject({ status: "CHECKED_IN", visitorCardId: card.json().id })
    const checkedOut = await app.inject({ method: "POST", url: `/api/security/visits/${firstVisit.id}/check-out`, headers: securityHeaders, payload: { cardReturned: true } })
    expect(checkedOut.statusCode).toBe(200); expect(checkedOut.json()).toMatchObject({ status: "CHECKED_OUT", visitorCardReturned: true })

    const secondInvitation = await app.inject({ method: "POST", url: `/api/visits/${secondVisit.id}/invitation`, headers: employeeHeaders })
    const secondToken = new URL(sentEmails.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!
    expect(secondInvitation.statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `/api/public/invitations/${secondToken}/rule-acceptances` })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `/api/security/visits/${secondVisit.id}/check-in`, headers: securityHeaders, payload: { visitorCardId: secondCard.json().id } })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `/api/security/visits/${secondVisit.id}/check-out`, headers: securityHeaders, payload: { cardReturned: false } })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `/api/security/visits/${secondVisit.id}/late-card-return`, headers: securityHeaders })).statusCode).toBe(200)

    const thirdInvitation = await app.inject({ method: "POST", url: `/api/visits/${thirdVisit.id}/invitation`, headers: employeeHeaders })
    const thirdToken = new URL(sentEmails.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!
    expect(thirdInvitation.statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `/api/public/invitations/${thirdToken}/rule-acceptances` })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `/api/security/visits/${thirdVisit.id}/check-in`, headers: securityHeaders, payload: { visitorCardId: thirdCard.json().id } })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `/api/security/visits/${thirdVisit.id}/check-out`, headers: securityHeaders, payload: { cardReturned: false } })).statusCode).toBe(200)
    const lostCard = await app.inject({ method: "POST", url: `/api/admin/visitor-cards/${thirdCard.json().id}/mark-lost`, headers: adminHeaders })
    expect(lostCard.statusCode).toBe(200)
    expect(lostCard.json()).toMatchObject({ status: "LOST", assignedVisitId: thirdVisit.id, assignedVisitorName: "MSSQL Ece Yılmaz" })
    expect(await prisma.visitorCard.findUnique({ where: { id: thirdCard.json().id } })).toMatchObject({ status: "LOST", currentVisitId: thirdVisit.id, assignedVisitorName: "MSSQL Ece Yılmaz" })
    const restoredCard = await app.inject({ method: "POST", url: `/api/admin/visitor-cards/${thirdCard.json().id}/restore`, headers: adminHeaders })
    expect(restoredCard.statusCode).toBe(200)
    expect(restoredCard.json()).toMatchObject({ status: "AVAILABLE" })
    expect(restoredCard.json()).not.toHaveProperty("assignedVisitId")
    expect(restoredCard.json()).not.toHaveProperty("assignedVisitorName")
    expect(await prisma.visitorCard.findUnique({ where: { id: thirdCard.json().id } })).toMatchObject({ status: "AVAILABLE", currentVisitId: null, assignedVisitorName: null })

    const unplanned = await app.inject({ method: "POST", url: "/api/security/unplanned-visits", headers: securityHeaders, payload: { firstName: "MSSQL Plansız", lastName: "Ziyaretçi", company: "Acme", hostEmployeeName: "Serbest Ev Sahibi", visitTypeId: "meeting", durationMinutes: 30, visitorCardId: card.json().id, rulesAccepted: true, companyId: "bplas", facilityId: "bplas-merkez" } })
    expect(unplanned.statusCode).toBe(201); visitIds.push(unplanned.json().id); visitorIds.push(unplanned.json().visitor.id); meetingIds.push(unplanned.json().meeting.id)
    const correction = await app.inject({ method: "PATCH", url: `/api/security/visits/${unplanned.json().id}/correction`, headers: securityHeaders, payload: { firstName: "MSSQL Plansız", lastName: "Ziyaretçi", company: "Acme", hostEmployeeName: "Düzeltilmiş Ev Sahibi" } })
    expect(correction.statusCode).toBe(200)
    expect(await prisma.hostCorrectionAudit.findFirst({ where: { visitId: unplanned.json().id } })).toMatchObject({ previousHostName: "Serbest Ev Sahibi", correctedHostName: "Düzeltilmiş Ev Sahibi" })

    const nextRule = await app.inject({ method: "POST", url: "/api/admin/visitor-rules", headers: adminHeaders, payload: { content: `MSSQL rule v2 ${suffix}` } })
    expect(nextRule.statusCode).toBe(201); ruleIds.push(nextRule.json().id)
    expect(await prisma.visitorRuleVersion.findMany({ where: { active: true } })).toEqual([expect.objectContaining({ id: nextRule.json().id })])

    const raceCard = await app.inject({ method: "POST", url: "/api/admin/visitor-cards", headers: adminHeaders, payload: { cardNumber: `MSSQL-RACE-${suffix}` } })
    expect(raceCard.statusCode).toBe(201); cardIds.push(raceCard.json().id)
    const raceMeeting = await app.inject({ method: "POST", url: "/api/meetings", headers: employeeHeaders, payload: { visitors: [{ firstName: "MSSQL Race A", lastName: "Visitor", email: `race-a-${suffix}@example.test`, company: "Acme" }, { firstName: "MSSQL Race B", lastName: "Visitor", email: `race-b-${suffix}@example.test`, company: "Acme" }], visitTypeId: "meeting", hostEmployeeId: "maya-kara", hostEmployeeName: "Maya Kara", hostCompanyId: "bplas", facilityId: "bplas-merkez", plannedStart: "2026-10-04T09:00:00.000Z", plannedEnd: "2026-10-04T10:00:00.000Z" } })
    expect(raceMeeting.statusCode).toBe(201)
    const raceBody = raceMeeting.json(); meetingIds.push(raceBody.meeting.id); visitIds.push(...raceBody.visits.map((item: { id: string }) => item.id)); visitorIds.push(...raceBody.visits.map((item: { visitor: { id: string } }) => item.visitor.id))
    for (const raceVisit of raceBody.visits) {
      expect((await app.inject({ method: "POST", url: `/api/visits/${raceVisit.id}/invitation`, headers: employeeHeaders })).statusCode).toBe(200)
      const raceToken = new URL(sentEmails.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!
      expect((await app.inject({ method: "POST", url: `/api/public/invitations/${raceToken}/rule-acceptances` })).statusCode).toBe(200)
    }

    const raceResponses = await Promise.all(raceBody.visits.map((raceVisit: { id: string }) => app.inject({ method: "POST", url: `/api/security/visits/${raceVisit.id}/check-in`, headers: securityHeaders, payload: { visitorCardId: raceCard.json().id } })))
    expect(raceResponses.map((response) => response.statusCode).sort()).toEqual([200, 409])
    const winnerResponse = raceResponses.find((response) => response.statusCode === 200)!
    const loserResponse = raceResponses.find((response) => response.statusCode === 409)!
    expect(["CARD_UNAVAILABLE", "CHECK_IN_CONFLICT"]).toContain(loserResponse.json().error.code)
    expect(JSON.stringify(loserResponse.json())).not.toMatch(/P20\d\d|deadlock|transaction|SQL Server/i)
    const raceVisits = await prisma.visit.findMany({ where: { id: { in: raceBody.visits.map((item: { id: string }) => item.id) } } })
    expect(raceVisits.filter((visit) => visit.status === "CHECKED_IN")).toEqual([expect.objectContaining({ id: winnerResponse.json().id, visitorCardId: raceCard.json().id })])
    expect(raceVisits.filter((visit) => visit.status === "PLANNED")).toHaveLength(1)
    expect(await prisma.visitorCard.findUnique({ where: { id: raceCard.json().id } })).toMatchObject({ status: "IN_USE", currentVisitId: winnerResponse.json().id })
  })

  it("logs out and rejects the revoked session during hydration", async () => {
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: sessionCookie } })
    expect(logout.statusCode).toBe(204)

    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: sessionCookie } })
    expect(session.statusCode).toBe(200)
    expect(session.json()).toEqual({ user: null })
  })
})
