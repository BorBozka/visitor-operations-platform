import type { Prisma, PrismaClient, VisitorCard, VisitorRuleVersion, VisitType } from "@prisma/client"

import { ApiError } from "../lib/api-error.js"
import { isWriteConflictError, withWriteConflictRetry } from "../lib/prisma-conflict.js"
import type {
  CreateUnplannedInput, EmployeeActor, MeetingDto, MeetingInput, MeetingWithVisitsDto,
  RuleAcceptanceDto, SecurityCheckInInput, SecurityCorrectionInput,
  VisitorCardDto, VisitorRuleDto, VisitDto, VisitTypeDto,
} from "../modules/visitor-operations/types.js"
import { parseEnum, invitationStatuses, ruleAcceptanceMethods, visitorCardStatuses, visitStatuses } from "../modules/visitor-operations/types.js"
import { assertMeetingPlanningUnlocked } from "../modules/visitor-operations/meeting-planning-lock.js"
import type { ResourceExtensionGuard } from "./resource-assignment-repository.js"

const invitationReset = { invitationStatus: "NOT_SENT", invitationSentAt: null, invitationError: null } as const

export class CheckInConflictError extends Error {
  constructor() {
    super("Check-in state changed concurrently.")
    this.name = "CheckInConflictError"
  }
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
  prepareInvitation(visitId: string, tokenHash: string): Promise<{ visit: VisitDto; claimed: boolean }>
  finishInvitation(visitId: string, succeeded: boolean, now: Date): Promise<void>
  findPublicPreRegistration(tokenHash: string): Promise<{ visit: VisitDto; activeRule: VisitorRuleDto | null } | null>
  updatePublicVisitor(tokenHash: string, input: { firstName: string; lastName: string; email?: string; company: string; phone?: string; vehiclePlate?: string }): Promise<void>
  acceptPublicRule(tokenHash: string, ipAddress?: string): Promise<RuleAcceptanceDto>
  listRules(): Promise<VisitorRuleDto[]>
  getActiveRule(): Promise<VisitorRuleDto | null>
  publishRule(content: string, now: Date): Promise<VisitorRuleDto>
  listCards(): Promise<VisitorCardDto[]>
  findCard(id: string): Promise<VisitorCardDto | null>
  saveCard(input: { id?: string; cardNumber: string; cardNumberNormalized: string; status?: string }): Promise<VisitorCardDto>
  setCardStatus(id: string, status: string): Promise<VisitorCardDto>
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
      await tx.visit.updateMany({ where: { meetingId: id, status: "PLANNED" }, data: invitationReset })
    })
    return (await this.findMeeting(id))!
  }
  async updateMeetingTimes(id: string, plannedStart: Date, plannedEnd: Date) {
    await this.writeSharedPlanning(id, async (tx) => {
      await tx.meeting.update({ where: { id }, data: { plannedStart, plannedEnd } })
      await tx.visit.updateMany({ where: { meetingId: id, status: "PLANNED" }, data: invitationReset })
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
        await tx.visit.updateMany({ where: { meetingId: id, status: "PLANNED" }, data: invitationReset })
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
  async prepareInvitation(visitId: string, tokenHash: string) {
    let claimed = false
    await this.prisma.$transaction(async (tx) => {
      const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { visitor: true } })
      if (!visit || visit.status !== "PLANNED" || !visit.visitor.email || !["NOT_SENT", "FAILED"].includes(visit.invitationStatus)) return
      const changed = await tx.visit.updateMany({ where: { id: visitId, invitationStatus: { in: ["NOT_SENT", "FAILED"] } }, data: { invitationStatus: "SENDING", invitationError: null } })
      if (changed.count) {
        claimed = true
        await tx.invitation.upsert({ where: { visitId }, create: { visitId, tokenHash }, update: { tokenHash } })
      }
    })
    return { visit: (await this.findVisit(visitId))!, claimed }
  }
  async finishInvitation(visitId: string, succeeded: boolean, now: Date) { await this.prisma.visit.updateMany({ where: { id: visitId, invitationStatus: "SENDING" }, data: succeeded ? { invitationStatus: "SENT", invitationSentAt: now, invitationError: null } : { invitationStatus: "FAILED", invitationError: "Davet teknik bir hata nedeniyle gönderilemedi." } }) }
  async findPublicPreRegistration(tokenHash: string) { const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash }, include: { visit: { include: visitInclude } } }); if (!invitation) return null; const active = await this.prisma.visitorRuleVersion.findFirst({ where: { active: true }, orderBy: { version: "desc" } }); return { visit: toVisit(invitation.visit), activeRule: active ? toRule(active) : null } }
  async updatePublicVisitor(tokenHash: string, input: { firstName: string; lastName: string; email?: string; company: string; phone?: string; vehiclePlate?: string }) { await this.prisma.$transaction(async (tx) => { const invitation = await tx.invitation.findUnique({ where: { tokenHash }, include: { visit: true } }); if (!invitation) return; await tx.visitor.update({ where: { id: invitation.visit.visitorId }, data: { firstName: input.firstName, lastName: input.lastName, email: input.email, company: input.company, phone: input.phone } }); await tx.visit.update({ where: { id: invitation.visitId }, data: { vehiclePlate: input.vehiclePlate } }) }) }
  async acceptPublicRule(tokenHash: string, ipAddress?: string) { return this.prisma.$transaction(async (tx) => { const invitation = await tx.invitation.findUnique({ where: { tokenHash }, include: { visit: true } }); const rule = await tx.visitorRuleVersion.findFirst({ where: { active: true }, orderBy: { version: "desc" } }); if (!invitation || !rule) throw new Error("Missing invitation or rule."); const existing = await tx.visitRuleAcceptance.findUnique({ where: { visitId_visitorRuleVersionId: { visitId: invitation.visitId, visitorRuleVersionId: rule.id } } }); const row = existing ?? await tx.visitRuleAcceptance.create({ data: { visitId: invitation.visitId, visitorId: invitation.visit.visitorId, visitorRuleVersionId: rule.id, ruleVersion: rule.version, acceptedAt: new Date(), method: "INVITATION_LINK", contentSnapshot: rule.content, integrityHash: null, ipAddress: ipAddress ?? null } }); return { id: row.id, ruleId: row.visitorRuleVersionId, ruleVersion: row.ruleVersion, acceptedAt: row.acceptedAt.toISOString(), method: parseEnum(ruleAcceptanceMethods, row.method, "rule acceptance method"), contentSnapshot: row.contentSnapshot } }) }
  async listRules() { return (await this.prisma.visitorRuleVersion.findMany({ orderBy: { version: "desc" } })).map(toRule) }
  async getActiveRule() { const row = await this.prisma.visitorRuleVersion.findFirst({ where: { active: true }, orderBy: { version: "desc" } }); return row ? toRule(row) : null }
  async publishRule(content: string, now: Date) { const row = await this.prisma.$transaction(async (tx) => { const latest = await tx.visitorRuleVersion.findFirst({ orderBy: { version: "desc" }, select: { version: true } }); await tx.visitorRuleVersion.updateMany({ where: { active: true }, data: { active: false } }); return tx.visitorRuleVersion.create({ data: { version: (latest?.version ?? 0) + 1, content, publishedAt: now, active: true } }) }, { isolationLevel: "Serializable" }); return toRule(row) }
  async listCards() { return (await this.prisma.visitorCard.findMany({ orderBy: { cardNumber: "asc" } })).map(toCard) }
  async findCard(id: string) { const row = await this.prisma.visitorCard.findUnique({ where: { id } }); return row ? toCard(row) : null }
  async saveCard(input: { id?: string; cardNumber: string; cardNumberNormalized: string; status?: string }) { const row = input.id ? await this.prisma.visitorCard.update({ where: { id: input.id }, data: { cardNumber: input.cardNumber, cardNumberNormalized: input.cardNumberNormalized } }) : await this.prisma.visitorCard.create({ data: { cardNumber: input.cardNumber, cardNumberNormalized: input.cardNumberNormalized, status: input.status ?? "AVAILABLE" } }); return toCard(row) }
  async setCardStatus(id: string, status: string) { return toCard(await this.prisma.visitorCard.update({ where: { id }, data: { status, ...(status === "AVAILABLE" || status === "DISABLED" ? { currentVisitId: null, assignedVisitorName: null } : {}) } })) }
  async checkIn(visitId: string, input: SecurityCheckInInput, now: Date) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { ...visitInclude, meeting: { include: { visitType: true, hostCompany: true, facility: true, hostEmployee: { include: { user: true } } } } } })
        const card = await tx.visitorCard.findUnique({ where: { id: input.visitorCardId } })
        if (!visit || !card || visit.status !== "PLANNED" || card.status !== "AVAILABLE") throw new CheckInConflictError()
        const accepted = await tx.visitRuleAcceptance.findFirst({ where: { visitId } })
        if (!accepted) throw new Error("Missing rule acceptance.")
        await tx.visit.update({ where: { id: visitId }, data: { status: "CHECKED_IN", actualCheckIn: now, visitorCardId: card.id, visitorCardNumber: card.cardNumber, vehiclePlate: input.vehiclePlate } })
        if (input.phone) await tx.visitor.update({ where: { id: visit.visitorId }, data: { phone: input.phone } })
        await tx.visitorCard.update({ where: { id: card.id }, data: { status: "IN_USE", currentVisitId: visitId, assignedVisitorName: `${visit.visitor.firstName} ${visit.visitor.lastName}` } })
        const updated = await tx.visit.findUniqueOrThrow({ where: { id: visitId }, include: visitInclude })
        return { visit: toVisit(updated), hostEmail: visit.meeting.hostEmployee?.user?.email ?? undefined, hostName: visit.meeting.hostEmployee?.fullName ?? undefined }
      }, { isolationLevel: "Serializable" })
    } catch (error) {
      if (error instanceof CheckInConflictError || isCheckInWriteConflict(error)) throw new CheckInConflictError()
      throw error
    }
  }
  async checkOut(visitId: string, cardReturned: boolean, now: Date) { await this.prisma.$transaction(async (tx) => { const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { meeting: true } }); if (!visit || visit.status !== "CHECKED_IN" || !visit.visitorCardId) throw new Error("Invalid checkout state."); const card = await tx.visitorCard.findUnique({ where: { id: visit.visitorCardId } }); if (!card || card.status !== "IN_USE" || card.currentVisitId !== visitId) throw new Error("Invalid card assignment."); await tx.visit.update({ where: { id: visitId }, data: { status: "CHECKED_OUT", actualCheckOut: now, visitorCardReturned: cardReturned } }); await tx.visitorCard.update({ where: { id: card.id }, data: cardReturned ? { status: "AVAILABLE", currentVisitId: null, assignedVisitorName: null } : { status: "NOT_RETURNED" } }); const stillInside = await tx.visit.count({ where: { meetingId: visit.meetingId, status: "CHECKED_IN" } }); if (!visit.meeting.actualMeetingEnd && stillInside === 0) await tx.meeting.update({ where: { id: visit.meetingId }, data: { actualMeetingEnd: now, meetingEndSource: "VISITOR_CHECK_OUT" } }) }, { isolationLevel: "Serializable" }) }
  async listUnreturnedIssues() { const cards = await this.prisma.visitorCard.findMany({ where: { status: "NOT_RETURNED", currentVisitId: { not: null } }, include: { currentVisit: { include: visitInclude } } }); return cards.flatMap((card) => card.currentVisit && card.currentVisit.status === "CHECKED_OUT" && card.currentVisit.visitorCardReturned === false ? [{ card: toCard(card), visit: toVisit(card.currentVisit) }] : []) }
  async lateReturn(visitId: string, now: Date) { void now; await this.prisma.$transaction(async (tx) => { const visit = await tx.visit.findUnique({ where: { id: visitId } }); if (!visit?.visitorCardId || visit.status !== "CHECKED_OUT" || visit.visitorCardReturned !== false) throw new Error("Invalid late return state."); const card = await tx.visitorCard.findUnique({ where: { id: visit.visitorCardId } }); if (!card || card.status !== "NOT_RETURNED" || card.currentVisitId !== visitId) throw new Error("Invalid card assignment."); await tx.visit.update({ where: { id: visitId }, data: { visitorCardReturned: true } }); await tx.visitorCard.update({ where: { id: card.id }, data: { status: "AVAILABLE", currentVisitId: null, assignedVisitorName: null } }) }, { isolationLevel: "Serializable" }) }
  async createUnplanned(input: CreateUnplannedInput, creatorEmployeeId: string, now: Date) { const id = await this.prisma.$transaction(async (tx) => { const rule = await tx.visitorRuleVersion.findFirst({ where: { active: true }, orderBy: { version: "desc" } }); const card = await tx.visitorCard.findUnique({ where: { id: input.visitorCardId } }); if (!rule || !card || card.status !== "AVAILABLE") throw new Error("Missing active rule or available card."); const visitor = await tx.visitor.create({ data: { firstName: input.firstName, lastName: input.lastName, company: input.company } }); const meeting = await tx.meeting.create({ data: { creatorEmployeeId, visitTypeId: input.visitTypeId, hostEmployeeId: null, hostEmployeeName: input.hostEmployeeName, hostCompanyId: input.companyId, facilityId: input.facilityId, plannedStart: now, plannedEnd: new Date(now.getTime() + input.durationMinutes * 60_000), hasAdditionalRequirements: false } }); const visit = await tx.visit.create({ data: { meetingId: meeting.id, visitorId: visitor.id, status: "CHECKED_IN", actualCheckIn: now, visitorCardId: card.id, visitorCardNumber: card.cardNumber, vehiclePlate: input.vehiclePlate } }); await tx.visitRuleAcceptance.create({ data: { visitId: visit.id, visitorId: visitor.id, visitorRuleVersionId: rule.id, ruleVersion: rule.version, acceptedAt: now, method: "SECURITY_DESK", contentSnapshot: rule.content } }); await tx.visitorCard.update({ where: { id: card.id }, data: { status: "IN_USE", currentVisitId: visit.id, assignedVisitorName: `${visitor.firstName} ${visitor.lastName}` } }); return visit.id }, { isolationLevel: "Serializable" }); return (await this.findVisit(id))! }
  async correctVisitor(visitId: string, input: SecurityCorrectionInput, actor: EmployeeActor | null, now: Date) { await this.prisma.$transaction(async (tx) => { const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { meeting: true } }); if (!visit) return; const hostChanged = visit.meeting.hostEmployeeName !== input.hostEmployeeName; await tx.visitor.update({ where: { id: visit.visitorId }, data: { firstName: input.firstName, lastName: input.lastName, email: input.email, company: input.company, phone: input.phone } }); await tx.meeting.update({ where: { id: visit.meetingId }, data: { ...(hostChanged ? { hostEmployeeName: input.hostEmployeeName } : {}), ...(input.visitTypeId ? { visitTypeId: input.visitTypeId } : {}) } }); if (hostChanged) await tx.hostCorrectionAudit.create({ data: { visitId, previousHostName: visit.meeting.hostEmployeeName, correctedHostName: input.hostEmployeeName, correctedByUserId: actor?.userId ?? null, correctedByEmployeeId: actor?.id ?? null, correctedAt: now } }) }, { isolationLevel: "Serializable" }) }
}
