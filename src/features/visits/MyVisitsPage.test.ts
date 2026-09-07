import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const pageSource = readFileSync(resolve(process.cwd(), "src/features/visits/MyVisitsPage.tsx"), "utf8")
const notificationSource = readFileSync(resolve(process.cwd(), "src/features/visits/HostedMeetingEndNotifications.tsx"), "utf8")

describe("MyVisitsPage workspace density", () => {
  it("sizes the employee workspace to leave a 14px page gutter, without zoom", () => {
    expect(pageSource).toContain('const isEmployeeView = location.pathname.startsWith("/employee/")')
    // 64px header + 12px shell top padding + 14px physical page gutter.
    expect(pageSource).toContain('isEmployeeView ? "xl:h-[calc(100dvh-90px)]" : "xl:h-[calc(100dvh-76px)]"')
    expect(pageSource).toContain('isManagerView ? "xl:h-[calc(111.112dvh-27.5556px)]"')
    expect(pageSource).toContain('isEmployeeView ? "xl:grid-cols-[minmax(0,1fr)_244px] " : "xl:grid-cols-[minmax(0,1fr)_320px] "')
    expect(notificationSource).toContain('isEmployeeView ? "bottom-[14px] right-3 w-[min(244px,calc(100vw-2rem))]"')
    expect(notificationSource).toContain('style={{ maxHeight: isEmployeeView ? "calc(100dvh - 90px)" : "calc(100dvh - 94px)" }}')
    expect(pageSource).not.toContain("_256px")
    expect(notificationSource).not.toContain("min(256px")
    expect(pageSource).not.toContain("zoom:0.9")
  })

  it("limits layout behavior to employees while keeping search enabled for every role view", () => {
    expect(pageSource).toContain("fitMonthToHeight={isEmployeeView}")
    expect(pageSource).toContain("searchable />")
    expect(pageSource).not.toContain("searchable={isEmployeeView}")
    expect(pageSource).toContain("isEmployeeView={isEmployeeView}")
  })

  it("keeps the banners outside the scaled workspace", () => {
    const workspaceStart = pageSource.indexOf('<div className={"mb-[14px]')
    expect(pageSource.indexOf("{error && (")).toBeLessThan(workspaceStart)
    expect(pageSource.indexOf("{notice && (")).toBeLessThan(workspaceStart)
  })
})
