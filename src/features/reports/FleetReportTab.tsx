import { ArrowDown, ArrowUp, Search } from "lucide-react"
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import type { PlannedTransportAssignment } from "@/domain/transport-assignments"
import type { Meeting, Visit } from "@/domain/visits"
import { FleetAssignmentDetailDialog } from "@/features/reports/FleetAssignmentDetailDialog"
import { FleetLoadChart } from "@/features/reports/FleetLoadChart"
import {
  aggregateFleetResourceLoad,
  calculateFleetReportMetrics,
  filterFleetReportRecordsByStatus,
  filterAssignmentsForReport,
  FLEET_REPORT_PAGE_SIZE,
  getFleetLoadChartResources,
  getFleetMetricDeltaTone,
  getFleetReportPageCount,
  getRelatedRecordLabel,
  getVisibleFleetReportPageNumbers,
  isFleetRecordActivationKey,
  mergeFleetLoadComparison,
  paginateFleetReport,
  parseFleetReportWorkspace,
  setFleetReportWorkspace,
  setFleetReportPage,
  searchFleetReportRecords,
  sortFleetReportRecords,
  type FleetReportSortField,
  type FleetReportRecordsStatusFilter,
} from "@/features/reports/fleet-report-utils"
import { ReportPagination } from "@/features/reports/ReportPagination"
import { formatDurationMinutes } from "@/features/reports/report-format"
import {
  buildFleetReportRows,
  downloadReportCsv,
  downloadReportExcel,
  downloadReportPdf,
  downloadElementAsPng,
  FLEET_REPORT_COLUMNS,
  type ReportExportHandle,
} from "@/features/reports/report-export"
import type { ReportsScopeFilters } from "@/features/reports/reports-filters"
import { formatTr } from "@/lib/date"
import { toggleSingleSort } from "@/lib/sort"
import { reportsService } from "@/services"

