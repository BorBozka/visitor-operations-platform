import type { Prisma, PrismaClient, VisitorCard, VisitorRuleVersion, VisitType } from "@prisma/client"

import { ApiError } from "../lib/api-error.js"
import { isWriteConflictError, withWriteConflictRetry } from "../lib/prisma-conflict.js"
import type {
  CreateUnplannedInput, EmployeeActor, MeetingDto, MeetingInput, MeetingWithVisitsDto,
  RuleAcceptanceDto, SecurityCheckInInput, SecurityCorrectionInput,
  VisitorCardDto, VisitorCardStatus, VisitorRuleDto, VisitDto, VisitTypeDto,
} from "../modules/visitor-operations/types.js"
import { parseEnum, invitationStatuses, ruleAcceptanceMethods, visitorCardStatuses, visitStatuses } from "../modules/visitor-operations/types.js"
import { invitationSendStaleBefore, isInvitationSendStale } from "../modules/visitor-operations/invitation-staleness.js"
import { assertMeetingPlanningUnlocked } from "../modules/visitor-operations/meeting-planning-lock.js"
import type { ResourceExtensionGuard } from "./resource-assignment-repository.js"

const invitationReset = { invitationStatus: "NOT_SENT", invitationSentAt: null, invitationError: null } as const

async function resetPlannedInvitations(tx: Prisma.TransactionClient, meetingId: string) {
  await tx.invitation.deleteMany({ where: { visit: { meetingId, status: "PLANNED" } } })
  await tx.visit.updateMany({ where: { meetingId, status: "PLANNED" }, data: invitationReset })
}

export class CheckInConflictError extends Error {
  constructor() {
    super("Check-in state changed concurrently.")
    this.name = "CheckInConflictError"
  }
}

export class NoActiveVisitorRuleError extends Error {
  constructor() {
    super("Missing active visitor rule.")
    this.name = "NoActiveVisitorRuleError"
  }
}

export type VisitorCardConflictReason = "CARD_STATE_CHANGED" | "INVALID_CHECKOUT_STATE" | "INVALID_CARD_ASSIGNMENT" | "INVALID_LATE_RETURN_STATE"

export class VisitorCardConflictError extends Error {
  constructor(public readonly reason: VisitorCardConflictReason) {
    super(`Visitor-card lifecycle conflict: ${reason}.`)
    this.name = "VisitorCardConflictError"
  }
}

/**
 * A public invitation token no longer authorizes a write: either no invitation carries the hash,
 * or the Visit behind it is not both `PLANNED` and invitation `SENT`. The service maps every case
 * onto the single public `404 INVITATION_NOT_FOUND` response, which deliberately does not tell the
 * holder of the link why it is inactive.
 */
export class PublicInvitationInactiveError extends Error {
  constructor() {
    super("Public invitation is no longer attached to an active sent invitation.")
    this.name = "PublicInvitationInactiveError"
  }
}

export interface VisitorCardExpectedState {
  status: VisitorCardStatus
  currentVisitId: string | null
}

/**
 * Re-reads the invitation by token hash *inside* a write transaction and returns its Visit only
 * while that Visit is still persisted as both `PLANNED` and invitation `SENT`. This — not the
 * service's earlier snapshot — is the authority every public mutation must gate on.
 */
async function findActivePublicVisit(tx: Prisma.TransactionClient, tokenHash: string) {
  const invitation = await tx.invitation.findUnique({ where: { tokenHash }, include: { visit: { select: { id: true, status: true, invitationStatus: true, visitorId: true } } } })
  if (!invitation || invitation.visit.status !== "PLANNED" || invitation.visit.invitationStatus !== "SENT") throw new PublicInvitationInactiveError()
  return invitation.visit
}

function isCheckInWriteConflict(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false
  return error.code === "P2002" || error.code === "P2034"
}

// Exported for the Phase 4 reports repository, which projects the same flattened visitor
// read model.
const meetingInclude = {
  visitType: true,
  hostCompany: true,
  facility: true,
} as const satisfies Prisma.MeetingInclude

export const visitInclude = {
  visitor: true,
  meeting: { include: { visitType: true, hostCompany: true, facility: true, hostEmployee: { include: { user: true } } } },
  ruleAcceptances: { orderBy: { acceptedAt: "desc" }, take: 1 },
  hostCorrectionAudits: { orderBy: { correctedAt: "desc" }, take: 1, include: { correctedByEmployee: true, correctedByUser: true } },
} as const satisfies Prisma.VisitInclude

type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>
type VisitRow = Prisma.VisitGetPayload<{ include: typeof visitInclude }>

function parseMeetingEndSource(value: string | null): MeetingDto["meetingEndSource"] {
  if (value === null || value === "MANUAL" || value === "VISITOR_CHECK_OUT") return value ?? undefined
  throw new Error(`Unsupported persisted meeting end source: ${value}`)
}

