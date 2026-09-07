import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const dialogSource = readFileSync(resolve(process.cwd(), "src/features/visits/VisitFormDialog.tsx"), "utf8")
const timelineSource = readFileSync(resolve(process.cwd(), "src/features/visits/VisitTimeline.tsx"), "utf8")

describe("VisitFormDialog invitation action", () => {
  it("only offers the send button once the visit exists and has pending invitations", () => {
    expect(dialogSource).toContain("{savedMeetingId && hasPendingInvitation && (")
    // Two competing primary actions before the first save made the correct one ambiguous.
    const beforeFooter = dialogSource.indexOf("{savedMeetingId && hasPendingInvitation && (")
    expect(dialogSource.indexOf("Daveti Gönder")).toBeLessThan(beforeFooter)
  })

  it("hides the send invitation button when there are no pending invitations", () => {
    expect(dialogSource).toContain("{savedMeetingId && hasPendingInvitation && (")
    expect(dialogSource).not.toContain("{savedMeetingId && (\n")
  })

  it("keeps the explanation of why sending is not possible yet", () => {
    expect(dialogSource).toContain("Davet göndermek için önce ziyareti kaydedin.")
  })

  it("states what the dialog does, in one sentence per mode", () => {
    expect(dialogSource).toContain("Tesise gelecek ziyaretçiler için ziyaret kaydı oluşturun.")
    expect(dialogSource).toContain("Bu ziyaretin bilgilerini güncelleyin.")
  })

  it("leaves the header on the shared dialog typography instead of restyling it", () => {
    expect(dialogSource).toContain("<DialogDescription>")
    expect(dialogSource).not.toContain("<DialogDescription className")
    // text-lg here made this the only oversized dialog title in the app.
    expect(dialogSource).toContain("<DialogTitle>{visit ?")
    expect(dialogSource).not.toContain("<DialogTitle className")
  })

  it("gives the form room to breathe instead of a short scrolling modal", () => {
    expect(dialogSource).toContain("!max-h-[85vh]")
  })
})

describe("VisitFormDialog optional notes", () => {
  it("gates both notes behind a checkbox so they read as the same kind of field", () => {
    expect(dialogSource.match(/<OptionalNote/g) ?? []).toHaveLength(2)
    expect(dialogSource).toContain('label="İlave gereksinim var"')
    expect(dialogSource).toContain('label="Güvenlik notu var"')
  })

  it("names the audience for each note, which is the only thing that tells them apart", () => {
    expect(dialogSource).toContain("İnsan kaynakları ve bilgi işleme iletilir")
    expect(dialogSource).toContain("Güvenlik görevlisi giriş anında görür")
  })

  it("brings the revealed field into view and focuses it, only when the user opens it", () => {
    expect(dialogSource).toContain("if (expanded && !wasExpanded.current) {")
    expect(dialogSource).toContain("field?.focus({ preventScroll: true })")
    expect(dialogSource).toContain('block: "nearest",')
    expect(dialogSource).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"')
  })

  it("passes the open state to both toggles so the reveal can react to it", () => {
    expect(dialogSource).toContain("expanded={hasAdditionalRequirements}")
    expect(dialogSource).toContain("expanded={noteEnabled}")
  })

  it("keeps the note toggle in component state rather than widening the meeting contract", () => {
    expect(dialogSource).toContain("const [noteEnabled, setNoteEnabled] = useState(Boolean(visit?.note))")
    expect(dialogSource).toContain('form.setValue("note", "", { shouldDirty: true })')
  })

  it("opens the toggle for a visit that already carries a note", () => {
    expect(dialogSource).toContain("setNoteEnabled(Boolean(visit?.note))")
    expect(dialogSource).toContain("}, [form, open, visit?.meetingId, visit?.note])")
  })
})

describe("VisitTimeline current-time indicator", () => {
  it("keeps current-time lines behind visit blocks while the day badge remains visible", () => {
    expect(timelineSource).toContain("absolute inset-y-0 z-0 w-px bg-rose-500/80")
    expect(timelineSource).toContain("absolute inset-x-0 z-0 h-px bg-rose-500/90")
    expect(timelineSource).toContain("pointer-events-none absolute left-0 z-30")
    expect(timelineSource).not.toContain("absolute inset-y-0 z-30 w-px bg-rose-500/80")
    expect(timelineSource).not.toContain("absolute inset-x-0 z-30 h-px bg-rose-500/90")
  })

  it("puts the week marker in the time ruler and pulls it inside the lane at the extremes", () => {
    expect(timelineSource).toContain("<WeekCurrentTimeMarker left={nowOffset} />")
    expect(timelineSource).toContain('left < 4 ? "translate-x-0" : left > 96 ? "-translate-x-full" : "-translate-x-1/2"')
  })

  it("hides the week marker when the shown week is not the current one", () => {
    expect(timelineSource).toContain("nowOffset={weekContainsToday ? currentTimeOffset(now, timeRange) : null}")
  })
})

describe("VisitFormDialog save button", () => {
  it("labels the save button as Ziyareti Kaydet", () => {
    expect(dialogSource).toContain('"Ziyareti Kaydet"')
  })

  it("keeps the save button disabled until all required fields are valid", () => {
    expect(dialogSource).toContain("!form.formState.isValid")
  })
})

describe("VisitTimeline status indicators info panel", () => {
  it("places the status indicators in a dropdown info panel next to the navigation controls", () => {
    expect(timelineSource).toContain('aria-label="Durum göstergeleri"')
    expect(timelineSource).toContain("<Info")
    expect(timelineSource).not.toContain("border-t bg-slate-50/70 px-3 py-1.5")
  })
})
