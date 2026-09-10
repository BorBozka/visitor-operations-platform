/**
 * Server DTO -> frontend domain mapping for the HTTP service adapters.
 *
 * The backend deliberately returns frontend-shaped payloads. Only the transforms that actually
 * differ live here: flattening the nested `meeting` a `Visit` carries, narrowing an optional
 * `hostEmployeeId` to `""`, dropping server-only bookkeeping (`createdAt`/`updatedAt` on lookup
 * records, the `id` on a rule-acceptance snapshot), and supplying a neutral `currentEmployee`
 * for an Admin session that has no Employee row. Resource / goods / transport payloads are
 * already identical to their domain types and are consumed directly by the adapters.
 */
import type {
  AdminUser,
  OperationalSettings,
  OrganizationEntity,
  VisitTypeDefinition,
  VisitorCardInventoryItem,
  VisitorRuleVersion,
} from "@/domain/admin"
import type { Meeting, Visit, MeetingWithVisits, VisitReferenceData } from "@/domain/visits"

/* ----------------------------- Visit / Meeting ----------------------------- */

/** Server `MeetingDto` — the meeting shape shared by a standalone `Meeting` and `visit.meeting`. */
export interface MeetingDto {
  id: string
  creatorEmployeeId: string
  visitTypeId: string
  visitTypeName: string
  hostEmployeeId?: string
  hostEmployeeName: string
  hostCompanyId: string
  hostCompanyName: string
  facilityId: string
  facilityName: string
  plannedStart: string
  plannedEnd: string
  note?: string
  hasAdditionalRequirements: boolean
  additionalRequirementNote?: string
  actualMeetingEnd?: string
  meetingEndSource?: "MANUAL" | "VISITOR_CHECK_OUT"
  createdAt: string
  updatedAt: string
}

export interface VisitDto {
  id: string
  meetingId: string
  visitor: { id: string; firstName: string; lastName: string; email?: string; company: string; phone?: string }
  actualCheckIn?: string
  actualCheckOut?: string
  visitorCardReturned?: boolean
  visitorCardId?: string
  visitorCardNumber?: string
  vehiclePlate?: string
  status: Visit["status"]
  invitationStatus: Visit["invitationStatus"]
  invitationSendStale?: boolean
  invitationSentAt?: string
  invitationError?: string
  cancelledAt?: string
  createdAt: string
  updatedAt: string
  ruleAcceptance?: {
    id: string
    ruleId: string
    ruleVersion: number
    acceptedAt: string
    method: "INVITATION_LINK" | "SECURITY_DESK"
    contentSnapshot: string
  }
  hostCorrectedFrom?: string
  hostCorrectedAt?: string
  hostCorrectedBy?: string
  meeting: MeetingDto
}

export interface MeetingWithVisitsDto {
  meeting: MeetingDto
  visits: VisitDto[]
}

export function mapMeeting(dto: MeetingDto): Meeting {
  return {
    id: dto.id,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    ...meetingDetails(dto),
  }
}

function meetingDetails(dto: MeetingDto) {
  return {
    creatorEmployeeId: dto.creatorEmployeeId,
    visitTypeId: dto.visitTypeId,
    visitTypeName: dto.visitTypeName,
    // A security-desk unplanned meeting has no linked host employee; "" grants no host permission.
    hostEmployeeId: dto.hostEmployeeId ?? "",
    hostEmployeeName: dto.hostEmployeeName,
    hostCompanyId: dto.hostCompanyId,
    hostCompanyName: dto.hostCompanyName,
    facilityId: dto.facilityId,
    facilityName: dto.facilityName,
    plannedStart: dto.plannedStart,
    plannedEnd: dto.plannedEnd,
    note: dto.note,
    hasAdditionalRequirements: dto.hasAdditionalRequirements,
    additionalRequirementNote: dto.additionalRequirementNote,
    actualMeetingEnd: dto.actualMeetingEnd,
    meetingEndSource: dto.meetingEndSource,
  }
}

export function mapVisit(dto: VisitDto): Visit {
  return {
    id: dto.id,
    meetingId: dto.meetingId,
    visitor: { ...dto.visitor },
    actualCheckIn: dto.actualCheckIn,
    actualCheckOut: dto.actualCheckOut,
    visitorCardReturned: dto.visitorCardReturned,
    visitorCardId: dto.visitorCardId,
    visitorCardNumber: dto.visitorCardNumber,
    vehiclePlate: dto.vehiclePlate,
    ruleAcceptance: dto.ruleAcceptance
      ? {
          ruleId: dto.ruleAcceptance.ruleId,
          ruleVersion: dto.ruleAcceptance.ruleVersion,
          acceptedAt: dto.ruleAcceptance.acceptedAt,
          method: dto.ruleAcceptance.method,
          contentSnapshot: dto.ruleAcceptance.contentSnapshot,
        }
      : undefined,
    hostCorrectedFrom: dto.hostCorrectedFrom,
    hostCorrectedAt: dto.hostCorrectedAt,
    hostCorrectedBy: dto.hostCorrectedBy,
    status: dto.status,
    invitationStatus: dto.invitationStatus,
    invitationSendStale: dto.invitationSendStale,
    invitationSentAt: dto.invitationSentAt,
    invitationError: dto.invitationError,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    cancelledAt: dto.cancelledAt,
    ...meetingDetails(dto.meeting),
  }
}