function toMeeting(row: MeetingRow): MeetingDto {
  return {
    id: row.id, creatorEmployeeId: row.creatorEmployeeId, visitTypeId: row.visitTypeId, visitTypeName: row.visitType.name,
    hostEmployeeId: row.hostEmployeeId ?? undefined, hostEmployeeName: row.hostEmployeeName,
    hostCompanyId: row.hostCompanyId, hostCompanyName: row.hostCompany.name,
    facilityId: row.facilityId, facilityName: row.facility.name,
    plannedStart: row.plannedStart.toISOString(), plannedEnd: row.plannedEnd.toISOString(), note: row.note ?? undefined,
    hasAdditionalRequirements: row.hasAdditionalRequirements, additionalRequirementNote: row.additionalRequirementNote ?? undefined,
    actualMeetingEnd: row.actualMeetingEnd?.toISOString(), meetingEndSource: parseMeetingEndSource(row.meetingEndSource),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}

export function toVisit(row: VisitRow): VisitDto {
  const acceptance = row.ruleAcceptances?.[0]
  const audit = row.hostCorrectionAudits?.[0]
  return {
    id: row.id, meetingId: row.meetingId,
    visitor: { id: row.visitor.id, firstName: row.visitor.firstName, lastName: row.visitor.lastName, email: row.visitor.email ?? undefined, company: row.visitor.company, phone: row.visitor.phone ?? undefined },
    actualCheckIn: row.actualCheckIn?.toISOString(), actualCheckOut: row.actualCheckOut?.toISOString(), visitorCardReturned: row.visitorCardReturned ?? undefined,
    visitorCardId: row.visitorCardId ?? undefined, visitorCardNumber: row.visitorCardNumber ?? undefined, vehiclePlate: row.vehiclePlate ?? undefined,
    status: parseEnum(visitStatuses, row.status, "visit status"), invitationStatus: parseEnum(invitationStatuses, row.invitationStatus, "invitation status"),
    // Derived read-model flag, not a stored column: it answers "has this send attempt been
    // abandoned?" as of the moment the row is read, so clients never date-compare it themselves.
    invitationSendStale: isInvitationSendStale(row.invitationStatus, row.invitationSendStartedAt, new Date()) || undefined,
    invitationSentAt: row.invitationSentAt?.toISOString(), invitationError: row.invitationError ?? undefined, cancelledAt: row.cancelledAt?.toISOString(),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), meeting: toMeeting(row.meeting),
    ruleAcceptance: acceptance ? { id: acceptance.id, ruleId: acceptance.visitorRuleVersionId, ruleVersion: acceptance.ruleVersion, acceptedAt: acceptance.acceptedAt.toISOString(), method: parseEnum(ruleAcceptanceMethods, acceptance.method, "rule acceptance method"), contentSnapshot: acceptance.contentSnapshot } : undefined,
    hostCorrectedFrom: audit?.previousHostName, hostCorrectedAt: audit?.correctedAt.toISOString(), hostCorrectedBy: audit ? (audit.correctedByEmployee?.fullName ?? audit.correctedByUser?.fullName) : undefined,
  }
}

