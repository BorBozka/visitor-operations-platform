import { parse } from "date-fns"
import { ArrowDown, ArrowUp, Search } from "lucide-react"
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { getGoodsDirectionLabel, getGoodsMovementDisplayStatus, type GoodsMovement } from "@/domain/goods-movements"
import { GoodsMovementDetailDialog } from "@/features/reports/GoodsMovementDetailDialog"
import { GoodsMovementTrendChart, GoodsMovementTrendLegend } from "@/features/reports/GoodsMovementTrendChart"
import {
  calculateGoodsMovementTrend,
  calculateGoodsReportKpis,
  calculateSharedGoodsTrendYAxis,
  filterGoodsReportRecordsByStatus,
  filterGoodsMovementsForReport,
  formatGoodsReportDelta,
  getGoodsReportPageCount,
  getVisibleGoodsReportPageNumbers,
  GOODS_REPORT_PAGE_SIZE,
  GOODS_REPORT_STATUS_LABELS,
  isGoodsRecordActivationKey,
  paginateGoodsReport,
  parseGoodsReportWorkspace,
  setGoodsReportPage,
  setGoodsReportWorkspace,
  searchGoodsReportRecords,
  sortGoodsReportRecords,
  type GoodsReportSortField,
  type GoodsReportGranularity,
  type GoodsReportRecordsStatusFilter,
} from "@/features/reports/goods-report-utils"
import { ReportPagination } from "@/features/reports/ReportPagination"
import {
  buildGoodsReportRows,
  downloadReportCsv,
  downloadReportExcel,
  downloadReportPdf,
  downloadElementAsPng,
  GOODS_REPORT_COLUMNS,
  type ReportExportHandle,
} from "@/features/reports/report-export"
import type { ReportsScopeFilters } from "@/features/reports/reports-filters"
import { formatTr } from "@/lib/date"
import { toggleSingleSort } from "@/lib/sort"
import { reportsService } from "@/services"

const statusBadgeClass: Record<ReturnType<typeof getGoodsMovementDisplayStatus>, string> = {
  PLANNED: "border-blue-200 bg-blue-50 text-blue-700", COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700", CANCELLED: "border-slate-200 bg-slate-100 text-slate-600", LATE: "border-amber-200 bg-amber-50 text-amber-700",
}

interface GoodsReportTabProps {
  filters: ReportsScopeFilters
  dateRangeInvalid: boolean
  selectedGranularity: GoodsReportGranularity
  comparisonFilters?: ReportsScopeFilters | null
  comparisonLabel?: string
  onExportAvailabilityChange?(canExport: boolean): void
}

