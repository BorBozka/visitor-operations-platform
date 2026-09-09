import "dotenv/config"

import { PrismaClient } from "@prisma/client"
import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildApp } from "../app.js"
import { loadConfig } from "../config/env.js"
import type { EmailMessage, EmailSender } from "../delivery/email-sender.js"
import { PrismaAdminRepository } from "../repositories/prisma-admin-repository.js"
import { PrismaAuthRepository } from "../repositories/prisma-auth-repository.js"
import { PrismaVisitorOperationsRepository } from "../repositories/visitor-operations-repository.js"

const describeMssql = process.env.RUN_MSSQL_INTEGRATION === "true" ? describe : describe.skip

/**
 * Public pre-registration TOCTOU under *real* MSSQL concurrency.
 *
 * `VisitorOperationsService` pre-checks the invitation with `getActivePublicInvitation`, but that
 * read is a snapshot: a cancel or a Security check-in can commit before the repository's write
 * runs. An in-process Promise race cannot prove the guard, because the failure mode is a write
 * built on a stale snapshot of a row another *committed database transaction* has already moved
 * out of `PLANNED`.
 *
 * So the repository is wrapped with a hook that fires exactly in that window — after the service
 * has accepted the invitation, before the repository transaction opens — and the hook drives a
 * genuine cancel / check-in through the real HTTP stack, real Prisma repositories and one real
 * SQL Server database. The assertions are on committed rows, not on in-flight responses.
 */
