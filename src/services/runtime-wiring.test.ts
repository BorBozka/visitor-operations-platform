import { describe, expect, it } from "vitest"

import { accountService, adminService, goodsMovementService, reportsService, resourceAssignmentService, resourceCatalogService, securityService, sessionService, transportAssignmentService, visitService } from "@/services"
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

describe("application runtime wiring", () => {
  it("exports only Http-backed service singletons", () => {
    expect(visitService).toBeInstanceOf(HttpVisitService)
    expect(resourceCatalogService).toBeInstanceOf(HttpResourceCatalogService)
    expect(resourceAssignmentService).toBeInstanceOf(HttpResourceAssignmentService)
    expect(transportAssignmentService).toBeInstanceOf(HttpTransportAssignmentService)
    expect(goodsMovementService).toBeInstanceOf(HttpGoodsMovementService)
    expect(adminService).toBeInstanceOf(HttpAdminService)
    expect(securityService).toBeInstanceOf(HttpSecurityService)
    expect(accountService).toBeInstanceOf(HttpAccountService)
    expect(sessionService).toBeInstanceOf(HttpSessionService)
    expect(reportsService).toBeInstanceOf(HttpReportsService)
  })
})