export const GoodsReportTab = forwardRef<ReportExportHandle, GoodsReportTabProps>(function GoodsReportTab({ filters, dateRangeInvalid, selectedGranularity, comparisonFilters = null, comparisonLabel = "Önceki dönem", onExportAvailabilityChange }, ref) {
  const [movements, setMovements] = useState<GoodsMovement[]>([])
  const [movementsLoaded, setMovementsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [selectedMovement, setSelectedMovement] = useState<GoodsMovement | null>(null)
  const detailTriggerRef = useRef<HTMLTableRowElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const workspace = useMemo(() => parseGoodsReportWorkspace(searchParams), [searchParams])
  const todayDate = formatTr(new Date(), "yyyy-MM-dd")

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    void reportsService.getGoodsDataset({})
      .then((next) => { if (!cancelled) { setMovements(next); setMovementsLoaded(true) } })
      .catch((cause: unknown) => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "Mal hareketi raporu alınamadı.") })
    return () => { cancelled = true }
  }, [reloadNonce])

  const reportMovements = useMemo(() => filterGoodsMovementsForReport(movements, filters), [movements, filters])
  const recordMovements = useMemo(() => sortGoodsReportRecords(searchGoodsReportRecords(filterGoodsReportRecordsByStatus(reportMovements, workspace.status), workspace.search), workspace.sort), [reportMovements, workspace.search, workspace.sort, workspace.status])
  const isSingleDay = filters.startDate !== "" && filters.startDate === filters.endDate
  const trendGranularity = isSingleDay ? "hourly" : selectedGranularity
  const kpis = useMemo(() => calculateGoodsReportKpis(reportMovements), [reportMovements])
  const trend = useMemo(() => calculateGoodsMovementTrend(reportMovements, filters, trendGranularity), [filters, reportMovements, trendGranularity])
  const previousMovements = useMemo(() => comparisonFilters ? filterGoodsMovementsForReport(movements, comparisonFilters) : null, [comparisonFilters, movements])
  const hasComparisonData = previousMovements !== null && previousMovements.length > 0
  const previousKpis = useMemo(() => previousMovements ? calculateGoodsReportKpis(previousMovements) : null, [previousMovements])
  const previousTrend = useMemo(() => previousMovements && comparisonFilters ? calculateGoodsMovementTrend(previousMovements, comparisonFilters, trendGranularity) : null, [comparisonFilters, previousMovements, trendGranularity])
  const sharedAxis = useMemo(() => hasComparisonData && previousTrend ? calculateSharedGoodsTrendYAxis(trend, previousTrend, todayDate) : undefined, [hasComparisonData, previousTrend, todayDate, trend])
  const totalDelta = hasComparisonData && previousKpis ? formatGoodsReportDelta(kpis.total, previousKpis.total) : null
  const inboundDelta = hasComparisonData && previousKpis ? formatGoodsReportDelta(kpis.inbound, previousKpis.inbound) : null
  const outboundDelta = hasComparisonData && previousKpis ? formatGoodsReportDelta(kpis.outbound, previousKpis.outbound) : null
  const lateDelta = hasComparisonData && previousKpis ? formatGoodsReportDelta(kpis.lateCount, previousKpis.lateCount) : null
  const pageCount = getGoodsReportPageCount(recordMovements.length)
  const page = Math.min(workspace.page, pageCount)
  const paginatedMovements = useMemo(() => paginateGoodsReport(recordMovements, page), [page, recordMovements])
  const visibleStart = recordMovements.length === 0 ? 0 : (page - 1) * GOODS_REPORT_PAGE_SIZE + 1
  const visibleEnd = Math.min(page * GOODS_REPORT_PAGE_SIZE, recordMovements.length)
  const headers = useMemo(() => GOODS_REPORT_COLUMNS.map((column) => column.header), [])
  const exportFilenameBase = `mal-hareketi-raporu_${filters.startDate || "tumu"}_${filters.endDate || "tumu"}`

  const openRecordsForMetric = (status: GoodsReportRecordsStatusFilter) => setSearchParams(setGoodsReportWorkspace(searchParams, { view: "records", status }))

  useEffect(() => {
    if (workspace.view !== "records" || !movementsLoaded) return
    const rawPage = searchParams.get("goodsPage")
    if (page !== workspace.page || (rawPage !== null && rawPage !== String(workspace.page))) setSearchParams(setGoodsReportPage(searchParams, page), { replace: true })
  }, [movementsLoaded, page, searchParams, setSearchParams, workspace.page, workspace.view])
  useEffect(() => { onExportAvailabilityChange?.(!dateRangeInvalid && movementsLoaded && (workspace.view === "records" ? recordMovements.length > 0 : reportMovements.length > 0)) }, [dateRangeInvalid, movementsLoaded, onExportAvailabilityChange, recordMovements.length, reportMovements.length, workspace.view])

  const exportRows = () => buildGoodsReportRows(workspace.view === "records" ? recordMovements : reportMovements)
  useImperativeHandle(ref, () => ({
    exportCsv: () => downloadReportCsv(headers, exportRows(), `${exportFilenameBase}.csv`),
    exportExcel: () => { void downloadReportExcel("Mal Hareketi", headers, exportRows(), `${exportFilenameBase}.xlsx`) },
    exportPdf: () => { void downloadReportPdf("Mal Hareketi Raporu", headers, exportRows(), `${exportFilenameBase}.pdf`) },
    exportChartPng: () => { const card = document.getElementById("goods-analysis-card"); if (card) void downloadElementAsPng(card, `mal-hareketi-analizi_${filters.startDate || "tumu"}_${filters.endDate || "tumu"}.png`) },
  }))

  if (loadError) return (
    <section className="flex h-full min-h-0 flex-col items-center justify-center rounded-lg border border-red-200 bg-card p-6 text-center shadow-panel" role="alert">
      <p className="text-sm font-semibold text-slate-900">Mal hareketi raporu yüklenemedi</p>
      <p className="mt-1 text-xs text-slate-600">{loadError}</p>
      <button type="button" className="mt-4 inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-xs font-medium text-white hover:bg-slate-700" onClick={() => setReloadNonce((value) => value + 1)}>Tekrar dene</button>
    </section>
  )
  if (!movementsLoaded) return <section className="h-full animate-pulse rounded-lg border bg-slate-100" aria-label="Rapor yükleniyor" role="status" />

  if (workspace.view === "records") return <><section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-panel" aria-label="Mal hareketi kayıtları">{dateRangeInvalid ? <EmptyState title="Geçersiz tarih aralığı" description="Başlangıç tarihi bitiş tarihinden sonra olamaz." /> : recordMovements.length === 0 ? <EmptyState title={workspace.search ? "Eşleşen kayıt bulunamadı" : "Eşleşen mal hareketi bulunamadı"} description={workspace.search ? "Arama ifadesini değiştirerek yeniden deneyin." : "Filtre ölçütlerini değiştirerek yeniden deneyin."} showSearch /> : <><div className="min-h-0 flex-1 overflow-hidden"><div className="h-full overflow-x-auto overflow-y-hidden scrollbar-thin"><table className="h-full w-full min-w-[1100px] table-fixed text-left text-xs"><thead className="border-b bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><tr><SortableHeader className="w-[9%]" label="Yön" field="direction" sort={workspace.sort} onChange={(sort) => setSearchParams(setGoodsReportWorkspace(searchParams, { sort }))} /><SortableHeader className="w-[16%]" label="Şirket / Tesis" field="scope" sort={workspace.sort} onChange={(sort) => setSearchParams(setGoodsReportWorkspace(searchParams, { sort }))} /><SortableHeader className="w-[15%]" label="Karşı Taraf" field="counterparty" sort={workspace.sort} onChange={(sort) => setSearchParams(setGoodsReportWorkspace(searchParams, { sort }))} /><SortableHeader className="w-[14%]" label="Planlanan Tarih / Saat" field="planned" sort={workspace.sort} onChange={(sort) => setSearchParams(setGoodsReportWorkspace(searchParams, { sort }))} /><SortableHeader className="w-[14%]" label="Gerçek Zaman" field="actual" sort={workspace.sort} onChange={(sort) => setSearchParams(setGoodsReportWorkspace(searchParams, { sort }))} /><SortableHeader className="w-[10%]" label="Durum" field="status" sort={workspace.sort} onChange={(sort) => setSearchParams(setGoodsReportWorkspace(searchParams, { sort }))} /><SortableHeader className="w-[11%]" label="Referans No" field="reference" sort={workspace.sort} onChange={(sort) => setSearchParams(setGoodsReportWorkspace(searchParams, { sort }))} /><SortableHeader className="w-[11%]" label="Plaka / Şoför" field="driver" sort={workspace.sort} onChange={(sort) => setSearchParams(setGoodsReportWorkspace(searchParams, { sort }))} /></tr></thead><tbody>{paginatedMovements.map((movement) => <GoodsRecordRow key={movement.id} movement={movement} onOpen={(row) => { detailTriggerRef.current = row; setSelectedMovement(movement) }} />)}{Array.from({ length: Math.max(0, GOODS_REPORT_PAGE_SIZE - paginatedMovements.length) }).map((_, index) => <GoodsReportFillerRow key={`goods-filler-${index}`} />)}</tbody></table></div></div><div className="shrink-0"><ReportPagination page={page} pageCount={pageCount} visibleStart={visibleStart} visibleEnd={visibleEnd} total={recordMovements.length} visiblePageNumbers={getVisibleGoodsReportPageNumbers(page, pageCount)} onPageChange={(nextPage) => setSearchParams(setGoodsReportPage(searchParams, nextPage))} ariaLabel="Mal hareketi rapor sayfaları" /></div></>}</section><GoodsMovementDetailDialog movement={selectedMovement} open={selectedMovement !== null} onOpenChange={(open) => { if (!open) setSelectedMovement(null) }} returnFocusRef={detailTriggerRef} /></>

  return <section id="goods-analysis-card" className="flex h-full min-h-0 flex-col overflow-hidden bg-card px-3 py-2" aria-label="Mal hareketi analizi">{!dateRangeInvalid && <div className="mt-1 flex shrink-0 items-start gap-x-2 py-0.5 text-left" aria-label="Mal hareketi analiz metrikleri"><GoodsAnalysisMetric value={String(kpis.total)} label="Hareket" delta={totalDelta} favorableDirection="increase" onActivate={() => openRecordsForMetric("all")} /><GoodsAnalysisMetric value={String(kpis.inbound)} label="Gelen" delta={inboundDelta} favorableDirection="increase" onActivate={() => openRecordsForMetric("inbound")} /><GoodsAnalysisMetric value={String(kpis.outbound)} label="Giden" delta={outboundDelta} favorableDirection="increase" onActivate={() => openRecordsForMetric("outbound")} /><GoodsAnalysisMetric value={String(kpis.lateCount)} label="Geciken" delta={lateDelta} favorableDirection="decrease" onActivate={() => openRecordsForMetric("late")} /></div>}<div className="mt-3 min-h-0 flex-1">{dateRangeInvalid ? <EmptyState title="Geçersiz tarih aralığı" description="Başlangıç tarihi bitiş tarihinden sonra olamaz." /> : hasComparisonData && previousTrend ? <div className="flex h-full min-h-0 flex-col gap-1.5"><TrendPanel primary points={trend} todayDate={todayDate} axes={sharedAxis} /><TrendPanel label={`${comparisonLabel} · ${formatGoodsRangeLabel(comparisonFilters!)}`} points={previousTrend} axes={sharedAxis} /></div> : <GoodsMovementTrendChart points={trend} todayDate={todayDate} />}</div>{!dateRangeInvalid && <div className="mt-1 flex shrink-0 justify-end border-t border-slate-100 pt-1"><GoodsMovementTrendLegend /></div>}</section>
})

