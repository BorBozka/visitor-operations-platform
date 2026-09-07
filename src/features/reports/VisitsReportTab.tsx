import { parse } from "date-fns"
import { ArrowDown, ArrowUp, Search } from "lucide-react"
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"

import type { Visit } from "@/domain/visits"
import {
  buildVisitsReportRows,
  downloadReportCsv,
  downloadReportExcel,
  downloadReportPdf,
  downloadElementAsPng,
  VISITS_REPORT_COLUMNS,
  type ReportExportHandle,
} from "@/features/reports/report-export"
import { formatDurationMinutes } from "@/features/reports/report-format"
import { ReportPagination } from "@/features/reports/ReportPagination"
import type { ReportsScopeFilters } from "@/features/reports/reports-filters"
import {
  buildVisitsTrendSeries,
  calculateVisitsReportKpis,
  calculateVisitsReportTrendWithStatus,
  calculateVisitsTrendAxes,
  filterVisitsReportRecordsByStatus,
  filterVisitsForReport,
  formatVisitsReportDelta,
  getVisitsMetricDeltaTone,
  getReportPageCount,
  getReportPageRange,
  getVisibleReportPageNumbers,
  getVisitDelayMinutes,
  getVisitDurationMinutes,
  getVisitReportStatusGroup,
  groupVisitsReportDailyTrendByOutcome,
  paginateReportVisits,
  searchVisitsReportRecords,
  sortVisitsReportRecords,
  VISITS_REPORT_PAGE_SIZE,
  VISITS_REPORT_STATUS_COLORS,
  VISITS_REPORT_STATUS_LABELS,
  type VisitsReportDailyTrendGroupedPoint,
  type VisitsTrendAxes,
  type VisitsReportTrendGranularity,
  type VisitsReportRecordsStatusFilter,
  type VisitsReportSortField,
} from "@/features/reports/visits-report-utils"
import { VisitsTrendChart, VisitsTrendLegend } from "@/features/reports/VisitsTrendChart"
import { VisitDetailsDialog } from "@/features/visits/VisitDetailsDialog"
import { formatTr } from "@/lib/date"
import { toggleSingleSort, type SingleSortState } from "@/lib/sort"

export type VisitsWorkspaceMode = "analysis" | "records"
export type VisitsReportGranularity = Exclude<VisitsReportTrendGranularity, "hourly">

interface VisitsReportTabProps {
  visits: Visit[]
  filters: ReportsScopeFilters
  dateRangeInvalid: boolean
  workspaceMode: VisitsWorkspaceMode
  selectedGranularity: VisitsReportGranularity
  recordsPage: number
  onRecordsPageChange(page: number): void
  recordsSearch: string
  recordsStatus: VisitsReportRecordsStatusFilter
  recordsSort: SingleSortState<VisitsReportSortField>
  onRecordsSortChange(sort: SingleSortState<VisitsReportSortField>): void
  onMetricNavigate(status: VisitsReportRecordsStatusFilter): void
  comparisonEnabled?: boolean
  comparisonFilters?: ReportsScopeFilters | null
  comparisonLabel?: string
  onExportAvailabilityChange?(canExport: boolean): void
}

interface MetricDelta {
  difference: number
  label: string
}

function countDelta(current: number, previous: number): MetricDelta {
  const delta = formatVisitsReportDelta(current, previous)
  return { difference: delta.difference, label: delta.difference === 0 ? "değişmedi" : delta.label }
}

function durationDelta(currentMinutes: number | null, previousMinutes: number | null): MetricDelta | null {
  if (currentMinutes === null || previousMinutes === null) return null
  const difference = currentMinutes - previousMinutes
  if (difference === 0) return { difference, label: "değişmedi" }
  return { difference, label: `${difference > 0 ? "+" : "−"}${formatDurationMinutes(Math.abs(difference))}` }
}

function formatRangeLabel(filters: ReportsScopeFilters) {
  if (!filters.startDate || !filters.endDate) return "Tüm tarihler"
  const start = parse(filters.startDate, "yyyy-MM-dd", new Date())
  const end = parse(filters.endDate, "yyyy-MM-dd", new Date())
  return `${formatTr(start, "d MMM yyyy")} – ${formatTr(end, "d MMM yyyy")}`
}

