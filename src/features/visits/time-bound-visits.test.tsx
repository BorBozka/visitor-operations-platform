import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { isTimeBoundVisitType, type Meeting, type Visit } from "@/domain/visits"
import {
  HostedMeetingEndNotifications,
  HostedMeetingNotificationRow,
  UntimedMeetingNotificationRow,
} from "@/features/visits/HostedMeetingEndNotifications"
import {
  MeetingLifecycleActions,
  MeetingLifecycleCustomExtension,
} from "@/features/visits/MeetingLifecycleActions"
import { useVisits } from "@/features/visits/visit-context"

vi.mock("@/features/visits/visit-context", () => ({ useVisits: vi.fn() }))

const baseMeeting: Meeting = {
  id: "meeting-1",
  creatorEmployeeId: "employee-1",
  visitTypeId: "type-1",
  visitTypeName: "Toplantı",
  hostEmployeeId: "host-1",
  hostEmployeeName: "Ayşe Yılmaz",
  hostCompanyId: "company-1",
  hostCompanyName: "Merkez",
  facilityId: "facility-1",
  facilityName: "Genel Müdürlük",
  plannedStart: "2026-08-13T08:00:00.000Z",
  plannedEnd: "2026-08-13T09:00:00.000Z",
  hasAdditionalRequirements: false,
  createdAt: "2026-08-13T07:00:00.000Z",
  updatedAt: "2026-08-13T07:00:00.000Z",
}

const baseVisit: Visit = {
  ...baseMeeting,
  id: "visit-1",
  meetingId: baseMeeting.id,
  visitor: { id: "visitor-1", firstName: "Ali", lastName: "Demir", email: "ali@example.com", company: "Test A.Ş." },
  status: "CHECKED_IN",
  invitationStatus: "SENT",
  createdAt: baseMeeting.createdAt,
  updatedAt: baseMeeting.updatedAt,
}