function GoodsAnalysisMetric({ value, label, delta = null, favorableDirection, onActivate }: { value: string; label: string; delta?: { difference: number; label: string } | null; favorableDirection: "increase" | "decrease"; onActivate?: () => void }) {
  const tone = delta ? delta.difference === 0 ? "neutral" : (favorableDirection === "increase" ? delta.difference > 0 : delta.difference < 0) ? "positive" : "negative" : "neutral"
  const deltaClassName = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : "text-slate-400"
  const content = <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5"><p className="min-w-0 text-base font-semibold leading-none tabular-nums text-slate-900">{value}</p><p className="text-[10px] leading-normal text-slate-500">{label}</p>{delta && <p className={`text-[10px] font-medium leading-normal tabular-nums ${deltaClassName}`}>{delta.label}</p>}</div>
  return onActivate ? <button type="button" className="min-w-0 flex-1 cursor-pointer rounded-sm pl-1.5 text-left transition-colors hover:bg-blue-50 hover:shadow-[inset_3px_0_0_hsl(var(--primary))] focus-visible:bg-blue-50 focus-visible:shadow-[inset_3px_0_0_hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400" aria-label={`${label} kayıtlarını gösterin`} onClick={onActivate}>{content}</button> : <div className="min-w-0 flex-1">{content}</div>
}