function toVisitType(row: VisitType): VisitTypeDto { return { id: row.id, name: row.name, active: row.active, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } }
function toRule(row: VisitorRuleVersion): VisitorRuleDto { return { id: row.id, version: row.version, content: row.content, publishedAt: row.publishedAt.toISOString(), active: row.active } }
function toCard(row: VisitorCard): VisitorCardDto {
  return { id: row.id, cardNumber: row.cardNumber, status: parseEnum(visitorCardStatuses, row.status, "visitor card status"), assignedVisitId: row.currentVisitId ?? undefined, assignedVisitorName: row.assignedVisitorName ?? undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}

export interface VisitorOperationsRepository {
  listVisitTypes(includeInactive: boolean): Promise<VisitTypeDto[]>
  findVisitType(id: string): Promise<VisitTypeDto | null>
  saveVisitType(input: { id?: string; name: string; nameNormalized: string; active: boolean }): Promise<VisitTypeDto>
  listMeetings(): Promise<MeetingDto[]>
  listVisits(): Promise<VisitDto[]>
  findMeeting(id: string): Promise<MeetingWithVisitsDto | null>
  findVisit(id: string): Promise<VisitDto | null>
  findEmployeeByUserId(userId: string): Promise<EmployeeActor | null>
  findEmployeeById(id: string): Promise<EmployeeActor | null>
  findActiveEmployeeByName(name: string, companyId: string, facilityId: string): Promise<EmployeeActor | null>
  getReferenceData(userId: string): Promise<unknown>
  createMeeting(input: MeetingInput, creatorEmployeeId: string, hostEmployeeId: string | null): Promise<MeetingWithVisitsDto>
  updateMeeting(id: string, input: MeetingInput, hostEmployeeId: string | null): Promise<MeetingWithVisitsDto>
  updateMeetingTimes(id: string, plannedStart: Date, plannedEnd: Date): Promise<void>
  /**
   * Meeting extension: re-validates existing ROOM / POOLED_EQUIPMENT assignments for the new
   * time range and moves plannedEnd in ONE transaction, so validation and the update cannot
   * be split by a concurrent resource assignment. A resource conflict rejects the whole
   * extension (plannedEnd unchanged).
   */
  extendMeetingTimes(id: string, plannedStart: Date, plannedEnd: Date): Promise<void>
  cancelVisit(id: string, userId: string, now: Date): Promise<void>
  cancelMeeting(id: string, userId: string, now: Date): Promise<void>
  closeMeeting(id: string, source: "MANUAL" | "VISITOR_CHECK_OUT", now: Date): Promise<void>
  /**
   * Atomically claims the one right to send this invitation, returning `claimed: false` when the
   * record is already sent or has a send attempt still in flight. See the implementation for the
   * compare-and-set that also makes an abandoned `SENDING` attempt re-claimable.
   */
  prepareInvitation(visitId: string, tokenHash: string, now: Date): Promise<{ visit: VisitDto; claimed: boolean }>
  finishInvitation(visitId: string, succeeded: boolean, now: Date): Promise<void>
  findPublicPreRegistration(tokenHash: string): Promise<{ visit: VisitDto; activeRule: VisitorRuleDto | null } | null>
  updatePublicVisitor(tokenHash: string, input: { firstName: string; lastName: string; email?: string; company: string; phone?: string; vehiclePlate?: string }): Promise<void>
  acceptPublicRule(tokenHash: string, ipAddress?: string): Promise<RuleAcceptanceDto>
  listRules(): Promise<VisitorRuleDto[]>
  getActiveRule(): Promise<VisitorRuleDto | null>
  publishRule(content: string, now: Date): Promise<VisitorRuleDto>
  listCards(): Promise<VisitorCardDto[]>
  findCard(id: string): Promise<VisitorCardDto | null>
  saveCard(input: { cardNumber: string; cardNumberNormalized: string; status?: VisitorCardStatus }): Promise<VisitorCardDto>
  updateCard(id: string, input: { cardNumber: string; cardNumberNormalized: string; status: VisitorCardStatus }, expected: VisitorCardExpectedState): Promise<VisitorCardDto>
  setCardStatus(id: string, status: VisitorCardStatus, expected: VisitorCardExpectedState): Promise<VisitorCardDto>
  /**
   * Hard delete of an out-of-circulation card. Visit history is kept: `Visit.visitorCardNumber`
   * is its own snapshot and `Visit.visitorCardId` is nulled by the database (ON DELETE SET NULL).
   * `expected` is re-asserted in the delete statement itself, so a card that just moved back into
   * operational use raises a conflict instead of being deleted.
   */
  deleteCard(id: string, expected: VisitorCardExpectedState): Promise<void>
  checkIn(visitId: string, input: SecurityCheckInInput, now: Date): Promise<{ visit: VisitDto; hostEmail?: string; hostName?: string }>
  checkOut(visitId: string, cardReturned: boolean, now: Date): Promise<void>
  listUnreturnedIssues(): Promise<{ card: VisitorCardDto; visit: VisitDto }[]>
  lateReturn(visitId: string, now: Date): Promise<void>
  createUnplanned(input: CreateUnplannedInput, creatorEmployeeId: string, now: Date): Promise<VisitDto>
  correctVisitor(visitId: string, input: SecurityCorrectionInput, actor: EmployeeActor | null, now: Date): Promise<void>
}

export class PrismaVisitorOperationsRepository implements VisitorOperationsRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly resourceExtensionGuard?: ResourceExtensionGuard,
  ) {}

  async listVisitTypes(includeInactive: boolean) { return (await this.prisma.visitType.findMany({ where: includeInactive ? {} : { active: true }, orderBy: { name: "asc" } })).map(toVisitType) }
  async findVisitType(id: string) { const row = await this.prisma.visitType.findUnique({ where: { id } }); return row ? toVisitType(row) : null }
  async saveVisitType(input: { id?: string; name: string; nameNormalized: string; active: boolean }) { const row = input.id ? await this.prisma.visitType.update({ where: { id: input.id }, data: input }) : await this.prisma.visitType.create({ data: input }); return toVisitType(row) }
  async listMeetings() { const rows = await this.prisma.meeting.findMany({ include: meetingInclude, orderBy: { plannedStart: "asc" } }); return rows.map(toMeeting) }
  async listVisits() { return (await this.prisma.visit.findMany({ include: visitInclude, orderBy: { createdAt: "asc" } })).map(toVisit) }
  async findVisit(id: string) { const row = await this.prisma.visit.findUnique({ where: { id }, include: visitInclude }); return row ? toVisit(row) : null }
  async findMeeting(id: string) {
    const row = await this.prisma.meeting.findUnique({ where: { id }, include: { visitType: true, hostCompany: true, facility: true, visits: { include: visitInclude, orderBy: { createdAt: "asc" } } } })
    return row ? { meeting: toMeeting(row), visits: row.visits.map(toVisit) } : null
  }
  async findEmployeeByUserId(userId: string) { const row = await this.prisma.employee.findUnique({ where: { userId }, include: { user: true, facilityScopes: true } }); return row ? { id: row.id, userId: row.userId, fullName: row.fullName, companyId: row.companyId, facilityIds: row.facilityScopes.map((item) => item.facilityId), email: row.user?.email, role: row.user?.role as EmployeeActor["role"] } : null }
  async findEmployeeById(id: string) { const row = await this.prisma.employee.findUnique({ where: { id }, include: { user: true, facilityScopes: true } }); return row ? { id: row.id, userId: row.userId, fullName: row.fullName, companyId: row.companyId, facilityIds: row.facilityScopes.map((item) => item.facilityId), email: row.user?.email, role: row.user?.role as EmployeeActor["role"] } : null }
  async findActiveEmployeeByName(name: string, companyId: string, facilityId: string) { const row = await this.prisma.employee.findFirst({ where: { fullName: name, companyId, active: true, facilityScopes: { some: { facilityId } } }, include: { user: true, facilityScopes: true } }); return row ? { id: row.id, userId: row.userId, fullName: row.fullName, companyId: row.companyId, facilityIds: row.facilityScopes.map((item) => item.facilityId), email: row.user?.email, role: row.user?.role as EmployeeActor["role"] } : null }
  async getReferenceData(userId: string) {
    const [companies, facilities, employees, visitTypes, currentEmployee] = await Promise.all([
      this.prisma.company.findMany({ where: { active: true }, orderBy: { name: "asc" } }), this.prisma.facility.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      this.prisma.employee.findMany({ where: { active: true }, include: { department: true, facilityScopes: true }, orderBy: { fullName: "asc" } }), this.listVisitTypes(true), this.findEmployeeByUserId(userId),
    ])
    if (!currentEmployee) return { companies, facilities, employees, visitTypes, currentEmployee: null }
    return { companies: companies.map((item) => ({ id: item.id, name: item.name })), facilities: facilities.map((item) => ({ id: item.id, companyId: item.companyId, name: item.name })), employees: employees.map((item) => ({ id: item.id, companyId: item.companyId, facilityIds: item.facilityScopes.map((scope) => scope.facilityId), name: item.fullName, departmentId: item.departmentId ?? "", department: item.department?.name ?? "" })), visitTypes, currentEmployee: { employeeId: currentEmployee.id, companyId: currentEmployee.companyId, facilityId: currentEmployee.facilityIds[0] ?? "", role: currentEmployee.role === "MANAGER" ? "MANAGER" : "EMPLOYEE" } }
  }
  async createMeeting(input: MeetingInput, creatorEmployeeId: string, hostEmployeeId: string | null) {
    const id = await this.prisma.$transaction(async (tx) => {
      const meeting = await tx.meeting.create({ data: { creatorEmployeeId, visitTypeId: input.visitTypeId, hostEmployeeId, hostEmployeeName: input.hostEmployeeName, hostCompanyId: input.hostCompanyId, facilityId: input.facilityId, plannedStart: new Date(input.plannedStart), plannedEnd: new Date(input.plannedEnd), note: input.note, hasAdditionalRequirements: input.hasAdditionalRequirements ?? false, additionalRequirementNote: input.additionalRequirementNote } })
      for (const visitor of input.visitors) { const saved = await tx.visitor.create({ data: { firstName: visitor.firstName, lastName: visitor.lastName, email: visitor.email, company: visitor.company, phone: visitor.phone } }); await tx.visit.create({ data: { meetingId: meeting.id, visitorId: saved.id, status: "PLANNED" } }) }
      return meeting.id
    })
    return (await this.findMeeting(id))!
  }
  async updateMeeting(id: string, input: MeetingInput, hostEmployeeId: string | null) {
    await this.writeSharedPlanning(id, async (tx) => {
      await tx.meeting.update({ where: { id }, data: { visitTypeId: input.visitTypeId, hostEmployeeId, hostEmployeeName: input.hostEmployeeName, hostCompanyId: input.hostCompanyId, facilityId: input.facilityId, plannedStart: new Date(input.plannedStart), plannedEnd: new Date(input.plannedEnd), note: input.note, hasAdditionalRequirements: input.hasAdditionalRequirements ?? false, additionalRequirementNote: input.additionalRequirementNote } })
      for (const visitor of input.visitors) {
        if (visitor.visitId) { const visit = await tx.visit.findUnique({ where: { id: visitor.visitId }, select: { visitorId: true } }); if (visit) await tx.visitor.update({ where: { id: visit.visitorId }, data: { firstName: visitor.firstName, lastName: visitor.lastName, email: visitor.email, company: visitor.company, phone: visitor.phone } }) }
        else { const saved = await tx.visitor.create({ data: { firstName: visitor.firstName, lastName: visitor.lastName, email: visitor.email, company: visitor.company, phone: visitor.phone } }); await tx.visit.create({ data: { meetingId: id, visitorId: saved.id, status: "PLANNED" } }) }
      }
      await resetPlannedInvitations(tx, id)
    })
    return (await this.findMeeting(id))!
  }
  async updateMeetingTimes(id: string, plannedStart: Date, plannedEnd: Date) {
    await this.writeSharedPlanning(id, async (tx) => {
      await tx.meeting.update({ where: { id }, data: { plannedStart, plannedEnd } })
      await resetPlannedInvitations(tx, id)
    })
  }
  /**
   * Serializable write of the Meeting's shared planning fields. The all-PLANNED invariant is
   * re-checked from the rows read inside the transaction, so a check-in / check-out / cancel that
   * lands after the service read its snapshot either loses the race (and this write rejects with
   * the same 409) or aborts the transaction as a write conflict, which maps to a 409 too.
   */
  private async writeSharedPlanning(meetingId: string, write: (tx: Prisma.TransactionClient) => Promise<void>) {
    try {
      await withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
        const visits = await tx.visit.findMany({ where: { meetingId }, select: { status: true } })
        assertMeetingPlanningUnlocked(visits.map((visit) => visit.status))
        await write(tx)
      }, { isolationLevel: "Serializable" }))
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (isWriteConflictError(error)) throw new ApiError(409, "MEETING_PLANNING_CONFLICT", "Toplantı güncellenirken ziyaret durumu değişti, lütfen tekrar deneyin.")
      throw error
    }
  }
  async extendMeetingTimes(id: string, plannedStart: Date, plannedEnd: Date) {
    try {
      await withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
        if (this.resourceExtensionGuard) await this.resourceExtensionGuard.assertExtensionSafe(tx, id, plannedEnd)
        await tx.meeting.update({ where: { id }, data: { plannedStart, plannedEnd } })
        await resetPlannedInvitations(tx, id)
      }, { isolationLevel: "Serializable" }))
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (isWriteConflictError(error)) {
        throw new ApiError(409, "MEETING_EXTENSION_CONFLICT", "Toplantı uzatması sırasında kaynak durumu değişti, lütfen tekrar deneyin.")
      }
      throw error
    }
  }
  async cancelVisit(id: string, userId: string, now: Date) { await this.prisma.visit.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, cancelledByUserId: userId } }) }
  async cancelMeeting(id: string, userId: string, now: Date) { await this.prisma.visit.updateMany({ where: { meetingId: id, status: "PLANNED" }, data: { status: "CANCELLED", cancelledAt: now, cancelledByUserId: userId } }) }
  async closeMeeting(id: string, source: "MANUAL" | "VISITOR_CHECK_OUT", now: Date) { await this.prisma.meeting.update({ where: { id }, data: { actualMeetingEnd: now, meetingEndSource: source } }) }
  /**
   * Claims the right to send one invitation email. The claim — never the caller's snapshot — is
   * the authority on invitation state: the `updateMany` is a compare-and-set on the *persisted*
   * columns, so of two callers racing the same record exactly one gets `claimed: true` and only
   * that one sends.
   *
   * A stale `SENDING` (`invitation-staleness.ts`) is claimable so a send attempt lost to a process
   * restart can be retried, and re-claiming it is safe against a second racer for the same reason
   * every other transition is: writing `invitationSendStartedAt` to *now* falsifies the staleness
   * predicate, so the loser's compare-and-set matches nothing. A fresh `SENDING` never matches at
   * all, which is what keeps a normal concurrent resend from mailing twice.
   *
   * The upsert always writes the new hash, so a re-claim revokes the previous attempt's token
   * rather than reviving it.
   */
  async prepareInvitation(visitId: string, tokenHash: string, now: Date) {
    const staleBefore = invitationSendStaleBefore(now)
    let claimed = false
    await this.prisma.$transaction(async (tx) => {
      const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { visitor: true } })
      if (!visit || visit.status !== "PLANNED" || !visit.visitor.email) return
      const changed = await tx.visit.updateMany({
        where: {
          id: visitId,
          OR: [
            { invitationStatus: { in: ["NOT_SENT", "FAILED"] } },
            { invitationStatus: "SENDING", invitationSendStartedAt: null },
            { invitationStatus: "SENDING", invitationSendStartedAt: { lte: staleBefore } },
          ],
        },
        data: { invitationStatus: "SENDING", invitationSendStartedAt: now, invitationError: null },
      })
      if (changed.count) {
        claimed = true
        await tx.invitation.upsert({ where: { visitId }, create: { visitId, tokenHash }, update: { tokenHash } })
      }
    })
    return { visit: (await this.findVisit(visitId))!, claimed }
  }
  async finishInvitation(visitId: string, succeeded: boolean, now: Date) { await this.prisma.visit.updateMany({ where: { id: visitId, invitationStatus: "SENDING" }, data: succeeded ? { invitationStatus: "SENT", invitationSentAt: now, invitationError: null } : { invitationStatus: "FAILED", invitationError: "Davet teknik bir hata nedeniyle gönderilemedi." } }) }
  async findPublicPreRegistration(tokenHash: string) { const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash }, include: { visit: { include: visitInclude } } }); if (!invitation) return null; const active = await this.prisma.visitorRuleVersion.findFirst({ where: { active: true }, orderBy: { version: "desc" } }); return { visit: toVisit(invitation.visit), activeRule: active ? toRule(active) : null } }
  /**
   * Public visitor pre-registration write.
   *
   * The service's `getActivePublicInvitation` pre-check reads a snapshot a concurrent cancel /
   * check-in can invalidate before this write runs, so the authority for "the invitation is still
   * usable" is this transaction: the invitation is re-read by token hash and the Visit write is a
   * compare-and-set on the *persisted* `PLANNED` status, leaving no window between the check and
   * the write. A cancel / check-in that commits first makes the CAS match nothing and the whole
   * transaction — visitor fields included — rolls back.
   */
  async updatePublicVisitor(tokenHash: string, input: { firstName: string; lastName: string; email?: string; company: string; phone?: string; vehiclePlate?: string }) {
    await withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
      const visit = await findActivePublicVisit(tx, tokenHash)
      const changed = await tx.visit.updateMany({ where: { id: visit.id, status: "PLANNED", invitationStatus: "SENT" }, data: { vehiclePlate: input.vehiclePlate } })
      if (changed.count !== 1) throw new PublicInvitationInactiveError()
      await tx.visitor.update({ where: { id: visit.visitorId }, data: { firstName: input.firstName, lastName: input.lastName, email: input.email, company: input.company, phone: input.phone } })
    }, { isolationLevel: "Serializable" }))
  }
  /**
   * Public rule acceptance. Same invariant as `updatePublicVisitor`: the persisted Visit status is
   * re-read inside the transaction, and SERIALIZABLE holds that read locked until commit, so a
   * cancel / check-in cannot slip in between the revalidation and the acceptance row. A missing
   * *active rule* stays deliberately distinct from an inactive invitation — the service owns the
   * `NO_ACTIVE_RULE` contract and must not see this case as a 404.
   */
  async acceptPublicRule(tokenHash: string, ipAddress?: string) {
    return withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
      const visit = await findActivePublicVisit(tx, tokenHash)
      const rule = await tx.visitorRuleVersion.findFirst({ where: { active: true }, orderBy: { version: "desc" } })
      if (!rule) throw new NoActiveVisitorRuleError()
      const existing = await tx.visitRuleAcceptance.findUnique({ where: { visitId_visitorRuleVersionId: { visitId: visit.id, visitorRuleVersionId: rule.id } } })
      const row = existing ?? await tx.visitRuleAcceptance.create({ data: { visitId: visit.id, visitorId: visit.visitorId, visitorRuleVersionId: rule.id, ruleVersion: rule.version, acceptedAt: new Date(), method: "INVITATION_LINK", contentSnapshot: rule.content, integrityHash: null, ipAddress: ipAddress ?? null } })
      return { id: row.id, ruleId: row.visitorRuleVersionId, ruleVersion: row.ruleVersion, acceptedAt: row.acceptedAt.toISOString(), method: parseEnum(ruleAcceptanceMethods, row.method, "rule acceptance method"), contentSnapshot: row.contentSnapshot }
    }, { isolationLevel: "Serializable" }))
  }
  async listRules() { return (await this.prisma.visitorRuleVersion.findMany({ orderBy: { version: "desc" } })).map(toRule) }
  async getActiveRule() { const row = await this.prisma.visitorRuleVersion.findFirst({ where: { active: true }, orderBy: { version: "desc" } }); return row ? toRule(row) : null }
  async publishRule(content: string, now: Date) { const row = await this.prisma.$transaction(async (tx) => { const latest = await tx.visitorRuleVersion.findFirst({ orderBy: { version: "desc" }, select: { version: true } }); await tx.visitorRuleVersion.updateMany({ where: { active: true }, data: { active: false } }); return tx.visitorRuleVersion.create({ data: { version: (latest?.version ?? 0) + 1, content, publishedAt: now, active: true } }) }, { isolationLevel: "Serializable" }); return toRule(row) }
  async listCards() { return (await this.prisma.visitorCard.findMany({ orderBy: { cardNumber: "asc" } })).map(toCard) }
  async findCard(id: string) { const row = await this.prisma.visitorCard.findUnique({ where: { id } }); return row ? toCard(row) : null }
  async saveCard(input: { cardNumber: string; cardNumberNormalized: string; status?: VisitorCardStatus }) { return toCard(await this.prisma.visitorCard.create({ data: { cardNumber: input.cardNumber, cardNumberNormalized: input.cardNumberNormalized, status: input.status ?? "AVAILABLE" } })) }
  async updateCard(id: string, input: { cardNumber: string; cardNumberNormalized: string; status: VisitorCardStatus }, expected: VisitorCardExpectedState) {
    return this.mutateCard(id, { cardNumber: input.cardNumber, cardNumberNormalized: input.cardNumberNormalized, status: input.status, ...(input.status === "AVAILABLE" || input.status === "DISABLED" ? { currentVisitId: null, assignedVisitorName: null } : {}) }, expected)
  }
  async setCardStatus(id: string, status: VisitorCardStatus, expected: VisitorCardExpectedState) {
    return this.mutateCard(id, { status, ...(status === "AVAILABLE" || status === "DISABLED" ? { currentVisitId: null, assignedVisitorName: null } : {}) }, expected)
  }
  async deleteCard(id: string, expected: VisitorCardExpectedState) {
    try {
      const deleted = await this.prisma.visitorCard.deleteMany({ where: { id, status: expected.status, currentVisitId: expected.currentVisitId } })
      if (deleted.count !== 1) throw new VisitorCardConflictError("CARD_STATE_CHANGED")
    } catch (error) {
      if (error instanceof VisitorCardConflictError) throw error
      if (isWriteConflictError(error)) throw new VisitorCardConflictError("CARD_STATE_CHANGED")
      throw error
    }
  }
  private async mutateCard(id: string, data: Prisma.VisitorCardUpdateManyMutationInput, expected: VisitorCardExpectedState) {
    try {
      const changed = await this.prisma.visitorCard.updateMany({ where: { id, status: expected.status, currentVisitId: expected.currentVisitId }, data })
      if (changed.count !== 1) throw new VisitorCardConflictError("CARD_STATE_CHANGED")
      const row = await this.prisma.visitorCard.findUnique({ where: { id } })
      if (!row) throw new VisitorCardConflictError("CARD_STATE_CHANGED")
      return toCard(row)
    } catch (error) {
      if (error instanceof VisitorCardConflictError) throw error
      if (isWriteConflictError(error)) throw new VisitorCardConflictError("CARD_STATE_CHANGED")
      throw error
    }
  }
  async checkIn(visitId: string, input: SecurityCheckInInput, now: Date) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { ...visitInclude, meeting: { include: { visitType: true, hostCompany: true, facility: true, hostEmployee: { include: { user: true } } } } } })
        const card = await tx.visitorCard.findUnique({ where: { id: input.visitorCardId } })
        if (!visit || !card || visit.status !== "PLANNED" || card.status !== "AVAILABLE" || card.currentVisitId !== null) throw new CheckInConflictError()
        const accepted = await tx.visitRuleAcceptance.findFirst({ where: { visitId } })
        if (!accepted) throw new Error("Missing rule acceptance.")
        const visitChanged = await tx.visit.updateMany({ where: { id: visitId, status: "PLANNED", visitorCardId: null }, data: { status: "CHECKED_IN", actualCheckIn: now, visitorCardId: card.id, visitorCardNumber: card.cardNumber, vehiclePlate: input.vehiclePlate } })
        if (visitChanged.count !== 1) throw new CheckInConflictError()
        if (input.phone) await tx.visitor.update({ where: { id: visit.visitorId }, data: { phone: input.phone } })
        const cardChanged = await tx.visitorCard.updateMany({ where: { id: card.id, status: "AVAILABLE", currentVisitId: null }, data: { status: "IN_USE", currentVisitId: visitId, assignedVisitorName: `${visit.visitor.firstName} ${visit.visitor.lastName}` } })
        if (cardChanged.count !== 1) throw new CheckInConflictError()
        const updated = await tx.visit.findUniqueOrThrow({ where: { id: visitId }, include: visitInclude })
        return { visit: toVisit(updated), hostEmail: visit.meeting.hostEmployee?.user?.email ?? undefined, hostName: visit.meeting.hostEmployee?.fullName ?? undefined }
      }, { isolationLevel: "Serializable" })
    } catch (error) {
      if (error instanceof CheckInConflictError || isCheckInWriteConflict(error)) throw new CheckInConflictError()
      throw error
    }
  }
  async checkOut(visitId: string, cardReturned: boolean, now: Date) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { meeting: true } })
        if (!visit || visit.status !== "CHECKED_IN" || !visit.visitorCardId) throw new VisitorCardConflictError("INVALID_CHECKOUT_STATE")
        const card = await tx.visitorCard.findUnique({ where: { id: visit.visitorCardId } })
        if (!card || card.status !== "IN_USE" || card.currentVisitId !== visitId) throw new VisitorCardConflictError("INVALID_CARD_ASSIGNMENT")
        const visitChanged = await tx.visit.updateMany({ where: { id: visitId, status: "CHECKED_IN", visitorCardId: card.id }, data: { status: "CHECKED_OUT", actualCheckOut: now, visitorCardReturned: cardReturned } })
        if (visitChanged.count !== 1) throw new VisitorCardConflictError("INVALID_CHECKOUT_STATE")
        const cardChanged = await tx.visitorCard.updateMany({ where: { id: card.id, status: "IN_USE", currentVisitId: visitId }, data: cardReturned ? { status: "AVAILABLE", currentVisitId: null, assignedVisitorName: null } : { status: "NOT_RETURNED" } })
        if (cardChanged.count !== 1) throw new VisitorCardConflictError("INVALID_CARD_ASSIGNMENT")
        const stillInside = await tx.visit.count({ where: { meetingId: visit.meetingId, status: "CHECKED_IN" } })
        if (!visit.meeting.actualMeetingEnd && stillInside === 0) await tx.meeting.update({ where: { id: visit.meetingId }, data: { actualMeetingEnd: now, meetingEndSource: "VISITOR_CHECK_OUT" } })
      }, { isolationLevel: "Serializable" })
    } catch (error) {
      if (error instanceof VisitorCardConflictError) throw error
      if (isWriteConflictError(error)) throw new VisitorCardConflictError("CARD_STATE_CHANGED")
      throw error
    }
  }
  async listUnreturnedIssues() { const cards = await this.prisma.visitorCard.findMany({ where: { status: "NOT_RETURNED", currentVisitId: { not: null } }, include: { currentVisit: { include: visitInclude } } }); return cards.flatMap((card) => card.currentVisit && card.currentVisit.status === "CHECKED_OUT" && card.currentVisit.visitorCardReturned === false ? [{ card: toCard(card), visit: toVisit(card.currentVisit) }] : []) }
  async lateReturn(visitId: string, now: Date) {
    void now
    try {
      await this.prisma.$transaction(async (tx) => {
        const visit = await tx.visit.findUnique({ where: { id: visitId } })
        if (!visit?.visitorCardId || visit.status !== "CHECKED_OUT" || visit.visitorCardReturned !== false) throw new VisitorCardConflictError("INVALID_LATE_RETURN_STATE")
        const card = await tx.visitorCard.findUnique({ where: { id: visit.visitorCardId } })
        if (!card || card.status !== "NOT_RETURNED" || card.currentVisitId !== visitId) throw new VisitorCardConflictError("INVALID_CARD_ASSIGNMENT")
        const visitChanged = await tx.visit.updateMany({ where: { id: visitId, status: "CHECKED_OUT", visitorCardId: card.id, visitorCardReturned: false }, data: { visitorCardReturned: true } })
        if (visitChanged.count !== 1) throw new VisitorCardConflictError("INVALID_LATE_RETURN_STATE")
        const cardChanged = await tx.visitorCard.updateMany({ where: { id: card.id, status: "NOT_RETURNED", currentVisitId: visitId }, data: { status: "AVAILABLE", currentVisitId: null, assignedVisitorName: null } })
        if (cardChanged.count !== 1) throw new VisitorCardConflictError("INVALID_CARD_ASSIGNMENT")
      }, { isolationLevel: "Serializable" })
    } catch (error) {
      if (error instanceof VisitorCardConflictError) throw error
      if (isWriteConflictError(error)) throw new VisitorCardConflictError("CARD_STATE_CHANGED")
      throw error
    }
  }
  async createUnplanned(input: CreateUnplannedInput, creatorEmployeeId: string, now: Date) {
    let id: string
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const rule = await tx.visitorRuleVersion.findFirst({ where: { active: true }, orderBy: { version: "desc" } })
        const card = await tx.visitorCard.findUnique({ where: { id: input.visitorCardId } })
        if (!rule) throw new NoActiveVisitorRuleError()
        if (!card || card.status !== "AVAILABLE" || card.currentVisitId !== null) throw new CheckInConflictError()
        const visitor = await tx.visitor.create({ data: { firstName: input.firstName, lastName: input.lastName, company: input.company } })
        const meeting = await tx.meeting.create({ data: { creatorEmployeeId, visitTypeId: input.visitTypeId, hostEmployeeId: null, hostEmployeeName: input.hostEmployeeName, hostCompanyId: input.companyId, facilityId: input.facilityId, plannedStart: now, plannedEnd: new Date(now.getTime() + input.durationMinutes * 60_000), hasAdditionalRequirements: false } })
        const visit = await tx.visit.create({ data: { meetingId: meeting.id, visitorId: visitor.id, status: "CHECKED_IN", actualCheckIn: now, visitorCardId: card.id, visitorCardNumber: card.cardNumber, vehiclePlate: input.vehiclePlate } })
        await tx.visitRuleAcceptance.create({ data: { visitId: visit.id, visitorId: visitor.id, visitorRuleVersionId: rule.id, ruleVersion: rule.version, acceptedAt: now, method: "SECURITY_DESK", contentSnapshot: rule.content } })
        const cardChanged = await tx.visitorCard.updateMany({ where: { id: card.id, status: "AVAILABLE", currentVisitId: null }, data: { status: "IN_USE", currentVisitId: visit.id, assignedVisitorName: `${visitor.firstName} ${visitor.lastName}` } })
        if (cardChanged.count !== 1) throw new CheckInConflictError()
        return visit.id
      }, { isolationLevel: "Serializable" })
    } catch (error) {
      if (error instanceof CheckInConflictError || isCheckInWriteConflict(error)) throw new CheckInConflictError()
      throw error
    }
    return (await this.findVisit(id))!
  }
  async correctVisitor(visitId: string, input: SecurityCorrectionInput, actor: EmployeeActor | null, now: Date) { await this.prisma.$transaction(async (tx) => { const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { meeting: true } }); if (!visit) return; const hostChanged = visit.meeting.hostEmployeeName !== input.hostEmployeeName; await tx.visitor.update({ where: { id: visit.visitorId }, data: { firstName: input.firstName, lastName: input.lastName, email: input.email, company: input.company, phone: input.phone } }); await tx.meeting.update({ where: { id: visit.meetingId }, data: hostChanged ? { hostEmployeeName: input.hostEmployeeName } : {} }); if (hostChanged) await tx.hostCorrectionAudit.create({ data: { visitId, previousHostName: visit.meeting.hostEmployeeName, correctedHostName: input.hostEmployeeName, correctedByUserId: actor?.userId ?? null, correctedByEmployeeId: actor?.id ?? null, correctedAt: now } }) }, { isolationLevel: "Serializable" }) }
}
