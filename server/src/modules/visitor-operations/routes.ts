import type { FastifyInstance } from "fastify"
import { z } from "zod"

import type { AuthGuards } from "../../auth/auth-guards.js"
import { toAccessContext } from "../../lib/authorization.js"
import { validationError } from "../../lib/api-error.js"
import { VisitorOperationsService } from "./service.js"

const id = z.string().min(1).max(36)
const idParams = z.object({ id }).strict()
const tokenParams = z.object({ token: z.string().min(20).max(200) }).strict()
const timestamp = z.string().datetime({ offset: true })
const visitor = z.object({ visitId: id.optional(), firstName: z.string().max(100), lastName: z.string().max(100), email: z.string().max(320).optional(), company: z.string().max(200), phone: z.string().max(40).optional() }).strict()
const meetingBody = z.object({ visitors: z.array(visitor).min(1).max(100), visitTypeId: id, hostEmployeeId: id.optional(), hostEmployeeName: z.string().max(200), hostCompanyId: id, facilityId: id, plannedStart: timestamp, plannedEnd: timestamp, note: z.string().max(2_000).optional(), hasAdditionalRequirements: z.boolean().optional(), additionalRequirementNote: z.string().max(2_000).optional() }).strict()
const publicVisitor = z.object({ firstName: z.string().max(100), lastName: z.string().max(100), email: z.string().max(320).optional(), company: z.string().max(200), phone: z.string().max(40).optional(), vehiclePlate: z.string().max(32).optional() }).strict()

function parsed<T>(result: z.SafeParseReturnType<unknown, T>): T { if (!result.success) throw validationError(); return result.data }

