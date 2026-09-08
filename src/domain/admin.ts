export const applicationRoles = ["MANAGER", "ADMIN", "SECURITY", "EMPLOYEE"] as const
export type ApplicationRole = (typeof applicationRoles)[number]

export const authenticationSources = ["ACTIVE_DIRECTORY", "LOCAL"] as const
export type AuthenticationSource = (typeof authenticationSources)[number]

// Scoped identifiers this user's access is restricted to. companyIds is the only dimension any
// screen reads or edits today; facilityIds/securityGateIds exist so a future facility- or
// security-gate-level restriction (e.g. for the Güvenlik role) can be added without another
// breaking change to AdminUser.
export interface AuthorizationScope {
  companyIds: string[]
  facilityIds: string[]
  securityGateIds: string[]
}

export interface AdminUser {
  id: string
  fullName: string
  username: string
  email: string
  authenticationSource: AuthenticationSource
  role: ApplicationRole
  authorizationScope: AuthorizationScope
  active: boolean
}

export type {
  Company,
  Department,
  Facility,
  OrganizationEntity,
  OrganizationKind,
  OrganizationSnapshot,
  SecurityGate,
} from "@/domain/organization"

// Every role in the system today is company-scoped; a future global/system-wide role would be
// added to this list instead of that assumption being duplicated at every call site (Admin is
// explicitly NOT exempt — it stays company-scoped like every other role in this phase).
const COMPANY_SCOPE_EXEMPT_ROLES: ApplicationRole[] = []

export function requiresCompanyScope(role: ApplicationRole): boolean {
  return !COMPANY_SCOPE_EXEMPT_ROLES.includes(role)
}

export function isAuthorizationScopeValid(role: ApplicationRole, scope: AuthorizationScope): boolean {
  return !requiresCompanyScope(role) || scope.companyIds.length > 0
}

// Deliberately locale-independent: usernames/emails are ASCII identifiers, not natural-language
// text. toLocaleLowerCase("tr-TR") would map "I" to dotless "ı" instead of "i", making
// "ADMIN.BIR" and "admin.bir" compare as different strings — exactly the kind of accidental
// duplicate this check exists to prevent.
function normalizeForUniqueness(value: string) {
  return value.trim().toLowerCase()
}

// excludeId is the id of the record being edited, so a user's own current username/email is
// never flagged as conflicting with itself. Pass null when creating a brand-new user.
export function isAdminUsernameTaken(users: AdminUser[], excludeId: string | null, username: string): boolean {
  const normalized = normalizeForUniqueness(username)
  return users.some((user) => user.id !== excludeId && normalizeForUniqueness(user.username) === normalized)
}

export function isAdminEmailTaken(users: AdminUser[], excludeId: string | null, email: string): boolean {
  const normalized = normalizeForUniqueness(email)
  return users.some((user) => user.id !== excludeId && normalizeForUniqueness(user.email) === normalized)
}

// The following three guards protect against an Admin locking themselves (or everyone) out.
// They're pure so the page can provide proactive UI feedback while the backend independently
// enforces the same security invariants.
export function isSelfDeactivationAttempt(actingUserId: string | null, target: Pick<AdminUser, "id" | "active">, nextActive: boolean): boolean {
  return actingUserId !== null && actingUserId === target.id && target.active && !nextActive
}

export function isSelfAdminDemotionAttempt(actingUserId: string | null, target: Pick<AdminUser, "id" | "role">, nextRole: ApplicationRole): boolean {
  return actingUserId !== null && actingUserId === target.id && target.role === "ADMIN" && nextRole !== "ADMIN"
}

export function wouldRemoveLastActiveAdmin(users: AdminUser[], target: Pick<AdminUser, "id" | "role" | "active">, nextRole: ApplicationRole, nextActive: boolean): boolean {
  const remainsActiveAdmin = nextRole === "ADMIN" && nextActive
  if (remainsActiveAdmin) return false
  const wasActiveAdmin = target.role === "ADMIN" && target.active
  if (!wasActiveAdmin) return false
  return !users.some((user) => user.id !== target.id && user.role === "ADMIN" && user.active)
}

export interface VisitTypeDefinition {
  id: string
  name: string
  active: boolean
}

// Visit type names are natural-language Turkish text, so lowercase comparison must preserve
// Turkish dotted/dotless-I semantics. The service uses this same canonical form for storage
// and duplicate enforcement rather than relying solely on the UI.
export function normalizeVisitTypeName(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR")
}

export function isVisitTypeNameTaken(visitTypes: VisitTypeDefinition[], excludeId: string | null, name: string): boolean {
  const normalized = normalizeVisitTypeName(name)
  return visitTypes.some((visitType) => visitType.id !== excludeId && normalizeVisitTypeName(visitType.name) === normalized)
}