describe("time-bound visit type actions and hover accent specifications", () => {
  it("1. recognizes Toplantı, İş Görüşmesi, Eğitim, and Müşteri Ziyareti as time-bound (süreli)", () => {
    expect(isTimeBoundVisitType("Toplantı")).toBe(true)
    expect(isTimeBoundVisitType("İş Görüşmesi")).toBe(true)
    expect(isTimeBoundVisitType("Eğitim")).toBe(true)
    expect(isTimeBoundVisitType("Müşteri Ziyareti")).toBe(true)
  })

  it("2. recognizes Tedarikçi, Teknik Servis / Bakım, and Denetim as non-time-bound (süresiz)", () => {
    expect(isTimeBoundVisitType("Tedarikçi")).toBe(false)
    expect(isTimeBoundVisitType("Teknik Servis / Bakım")).toBe(false)
    expect(isTimeBoundVisitType("Denetim")).toBe(false)
  })

  it("3. defaults unlisted and unknown types to non-time-bound (süresiz)", () => {
    expect(isTimeBoundVisitType("Bilinmeyen Tür")).toBe(false)
    expect(isTimeBoundVisitType("Rastgele")).toBe(false)
    expect(isTimeBoundVisitType("")).toBe(false)
    expect(isTimeBoundVisitType(null)).toBe(false)
    expect(isTimeBoundVisitType(undefined)).toBe(false)
  })

  it("4. does not render extension buttons (+15 dk, +30 dk, Özel) for non-time-bound rows", () => {
    const supplierMeeting: Meeting = { ...baseMeeting, visitTypeName: "Tedarikçi" }
    const markup = renderToStaticMarkup(
      <HostedMeetingNotificationRow
        meeting={supplierMeeting}
        meetingVisits={[{ ...baseVisit, ...supplierMeeting }]}
        actorEmployeeId="host-1"
        now={new Date("2026-09-04T10:00:00.000Z")}
        scrollContainerRef={{ current: null }}
        isExpanded={true}
        onExpandedChange={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(markup).not.toContain("+15 dk")
    expect(markup).not.toContain("+30 dk")
    expect(markup).not.toContain("Özel")

    const actionsMarkup = renderToStaticMarkup(
      <MeetingLifecycleActions
        visitTypeName="Tedarikçi"
        meetingLabel="Tedarikçi"
        onExtend={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn().mockResolvedValue(undefined)}
        now={new Date("2026-09-04T10:00:00.000Z")}
      />,
    )
    expect(actionsMarkup).toBe("")
  })

  it("5. does not render 'Toplantıyı Bitir' button for non-time-bound rows", () => {
    const serviceMeeting: Meeting = { ...baseMeeting, visitTypeName: "Teknik Servis / Bakım" }
    const markup = renderToStaticMarkup(
      <HostedMeetingNotificationRow
        meeting={serviceMeeting}
        meetingVisits={[{ ...baseVisit, ...serviceMeeting }]}
        actorEmployeeId="host-1"
        now={new Date("2026-09-04T10:00:00.000Z")}
        scrollContainerRef={{ current: null }}
        isExpanded={true}
        onExpandedChange={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(markup).not.toContain("Toplantıyı Bitir")

    const actionsMarkup = renderToStaticMarkup(
      <MeetingLifecycleActions
        visitTypeName="Teknik Servis / Bakım"
        meetingLabel="Teknik Servis / Bakım"
        onExtend={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn().mockResolvedValue(undefined)}
        now={new Date("2026-09-04T10:00:00.000Z")}
      />,
    )
    expect(actionsMarkup).not.toContain("Toplantıyı Bitir")
  })

  it("6. does not render inline custom extension input for non-time-bound types", () => {
    const markup = renderToStaticMarkup(
      <MeetingLifecycleCustomExtension
        visitTypeName="Denetim"
        meetingLabel="Denetim"
        value="45"
        now={new Date("2026-09-04T10:00:00.000Z")}
        onChange={vi.fn()}
        onExtend={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(markup).toBe("")
    expect(markup).not.toContain("dk")
    expect(markup).not.toContain("Uzat")
    expect(markup).not.toContain("Vazgeç")
  })

  it("7. disables accordion expansion on non-time-bound rows", () => {
    const onExpandedChange = vi.fn()
    const supplierMeeting: Meeting = { ...baseMeeting, visitTypeName: "Tedarikçi" }
    const markup = renderToStaticMarkup(
      <HostedMeetingNotificationRow
        meeting={supplierMeeting}
        meetingVisits={[{ ...baseVisit, ...supplierMeeting }]}
        actorEmployeeId="host-1"
        now={new Date("2026-09-04T10:00:00.000Z")}
        scrollContainerRef={{ current: null }}
        isExpanded={false}
        onExpandedChange={onExpandedChange}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    // Row remains informative
    expect(markup).toContain("Ali Demir")
    expect(markup).toContain("Tedarikçi")
    expect(markup).toContain("Çıkış")
    // Accordion is disabled: no aria-expanded attribute and no aria-controls
    expect(markup).not.toContain('aria-expanded="true"')
    expect(markup).not.toContain('aria-expanded="false"')
    expect(markup).not.toContain("aria-controls")
    // Actions container is never rendered
    expect(markup).not.toContain("hosted-meeting-actions-")
  })

  it("8. preserves all actions and accordion expansion for time-bound rows (regression protection)", () => {
    const meetingRowMarkup = renderToStaticMarkup(
      <HostedMeetingNotificationRow
        meeting={{ ...baseMeeting, visitTypeName: "Toplantı" }}
        meetingVisits={[{ ...baseVisit, visitTypeName: "Toplantı" }]}
        actorEmployeeId="host-1"
        now={new Date("2026-09-04T10:00:00.000Z")}
        scrollContainerRef={{ current: null }}
        isExpanded={true}
        onExpandedChange={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(meetingRowMarkup).toContain('aria-expanded="true"')
    expect(meetingRowMarkup).toContain('aria-controls="hosted-meeting-actions-meeting-1"')
    expect(meetingRowMarkup).toContain("+15 dk")
    expect(meetingRowMarkup).toContain("+30 dk")
    expect(meetingRowMarkup).toContain("Özel")
    expect(meetingRowMarkup).toContain("Toplantıyı Bitir")

    const interviewRowMarkup = renderToStaticMarkup(
      <HostedMeetingNotificationRow
        meeting={{ ...baseMeeting, visitTypeName: "İş Görüşmesi" }}
        meetingVisits={[{ ...baseVisit, visitTypeName: "İş Görüşmesi" }]}
        actorEmployeeId="host-1"
        now={new Date("2026-09-04T10:00:00.000Z")}
        scrollContainerRef={{ current: null }}
        isExpanded={true}
        onExpandedChange={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(interviewRowMarkup).toContain("+15 dk")
    expect(interviewRowMarkup).toContain("Toplantıyı Bitir")
  })

  it("9. displays section heading as 'SÜRESİ AŞILANLAR' and removes 'GECİKMİŞ TOPLANTILAR' completely", () => {
    vi.mocked(useVisits).mockReturnValue({
      meetings: [baseMeeting],
      visits: [baseVisit],
      referenceData: { currentEmployee: { employeeId: "host-1" } },
      reload: vi.fn(),
    } as never)

    const markup = renderToStaticMarkup(<HostedMeetingEndNotifications isEmployeeView />)
    expect(markup).toContain("Süresi aşılanlar")
    expect(markup.toLocaleLowerCase("tr-TR")).not.toContain("gecikmiş toplantılar")

    const notificationSource = readFileSync(new URL("./HostedMeetingEndNotifications.tsx", import.meta.url), "utf8")
    expect(notificationSource).not.toContain("Gecikmiş toplantılar")
    expect(notificationSource).not.toContain("GECİKMİŞ TOPLANTILAR")
    expect(notificationSource).not.toContain("gecikmiş toplantılar")
  })

  it("10. delegates visit-type distinction to isTimeBoundVisitType and does not embed a visit-type list in the overlay component", () => {
    const notificationSource = readFileSync(new URL("./HostedMeetingEndNotifications.tsx", import.meta.url), "utf8")
    expect(notificationSource).toContain("isTimeBoundVisitType(meeting.visitTypeName)")
    // Ensure no hardcoded type list is embedded inside the overlay component
    expect(notificationSource).not.toContain("TIME_BOUND_VISIT_TYPE_NAMES")
    expect(notificationSource).not.toContain('"Toplantı"')
    expect(notificationSource).not.toContain('"Tedarikçi"')
    expect(notificationSource).not.toContain('"Denetim"')
    expect(notificationSource).not.toContain('"Teknik Servis')
    expect(notificationSource).not.toContain('"İş Görüşmesi"')
  })

  it("11. applies hover highlight line only when row is closed, not when open", () => {
    const props = {
      meeting: { ...baseMeeting, visitTypeName: "Toplantı" },
      meetingVisits: [{ ...baseVisit, visitTypeName: "Toplantı" }],
      actorEmployeeId: "host-1",
      now: new Date("2026-09-04T10:00:00.000Z"),
      scrollContainerRef: { current: null },
      onExpandedChange: vi.fn(),
      onChanged: vi.fn().mockResolvedValue(undefined),
    }
    const closedMarkup = renderToStaticMarkup(<HostedMeetingNotificationRow {...props} isExpanded={false} />)
    const openMarkup = renderToStaticMarkup(<HostedMeetingNotificationRow {...props} isExpanded={true} />)

    expect(closedMarkup).toContain("hover:shadow-[inset_3px_0_0_hsl(var(--primary))]")
    expect(openMarkup).not.toContain("hover:shadow-[inset_3px_0_0_hsl(var(--primary))]")

    // Non-time-bound rows do NOT get hover highlight line
    const supplierMarkup = renderToStaticMarkup(
      <HostedMeetingNotificationRow {...props} meeting={{ ...baseMeeting, visitTypeName: "Tedarikçi" }} isExpanded={false} />,
    )
    expect(supplierMarkup).not.toContain("hover:shadow-[inset_3px_0_0_hsl(var(--primary))]")
  })

  it("12. leaves the DAVETLER section unaffected by visit type distinctions (regression protection)", () => {
    const invitationVisits: Visit[] = [
      { ...baseVisit, id: "inv-1", creatorEmployeeId: "host-1", visitTypeName: "Toplantı", invitationStatus: "NOT_SENT", status: "PLANNED" },
      { ...baseVisit, id: "inv-2", creatorEmployeeId: "host-1", visitTypeName: "Tedarikçi", invitationStatus: "FAILED", status: "PLANNED" },
      { ...baseVisit, id: "inv-3", creatorEmployeeId: "host-1", visitTypeName: "Denetim", invitationStatus: "NOT_SENT", status: "PLANNED" },
    ]
    vi.mocked(useVisits).mockReturnValue({
      meetings: [],
      visits: invitationVisits,
      referenceData: { currentEmployee: { employeeId: "host-1" } },
      reload: vi.fn(),
    } as never)

    const markup = renderToStaticMarkup(<HostedMeetingEndNotifications isEmployeeView />)
    expect(markup).toContain("Davetler")
    expect(markup).toContain("3")
    expect(markup).toContain("Tedarikçi")
    expect(markup).toContain("Denetim")
    expect(markup).toContain("Toplantı")
    expect(markup).toContain("Gönderilmedi")
    expect(markup).toContain("Gönderim başarısız")
    expect(markup).toContain("Daveti gönder")
    expect(markup).toContain("Yeniden gönder")
  })

  it("13. renders untimed rows via UntimedMeetingNotificationRow without hover accent, button, or chevron", () => {
    const markup = renderToStaticMarkup(
      <UntimedMeetingNotificationRow
        meeting={{ ...baseMeeting, visitTypeName: "Teknik Servis / Bakım" }}
        meetingVisits={[{ ...baseVisit, visitTypeName: "Teknik Servis / Bakım" }]}
        now={new Date("2026-09-04T10:00:00.000Z")}
      />,
    )
    expect(markup).toContain("Teknik Servis / Bakım")
    expect(markup).not.toContain("hover:shadow")
    expect(markup).not.toContain("<button")
    expect(markup).not.toContain("lucide-chevron-right")
  })
})