export function mapMeetingWithVisits(dto: MeetingWithVisitsDto): MeetingWithVisits {
  return { meeting: mapMeeting(dto.meeting), visits: dto.visits.map(mapVisit) }
}

export interface ReferenceDataDto {
  companies: { id: string; name: string }[]
  facilities: { id: string; companyId: string; name: string }[]
  employees: { id: string; companyId: string; facilityIds: string[]; name: string; departmentId: string; department: string }[]
  visitTypes: { id: string; name: string; active: boolean }[]
  currentEmployee: { employeeId: string; companyId: string; facilityId: string; role: "EMPLOYEE" | "MANAGER" } | null
}

export function mapReferenceData(dto: ReferenceDataDto): VisitReferenceData {
  return {
    companies: dto.companies,
    facilities: dto.facilities,
    employees: dto.employees,
    visitTypes: dto.visitTypes.map((type) => ({ id: type.id, name: type.name, active: type.active })),
    // An Admin session has no Employee row; visibility helpers treat "" as "owns nothing".
    currentEmployee: dto.currentEmployee ?? { employeeId: "", companyId: "", facilityId: "", role: "MANAGER" },
  }
}

/* --------------------------------- Admin --------------------------------- */

export interface AdminUserDto {
  id: string
  fullName: string
  username: string
  email: string
  authenticationSource: "LOCAL" | "ACTIVE_DIRECTORY"
  role: AdminUser["role"]
  authorizationScope: { companyIds: string[]; facilityIds: string[]; securityGateIds: string[] }
  active: boolean
  createdAt: string
  updatedAt: string
}

export function mapAdminUser(dto: AdminUserDto): AdminUser {
  return {
    id: dto.id,
    fullName: dto.fullName,
    username: dto.username,
    email: dto.email,
    authenticationSource: dto.authenticationSource,
    role: dto.role,
    authorizationScope: dto.authorizationScope,
    active: dto.active,
  }
}

export interface OrganizationEntityDto {
  id: string
  parentId?: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface OrganizationSnapshotDto {
  companies: OrganizationEntityDto[]
  facilities: OrganizationEntityDto[]
  departments: OrganizationEntityDto[]
  securityGates: OrganizationEntityDto[]
}

export function mapOrganizationEntity(dto: OrganizationEntityDto): OrganizationEntity {
  return { id: dto.id, parentId: dto.parentId, name: dto.name, active: dto.active }
}

/** Facilities, departments and security gates always carry a parent id in the backend response. */
export function mapOrganizationChild(dto: OrganizationEntityDto): OrganizationEntity & { parentId: string } {
  if (!dto.parentId) throw new Error(`Organizasyon kaydı üst kayıt bilgisi olmadan döndü: ${dto.id}`)
  return { id: dto.id, parentId: dto.parentId, name: dto.name, active: dto.active }
}

export interface VisitTypeDto {
  id: string
  name: string
  active: boolean
  createdAt?: string
  updatedAt?: string
}

export function mapVisitType(dto: VisitTypeDto): VisitTypeDefinition {
  return { id: dto.id, name: dto.name, active: dto.active }
}

export interface VisitorCardDto {
  id: string
  cardNumber: string
  status: VisitorCardInventoryItem["status"]
  assignedVisitId?: string
  assignedVisitorName?: string
  createdAt?: string
  updatedAt?: string
}

export function mapVisitorCard(dto: VisitorCardDto): VisitorCardInventoryItem {
  return {
    id: dto.id,
    cardNumber: dto.cardNumber,
    status: dto.status,
    assignedVisitId: dto.assignedVisitId,
    assignedVisitorName: dto.assignedVisitorName,
  }
}

export interface VisitorRuleDto {
  id: string
  version: number
  content: string
  publishedAt: string
  active: boolean
}

export function mapVisitorRule(dto: VisitorRuleDto): VisitorRuleVersion {
  return { id: dto.id, version: dto.version, content: dto.content, publishedAt: dto.publishedAt, active: dto.active }
}

export interface OperationalSettingsDto {
  overdueToleranceMinutes: number
  overdueAlertRepeatMinutes: number
  workdayEndTime: string
  updatedAt?: string
}

export function mapOperationalSettings(dto: OperationalSettingsDto): OperationalSettings {
  return {
    overdueToleranceMinutes: dto.overdueToleranceMinutes,
    overdueAlertRepeatMinutes: dto.overdueAlertRepeatMinutes,
    workdayEndTime: dto.workdayEndTime,
  }
}