function formatGoodsRangeLabel(filters: ReportsScopeFilters) {
  if (!filters.startDate || !filters.endDate) return "Tüm tarihler"
  const start = parse(filters.startDate, "yyyy-MM-dd", new Date())
  const end = parse(filters.endDate, "yyyy-MM-dd", new Date())
  return `${formatTr(start, "d MMM yyyy")} – ${formatTr(end, "d MMM yyyy")}`
}

function TrendPanel({ primary = false, label, points, todayDate, axes }: { primary?: boolean; label?: string; points: import("@/features/reports/goods-report-utils").GoodsMovementTrendPoint[]; todayDate?: string; axes?: import("@/features/reports/goods-report-utils").GoodsTrendAxes }) { return <div className={`flex min-h-0 basis-0 flex-col ${primary ? "flex-[2]" : "flex-1"}`}>{label && <p className="report-png-comparison-label mb-0.5 shrink-0 truncate text-[11px] font-medium uppercase tracking-[0.02em] text-slate-500">{label}</p>}<div className="min-h-0 flex-1"><GoodsMovementTrendChart points={points} todayDate={todayDate} axes={axes} /></div></div> }
function GoodsRecordRow({ movement, onOpen }: { movement: GoodsMovement; onOpen(row: HTMLTableRowElement): void }) { const status = getGoodsMovementDisplayStatus(movement); return <tr tabIndex={0} aria-haspopup="dialog" aria-label={`${movement.counterpartyName} mal hareketi detayını aç`} className="record-row-hover h-[3.375rem] cursor-pointer border-b last:border-b-0 transition-colors hover:bg-slate-50/80 focus-visible:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" onClick={(event) => onOpen(event.currentTarget)} onKeyDown={(event) => { if (!isGoodsRecordActivationKey(event.key)) return; event.preventDefault(); onOpen(event.currentTarget) }}><td className="px-3 py-1 font-medium">{getGoodsDirectionLabel(movement.direction)}</td><td className="px-3 py-1"><p className="truncate" title={movement.companyName}>{movement.companyName}</p><p className="mt-0.5 truncate text-[10px] text-slate-500" title={movement.facilityName}>{movement.facilityName}</p></td><td className="px-3 py-1"><p className="truncate" title={movement.counterpartyName}>{movement.counterpartyName}</p></td><td className="px-3 py-1 tabular-nums">{formatTr(new Date(`${movement.plannedDate}T12:00:00`), "d MMM yyyy")}{movement.plannedTime ? ` · ${movement.plannedTime}` : ""}</td><td className="px-3 py-1 tabular-nums">{movement.actualAt ? formatTr(new Date(movement.actualAt), "d MMM HH:mm") : "—"}</td><td className="px-3 py-1"><span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass[status]}`}>{GOODS_REPORT_STATUS_LABELS[status]}</span></td><td className="px-3 py-1"><p className="truncate" title={movement.referenceNumber}>{movement.referenceNumber ?? "—"}</p></td><td className="px-3 py-1"><p className="truncate" title={`${movement.actualPlate ?? "—"} / ${movement.actualDriverName ?? "—"}`}>{movement.actualPlate || movement.actualDriverName ? `${movement.actualPlate ?? "—"} / ${movement.actualDriverName ?? "—"}` : "—"}</p></td></tr> }
function GoodsReportFillerRow() { return <tr aria-hidden="true" className="pointer-events-none h-[3.375rem] select-none border-b border-transparent last:border-b-0"><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /></tr> }
function EmptyState({ title, description, showSearch = false }: { title: string; description: string; showSearch?: boolean }) { return <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">{showSearch && <Search className="size-6 text-slate-400" />}<p className={`${showSearch ? "mt-2" : ""} text-xs font-semibold text-slate-900`}>{title}</p><p className="mt-0.5 text-[11px] text-slate-600">{description}</p></div> }
function SortableHeader({ className, label, field, sort, onChange }: { className: string; label: string; field: GoodsReportSortField; sort: import("@/lib/sort").SingleSortState<GoodsReportSortField>; onChange(sort: import("@/lib/sort").SingleSortState<GoodsReportSortField>): void }) { const active = sort?.field === field; const Icon = sort?.direction === "asc" ? ArrowUp : ArrowDown; return <th className={`${className} px-3 py-1.5`} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className="inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-300" aria-label={active ? `${label} sütunu sıralamasını kaldır` : `${label} sütununu artan sırala`} onClick={() => onChange(toggleSingleSort(sort, field))}>{label}{active && <Icon className="size-3" aria-hidden="true" />}</button></th> }
