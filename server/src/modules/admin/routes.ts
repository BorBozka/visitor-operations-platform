import type { FastifyInstance } from "fastify"
import { z } from "zod"

import type { AuthGuards } from "../../auth/auth-guards.js"
import { toAccessContext } from "../../lib/authorization.js"
import { validationError } from "../../lib/api-error.js"
import { applicationRoles } from "./types.js"
import { AdminService } from "./service.js"

const idSchema = z.object({ id: z.string().min(1).max(36) }).strict()
const scopeSchema = z.object({ companyIds: z.array(z.string().min(1).max(36)).max(100), facilityIds: z.array(z.string().min(1).max(36)).max(100), securityGateIds: z.array(z.string().min(1).max(36)).max(100) }).strict()
const createSchema = z.object({ fullName: z.string().min(1).max(200), username: z.string().min(1).max(100), email: z.string().email().max(320), password: z.string().min(8).max(1024), role: z.enum(applicationRoles), authorizationScope: scopeSchema, active: z.boolean() }).strict()
const updateSchema = z.object({ fullName: z.string().min(1).max(200).optional(), username: z.string().min(1).max(100).optional(), email: z.string().email().max(320).optional(), role: z.enum(applicationRoles).optional(), authorizationScope: scopeSchema.optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0)
const passwordSchema = z.object({ password: z.string().min(8).max(1024) }).strict()

export async function registerAdminRoutes(app: FastifyInstance, dependencies: { service: AdminService; guards: AuthGuards }): Promise<void> {
  const guard = dependencies.guards.requireRole("ADMIN")
  app.get("/api/admin/users", { preHandler: guard }, (request) => dependencies.service.listUsers(toAccessContext(request.currentUser!)))
  app.get("/api/admin/users/:id", { preHandler: guard }, async (request) => { const parsed = idSchema.safeParse(request.params); if (!parsed.success) throw validationError(); return dependencies.service.getUser(parsed.data.id, toAccessContext(request.currentUser!)) })
  app.post("/api/admin/users", { preHandler: guard }, async (request, reply) => { const parsed = createSchema.safeParse(request.body); if (!parsed.success) throw validationError(); return reply.status(201).send(await dependencies.service.createUser(parsed.data, toAccessContext(request.currentUser!))) })
  app.patch("/api/admin/users/:id", { preHandler: guard }, async (request) => { const params = idSchema.safeParse(request.params); const body = updateSchema.safeParse(request.body); if (!params.success || !body.success) throw validationError(); return dependencies.service.updateUser(params.data.id, body.data, toAccessContext(request.currentUser!)) })
  app.patch("/api/admin/users/:id/status", { preHandler: guard }, async (request) => { const params = idSchema.safeParse(request.params); const body = z.object({ active: z.boolean() }).strict().safeParse(request.body); if (!params.success || !body.success) throw validationError(); return dependencies.service.updateUser(params.data.id, body.data, toAccessContext(request.currentUser!)) })
  app.patch("/api/admin/users/:id/role", { preHandler: guard }, async (request) => { const params = idSchema.safeParse(request.params); const body = z.object({ role: z.enum(applicationRoles) }).strict().safeParse(request.body); if (!params.success || !body.success) throw validationError(); return dependencies.service.updateUser(params.data.id, body.data, toAccessContext(request.currentUser!)) })
  app.put("/api/admin/users/:id/scopes", { preHandler: guard }, async (request) => { const params = idSchema.safeParse(request.params); const body = scopeSchema.safeParse(request.body); if (!params.success || !body.success) throw validationError(); return dependencies.service.updateUser(params.data.id, { authorizationScope: body.data }, toAccessContext(request.currentUser!)) })
  app.post("/api/admin/users/:id/reset-password", { preHandler: guard }, async (request, reply) => { const params = idSchema.safeParse(request.params); const body = passwordSchema.safeParse(request.body); if (!params.success || !body.success) throw validationError(); await dependencies.service.resetLocalUserPassword(params.data.id, body.data.password, toAccessContext(request.currentUser!)); return reply.status(204).send() })
}
