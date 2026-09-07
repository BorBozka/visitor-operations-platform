import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const tabSource = readFileSync(resolve(process.cwd(), "src/features/reports/VisitsReportTab.tsx"), "utf8")
const pageSource = readFileSync(resolve(process.cwd(), "src/features/reports/ReportsPage.tsx"), "utf8")
const chartSource = readFileSync(resolve(process.cwd(), "src/features/reports/VisitsTrendChart.tsx"), "utf8")
const reportUtilsSource = readFileSync(resolve(process.cwd(), "src/features/reports/visits-report-utils.ts"), "utf8")
const upcomingSource = readFileSync(resolve(process.cwd(), "src/features/visits/UpcomingVisits.tsx"), "utf8")
const allVisitsSource = readFileSync(resolve(process.cwd(), "src/features/manager/AllVisitsPage.tsx"), "utf8")
const goodsSource = readFileSync(resolve(process.cwd(), "src/features/goods/GoodsMovementsPage.tsx"), "utf8")
const fillViewportSource = readFileSync(resolve(process.cwd(), "src/lib/use-fill-viewport-height.ts"), "utf8")

describe("Visits report UI contracts", () => {
  it("uses the same selected granularity for current and previous comparison periods", () => {
    expect(tabSource).toContain("calculateVisitsReportTrendWithStatus(reportVisits, filters, trendGranularity)")
    expect(tabSource).toContain("calculateVisitsReportTrendWithStatus(previousReportVisits, previousFilters, trendGranularity)")
  })

  it("keeps workspace and records page in URL-backed report state", () => {
    expect(pageSource).toContain("workspaceMode={queryState.view}")
    expect(pageSource).toContain("recordsPage={queryState.page}")
    expect(pageSource).toContain("onRecordsPageChange={(page) => setSearchParams(setReportsPage(searchParams, page))}")
    expect(pageSource).toContain("setReportsView(searchParams, value)")
    expect(pageSource).toContain("onClick={() => onChange(targetMode)}")
    expect(pageSource).toContain('recordsMode ? "Analize dön" : "Kayıtlar"')
    expect(tabSource).not.toContain("useState(1)")
  })

  it("uses a fixed nine-row records page without dynamic viewport sizing", () => {
    expect(reportUtilsSource).toContain("VISITS_REPORT_PAGE_SIZE = 8")
    expect(tabSource).not.toContain("ResizeObserver")
    expect(tabSource).not.toContain("RECORD_ROW_HEIGHT_PX")
    expect(tabSource).not.toContain("recordsPageSize")
    expect(tabSource).toContain("normalizedRecordsPage")
    expect(tabSource).toContain('className="h-full w-full min-w-[980px] table-fixed text-left text-xs"')
    expect(tabSource).toContain("VisitsReportFillerRow")
    expect(tabSource).toContain("border-transparent")
  })

  it("starts the records card directly with the table header and avoids a duplicate divider above pagination", () => {
    const tableHeaderIndex = tabSource.indexOf("<thead")
    const tableHeaderEndIndex = tabSource.indexOf("</thead>")
    expect(tabSource).not.toContain('className="flex h-8 shrink-0 items-center justify-end border-b px-2"')
    expect(tabSource.slice(tableHeaderIndex, tableHeaderEndIndex)).not.toContain("Analize dön")
    expect(tabSource).toContain('className="record-row-hover h-[3.375rem] cursor-pointer border-b last:border-b-0 transition-colors hover:bg-slate-50')
    expect(tabSource).toContain("last:border-b-0")
    expect(tabSource).toContain("ziyaret detaylarını görüntüle")
    expect(tabSource).toContain("<VisitDetailsDialog")
  })

  it("shows comparison in both analysis workspaces and granularity only for visit analysis", () => {
    expect(pageSource).toContain('queryState.tab === "visits"')
    expect(pageSource).toContain('queryState.tab === "vehicle" && fleetWorkspace.view === "analysis"')
    expect(pageSource).toContain('queryState.view === "analysis" && !isTodayRange')
    expect(pageSource).toContain("<ComparisonFilter value={queryState.comparison}")
    expect(pageSource).toContain("<GranularitySelect value={queryState.granularity}")
    expect(pageSource).toContain("<ReportWorkspaceSwitch mode={queryState.view}")
    expect(tabSource).not.toContain("GranularitySelect")
    expect(tabSource).not.toContain("WorkspaceNavigationAction")
  })

  it("renders five compact analysis metrics above the chart without an insight sentence", () => {
    const metricsIndex = tabSource.indexOf('aria-label="Ziyaret analiz metrikleri"')
    const chartIndex = tabSource.indexOf('className="mt-3 min-h-0 flex-1"')
    expect(tabSource).toContain('className="mt-1 flex shrink-0 items-start gap-x-1 py-0.5 text-left sm:gap-x-2"')
    expect(tabSource.match(/<AnalysisMetric/g)).toHaveLength(5)
    expect(metricsIndex).toBeGreaterThan(-1)
    expect(chartIndex).toBeGreaterThan(metricsIndex)
    expect(tabSource).not.toContain("summaryText")
    expect(tabSource).not.toContain("MetadataMetric")
  })

  it("keeps each metric's value, label and delta together while allowing narrow layouts to reflow", () => {
    expect(tabSource).toContain('min-w-0 flex-1 cursor-pointer rounded-sm pl-1.5 text-left')
    expect(tabSource).toContain('<p className="text-[10px] leading-normal text-slate-500">{label}</p>{delta &&')
    expect(tabSource).not.toContain('mt-1.5 truncate text-[10px] leading-normal text-slate-500')
  })

  it("draws a single total line and leads the tooltip with the day total, hiding zero-value statuses and status colour dots", () => {
    expect(chartSource).toContain('<Line yAxisId="total" type="linear" dataKey="TREND"')
    expect(chartSource).not.toContain("<Area")
    expect(chartSource).not.toContain("<Bar ")
    // The breakdown lists only outcomes that actually occurred that day.
    expect(chartSource).toContain("STATUS_DETAIL_ORDER.filter((status) => point[status] > 0)")
    expect(chartSource).toContain("visibleStatuses.map")
    expect(chartSource).toContain("point[status]")
    // Date + total sit above the breakdown as the most prominent line.
    expect(chartSource).toContain("Toplam {point.TOTAL} ziyaret")
    expect(chartSource).toContain("Bugün devam ediyor.")
    // The chart is one blue line, so the tooltip carries no per-status colour dot that points
    // at an encoding that is not on screen.
    expect(chartSource).not.toContain("VISITS_REPORT_STATUS_COLORS")
    expect(chartSource).not.toContain('aria-label="Ziyaret durumları"')
  })

  it("scales the trend axis from the completed buckets only, never from the running day", () => {
    expect(chartSource).toContain("buildVisitsTrendSeries(points, todayDate)")
    expect(chartSource).toContain("calculateVisitsTrendAxes(series)")
    expect(chartSource).toContain("withVisitsTrendOngoingSegment(series, chartAxes.total.max)")
    expect(chartSource).toContain("domain={[0, chartAxes.total.max]}")
    expect(chartSource).not.toContain("calculateVisitsTrendYAxis(ownRawMax)")
    expect(chartSource).not.toContain("Math.max(max, point.TOTAL)")
    expect(chartSource).not.toContain("domain={[0, 40]}")
    expect(reportUtilsSource).toContain("completedMax: scaleSource.reduce")
  })

  it("draws the running day as a clamped dashed end segment with a marked tip", () => {
    expect(chartSource).toContain('<Line yAxisId="total" type="linear" dataKey="ONGOING"')
    expect(chartSource).toContain("strokeDasharray={ONGOING_DASH}")
    expect(chartSource).toContain("connectNulls={false}")
    expect(chartSource).toContain("<TodayMarkerDot")
    expect(chartSource).toContain("payload?.isOngoing")
    expect(reportUtilsSource).toContain("ONGOING: Math.min(point.TOTAL, axisMax)")
  })

  it("carries no half-present issue series, right axis or legend entry without a drawn counterpart", () => {
    expect(chartSource).not.toContain('yAxisId="issue"')
    expect(chartSource).not.toContain('orientation="right"')
    expect(chartSource).not.toContain("<Area")
    expect(chartSource).not.toContain("Gerçekleşmedi + İptal")
    expect(chartSource).not.toContain('label={{ value:')
    // The issue-band scale plumbing is gone from the utils too.
    expect(reportUtilsSource).not.toContain("calculateVisitsTrendIssueAxis")
    expect(reportUtilsSource).not.toContain("VisitsTrendIssueAxis")
    expect(reportUtilsSource).not.toContain("issueMax")
    expect(reportUtilsSource).not.toContain("ISSUE:")
    expect(reportUtilsSource).not.toContain("issue: VisitsTrendYAxis")
  })

  it("connects the daily values with straight segments instead of a spline", () => {
    expect(chartSource).not.toContain('type="monotone"')
    expect(chartSource.match(/type="linear"/g)).toHaveLength(2)
    expect(chartSource).toContain('<Line yAxisId="total" type="linear" dataKey="TREND"')
  })
  it("marks today only on the current-period chart and explains it in the tooltip", () => {
    expect(tabSource).toContain("<ComparisonTrendPanel primary points={dailyTrendGrouped} todayDate={todayDate} axes={sharedTrendAxes} />")
    expect(tabSource).toContain("points={previousDailyTrendGrouped} axes={sharedTrendAxes} />")
    expect(tabSource).not.toContain("points={previousDailyTrendGrouped} todayDate")
    expect(chartSource).toContain("<TodayMarkerDot")
    expect(chartSource).toContain("Bugün devam ediyor.")
  })

  it("shares one axis pair between the two comparison charts", () => {
    expect(tabSource).toContain("const sharedTrendAxes = useMemo<VisitsTrendAxes | undefined>(")
    expect(tabSource).toContain("calculateVisitsTrendAxes(buildVisitsTrendSeries(dailyTrendGrouped, todayDate), buildVisitsTrendSeries(previousDailyTrendGrouped))")
    expect(tabSource.match(/axes=\{sharedTrendAxes\}/g)).toHaveLength(2)
    expect(chartSource).toContain("const chartAxes = axes ?? calculateVisitsTrendAxes(series)")
    expect(tabSource).not.toContain("sharedYAxisMax")
    expect(tabSource).not.toContain("yAxisMax=")
  })

  it("measures the viewport-filling panel when the element attaches, not only when a dependency changes", () => {
    expect(fillViewportSource).toContain("const [element, setElement] = useState<T | null>(null)")
    expect(fillViewportSource).toContain("setElement((current) => (current === node ? current : node))")
    expect(fillViewportSource).toContain("if (!element) return")
    expect(fillViewportSource).toContain("}, [element, bottomGutterPx, ...deps])")
    expect(fillViewportSource).not.toContain("const element = ref.current")
    expect(pageSource).toContain("style={workspacePanelHeight !== undefined ? { height: workspacePanelHeight } : undefined}")
  })

  it("keeps the analysis metric label beside the value without horizontal dead space", () => {
    expect(tabSource).toContain('className="mt-1 flex shrink-0 items-start gap-x-1 py-0.5 text-left sm:gap-x-2"')
    expect(tabSource).toContain('<p className="text-[10px] leading-normal text-slate-500">{label}</p>{delta &&')
    expect(tabSource).toContain("text-[10px] font-medium leading-normal tabular-nums")
    expect(tabSource).toContain('flex min-w-0 flex-wrap items-baseline')
    expect(tabSource).not.toContain("text-[10px] leading-none text-slate-500")
    expect(tabSource).toContain('label="Gerçekleşen"')
    expect(tabSource).toContain('label="Geç giriş"')
    expect(tabSource).toContain('label="Geç çıkış"')
    expect(tabSource).toContain('label="Ort. süre"')
    expect(tabSource).toContain('label="Ziyaret"')
  })

  it("shows no native browser tooltip on the metric strip numbers or labels", () => {
    // The value and its label are already on screen; a title= repeat only adds a hover tooltip.
    expect(tabSource).not.toContain("title={value}")
    expect(tabSource).not.toContain("title={label}")
  })

  it("merges the filter bar and the visits analysis surface into one titleless card", () => {
    expect(pageSource).toContain('const analysisMerged = queryState.tab === "visits" && queryState.view === "analysis"')
    expect(pageSource).toContain('{!analysisMerged && <div className="flex items-center justify-between pb-1">')
    expect(pageSource).toContain('analysisMerged && "!mt-0 rounded-b-lg border border-t-0 bg-card shadow-panel"')
    // The analysis surface no longer carries its own card frame, padding or heading.
    expect(tabSource).not.toContain("Ziyaret Analizi")
    expect(tabSource).not.toContain('visits-analysis-title')
    expect(tabSource).toContain('className="flex h-full min-h-0 flex-col overflow-hidden bg-card px-3 py-2" aria-label="Ziyaret analizi"')
  })

  it("drops the horizontal rule between the filter bar and the metric strip so the merged card reads as one piece", () => {
    // The filter section loses its bottom border in the merged view; the panel below already
    // has border-t-0, so no hairline is drawn between the filter controls and the metrics.
    expect(pageSource).toContain('analysisMerged ? "rounded-t-lg border-b-0" : "rounded-lg"')
    // The filter bar spreads across the card instead of one control eating all the slack.
    expect(pageSource).not.toContain('cn("min-w-[12rem] flex-1"')
  })

  it("makes record-backed metrics keyboard-accessible without turning average duration into a control", () => {
    expect(tabSource).toContain('onActivate={() => onMetricNavigate("all")}')
    expect(tabSource).toContain('onActivate={() => onMetricNavigate("completed")}')
    expect(tabSource).toContain('onActivate={() => onMetricNavigate("late-arrival")}')
    expect(tabSource).toContain('onActivate={() => onMetricNavigate("late-departure")}')
    expect(tabSource).toContain('aria-label={`${label} kayıtlarını gösterin`}')
    expect(tabSource).toContain('hover:bg-blue-50 hover:shadow-[inset_3px_0_0_hsl(var(--primary))]')
    expect(tabSource).toContain('focus-visible:bg-blue-50 focus-visible:shadow-[inset_3px_0_0_hsl(var(--primary))]')
    expect(tabSource).toContain('focus-visible:outline-none focus-visible:ring-1')
    expect(tabSource).toContain(': <div className="min-w-0 flex-1">{content}</div>')
    expect(tabSource).toContain('<AnalysisMetric value={formatDurationMinutes(kpis.averageDurationMinutes)} label="Ort. süre" delta={comparisonEnabled ? averageDurationDelta : null} favorableDirection="decrease" />')
  })

  it("keeps the status narrowing inside the records-only filter pipeline", () => {
    expect(tabSource).toContain('searchVisitsReportRecords(filterVisitsReportRecordsByStatus(reportVisits, recordsStatus), recordsSearch)')
    expect(pageSource).toContain('<VisitsRecordsStatusFilter value={queryState.recordsStatus}')
    expect(pageSource).toContain('onMetricNavigate={openVisitsRecordsForMetric}')
  })

  it("keeps late-departure increases adverse without a derived insight", () => {
    expect(tabSource).toContain('label="Geç çıkış" delta={comparisonEnabled ? lateDepartureDelta : null} favorableDirection="decrease"')
    expect(tabSource).toContain('const lateDepartureDelta = previousKpis ? countDelta(kpis.lateDepartures, previousKpis.lateDepartures) : null')
    expect(tabSource).not.toContain("buildVisitsReportSummarySentences")
    expect(reportUtilsSource).not.toContain("buildVisitsReportSummarySentences")
  })

  it("gives the current-period comparison chart twice the height without changing either chart's shared axis", () => {
    expect(tabSource).toContain('basis-0 flex-col ${primary ? "flex-[2]" : "flex-1"}')
    expect(tabSource).toContain("axes={sharedTrendAxes}")
  })

  it("keeps the chart gap directly after the metric strip", () => {
    const metricsIndex = tabSource.indexOf('aria-label="Ziyaret analiz metrikleri"')
    const chartWrapIndex = tabSource.indexOf('className="mt-3 min-h-0 flex-1"')
    expect(chartWrapIndex).toBeGreaterThan(metricsIndex)
    expect(tabSource).not.toContain('className="mt-1.5 min-h-0 flex-1"')
  })

  it("adds partial weekly context only inside the shared tooltip", () => {
    expect(chartSource).toContain("getVisitsTrendTooltipPeriodContext(point)")
    expect(chartSource).toContain("periodContext")
    expect(reportUtilsSource).toContain("periodDayCount >= 7")
  })

  it("removes duplicate date and record-count headings from both workspaces", () => {
    expect(tabSource).not.toContain('<p className="mt-0.5 text-[11px] text-slate-500">{formatRangeLabel(filters)}</p>')
    expect(tabSource).not.toContain("· {reportVisits.length} kayıt")
    expect(tabSource).not.toContain("Kayıtları gör")
    expect(tabSource).not.toContain("Analize dön")
  })

  it("uses Gerçekleşmedi consistently and removes Gelişmedi from report presentation", () => {
    expect(reportUtilsSource).toContain('NO_SHOW: "Gerçekleşmedi"')
    expect(`${tabSource}${chartSource}${reportUtilsSource}`).not.toContain("Gelişmedi")
  })

  it("keeps a separator beneath every upcoming visit row, including the last one", () => {
    expect(upcomingSource).toContain('className="relative isolate min-h-0 flex-1 overflow-y-auto scrollbar-thin"')
    expect(upcomingSource).toContain('className="group block w-full border-b border-slate-200')
  })

  it("does not render unfinished saved-report and create-report controls", () => {
    expect(pageSource).not.toContain("Kaydedilmiş Raporlar")
    expect(pageSource).not.toContain("Rapor Oluştur")
  })

  it("uses the concise search placeholders without changing the established filters", () => {
    expect(allVisitsSource).toContain('placeholder="Ziyaretçi veya şirket ara"')
    expect(goodsSource).toContain('placeholder="Mal veya karşı firma ara"')
  })

  it("keeps the report toolbar's action group at the right and preserves an empty second line slot", () => {
    expect(pageSource).toContain('className={cn("ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2", recordsMode && "lg:flex-nowrap")}')
    expect(pageSource).toContain("Rapor filtreleri")
    expect(pageSource).toContain('className={cn("h-5 shrink-0 gap-1 border-none px-1')
    expect(pageSource).toContain('!hasActiveReportFilters && "invisible"')
    expect(pageSource).toContain("resetReportsFilters(searchParams)")
    expect(pageSource).toContain("useFillViewportHeight(14")
    expect(tabSource).toContain('className="block h-3" />')
    expect(tabSource).not.toContain("&nbsp;")
  })
})
