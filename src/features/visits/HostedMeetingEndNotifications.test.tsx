import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import type { Meeting, Visit } from "@/domain/visits"
import { HostedMeetingEndNotifications, HostedMeetingNotificationRow, InvitationNotificationRow } from "@/features/visits/HostedMeetingEndNotifications"
import { useVisits } from "@/features/visits/visit-context"
import { getNextExpandedMeetingId } from "@/features/visits/hosted-meeting-notifications-utils"
import { getActionRequiredInvitationVisits, getVisiblePendingInvitationVisits } from "@/features/visits/invitation-status"

vi.mock("@/features/visits/visit-context", () => ({ useVisits: vi.fn() }))

const meeting: Meeting = {
  id: "meeting-1", creatorEmployeeId: "employee-1", visitTypeId: "type-1", visitTypeName: "Toplantı",
  hostEmployeeId: "host-1", hostEmployeeName: "Ayşe Yılmaz", hostCompanyId: "company-1", hostCompanyName: "Merkez",
  facilityId: "facility-1", facilityName: "Genel Müdürlük", plannedStart: "2026-08-13T08:00:00.000Z", plannedEnd: "2026-08-13T09:00:00.000Z",
  hasAdditionalRequirements: false, createdAt: "2026-08-13T07:00:00.000Z", updatedAt: "2026-08-13T07:00:00.000Z",
}

const visit: Visit = {
  ...meeting, id: "visit-1", meetingId: meeting.id,
  visitor: { id: "visitor-1", firstName: "Ali", lastName: "Demir", email: "ali@example.com", company: "Test A.Ş." },
  status: "CHECKED_IN", invitationStatus: "SENT", createdAt: meeting.createdAt, updatedAt: meeting.updatedAt,
}

const invitationVisit: Visit = {
  ...visit,
  id: "visit-2",
  creatorEmployeeId: "host-1",
  visitor: { id: "visitor-2", firstName: "Ece", lastName: "Kaya", email: "ece@example.com", company: "Test A.Ş." },
  status: "PLANNED",
  invitationStatus: "NOT_SENT",
}

