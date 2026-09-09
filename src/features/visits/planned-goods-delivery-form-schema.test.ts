import { describe, expect, it } from "vitest"

import { plannedGoodsDeliveryFormSchema, toPlannedGoodsDeliveryInput } from "./planned-goods-delivery-form-schema"

const valid = {
  companyId: "c1",
  facilityId: "f1",
  plannedDate: "2026-09-10",
  counterpartyName: "Tedarik A.Ş.",
  goodsDescription: "Ham madde paleti",
}

describe("plannedGoodsDeliveryFormSchema", () => {
  it("requires sender company and goods description, but no planned time", () => {
    expect(plannedGoodsDeliveryFormSchema.safeParse(valid).success).toBe(true)
    expect(plannedGoodsDeliveryFormSchema.safeParse({ ...valid, counterpartyName: " " }).success).toBe(false)
    expect(plannedGoodsDeliveryFormSchema.safeParse({ ...valid, goodsDescription: " " }).success).toBe(false)
  })

  it("maps the employee flow to one inbound goods movement without operational fields", () => {
    expect(toPlannedGoodsDeliveryInput(valid)).toEqual({ ...valid, direction: "INBOUND" })
  })
})
