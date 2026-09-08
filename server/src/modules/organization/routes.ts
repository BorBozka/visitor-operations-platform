import type { FastifyInstance } from "fastify"
import { z } from "zod"

import type { AuthGuards } from "../../auth/auth-guards.js"
import { toAccessContext } from "../../lib/authorization.js"
import { validationError } from "../../lib/api-error.js"
import type { OrganizationKind } from "./types.js"
import { OrganizationService } from "./service.js"

const kindSchema = z.enum(["COMPANY", "FACILITY", "DEPARTMENT", "SECURITY_GATE"])
const idSchema = z.object({ id: z.string().min(1).max(36) }).strict()
const includeInactiveSchema = z.object({ includeInactive: z.enum(["true", "false"]).optional().transform((value) => value === "true") }).strict()
const employeeQuerySchema = includeInactiveSchema.extend({ companyId: z.string().min(1).max(36).optional(), facilityId: z.string().min(1).max(36).optional() }).strict()
const saveSchema = z.object({ parentId: z.string().min(1).max(36).optional(), name: z.string().min(1).max(200), active: z.boolean() }).strict()

const paths: Record<OrganizationKind, string> = { COMPANY: "companies", FACILITY: "facilities", DEPARTMENT: "departments", SECURITY_GATE: "security-gates" }

export async function registerOrganizationRoutes(app: FastifyInstance, dependencies: { service: OrganizationService; guards: AuthGuards }): Promise<void> {
  app.get("/api/organization", { preHandler: dependencies.guards.requireAuthentication }, async (request) => {
    const parsed = includeInactiveSchema.safeParse(request.query)
    if (!parsed.success) throw validationError()
    return dependencies.service.getSnapshot(parsed.data.includeInactive, toAccessContext(request.currentUser!))
  })

  for (const kind of kindSchema.options) {
    const path = `/api/${paths[kind]}`
    app.get(path, { preHandler: dependencies.guards.requireAuthentication }, async (request) => {
      const parsed = includeInactiveSchema.safeParse(request.query)
      if (!parsed.success) throw validationError()
      return dependencies.service.list(kind, parsed.data.includeInactive, toAccessContext(request.currentUser!))
    })
    app.get(`${path}/:id`, { preHandler: dependencies.guards.requireAuthentication }, async (request) => {
      const parsed = idSchema.safeParse(request.params)
      if (!parsed.success) throw validationError()
      return dependencies.service.get(kind, parsed.data.id, toAccessContext(request.currentUser!))
    })
    app.post(path, { preHandler: dependencies.guards.requireRole("ADMIN") }, async (request, reply) => {
      const parsed = saveSchema.safeParse(request.body)
      if (!parsed.success) throw validationError()
      return reply.status(201).send(await dependencies.service.save(kind, parsed.data, toAccessContext(request.currentUser!)))
    })
    app.patch(`${path}/:id`, { preHandler: dependencies.guards.requireRole("ADMIN") }, async (request) => {
      const params = idSchema.safeParse(request.params)
      const body = saveSchema.safeParse(request.body)
      if (!params.success || !body.success) throw validationError()
      return dependencies.service.save(kind, { ...body.data, id: params.data.id }, toAccessContext(request.currentUser!))
    })
  }

  app.get("/api/employees", { preHandler: dependencies.guards.requireAuthentication }, async (request) => {
    const parsed = employeeQuerySchema.safeParse(request.query)
    if (!parsed.success) throw validationError()
    return dependencies.service.listEmployees(parsed.data, toAccessContext(request.currentUser!))
  })
  app.get("/api/employees/:id", { preHandler: dependencies.guards.requireAuthentication }, async (request) => {
    const parsed = idSchema.safeParse(request.params)
    if (!parsed.success) throw validationError()
    return dependencies.service.getEmployee(parsed.data.id, toAccessContext(request.currentUser!))
  })
}
