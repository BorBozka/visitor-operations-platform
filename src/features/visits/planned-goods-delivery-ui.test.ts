import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const page = readFileSync(resolve(process.cwd(), "src/features/visits/MyVisitsPage.tsx"), "utf8")
const timeline = readFileSync(resolve(process.cwd(), "src/features/visits/VisitTimeline.tsx"), "utf8")
const chooser = readFileSync(resolve(process.cwd(), "src/features/visits/NewRecordTypeDialog.tsx"), "utf8")
const form = readFileSync(resolve(process.cwd(), "src/features/visits/PlannedGoodsDeliveryDialog.tsx"), "utf8")

describe("planned goods delivery calendar flow", () => {
  it("keeps visit creation and adds a distinct delivery choice", () => {
    expect(timeline).toContain("Yeni kayıt")
    expect(chooser).toContain('title="Ziyaret"')
    expect(chooser).toContain('title="Mal teslimatı"')
    expect(chooser).not.toContain("Mevcut ziyaret oluşturma akışını açar.")
    expect(chooser).not.toContain("Fabrikaya gelecek mal gün bazında planlar.")
    expect(page).toContain("setFormOpen(true)")
    expect(page).toContain("setDeliveryFormOpen(true)")
  })

  it("loads owned goods movements and renders them as untimed Mal records", () => {
    expect(page).toContain("listMyGoodsMovements")
    expect(timeline).toContain("<Package")
    expect(timeline).toContain("Gün içinde")
    expect(timeline).toContain("{delivery.counterpartyName}")
    expect(timeline).toContain("{delivery.goodsDescription}")
  })

  it("does not expose Security lifecycle fields in the employee form or calendar", () => {
    for (const forbidden of ["actualAt", "actualPlate", "actualDriverName", "Geldi", "Çıkış yaptı"]) {
      expect(form).not.toContain(forbidden)
      expect(timeline).not.toContain(forbidden)
    }
  })
})