export const VisitsReportTab = forwardRef<ReportExportHandle, VisitsReportTabProps>(function VisitsReportTab({ visits, filters, dateRangeInvalid, workspaceMode, selectedGranularity, recordsPage, onRecordsPageChange, recordsSearch, recordsStatus, recordsSort, onRecordsSortChange, onMetricNavigate, comparisonEnabled = false, comparisonFilters = null, comparisonLabel = "Önceki dönem", onExportAvailabilityChange }, ref) {
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
  const analysisCardRef = useRef<HTMLElement | null>(null)
  const todayDate = formatTr(new Date(), "yyyy-MM-dd")
  const isTodayRange = filters.startDate !== "" && filters.startDate === filters.endDate && filters.endDate === todayDate
  const trendGranularity: VisitsReportTrendGranularity = isTodayRange ? "hourly" : selectedGranularity
  const reportVisits = useMemo(() => filterVisitsForReport(visits, filters), [filters, visits])
  const recordVisits = useMemo(() => sortVisitsReportRecords(searchVisitsReportRecords(filterVisitsReportRecordsByStatus(reportVisits, recordsStatus), recordsSearch), recordsSort), [recordsSearch, recordsSort, recordsStatus, reportVisits])
  const kpis = useMemo(() => calculateVisitsReportKpis(reportVisits), [reportVisits])
  const dailyTrendWithStatus = useMemo(() => calculateVisitsReportTrendWithStatus(reportVisits, filters, trendGranularity), [reportVisits, filters, trendGranularity])
  const dailyTrendGrouped = useMemo(() => groupVisitsReportDailyTrendByOutcome(dailyTrendWithStatus), [dailyTrendWithStatus])
  const headers = useMemo(() => VISITS_REPORT_COLUMNS.map((column) => column.header), [])
  const exportFilenameBase = `ziyaretler-raporu_${filters.startDate || "tumu"}_${filters.endDate || "tumu"}`

  const previousFilters = comparisonEnabled ? comparisonFilters : null
  const previousReportVisits = useMemo(() => previousFilters ? filterVisitsForReport(visits, previousFilters) : null, [previousFilters, visits])
  const previousKpis = useMemo(() => previousReportVisits ? calculateVisitsReportKpis(previousReportVisits) : null, [previousReportVisits])
  const previousDailyTrendGrouped = useMemo(() => {
    if (!previousFilters || !previousReportVisits) return null
    return groupVisitsReportDailyTrendByOutcome(calculateVisitsReportTrendWithStatus(previousReportVisits, previousFilters, trendGranularity))
  }, [previousFilters, previousReportVisits, trendGranularity])
  const showComparisonCharts = comparisonEnabled && previousFilters !== null && previousDailyTrendGrouped !== null
  // Both comparison charts are drawn against one axis pair, so the same height means the same
  // value in either panel; the previous period never contributes an ongoing bucket.
  const sharedTrendAxes = useMemo<VisitsTrendAxes | undefined>(
    () => showComparisonCharts && previousDailyTrendGrouped
      ? calculateVisitsTrendAxes(buildVisitsTrendSeries(dailyTrendGrouped, todayDate), buildVisitsTrendSeries(previousDailyTrendGrouped))
      : undefined,
    [showComparisonCharts, dailyTrendGrouped, previousDailyTrendGrouped, todayDate],
  )

  const totalDelta = previousKpis ? countDelta(kpis.total, previousKpis.total) : null
  const checkedInDelta = previousKpis ? countDelta(kpis.actuallyCheckedIn, previousKpis.actuallyCheckedIn) : null
  const averageDurationDelta = previousKpis ? durationDelta(kpis.averageDurationMinutes, previousKpis.averageDurationMinutes) : null
  const lateDelta = previousKpis ? countDelta(kpis.lateArrivals, previousKpis.lateArrivals) : null
  const lateDepartureDelta = previousKpis ? countDelta(kpis.lateDepartures, previousKpis.lateDepartures) : null

  const recordsPageCount = getReportPageCount(recordVisits.length)
  const normalizedRecordsPage = Math.min(Math.max(1, recordsPage), recordsPageCount)
  const paginatedVisits = useMemo(() => paginateReportVisits(recordVisits, normalizedRecordsPage), [recordVisits, normalizedRecordsPage])
  const recordsRange = getReportPageRange(recordVisits.length, normalizedRecordsPage)

  useEffect(() => {
    if (recordsPage !== normalizedRecordsPage) onRecordsPageChange(normalizedRecordsPage)
  }, [normalizedRecordsPage, onRecordsPageChange, recordsPage])

  useEffect(() => {
    onExportAvailabilityChange?.(!dateRangeInvalid && (workspaceMode === "records" ? recordVisits.length > 0 : reportVisits.length > 0))
  }, [dateRangeInvalid, onExportAvailabilityChange, recordVisits.length, reportVisits.length, workspaceMode])

  const exportRows = () => buildVisitsReportRows(workspaceMode === "records" ? recordVisits : reportVisits)

  useImperativeHandle(ref, () => ({
    exportCsv: () => downloadReportCsv(headers, exportRows(), `${exportFilenameBase}.csv`),
    exportExcel: () => { void downloadReportExcel("Ziyaretler", headers, exportRows(), `${exportFilenameBase}.xlsx`) },
    exportPdf: () => { void downloadReportPdf("Ziyaretler Raporu", headers, exportRows(), `${exportFilenameBase}.pdf`) },
    exportChartPng: () => { if (analysisCardRef.current) void downloadElementAsPng(analysisCardRef.current, `ziyaret-analizi_${filters.startDate || "tumu"}_${filters.endDate || "tumu"}.png`) },
  }))

  if (workspaceMode === "records") {
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-panel" aria-labelledby="visits-records-title">
        <h2 id="visits-records-title" className="sr-only">Ziyaret kayıtları</h2>
        {dateRangeInvalid ? (
          <EmptyRecordsState invalid />
        ) : recordVisits.length === 0 ? (
          <EmptyRecordsState searched={reportVisits.length > 0 && Boolean(recordsSearch.trim())} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full overflow-x-auto overflow-y-hidden scrollbar-thin">
                <table className="h-full w-full min-w-[980px] table-fixed text-left text-xs">
                  <thead className="border-b bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <SortableHeader className="w-[10%]" label="Tarih" field="date" sort={recordsSort} onChange={onRecordsSortChange} />
                      <SortableHeader className="w-[15%]" label="Ziyaretçi" field="visitor" sort={recordsSort} onChange={onRecordsSortChange} />
                      <SortableHeader className="w-[14%]" label="Firma" field="company" sort={recordsSort} onChange={onRecordsSortChange} />
                      <SortableHeader className="w-[14%]" label="Ziyaret Edilen" field="host" sort={recordsSort} onChange={onRecordsSortChange} />
                      <SortableHeader className="w-[12%]" label="Planlanan" field="planned" sort={recordsSort} onChange={onRecordsSortChange} />
                      <th className="w-[13%] px-3 py-1.5">Gerçekleşen</th>
                      <SortableHeader className="w-[9%]" label="Süre" field="duration" sort={recordsSort} onChange={onRecordsSortChange} />
                      <SortableHeader className="w-[13%]" label="Durum" field="status" sort={recordsSort} onChange={onRecordsSortChange} />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedVisits.map((visit) => (
                      <tr key={visit.id} role="button" tabIndex={0} aria-label={`${visit.visitor.firstName} ${visit.visitor.lastName} ziyaret detaylarını görüntüle`} className="record-row-hover h-[3.375rem] cursor-pointer border-b last:border-b-0 transition-colors hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-none" onClick={() => setSelectedVisit(visit)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedVisit(visit) } }}>
                        <td className="px-3 py-1 tabular-nums">{formatTr(new Date(visit.plannedStart), "d MMM yyyy")}</td>
                        <td className="px-3 py-1"><p className="truncate font-medium text-slate-900" title={`${visit.visitor.firstName} ${visit.visitor.lastName}`}>{visit.visitor.firstName} {visit.visitor.lastName}</p></td>
                        <td className="px-3 py-1"><p className="truncate" title={visit.visitor.company}>{visit.visitor.company}</p></td>
                        <td className="px-3 py-1"><p className="truncate" title={visit.hostEmployeeName}>{visit.hostEmployeeName}</p></td>
                        <td className="px-3 py-1 tabular-nums">{formatTr(new Date(visit.plannedStart), "HH:mm")}–{formatTr(new Date(visit.plannedEnd), "HH:mm")}</td>
                        <td className="px-3 py-1"><ActualTimesCell visit={visit} /></td>
                        <td className="px-3 py-1 tabular-nums">{formatDurationMinutes(getVisitDurationMinutes(visit))}</td>
                        <td className="px-3 py-1"><VisitsReportStatusPill status={visit.status} /></td>
                      </tr>
                    ))}
                    {Array.from({ length: Math.max(0, VISITS_REPORT_PAGE_SIZE - paginatedVisits.length) }).map((_, index) => <VisitsReportFillerRow key={`visit-filler-${index}`} />)}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="shrink-0">
              <ReportPagination
                page={normalizedRecordsPage}
                pageCount={recordsPageCount}
                visibleStart={recordsRange.start}
                visibleEnd={recordsRange.end}
                total={recordVisits.length}
                visiblePageNumbers={getVisibleReportPageNumbers(normalizedRecordsPage, Math.max(1, recordsPageCount))}
                onPageChange={onRecordsPageChange}
                ariaLabel="Ziyaret kayıtları sayfaları"
              />
            </div>
            <VisitDetailsDialog
              visit={selectedVisit}
              open={selectedVisit !== null}
              onOpenChange={(open) => { if (!open) setSelectedVisit(null) }}
              onEdit={() => undefined}
              onReschedule={() => undefined}
              onCancel={() => undefined}
              readOnly
              viewerRole="MANAGER"
            />
          </>
        )}
      </section>
    )
  }

  return (
    <section ref={analysisCardRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-card px-3 py-2" aria-label="Ziyaret analizi">
      {!dateRangeInvalid && (
        <>
          <div className="mt-1 flex shrink-0 items-start gap-x-1 py-0.5 text-left sm:gap-x-2" aria-label="Ziyaret analiz metrikleri">
            <AnalysisMetric value={String(kpis.total)} label="Ziyaret" delta={comparisonEnabled ? totalDelta : null} favorableDirection="increase" onActivate={() => onMetricNavigate("all")} />
            <AnalysisMetric value={String(kpis.actuallyCheckedIn)} label="Gerçekleşen" delta={comparisonEnabled ? checkedInDelta : null} favorableDirection="increase" onActivate={() => onMetricNavigate("completed")} />
            <AnalysisMetric value={formatDurationMinutes(kpis.averageDurationMinutes)} label="Ort. süre" delta={comparisonEnabled ? averageDurationDelta : null} favorableDirection="decrease" />
            <AnalysisMetric value={String(kpis.lateArrivals)} label="Geç giriş" delta={comparisonEnabled ? lateDelta : null} favorableDirection="decrease" onActivate={() => onMetricNavigate("late-arrival")} />
            <AnalysisMetric value={String(kpis.lateDepartures)} label="Geç çıkış" delta={comparisonEnabled ? lateDepartureDelta : null} favorableDirection="decrease" onActivate={() => onMetricNavigate("late-departure")} />
          </div>
        </>
      )}

      <div className="mt-3 min-h-0 flex-1">
        {dateRangeInvalid ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <p className="text-sm font-semibold text-slate-900">Geçersiz tarih aralığı</p>
            <p className="mt-1 text-xs text-slate-600">Başlangıç tarihi bitiş tarihinden sonra olamaz.</p>
          </div>
        ) : showComparisonCharts && previousFilters && previousDailyTrendGrouped ? (
          <div className="flex h-full min-h-0 flex-col gap-1.5">
            <ComparisonTrendPanel primary points={dailyTrendGrouped} todayDate={todayDate} axes={sharedTrendAxes} />
            <ComparisonTrendPanel label={`${comparisonLabel} · ${formatRangeLabel(previousFilters)}`} points={previousDailyTrendGrouped} axes={sharedTrendAxes} />
          </div>
        ) : (
          <VisitsTrendChart points={dailyTrendGrouped} todayDate={todayDate} />
        )}
      </div>

      {!dateRangeInvalid && (
        <div className="mt-1 flex shrink-0 justify-end border-t border-slate-100 pt-1">
          <VisitsTrendLegend />
        </div>
      )}
    </section>
  )
})