/**
 * Canonical Turkish visit type names whose scheduled end time is binding and
 * for which lifecycle extension/completion actions are meaningful.
 * Non-time-bound types (e.g. Tedarikçi, Teknik Servis / Bakım, Denetim) conclude when the work is finished.
 *
 * Backed by this static canonical list today; in the future this will read the
 * `timeBound` field from the VisitType data model.
 * Any unlisted or unknown type defaults to false (non-time-bound) for safety.
 */
export const TIME_BOUND_VISIT_TYPE_NAMES = [
  "Toplantı",
  "İş Görüşmesi",
  "Eğitim",
  "Müşteri Ziyareti",
] as const

const TIME_BOUND_VISIT_TYPE_NAMES_SET = new Set(
  TIME_BOUND_VISIT_TYPE_NAMES.map(normalizeVisitTypeName),
)

export function isTimeBoundVisitType(visitTypeName?: string | null): boolean {
  if (!visitTypeName) return false
  return TIME_BOUND_VISIT_TYPE_NAMES_SET.has(normalizeVisitTypeName(visitTypeName))
}

export const visitorCardStatuses = ["AVAILABLE", "IN_USE", "NOT_RETURNED", "LOST", "DISABLED"] as const
export type VisitorCardStatus = (typeof visitorCardStatuses)[number]

export interface VisitorCardInventoryItem {
  id: string
  cardNumber: string
  status: VisitorCardStatus
  // Operational identity set by Security when a card moves to IN_USE. Legacy/seeded IN_USE and
  // NOT_RETURNED cards may carry only assignedVisitorName without a linked visit id.
  assignedVisitId?: string
  assignedVisitorName?: string
}

export interface CreateVisitorCardInput {
  cardNumber: string
}

export interface UpdateVisitorCardInventoryInput {
  cardNumber: string
  active: boolean
}

// Visitor card numbers are identifiers rather than natural-language text. Preserve their
// original spelling (including leading zeros) for display, but compare trimmed ASCII case-folded
// values so inventory records cannot be duplicated through casing or surrounding whitespace.
export function normalizeVisitorCardNumber(value: string): string {
  return value.trim().toLowerCase()
}

export function isVisitorCardNumberTaken(cards: VisitorCardInventoryItem[], excludeId: string | null, cardNumber: string): boolean {
  const normalized = normalizeVisitorCardNumber(cardNumber)
  return cards.some((card) => card.id !== excludeId && normalizeVisitorCardNumber(card.cardNumber) === normalized)
}

export function isAdminManagedVisitorCard(card: Pick<VisitorCardInventoryItem, "status">): boolean {
  return card.status === "AVAILABLE" || card.status === "DISABLED"
}

/**
 * Visitor card status ownership:
 *   AVAILABLE      Admin
 *   IN_USE         Security (check-in)
 *   NOT_RETURNED   Security (visitor left without checking out)
 *   LOST           Admin (written off)
 *   DISABLED       Admin
 *
 * `isAdminManagedVisitorCard` answers "may Admin edit this card's number/active
 * flag" (AVAILABLE | DISABLED). The two write-off transitions below are separate,
 * intent-revealing actions and are not covered by it.
 */
export function canMarkVisitorCardLost(card: Pick<VisitorCardInventoryItem, "status">): boolean {
  return card.status === "NOT_RETURNED"
}

export function canRestoreVisitorCard(card: Pick<VisitorCardInventoryItem, "status">): boolean {
  return card.status === "LOST"
}

export interface VisitorRuleVersion {
  id: string
  version: number
  content: string
  publishedAt: string
  active: boolean
}

export interface OperationalSettings {
  overdueToleranceMinutes: number
  overdueAlertRepeatMinutes: number
  workdayEndTime: string
}

export const DEFAULT_OVERDUE_TOLERANCE_MINUTES = 15

export function isOperationalSettingsValid(settings: OperationalSettings): boolean {
  return Number.isInteger(settings.overdueToleranceMinutes) && settings.overdueToleranceMinutes >= 0
    && Number.isInteger(settings.overdueAlertRepeatMinutes) && settings.overdueAlertRepeatMinutes >= 1
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(settings.workdayEndTime)
}

export const authenticationSourceLabels: Record<AuthenticationSource, string> = {
  ACTIVE_DIRECTORY: "Active Directory",
  LOCAL: "Local",
}

export const applicationRoleLabels: Record<ApplicationRole, string> = {
  ADMIN: "Admin",
  MANAGER: "Yönetici",
  SECURITY: "Güvenlik",
  EMPLOYEE: "Çalışan",
}

export const visitorCardStatusLabels: Record<VisitorCardStatus, string> = {
  AVAILABLE: "Uygun",
  IN_USE: "Kullanımda",
  NOT_RETURNED: "İade edilmedi",
  LOST: "Kayıp",
  DISABLED: "Devre dışı",
}
