export const visitStatuses = ["PLANNED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"] as const
export type VisitStatus = (typeof visitStatuses)[number]
export const invitationStatuses = ["NOT_SENT", "SENDING", "SENT", "FAILED"] as const
export type InvitationStatus = (typeof invitationStatuses)[number]
export const visitorCardStatuses = ["AVAILABLE", "IN_USE", "NOT_RETURNED", "LOST", "DISABLED"] as const
export type VisitorCardStatus = (typeof visitorCardStatuses)[number]
export const ruleAcceptanceMethods = ["INVITATION_LINK", "SECURITY_DESK"] as const
export type RuleAcceptanceMethod = (typeof ruleAcceptanceMethods)[number]

export interface VisitorDto {
  id: string
  firstName: string
  lastName: string
  email?: string
  company: string
  phone?: string
}

export interface RuleAcceptanceDto {
  id: string
  ruleId: string
  ruleVersion: number
  acceptedAt: string
  method: RuleAcceptanceMethod
  contentSnapshot: string
}

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
  visitor: VisitorDto
  actualCheckIn?: string
  actualCheckOut?: string
  visitorCardReturned?: boolean
  visitorCardId?: string
  visitorCardNumber?: string
  vehiclePlate?: string
  status: VisitStatus
  invitationStatus: InvitationStatus
  /**
   * Only present on a `SENDING` visit whose send attempt is old enough to be treated as
   * abandoned. The server owns this decision (see `invitation-staleness.ts`) so no client has to
   * date-compare a send attempt itself; a client may use it to offer the retry that a permanently
   * `SENDING` record would otherwise never get.
   */
  invitationSendStale?: boolean
  invitationSentAt?: string
  invitationError?: string
  cancelledAt?: string
  createdAt: string
  updatedAt: string
  ruleAcceptance?: RuleAcceptanceDto
  hostCorrectedFrom?: string
  hostCorrectedAt?: string
  hostCorrectedBy?: string
  meeting: MeetingDto
}

export interface MeetingWithVisitsDto { meeting: MeetingDto; visits: VisitDto[] }

export interface VisitTypeDto { id: string; name: string; active: boolean; createdAt: string; updatedAt: string }
export interface VisitorCardDto { id: string; cardNumber: string; status: VisitorCardStatus; assignedVisitId?: string; assignedVisitorName?: string; createdAt: string; updatedAt: string }
export interface VisitorRuleDto { id: string; version: number; content: string; publishedAt: string; active: boolean }

export interface VisitorInput { visitId?: string; firstName: string; lastName: string; email?: string; company: string; phone?: string }
export interface MeetingInput {
  visitors: VisitorInput[]
  visitTypeId: string
  hostEmployeeId?: string
  hostEmployeeName: string
  hostCompanyId: string
  facilityId: string
  plannedStart: string
  plannedEnd: string
  note?: string
  hasAdditionalRequirements?: boolean
  additionalRequirementNote?: string
}

export interface SecurityCheckInInput { visitorCardId: string; vehiclePlate?: string; phone?: string }
export interface SecurityCorrectionInput { firstName: string; lastName: string; email?: string; company: string; phone?: string; hostEmployeeName: string }
export interface CreateUnplannedInput {
  firstName: string; lastName: string; company: string; hostEmployeeName: string; visitTypeId: string
  vehiclePlate?: string; durationMinutes: number; visitorCardId: string; rulesAccepted: boolean; companyId: string; facilityId: string
}

export interface PublicPreRegistrationDto {
  visitor: VisitorDto
  visit: { plannedStart: string; plannedEnd: string; visitTypeName: string; facilityName: string; hostEmployeeName: string; vehiclePlate?: string }
  activeRule: VisitorRuleDto | null
}

export interface EmployeeActor { id: string; userId: string | null; fullName: string; companyId: string; facilityIds: string[]; email?: string; role?: "EMPLOYEE" | "MANAGER" | "SECURITY" | "ADMIN" }

export function parseEnum<T extends readonly string[]>(values: T, value: string, name: string): T[number] {
  const parsed = values.find((item) => item === value)
  if (!parsed) throw new Error(`Unsupported persisted ${name}: ${value}`)
  return parsed
}

export function normalizeVisitTypeName(value: string) { return value.trim().toLocaleLowerCase("tr-TR") }
export function normalizeCardNumber(value: string) { return value.trim().toLowerCase() }
export function normalizeOptional(value: string | undefined) { const normalized = value?.trim(); return normalized || undefined }
export function normalizePlate(value: string | undefined) { const normalized = normalizeOptional(value); return normalized?.toUpperCase() }
export function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
