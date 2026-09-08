import type { GoodsMovement, GoodsMovementInput } from "@/domain/goods-movements"

export interface CompleteGoodsMovementInput {
  /** Security's resolved authorization scope; never chosen from the operations UI. */
  companyId: string
  facilityId: string
  actualPlate?: string
  actualDriverName?: string
}

export interface GoodsMovementService {
  /** Manager/Admin planning list: every goods movement in the caller's authorization scope. */
  listGoodsMovements(): Promise<GoodsMovement[]>
  /**
   * Security desk list: today's PLANNED movements inside the Security user's scope, backed by a
   * distinct scoped endpoint.
   */
  listSecurityGoodsMovements(): Promise<GoodsMovement[]>
  createGoodsMovement(input: GoodsMovementInput): Promise<GoodsMovement>
  updateGoodsMovement(id: string, input: GoodsMovementInput): Promise<GoodsMovement>
  cancelGoodsMovement(id: string): Promise<GoodsMovement>
  /** Security desk operation. Only a scoped PLANNED record may be completed. */
  completeGoodsMovement(id: string, input: CompleteGoodsMovementInput): Promise<GoodsMovement>
}
