export const visitStatuses = ["PLANNED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"] as const

export type VisitStatus = (typeof visitStatuses)[number]

export const invitationStatuses = ["NOT_SENT", "SENDING", "SENT", "FAILED"] as const

export type InvitationStatus = (typeof invitationStatuses)[number]

// ---------------------------------------------------------------------------
// Meeting end source
// MANUAL          — host/organizer explicitly closed the meeting
// VISITOR_CHECK_OUT — meeting was auto-closed when the last checked-in
//                    visitor checked out
// ---------------------------------------------------------------------------
export const meetingEndSources = ["MANUAL", "VISITOR_CHECK_OUT"] as const
export type MeetingEndSource = (typeof meetingEndSources)[number]

export interface Visitor {
  id: string
  firstName: string
  lastName: string
  email?: string
  company: string
  phone?: string
}

// Email is optional across the whole visitor model: not every visitor has (or needs) one, and
// invitation delivery simply skips visitors without one instead of failing the visit.
export function hasVisitorEmail(visitor: Pick<Visitor, "email">): boolean {
  return Boolean(visitor.email)
}

// Blank/whitespace-only input normalizes to undefined rather than being stored as "" — undefined
// is the canonical "no email" domain state.
export function normalizeVisitorEmail(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

const visitorEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidVisitorEmail(value: string): boolean {
  return visitorEmailPattern.test(value)
}

// Trims and uppercases for consistent display, but applies no country-specific plate format —
// foreign plates are expected. Blank input normalizes to undefined.
export function normalizeVehiclePlate(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.toUpperCase() : undefined
}

export interface MeetingDetails {
  creatorEmployeeId: string
  visitTypeId: string
  visitTypeName: string
  // A planned Meeting links its host to an employee. A security-desk unplanned visit that has
  // only a confirmed free-text host name stores "" here: it is deliberately not a fabricated
  // employee identifier and therefore grants no host-scoped lifecycle permission.
  hostEmployeeId: string
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
  // Lifecycle fields — projected from Meeting so UI components can read them
  // from the flat Visit read-model without a second Meeting fetch.
  actualMeetingEnd?: string
  meetingEndSource?: MeetingEndSource
}

export interface Meeting extends MeetingDetails {
  id: string
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Input types for lifecycle operations
// ---------------------------------------------------------------------------

export interface ExtendMeetingInput {
  /** Positive whole number of minutes to add. */
  extensionMinutes: number
  /** Employee identity performing the manual lifecycle action. */
  actorEmployeeId: string
  /**
   * The current client-side time used to compute the new end.
   * Formula: max(current plannedEnd, currentTime) + extensionMinutes
   */
  currentTime: string
}

export type CloseMeetingInput =
  | { source: "MANUAL"; actorEmployeeId: string }
  | { source: "VISITOR_CHECK_OUT" }

export interface VisitRecord {
  id: string
  meetingId: string
  visitor: Visitor
  actualCheckIn?: string
  actualCheckOut?: string
  visitorCardReturned?: boolean
  // Security check-in snapshot. visitorCardNumber is captured at check-in time so the historical
  // record survives the card later being renumbered in inventory; visitorCardId is the live
  // inventory link. vehiclePlate is a free-text, unvalidated operational field.
  visitorCardId?: string
  visitorCardNumber?: string
  vehiclePlate?: string
  // Immutable snapshot of the active rule version accepted for this individual visit.
  // The content snapshot keeps later rule publications from changing historical evidence.
  ruleAcceptance?: VisitorRuleAcceptance
  // Security gate host-name correction audit. Set only when a gate correction changes the
  // displayed host name (hostEmployeeName); the linked hostEmployeeId is intentionally left
  // untouched. hostCorrectedBy is the acting security employee's name.
  hostCorrectedFrom?: string
  hostCorrectedAt?: string
  hostCorrectedBy?: string
  status: VisitStatus
  invitationStatus: InvitationStatus
  // Server-decided: a `SENDING` invitation whose send attempt was abandoned (a restart between
  // claiming the send and recording its result) and may therefore be retried. Never derive this
  // on the client — the backend owns the threshold, and its send endpoints enforce the same rule.
  invitationSendStale?: boolean
  invitationSentAt?: string
  invitationError?: string
  createdAt: string
  updatedAt: string
  cancelledAt?: string
}

export interface VisitorRuleAcceptance {
  ruleId: string
  ruleVersion: number
  acceptedAt: string
  method: "INVITATION_LINK" | "SECURITY_DESK"
  contentSnapshot: string
}

// Read model used by existing visitor-based screens. Shared fields are projected from
// Meeting by the service and are never stored as editable VisitRecord state.
export interface Visit extends VisitRecord, MeetingDetails {}

export interface CompanyOption {
  id: string
  name: string
}

export interface FacilityOption {
  id: string
  companyId: string
  name: string
}

export interface EmployeeOption {
  id: string
  companyId: string
  facilityIds: string[]
  name: string
  departmentId: string
  // Compatibility display projection. Its value is always resolved from the canonical
  // Department entity by the reference-data factory, never maintained independently.
  department: string
}

export interface VisitTypeOption {
  id: string
  name: string
  active: boolean
}

export interface VisitReferenceData {
  companies: CompanyOption[]
  facilities: FacilityOption[]
  employees: EmployeeOption[]
  visitTypes: VisitTypeOption[]
  currentEmployee: {
    employeeId: string
    companyId: string
    facilityId: string
    role: "EMPLOYEE" | "MANAGER"
  }
}

export interface VisitorInput {
  visitId?: string
  firstName: string
  lastName: string
  email?: string
  company: string
  phone?: string
}

export interface MeetingInput {
  visitors: VisitorInput[]
  visitTypeId: string
  // Selected from the employee roster in the form. The server still receives
  // hostEmployeeName (and canonicalizes it), but the id is what identifies the host.
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

export interface MeetingWithVisits {
  meeting: Meeting
  visits: Visit[]
}

export interface RescheduleVisitInput {
  plannedStart: string
  plannedEnd: string
}

export const visitStatusLabels: Record<VisitStatus, string> = {
  PLANNED: "Planlandı",
  CHECKED_IN: "İçeride",
  CHECKED_OUT: "Çıkış Yapıldı",
  CANCELLED: "İptal Edildi",
  NO_SHOW: "Gelmedi",
}

export { isTimeBoundVisitType } from "@/domain/admin"