export async function registerVisitorOperationsRoutes(app: FastifyInstance, dependencies: { service: VisitorOperationsService; guards: AuthGuards }) {
  const planningGuard = dependencies.guards.requireRole("EMPLOYEE", "MANAGER", "ADMIN")
  const readGuard = dependencies.guards.requireRole("EMPLOYEE", "MANAGER", "ADMIN", "SECURITY")
  const securityGuard = dependencies.guards.requireRole("SECURITY")
  const adminGuard = dependencies.guards.requireRole("ADMIN")
  const service = dependencies.service

  app.get("/api/visit-types", { preHandler: dependencies.guards.requireAuthentication }, async (request) => service.listVisitTypes(parsed(z.object({ includeInactive: z.enum(["true", "false"]).optional() }).strict().safeParse(request.query)).includeInactive === "true"))
  app.post("/api/visit-types", { preHandler: adminGuard }, async (request, reply) => reply.status(201).send(await service.createVisitType(parsed(z.object({ name: z.string().max(200), active: z.boolean().default(true) }).strict().safeParse(request.body)))))
  app.patch("/api/visit-types/:id", { preHandler: adminGuard }, async (request) => service.updateVisitType(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ name: z.string().max(200), active: z.boolean() }).strict().safeParse(request.body))))
  app.patch("/api/visit-types/:id/status", { preHandler: adminGuard }, async (request) => service.setVisitTypeActive(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ active: z.boolean() }).strict().safeParse(request.body)).active))

  app.get("/api/meetings", { preHandler: readGuard }, async (request) => service.listMeetings(toAccessContext(request.currentUser!)))
  app.get("/api/meetings/:id", { preHandler: planningGuard }, async (request) => service.getVisibleMeeting(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))
  app.get("/api/visits", { preHandler: readGuard }, async (request) => service.listVisits(toAccessContext(request.currentUser!)))
  app.get("/api/visits/reference-data", { preHandler: readGuard }, async (request) => service.getReferenceData(toAccessContext(request.currentUser!)))
  app.get("/api/visits/:id", { preHandler: planningGuard }, async (request) => service.getVisibleVisit(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))
  app.post("/api/meetings", { preHandler: planningGuard }, async (request, reply) => reply.status(201).send(await service.createMeeting(parsed(meetingBody.safeParse(request.body)), toAccessContext(request.currentUser!))))
  app.patch("/api/meetings/:id", { preHandler: planningGuard }, async (request) => service.updateMeeting(parsed(idParams.safeParse(request.params)).id, parsed(meetingBody.safeParse(request.body)), toAccessContext(request.currentUser!)))
  app.patch("/api/visits/:id/reschedule", { preHandler: planningGuard }, async (request) => service.rescheduleVisit(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ plannedStart: timestamp, plannedEnd: timestamp }).strict().safeParse(request.body)), toAccessContext(request.currentUser!)))
  app.post("/api/visits/:id/cancel", { preHandler: planningGuard }, async (request) => service.cancelVisit(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))
  app.post("/api/meetings/:id/cancel", { preHandler: planningGuard }, async (request) => service.cancelMeeting(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))
  app.post("/api/meetings/:id/extend", { preHandler: planningGuard }, async (request) => service.extendMeeting(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ extensionMinutes: z.number().int() }).strict().safeParse(request.body)).extensionMinutes, toAccessContext(request.currentUser!)))
  app.post("/api/meetings/:id/close", { preHandler: planningGuard }, async (request) => service.closeMeeting(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))
  app.post("/api/meetings/:id/invitations", { preHandler: planningGuard }, async (request) => service.sendMeetingInvitations(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))
  app.post("/api/visits/:id/invitation", { preHandler: planningGuard }, async (request) => service.sendVisitInvitation(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))

  app.get("/api/public/invitations/:token", async (request) => service.getPublicPreRegistration(parsed(tokenParams.safeParse(request.params)).token))
  app.patch("/api/public/invitations/:token", async (request) => service.updatePublicPreRegistration(parsed(tokenParams.safeParse(request.params)).token, parsed(publicVisitor.safeParse(request.body))))
  app.post("/api/public/invitations/:token/rule-acceptances", async (request) => service.acceptPublicRule(parsed(tokenParams.safeParse(request.params)).token, request.ip))

  app.get("/api/admin/visitor-rules", { preHandler: adminGuard }, async () => service.listRules())
  app.post("/api/admin/visitor-rules", { preHandler: adminGuard }, async (request, reply) => reply.status(201).send(await service.publishRule(parsed(z.object({ content: z.string().max(4_000) }).strict().safeParse(request.body)).content)))
  app.get("/api/admin/visitor-cards", { preHandler: adminGuard }, async () => service.listCards())
  app.post("/api/admin/visitor-cards", { preHandler: adminGuard }, async (request, reply) => reply.status(201).send(await service.createCard(parsed(z.object({ cardNumber: z.string().max(100) }).strict().safeParse(request.body)).cardNumber)))
  app.patch("/api/admin/visitor-cards/:id", { preHandler: adminGuard }, async (request) => service.updateCard(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ cardNumber: z.string().max(100), active: z.boolean() }).strict().safeParse(request.body))))
  app.patch("/api/admin/visitor-cards/:id/status", { preHandler: adminGuard }, async (request) => service.setCardActive(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ active: z.boolean() }).strict().safeParse(request.body)).active))
  app.post("/api/admin/visitor-cards/:id/mark-lost", { preHandler: adminGuard }, async (request) => service.markCardLost(parsed(idParams.safeParse(request.params)).id))
  app.post("/api/admin/visitor-cards/:id/restore", { preHandler: adminGuard }, async (request) => service.restoreCard(parsed(idParams.safeParse(request.params)).id))

  app.get("/api/security/visitor-cards/available", { preHandler: securityGuard }, async () => service.getAvailableCards())
  app.get("/api/security/visitor-rules/active", { preHandler: securityGuard }, async () => service.getActiveRule())
  app.post("/api/security/visits/:id/check-in", { preHandler: securityGuard }, async (request) => service.checkInVisit(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ visitorCardId: id, vehiclePlate: z.string().max(32).optional(), phone: z.string().max(40).optional() }).strict().safeParse(request.body)), toAccessContext(request.currentUser!)))
  app.post("/api/security/visits/:id/check-out", { preHandler: securityGuard }, async (request) => service.checkOutVisit(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ cardReturned: z.boolean() }).strict().safeParse(request.body)).cardReturned, toAccessContext(request.currentUser!)))
  app.get("/api/security/visitor-card-issues", { preHandler: securityGuard }, async (request) => service.listUnreturnedIssues(toAccessContext(request.currentUser!)))
  app.post("/api/security/visits/:id/late-card-return", { preHandler: securityGuard }, async (request) => service.receiveLateCardReturn(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))
  app.patch("/api/security/visits/:id/correction", { preHandler: securityGuard }, async (request) => service.correctVisitor(parsed(idParams.safeParse(request.params)).id, parsed(z.object({ firstName: z.string().max(100), lastName: z.string().max(100), email: z.string().max(320).optional(), company: z.string().max(200), phone: z.string().max(40).optional(), visitTypeId: id.optional(), hostEmployeeName: z.string().max(200) }).strict().safeParse(request.body)), toAccessContext(request.currentUser!)))
  app.post("/api/security/unplanned-visits", { preHandler: securityGuard }, async (request, reply) => reply.status(201).send(await service.createAndCheckInUnplanned(parsed(z.object({ firstName: z.string().max(100), lastName: z.string().max(100), company: z.string().max(200), hostEmployeeName: z.string().max(200), visitTypeId: id, vehiclePlate: z.string().max(32).optional(), durationMinutes: z.number().int(), visitorCardId: id, rulesAccepted: z.boolean(), companyId: id, facilityId: id }).strict().safeParse(request.body)), toAccessContext(request.currentUser!))))
}
