import { ApiError } from "../../lib/api-error.js"
import { matchesScopeFilter, resolveScopeFilter, scopeAllows, type AccessContext } from "../../lib/authorization.js"
import { isValidCalendarDate } from "../../lib/calendar-date.js"
import { isWithinAuthorizationScope, type AuthorizationScope } from "../../lib/scope.js"
import type { GoodsMovementRepository, PersistGoodsMovementInput } from "../../repositories/goods-movement-repository.js"
import {
  GOODS_TIME_PATTERN,
  goodsMovementDirections,
  normalizeOptionalText,
  type CompleteGoodsMovementInput,
  type GoodsMovementInput,
  type UnplannedGoodsMovementInput,
} from "./types.js"

const STATE_CONFLICT = "GOODS_MOVEMENT_NOT_EDITABLE"

export class GoodsMovementService {
  constructor(
    private readonly repository: GoodsMovementRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Manager/Admin planning list. `ctx` is omitted only by unit tests; every route passes it and
   * the result is confined to the caller's authorization scope.
   */
  async list(ctx?: AccessContext) {
    const movements = await this.repository.list()
    if (!ctx) return movements
    const filter = resolveScopeFilter(ctx, {})
    return movements.filter((movement) => matchesScopeFilter(filter, movement))
  }

  async listOwn(ctx: AccessContext) {
    const movements = await this.repository.listByCreatorUserId(ctx.userId)
    const filter = resolveScopeFilter(ctx, {})
    return movements.filter((movement) => matchesScopeFilter(filter, movement))
  }

  async create(input: GoodsMovementInput, ctx: AccessContext) {
    if (!scopeAllows(ctx, { companyId: input.companyId, facilityId: input.facilityId })) {
      throw new ApiError(403, "OUT_OF_SCOPE", "Bu şirket/tesis yetki kapsamınız dışında.")
    }
    if (ctx.role === "EMPLOYEE" && input.direction !== "INBOUND") {
      throw new ApiError(403, "FORBIDDEN", "Çalışanlar yalnızca gelecek mal teslimatı oluşturabilir.")
    }
    return this.repository.create({ ...await this.validate(input), createdByUserId: ctx.userId })
  }

  async update(id: string, input: GoodsMovementInput, ctx?: AccessContext) {
    const current = await this.require(id)
    if (ctx && !scopeAllows(ctx, { companyId: current.companyId, facilityId: current.facilityId })) {
      throw new ApiError(404, "NOT_FOUND", "Mal hareketi bulunamadı.")
    }
    if (ctx && !scopeAllows(ctx, { companyId: input.companyId, facilityId: input.facilityId })) {
      throw new ApiError(403, "OUT_OF_SCOPE", "Bu şirket/tesis yetki kapsamınız dışında.")
    }
    if (current.status !== "PLANNED") throw new ApiError(409, STATE_CONFLICT, "Bu kayıt artık düzenlenemez.")
    const result = await this.repository.update(id, await this.validate(input))
    if (!result) throw new ApiError(409, STATE_CONFLICT, "Bu kayıt artık düzenlenemez.")
    return result
  }

  async cancel(id: string, ctx?: AccessContext) {
    const current = await this.require(id)
    if (ctx && !scopeAllows(ctx, { companyId: current.companyId, facilityId: current.facilityId })) {
      throw new ApiError(404, "NOT_FOUND", "Mal hareketi bulunamadı.")
    }
    if (current.status !== "PLANNED") throw new ApiError(409, STATE_CONFLICT, "Bu kayıt iptal edilemez.")
    const result = await this.repository.cancel(id)
    if (!result) throw new ApiError(409, STATE_CONFLICT, "Bu kayıt iptal edilemez.")
    return result
  }

  /**
   * Security operational list: today's PLANNED movements limited to the authenticated Security
   * user's authorization scope. Both directions are returned as canonical records; grouping,
   * search and sorting stay on the operations UI.
   */
  async listSecurityOperational(userId: string) {
    const scope = await this.requireScope(userId)
    const today = toLocalDateKey(this.now())
    return (await this.repository.list()).filter((movement) =>
      movement.status === "PLANNED"
      && movement.plannedDate === today
      && isWithinAuthorizationScope(scope, { companyId: movement.companyId, facilityId: movement.facilityId }),
    )
  }

  async complete(id: string, userId: string, input: CompleteGoodsMovementInput) {
    const scope = await this.requireScope(userId)
    const current = await this.require(id)
    if (current.status !== "PLANNED") {
      throw new ApiError(409, STATE_CONFLICT, "Yalnızca planlanmış mal hareketleri tamamlanabilir.")
    }
    // The frontend-supplied context must be one the Security user is actually authorized for,
    // and the movement itself must belong to that same verified company/facility.
    const claimedInScope = isWithinAuthorizationScope(scope, { companyId: input.companyId, facilityId: input.facilityId })
    const movementMatchesClaim = current.companyId === input.companyId && current.facilityId === input.facilityId
    const movementInScope = isWithinAuthorizationScope(scope, { companyId: current.companyId, facilityId: current.facilityId })
    if (!claimedInScope || !movementMatchesClaim || !movementInScope) {
      throw new ApiError(403, "GOODS_MOVEMENT_OUT_OF_SCOPE", "Bu mal hareketi yetki kapsamınız dışında.")
    }
    const result = await this.repository.complete(id, {
      actualAt: this.now(),
      actualPlate: normalizeOptionalText(input.actualPlate),
      actualDriverName: normalizeOptionalText(input.actualDriverName),
    })
    if (!result) throw new ApiError(409, STATE_CONFLICT, "Yalnızca planlanmış mal hareketleri tamamlanabilir.")
    return result
  }

  /**
   * Security desk unplanned goods movement: creates and immediately completes a record for a
   * movement happening at the gate right now (no prior plan). Scope is verified the same way as
   * `complete` — the frontend-supplied companyId/facilityId must fall within the authenticated
   * Security user's authorization scope.
   */
  async createUnplanned(input: UnplannedGoodsMovementInput, userId: string) {
    const scope = await this.requireScope(userId)
    if (!isWithinAuthorizationScope(scope, { companyId: input.companyId, facilityId: input.facilityId })) {
      throw new ApiError(403, "GOODS_MOVEMENT_OUT_OF_SCOPE", "Bu şirket/tesis yetki kapsamınız dışında.")
    }
    const now = this.now()
    const created = await this.repository.create({
      ...await this.validate({
        direction: input.direction,
        companyId: input.companyId,
        facilityId: input.facilityId,
        counterpartyName: input.counterpartyName,
        plannedDate: toLocalDateKey(now),
        plannedTime: toLocalTimeKey(now),
        goodsDescription: input.goodsDescription,
        referenceNumber: input.referenceNumber,
      }),
      createdByUserId: userId,
    })
    const completed = await this.repository.complete(created.id, {
      actualAt: now,
      actualPlate: normalizeOptionalText(input.actualPlate),
      actualDriverName: normalizeOptionalText(input.actualDriverName),
    })
    if (!completed) throw new ApiError(409, STATE_CONFLICT, "Mal hareketi kaydedilemedi.")
    return completed
  }

  private async require(id: string) {
    const movement = await this.repository.find(id)
    if (!movement) throw new ApiError(404, "NOT_FOUND", "Mal hareketi bulunamadı.")
    return movement
  }

  private async requireScope(userId: string): Promise<AuthorizationScope> {
    const scope = await this.repository.findUserScope(userId)
    if (!scope) throw new ApiError(403, "GOODS_MOVEMENT_OUT_OF_SCOPE", "Kullanıcı yetki kapsamı çözülemedi.")
    return scope
  }

  private async validate(input: GoodsMovementInput): Promise<Omit<PersistGoodsMovementInput, "createdByUserId">> {
    const counterpartyName = input.counterpartyName?.trim()
    const goodsDescription = input.goodsDescription?.trim()
    if (!counterpartyName || !goodsDescription) {
      throw new ApiError(400, "VALIDATION_ERROR", "Karşı firma ve mal/açıklama zorunludur.")
    }
    if (!goodsMovementDirections.includes(input.direction) || !isValidCalendarDate(input.plannedDate)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Yön ve planlanan tarih zorunludur.")
    }
    const plannedTime = normalizeOptionalText(input.plannedTime)
    if (plannedTime && !GOODS_TIME_PATTERN.test(plannedTime)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Planlanan saat geçersiz.")
    }
    if (!(await this.repository.companyAndFacilityMatch(input.companyId, input.facilityId))) {
      throw new ApiError(400, "INVALID_SCOPE", "Şirket ve tesis eşleşmesi geçersiz.")
    }
    return {
      direction: input.direction,
      companyId: input.companyId,
      facilityId: input.facilityId,
      counterpartyName,
      plannedDate: input.plannedDate,
      plannedTime,
      goodsDescription,
      referenceNumber: normalizeOptionalText(input.referenceNumber),
      note: normalizeOptionalText(input.note),
    }
  }
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function toLocalTimeKey(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}
