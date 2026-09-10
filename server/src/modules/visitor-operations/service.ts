import { createHash, randomBytes } from "node:crypto"

import type { DeliveryLogger, EmailSender } from "../../delivery/email-sender.js"
import { consoleDeliveryLogger } from "../../delivery/email-sender.js"
import { ApiError } from "../../lib/api-error.js"
import { scopeAllows, type AccessContext } from "../../lib/authorization.js"
import { CheckInConflictError, NoActiveVisitorRuleError, PublicInvitationInactiveError, VisitorCardConflictError, type VisitorOperationsRepository } from "../../repositories/visitor-operations-repository.js"
import { assertMeetingPlanningUnlocked } from "./meeting-planning-lock.js"
import type {
  CreateUnplannedInput, MeetingDto, MeetingInput, PublicPreRegistrationDto, SecurityCheckInInput,
  SecurityCorrectionInput, VisitorCardDto, VisitDto,
} from "./types.js"
import { normalizeCardNumber, normalizeOptional, normalizePlate, normalizeVisitTypeName, validEmail } from "./types.js"

const terminal = new Set(["CHECKED_OUT", "CANCELLED", "NO_SHOW"])
const securityOperationalStatuses = new Set(["PLANNED", "CHECKED_IN"])

const notFound = () => new ApiError(404, "NOT_FOUND", "Ziyaret bulunamadı.")
/** The single public response for an unusable invitation link — never says *why* it is unusable. */
const invitationNotFound = () => new ApiError(404, "INVITATION_NOT_FOUND", "Davet bağlantısı geçersiz veya süresi dolmuş.")
const noActiveRule = () => new ApiError(409, "NO_ACTIVE_RULE", "Aktif ziyaretçi kuralı bulunmuyor.")
const mutationForbidden = () =>
  new ApiError(403, "VISIT_MUTATION_FORBIDDEN", "Bu ziyaret grubu üzerinde değişiklik yapma yetkiniz yok.")

/**
 * May a manual send/resend attempt this invitation at all? `SENT` is never re-sent, and a
 * `SENDING` attempt still in flight is left alone so a concurrent resend cannot mail twice. A
 * `SENDING` attempt the server has marked stale — one a process restart abandoned — is retryable;
 * this is only the cheap snapshot check, and `prepareInvitation`'s compare-and-set is what
 * actually decides who gets to send.
 */
function invitationSendable(visit: Pick<VisitDto, "invitationStatus" | "invitationSendStale">): boolean {
  if (visit.invitationStatus === "NOT_SENT" || visit.invitationStatus === "FAILED") return true
  return visit.invitationStatus === "SENDING" && visit.invitationSendStale === true
}

/**
 * The outcome of one internal delivery attempt. `attempted` is `true` only when this request held
 * the send claim and so owns `visit` as its own result; `false` means another sender holds the
 * claim (or an attempt is still in flight) and this request mailed nothing at all.
 */
type InvitationDelivery = { attempted: boolean; visit: VisitDto }

/** Is a meeting visible to this caller (scope + role-specific ownership)? */
function isMeetingVisible(ctx: AccessContext, meeting: Pick<MeetingDto, "hostCompanyId" | "facilityId" | "creatorEmployeeId" | "hostEmployeeId">): boolean {
  if (!scopeAllows(ctx, { companyId: meeting.hostCompanyId, facilityId: meeting.facilityId })) return false
  if (ctx.role === "MANAGER" || ctx.role === "ADMIN" || ctx.role === "SECURITY") return true
  // EMPLOYEE: only meetings they created or host.
  return meeting.creatorEmployeeId === ctx.employeeId || (meeting.hostEmployeeId ?? "") === ctx.employeeId
}

/**
 * Guards a meeting/visit mutation. An out-of-scope target is reported as 404 (no cross-scope
 * leak); an in-scope target owned by another user is 403. ADMIN may mutate any in-scope meeting;
 * EMPLOYEE and MANAGER may mutate only ones they created.
 */
function assertMeetingMutable(ctx: AccessContext, meeting: Pick<MeetingDto, "hostCompanyId" | "facilityId" | "creatorEmployeeId">): void {
  if (!scopeAllows(ctx, { companyId: meeting.hostCompanyId, facilityId: meeting.facilityId })) throw notFound()
  if (ctx.role === "ADMIN") return
  if ((ctx.role === "EMPLOYEE" || ctx.role === "MANAGER") && meeting.creatorEmployeeId === ctx.employeeId) return
  throw mutationForbidden()
}