describeMssql.sequential("Public invitation TOCTOU on MSSQL", () => {
  const prisma = new PrismaClient()
  const testStartedAt = new Date()
  const suffix = Date.now().toString().slice(-9)
  const meetingIds: string[] = []
  const visitIds: string[] = []
  const visitorIds: string[] = []
  const cardIds: string[] = []
  const publishedRuleIds: string[] = []
  const previouslyActiveRuleIds: string[] = []
  const sentEmails: EmailMessage[] = []
  const emailSender: EmailSender = { send: async (message) => { sentEmails.push(message) } }

  let app: FastifyInstance
  let adminHeaders = { cookie: "" }
  let employeeHeaders = { cookie: "" }
  let securityHeaders = { cookie: "" }
  /** Fires once, in the window between the service's invitation pre-check and the repository write. */
  let raceHook: (() => Promise<void>) | undefined

  const login = async (username: string, password: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } })
    expect(response.statusCode).toBe(200)
    const setCookie = response.headers["set-cookie"]
    return { cookie: (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? "" }
  }

  /** Creates a PLANNED single-visitor meeting and returns its visit plus a live invitation token. */
  const createInvitedVisit = async (name: string) => {
    const created = await app.inject({
      method: "POST", url: "/api/meetings", headers: employeeHeaders,
      payload: { visitors: [{ firstName: name, lastName: "Yarış", email: `${name.toLowerCase()}-${suffix}@example.test`, company: "Acme" }], visitTypeId: "meeting", hostEmployeeId: "maya-kara", hostEmployeeName: "Maya Kara", hostCompanyId: "bplas", facilityId: "bplas-merkez", plannedStart: "2026-11-03T09:00:00.000Z", plannedEnd: "2026-11-03T10:00:00.000Z" },
    })
    expect(created.statusCode).toBe(201)
    const body = created.json()
    meetingIds.push(body.meeting.id)
    visitIds.push(body.visits[0].id)
    visitorIds.push(body.visits[0].visitor.id)
    const invitation = await app.inject({ method: "POST", url: `/api/visits/${body.visits[0].id}/invitation`, headers: employeeHeaders })
    expect(invitation.statusCode).toBe(200)
    const token = new URL(sentEmails.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!
    return { visitId: body.visits[0].id as string, visitorId: body.visits[0].visitor.id as string, token }
  }

  const createCard = async (label: string) => {
    const response = await app.inject({ method: "POST", url: "/api/admin/visitor-cards", headers: adminHeaders, payload: { cardNumber: `TOCTOU-${label}-${suffix}` } })
    expect(response.statusCode).toBe(201)
    cardIds.push(response.json().id)
    return response.json().id as string
  }

  const readVisitor = (visitorId: string) => prisma.visitor.findUniqueOrThrow({ where: { id: visitorId }, select: { firstName: true, lastName: true, company: true, email: true, phone: true } })
  const readVisit = (visitId: string) => prisma.visit.findUniqueOrThrow({ where: { id: visitId }, select: { status: true, vehiclePlate: true } })
  const countAcceptances = (visitId: string) => prisma.visitRuleAcceptance.count({ where: { visitId } })

  const publicUpdate = (token: string) => app.inject({ method: "PATCH", url: `/api/public/invitations/${token}`, payload: { firstName: "Stale", lastName: "Yazım", company: "Stale A.Ş.", email: `stale-${suffix}@example.test`, phone: "5559999999", vehiclePlate: "34 STALE 34" } })
  const publicAccept = (token: string) => app.inject({ method: "POST", url: `/api/public/invitations/${token}/rule-acceptances` })

  const expectHiddenInvitation = (response: { statusCode: number; json: () => { error: { code: string; message: string } } }) => {
    expect(response.statusCode).toBe(404)
    expect(response.json().error).toEqual({ code: "INVITATION_NOT_FOUND", message: "Davet bağlantısı geçersiz veya süresi dolmuş." })
    expect(JSON.stringify(response.json())).not.toMatch(/P20\d\d|deadlock|serializ|write conflict|SQL Server|CANCELLED|CHECKED_IN/i)
  }

  beforeAll(async () => {
    const repository = new PrismaVisitorOperationsRepository(prisma)
    // Wrap the two public writes so a test can commit a competing cancel / check-in in exactly
    // the window the service's pre-check has already passed.
    const runHook = async () => { const hook = raceHook; raceHook = undefined; if (hook) await hook() }
    const realUpdate = repository.updatePublicVisitor.bind(repository)
    const realAccept = repository.acceptPublicRule.bind(repository)
    repository.updatePublicVisitor = async (tokenHash, input) => { await runHook(); return realUpdate(tokenHash, input) }
    repository.acceptPublicRule = async (tokenHash, ipAddress) => { await runHook(); return realAccept(tokenHash, ipAddress) }

    app = await buildApp(loadConfig(), {
      authRepository: new PrismaAuthRepository(prisma),
      adminRepository: new PrismaAdminRepository(prisma),
      visitorOperationsRepository: repository,
      emailSender,
      checkDatabase: async () => { await prisma.$queryRawUnsafe("SELECT 1") },
    })

    adminHeaders = await login("admin", "admin")
    employeeHeaders = await login("calisan", "calisan")
    securityHeaders = await login("guvenlik", "guvenlik")

    // Rule acceptance needs an active rule, and one test publishes a new version mid-race, so the
    // currently active versions are recorded here and reactivated in `afterAll`.
    previouslyActiveRuleIds.push(...(await prisma.visitorRuleVersion.findMany({ where: { active: true }, select: { id: true } })).map((rule) => rule.id))
    if (previouslyActiveRuleIds.length === 0) publishedRuleIds.push(await publishRule("base"))
  })

  const publishRule = async (label: string) => {
    const response = await app.inject({ method: "POST", url: "/api/admin/visitor-rules", headers: adminHeaders, payload: { content: `TOCTOU rule ${label} ${suffix}` } })
    expect(response.statusCode).toBe(201)
    return response.json().id as string
  }

  afterAll(async () => {
    if (visitIds.length > 0) {
      await prisma.$transaction([
        prisma.visitRuleAcceptance.deleteMany({ where: { visitId: { in: visitIds } } }),
        prisma.invitation.deleteMany({ where: { visitId: { in: visitIds } } }),
        prisma.visitorCard.updateMany({ where: { currentVisitId: { in: visitIds } }, data: { currentVisitId: null, assignedVisitorName: null, status: "AVAILABLE" } }),
        prisma.visit.deleteMany({ where: { id: { in: visitIds } } }),
      ])
    }
    if (meetingIds.length > 0) await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } })
    if (visitorIds.length > 0) await prisma.visitor.deleteMany({ where: { id: { in: visitorIds } } })
    if (cardIds.length > 0) await prisma.visitorCard.deleteMany({ where: { id: { in: cardIds } } })
    if (publishedRuleIds.length > 0) await prisma.visitorRuleVersion.deleteMany({ where: { id: { in: publishedRuleIds } } })
    if (previouslyActiveRuleIds.length > 0) await prisma.visitorRuleVersion.updateMany({ where: { id: { in: previouslyActiveRuleIds } }, data: { active: true } })
    await prisma.session.deleteMany({ where: { userId: { in: ["current-admin-atahan-bozkurt"] }, createdAt: { gte: testStartedAt } } })
    await app.close()
    await prisma.$disconnect()
  })

  it("applies a public visitor update and rule acceptance while the visit is still PLANNED", async () => {
    const invited = await createInvitedVisit("Planli")

    const updated = await publicUpdate(invited.token)
    const accepted = await publicAccept(invited.token)

    expect(updated.statusCode).toBe(200)
    expect(accepted.statusCode).toBe(200)
    expect(await readVisitor(invited.visitorId)).toMatchObject({ firstName: "Stale", company: "Stale A.Ş.", phone: "5559999999" })
    expect(await readVisit(invited.visitId)).toMatchObject({ status: "PLANNED", vehiclePlate: "34 STALE 34" })
    expect(await countAcceptances(invited.visitId)).toBe(1)
  })

  it("rejects a public visitor update once a cancel commits after the service pre-check", async () => {
    const invited = await createInvitedVisit("IptalA")
    const before = await readVisitor(invited.visitorId)
    raceHook = async () => { expect((await app.inject({ method: "POST", url: `/api/visits/${invited.visitId}/cancel`, headers: employeeHeaders })).statusCode).toBe(200) }

    const response = await publicUpdate(invited.token)

    expectHiddenInvitation(response)
    expect(await readVisitor(invited.visitorId)).toEqual(before)
    expect(await readVisit(invited.visitId)).toEqual({ status: "CANCELLED", vehiclePlate: null })
  })

  it("rejects a public rule acceptance once a cancel commits after the service pre-check", async () => {
    const invited = await createInvitedVisit("IptalB")
    raceHook = async () => { expect((await app.inject({ method: "POST", url: `/api/visits/${invited.visitId}/cancel`, headers: employeeHeaders })).statusCode).toBe(200) }

    const response = await publicAccept(invited.token)

    expectHiddenInvitation(response)
    expect(await countAcceptances(invited.visitId)).toBe(0)
    expect(await readVisit(invited.visitId)).toMatchObject({ status: "CANCELLED" })
  })

  it("rejects a public visitor update once a Security check-in commits after the service pre-check", async () => {
    const invited = await createInvitedVisit("GirisA")
    const cardId = await createCard("in")
    expect((await publicAccept(invited.token)).statusCode).toBe(200)
    const before = await readVisitor(invited.visitorId)
    raceHook = async () => { expect((await app.inject({ method: "POST", url: `/api/security/visits/${invited.visitId}/check-in`, headers: securityHeaders, payload: { visitorCardId: cardId } })).statusCode).toBe(200) }

    const response = await publicUpdate(invited.token)

    expectHiddenInvitation(response)
    expect(await readVisitor(invited.visitorId)).toEqual(before)
    expect(await readVisit(invited.visitId)).toEqual({ status: "CHECKED_IN", vehiclePlate: null })
  })

  it("creates no rule acceptance once a check-in commits after the service pre-check", async () => {
    const invited = await createInvitedVisit("GirisB")
    const cardId = await createCard("rule")
    // Check-in requires an acceptance of its own, so the visit accepts the current rule first.
    expect((await publicAccept(invited.token)).statusCode).toBe(200)
    // The hook checks the visitor in *and* publishes a new rule version, so the stale public call
    // would insert a genuinely new acceptance row rather than replay the idempotent one.
    let racingRuleId = ""
    raceHook = async () => {
      expect((await app.inject({ method: "POST", url: `/api/security/visits/${invited.visitId}/check-in`, headers: securityHeaders, payload: { visitorCardId: cardId } })).statusCode).toBe(200)
      racingRuleId = await publishRule("race")
      publishedRuleIds.push(racingRuleId)
    }

    const response = await publicAccept(invited.token)

    expectHiddenInvitation(response)
    expect(await countAcceptances(invited.visitId)).toBe(1)
    expect(await prisma.visitRuleAcceptance.count({ where: { visitId: invited.visitId, visitorRuleVersionId: racingRuleId } })).toBe(0)
    expect(await readVisit(invited.visitId)).toMatchObject({ status: "CHECKED_IN" })
  })

  it("keeps the public write and a truly parallel cancel serialized on the database", async () => {
    const invited = await createInvitedVisit("Paralel")
    const before = await readVisitor(invited.visitorId)

    const [publicResponse] = await Promise.all([
      publicUpdate(invited.token),
      app.inject({ method: "POST", url: `/api/visits/${invited.visitId}/cancel`, headers: employeeHeaders }),
    ])

    // Either order is a legal serialization; what must never happen is a half-applied write, a
    // leaked engine error, or a response outside the public contract.
    expect([200, 404]).toContain(publicResponse.statusCode)
    expect(JSON.stringify(publicResponse.json())).not.toMatch(/P20\d\d|deadlock|serializ|write conflict|SQL Server/i)
    const after = await readVisitor(invited.visitorId)
    const applied = { firstName: "Stale", lastName: "Yazım", company: "Stale A.Ş.", email: `stale-${suffix}@example.test`, phone: "5559999999" }
    expect([before, applied]).toContainEqual(after)
    expect((await readVisit(invited.visitId)).vehiclePlate).toBe(after.firstName === "Stale" ? "34 STALE 34" : null)
  })
})