function ComparisonTrendPanel({ primary = false, label, points, todayDate, axes }: { primary?: boolean; label?: string; points: VisitsReportDailyTrendGroupedPoint[]; todayDate?: string; axes?: VisitsTrendAxes }) {
  return (
    <div className={`flex min-h-0 basis-0 flex-col ${primary ? "flex-[2]" : "flex-1"}`}>
      {label && <p className="report-png-comparison-label mb-0.5 shrink-0 truncate text-[11px] font-medium uppercase tracking-[0.02em] text-slate-500">{label}</p>}
      <div className="min-h-0 flex-1"><VisitsTrendChart points={points} todayDate={todayDate} axes={axes} /></div>
    </div>
  )
}

function AnalysisMetric({ value, label, delta, favorableDirection, onActivate }: { value: string; label: string; delta: MetricDelta | null; favorableDirection: "increase" | "decrease"; onActivate?: () => void }) {
  const tone = delta ? getVisitsMetricDeltaTone(delta.difference, favorableDirection) : "neutral"
  const deltaClassName = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : "text-slate-400"
  const content = <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5"><p className="min-w-0 text-base font-semibold leading-none tabular-nums text-slate-900">{value}</p><p className="text-[10px] leading-normal text-slate-500">{label}</p>{delta && <p className={`text-[10px] font-medium leading-normal tabular-nums ${deltaClassName}`}>{delta.label}</p>}</div>
  return onActivate
    ? <button type="button" className="min-w-0 flex-1 cursor-pointer rounded-sm pl-1.5 text-left transition-colors hover:bg-blue-50 hover:shadow-[inset_3px_0_0_hsl(var(--primary))] focus-visible:bg-blue-50 focus-visible:shadow-[inset_3px_0_0_hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400" aria-label={`${label} kayıtlarını gösterin`} onClick={onActivate}>{content}</button>
    : <div className="min-w-0 flex-1">{content}</div>
}

