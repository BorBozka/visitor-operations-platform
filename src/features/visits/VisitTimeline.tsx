import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { CalendarPlus, ChevronLeft, ChevronRight, Info, Package } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { visitStatusLabels, type Visit } from "@/domain/visits"
import type { GoodsMovement } from "@/domain/goods-movements"
import { getDayVisitContentLineCount, getDayVisitMinimumHeight, getDayVisitPlacement, getTimelineOffset, getTimelineRange, getTimelineVisitEndMinutes, getTimelineVisitStartMinutes, type TimelineRange } from "@/features/visits/timeline-range"
import { getMonthVisibleVisitCount } from "@/features/visits/month-visit-capacity"
import { getTimelineTooltipPosition, type TimelineTooltipPosition } from "@/features/visits/timeline-tooltip"
import { getNonCancelledUpcomingVisits } from "@/features/visits/upcoming-visits"
import { defaultWeekDensity, layoutWeekLanes, resolveWeekDensity, weekRowHeight } from "@/features/visits/week-density"
import { visitStatusAccents, visitStatusBorderStyle, visitStatusSurfaces, visitStatusTextDecoration } from "@/features/visits/visit-status-styles"
import { formatIstanbulWallClockTime, formatTr, getIsoWallClockMinutes } from "@/lib/date"
import { cn } from "@/lib/utils"

export type TimelineView = "day" | "week" | "month"

interface Props {
  visits: Visit[]
  plannedGoodsDeliveries?: GoodsMovement[]
  view: TimelineView
  selectedDate: Date
  onViewChange(view: TimelineView): void
  onSelectedDateChange(date: Date): void
  onVisitOpen(visit: Visit): void
  onNewRecord(): void
  /** Compress month rows so the whole month fits without vertical scrolling. */
  fitMonthToHeight?: boolean
}

const viewLabels: Record<TimelineView, string> = {
  day: "Gün",
  week: "Hafta",
  month: "Ay",
}

