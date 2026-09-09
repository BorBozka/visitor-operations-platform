import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const componentSource = readFileSync(
  resolve(process.cwd(), "src/features/resources/MeetingResourcePanel.tsx"),
  "utf8",
)

describe("MeetingResourcePanel empty states", () => {
  it("uses compact inline empty rows instead of dashed empty-state cards", () => {
    expect(componentSource).toContain("Oda atanmamış.")
    expect(componentSource).toContain("Ekipman atanmamış.")
    expect(componentSource).toContain("Oda ata")
    expect(componentSource).toContain("Ekipman ekle")
    expect(componentSource).not.toContain("border-dashed bg-slate-50/40 p-3")
  })

  it("keeps the assignment footer outside the scrollable picker content", () => {
    expect(componentSource).toContain('className="flex min-h-0 flex-1 flex-col"')
    expect(componentSource).toContain('className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"')
    expect(componentSource).toContain('className="shrink-0 border-t bg-white px-5 py-3"')
    expect(componentSource).not.toContain("Kullanılabilir: {maxQty} adet")
  })

  it("keeps showing an assignment whose catalog resource was deleted without re-submitting it", () => {
    // resourceId is null for such an assignment, so list keys and draft edits go through draftKey
    // and draftToDesired drops it instead of sending a null resource id back to the API.
    expect(componentSource).toContain("resourceId: string | null")
    expect(componentSource).toContain("draftKey: `persisted-${a.id}`")
    expect(componentSource).toContain("draftKey: `saved-${v.id}`")
    expect(componentSource).toContain("equipment: draft.equipment.flatMap((e) => e.resourceId === null ? [] : [{")
    expect(componentSource).toContain("editingDraftKey === item.draftKey")
    expect(componentSource).not.toContain("editingResourceId")
  })

  it("shares the closed-or-terminal read-only predicate and reports only persisted assignments", () => {
    expect(componentSource).toContain("isMeetingResourceReadOnly(meeting, visits)")
    expect(componentSource).toContain("(persistedDraft.room ? 1 : 0) + persistedDraft.equipment.length")
    expect(componentSource).toContain("}, [persistedDraft])")
  })
})
