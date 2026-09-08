import type { FastifyInstance } from "fastify"
import { z } from "zod"

import type { AuthGuards } from "../../auth/auth-guards.js"
import type { AuthService } from "../../auth/auth-service.js"
import { ApiError, validationError } from "../../lib/api-error.js"

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1_024),
  newPassword: z.string().min(8).max(1_024),
}).strict()

export async function registerAccountRoutes(app: FastifyInstance, dependencies: { authService: AuthService; guards: AuthGuards; sessionCookieName: string }): Promise<void> {
  app.post("/api/account/change-password", { preHandler: dependencies.guards.requireAuthentication }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body)
    if (!parsed.success) throw validationError()

    try {
      await dependencies.authService.changePassword(
        request.currentUser!.id,
        parsed.data.currentPassword,
        parsed.data.newPassword,
        request.cookies[dependencies.sessionCookieName]!,
      )
    } catch (error) {
      if (error instanceof Error && error.message === "CURRENT_PASSWORD_INVALID") {
        throw new ApiError(400, "CURRENT_PASSWORD_INVALID", "Mevcut şifre hatalı.")
      }
      throw error
    }

    return reply.status(204).send()
  })
}