export class VisitorOperationsService {
  constructor(
    private readonly repository: VisitorOperationsRepository,
    private readonly emailSender: EmailSender,
    private readonly webOrigin: string,
    private readonly logger: DeliveryLogger = consoleDeliveryLogger,
    private readonly now: () => Date = () => new Date(),
    private readonly createInvitationToken: () => string = () => randomBytes(32).toString("base64url"),
  ) {}

  listVisitTypes(includeInactive = false) { return this.repository.listVisitTypes(includeInactive) }
  async createVisitType(input: { name: string; active: boolean }) { return this.saveVisitType(undefined, input) }
  async updateVisitType(id: string, input: { name: string; active: boolean }) { await this.requireVisitType(id); return this.saveVisitType(id, input) }
  async setVisitTypeActive(id: string, active: boolean) { const current = await this.requireVisitType(id); return this.repository.saveVisitType({ id, name: current.name, nameNormalized: normalizeVisitTypeName(current.name), active }) }

  async listMeetings(ctx: AccessContext) {
    const meetings = await this.repository.listMeetings()
    if (ctx.role === "SECURITY") {
      const operationalMeetingIds = new Set(
        (await this.repository.listVisits())
          .filter((visit) => securityOperationalStatuses.has(visit.status) && isMeetingVisible(ctx, visit.meeting))
          .map((visit) => visit.meetingId),
      )
      return meetings.filter((meeting) => operationalMeetingIds.has(meeting.id))
    }
    return meetings.filter((meeting) => isMeetingVisible(ctx, meeting))
  }

  async listVisits(ctx: AccessContext) {
    return (await this.repository.listVisits()).filter((visit) => {
      if (!isMeetingVisible(ctx, visit.meeting)) return false
      return ctx.role === "SECURITY" ? securityOperationalStatuses.has(visit.status) : true
    })
  }

  async getMeeting(id: string) { const meeting = await this.repository.findMeeting(id); if (!meeting) throw new ApiError(404, "NOT_FOUND", "Ziyaret grubu bulunamadı."); return meeting }

  /** Detail read that hides a meeting outside the caller's scope/ownership behind the same 404. */
  async getVisibleMeeting(id: string, ctx: AccessContext) {
    const meeting = await this.getMeeting(id)
    if (!isMeetingVisible(ctx, meeting.meeting)) throw new ApiError(404, "NOT_FOUND", "Ziyaret grubu bulunamadı.")
    return meeting
  }

  async getVisibleVisit(id: string, ctx: AccessContext) {
    const visit = await this.requireVisit(id)
    if (!isMeetingVisible(ctx, visit.meeting)) throw notFound()
    return visit
  }

  async getReferenceData(ctx: AccessContext) {
    return scopeReferenceData(ctx, await this.repository.getReferenceData(ctx.userId))
  }

  async createMeeting(input: MeetingInput, ctx: AccessContext) {
    const actor = await this.requireActor(ctx.userId)
    if (!scopeAllows(ctx, { companyId: input.hostCompanyId, facilityId: input.facilityId })) throw mutationForbidden()
    const validated = await this.validateMeetingInput(input)
    return this.repository.createMeeting(validated.input, actor.id, validated.hostEmployeeId)
  }

  async updateMeeting(id: string, input: MeetingInput, ctx: AccessContext) {
    const current = await this.getMeeting(id)
    assertMeetingMutable(ctx, current.meeting)
    if (!scopeAllows(ctx, { companyId: input.hostCompanyId, facilityId: input.facilityId })) throw mutationForbidden()
    if (current.meeting.actualMeetingEnd) throw new ApiError(409, "MEETING_CLOSED", "Kapatılmış bir toplantı düzenlenemez.")
    assertMeetingPlanningUnlocked(current.visits.map((visit) => visit.status))
    const submittedIds = input.visitors.flatMap((visitor) => visitor.visitId ? [visitor.visitId] : [])
    if (new Set(submittedIds).size !== submittedIds.length || submittedIds.some((visitId) => !current.visits.some((visit) => visit.id === visitId))) throw new ApiError(400, "VALIDATION_ERROR", "Ziyaret grubu dışındaki veya yinelenen ziyaret kayıtları gönderilemez.")
    const validated = await this.validateMeetingInput(input, current.meeting.visitTypeId)
    return this.repository.updateMeeting(id, validated.input, validated.hostEmployeeId)
  }

