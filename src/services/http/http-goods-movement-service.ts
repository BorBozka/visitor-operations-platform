import { apiClient } from "@/lib/http"
import type { GoodsMovement, GoodsMovementInput } from "@/domain/goods-movements"
import type { CompleteGoodsMovementInput, GoodsMovementService, UnplannedGoodsMovementInput } from "@/services/goods-movement-service"

/**
 * Goods movements. Manager/Admin planning uses `/api/goods-movements`; the Security desk uses
 * the scoped `/api/security/goods-movements` surface. The backend derives the Security actor
 * and re-validates the scope regardless of the `companyId`/`facilityId` sent with completion.
 */
export class HttpGoodsMovementService implements GoodsMovementService {
  listGoodsMovements(): Promise<GoodsMovement[]> {
    return apiClient.get<GoodsMovement[]>("/goods-movements")
  }

  listMyGoodsMovements(): Promise<GoodsMovement[]> {
    return apiClient.get<GoodsMovement[]>("/goods-movements/mine")
  }

  listSecurityGoodsMovements(): Promise<GoodsMovement[]> {
    return apiClient.get<GoodsMovement[]>("/security/goods-movements")
  }

  createGoodsMovement(input: GoodsMovementInput): Promise<GoodsMovement> {
    return apiClient.post<GoodsMovement>("/goods-movements", input)
  }

  updateGoodsMovement(id: string, input: GoodsMovementInput): Promise<GoodsMovement> {
    return apiClient.patch<GoodsMovement>(`/goods-movements/${encodeURIComponent(id)}`, input)
  }

  cancelGoodsMovement(id: string): Promise<GoodsMovement> {
    return apiClient.post<GoodsMovement>(`/goods-movements/${encodeURIComponent(id)}/cancel`)
  }

  completeGoodsMovement(id: string, input: CompleteGoodsMovementInput): Promise<GoodsMovement> {
    return apiClient.post<GoodsMovement>(`/security/goods-movements/${encodeURIComponent(id)}/complete`, input)
  }

  createUnplannedGoodsMovement(input: UnplannedGoodsMovementInput): Promise<GoodsMovement> {
    return apiClient.post<GoodsMovement>("/security/goods-movements/unplanned", input)
  }
}
