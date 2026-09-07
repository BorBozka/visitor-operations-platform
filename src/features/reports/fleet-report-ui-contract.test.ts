import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const tabSource = readFileSync(resolve(process.cwd(), "src/features/reports/FleetReportTab.tsx"), "utf8")
const pageSource = readFileSync(resolve(process.cwd(), "src/features/reports/ReportsPage.tsx"), "utf8")
const dialogSource = readFileSync(resolve(process.cwd(), "src/features/reports/FleetAssignmentDetailDialog.tsx"), "utf8")
const chartSource = readFileSync(resolve(process.cwd(), "src/features/reports/FleetLoadChart.tsx"), "utf8")

describe("Fleet report records UI contract", () => {
  it("keeps purpose single-line in the table without company/facility secondary text", () => {
    expect(tabSource).toContain('<p className="truncate" title={assignment.purpose}>{assignment.purpose}</p>')
    expect(tabSource).not.toContain('title={`${assignment.companyName} · ${assignment.facilityName}`}')
  })

  it("opens details from pointer and keyboard-accessible rows", () => {
    expect(tabSource).toContain("tabIndex={0}")
    expect(tabSource).toContain('aria-haspopup="dialog"')
    expect(tabSource).toContain("onClick={(event) => openDetails(event.currentTarget)}")
    expect(tabSource).toContain("isFleetRecordActivationKey(event.key)")
    expect(tabSource).toContain("cursor-pointer")
    expect(tabSource).toContain("focus-visible:ring-2")
    expect(tabSource).toContain("setSelectedAssignment(assignment)")
  })

  it("draws row separators without duplicating the pagination divider", () => {
    expect(tabSource).toContain("border-b last:border-b-0 transition-colors")
    expect(tabSource).toContain("last:border-b-0")
    expect(tabSource).not.toContain('<tbody className="divide-y">')
  })

  it("uses the visits records geometry with a height-filling table", () => {
    expect(tabSource).toContain('className="h-full w-full min-w-[900px] table-fixed text-left text-xs"')
    expect(tabSource).toContain("FleetReportFillerRow")
    expect(tabSource).toContain("border-transparent")
    expect(tabSource).toContain('h-[3.375rem] cursor-pointer border-b')
    expect(tabSource).toContain('<SortableHeader className="w-[11%]" label="Tarih"')
  })

  it("waits for assignment loading before normalizing a restored page", () => {
    expect(tabSource).toContain('workspace.view !== "records" || !assignmentsLoaded')
  })
})

describe("Fleet analysis UI contract", () => {
  it("merges the analysis workspace with the filter card and removes both headings", () => {
    expect(tabSource).not.toContain("Araç / Şoför Analizi")
    expect(tabSource).not.toContain('fleet-analysis-title')
    expect(tabSource).toContain('className="flex h-full min-h-0 flex-col overflow-hidden bg-card px-3 py-2" aria-label="Araç / şoför analizi"')
  })

  it("places the performance metrics and resource context above the unchanged load chart", () => {
    const metricsIndex = tabSource.indexOf('aria-label="Araç / şoför analiz metrikleri"')
    const chartIndex = tabSource.indexOf('className="mt-3 min-h-0 flex-1"')
    expect(metricsIndex).toBeGreaterThan(-1)
    expect(chartIndex).toBeGreaterThan(metricsIndex)
    expect(tabSource).toContain('FleetLoadChart resources={chartResources} dimension={workspace.dimension}')
    expect(tabSource).toContain('{metrics.usedVehicleCount} araç · {metrics.usedDriverCount} şoför')
    expect(tabSource).toContain('className="ml-auto shrink-0 text-right text-[10px] leading-normal tabular-nums text-slate-500"')
    expect(tabSource).not.toContain("buildFleetInsight")
  })

  it("uses the visits-style value, label and delta sequence without the old metadata line", () => {
    expect(tabSource).toContain('<FleetAnalysisMetric value={String(metrics.totalAssignments)} label="Görev"')
    expect(tabSource).toContain('<FleetAnalysisMetric value={String(metrics.cancelledAssignments)} label="İptal"')
    expect(tabSource).toContain('<p className="text-[10px] leading-normal text-slate-500">{label}</p>{delta &&')
    expect(tabSource).toContain('className="min-w-0 flex-1"')
    expect(tabSource).not.toContain('className="max-w-full text-right text-[11px] tabular-nums text-slate-500">{metadata}</p>')
  })

  it("makes only record-backed metrics interactive and keeps planned load passive", () => {
    expect(tabSource).toContain('onActivate={() => openRecordsForMetric("all")}')
    expect(tabSource).toContain('onActivate={() => openRecordsForMetric("cancelled")}')
    expect(tabSource).toContain('<FleetAnalysisMetric value={formatDurationMinutes(metrics.plannedLoadMinutes)} label="Planlama yükü" delta={plannedLoadDelta} favorableDirection="increase" />')
    expect(tabSource).toContain("filterFleetReportRecordsByStatus(reportAssignments, workspace.status)")
    expect(pageSource).toContain("<FleetRecordsStatusFilter value={fleetWorkspace.status}")
    expect(pageSource).toContain('<option value="cancelled">İptal</option>')
  })
})

describe("Fleet assignment read-only detail dialog contract", () => {
  it("shows organization and the full long purpose in a centered dialog", () => {
    expect(dialogSource).toContain("Araç / Şoför Görev Detayı")
    expect(dialogSource).toContain('{assignment.companyName}')
    expect(dialogSource).toContain('{assignment.facilityName}')
    expect(dialogSource).toContain('<span className="whitespace-pre-wrap">{assignment.purpose}</span>')
    expect(dialogSource).toContain("<DialogContent")
    expect(dialogSource).not.toContain("<InternalDialogContent")
  })

  it("contains only report information, not mutation actions or technical metadata", () => {
    for (const value of ["Düzenle", "İptal et", "Sil", "Kaydet", "createdAt", "assignment.id", "resourceId"]) {
      expect(dialogSource).not.toContain(value)
    }
    for (const label of ["Amaç", "Durum", "Şirket", "Tesis", "Araç adı", "Plaka", "Şoför adı", "Planlanan tarih", "Başlangıç", "Bitiş", "Planlanan süre", "İlişkili kayıt"]) {
      expect(dialogSource).toContain(label)
    }
  })
})

describe("Fleet load chart UI contract", () => {
  it("uses a shared fixed axis, accessible truncated labels, and padded explicit domain", () => {
    expect(chartSource).toContain("getFleetCategoryAxisWidth(dimension)")
    expect(chartSource).toContain("truncateFleetCategoryLabel(fullLabel)")
    expect(chartSource).toContain("<title>{fullLabel}</title>")
    expect(chartSource).toContain("domain={[0, durationScale.domainMax]}")
    expect(chartSource).toContain("ticks={durationScale.ticks}")
    expect(chartSource).toContain("right: 124")
  })

  it("keeps the analysis chart non-clickable while preserving hover tooltips", () => {
    expect(chartSource).toContain("cursor-default")
    expect(chartSource).not.toContain("pointer-events-none")
    expect(chartSource).toContain("<Tooltip")
    expect(chartSource).toContain("<Tooltip cursor={false}")
    expect(chartSource).not.toContain("onClick=")
    expect(chartSource).toContain("accessibilityLayer={false}")
    expect(chartSource).toContain('aria-label="Araç / şoför planlama yükü grafiği"')
  })
})
