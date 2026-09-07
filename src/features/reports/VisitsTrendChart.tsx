import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts"

import {
  buildVisitsTrendSeries,
  calculateVisitsTrendAxes,
  getVisitsTrendTooltipPeriodContext,
  withVisitsTrendOngoingSegment,
  VISITS_REPORT_STATUS_LABELS,
  type VisitsReportDailyTrendGroupedPoint,
  type VisitsTrendAxes,
  type VisitsTrendChartPoint,
} from "@/features/reports/visits-report-utils"
import { ReportChartContainer } from "@/features/reports/ReportChartContainer"

const DEFAULT_MAX_X_AXIS_TICKS = 10
const STATUS_DETAIL_ORDER = ["PLANNED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const
const TOTAL_COLOR = "#2563eb"
const ONGOING_DASH = "5 3"

export function VisitsTrendLegend() {
  return (
    <ul className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5 whitespace-nowrap text-[11px] font-medium text-slate-600" aria-label="Ziyaret trend serileri">
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: TOTAL_COLOR }} aria-hidden="true" />
        Toplam ziyaret
      </li>
      <li className="flex items-center gap-1.5">
        <svg className="h-0.5 w-4" viewBox="0 0 16 2" aria-hidden="true"><line x1="0" y1="1" x2="16" y2="1" stroke={TOTAL_COLOR} strokeWidth="2" strokeDasharray={ONGOING_DASH} /></svg>
        Bugün (devam ediyor)
      </li>
    </ul>
  )
}

// One scale: the total line owns the left axis, derived from the completed buckets only so an
// unfinished trailing day never inflates it.
export function VisitsTrendChart({ points, todayDate, axes, maxXAxisTicks = DEFAULT_MAX_X_AXIS_TICKS }: {
  points: VisitsReportDailyTrendGroupedPoint[]
  todayDate?: string
  axes?: VisitsTrendAxes
  maxXAxisTicks?: number
}) {
  if (points.length === 0) {
    return <div className="flex h-full items-center justify-center text-xs text-slate-400">Veri yok</div>
  }

  const tickInterval = points.length > maxXAxisTicks ? Math.ceil(points.length / maxXAxisTicks) - 1 : 0
  const series = buildVisitsTrendSeries(points, todayDate)
  const chartAxes = axes ?? calculateVisitsTrendAxes(series)
  const chartPoints = withVisitsTrendOngoingSegment(series, chartAxes.total.max)

  return (
    <div className="report-chart h-full cursor-default [contain:paint]" aria-label="Ziyaret trend grafiği" onPointerDown={(event) => event.preventDefault()}>
      <ReportChartContainer>
        {({ width, height }) => <LineChart width={width} height={height} accessibilityLayer={false} tabIndex={-1} data={chartPoints} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={tickInterval} tickLine={false} axisLine={false} />
          <YAxis yAxisId="total" width={34} tick={{ fontSize: 10 }} allowDecimals={false} tickLine={false} axisLine={false} domain={[0, chartAxes.total.max]} ticks={chartAxes.total.ticks} />
          <Tooltip cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }} content={<VisitsTrendTooltip />} />
          <Line yAxisId="total" type="linear" dataKey="TREND" stroke={TOTAL_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#ffffff", stroke: TOTAL_COLOR, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="total" type="linear" dataKey="ONGOING" stroke={TOTAL_COLOR} strokeWidth={2} strokeDasharray={ONGOING_DASH} dot={(dotProps) => <TodayMarkerDot {...dotProps} />} activeDot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>}
      </ReportChartContainer>
    </div>
  )
}

function VisitsTrendTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  const point = payload?.[0]?.payload as VisitsTrendChartPoint | undefined
  if (!active || !point) return null

  const periodContext = getVisitsTrendTooltipPeriodContext(point)
  const dateLabel = String(label).replace("–", " – ")
  // Zero-value outcomes are dropped entirely: the breakdown only names what actually happened
  // that day, so "Planlandı: 0" style noise from the old stacked-bar tooltip is gone. The
  // status names carry the meaning on their own — the chart draws a single line, so a coloured
  // dot next to each row would point at an encoding that isn't on screen.
  const visibleStatuses = STATUS_DETAIL_ORDER.filter((status) => point[status] > 0)
  return (
    <div className="min-w-40 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[11px] shadow-md">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{periodContext ? `${dateLabel} · ${periodContext}` : dateLabel}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">Toplam {point.TOTAL} ziyaret</p>
      {point.isToday && <p className="mt-0.5 text-slate-500">Bugün devam ediyor.</p>}
      {visibleStatuses.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-slate-100 pt-1.5">
          {visibleStatuses.map((status) => (
            <li key={status} className="flex items-center justify-between gap-4">
              <span className="text-slate-500">{VISITS_REPORT_STATUS_LABELS[status]}</span>
              <span className="font-medium tabular-nums text-slate-700">{point[status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TodayMarkerDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: VisitsTrendChartPoint }) {
  if (!payload?.isOngoing || cx === undefined || cy === undefined) return <g />
  return <circle cx={cx} cy={cy} r={4} fill="#ffffff" stroke={TOTAL_COLOR} strokeWidth={2} aria-hidden="true" />
}
