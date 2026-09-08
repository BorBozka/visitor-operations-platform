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
import type { AccountService } from "@/services/account-service"
import type { AdminService } from "@/services/admin-service"
import type { GoodsMovementService } from "@/services/goods-movement-service"
import type { ReportsService } from "@/services/reports-service"
import type { ResourceAssignmentService } from "@/services/resource-assignment-service"
import type { ResourceCatalogService } from "@/services/resource-catalog-service"
import type { SecurityService } from "@/services/security-service"
import type { SessionService } from "@/services/session-service"
import type { TransportAssignmentService } from "@/services/transport-assignment-service"
import type { VisitService } from "@/services/visit-service"

export interface RuntimeServices {
  visitService: VisitService
  resourceCatalogService: ResourceCatalogService
  resourceAssignmentService: ResourceAssignmentService
  transportAssignmentService: TransportAssignmentService
  goodsMovementService: GoodsMovementService
  adminService: AdminService
  securityService: SecurityService
  accountService: AccountService
  sessionService: SessionService
  reportsService: ReportsService
}

export function createRuntimeServices(): RuntimeServices {
  return {
    visitService: new HttpVisitService(),
    resourceCatalogService: new HttpResourceCatalogService(),
    resourceAssignmentService: new HttpResourceAssignmentService(),
    transportAssignmentService: new HttpTransportAssignmentService(),
    goodsMovementService: new HttpGoodsMovementService(),
    adminService: new HttpAdminService(),
    securityService: new HttpSecurityService(),
    accountService: new HttpAccountService(),
    sessionService: new HttpSessionService(),
    reportsService: new HttpReportsService(),
  }
}