  async rescheduleVisit(id: string, input: { plannedStart: string; plannedEnd: string }, ctx: AccessContext) {
    const visit = await this.requireVisit(id)
    assertMeetingMutable(ctx, visit.meeting)
    this.requireStatus(visit, "PLANNED", "Yalnızca planlanmış ziyaret yeniden planlanabilir.")
    this.assertTimes(input.plannedStart, input.plannedEnd)
    if (visit.meeting.actualMeetingEnd) throw new ApiError(409, "MEETING_CLOSED", "Kapatılmış bir toplantı yeniden planlanamaz.")
    // Reschedule moves the Meeting's shared time window, not just this visitor's plan.
    const group = await this.getMeeting(visit.meetingId)
    assertMeetingPlanningUnlocked(group.visits.map((item) => item.status))
    await this.repository.updateMeetingTimes(visit.meetingId, new Date(input.plannedStart), new Date(input.plannedEnd))
    return this.requireVisit(id)
  }

  async cancelVisit(id: string, ctx: AccessContext) { const visit = await this.requireVisit(id); assertMeetingMutable(ctx, visit.meeting); this.requireStatus(visit, "PLANNED", "Yalnızca planlanmış ziyaret iptal edilebilir."); await this.repository.cancelVisit(id, ctx.userId, this.now()); return this.requireVisit(id) }
  async cancelMeeting(id: string, ctx: AccessContext) { const meeting = await this.getMeeting(id); assertMeetingMutable(ctx, meeting.meeting); await this.repository.cancelMeeting(id, ctx.userId, this.now()); return this.getMeeting(id) }

