import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const pageSource = readFileSync(resolve(process.cwd(), "src/features/reports/ReportsPage.tsx"), "utf8")

describe("custom comparison menu contract", () => {
  it("keeps an unfinished custom selection local while the dropdown remains open", () => {
    expect(pageSource).toContain('const [pendingCustom, setPendingCustom] = useState(false)')
    expect(pageSource).toContain('<DropdownMenu open={open} onOpenChange={handleOpenChange}>')
    expect(pageSource).toContain('if (next === "custom")')
    expect(pageSource).toContain('setPendingCustom(true)')
    expect(pageSource).toContain('onSelect={option.value === "custom" ? (event) => event.preventDefault() : undefined}')
  })

  it("commits a valid custom date range and resets a cancelled draft to the committed value", () => {
    expect(pageSource).toContain('if (!getComparisonPeriod(filters, "custom", nextStart, nextEnd)) return')
    expect(pageSource).toContain('onCustomPeriod(nextStart, nextEnd)')
    expect(pageSource).toContain('setDraftCustomStart(customStart)')
    expect(pageSource).toContain('setDraftCustomEnd(customEnd)')
    expect(pageSource).toContain('setOpen(false)')
  })

  it("keeps an untouched custom period quiet and exposes its optional end date", () => {
    expect(pageSource).toContain('const showCustomStartError = draftCustomStart !== "" && !hasValidCustomStart')
    expect(pageSource).toContain('const showCustomEndError = draftCustomEnd !== "" && hasValidCustomStart')
    expect(pageSource).toContain('id="comparison-custom-to"')
    expect(pageSource).toContain('Bitiş tarihi başlangıç tarihinden önce olamaz.')
  })

  it("shows the two ranges only after a valid draft and labels unequal lengths as neutral information", () => {
    expect(pageSource).toContain('const customPreview = getCustomComparisonPreview(filters, draftCustomStart, draftCustomEnd)')
    expect(pageSource).toContain('{customPreview && (')
    expect(pageSource).toContain('{formatComparisonRange(filters)} ile {formatComparisonRange(customPreview.period)} karşılaştırılacak.')
    expect(pageSource).toContain('customPreview.hasDifferentLength')
    expect(pageSource).toContain('Dönem uzunlukları farklı; toplamlar doğrudan karşılaştırılamaz.')
    expect(pageSource).toContain('bg-slate-50 px-2 py-1 text-[10px] leading-snug text-slate-600')
    expect(pageSource).not.toContain('Bitişi boş bırakırsanız seçili dönemin uzunluğuna göre otomatik hesaplanır.')
  })
})
