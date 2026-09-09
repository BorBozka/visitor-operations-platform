import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const pageSource = readFileSync(resolve(process.cwd(), "src/features/reports/ReportsPage.tsx"), "utf8")
const exportSource = readFileSync(resolve(process.cwd(), "src/features/reports/report-export.ts"), "utf8")
const excelExportSource = readFileSync(resolve(process.cwd(), "src/features/reports/report-excel-export.ts"), "utf8")
const visitsSource = readFileSync(resolve(process.cwd(), "src/features/reports/VisitsReportTab.tsx"), "utf8")
const goodsSource = readFileSync(resolve(process.cwd(), "src/features/reports/GoodsReportTab.tsx"), "utf8")

describe("Reports export interaction contract", () => {
  it("uses one direct PNG action in analysis and a CSV/Excel/PDF-only records dropdown", () => {
    expect(pageSource).toContain("function ReportExportAction")
    expect(pageSource).toContain(">Grafiği indir</Button>")
    expect(pageSource).toContain('onExport("png")')
    expect(pageSource).toContain('onExport("csv")')
    expect(pageSource).toContain('onExport("excel")')
    expect(pageSource).toContain('onExport("pdf")')
    expect(pageSource).not.toContain("Grafik (PNG)")
  })

  it("keeps the Records search and return action in a non-wrapping desktop control cluster", () => {
    expect(pageSource).toContain('recordsMode && "lg:flex-nowrap"')
    expect(pageSource).toContain('lg:w-[15rem] lg:flex-none')
    expect(pageSource).toContain('w-[min(17rem,100%)] shrink-0')
  })
})

describe("Reports export implementation contract", () => {
  it("captures an isolated two-times white PNG without transient Recharts UI", () => {
    expect(exportSource).toContain('backgroundColor: "#ffffff"')
    expect(exportSource).toContain("scale: 2")
    expect(exportSource).toContain("cloneNode(true)")
    expect(exportSource).toContain("document.fonts?.ready")
    expect(exportSource).toContain("recharts-tooltip-wrapper")
  })

  it("relaxes only cloned comparison-label clipping so fractional text metrics cannot crop it", () => {
    expect(visitsSource).toContain("report-png-comparison-label")
    expect(goodsSource).toContain("report-png-comparison-label")
    expect(exportSource).toContain("prepareComparisonLabelsForPngCapture")
    expect(exportSource).toContain('label.style.overflow = "visible"')
    expect(exportSource).toContain('label.style.zIndex = "1"')
  })

  it("formats Excel and embeds a Unicode PDF font", () => {
    expect(exportSource).toContain('await import("@/features/reports/report-excel-export")')
    expect(excelExportSource).toContain("createReportAutoFilterFeature")
    expect(excelExportSource).toContain("getReportExcelColumnWidths")
    expect(excelExportSource).toContain('fontWeight: "bold"')
    expect(exportSource).toContain("registerReportPdfFont")
    expect(exportSource).toContain("REPORT_PDF_FONT.family")
  })
})