  async extendMeeting(id: string, extensionMinutes: number, ctx: AccessContext) {
    const actor = await this.requireActor(ctx.userId); const meeting = await this.getMeeting(id); const now = this.now()
    // Lifecycle is host-identity gated (assertManualLifecycle); scope only hides an out-of-reach meeting.
    if (!scopeAllows(ctx, { companyId: meeting.meeting.hostCompanyId, facilityId: meeting.meeting.facilityId })) throw new ApiError(404, "NOT_FOUND", "Ziyaret grubu bulunamadı.")
    if (!Number.isInteger(extensionMinutes) || extensionMinutes <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Uzatma süresi pozitif bir tam sayı dakika olmalıdır.")
    this.assertManualLifecycle(meeting.meeting, meeting.visits, actor.id, now)
    const base = Math.max(new Date(meeting.meeting.plannedEnd).getTime(), now.getTime())
    // extendMeetingTimes re-validates the Meeting's ROOM / POOLED_EQUIPMENT assignments for the
    // new range and moves plannedEnd in one transaction; a resource conflict rejects it whole.
    await this.repository.extendMeetingTimes(id, new Date(meeting.meeting.plannedStart), new Date(base + extensionMinutes * 60_000))
    return this.getMeeting(id)
  }

  async closeMeeting(id: string, ctx: AccessContext) {
    const actor = await this.requireActor(ctx.userId); const meeting = await this.getMeeting(id); const now = this.now()
    if (!scopeAllows(ctx, { companyId: meeting.meeting.hostCompanyId, facilityId: meeting.meeting.facilityId })) throw new ApiError(404, "NOT_FOUND", "Ziyaret grubu bulunamadı.")
    this.assertManualLifecycle(meeting.meeting, meeting.visits, actor.id, now)
    await this.repository.closeMeeting(id, "MANUAL", now)
    return this.getMeeting(id)
  }

  async sendMeetingInvitations(id: string, ctx: AccessContext) {
    const meeting = await this.getMeeting(id)
    assertMeetingMutable(ctx, meeting.meeting)
    const delivered: VisitDto[] = []
    for (const visit of meeting.visits) {
      if (visit.status !== "PLANNED" || !visit.visitor.email || !invitationSendable(visit)) continue
      // Only a visit this batch actually claimed belongs in the result. A claim lost to a
      // concurrent sender — or an attempt that turned out to still be in flight — mailed nothing
      // here, and returning it would let the caller count a `SENDING` record as delivered.
      const delivery = await this.deliverInvitation(visit.id)
      if (delivery.attempted) delivered.push(delivery.visit)
    }
    return delivered
  }

  async sendVisitInvitation(id: string, ctx: AccessContext) {
    const current = await this.requireVisit(id)
    assertMeetingMutable(ctx, current.meeting)
    return (await this.deliverInvitation(id)).visit
  }

  /**
   * The checks below run on a snapshot that is only a cheap, user-facing guard — every one of them
   * (`PLANNED`, a usable address, sendability) is re-asserted by `prepareInvitation`'s
   * compare-and-set, and losing that claim means no email is sent at all.
   *
   * The claim is equally the authority on *what* is mailed. A planner edit committing between the
   * guard read and the claim moves the visitor's address and the Meeting's details while revoking
   * the old token (NEW-1), so the claim can succeed on a record that no longer resembles `current`.
   * Addressing or wording the mail from `current` would then deliver the freshly claimed — valid —
   * token to the address the edit replaced, which is why every user-visible field below is read off
   * `prepared.visit`, the snapshot the claim transaction returned.
   *
   * `attempted` is what the callers need out of that claim: it is `true` only for the one request
   * that won the right to send and therefore produced this invitation's outcome. A request that
   * finds an attempt already in flight, or loses the compare-and-set to a concurrent sender, mails
   * nothing and gets `attempted: false` with whatever the record currently reads — typically
   * `SENDING`, the winner's in-flight claim. That state is *not* this request's result, so no
   * caller may present it as one.
   */
  private async deliverInvitation(id: string): Promise<InvitationDelivery> {
    const current = await this.requireVisit(id)
    this.requireStatus(current, "PLANNED", "Yalnızca planlanmış ziyaretler için davet gönderilebilir.")
    if (!current.visitor.email) throw new ApiError(409, "VISITOR_EMAIL_REQUIRED", "Ziyaretçinin davet gönderilebilecek e-posta adresi bulunmuyor.")
    if (!invitationSendable(current)) return { attempted: false, visit: current }

    const rawToken = this.createInvitationToken()
    const prepared = await this.repository.prepareInvitation(id, hashToken(rawToken), this.now())
    if (!prepared.claimed) return { attempted: false, visit: prepared.visit }
    const claimed = prepared.visit
    // A claimed record whose authoritative snapshot carries no address cannot be mailed; the claim
    // is released as a failed attempt rather than falling back to the one `current` still holds.
    if (!claimed.visitor.email) {
      this.logger.error({ visitId: id }, "Invitation delivery başarısız oldu: güncel kayıtta e-posta adresi yok.")
      await this.repository.finishInvitation(id, false, this.now())
      return { attempted: true, visit: await this.requireVisit(id) }
    }
    const link = `${this.webOrigin.replace(/\/$/, "")}/visitor/pre-registration?token=${encodeURIComponent(rawToken)}`
    try {
      await this.emailSender.send({
        to: { address: claimed.visitor.email, name: `${claimed.visitor.firstName} ${claimed.visitor.lastName}` },
        subject: "Ziyaret ön kayıt bağlantınız",
        text: `Merhaba ${claimed.visitor.firstName},\n\n${claimed.meeting.facilityName} tesisindeki ${claimed.meeting.hostEmployeeName} konuğunuz için ziyaretiniz ${claimed.meeting.plannedStart} - ${claimed.meeting.plannedEnd} arasında planlandı.\n\nGüvenli ön kayıt bağlantısı: ${link}`,
      })
      await this.repository.finishInvitation(id, true, this.now())
    } catch {
      this.logger.error({ visitId: id }, "Invitation delivery başarısız oldu.")
      await this.repository.finishInvitation(id, false, this.now())
    }
    return { attempted: true, visit: await this.requireVisit(id) }
  }

  async getPublicPreRegistration(rawToken: string): Promise<PublicPreRegistrationDto> {
    const found = await this.getActivePublicInvitation(rawToken)
    return { visitor: found.visit.visitor, visit: { plannedStart: found.visit.meeting.plannedStart, plannedEnd: found.visit.meeting.plannedEnd, visitTypeName: found.visit.meeting.visitTypeName, facilityName: found.visit.meeting.facilityName, hostEmployeeName: found.visit.meeting.hostEmployeeName, vehiclePlate: found.visit.vehiclePlate }, activeRule: found.activeRule }
  }

  async updatePublicPreRegistration(rawToken: string, input: { firstName: string; lastName: string; email?: string; company: string; phone?: string; vehiclePlate?: string }) {
    await this.getActivePublicInvitation(rawToken)
    const firstName = requireText(input.firstName, "Ad zorunludur."), lastName = requireText(input.lastName, "Soyad zorunludur."), company = requireText(input.company, "Ziyaretçi şirketi zorunludur.")
    const email = normalizeOptional(input.email); if (email && !validEmail(email)) throw new ApiError(400, "VALIDATION_ERROR", "Geçerli bir e-posta adresi girin.")
    await this.runPublicMutation(() => this.repository.updatePublicVisitor(hashToken(rawToken), { firstName, lastName, company, email, phone: normalizeOptional(input.phone), vehiclePlate: normalizePlate(input.vehiclePlate) }))
    return this.getPublicPreRegistration(rawToken)
  }

  async acceptPublicRule(rawToken: string, ipAddress?: string) { const found = await this.getActivePublicInvitation(rawToken); if (!found.activeRule) throw noActiveRule(); try { return await this.runPublicMutation(() => this.repository.acceptPublicRule(hashToken(rawToken), ipAddress)) } catch (error) { if (error instanceof NoActiveVisitorRuleError) throw noActiveRule(); throw error } }

  /**
   * The checks above run on a snapshot; the repository re-validates the persisted Visit and
   * invitation state inside its write transaction and rejects a mutation that is no longer both
   * `PLANNED` and `SENT`. Only that typed rejection collapses into the public 404 — every other failure
   * (an unexpected database error included) propagates untouched.
   */
  private async runPublicMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof PublicInvitationInactiveError) throw invitationNotFound()
      throw error
    }
  }

  listRules() { return this.repository.listRules() }
  getActiveRule() { return this.repository.getActiveRule() }
  async publishRule(content: string) { const normalized = requireText(content, "Kural içeriği zorunludur."); return this.repository.publishRule(normalized, this.now()) }

  listCards() { return this.repository.listCards() }
  async createCard(cardNumber: string) { const number = requireText(cardNumber, "Kart numarası zorunludur."); return this.repository.saveCard({ cardNumber: number, cardNumberNormalized: normalizeCardNumber(number) }) }
  async updateCard(id: string, input: { cardNumber: string; active: boolean }) {
    const card = await this.requireCard(id)
    if (!["AVAILABLE", "DISABLED"].includes(card.status)) throw new ApiError(409, "CARD_OPERATIONAL", "Kullanımdaki veya iade edilmemiş kart düzenlenemez.")
    const number = requireText(input.cardNumber, "Kart numarası zorunludur.")
    return this.runCardMutation(() => this.repository.updateCard(id, { cardNumber: number, cardNumberNormalized: normalizeCardNumber(number), status: input.active ? "AVAILABLE" : "DISABLED" }, this.expectedCardState(card)))
  }
  async setCardActive(id: string, active: boolean) {
    const card = await this.requireCard(id)
    if (!["AVAILABLE", "DISABLED"].includes(card.status)) throw new ApiError(409, "CARD_OPERATIONAL", "Kullanımdaki veya iade edilmemiş kartın durumu değiştirilemez.")
    return this.runCardMutation(() => this.repository.setCardStatus(id, active ? "AVAILABLE" : "DISABLED", this.expectedCardState(card)))
  }
  async markCardLost(id: string) {
    const card = await this.requireCard(id)
    if (card.status !== "NOT_RETURNED") throw new ApiError(409, "INVALID_CARD_TRANSITION", "Yalnız iade edilmemiş kart kayıp işaretlenebilir.")
    return this.runCardMutation(() => this.repository.setCardStatus(id, "LOST", this.expectedCardState(card)))
  }
  async restoreCard(id: string) {
    const card = await this.requireCard(id)
    if (card.status !== "LOST") throw new ApiError(409, "INVALID_CARD_TRANSITION", "Yalnız kayıp kart geri alınabilir.")
    return this.runCardMutation(() => this.repository.setCardStatus(id, "AVAILABLE", this.expectedCardState(card)))
  }

  /**
   * Hard delete. Past visits keep their own `visitorCardNumber` snapshot and simply lose the live
   * card reference, so history never blocks this. The card's own lifecycle does: IN_USE,
   * NOT_RETURNED and LOST all still need a physical resolution (check-out, late return, write-off)
   * and must not be closed out by deleting the record.
   */
  async deleteCard(id: string) {
    const card = await this.requireCard(id)
    if (!["AVAILABLE", "DISABLED"].includes(card.status)) throw new ApiError(409, "CARD_OPERATIONAL", "Kullanımdaki, iade edilmemiş veya kayıp kart silinemez.")
    await this.runCardMutation(() => this.repository.deleteCard(id, this.expectedCardState(card)))
  }

  async getAvailableCards() { return (await this.repository.listCards()).filter((card) => card.status === "AVAILABLE") }

  /** Security operations are confined to the gate user's company/facility scope. */
  private assertOperationalScope(ctx: AccessContext, meeting: Pick<MeetingDto, "hostCompanyId" | "facilityId">): void {
    if (!scopeAllows(ctx, { companyId: meeting.hostCompanyId, facilityId: meeting.facilityId })) throw notFound()
  }

  async checkInVisit(id: string, input: SecurityCheckInInput, ctx: AccessContext) {
    const visit = await this.requireVisit(id); this.assertOperationalScope(ctx, visit.meeting); this.requireStatus(visit, "PLANNED", "Yalnızca planlanmış ziyaretler giriş yapabilir.")
    const card = await this.requireCard(input.visitorCardId); if (card.status !== "AVAILABLE") throw new ApiError(409, "CARD_UNAVAILABLE", "Seçilen kart şu anda kullanılabilir değil.")
    if (!visit.ruleAcceptance) throw new ApiError(409, "RULE_ACCEPTANCE_REQUIRED", "Ziyaretçi kuralları check-in öncesinde kabul edilmelidir.")
    let result: Awaited<ReturnType<VisitorOperationsRepository["checkIn"]>>
    try {
      result = await this.repository.checkIn(id, { visitorCardId: input.visitorCardId, vehiclePlate: normalizePlate(input.vehiclePlate), phone: normalizeOptional(input.phone) }, this.now())
    } catch (error) {
      if (error instanceof CheckInConflictError) throw new ApiError(409, "CHECK_IN_CONFLICT", "Ziyaret veya kart durumu değişti. Güncel durumu kontrol edip yeniden deneyin.")
      throw error
    }
    if (result.hostEmail && result.hostName) this.sendHostNotification(result.visit, result.hostEmail, result.hostName)
    return result.visit
  }
  async checkOutVisit(id: string, cardReturned: boolean, ctx: AccessContext) {
    const visit = await this.requireVisit(id); this.assertOperationalScope(ctx, visit.meeting); this.requireStatus(visit, "CHECKED_IN", "Yalnızca içerideki ziyaretçiler çıkış yapabilir.")
    await this.runCardMutation(() => this.repository.checkOut(id, cardReturned, this.now()))
    return this.requireVisit(id)
  }
  /** Unreturned-card follow-up is confined to the Security user's own company/facility scope. */
  async listUnreturnedIssues(ctx: AccessContext) {
    return (await this.repository.listUnreturnedIssues()).filter((issue) => scopeAllows(ctx, { companyId: issue.visit.meeting.hostCompanyId, facilityId: issue.visit.meeting.facilityId }))
  }
  async receiveLateCardReturn(id: string, ctx: AccessContext) {
    const visit = await this.requireVisit(id); this.assertOperationalScope(ctx, visit.meeting)
    await this.runCardMutation(() => this.repository.lateReturn(id, this.now()))
    return this.requireVisit(id)
  }
  async createAndCheckInUnplanned(input: CreateUnplannedInput, ctx: AccessContext) {
    const actor = await this.requireActor(ctx.userId)
    // The company/facility come from the client's scope context and are NOT trusted: they must
    // sit inside the Security user's authorization scope.
    if (!scopeAllows(ctx, { companyId: input.companyId, facilityId: input.facilityId })) throw new ApiError(403, "OUT_OF_SCOPE", "Bu şirket/tesis yetki kapsamınız dışında.")
    const clean: CreateUnplannedInput = { ...input, firstName: requireText(input.firstName, "Ad zorunludur."), lastName: requireText(input.lastName, "Soyad zorunludur."), company: requireText(input.company, "Ziyaretçi şirketi zorunludur."), hostEmployeeName: requireText(input.hostEmployeeName, "Ev sahibi zorunludur."), visitTypeId: input.visitTypeId.trim(), vehiclePlate: normalizePlate(input.vehiclePlate) }
    if (!clean.rulesAccepted || !Number.isInteger(clean.durationMinutes) || clean.durationMinutes <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Kural kabulü ve pozitif tahmini süre zorunludur.")
    const type = await this.requireVisitType(clean.visitTypeId); if (!type.active) throw new ApiError(409, "INACTIVE_VISIT_TYPE", "Pasif ziyaret türü seçilemez.")
    try {
      return await this.repository.createUnplanned(clean, actor.id, this.now())
    } catch (error) {
      if (error instanceof CheckInConflictError) throw new ApiError(409, "CHECK_IN_CONFLICT", "Ziyaret veya kart durumu değişti. Güncel durumu kontrol edip yeniden deneyin.")
      if (error instanceof NoActiveVisitorRuleError) throw noActiveRule()
      throw error
    }
  }
  async correctVisitor(id: string, input: SecurityCorrectionInput, ctx: AccessContext) {
    const visit = await this.requireVisit(id); this.assertOperationalScope(ctx, visit.meeting); if (!["PLANNED", "CHECKED_IN"].includes(visit.status)) throw new ApiError(409, "VISIT_NOT_EDITABLE", "Yalnızca planlanmış veya içerideki ziyaretler düzeltilebilir.")
    const email = input.email === undefined ? undefined : normalizeOptional(input.email); if (email && !validEmail(email)) throw new ApiError(400, "VALIDATION_ERROR", "Geçerli bir e-posta adresi girin.")
    const actor = await this.repository.findEmployeeByUserId(ctx.userId)
    await this.repository.correctVisitor(id, { firstName: requireText(input.firstName, "Ad zorunludur."), lastName: requireText(input.lastName, "Soyad zorunludur."), company: requireText(input.company, "Ziyaretçi şirketi zorunludur."), email, phone: normalizeOptional(input.phone), hostEmployeeName: requireText(input.hostEmployeeName, "Ev sahibi zorunludur.") }, actor, this.now())
    return this.requireVisit(id)
  }

  private async saveVisitType(id: string | undefined, input: { name: string; active: boolean }) { const name = requireText(input.name, "Ziyaret türü adı zorunludur."); const normalized = normalizeVisitTypeName(name); const types = await this.repository.listVisitTypes(true); if (types.some((item) => item.id !== id && normalizeVisitTypeName(item.name) === normalized)) throw new ApiError(409, "DUPLICATE_NAME", "Bu ziyaret türü zaten tanımlı."); return this.repository.saveVisitType({ id, name, nameNormalized: normalized, active: input.active }) }
  private async validateMeetingInput(input: MeetingInput, currentTypeId?: string) {
    if (!Array.isArray(input.visitors) || input.visitors.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "En az bir ziyaretçi zorunludur.")
    this.assertTimes(input.plannedStart, input.plannedEnd)
    const type = await this.requireVisitType(input.visitTypeId); if (!type.active && type.id !== currentTypeId) throw new ApiError(409, "INACTIVE_VISIT_TYPE", "Pasif ziyaret türü yeni ziyaret için seçilemez.")
    const hostName = requireText(input.hostEmployeeName, "Ev sahibi zorunludur.")
    const host = input.hostEmployeeId ? await this.repository.findEmployeeById(input.hostEmployeeId) : await this.repository.findActiveEmployeeByName(hostName, input.hostCompanyId, input.facilityId)
    if (!host || !host.facilityIds.includes(input.facilityId) || host.companyId !== input.hostCompanyId) throw new ApiError(400, "INVALID_HOST", "Ev sahibi, şirket ve tesis kapsamıyla eşleşmelidir.")
    const visitors = input.visitors.map((visitor) => { const email = normalizeOptional(visitor.email); if (email && !validEmail(email)) throw new ApiError(400, "VALIDATION_ERROR", "Geçerli bir e-posta adresi girin."); return { ...visitor, firstName: requireText(visitor.firstName, "Ad zorunludur."), lastName: requireText(visitor.lastName, "Soyad zorunludur."), company: requireText(visitor.company, "Ziyaretçi şirketi zorunludur."), email, phone: normalizeOptional(visitor.phone) } })
    return { hostEmployeeId: host.id, input: { ...input, hostEmployeeName: host.fullName, visitors, note: normalizeOptional(input.note), additionalRequirementNote: input.hasAdditionalRequirements ? normalizeOptional(input.additionalRequirementNote) : undefined } }
  }
  private async getActivePublicInvitation(rawToken: string) { if (!rawToken || rawToken.length > 200) throw invitationNotFound(); const found = await this.repository.findPublicPreRegistration(hashToken(rawToken)); if (!found || found.visit.status !== "PLANNED" || found.visit.invitationStatus !== "SENT") throw invitationNotFound(); return found }
  private async requireActor(userId: string) { const actor = await this.repository.findEmployeeByUserId(userId); if (!actor) throw new ApiError(403, "EMPLOYEE_PROFILE_REQUIRED", "Bu işlem için çalışan profili gereklidir."); return actor }
  private async requireVisitType(id: string) { const type = await this.repository.findVisitType(id); if (!type) throw new ApiError(404, "NOT_FOUND", "Ziyaret türü bulunamadı."); return type }
  private async requireVisit(id: string) { const visit = await this.repository.findVisit(id); if (!visit) throw new ApiError(404, "NOT_FOUND", "Ziyaret bulunamadı."); return visit }
  private async requireCard(id: string) { const card = await this.repository.findCard(id); if (!card) throw new ApiError(404, "NOT_FOUND", "Ziyaretçi kartı bulunamadı."); return card }
  private expectedCardState(card: VisitorCardDto) { return { status: card.status, currentVisitId: card.assignedVisitId ?? null } }
  private async runCardMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof VisitorCardConflictError)) throw error
      if (error.reason === "INVALID_CHECKOUT_STATE") throw new ApiError(409, "INVALID_VISIT_TRANSITION", "Ziyaretin mevcut durumu çıkış işlemiyle uyumlu değil.")
      if (error.reason === "INVALID_LATE_RETURN_STATE") throw new ApiError(409, "INVALID_CARD_TRANSITION", "Ziyaretin mevcut durumu geç kart iadesiyle uyumlu değil.")
      if (error.reason === "INVALID_CARD_ASSIGNMENT") throw new ApiError(409, "CARD_ASSIGNMENT_CONFLICT", "Ziyaretçi kartı ataması güncel ziyaretle eşleşmiyor.")
      throw new ApiError(409, "CARD_STATE_CONFLICT", "Ziyaretçi kartının durumu değişti. Güncel durumu kontrol edip yeniden deneyin.")
    }
  }
  private requireStatus(visit: VisitDto, status: string, message: string) { if (visit.status !== status) throw new ApiError(409, "INVALID_VISIT_TRANSITION", message) }
  private assertTimes(start: string, end: string) { const startAt = new Date(start), endAt = new Date(end); if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) throw new ApiError(400, "VALIDATION_ERROR", "Planlanan başlangıç ve bitiş zamanı geçerli ve sıralı olmalıdır.") }
  private assertManualLifecycle(meeting: { hostEmployeeId?: string; plannedStart: string; actualMeetingEnd?: string }, visits: VisitDto[], actorId: string, now: Date) { if (meeting.hostEmployeeId !== actorId) throw new ApiError(403, "NOT_HOST", "Bu toplantının yaşam döngüsü aksiyonlarını yalnızca ev sahibi kullanabilir."); if (meeting.actualMeetingEnd) throw new ApiError(409, "MEETING_CLOSED", "Toplantı zaten kapatılmış."); if (now < new Date(meeting.plannedStart)) throw new ApiError(409, "MEETING_NOT_STARTED", "Toplantı başlamadan yaşam döngüsü aksiyonu uygulanamaz."); if (!visits.some((visit) => !terminal.has(visit.status))) throw new ApiError(409, "MEETING_TERMINAL", "Tüm ziyaretleri tamamlanmış toplantı değiştirilemez.") }
  private sendHostNotification(visit: VisitDto, hostEmail: string, hostName: string) { void this.emailSender.send({ to: { address: hostEmail, name: hostName }, subject: "Ziyaretçi check-in bildirimi", text: `${visit.visitor.firstName} ${visit.visitor.lastName} (${visit.visitor.company}) tesise giriş yaptı. Giriş zamanı: ${visit.actualCheckIn}.` }).catch(() => this.logger.error({ visitId: visit.id }, "Host check-in bildirimi gönderilemedi.")) }
}

