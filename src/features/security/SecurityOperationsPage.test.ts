import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const pageSource = readFileSync(resolve(process.cwd(), "src/features/security/SecurityOperationsPage.tsx"), "utf8")

describe("SecurityOperationsPage contract", () => {
  it("drops the old tab / view-state infrastructure entirely", () => {
    expect(pageSource).not.toContain("useSearchParams")
    expect(pageSource).not.toContain('role="tab"')
    expect(pageSource).not.toContain('role="tablist"')
    expect(pageSource).not.toContain('role="tabpanel"')
    expect(pageSource).not.toContain("view=")
    expect(pageSource).not.toContain("getSecurityOperationView")
    expect(pageSource).not.toContain("Kart sorunları")
  })

  it("renders the expected and inside lists together in two side-by-side panels", () => {
    expect(pageSource).toContain('title="Beklenenler"')
    expect(pageSource).toContain('title="İçeride"')
    expect(pageSource).toContain("lg:grid-cols-2")
    expect(pageSource).toContain("getExpectedSecurityVisits")
    expect(pageSource).toContain("getInsideSecurityVisits")
  })

  it("keeps the page fixed while each panel manages its own overflow", () => {
    expect(pageSource).toContain('className="flex h-full min-h-0 flex-col gap-3 overflow-hidden"')
    expect(pageSource).toContain('className="min-h-0 flex-1 overflow-auto scrollbar-thin"')
  })

  it("filters both panels from the single search box", () => {
    expect(pageSource).toContain("filterSecurityVisitRows(getExpectedSecurityVisits(scopedVisits, now), search)")
    expect(pageSource).toContain("filterSecurityVisitRows(getInsideSecurityVisits(scopedVisits, now), search)")
  })

  it("groups the expected timeline and uses a fixed active-operations time block", () => {
    expect(pageSource).toContain('groupExpectedSecurityVisits(expectedRows)')
    expect(pageSource).toContain('title="Gecikenler"')
    expect(pageSource).toContain('title="Sıradakiler"')
    expect(pageSource).toContain('expectedGroups.delayed.length > 0')
    expect(pageSource).toContain('expectedGroups.upcoming.length > 0')
    expect(pageSource).toContain('grid-cols-[3rem_1rem_minmax(0,1fr)_auto]')
    expect(pageSource).toContain('grid-cols-[minmax(0,1fr)_8.25rem_auto]')
    expect(pageSource).toContain('aria-hidden="true"')
    expect(pageSource).toContain('w-px -translate-x-1/2 bg-slate-200/70')
    expect(pageSource).toContain('size-1.5 rounded-full border border-slate-300 bg-white')
    expect(pageSource).toContain('grid-rows-[1fr_1fr] items-stretch')
    expect(pageSource).toContain('text-[10px] font-semibold text-amber-700">Gecikti</span>')
    expect(pageSource).not.toContain('StatusPill')
    expect(pageSource).toContain('{visit.visitTypeName} · {visit.visitor.company} · {visit.hostEmployeeName}</p>')
    expect(pageSource).not.toContain('rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{visit.visitTypeName}</span>')
    expect(pageSource).toContain('className="h-9 border-slate-300 bg-white pl-9 shadow-none transition-colors placeholder:text-slate-500 focus-visible:border-blue-400 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:ring-offset-0"')
  })

  it("keeps the second row limited to the operation search and actions", () => {
    expect(pageSource).not.toContain("<SecurityNavigation />")
    expect(pageSource).not.toContain("Building2")
    expect(pageSource).not.toContain("companyName:")
    expect(pageSource).not.toContain("facilityName:")
    expect(pageSource).toContain('className="flex shrink-0 items-center gap-2 py-1"')
    expect(pageSource).toContain('className="relative min-w-0 flex-1"')
    expect(pageSource).toContain('placeholder="Ziyaretçi, firma veya ev sahibi ara"')
  })

  it("gates the pending-card-returns action on an unresolved count and never exposes LOST", () => {
    expect(pageSource).toContain("securityService.getUnreturnedVisitorCardIssues()")
    expect(pageSource).toContain("scopedCardIssues.length > 0")
    expect(pageSource).toContain("İade bekleyen kartlar · {scopedCardIssues.length}")
    expect(pageSource).toContain("securityService.receiveReturnedVisitorCard(visitId)")
    expect(pageSource).not.toContain("Kayıp olarak işaretle")
    expect(pageSource).not.toContain("LOST")
  })

  it("opens unplanned visits from Security while staying off Manager/Admin UI", () => {
    expect(pageSource).toContain("+ Plansız ziyaret")
    expect(pageSource).toContain("SecurityUnplannedVisitDialog")
    expect(pageSource).toContain("setUnplannedVisitOpen(true)")
    expect(pageSource).not.toContain('from "@/features/manager/')
    expect(pageSource).not.toContain("adminService")
  })

  it("no longer opens a row detail dialog: rows are plain, non-interactive containers", () => {
    expect(pageSource).not.toContain("SecurityVisitDetailDialog")
    expect(pageSource).not.toContain("onOpenDetail")
    expect(pageSource).not.toContain("detailVisit")
    expect(pageSource).not.toContain('role="button"')
    expect(pageSource).not.toContain("RowShell")
  })

  it("wires check-in and checkout through SecurityService dialogs", () => {
    expect(pageSource).toContain('from "@/features/security/SecurityCheckInDialog"')
    expect(pageSource).toContain('from "@/features/security/SecurityCheckOutDialog"')
    expect(pageSource).toContain("Giriş yap")
    expect(pageSource).toContain("Çıkış yap")
  })

  it("keeps the İçeride panel free of the row overflow action and the in-page correction dialog", () => {
    expect(pageSource).not.toContain("MoreHorizontal")
    expect(pageSource).not.toContain("Bilgileri düzelt")
    expect(pageSource).not.toContain("SecurityVisitorCorrectionDialog")
    expect(pageSource).not.toContain("correctingVisit")
    expect(pageSource).not.toContain("onEdit")
  })

  it("renders the İçeride row as a stable two-line active operation block", () => {
    expect(pageSource).toContain('className="col-start-1 row-start-1 flex min-w-0 items-center"')
    expect(pageSource).toContain('<span className="min-w-0 truncate text-slate-500">{visit.visitTypeName} · {visit.visitor.company} · {visit.hostEmployeeName}</span>')
    expect(pageSource).toContain('Giriş {checkInLabel}')
    expect(pageSource).toContain('Beklenen {formatVisitTime(visit.plannedEnd)}{isDelayed && <> · <strong className="font-semibold text-rose-700">+{delayMinutes} dk</strong></>}')
    expect(pageSource).toContain('visit.actualCheckIn ? formatVisitTime(visit.actualCheckIn) : "—"')
    expect(pageSource).not.toContain("visitorCardNumber")
    expect(pageSource).not.toContain("cardLabel")
    expect(pageSource).not.toContain("#{")
  })

  it("keeps the shared slate note popover in expected rows only", () => {
    expect(pageSource).toContain("function SecurityNotePopover")
    expect(pageSource.match(/<SecurityNotePopover/g)).toHaveLength(1)
    const insideRowSource = pageSource.slice(pageSource.indexOf("function InsideRow"), pageSource.indexOf("function SecurityNotePopover"))
    expect(insideRowSource).not.toContain("SecurityNotePopover")
    expect(pageSource).toContain("note={visit.note}")
    expect(pageSource).toContain('aria-label="Güvenliğe bırakılan notu görüntüleyin"')
    expect(pageSource).toContain('className="flex min-w-0 items-center gap-1.5"')
    expect(pageSource).toContain('className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600')
    expect(pageSource).toContain('className="col-start-4 row-span-2 row-start-1 flex items-center justify-end">')
    expect(pageSource).toContain('side="right"')
    expect(pageSource).toContain('className="w-[min(20rem,calc(100vw-1.5rem))] min-w-0 overflow-hidden p-0"')
    expect(pageSource).toContain('className="min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700"')
  })
})