export function VisitTimeline({ visits, plannedGoodsDeliveries = [], view, selectedDate, onViewChange, onSelectedDateChange, onVisitOpen, onNewRecord, fitMonthToHeight = false }: Props) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const visibleVisits = visits.filter((visit) => {
    const date = new Date(visit.plannedStart)
    if (view === "day") return isSameDay(date, selectedDate)
    if (view === "week") {
      return isWithinInterval(date, {
        start: startOfWeek(selectedDate, { weekStartsOn: 1 }),
        end: endOfWeek(selectedDate, { weekStartsOn: 1 }),
      })
    }
    return isSameMonth(date, selectedDate)
  })
  const countedVisits = getNonCancelledUpcomingVisits(visibleVisits)
  const visibleDeliveries = plannedGoodsDeliveries.filter((delivery) => {
    const date = new Date(`${delivery.plannedDate}T12:00:00`)
    if (view === "day") return isSameDay(date, selectedDate)
    if (view === "week") return isWithinInterval(date, { start: startOfWeek(selectedDate, { weekStartsOn: 1 }), end: endOfWeek(selectedDate, { weekStartsOn: 1 }) })
    return isSameMonth(date, selectedDate)
  })

  const move = (direction: -1 | 1) => {
    const amount = direction
    onSelectedDateChange(
      view === "day" ? addDays(selectedDate, amount) : view === "week" ? addWeeks(selectedDate, amount) : addMonths(selectedDate, amount),
    )
  }

  const title =
    view === "day"
      ? formatTr(selectedDate, "d MMMM yyyy EEEE")
      : view === "week"
        ? `${formatTr(startOfWeek(selectedDate, { weekStartsOn: 1 }), "d MMM")} – ${formatTr(endOfWeek(selectedDate, { weekStartsOn: 1 }), "d MMM yyyy")}`
        : formatTr(selectedDate, "MMMM yyyy")

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-panel xl:min-h-0" aria-label="Ziyaret Takvimi">
      <div className="shrink-0 flex flex-col gap-1.5 border-b px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Ziyaret Takvimi</h2>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{title}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {countedVisits.length} ziyaret
          </span>
          {visibleDeliveries.length > 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{visibleDeliveries.length} mal</span>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={onNewRecord}><CalendarPlus />Yeni kayıt</Button>
          <div className="inline-flex rounded-md border bg-slate-50 p-0.5" aria-label="Takvim görünümü">
            {(["day", "week", "month"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onViewChange(item)}
                className={cn(
                  "h-[26px] rounded px-2.5 text-xs font-medium transition-colors",
                  view === item ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900",
                )}
                aria-pressed={view === item}
              >
                {viewLabels[item]}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => onSelectedDateChange(new Date())}>Bugün</Button>
          <div className="flex">
            <Button variant="outline" size="icon-sm" className="rounded-r-none" onClick={() => move(-1)} aria-label={`Önceki ${viewLabels[view].toLocaleLowerCase("tr-TR")}`}><ChevronLeft /></Button>
            <Button variant="outline" size="icon-sm" className="-ml-px rounded-l-none" onClick={() => move(1)} aria-label={`Sonraki ${viewLabels[view].toLocaleLowerCase("tr-TR")}`}><ChevronRight /></Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Durum göstergeleri" title="Durum göstergeleri">
                <Info className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 p-2">
              <p className="px-1.5 py-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Durum Göstergeleri</p>
              <div className="flex flex-col gap-1.5 p-1">
                {(["PLANNED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"] as const).map((status) => (
                  <div key={status} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "block w-12 shrink-0 rounded border border-l-[3px] px-1 py-px text-[9px] font-semibold leading-[13px] shadow-sm",
                        visitStatusSurfaces[status],
                        visitStatusAccents[status],
                        visitStatusBorderStyle[status],
                      )}
                    >
                      <span className={cn("block truncate", visitStatusTextDecoration[status])}>Ziyaret</span>
                    </span>
                    <span className="text-xs text-slate-600">{visitStatusLabels[status]}</span>
                  </div>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {view !== "month" && <GoodsDeliveryStrip deliveries={visibleDeliveries} showDate={view === "week"} />}
      {view === "month" ? (
        <MonthTimeline visits={visits} deliveries={plannedGoodsDeliveries} selectedDate={selectedDate} onVisitOpen={onVisitOpen} fitToHeight={fitMonthToHeight} />
      ) : (
        <LaneTimeline
          fitToHeight={fitMonthToHeight}
          visits={visibleVisits}
          selectedDate={selectedDate}
          view={view}
          now={now}
          timeRange={getTimelineRange(visibleVisits)}
          onVisitOpen={onVisitOpen}
        />
      )}
    </section>
  )
}

function GoodsDeliveryStrip({ deliveries, showDate }: { deliveries: GoodsMovement[]; showDate: boolean }) {
  if (deliveries.length === 0) return null
  return (
    <div className="shrink-0 border-b bg-blue-50/40 px-3 py-2" aria-label="Gün içinde beklenen mal teslimatları">
      <div className="flex gap-2 overflow-x-auto scrollbar-thin">
        {deliveries.map((delivery) => (
          <div key={delivery.id} className="min-w-48 max-w-72 rounded border border-l-[3px] border-blue-200 border-l-blue-500 bg-white px-2 py-1.5 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-slate-900"><Package className="size-3.5 text-blue-700" /><span className="text-blue-700">Mal</span><span className="truncate">· {delivery.counterpartyName}</span></p>
            <p className="mt-0.5 truncate text-slate-600">{delivery.goodsDescription}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{showDate ? `${formatTr(new Date(`${delivery.plannedDate}T12:00:00`), "d MMM")} · ` : ""}Gün içinde</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function LaneTimeline({ visits, selectedDate, view, now, timeRange, fitToHeight, onVisitOpen }: { visits: Visit[]; selectedDate: Date; view: "day" | "week"; now: Date; timeRange: TimelineRange; fitToHeight: boolean; onVisitOpen(visit: Visit): void }) {
  const hours = Array.from({ length: (timeRange.endMinutes - timeRange.startMinutes) / 60 + 1 }, (_, index) => timeRange.startMinutes / 60 + index)
  const weekBodyRef = useRef<HTMLDivElement | null>(null)
  const [weekBodyHeight, setWeekBodyHeight] = useState(0)

  useEffect(() => {
    const node = weekBodyRef.current
    if (!fitToHeight || !node) return
    const observer = new ResizeObserver(([entry]) => setWeekBodyHeight(entry.contentRect.height))
    observer.observe(node)
    return () => observer.disconnect()
  }, [fitToHeight, view])

  if (view === "day") {
    const agendaVisits = layoutDayVisits(visits)

    return (
      <div
        className="grid min-h-[472px] min-w-0 flex-1 grid-cols-[34px_52px_minmax(0,1fr)] border-b xl:min-h-0"
      >
        <div className="relative bg-slate-50/70" aria-hidden="true">
          {isSameDay(selectedDate, now) && <DayCurrentTimeMarker now={now} timeRange={timeRange} />}
        </div>
        <div className="relative border-r bg-slate-50/70" aria-hidden="true">
          {hours.map((hour, index) => (
            <span
              key={hour}
              className="absolute right-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
              style={dayHourLabelPosition(index, hours.length)}
            >
              {String(hour).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        <div className="relative overflow-hidden bg-white" aria-label="Günlük ziyaret gündemi">
          {hours.map((hour, index) =>
            // The first/last hour edges are already drawn by the toolbar's and grid's
            // own borders — rendering them here again produces a doubled 2px rule.
            index === 0 || index === hours.length - 1 ? null : (
              <div
                key={hour}
                className="pointer-events-none absolute inset-x-0 border-t"
                style={{ top: `${(index / (hours.length - 1)) * 100}%` }}
                aria-hidden="true"
              />
            ),
          )}
          {isSameDay(selectedDate, now) && <DayCurrentTimeIndicator now={now} timeRange={timeRange} />}
          {agendaVisits.map(({ visit, column, columnCount }) => (
            <DayVisitCard key={visit.id} visit={visit} column={column} columnCount={columnCount} timeRange={timeRange} onOpen={onVisitOpen} />
          ))}
          {agendaVisits.length === 0 && <EmptyTimelineOverlay />}
        </div>
      </div>
    )
  }

  const days = eachDayOfInterval({
    start: startOfWeek(selectedDate, { weekStartsOn: 1 }),
    end: endOfWeek(selectedDate, { weekStartsOn: 1 }),
  })
  const dayBuckets = days.map((day) => ({ day, dayVisits: visits.filter((visit) => isSameDay(new Date(visit.plannedStart), day)) }))
  const weekContainsToday = days.some((day) => isSameDay(day, now))
  const weekDays = dayBuckets.map((bucket) => {
    const laneLayout = layoutWeekLanes(bucket.dayVisits.map((visit) => ({
      id: visit.id,
      startMinutes: visitStartMinutes(visit),
      endMinutes: visitEndMinutes(visit),
      visit,
    })))
    return {
      ...bucket,
      laneLayout,
    }
  })
  const density = fitToHeight
    ? resolveWeekDensity(weekDays.map((day) => day.laneLayout.laneCount), weekBodyHeight)
    : defaultWeekDensity
  const dense = density.labelFloor < 44
  const laidOutWeekDays = weekDays.map((day) => ({ ...day, minHeight: weekRowHeight(density, day.laneLayout.laneCount) }))

  return (
    <div className="flex min-h-[472px] min-w-0 flex-1 flex-col xl:min-h-0">
      <TimeHeader hours={hours} label="Gün" nowOffset={weekContainsToday ? currentTimeOffset(now, timeRange) : null} />
      <div ref={weekBodyRef} className={cn("scrollbar-thin flex min-h-0 flex-1 flex-col", fitToHeight ? "overflow-hidden" : "overflow-y-auto")}>
        <div className="flex min-h-full flex-1 flex-col divide-y">
          {laidOutWeekDays.map(({ day, laneLayout, minHeight }) => (
            <div key={day.toISOString()} className="grid flex-1 grid-cols-[112px_minmax(0,1fr)]" style={{ minHeight }}>
              <div className={cn("flex flex-col justify-center border-r px-2.5", isSameDay(day, new Date()) && "bg-blue-50/60", dense ? "py-1" : fitToHeight ? "py-1.5" : "py-2.5")}>
                <p className={cn("truncate font-semibold", dense ? "text-[11px] leading-[13px]" : fitToHeight ? "text-xs leading-4" : "text-[13px]")}>{formatTr(day, "EEEE")}</p>
                <p className={cn("truncate text-muted-foreground", dense ? "text-[10px] leading-[13px]" : fitToHeight ? "text-[11px] leading-4" : "mt-0.5 text-xs")}>{formatTr(day, "d MMMM")}</p>
              </div>
              <div
                className="relative h-full bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px)] bg-[length:10%_100%]"
                style={{ minHeight }}
              >
                {isSameDay(day, now) && <WeekCurrentTimeIndicator now={now} timeRange={timeRange} />}
                {laneLayout.placements.map(({ item, lane }) => (
                  <VisitBlock
                    key={item.id}
                    visit={item.visit}
                    timeRange={timeRange}
                    top={2 + lane * density.pitch}
                    height={density.pitch - 3}
                    onOpen={onVisitOpen}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TimeHeader({ hours, label, nowOffset }: { hours: number[]; label: string; nowOffset: number | null }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] border-b bg-slate-50/80">
      <div className="border-r px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="relative h-10">
        <TimeAxis hours={hours} />
        {nowOffset !== null && <WeekCurrentTimeMarker left={nowOffset} />}
      </div>
    </div>
  )
}

function TimeAxis({ hours }: { hours: number[] }) {
  return (
    <div className="absolute inset-x-0 bottom-0 h-7">
      {hours.map((hour, index) => (
        <span
          key={hour}
          className={cn(
            "absolute top-1.5 text-[9px] tabular-nums text-muted-foreground",
            index === 0 ? "translate-x-0" : index === hours.length - 1 ? "" : "-translate-x-1/2",
          )}
          style={index === hours.length - 1 ? { right: 8 } : { left: index === 0 ? 8 : `${(index / (hours.length - 1)) * 100}%` }}
        >
          {String(hour).padStart(2, "0")}:00
        </span>
      ))}
    </div>
  )
}

interface DayVisitLayout {
  visit: Visit
  column: number
  columnCount: number
}

function layoutDayVisits(visits: Visit[]): DayVisitLayout[] {
  const visible = [...visits]
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))
  const result: DayVisitLayout[] = []
  let group: Visit[] = []
  let groupEnd = Number.NEGATIVE_INFINITY

  const placeGroup = () => {
    if (group.length === 0) return
    const columnEnds: number[] = []
    const placed = group.map((visit) => {
      const start = visitStartMinutes(visit)
      let column = columnEnds.findIndex((end) => end <= start)
      if (column === -1) column = columnEnds.length
      columnEnds[column] = visitCollisionEndMinutes(visit)
      return { visit, column }
    })
    const columnCount = columnEnds.length
    result.push(...placed.map((item) => ({ ...item, columnCount })))
    group = []
    groupEnd = Number.NEGATIVE_INFINITY
  }

  visible.forEach((visit) => {
    const start = visitStartMinutes(visit)
    if (group.length > 0 && start >= groupEnd) placeGroup()
    group.push(visit)
    groupEnd = Math.max(groupEnd, visitCollisionEndMinutes(visit))
  })
  placeGroup()

  return result
}

function visitStartMinutes(visit: Visit) {
  return getTimelineVisitStartMinutes(visit)
}

function visitEndMinutes(visit: Visit) {
  return getTimelineVisitEndMinutes(visit)
}

function visitCollisionEndMinutes(visit: Visit) {
  const duration = visitEndMinutes(visit) - visitStartMinutes(visit)
  return visitEndMinutes(visit) + (duration <= 60 ? 15 : 0)
}

function dayHourLabelPosition(index: number, hourCount: number) {
  if (index === 0) return { top: 4 }
  if (index === hourCount - 1) return { bottom: 4 }
  return { top: `${(index / (hourCount - 1)) * 100}%`, transform: "translateY(-50%)" }
}

function DayVisitCard({ visit, column, columnCount, timeRange, onOpen }: { visit: Visit; column: number; columnCount: number; timeRange: TimelineRange; onOpen(visit: Visit): void }) {
  const startLabel = formatIstanbulWallClockTime(visit.plannedStart)
  const endLabel = formatIstanbulWallClockTime(visit.plannedEnd)
  const startMinutes = Math.max(timeRange.startMinutes, visitStartMinutes(visit))
  const endMinutes = Math.min(timeRange.endMinutes, visitEndMinutes(visit))
  const { top, height } = getDayVisitPlacement(startMinutes, endMinutes, timeRange)
  const width = 100 / columnCount
  const left = column * width
  const duration = visitEndMinutes(visit) - visitStartMinutes(visit)
  const minimumHeight = getDayVisitMinimumHeight(duration)
  const contentRef = useRef<HTMLSpanElement | null>(null)
  const [lineCount, setLineCount] = useState(1)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return

    const updateLineCount = () => {
      const nextLineCount = getDayVisitContentLineCount(content.clientHeight)
      setLineCount((current) => current === nextLineCount ? current : nextLineCount)
    }

    updateLineCount()
    const observer = new ResizeObserver(updateLineCount)
    observer.observe(content)
    return () => observer.disconnect()
  }, [height, minimumHeight])

  return (
    <div
      className="group absolute z-[1] hover:z-20 focus-within:z-20"
      style={{
        top: `${top}%`,
        height: `${height}%`,
        left: `calc(${left}% + 3px)`,
        width: `calc(${width}% - 6px)`,
        minHeight: minimumHeight,
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(visit)}
        className={cn(
          "absolute inset-0 w-full overflow-hidden rounded border border-l-[3px] px-1.5 py-1 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:z-20",
          visitStatusSurfaces[visit.status],
          visitStatusAccents[visit.status],
          visitStatusBorderStyle[visit.status],
        )}
      >
        <span ref={contentRef} className="block h-full overflow-hidden">
          <span className={cn("block truncate text-[11px] font-semibold leading-4", visitStatusTextDecoration[visit.status])}>{visit.visitor.firstName} {visit.visitor.lastName}</span>
          {lineCount >= 2 && <span className="block truncate text-[10px] leading-[13px] tabular-nums opacity-80">{startLabel}–{endLabel}</span>}
          {lineCount >= 3 && <span className="block truncate text-[10px] leading-[13px] opacity-80">{visit.visitTypeName}</span>}
          {lineCount >= 4 && <span className="block truncate text-[10px] leading-[13px] opacity-80">{visit.visitor.company}</span>}
        </span>
      </button>
    </div>
  )
}

const visitBlockInteractionClass = "transition-shadow hover:z-20 hover:shadow-md focus-visible:z-20"

function VisitBlock({ visit, timeRange, top = 10, height = 24, onOpen }: { visit: Visit; timeRange: TimelineRange; top?: number; height?: number; onOpen(visit: Visit): void }) {
  const startMinutes = visitStartMinutes(visit)
  const endMinutes = visitEndMinutes(visit)
  const left = Math.max(0, getTimelineOffset(startMinutes, timeRange))
  const unclampedWidth = getTimelineOffset(endMinutes, timeRange) - getTimelineOffset(startMinutes, timeRange)
  const width = Math.min(100 - left, Math.max(6, unclampedWidth))
  const contentRef = useRef<HTMLSpanElement | null>(null)
  const fullLabelRef = useRef<HTMLSpanElement | null>(null)
  const [hasExtraSpace, setHasExtraSpace] = useState(false)

  useLayoutEffect(() => {
    const content = contentRef.current
    const fullLabel = fullLabelRef.current
    if (!content || !fullLabel) return

    const updateExtraSpace = () => {
      const nextHasExtraSpace = fullLabel.getBoundingClientRect().width <= content.clientWidth
      setHasExtraSpace((current) => current === nextHasExtraSpace ? current : nextHasExtraSpace)
    }

    updateExtraSpace()
    const observer = new ResizeObserver(updateExtraSpace)
    observer.observe(content)
    return () => observer.disconnect()
  }, [visit.visitor.firstName, visit.visitor.lastName])

  return (
    <button
      type="button"
      onClick={() => onOpen(visit)}
      title={`${visit.visitor.firstName} ${visit.visitor.lastName}`}
      className={cn(
        "group absolute flex items-center rounded border border-l-[3px] px-1.5 py-px text-left shadow-sm",
        visitBlockInteractionClass,
        visitStatusSurfaces[visit.status],
        visitStatusAccents[visit.status],
        visitStatusBorderStyle[visit.status],
      )}
      style={{ left: `${left}%`, width: `${width}%`, top, height }}
    >
      <span ref={contentRef} className="relative block w-full min-w-0 overflow-hidden">
        <span className="pointer-events-none invisible absolute whitespace-nowrap text-[10px] leading-[11px] font-semibold" ref={fullLabelRef} aria-hidden="true">
          {visit.visitor.firstName} {visit.visitor.lastName}
        </span>
        <span className={cn("block truncate text-[10px] font-semibold leading-[11px]", hasExtraSpace && "text-center", visitStatusTextDecoration[visit.status])}>
          {visit.visitor.firstName} {visit.visitor.lastName}
        </span>
      </span>
      <VisitHoverTooltip visit={visit} />
    </button>
  )
}

function WeekCurrentTimeIndicator({ now, timeRange }: { now: Date; timeRange: TimelineRange }) {
  const left = currentTimeOffset(now, timeRange)
  if (left === null) return null

  return (
    <div className="pointer-events-none absolute inset-y-0 z-0 w-px bg-rose-500/80" style={{ left: `${left}%` }} aria-hidden="true" />
  )
}

/**
 * The "Şimdi" pill occupies the header's separate upper band, so every time label
 * remains visible in the ruler below. It is nudged inward at the extremes.
 */
function WeekCurrentTimeMarker({ left }: { left: number }) {
  const alignment = left < 4 ? "translate-x-0" : left > 96 ? "-translate-x-full" : "-translate-x-1/2"
  return (
    <span
      data-week-current-time-marker
      className={cn(
        "pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded bg-rose-600 px-1 py-0.5 text-[9px] font-semibold leading-none text-white shadow-sm",
        alignment,
      )}
      style={{ left: `${left}%` }}
      aria-hidden="true"
    >
      Şimdi
    </span>
  )
}

/** Horizontal position of the current time inside the lane window, or null when out of range. */
function currentTimeOffset(now: Date, timeRange: TimelineRange): number | null {
  const currentMinutes = getIsoWallClockMinutes(now) ?? 0
  if (currentMinutes < timeRange.startMinutes || currentMinutes > timeRange.endMinutes) return null
  return ((currentMinutes - timeRange.startMinutes) / (timeRange.endMinutes - timeRange.startMinutes)) * 100
}

function DayCurrentTimeIndicator({ now, timeRange }: { now: Date; timeRange: TimelineRange }) {
  const currentMinutes = getIsoWallClockMinutes(now) ?? 0
  const windowMinutes = timeRange.endMinutes - timeRange.startMinutes
  if (currentMinutes < timeRange.startMinutes || currentMinutes > timeRange.endMinutes) return null

  const top = ((currentMinutes - timeRange.startMinutes) / windowMinutes) * 100

  return <div className="pointer-events-none absolute inset-x-0 z-0 h-px bg-rose-500/90" style={{ top: `${top}%` }} aria-hidden="true" />
}

function DayCurrentTimeMarker({ now, timeRange }: { now: Date; timeRange: TimelineRange }) {
  const currentMinutes = getIsoWallClockMinutes(now) ?? 0
  const windowMinutes = timeRange.endMinutes - timeRange.startMinutes
  if (currentMinutes < timeRange.startMinutes || currentMinutes > timeRange.endMinutes) return null

  const top = ((currentMinutes - timeRange.startMinutes) / windowMinutes) * 100

  return (
    <span className="pointer-events-none absolute left-0 z-30 -translate-y-1/2 whitespace-nowrap rounded bg-rose-600 px-1 py-0.5 text-[9px] font-semibold leading-none text-white shadow-sm" style={{ top: `${top}%` }} aria-hidden="true">
      Şimdi
    </span>
  )
}

function VisitHoverTooltip({ visit }: { visit: Visit }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute right-0 top-full z-50 mt-1 w-56 rounded-md bg-slate-950 px-2.5 py-2 text-left text-[11px] leading-4 text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
    >
      <VisitTooltipContent visit={visit} />
    </span>
  )
}

function VisitTooltipContent({ visit }: { visit: Visit }) {
  return (
    <>
      <span className="block font-semibold">{visit.visitor.firstName} {visit.visitor.lastName}</span>
      <span className="block text-slate-300">{visit.visitTypeName}</span>
      <span className="block text-slate-300">{visit.visitor.company}</span>
      <span className="block tabular-nums text-slate-300">{formatIstanbulWallClockTime(visit.plannedStart)}–{formatIstanbulWallClockTime(visit.plannedEnd)}</span>
    </>
  )
}

function MonthTimeline({ visits, deliveries, selectedDate, onVisitOpen, fitToHeight }: { visits: Visit[]; deliveries: GoodsMovement[]; selectedDate: Date; onVisitOpen(visit: Visit): void; fitToHeight: boolean }) {
  const interval = {
    start: startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 }),
  }
  const days = eachDayOfInterval(interval)
  const weekCount = days.length / 7

  return (
    <div className="min-h-[472px] min-w-0 flex-1 overflow-x-auto scrollbar-thin xl:min-h-0">
      <div className="flex h-full min-w-[760px] flex-col">
        <div className="grid grid-cols-7 border-b bg-slate-50/80">
          {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((day) => (
            <div key={day} className="border-r px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground last:border-r-0">{day}</div>
          ))}
        </div>
        <div className={cn("grid flex-1 grid-cols-7", fitToHeight && "xl:min-h-0")} style={{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))` }}>
          {days.map((day) => {
            const dayVisits = visits.filter((visit) => isSameDay(new Date(visit.plannedStart), day))
            const dayDeliveries = deliveries.filter((delivery) => isSameDay(new Date(`${delivery.plannedDate}T12:00:00`), day))
            return (
              <MonthDayCell key={day.toISOString()} day={day} visits={dayVisits} deliveries={dayDeliveries} selectedDate={selectedDate} onVisitOpen={onVisitOpen} />
            )
          })}
        </div>
      </div>
    </div>
  )
}

const monthVisitBlockClass = "group relative block w-full rounded border border-l-[3px] px-1.5 py-0.5 text-left text-[10px]"

function MonthDayCell({ day, visits, deliveries, selectedDate, onVisitOpen }: { day: Date; visits: Visit[]; deliveries: GoodsMovement[]; selectedDate: Date; onVisitOpen(visit: Visit): void }) {
  const cellRef = useRef<HTMLDivElement | null>(null)
  const dayNumberRef = useRef<HTMLDivElement | null>(null)
  const visitMeasureRef = useRef<HTMLDivElement | null>(null)
  const overflowMeasureRef = useRef<HTMLButtonElement | null>(null)
  const [visibleVisitCount, setVisibleVisitCount] = useState(visits.length)
  const visibleVisits = visits.slice(0, visibleVisitCount)
  const hiddenVisits = visits.slice(visibleVisitCount)

  useLayoutEffect(() => {
    const cell = cellRef.current
    const dayNumber = dayNumberRef.current
    const visitMeasure = visitMeasureRef.current
    const overflowMeasure = overflowMeasureRef.current
    if (!cell || !dayNumber || !visitMeasure || !overflowMeasure) return

    const updateCapacity = () => {
      const cellStyle = window.getComputedStyle(cell)
      const dayNumberStyle = window.getComputedStyle(dayNumber)
      const availableHeight = cell.clientHeight
        - Number.parseFloat(cellStyle.paddingTop)
        - Number.parseFloat(cellStyle.paddingBottom)
        - dayNumber.getBoundingClientRect().height
        - Number.parseFloat(dayNumberStyle.marginBottom)
      const visitRect = visitMeasure.getBoundingClientRect()
      const overflowRect = overflowMeasure.getBoundingClientRect()
      const itemGap = Math.max(0, overflowRect.top - visitRect.bottom)
      const nextVisibleVisitCount = getMonthVisibleVisitCount({
        availableHeight,
        visitHeight: visitRect.height,
        itemGap,
        overflowHeight: overflowRect.height,
        visitCount: visits.length,
      })
      setVisibleVisitCount((current) => current === nextVisibleVisitCount ? current : nextVisibleVisitCount)
    }

    updateCapacity()
    const observer = new ResizeObserver(updateCapacity)
    observer.observe(cell)
    return () => observer.disconnect()
  }, [visits.length])

  return (
    <div
      ref={cellRef}
      className={cn(
        "relative min-h-0 overflow-hidden border-b border-r p-1.5 last:border-r-0",
        !isSameMonth(day, selectedDate) && "bg-slate-50/70 text-muted-foreground",
      )}
    >
      <div ref={dayNumberRef} className={cn("mb-1 flex size-[22px] items-center justify-center rounded-full text-[11px] font-medium", isSameDay(day, new Date()) && "bg-primary text-primary-foreground")}>
        {formatTr(day, "d")}
      </div>
      <div className="space-y-1">
        {deliveries.map((delivery) => (
          <div key={delivery.id} className="rounded border border-l-[3px] border-blue-200 border-l-blue-500 bg-white px-1.5 py-0.5 text-[10px]" title={`${delivery.counterpartyName} · ${delivery.goodsDescription} · Gün içinde`}>
            <p className="flex items-center gap-1 truncate font-semibold"><Package className="size-3 shrink-0 text-blue-700" /><span className="text-blue-700">Mal</span><span className="truncate">· {delivery.counterpartyName}</span></p>
          </div>
        ))}
        {visibleVisits.map((visit) => (
          <MonthVisitBlock key={visit.id} visit={visit} onOpen={onVisitOpen} />
        ))}
        {hiddenVisits.length > 0 && <MonthOverflowMenu day={day} visits={hiddenVisits} onVisitOpen={onVisitOpen} />}
      </div>
      {visits.length > 0 && (
        <div aria-hidden="true" className="pointer-events-none invisible absolute inset-x-1.5 top-0 space-y-1">
          <div ref={visitMeasureRef} className={monthVisitBlockClass}><p className="truncate font-semibold">00:00 · Ziyaret</p></div>
          <button ref={overflowMeasureRef} type="button" className="relative rounded px-1 py-0.5 text-[10px] font-semibold text-primary">+99 ziyaret</button>
        </div>
      )}
    </div>
  )
}

function MonthVisitBlock({ visit, onOpen }: { visit: Visit; onOpen(visit: Visit): void }) {
  const cardRef = useRef<HTMLButtonElement | null>(null)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  useEffect(() => {
    if (!tooltipOpen) return
    const closeTooltip = () => setTooltipOpen(false)
    document.addEventListener("scroll", closeTooltip, true)
    return () => document.removeEventListener("scroll", closeTooltip, true)
  }, [tooltipOpen])

  return (
    <>
      <button ref={cardRef} type="button" onClick={() => onOpen(visit)} onPointerEnter={() => setTooltipOpen(true)} onPointerLeave={() => setTooltipOpen(false)} onFocus={() => setTooltipOpen(true)} onBlur={() => setTooltipOpen(false)} className={cn(monthVisitBlockClass, visitBlockInteractionClass, visitStatusSurfaces[visit.status], visitStatusAccents[visit.status])}>
        <p className={cn("truncate font-semibold", visitStatusTextDecoration[visit.status])}>{formatTr(new Date(visit.plannedStart), "HH:mm")} · {visit.visitor.firstName} {visit.visitor.lastName}</p>
      </button>
      <MonthVisitHoverTooltip visit={visit} anchorRef={cardRef} open={tooltipOpen} />
    </>
  )
}

function MonthVisitHoverTooltip({ visit, anchorRef, open }: { visit: Visit; anchorRef: MutableRefObject<HTMLElement | null>; open: boolean }) {
  const tooltipRef = useRef<HTMLSpanElement | null>(null)
  const [position, setPosition] = useState<TimelineTooltipPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    const anchor = anchorRef.current
    const tooltip = tooltipRef.current
    if (!anchor || !tooltip) return

    const updatePlacement = () => setPosition(getTimelineTooltipPosition(anchor.getBoundingClientRect(), tooltip.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    updatePlacement()
    window.addEventListener("resize", updatePlacement)
    return () => window.removeEventListener("resize", updatePlacement)
  }, [anchorRef, open])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <span
      role="tooltip"
      ref={tooltipRef}
      className={cn("pointer-events-none fixed z-[45] w-56 overflow-y-auto rounded-md bg-slate-950 px-2.5 py-2 text-left text-[11px] leading-4 text-white shadow-lg", position ? "visible opacity-100" : "invisible opacity-0")}
      style={position ? { top: position.top, left: position.left, maxWidth: position.maxWidth, maxHeight: position.maxHeight } : undefined}
    >
      <VisitTooltipContent visit={visit} />
    </span>,
    document.body,
  )
}

function MonthOverflowMenu({ day, visits, onVisitOpen }: { day: Date; visits: Visit[]; onVisitOpen(visit: Visit): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("relative rounded px-1 py-0.5 text-[10px] font-semibold text-primary hover:bg-blue-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", visitBlockInteractionClass)}
          aria-label={`${formatTr(day, "d MMMM")} günü için ${visits.length} ek ziyareti göster`}
        >
          +{visits.length} ziyaret
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} collisionPadding={8} className="w-64 p-0">
        <div className="border-b px-2.5 py-2">
          <p className="text-xs font-semibold">{formatTr(day, "d MMMM")}</p>
          <p className="text-[10px] text-muted-foreground">{visits.length} ek ziyaret</p>
        </div>
        <div className="scrollbar-thin max-h-56 overflow-y-auto p-1">
          {visits.map((visit) => (
            <DropdownMenuItem
              key={visit.id}
              onSelect={() => onVisitOpen(visit)}
              className={cn("relative flex items-center gap-2 px-2 py-1.5 text-xs", visitBlockInteractionClass)}
            >
              <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
                {formatTr(new Date(visit.plannedStart), "HH:mm")}
              </span>
              <span className={cn("truncate font-medium", visitStatusTextDecoration[visit.status])}>
                {visit.visitor.firstName} {visit.visitor.lastName}
              </span>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EmptyTimelineOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="rounded-md border bg-white px-4 py-3 text-center shadow-sm">
        <p className="text-[13px] font-medium">Planlanmış ziyaret yok</p>
        <p className="mt-1 text-xs text-muted-foreground">Başka bir tarih seçin veya yeni bir ziyaret oluşturun.</p>
      </div>
    </div>
  )
}