function requireText(value: string | undefined, message: string) { const normalized = normalizeOptional(value); if (!normalized) throw new ApiError(400, "VALIDATION_ERROR", message); return normalized }
export function hashToken(rawToken: string) { return createHash("sha256").update(rawToken).digest("hex") }

interface ReferenceData {
  companies: { id: string; name: string }[]
  facilities: { id: string; companyId: string; name: string }[]
  employees: { id: string; companyId: string; facilityIds: string[]; name: string; departmentId: string; department: string }[]
  visitTypes: unknown
  currentEmployee: unknown
}

/**
 * Narrows the shared reference data (company/facility/employee option lists) to the caller's
 * authorization scope. Visit types stay global; `currentEmployee` is passed through unchanged.
 */
function scopeReferenceData(ctx: AccessContext, raw: unknown): ReferenceData {
  const data = raw as ReferenceData
  const companyIds = new Set(ctx.scope.companyIds)
  const facilityIds = ctx.scope.facilityIds
  const facilityAllowed = (facilityId: string) => facilityIds.length === 0 || facilityIds.includes(facilityId)
  return {
    companies: data.companies.filter((company) => companyIds.has(company.id)),
    facilities: data.facilities.filter((facility) => companyIds.has(facility.companyId) && facilityAllowed(facility.id)),
    employees: data.employees.filter((employee) => companyIds.has(employee.companyId)),
    visitTypes: data.visitTypes,
    currentEmployee: data.currentEmployee,
  }
}