describe("HostedMeetingEndNotifications", () => {
  it("renders the employee panel with an accessible header toggle", () => {
    vi.mocked(useVisits).mockReturnValue({ meetings: [meeting], visits: [visit], referenceData: { currentEmployee: { employeeId: "host-1" } }, reload: vi.fn() } as never)

    const markup = renderToStaticMarkup(<HostedMeetingEndNotifications isEmployeeView />)

    expect(markup).toContain("bottom-[14px] right-3 w-[min(244px,calc(100vw-2rem))]")
    expect(markup).toContain('max-height:calc(100dvh - 90px)')
    expect(markup).toContain("İşlem gerekenler")
    expect(markup).toContain("Süresi aşılanlar")
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-controls="action-required-content"')
  })

  it("keeps the existing maximum height outside the employee workspace", () => {
    vi.mocked(useVisits).mockReturnValue({ meetings: [meeting], visits: [visit], referenceData: { currentEmployee: { employeeId: "host-1" } }, reload: vi.fn() } as never)

    expect(renderToStaticMarkup(<HostedMeetingEndNotifications />)).toContain('max-height:calc(100dvh - 94px)')
  })

  it("does not render a notification when all linked Visits are terminal", () => {
    vi.mocked(useVisits).mockReturnValue({
      meetings: [meeting],
      visits: [{ ...visit, status: "CANCELLED" }],
      referenceData: { currentEmployee: { employeeId: "host-1" } },
      reload: vi.fn(),
    } as never)

    expect(renderToStaticMarkup(<HostedMeetingEndNotifications />)).toBe("")
  })

  it("renders action-required invitations as a separate compact group", () => {
    vi.mocked(useVisits).mockReturnValue({
      meetings: [],
      visits: [invitationVisit],
      referenceData: { currentEmployee: { employeeId: "host-1" } },
      reload: vi.fn(),
    } as never)

    const markup = renderToStaticMarkup(<HostedMeetingEndNotifications />)

    expect(markup).toContain("İşlem gerekenler")
    expect(markup).toContain("Davetler")
    expect(markup).toContain("Ece Kaya")
    expect(markup).toContain("Gönderilmedi")
    expect(markup).toContain("Daveti gönder")
    expect(markup).not.toContain("Toplantılar")
  })

  it("keeps exactly one selected meeting expanded", () => {
    expect(getNextExpandedMeetingId("meeting-1", "meeting-1")).toBeNull()
    expect(getNextExpandedMeetingId("meeting-1", "meeting-2")).toBe("meeting-2")
  })

  it("renders compact meeting details and only renders actions for the expanded row", () => {
    const props = { meeting, meetingVisits: [visit], actorEmployeeId: "host-1", currentFacilityId: "facility-2", now: new Date("2026-08-13T09:30:00.000Z"), scrollContainerRef: { current: null }, onExpandedChange: vi.fn(), onChanged: vi.fn().mockResolvedValue(undefined) }
    const collapsed = renderToStaticMarkup(<HostedMeetingNotificationRow {...props} isExpanded={false} />)
    const expanded = renderToStaticMarkup(<HostedMeetingNotificationRow {...props} isExpanded />)

    expect(collapsed).toContain("Ali Demir")
    expect(collapsed).toContain("Toplantı")
    expect(collapsed).toContain("30 dk geçti")
    expect(collapsed).not.toContain("Ayşe Yılmaz")
    expect(collapsed).toContain("Genel Müdürlük")
    expect(collapsed).not.toContain("+15 dk")
    expect(expanded).toContain("+15 dk")
    expect(expanded).toContain("Toplantıyı Bitir")
  })

  it("locks the row information architecture and custom input decisions in source", () => {
    const notificationSource = readFileSync(new URL("./HostedMeetingEndNotifications.tsx", import.meta.url), "utf8")
    const actionsSource = readFileSync(new URL("./MeetingLifecycleActions.tsx", import.meta.url), "utf8")

    expect(notificationSource).not.toContain('hover:bg-muted/50')
    expect(notificationSource).not.toContain('hover:bg-muted')
    expect(notificationSource).toContain('rotate-90')
    expect(notificationSource).toContain('event.stopPropagation()')
    expect(notificationSource).toContain('overflow-x-hidden overflow-y-auto')
    expect(notificationSource).toContain('bg-slate-100 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500')
    expect(notificationSource).toContain('AlertTriangle className="size-4 shrink-0 text-amber-700"')
    expect(notificationSource).toContain('CalendarDays className="size-3 shrink-0"')
    expect(notificationSource).not.toContain('MailWarning')
    expect(notificationSource).not.toContain('CalendarClock')
    expect(notificationSource).toContain('shouldShowDifferentFacility')
    expect(notificationSource).toContain('min-w-0 truncate')
    expect(notificationSource).not.toContain('title={meeting.facilityName}')
    expect(notificationSource).not.toContain('title={visit.facilityName}')
    expect(notificationSource).toContain('Başlangıç')
    expect(notificationSource).toContain('Çıkış')
    expect(notificationSource).not.toContain('Planlanan başlangıç')
    expect(notificationSource).not.toContain('Planlanan çıkış')
    expect(notificationSource).not.toContain('rounded-full bg-slate-100')
    expect(notificationSource).toContain('style={{ maxHeight: isEmployeeView ? "calc(100dvh - 90px)" : "calc(100dvh - 94px)" }}')
    expect(notificationSource).not.toContain('424px')
    expect(notificationSource).toContain('className="mt-1 flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-[11px] text-slate-600"')
    expect(notificationSource).toContain('className="mt-2 h-7 px-2 text-[11px]"')
    expect(notificationSource).toContain('className="flex min-w-0 items-center gap-2"')
    expect(notificationSource).toContain('className="mt-0.5 min-w-0 truncate text-xs text-slate-400">{meeting.visitTypeName}')
    expect(notificationSource).toContain('className="mt-0.5 min-w-0 truncate text-xs text-slate-400">{visit.visitTypeName}')
    expect(notificationSource).not.toContain('title={meeting.visitTypeName}')
    expect(notificationSource).not.toContain('title={visit.visitTypeName}')
    expect(notificationSource).toContain('shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium text-amber-800')
    expect(notificationSource).toContain('shrink-0 whitespace-nowrap text-[11px] font-medium')
    expect(notificationSource).not.toContain('rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600')
    expect(notificationSource).toContain('container.scrollTop +=')
    expect(actionsSource).toContain('min={5}')
    expect(actionsSource).toContain('step={5}')
    expect(actionsSource).toContain('disabled={disabled || !isValidCustomExtensionMinutes(value)}')
    expect(actionsSource).toContain('absolute inset-y-0 right-2')
  })

  it("drops every overlay-row tooltip and gives every clickable row a blue left-edge hover accent", () => {
    const notificationSource = readFileSync(new URL("./HostedMeetingEndNotifications.tsx", import.meta.url), "utf8")

    // 1. Overlay rows attach no tooltip anywhere — the text is already fully visible.
    const [invitationRowSource, overdueRowSource] = notificationSource.split("interface HostedMeetingNotificationRowProps")
    expect(invitationRowSource).not.toContain("title=")
    expect(overdueRowSource).not.toContain("title=")

    // 2. Hover no longer fills the whole row with a grey block.
    expect(notificationSource).not.toContain("hover:bg-muted/50")
    expect(notificationSource).not.toContain("hover:bg-muted")

    // 3. The collapsed overdue-meeting row and invitation edit row both use the existing blue
    // left-edge accent, while non-clickable states do not invent a separate hover language.
    expect(overdueRowSource).toContain('${canExpand && !isRowExpanded ? "hover:shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""}')
    expect(invitationRowSource).toContain('hover:shadow-[inset_3px_0_0_hsl(var(--primary))]')
    expect(invitationRowSource).not.toContain("hover:border-l")

    // 4. The accent is never amber (amber is the panel's urgency colour).
    expect(notificationSource).not.toContain("hover:border-l-amber")
    expect(notificationSource).not.toContain("hover:shadow-[inset_3px_0_0_theme(colors.amber")

    const rowProps = { meeting, meetingVisits: [visit], actorEmployeeId: "host-1", now: new Date("2026-08-13T09:30:00.000Z"), scrollContainerRef: { current: null }, onExpandedChange: vi.fn(), onChanged: vi.fn().mockResolvedValue(undefined) }
    const closedOverdueRow = renderToStaticMarkup(<HostedMeetingNotificationRow {...rowProps} isExpanded={false} />)
    const openOverdueRow = renderToStaticMarkup(<HostedMeetingNotificationRow {...rowProps} isExpanded />)
    const invitationRow = renderToStaticMarkup(<InvitationNotificationRow visit={invitationVisit} status="NOT_SENT" onEdit={vi.fn()} onSend={vi.fn()} />)

    expect(closedOverdueRow).toContain("hover:shadow-[inset_3px_0_0_hsl(var(--primary))]")
    expect(openOverdueRow).not.toContain("hover:shadow-[inset_3px_0_0_hsl(var(--primary))]")
    expect(openOverdueRow).not.toContain("hover:bg-muted/50")
    expect(openOverdueRow).not.toContain("title=")
    expect(invitationRow).toContain("hover:shadow-[inset_3px_0_0_hsl(var(--primary))]")
    expect(invitationRow).not.toContain("title=")

    // 6 + 7. Two-band layout, actions and chevron survive.
    expect(openOverdueRow).toContain("Ali Demir")
    expect(openOverdueRow).toContain("Toplantı")
    expect(openOverdueRow).toContain("30 dk geçti")
    expect(openOverdueRow).toContain("rotate-90")
    expect(openOverdueRow).toContain("+15 dk")
    expect(openOverdueRow).toContain("Toplantıyı Bitir")

    // 8. Overlay width is 244px (matching Yaklaşan Ziyaretler).
    vi.mocked(useVisits).mockReturnValue({ meetings: [meeting], visits: [visit], referenceData: { currentEmployee: { employeeId: "host-1" } }, reload: vi.fn() } as never)
    expect(renderToStaticMarkup(<HostedMeetingEndNotifications isEmployeeView />)).toContain("w-[min(244px,calc(100vw-2rem))]")
  })

  it("reports long overdue spans in hours instead of raw minutes", () => {
    const props = { meeting, meetingVisits: [visit], actorEmployeeId: "host-1", currentFacilityId: "facility-2", scrollContainerRef: { current: null }, onExpandedChange: vi.fn(), onChanged: vi.fn().mockResolvedValue(undefined), isExpanded: false }
    // Meeting ends 09:00Z; 277 minutes later is 13:37Z.
    expect(renderToStaticMarkup(<HostedMeetingNotificationRow {...props} now={new Date("2026-08-13T13:37:00.000Z")} />)).toContain("4 sa 37 dk geçti")
    expect(renderToStaticMarkup(<HostedMeetingNotificationRow {...props} now={new Date("2026-08-13T11:00:00.000Z")} />)).toContain("2 sa geçti")
    expect(renderToStaticMarkup(<HostedMeetingNotificationRow {...props} now={new Date("2026-08-13T09:00:00.000Z")} />)).toContain("Bitiş saati geldi")
  })

  it("uses the existing invitation action labels for not-sent and failed rows", () => {
    const notSent = renderToStaticMarkup(<InvitationNotificationRow visit={invitationVisit} status="NOT_SENT" onSend={vi.fn()} />)
    const failed = renderToStaticMarkup(<InvitationNotificationRow visit={{ ...invitationVisit, invitationStatus: "FAILED" }} status="FAILED" onSend={vi.fn()} />)

    expect(notSent).toContain("Daveti gönder")
    expect(failed).toContain("Yeniden gönder")
    expect(failed).toContain("Gönderim başarısız")
    expect(failed).toContain("text-red-700")
    expect(notSent).toContain("text-amber-800")
  })

  it("opens the visit form from the invitation row but keeps its send button isolated", () => {
    const notificationSource = readFileSync(new URL("./HostedMeetingEndNotifications.tsx", import.meta.url), "utf8")
    // The row opens the existing edit form; its nested send action explicitly stops propagation.
    expect(notificationSource).toContain("useInvitationSend")
    expect(notificationSource).toContain("onInvitationEdit(visit)")
    expect(notificationSource).toContain('role="button" tabIndex={0}')
    expect(notificationSource).toContain('event.key === "Enter"')
    expect(notificationSource).toContain("event.stopPropagation(); onSend()")
    expect(notificationSource).toContain("onSend={() => { void sendInvitation(visit.id) }}")

    const onSend = vi.fn()
    const onEdit = vi.fn()
    const busy = renderToStaticMarkup(<InvitationNotificationRow visit={invitationVisit} status="SENDING" onEdit={onEdit} onSend={onSend} />)
    const sent = renderToStaticMarkup(<InvitationNotificationRow visit={invitationVisit} status="SENT" onEdit={onEdit} onSend={onSend} />)

    // Sending shows a busy, disabled button; success shows the result and drops the button.
    expect(busy).toContain("Gönderiliyor…")
    expect(busy).toContain("disabled")
    expect(busy).toContain("animate-spin")
    expect(sent).toContain("Davet gönderildi")
    expect(sent).not.toContain("Daveti gönder")
    expect(sent).toContain('role="button"')
  })

  it("selects only the current employee's not-sent and failed planned visits", () => {
    const selected = getActionRequiredInvitationVisits([
      invitationVisit,
      { ...invitationVisit, id: "visit-failed", invitationStatus: "FAILED" },
      { ...invitationVisit, id: "visit-sending", invitationStatus: "SENDING" },
      { ...invitationVisit, id: "visit-sent", invitationStatus: "SENT" },
      { ...invitationVisit, id: "visit-checked-in", status: "CHECKED_IN" },
      { ...invitationVisit, id: "visit-other-creator", creatorEmployeeId: "employee-2" },
    ], "host-1")

    expect(selected.map((item) => item.id)).toEqual(["visit-2", "visit-failed"])
    expect(getActionRequiredInvitationVisits([invitationVisit])).toEqual([])
  })

  it("dismisses sidebar notifications without changing action-required visits", () => {
    const failed = { ...invitationVisit, id: "visit-failed", invitationStatus: "FAILED" as const }
    const dismissed = new Set([invitationVisit.id])

    expect(getVisiblePendingInvitationVisits([invitationVisit, failed], dismissed).map((item) => item.id)).toEqual(["visit-failed"])
    expect(getActionRequiredInvitationVisits([invitationVisit, failed], "host-1").map((item) => item.id)).toEqual(["visit-2", "visit-failed"])
  })

  it("renders untimed visits under a separate Süresiz ziyaretler section below Davetler, and excludes them from the actionCount badge", () => {
    const untimedMeeting: Meeting = {
      ...meeting,
      id: "meeting-supplier",
      visitTypeName: "Tedarikçi",
    }
    const untimedVisit: Visit = {
      ...visit,
      id: "visit-supplier",
      meetingId: untimedMeeting.id,
      visitTypeName: "Tedarikçi",
      visitor: { id: "vis-supp", firstName: "Buse", lastName: "Tekin", email: "buse@example.com", company: "Tedarik A.Ş." },
    }

    vi.mocked(useVisits).mockReturnValue({
      meetings: [meeting, untimedMeeting],
      visits: [visit, untimedVisit, invitationVisit],
      referenceData: { currentEmployee: { employeeId: "host-1" } },
      reload: vi.fn(),
    } as never)

    const markup = renderToStaticMarkup(<HostedMeetingEndNotifications isEmployeeView />)

    // 1. actionCount is 2 (1 time-bound meeting + 1 invitation). Tedarikçi is NOT counted in the actionCount badge.
    expect(markup).toContain('<span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-200 px-1.5 text-[11px] font-bold text-amber-900">2</span>')

    // 2. Headings appear in correct order: Süresi aşılanlar -> Davetler -> Süresiz ziyaretler
    expect(markup).toContain("Süresi aşılanlar")
    expect(markup).toContain("Davetler")
    expect(markup).toContain("Süresiz ziyaretler")
    const suresiAsilanlarIndex = markup.indexOf("Süresi aşılanlar")
    const davetlerIndex = markup.indexOf("Davetler")
    const suresizZiyaretlerIndex = markup.indexOf("Süresiz ziyaretler")
    expect(suresiAsilanlarIndex).toBeLessThan(davetlerIndex)
    expect(davetlerIndex).toBeLessThan(suresizZiyaretlerIndex)

    // 3. Untimed visit content is rendered in the untimed section
    expect(markup).toContain("Buse Tekin")
    expect(markup).toContain("Tedarikçi")

    // 4. When there are only untimed visits (0 time-bound, 0 invitations), the panel does not render because actionCount is 0
    vi.mocked(useVisits).mockReturnValue({
      meetings: [untimedMeeting],
      visits: [untimedVisit],
      referenceData: { currentEmployee: { employeeId: "host-1" } },
      reload: vi.fn(),
    } as never)

    expect(renderToStaticMarkup(<HostedMeetingEndNotifications isEmployeeView />)).toBe("")
  })
})