function EmptyRecordsState({ invalid = false, searched = false }: { invalid?: boolean; searched?: boolean }) {
  if (invalid) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="text-sm font-semibold text-slate-900">Geçersiz tarih aralığı</p>
        <p className="mt-1 text-xs text-slate-600">Başlangıç tarihi bitiş tarihinden sonra olamaz.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
      <Search className="mx-auto size-6 text-slate-400" />
      <h3 className="mt-2 text-xs font-semibold text-slate-900">{searched ? "Eşleşen kayıt bulunamadı" : "Eşleşen ziyaret bulunamadı"}</h3>
      <p className="mt-0.5 text-[11px] text-slate-600">{searched ? "Arama ifadesini değiştirerek yeniden deneyin." : "Filtre ölçütlerini değiştirerek yeniden deneyin."}</p>
    </div>
  )
}

function SortableHeader({ className, label, field, sort, onChange }: { className: string; label: string; field: VisitsReportSortField; sort: SingleSortState<VisitsReportSortField>; onChange(sort: SingleSortState<VisitsReportSortField>): void }) {
  const active = sort?.field === field
  const Icon = sort?.direction === "asc" ? ArrowUp : ArrowDown
  return <th className={`${className} px-3 py-1.5`} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className="inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-300" aria-label={active ? `${label} sütunu sıralamasını kaldır` : `${label} sütununu artan sırala`} onClick={() => onChange(toggleSingleSort(sort, field))}>{label}{active && <Icon className="size-3" aria-hidden="true" />}</button></th>
}

