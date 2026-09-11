export const goodsMovementDirections = ["INBOUND", "OUTBOUND"] as const
export type GoodsMovementDirection = (typeof goodsMovementDirections)[number]

// Canonical persisted statuses. `LATE` is never written: it is a presentation-only derivation
// from plannedDate/plannedTime vs. the current time and stays on the frontend.
export const goodsMovementStatuses = ["PLANNED", "COMPLETED", "CANCELLED"] as const
export type GoodsMovementStatus = (typeof goodsMovementStatuses)[number]

export interface GoodsMovementDto {
  id: string
  direction: GoodsMovementDirection
  companyId: string
  companyName: string
  facilityId: string
  facilityName: string
  counterpartyName: string
  plannedDate: string
  plannedTime?: string
  goodsDescription: string
  referenceNumber?: string
  note?: string
  status: GoodsMovementStatus
  actualAt?: string
  actualPlate?: string
  actualDriverName?: string
  createdAt: string
}

export interface GoodsMovementInput {
  direction: GoodsMovementDirection
  companyId: string
  facilityId: string
  counterpartyName: string
  plannedDate: string
  plannedTime?: string
  goodsDescription: string
  referenceNumber?: string
  note?: string
}

/**
 * Security desk completion. `companyId`/`facilityId` come from the frontend scope context and
 * are NOT trusted: the service verifies them against the authenticated Security user's
 * authorization scope and against the movement's own company/facility.
 */
export interface CompleteGoodsMovementInput {
  companyId: string
  facilityId: string
  actualPlate?: string
  actualDriverName?: string
}

/**
 * Security desk unplanned goods movement: created and completed atomically for a movement
 * happening at the gate right now, with no prior plan. `companyId`/`facilityId` come from the
 * frontend scope context and are NOT trusted: the service verifies them against the
 * authenticated Security user's authorization scope, mirroring `CompleteGoodsMovementInput`.
 */
export interface UnplannedGoodsMovementInput {
  direction: GoodsMovementDirection
  companyId: string
  facilityId: string
  counterpartyName: string
  goodsDescription: string
  referenceNumber?: string
  actualPlate?: string
  actualDriverName?: string
}

export const GOODS_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
