import { describe, expect, it } from "vitest"

import { createSessionGuard } from "@/lib/session-guard"

describe("createSessionGuard", () => {
  it("keeps the newest run current and invalidates the ones before it", () => {
    const guard = createSessionGuard()
    const first = guard.begin()
    expect(guard.isCurrent(first)).toBe(true)

    const second = guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it("exposes the current token without starting a run", () => {
    const guard = createSessionGuard()
    const session = guard.begin()

    // A follow-up fetch inside the same session may commit...
    expect(guard.current()).toBe(session)
    expect(guard.isCurrent(guard.current())).toBe(true)

    // ...but not once the next session started.
    const followUp = guard.current()
    guard.begin()
    expect(guard.isCurrent(followUp)).toBe(false)
  })
})
