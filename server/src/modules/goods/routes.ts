import type { FastifyInstance } from "fastify"
import { z } from "zod"

import type { AuthGuards } from "../../auth/auth-guards.js"
import { toAccessContext } from "../../lib/authorization.js"
import { validationError } from "../../lib/api-error.js"
import { GoodsMovementService } from "./service.js"
import { goodsMovementDirections } from "./types.js"

const idParams = z.object({ id: z.string().min(1).max(36) }).strict()
const movementBody = z.object({
  direction: z.enum(goodsMovementDirections),
  companyId: z.string().min(1).max(36),
  facilityId: z.string().min(1).max(36),
  counterpartyName: z.string().max(200),
  plannedDate: z.string().max(10),
  plannedTime: z.string().max(5).optional(),
  goodsDescription: z.string().max(2_000),
  referenceNumber: z.string().max(200).optional(),
  note: z.string().max(2_000).optional(),
}).strict()
const completeBody = z.object({
  companyId: z.string().min(1).max(36),
  facilityId: z.string().min(1).max(36),
  actualPlate: z.string().max(32).optional(),
  actualDriverName: z.string().max(200).optional(),
}).strict()
const unplannedBody = z.object({
  direction: z.enum(goodsMovementDirections),
  companyId: z.string().min(1).max(36),
  facilityId: z.string().min(1).max(36),
  counterpartyName: z.string().max(200),
  goodsDescription: z.string().max(2_000),
  referenceNumber: z.string().max(200).optional(),
  actualPlate: z.string().max(32).optional(),
  actualDriverName: z.string().max(200).optional(),
}).strict()

function parsed<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (!result.success) throw validationError()
  return result.data
}

export async function registerGoodsMovementRoutes(app: FastifyInstance, dependencies: { service: GoodsMovementService; guards: AuthGuards }) {
  const planningGuard = dependencies.guards.requireRole("MANAGER", "ADMIN")
  const createGuard = dependencies.guards.requireRole("EMPLOYEE", "MANAGER", "ADMIN")
  const securityGuard = dependencies.guards.requireRole("SECURITY")
  const service = dependencies.service

  app.get("/api/goods-movements", { preHandler: planningGuard }, async (request) => service.list(toAccessContext(request.currentUser!)))
  app.get("/api/goods-movements/mine", { preHandler: createGuard }, async (request) =>
    service.listOwn(toAccessContext(request.currentUser!)))
  app.post("/api/goods-movements", { preHandler: createGuard }, async (request, reply) =>
    reply.status(201).send(await service.create(parsed(movementBody.safeParse(request.body)), toAccessContext(request.currentUser!))))
  app.patch("/api/goods-movements/:id", { preHandler: planningGuard }, async (request) =>
    service.update(parsed(idParams.safeParse(request.params)).id, parsed(movementBody.safeParse(request.body)), toAccessContext(request.currentUser!)))
  app.post("/api/goods-movements/:id/cancel", { preHandler: planningGuard }, async (request) =>
    service.cancel(parsed(idParams.safeParse(request.params)).id, toAccessContext(request.currentUser!)))

  app.get("/api/security/goods-movements", { preHandler: securityGuard }, async (request) =>
    service.listSecurityOperational(request.currentUser!.id))
  app.post("/api/security/goods-movements/unplanned", { preHandler: securityGuard }, async (request, reply) =>
    reply.status(201).send(await service.createUnplanned(parsed(unplannedBody.safeParse(request.body)), request.currentUser!.id)))
  app.post("/api/security/goods-movements/:id/complete", { preHandler: securityGuard }, async (request) =>
    service.complete(parsed(idParams.safeParse(request.params)).id, request.currentUser!.id, parsed(completeBody.safeParse(request.body))))
}
