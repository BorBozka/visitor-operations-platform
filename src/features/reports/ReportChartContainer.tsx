import { type ReactNode, useLayoutEffect, useRef, useState } from "react"

import { REPORT_CHART_RESIZE_DEBOUNCE_MS } from "@/features/reports/report-chart-config"

type ChartSize = {
  height: number
  width: number
}

type ReportChartContainerProps = {
  children(size: ChartSize): ReactNode
}

function normalizeChartSize(width: number, height: number): ChartSize {
  return {
    height: Math.max(0, Math.round(height)),
    width: Math.max(0, Math.round(width)),
  }
}

function sizesMatch(left: ChartSize | null, right: ChartSize) {
  return left?.height === right.height && left.width === right.width
}

export function ReportChartContainer({ children }: ReportChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const committedSizeRef = useRef<ChartSize | null>(null)
  const lastResizeAtRef = useRef(0)
  const pendingSizeRef = useRef<ChartSize | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const [size, setSize] = useState<ChartSize | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const commitSize = (nextSize: ChartSize) => {
      if (sizesMatch(committedSizeRef.current, nextSize)) return
      committedSizeRef.current = nextSize
      setSize(nextSize)
    }

    // clientWidth/clientHeight stay in CSS pixels under the shell's zoom. Recharts'
    // getBoundingClientRect-based first measurement does not, which caused the initial jump.
    commitSize(normalizeChartSize(container.clientWidth, container.clientHeight))

    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(() => {
      // Keep every measurement in layout CSS pixels. Chromium reports contentRect in
      // zoom-adjusted pixels here, which would overwrite the correct initial size.
      const nextSize = normalizeChartSize(container.clientWidth, container.clientHeight)
      if (sizesMatch(committedSizeRef.current, nextSize)) return

      // Reaching a drawable size for the first time is not a resize: an ancestor that only gets
      // its own height after this container has mounted (layout effects run children first) would
      // otherwise cost a full debounce interval of empty chart area on the first paint. Resize
      // notifications are delivered before paint, so committing here draws in the same frame.
      const committed = committedSizeRef.current
      if (committed === null || committed.width === 0 || committed.height === 0) {
        if (resizeTimerRef.current !== null) {
          window.clearTimeout(resizeTimerRef.current)
          resizeTimerRef.current = null
        }
        pendingSizeRef.current = null
        commitSize(nextSize)
        return
      }

      pendingSizeRef.current = nextSize
      const resizeAt = window.performance.now()
      if (resizeAt - lastResizeAtRef.current > 100 && resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
      lastResizeAtRef.current = resizeAt
      if (resizeTimerRef.current !== null) return

      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null
        if (pendingSizeRef.current) commitSize(pendingSizeRef.current)
        pendingSizeRef.current = null
      }, REPORT_CHART_RESIZE_DEBOUNCE_MS)
    })

    observer.observe(container)
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
      pendingSizeRef.current = null
    }
  }, [])

  return (
    <div ref={containerRef} className="h-full min-w-0 w-full">
      {size && size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  )
}