export const FleetReportTab = forwardRef<ReportExportHandle, { meetings: Meeting[]; visits: Visit[]; filters: ReportsScopeFilters; dateRangeInvalid: boolean; comparisonFilters?: ReportsScopeFilters | null; comparisonLabel?: string; onExportAvailabilityChange?(canExport: boolean): void }>(function FleetReportTab({ meetings, visits, filters, dateRangeInvalid, comparisonFilters = null, comparisonLabel = "Önceki dönem", onExportAvailabilityChange }, ref) {
  const [assignments, setAssignments] = useState<PlannedTransportAssignment[]>([])
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [selectedAssignment, setSelectedAssignment] = useState<PlannedTransportAssignment | null>(null)
  const detailTriggerRef = useRef<HTMLTableRowElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const workspace = useMemo(() => parseFleetReportWorkspace(searchParams), [searchParams])

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    void reportsService.getFleetDataset({})
      .then((next) => { if (!cancelled) { setAssignments(next); setAssignmentsLoaded(true) } })
      .catch((cause: unknown) => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "Araç-şoför raporu alınamadı.") })
    return () => { cancelled = true }
  }, [reloadNonce])

  const reportAssignments = useMemo(() => filterAssignmentsForReport(assignments, filters), [assignments, filters])
  const recordAssignments = useMemo(() => sortFleetReportRecords(searchFleetReportRecords(filterFleetReportRecordsByStatus(reportAssignments, workspace.status), workspace.search, (assignment) => getRelatedRecordLabel(assignment, meetings, visits)), workspace.sort), [meetings, reportAssignments, visits, workspace.search, workspace.sort, workspace.status])
  const metrics = useMemo(() => calculateFleetReportMetrics(reportAssignments), [reportAssignments])
  const currentResources = useMemo(() => aggregateFleetResourceLoad(reportAssignments, workspace.dimension), [reportAssignments, workspace.dimension])
  const previousFilters = comparisonFilters
  const previousAssignments = useMemo(() => previousFilters ? filterAssignmentsForReport(assignments, previousFilters) : null, [assignments, previousFilters])
  const hasComparisonData = previousAssignments !== null && previousAssignments.length > 0
  const previousMetrics = useMemo(() => previousAssignments ? calculateFleetReportMetrics(previousAssignments) : null, [previousAssignments])
  const previousResources = useMemo(() => previousAssignments ? aggregateFleetResourceLoad(previousAssignments, workspace.dimension) : [], [previousAssignments, workspace.dimension])
  const comparisonResources = useMemo(() => mergeFleetLoadComparison(currentResources, previousResources), [currentResources, previousResources])
  const chartResources = useMemo(
    () => hasComparisonData ? getFleetLoadChartResources(comparisonResources) : getFleetLoadChartResources(currentResources),
    [comparisonResources, currentResources, hasComparisonData],
  )
  const totalChartResourceCount = hasComparisonData ? comparisonResources.length : currentResources.length
  const totalDelta = hasComparisonData && previousMetrics ? countDelta(metrics.totalAssignments, previousMetrics.totalAssignments) : null
  const cancelledDelta = hasComparisonData && previousMetrics ? countDelta(metrics.cancelledAssignments, previousMetrics.cancelledAssignments) : null
  const plannedLoadDelta = hasComparisonData && previousMetrics ? durationDelta(metrics.plannedLoadMinutes, previousMetrics.plannedLoadMinutes) : null
  const pageCount = getFleetReportPageCount(recordAssignments.length)
  const page = Math.min(workspace.page, pageCount)
  const paginatedAssignments = useMemo(() => paginateFleetReport(recordAssignments, page), [recordAssignments, page])
  const visibleStart = recordAssignments.length === 0 ? 0 : (page - 1) * FLEET_REPORT_PAGE_SIZE + 1
  const visibleEnd = Math.min(page * FLEET_REPORT_PAGE_SIZE, recordAssignments.length)
  const headers = useMemo(() => FLEET_REPORT_COLUMNS.map((column) => column.header), [])
  const exportFilenameBase = `arac-sofor-raporu_${filters.startDate || "tumu"}_${filters.endDate || "tumu"}`

  const openRecordsForMetric = (status: FleetReportRecordsStatusFilter) => setSearchParams(setFleetReportWorkspace(searchParams, { view: "records", status }))

  useEffect(() => {
    // URL pagination remains valid after a direct URL edit, filter change, or a shrinking result.
    if (workspace.view !== "records" || !assignmentsLoaded) return
    const rawPage = searchParams.get("fleetPage")
    if (page !== workspace.page || (rawPage !== null && rawPage !== String(workspace.page))) {
      setSearchParams(setFleetReportPage(searchParams, page), { replace: true })
    }
  }, [assignmentsLoaded, page, searchParams, setSearchParams, workspace.page, workspace.view])

  useEffect(() => {
    onExportAvailabilityChange?.(!dateRangeInvalid && assignmentsLoaded && (workspace.view === "records" ? recordAssignments.length > 0 : reportAssignments.length > 0))
  }, [assignmentsLoaded, dateRangeInvalid, onExportAvailabilityChange, recordAssignments.length, reportAssignments.length, workspace.view])

  const exportRows = () => buildFleetReportRows(workspace.view === "records" ? recordAssignments : reportAssignments, meetings, visits)

  useImperativeHandle(ref, () => ({
    exportCsv: () => downloadReportCsv(headers, exportRows(), `${exportFilenameBase}.csv`),
    exportExcel: () => { void downloadReportExcel("Araç-Şoför", headers, exportRows(), `${exportFilenameBase}.xlsx`) },
    exportPdf: () => { void downloadReportPdf("Araç / Şoför Raporu", headers, exportRows(), `${exportFilenameBase}.pdf`) },
    exportChartPng: () => { const card = document.getElementById("fleet-analysis-card"); if (card) void downloadElementAsPng(card, `arac-sofor-analizi_${filters.startDate || "tumu"}_${filters.endDate || "tumu"}.png`) },
  }))

  if (loadError) {
    return (
      <section className="flex h-full min-h-0 flex-col items-center justify-center rounded-lg border border-red-200 bg-card p-6 text-center shadow-panel" role="alert">
        <p className="text-sm font-semibold text-slate-900">Araç-şoför raporu yüklenemedi</p>
        <p className="mt-1 text-xs text-slate-600">{loadError}</p>
        <button type="button" className="mt-4 inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-xs font-medium text-white hover:bg-slate-700" onClick={() => setReloadNonce((value) => value + 1)}>Tekrar dene</button>
      </section>
    )
  }
  if (!assignmentsLoaded) {
    return <section className="h-full animate-pulse rounded-lg border bg-slate-100" aria-label="Rapor yükleniyor" role="status" />
  }

  if (workspace.view === "records") {
    return (
      <>
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-panel" aria-label="Araç / şoför kayıtları">

        {dateRangeInvalid ? (
          <EmptyState title="Geçersiz tarih aralığı" description="Başlangıç tarihi bitiş tarihinden sonra olamaz." />
        ) : recordAssignments.length === 0 ? (
          <EmptyState title={workspace.search ? "Eşleşen kayıt bulunamadı" : "Eşleşen araç görevi bulunamadı"} description={workspace.search ? "Arama ifadesini değiştirerek yeniden deneyin." : "Filtre ölçütlerini değiştirerek yeniden deneyin."} showSearch />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full overflow-x-auto overflow-y-hidden scrollbar-thin">
                <table className="h-full w-full min-w-[900px] table-fixed text-left text-xs">
                  <thead className="border-b bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <SortableHeader className="w-[11%]" label="Tarih" field="date" sort={workspace.sort} onChange={(sort) => setSearchParams(setFleetReportWorkspace(searchParams, { sort }))} />
                      <SortableHeader className="w-[22%]" label="Amaç" field="purpose" sort={workspace.sort} onChange={(sort) => setSearchParams(setFleetReportWorkspace(searchParams, { sort }))} />
                      <SortableHeader className="w-[15%]" label="Araç" field="vehicle" sort={workspace.sort} onChange={(sort) => setSearchParams(setFleetReportWorkspace(searchParams, { sort }))} />
                      <SortableHeader className="w-[14%]" label="Şoför" field="driver" sort={workspace.sort} onChange={(sort) => setSearchParams(setFleetReportWorkspace(searchParams, { sort }))} />
                      <SortableHeader className="w-[16%]" label="Planlanan" field="planned" sort={workspace.sort} onChange={(sort) => setSearchParams(setFleetReportWorkspace(searchParams, { sort }))} />
                      <th className="w-[16%] px-3 py-1.5">İlişkili Kayıt</th>
                      <SortableHeader className="w-[10%]" label="Durum" field="status" sort={workspace.sort} onChange={(sort) => setSearchParams(setFleetReportWorkspace(searchParams, { sort }))} />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedAssignments.map((assignment) => <FleetRecordRow key={assignment.id} assignment={assignment} meetings={meetings} visits={visits} onOpen={(row) => { detailTriggerRef.current = row; setSelectedAssignment(assignment) }} />)}
                    {Array.from({ length: Math.max(0, FLEET_REPORT_PAGE_SIZE - paginatedAssignments.length) }).map((_, index) => <FleetReportFillerRow key={`fleet-filler-${index}`} />)}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="shrink-0">
              <ReportPagination page={page} pageCount={pageCount} visibleStart={visibleStart} visibleEnd={visibleEnd} total={recordAssignments.length} visiblePageNumbers={getVisibleFleetReportPageNumbers(page, pageCount)} onPageChange={(nextPage) => setSearchParams(setFleetReportPage(searchParams, nextPage))} ariaLabel="Araç / şoför rapor sayfaları" />
            </div>
          </>
        )}
        </section>
        <FleetAssignmentDetailDialog assignment={selectedAssignment} meetings={meetings} visits={visits} open={selectedAssignment !== null} onOpenChange={(open) => { if (!open) setSelectedAssignment(null) }} returnFocusRef={detailTriggerRef} />
      </>
    )
  }

  return (
    <section id="fleet-analysis-card" className="flex h-full min-h-0 flex-col overflow-hidden bg-card px-3 py-2" aria-label="Araç / şoför analizi">
      {!dateRangeInvalid && (
        <>
          <div className="mt-1 flex shrink-0 items-start gap-x-2 py-0.5 text-left" aria-label="Araç / şoför analiz metrikleri">
            <FleetAnalysisMetric value={String(metrics.totalAssignments)} label="Görev" delta={totalDelta} favorableDirection="increase" onActivate={() => openRecordsForMetric("all")} />
            <FleetAnalysisMetric value={String(metrics.cancelledAssignments)} label="İptal" delta={cancelledDelta} favorableDirection="decrease" onActivate={() => openRecordsForMetric("cancelled")} />
            <FleetAnalysisMetric value={formatDurationMinutes(metrics.plannedLoadMinutes)} label="Planlama yükü" delta={plannedLoadDelta} favorableDirection="increase" />
            <p className="ml-auto shrink-0 text-right text-[10px] leading-normal tabular-nums text-slate-500">{metrics.usedVehicleCount} araç · {metrics.usedDriverCount} şoför</p>
          </div>
        </>
      )}

      <div className="mt-3 min-h-0 flex-1">
        {dateRangeInvalid ? <EmptyState title="Geçersiz tarih aralığı" description="Başlangıç tarihi bitiş tarihinden sonra olamaz." /> : <FleetLoadChart resources={chartResources} dimension={workspace.dimension} comparison={hasComparisonData} comparisonLabel={comparisonLabel} totalResourceCount={totalChartResourceCount} />}
      </div>
    </section>
  )
})

