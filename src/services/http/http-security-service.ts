import { apiClient } from "@/lib/http"
import type { VisitorCardInventoryItem, VisitorRuleVersion } from "@/domain/admin"
import type { Visit } from "@/domain/visits"
import type {
  CreateUnplannedVisitInput,
  SecurityCardIssue,
  SecurityCheckInInput,
  SecurityCheckOutInput,
  SecurityService,
  SecurityVisitorCorrectionInput,
} from "@/services/security-service"
import {
  mapVisit,
  mapVisitorCard,
  mapVisitorRule,
  type VisitDto,
  type VisitorCardDto,
  type VisitorRuleDto,
} from "@/services/http/mappers"

/**
 * Security desk adapter. The acting Security user and their scope come from the session, so
 * `creatorEmployeeId` and any client scope context are not sent; the server re-verifies scope
 * on every operation.
 */
export class HttpSecurityService implements SecurityService {
  async getAvailableVisitorCards(): Promise<VisitorCardInventoryItem[]> {
    return (await apiClient.get<VisitorCardDto[]>("/security/visitor-cards/available")).map(mapVisitorCard)
  }

  async getActiveVisitorRule(): Promise<VisitorRuleVersion | null> {
    const dto = await apiClient.get<VisitorRuleDto | null>("/security/visitor-rules/active")
    return dto ? mapVisitorRule(dto) : null
  }

  async createAndCheckInUnplannedVisit(input: CreateUnplannedVisitInput): Promise<Visit> {
    const { creatorEmployeeId: _creatorEmployeeId, ...body } = input
    void _creatorEmployeeId
    return mapVisit(await apiClient.post<VisitDto>("/security/unplanned-visits", body))
  }

  async checkInVisit(input: SecurityCheckInInput): Promise<Visit> {
    return mapVisit(
      await apiClient.post<VisitDto>(`/security/visits/${encodeURIComponent(input.visitId)}/check-in`, {
        visitorCardId: input.visitorCardId,
        vehiclePlate: input.vehiclePlate,
        phone: input.phone,
      }),
    )
  }

  async checkOutVisit(input: SecurityCheckOutInput): Promise<Visit> {
    return mapVisit(
      await apiClient.post<VisitDto>(`/security/visits/${encodeURIComponent(input.visitId)}/check-out`, {
        cardReturned: input.cardReturned,
      }),
    )
  }

  async getUnreturnedVisitorCardIssues(): Promise<SecurityCardIssue[]> {
    const rows = await apiClient.get<{ card: VisitorCardDto; visit: VisitDto }[]>("/security/visitor-card-issues")
    return rows.map((row) => ({ card: mapVisitorCard(row.card), visit: mapVisit(row.visit) }))
  }

  async receiveReturnedVisitorCard(visitId: string): Promise<Visit> {
    return mapVisit(await apiClient.post<VisitDto>(`/security/visits/${encodeURIComponent(visitId)}/late-card-return`))
  }

  async correctVisitor(visitId: string, input: SecurityVisitorCorrectionInput): Promise<Visit> {
    return mapVisit(
      await apiClient.patch<VisitDto>(`/security/visits/${encodeURIComponent(visitId)}/correction`, {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        company: input.company,
        phone: input.phone,
        hostEmployeeName: input.hostEmployeeName,
      }),
    )
  }
}
