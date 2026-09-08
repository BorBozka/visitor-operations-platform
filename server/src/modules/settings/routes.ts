import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AuthGuards } from "../../auth/auth-guards.js"
import { validationError } from "../../lib/api-error.js"
import { SettingsService } from "./service.js"

const settingsSchema = z.object({ overdueToleranceMinutes: z.number().int().min(0), overdueAlertRepeatMinutes: z.number().int().min(1), workdayEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict()
export async function registerSettingsRoutes(app: FastifyInstance, dependencies: { service: SettingsService; guards: AuthGuards }) {
  app.get("/api/settings/operational", { preHandler: dependencies.guards.requireAuthentication }, () => dependencies.service.getOperationalSettings())
  app.put("/api/settings/operational", { preHandler: dependencies.guards.requireRole("ADMIN") }, async (request) => { const parsed = settingsSchema.safeParse(request.body); if (!parsed.success) throw validationError(); return dependencies.service.saveOperationalSettings(parsed.data) })
}
