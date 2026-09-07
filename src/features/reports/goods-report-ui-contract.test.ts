import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const tabSource = readFileSync(resolve(process.cwd(), "src/features/reports/GoodsReportTab.tsx"), "utf8")
const chartSource = readFileSync(resolve(process.cwd(), "src/features/reports/GoodsMovementTrendChart.tsx"), "utf8")
const dialogSource = readFileSync(resolve(process.cwd(), "src/features/reports/GoodsMovementDetailDialog.tsx"), "utf8")
const pageSource = readFileSync(resolve(process.cwd(), "src/features/reports/ReportsPage.tsx"), "utf8")

describe("Goods report workspace UI contract", () => {
  it("uses a viewport-filling analysis and records workspace with independent URL state", () => {
    expect(pageSource).toContain("parseGoodsReportWorkspace(searchParams)")
    expect(pageSource).toContain("setGoodsReportWorkspace(searchParams, { view })")
    expect(pageSource).toContain('queryState.tab === "goods" && goodsWorkspace.view === "analysis"')
    expect(tabSource).toContain("parseGoodsReportWorkspace(searchParams)")
    expect(tabSource).toContain("setGoodsReportPage(searchParams, nextPage)")
    expect(tabSource).toContain('className="flex h-full min-h-0 flex-col overflow-hidden')
  })

  it("uses the balanced metric strip rather than KPI cards", () => {
    expect(tabSource).toContain("<GoodsMovementTrendChart")
    expect(tabSource).toContain('aria-label="Mal hareketi analiz metrikleri"')
    expect(tabSource).toContain("<GoodsAnalysisMetric")
    expect(tabSource).toContain('className="min-w-0 flex-1"')
    expect(tabSource).not.toContain("buildGoodsInsight")
    expect(tabSource).not.toContain("buildGoodsMetadata")
    expect(tabSource).not.toContain("ReportKpiCard")
  })

  it("connects every goods KPI to its shareable records status without recreating late logic", () => {
    for (const status of ["all", "inbound", "outbound", "late"]) expect(tabSource).toContain(`openRecordsForMetric("${status}")`)
    expect(tabSource).toContain("filterGoodsReportRecordsByStatus(reportMovements, workspace.status)")
    expect(tabSource).toContain("lateCount")
    expect(tabSource).toContain("const lateDelta = hasComparisonData")
    expect(tabSource).toContain('label="Geciken" delta={lateDelta} favorableDirection="decrease"')
    expect(tabSource).not.toContain("lateRate")
    expect(pageSource).toContain("<GoodsRecordsStatusFilter value={goodsWorkspace.status}")
    expect(pageSource).toContain('<option value="inbound">Gelen</option>')
    expect(pageSource).toContain('<option value="outbound">Giden</option>')
    expect(pageSource).toContain('<option value="late">Geciken</option>')
  })

  it("uses the visits-style total line, completed-day axis and tooltip breakdown", () => {
    expect(chartSource).toContain('<Line yAxisId="total" type="linear" dataKey="TREND"')
    expect(chartSource).toContain('dataKey="ONGOING"')
    expect(chartSource).toContain('strokeDasharray={ONGOING_DASH}')
    expect(chartSource).toContain("buildGoodsMovementTrendSeries(points, todayDate)")
    expect(chartSource).toContain("calculateGoodsTrendAxes(series)")
    expect(chartSource).toContain("withGoodsMovementTrendOngoingSegment(series, chartAxes.total.max)")
    expect(chartSource).not.toContain("stackId=")
    expect(chartSource).toContain("visibleDirections")
    expect(chartSource).toContain("point[direction] > 0")
  })

  it("merges only the goods analysis filter and chart cards, with a 2:1 comparison layout", () => {
    expect(pageSource).toContain('|| queryState.tab === "goods" && goodsWorkspace.view === "analysis"')
    expect(tabSource).toContain('className="flex h-full min-h-0 flex-col overflow-hidden bg-card px-3 py-2"')
    expect(tabSource).not.toContain('Mal Hareketi Analizi</h2>')
    expect(tabSource).toContain("TrendPanel primary points={trend} todayDate={todayDate} axes={sharedAxis}")
    expect(tabSource).toContain('primary ? "flex-[2]" : "flex-1"')
    expect(tabSource).toContain('`${comparisonLabel} · ${formatGoodsRangeLabel(comparisonFilters!)}`')
  })

  it("opens the selected record with pointer and keyboard interactions", () => {
    expect(tabSource).toContain("tabIndex={0}")
    expect(tabSource).toContain('aria-haspopup="dialog"')
    expect(tabSource).toContain("isGoodsRecordActivationKey(event.key)")
    expect(tabSource).toContain("setSelectedMovement(movement)")
    expect(tabSource).toContain("returnFocusRef={detailTriggerRef}")
  })

  it("fills the records area so the final row meets the pagination footer", () => {
    expect(tabSource).toContain('className="h-full w-full min-w-[1100px] table-fixed text-left text-xs"')
    expect(tabSource).toContain("GoodsReportFillerRow")
    expect(tabSource).toContain("border-transparent")
    expect(tabSource).toContain('h-[3.375rem] cursor-pointer border-b')
    expect(tabSource).toContain('<SortableHeader className="w-[9%]" label="Yön"')
    expect(tabSource).toContain('h-[3.375rem] cursor-pointer border-b last:border-b-0 transition-colors')
    expect(tabSource).toContain("last:border-b-0")
  })

  it("waits for movements before normalizing a restored records page", () => {
    expect(tabSource).toContain('workspace.view !== "records" || !movementsLoaded')
  })
})

describe("Goods movement report detail dialog contract", () => {
  it("is read-only and shows only values present in the domain model", () => {
    expect(dialogSource).toContain("Mal Hareketi Detayı")
    for (const label of ["Yön", "Durum", "Şirket", "Tesis", "Karşı taraf", "Planlanan tarih", "Planlanan saat", "Gerçekleşen zaman", "Referans no", "Gerçekleşen plaka", "Gerçekleşen şoför"]) expect(dialogSource).toContain(label)
    for (const action of ["Düzenle", "Kaydet", "İptal et", "Tamamla"]) expect(dialogSource).not.toContain(action)
    expect(dialogSource).toContain("onCloseAutoFocus")
    expect(dialogSource).toContain("returnFocusRef.current?.focus()")
  })
})
