import { z } from "zod"

import type { GoodsMovementInput } from "@/domain/goods-movements"

export const plannedGoodsDeliveryFormSchema = z.object({
  companyId: z.string().min(1, "Şirket zorunludur."),
  facilityId: z.string().min(1, "Tesis zorunludur."),
  plannedDate: z.string().min(1, "Planlanan gün zorunludur."),
  counterpartyName: z.string().trim().min(1, "Gönderici firma zorunludur."),
  goodsDescription: z.string().trim().min(1, "Gelecek mal / teslimat açıklaması zorunludur."),
})

export type PlannedGoodsDeliveryFormValues = z.infer<typeof plannedGoodsDeliveryFormSchema>

export function toPlannedGoodsDeliveryInput(values: PlannedGoodsDeliveryFormValues): GoodsMovementInput {
  return {
    direction: "INBOUND",
    companyId: values.companyId,
    facilityId: values.facilityId,
    plannedDate: values.plannedDate,
    counterpartyName: values.counterpartyName,
    goodsDescription: values.goodsDescription,
  }
}
