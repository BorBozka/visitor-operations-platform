import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts"

import {
  buildGoodsMovementTrendSeries,
  calculateGoodsTrendAxes,
  withGoodsMovementTrendOngoingSegment,
  type GoodsMovementTrendChartPoint,
  type GoodsMovementTrendPoint,
  type GoodsTrendAxes,
} from "@/features/reports/goods-report-utils"
import { ReportChartContainer } from "@/features/reports/ReportChartContainer"

const TOTAL_COLOR = "#2563eb"
const ONGOING_DASH = "5 3"

export function GoodsMovementTrendLegend() {
  return <ul className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5 whitespace-nowrap text-[11px] font-medium text-slate-600" aria-label="Mal hareketi trend serileri"><li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: TOTAL_COLOR }} aria-hidden="true" />Toplam hareket</li><li className="flex items-center gap-1.5"><svg className="h-0.5 w-4" viewBox="0 0 16 2" aria-hidden="true"><line x1="0" y1="1" x2="16" y2="1" stroke={TOTAL_COLOR} strokeWidth="2" strokeDasharray={ONGOING_DASH} /></svg>Bugün (devam ediyor)</li></ul>
}

export function GoodsMovementTrendChart({ points, todayDate, axes, maxXAxisTicks = 10 }: { points: GoodsMovementTrendPoint[]; todayDate?: string; axes?: GoodsTrendAxes; maxXAxisTicks?: number }) {
  if (points.length === 0) return <div className="flex h-full items-center justify-center text-xs text-slate-400">Zaman grafiği için planlanan saat bilgisi bulunmuyor</div>
  const interval = points.length > maxXAxisTicks ? Math.ceil(points.length / maxXAxisTicks) - 1 : 0
  const series = buildGoodsMovementTrendSeries(points, todayDate)
  const chartAxes = axes ?? calculateGoodsTrendAxes(series)
  const chartPoints = withGoodsMovementTrendOngoingSegment(series, chartAxes.total.max)
  return <div className="report-chart h-full cursor-default [contain:paint]" aria-label="Mal hareketi trend grafiği" onPointerDown={(event) => event.preventDefault()}><ReportChartContainer>{({ width, height }) => <LineChart width={width} height={height} accessibilityLayer={false} tabIndex={-1} data={chartPoints} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10 }} interval={interval} tickLine={false} axisLine={false} /><YAxis yAxisId="total" width={34} tick={{ fontSize: 10 }} allowDecimals={false} tickLine={false} axisLine={false} domain={[0, chartAxes.total.max]} ticks={chartAxes.total.ticks} /><Tooltip cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }} content={<GoodsMovementTrendTooltip />} /><Line yAxisId="total" type="linear" dataKey="TREND" stroke={TOTAL_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#ffffff", stroke: TOTAL_COLOR, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} /><Line yAxisId="total" type="linear" dataKey="ONGOING" stroke={TOTAL_COLOR} strokeWidth={2} strokeDasharray={ONGOING_DASH} dot={(dotProps) => <TodayMarkerDot {...dotProps} />} activeDot={false} connectNulls={false} isAnimationActive={false} /></LineChart>}</ReportChartContainer></div>
}

function GoodsMovementTrendTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  const point = payload?.[0]?.payload as GoodsMovementTrendChartPoint | undefined
  if (!active || !point) return null
  const visibleDirections = (["INBOUND", "OUTBOUND"] as const).filter((direction) => point[direction] > 0)
  return <div className="min-w-40 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[11px] shadow-md"><p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{String(label).replace("–", " – ")}</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">Toplam {point.TOTAL} hareket</p>{point.isToday && <p className="mt-0.5 text-slate-500">Bugün devam ediyor.</p>}{visibleDirections.length > 0 && <ul className="mt-1.5 space-y-0.5 border-t border-slate-100 pt-1.5">{visibleDirections.map((direction) => <li key={direction} className="flex items-center justify-between gap-4"><span className="text-slate-500">{direction === "INBOUND" ? "Gelen" : "Giden"}</span><span className="font-medium tabular-nums text-slate-700">{point[direction]}</span></li>)}</ul>}</div>
}

function TodayMarkerDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: GoodsMovementTrendChartPoint }) {
  if (!payload?.isOngoing || cx === undefined || cy === undefined) return <g />
  return <circle cx={cx} cy={cy} r={4} fill="#ffffff" stroke={TOTAL_COLOR} strokeWidth={2} aria-hidden="true" />
}
