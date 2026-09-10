import Fastify from "fastify"

import { createAuthGuards } from "./auth/auth-guards.js"
import { AuthService } from "./auth/auth-service.js"
import type { AppConfig } from "./config/env.js"
import { ApiError, invalidRequestBodyError, payloadTooLargeError, rateLimitedError, unsupportedMediaTypeError } from "./lib/api-error.js"
import { registerAccountRoutes } from "./modules/account/routes.js"
import { registerAuthRoutes } from "./modules/auth/routes.js"
import { registerHealthRoutes } from "./modules/health/routes.js"
import { registerOrganizationRoutes } from "./modules/organization/routes.js"
import { OrganizationService } from "./modules/organization/service.js"
import { registerAdminRoutes } from "./modules/admin/routes.js"
import { AdminService } from "./modules/admin/service.js"
import { registerSettingsRoutes } from "./modules/settings/routes.js"
import { SettingsService } from "./modules/settings/service.js"
import { registerResourceRoutes } from "./modules/resources/routes.js"
import { ResourceService } from "./modules/resources/service.js"
import { registerVisitorOperationsRoutes } from "./modules/visitor-operations/routes.js"
import { VisitorOperationsService } from "./modules/visitor-operations/service.js"
import { registerGoodsMovementRoutes } from "./modules/goods/routes.js"
import { GoodsMovementService } from "./modules/goods/service.js"
import { registerResourceAssignmentRoutes } from "./modules/resource-assignments/routes.js"
import { ResourceAssignmentService } from "./modules/resource-assignments/service.js"
import { registerTransportAssignmentRoutes } from "./modules/transport-assignments/routes.js"
import { TransportAssignmentService } from "./modules/transport-assignments/service.js"
import { registerReportsRoutes } from "./modules/reports/routes.js"
import { ReportsService } from "./modules/reports/service.js"
import { RateLimitError, registerSecurityPlugins } from "./plugins/security.js"
import type { EmailSender } from "./delivery/email-sender.js"
import type { AuthRepository } from "./repositories/auth-repository.js"
import type { OrganizationRepository } from "./repositories/organization-repository.js"
import type { AdminRepository } from "./repositories/admin-repository.js"
import type { SettingsRepository } from "./repositories/settings-repository.js"
import type { ResourceRepository } from "./repositories/resource-repository.js"
import type { VisitorOperationsRepository } from "./repositories/visitor-operations-repository.js"
import type { GoodsMovementRepository } from "./repositories/goods-movement-repository.js"
import type { ResourceAssignmentRepository } from "./repositories/resource-assignment-repository.js"
import type { TransportAssignmentRepository } from "./repositories/transport-assignment-repository.js"
import type { ReportsRepository } from "./repositories/reports-repository.js"

/** Only the error branded by the rate-limit plugin adapter may become RATE_LIMITED. */
function isRateLimitError(error: unknown): boolean {
  return error instanceof RateLimitError && error.statusCode === 429
}

/**
 * Fastify's own content-type/body parsing errors, raised before any route or Zod schema runs.
 * Each entry pins the framework `code` to the status Fastify 5 documents for it, so a code whose
 * carried `statusCode` does not match the expected one falls through to the generic 500 instead of
 * letting an error object dictate the response status.
 */
const FRAMEWORK_CLIENT_ERRORS: Record<string, { statusCode: number; toApiError: () => ApiError }> = {
  FST_ERR_CTP_INVALID_JSON_BODY: { statusCode: 400, toApiError: invalidRequestBodyError },
  FST_ERR_CTP_EMPTY_JSON_BODY: { statusCode: 400, toApiError: invalidRequestBodyError },
  FST_ERR_CTP_BODY_TOO_LARGE: { statusCode: 413, toApiError: payloadTooLargeError },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { statusCode: 415, toApiError: unsupportedMediaTypeError },
}

function frameworkClientError(error: unknown): ApiError | null {
  if (!(error instanceof Error)) return null
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown }
  if (typeof code !== "string") return null
  const mapping = FRAMEWORK_CLIENT_ERRORS[code]
  return mapping && statusCode === mapping.statusCode ? mapping.toApiError() : null
}