interface FleetMetricDelta {
  difference: number
  label: string
}

function countDelta(current: number, previous: number): FleetMetricDelta {
  const difference = current - previous
  return { difference, label: difference === 0 ? "değişmedi" : `${difference > 0 ? "+" : ""}${difference}` }
}

function durationDelta(current: number, previous: number): FleetMetricDelta {
  const difference = current - previous
  return { difference, label: difference === 0 ? "değişmedi" : `${difference > 0 ? "+" : "-"}${formatDurationMinutes(Math.abs(difference))}` }
}

function FleetAnalysisMetric({ value, label, delta, favorableDirection, onActivate }: { value: string; label: string; delta: FleetMetricDelta | null; favorableDirection: "increase" | "decrease"; onActivate?: () => void }) {
  const tone = delta ? getFleetMetricDeltaTone(delta.difference, favorableDirection) : "neutral"
  const deltaClassName = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : "text-slate-400"
  const content = <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5"><p className="min-w-0 text-base font-semibold leading-none tabular-nums text-slate-900">{value}</p><p className="text-[10px] leading-normal text-slate-500">{label}</p>{delta && <p className={`text-[10px] font-medium leading-normal tabular-nums ${deltaClassName}`}>{delta.label}</p>}</div>
  return onActivate ? <button type="button" className="min-w-0 flex-1 cursor-pointer rounded-sm pl-1.5 text-left transition-colors hover:bg-blue-50 hover:shadow-[inset_3px_0_0_hsl(var(--primary))] focus-visible:bg-blue-50 focus-visible:shadow-[inset_3px_0_0_hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400" aria-label={`${label} kayıtlarını gösterin`} onClick={onActivate}>{content}</button> : <div className="min-w-0 flex-1">{content}</div>
}

