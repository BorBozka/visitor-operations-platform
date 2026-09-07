import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { REPORT_CHART_RESIZE_DEBOUNCE_MS } from "@/features/reports/report-chart-config"

const chartSources = [
  "VisitsTrendChart.tsx",
  "GoodsMovementTrendChart.tsx",
  "FleetLoadChart.tsx",
].map((fileName) => readFileSync(resolve(process.cwd(), "src/features/reports", fileName), "utf8"))
const globalStyles = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8")
const containerSource = readFileSync(resolve(process.cwd(), "src/features/reports/ReportChartContainer.tsx"), "utf8")

describe("report chart resize performance", () => {
  it("throttles every responsive report chart during shell width transitions", () => {
    expect(REPORT_CHART_RESIZE_DEBOUNCE_MS).toBe(320)
    for (const source of chartSources) {
      expect(source).toContain("<ReportChartContainer>")
      expect(source).not.toContain("ResponsiveContainer")
      expect(source).toContain("[contain:paint]")
      expect(source).toContain("cursor-default")
      expect(source).not.toContain("pointer-events-none")
      expect(source).toContain("<Tooltip")
      expect(source).toContain("accessibilityLayer={false}")
      expect(source).toContain('tabIndex={-1}')
      expect(source).toContain("report-chart")
      expect(source).toContain("onPointerDown={(event) => event.preventDefault()}")
    }
    expect(containerSource).toContain("useLayoutEffect")
    expect(containerSource).toContain("container.clientWidth")
    expect(containerSource).toContain("container.clientHeight")
    expect(containerSource).toContain("new ResizeObserver")
    expect(containerSource).not.toContain("entry.contentRect")
    expect(containerSource).toContain("REPORT_CHART_RESIZE_DEBOUNCE_MS")
    expect(containerSource).toMatch(/window\.clearTimeout\(resizeTimerRef\.current\)\s*resizeTimerRef\.current = null/)
    expect(containerSource).toContain("pendingSizeRef.current = null")
    // The first drawable size is committed straight away; only later resizes are throttled.
    expect(containerSource).toContain("committed === null || committed.width === 0 || committed.height === 0")
    expect(containerSource).toContain("commitSize(nextSize)")
  })

  it("prevents browser focus outlines only on hover-only report chart surfaces", () => {
    expect(globalStyles).toContain(".report-chart .recharts-wrapper")
    expect(globalStyles).toContain(".report-chart .recharts-surface")
    expect(globalStyles).toContain(".report-chart .recharts-bar")
    expect(globalStyles).toContain(".report-chart .recharts-bar-rectangle")
    expect(globalStyles).toContain(".report-chart .recharts-layer:focus-visible")
    expect(globalStyles).toContain("outline: none !important")
  })
})