export interface AppDependencies {
  authRepository: AuthRepository
  organizationRepository?: OrganizationRepository
  adminRepository?: AdminRepository
  settingsRepository?: SettingsRepository
  resourceRepository?: ResourceRepository
  visitorOperationsRepository?: VisitorOperationsRepository
  goodsMovementRepository?: GoodsMovementRepository
  resourceAssignmentRepository?: ResourceAssignmentRepository
  transportAssignmentRepository?: TransportAssignmentRepository
  reportsRepository?: ReportsRepository
  emailSender?: EmailSender
  checkDatabase?: () => Promise<void>
  authService?: AuthService
}

export async function buildApp(config: AppConfig, dependencies: AppDependencies) {
  const app = Fastify({
    logger: config.nodeEnv === "production",
    bodyLimit: 1_048_576,
    // Off by default: request.ip stays the socket peer, so forwarding headers cannot be spoofed.
    // Behind a reverse proxy TRUST_PROXY names the trusted hops, and request.ip — which the login
    // rate limiter keys on and rule acceptances audit — resolves to the real client.
    trustProxy: config.trustProxy,
  })
  const authService = dependencies.authService ?? new AuthService(dependencies.authRepository, { sessionTtlHours: config.sessionTtlHours })

  app.decorateRequest("currentUser", null)
  await registerSecurityPlugins(app, config)

  // `@fastify/rate-limit` raises a throttled request through the branded adapter configured in
  // `registerSecurityPlugins`; only that branded 429 is mapped to RATE_LIMITED. Fastify's own body-parser
  // and content-type errors have the same problem: they are raised before the route (and its Zod
  // schema) ever runs, and carry a genuine client status the app was discarding. Both are mapped
  // onto the app's own envelope through explicit allow-lists — the rate-limit status, and the
  // named framework error codes above; the plugin's `retry-after`/`x-ratelimit-*` headers are
  // already on the reply and are left untouched. Every other non-`ApiError` stays generic: the
  // status a stray exception happens to carry is not a contract we vouch for.
  app.setErrorHandler((error, request, reply) => {
    const handled = error instanceof ApiError ? error : isRateLimitError(error) ? rateLimitedError() : frameworkClientError(error)
    if (handled) return reply.status(handled.statusCode).send({ error: { code: handled.code, message: handled.message } })
    request.log.error(error)
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Beklenmeyen bir sunucu hatası oluştu." } })
  })

  const guards = createAuthGuards(authService, config)
  await registerAuthRoutes(app, { authService, config })
  await registerAccountRoutes(app, { authService, guards, sessionCookieName: config.sessionCookieName })
  await registerHealthRoutes(app, dependencies.checkDatabase ?? (async () => undefined))
  if (dependencies.organizationRepository) await registerOrganizationRoutes(app, { service: new OrganizationService(dependencies.organizationRepository), guards })
  if (dependencies.adminRepository) await registerAdminRoutes(app, { service: new AdminService(dependencies.adminRepository, dependencies.authRepository), guards })
  if (dependencies.settingsRepository) await registerSettingsRoutes(app, { service: new SettingsService(dependencies.settingsRepository), guards })
  if (dependencies.resourceRepository) await registerResourceRoutes(app, { service: new ResourceService(dependencies.resourceRepository), guards })
  if (dependencies.visitorOperationsRepository && dependencies.emailSender) {
    await registerVisitorOperationsRoutes(app, { service: new VisitorOperationsService(dependencies.visitorOperationsRepository, dependencies.emailSender, config.webOrigin), guards })
  }
  if (dependencies.goodsMovementRepository) {
    await registerGoodsMovementRoutes(app, { service: new GoodsMovementService(dependencies.goodsMovementRepository), guards })
  }
  if (dependencies.resourceAssignmentRepository) {
    await registerResourceAssignmentRoutes(app, { service: new ResourceAssignmentService(dependencies.resourceAssignmentRepository), guards })
  }
  if (dependencies.transportAssignmentRepository) {
    await registerTransportAssignmentRoutes(app, { service: new TransportAssignmentService(dependencies.transportAssignmentRepository), guards })
  }
  if (dependencies.reportsRepository) {
    await registerReportsRoutes(app, { service: new ReportsService(dependencies.reportsRepository), guards })
  }

  return app
}
