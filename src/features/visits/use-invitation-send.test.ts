import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// Structural, not rendered: the classification below is a branch inside a hook, and this codebase
// tests that kind of decision by reading the source rather than adding a rendering dependency.
const hookSource = readFileSync(resolve(process.cwd(), "src/features/visits/use-invitation-send.ts"), "utf8")

describe("useInvitationSend result classification", () => {
  it("treats an exact SENT response as the only success", () => {
    expect(hookSource).toContain('result.invitationStatus === "SENT"')
    expect(hookSource).toContain("setSentIds((current) => withId(current, visitId))")
  })

  it("treats an exact FAILED response as the failure", () => {
    expect(hookSource).toContain('result.invitationStatus === "FAILED"')
    expect(hookSource).toContain("setFailedIds((current) => withId(current, visitId))")
  })

  // NEW-16: a direct send that loses the backend's claim to a concurrent sender comes back
  // `SENDING` — the winner's in-flight attempt, not this request's outcome. The pre-fix hook took
  // every non-`FAILED` response as proof of delivery, which painted the row "Davet gönderildi"
  // for an email it never sent (and kept saying so even when the winner's attempt then failed).
  it("never falls through to the sent branch for a SENDING response", () => {
    expect(hookSource).not.toMatch(/invitationStatus === "FAILED"\)[\s\S]{0,200}\}\s*else\s*\{/)
    expect(hookSource).toMatch(/else if \(result\.invitationStatus === "SENT"\)/)
  })

  // With a `SENDING` response in neither set, the row falls back to the reloaded record, which is
  // what keeps a stale attempt showing its retry instead of a permanent success (NEW-9).
  it("leaves a SENDING response to the persisted-record fallback", () => {
    expect(hookSource).toContain('if ((visit.invitationStatus === "SENDING" && !visit.invitationSendStale) || sendingIds.has(visit.id)) return "SENDING"')
    expect(hookSource).toContain('return visit.invitationStatus === "SENDING" ? "FAILED" : visit.invitationStatus')
  })
})
