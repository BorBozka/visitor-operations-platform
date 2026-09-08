import { describe, expect, it } from "vitest"

import { HttpAccountService } from "@/services/http/http-account-service"
import { HttpAdminService } from "@/services/http/http-admin-service"
import { HttpGoodsMovementService } from "@/services/http/http-goods-movement-service"
import { HttpReportsService } from "@/services/http/http-reports-service"
import { HttpResourceAssignmentService } from "@/services/http/http-resource-assignment-service"
import { HttpResourceCatalogService } from "@/services/http/http-resource-catalog-service"
import { HttpSecurityService } from "@/services/http/http-security-service"
import { HttpSessionService } from "@/services/http/http-session-service"
import { HttpTransportAssignmentService } from "@/services/http/http-transport-assignment-service"
import { HttpVisitService } from "@/services/http/http-visit-service"
import { createRuntimeServices, type RuntimeServices } from "@/services/runtime-services"

const serviceKeys = [
  "visitService",
  "resourceCatalogService",
  "resourceAssignmentService",
  "transportAssignmentService",
  "goodsMovementService",
  "adminService",
  "securityService",
  "accountService",
  "sessionService",
  "reportsService",
] satisfies (keyof RuntimeServices)[]

describe("runtime service composition", () => {
  it("instantiates every application service as an Http adapter", () => {
    const services = createRuntimeServices()

    expect(Object.keys(services).sort()).toEqual([...serviceKeys].sort())
    expect(services.visitService).toBeInstanceOf(HttpVisitService)
    expect(services.resourceCatalogService).toBeInstanceOf(HttpResourceCatalogService)
    expect(services.resourceAssignmentService).toBeInstanceOf(HttpResourceAssignmentService)
    expect(services.transportAssignmentService).toBeInstanceOf(HttpTransportAssignmentService)
    expect(services.goodsMovementService).toBeInstanceOf(HttpGoodsMovementService)
    expect(services.adminService).toBeInstanceOf(HttpAdminService)
    expect(services.securityService).toBeInstanceOf(HttpSecurityService)
    expect(services.accountService).toBeInstanceOf(HttpAccountService)
    expect(services.sessionService).toBeInstanceOf(HttpSessionService)
    expect(services.reportsService).toBeInstanceOf(HttpReportsService)
  })
})