function VisitsReportFillerRow() {
  return <tr aria-hidden="true" className="pointer-events-none h-[3.375rem] select-none border-b border-transparent last:border-b-0"><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /></tr>
}

function ActualTimesCell({ visit }: { visit: Visit }) {
  if (!visit.actualCheckIn) {
    return (
      <div className="grid min-h-9 grid-rows-[1rem_0.75rem] leading-tight">
        <span className="text-slate-400">—</span>
        <span aria-hidden="true" className="block h-3" />
      </div>
    )
  }

  const delay = getVisitDelayMinutes(visit)
  return (
    <div className="grid min-h-9 grid-rows-[1rem_0.75rem] leading-tight">
      <p className="tabular-nums">{formatTr(new Date(visit.actualCheckIn), "HH:mm")}–{visit.actualCheckOut ? formatTr(new Date(visit.actualCheckOut), "HH:mm") : "—"}</p>
      {delay !== null && delay > 0
        ? <p className="text-[10px] font-medium text-amber-600">+{delay} dk</p>
        : <span aria-hidden="true" className="block h-3" />}
    </div>
  )
}

function VisitsReportStatusPill({ status }: { status: Visit["status"] }) {
  const group = getVisitReportStatusGroup(status)
  const color = VISITS_REPORT_STATUS_COLORS[group]
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: `${color}40`, backgroundColor: `${color}14`, color }}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {VISITS_REPORT_STATUS_LABELS[group]}
    </span>
  )
}