function FleetRecordRow({ assignment, meetings, visits, onOpen }: { assignment: PlannedTransportAssignment; meetings: Meeting[]; visits: Visit[]; onOpen(row: HTMLTableRowElement): void }) {
  const relatedLabel = getRelatedRecordLabel(assignment, meetings, visits)
  const openDetails = (row: HTMLTableRowElement) => onOpen(row)
  return (
    <tr
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`${assignment.purpose} görev detayını aç`}
      className="record-row-hover h-[3.375rem] cursor-pointer border-b last:border-b-0 transition-colors hover:bg-slate-50/80 focus-visible:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
      onClick={(event) => openDetails(event.currentTarget)}
      onKeyDown={(event) => {
        if (!isFleetRecordActivationKey(event.key)) return
        event.preventDefault()
        openDetails(event.currentTarget)
      }}
    >
      <td className="px-3 py-1 tabular-nums">{formatTr(new Date(assignment.plannedStart), "d MMM yyyy")}</td>
      <td className="px-3 py-1"><p className="truncate" title={assignment.purpose}>{assignment.purpose}</p></td>
      <td className="px-3 py-1"><p className="truncate font-medium text-slate-900" title={assignment.vehicleName}>{assignment.vehicleName}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{assignment.vehicleLicensePlate}</p></td>
      <td className="px-3 py-1"><p className="truncate" title={assignment.driverName}>{assignment.driverName}</p></td>
      <td className="px-3 py-1 tabular-nums">{formatTr(new Date(assignment.plannedStart), "HH:mm")}–{formatTr(new Date(assignment.plannedEnd), "HH:mm")}</td>
      <td className="px-3 py-1"><p className="truncate" title={relatedLabel}>{relatedLabel}</p></td>
      <td className="px-3 py-1"><FleetStatusPill status={assignment.status} /></td>
    </tr>
  )
}

function FleetStatusPill({ status }: { status: PlannedTransportAssignment["status"] }) {
  const planned = status === "ACTIVE"
  return <span className={planned ? "inline-flex rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700" : "inline-flex rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"}>{planned ? "Planlandı" : "İptal"}</span>
}

function FleetReportFillerRow() {
  return <tr aria-hidden="true" className="pointer-events-none h-[3.375rem] select-none border-b border-transparent last:border-b-0"><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /><td className="px-3 py-1" /></tr>
}

function EmptyState({ title, description, showSearch = false }: { title: string; description: string; showSearch?: boolean }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">{showSearch && <Search className="size-6 text-slate-400" />}<p className={`${showSearch ? "mt-2" : ""} text-xs font-semibold text-slate-900`}>{title}</p><p className="mt-0.5 text-[11px] text-slate-600">{description}</p></div>
}

function SortableHeader({ className, label, field, sort, onChange }: { className: string; label: string; field: FleetReportSortField; sort: import("@/lib/sort").SingleSortState<FleetReportSortField>; onChange(sort: import("@/lib/sort").SingleSortState<FleetReportSortField>): void }) {
  const active = sort?.field === field
  const Icon = sort?.direction === "asc" ? ArrowUp : ArrowDown
  return <th className={`${className} px-3 py-1.5`} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className="inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-300" aria-label={active ? `${label} sütunu sıralamasını kaldır` : `${label} sütununu artan sırala`} onClick={() => onChange(toggleSingleSort(sort, field))}>{label}{active && <Icon className="size-3" aria-hidden="true" />}</button></th>
}
