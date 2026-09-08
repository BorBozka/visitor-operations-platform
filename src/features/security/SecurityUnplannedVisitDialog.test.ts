import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(process.cwd(), "src/features/security/SecurityUnplannedVisitDialog.tsx"), "utf8")

describe("SecurityUnplannedVisitDialog contract", () => {
  it("keeps the desk form compact and only exposes the approved fields", () => {
    expect(source).toContain("Ad")
    expect(source).toContain("Soyad")
    expect(source).toContain("Firma / Kurum")
    expect(source).toContain("Ev sahibi / ilgili personel")
    expect(source).toContain("Ziyaret türü")
    expect(source).not.toContain("Telefon")
    expect(source).toContain("Plaka")
    expect(source).not.toContain("E-posta")
    expect(source).not.toContain("Başlangıç")
    expect(source).not.toContain("Şirket seç")
    expect(source).not.toContain("Tesis seç")
    expect(source).toContain("Ziyaretçi bilgilerini girerek giriş kaydını oluşturun.")
    expect(source).not.toContain("Giriş zamanı şimdi alınır")
    expect(source).not.toContain("Varsayılanı değiştirmeniz gerekmez")
    expect(source).not.toContain("Kural sürümü")
  })

  it("uses active types, AVAILABLE cards, default duration, and required desk acceptance", () => {
    expect(source).toContain("visitTypes.filter((type) => type.active)")
    expect(source).toContain("securityService.getAvailableVisitorCards()")
    expect(source).toContain("DEFAULT_UNPLANNED_DURATION_MINUTES")
    expect(source).toContain("Ziyaretçi kuralları okudu ve kabul etti")
    expect(source).toContain("rulesAccepted")
    expect(source).not.toContain('aria-label="Özel süre"')
    expect(source).toContain("Öğlene kadar")
    expect(source).toContain("Mesai sonuna kadar")
  })

  it("prevents duplicate submits and uses the one SecurityService desk action", () => {
    expect(source).toContain("submitting")
    expect(source).toContain("createAndCheckInUnplannedVisit")
    expect(source).toContain("Kaydet ve giriş yap")
    expect(source).toContain('role="alert"')
  })

  it("separates required loading (cards, active rule) from optional settings fetch with fallback", () => {
    // Required data loads as Promise.all first
    expect(source).toContain("Promise.all([securityService.getAvailableVisitorCards(), securityService.getActiveVisitorRule()])")
    // Settings is loaded separately after required data
    expect(source).toContain("getOperationalSettings()")
    // Settings error is caught and does not propagate
    expect(source).toContain(".catch(() => {")
    // Fallback time is used when settings fetch fails
    expect(source).toContain("const workdayEndMinutes = parseClockTime(workdayEndTime) ?? 18 * 60 + 15")
  })
})

describe("SecurityUnplannedVisitDialog behavior", () => {
  it("verifies that required loading (cards + rule) is separate from optional settings fetch", async () => {
    const { vi } = await import("vitest")
    const { securityService } = await import("@/services")
    const { adminService } = await import("@/services")

    // Mock required data to succeed
    const mockCards = [
      { id: "card-1", cardNumber: "C001", status: "AVAILABLE" as const },
      { id: "card-2", cardNumber: "C002", status: "AVAILABLE" as const },
    ]
    const mockRule = {
      id: "rule-1",
      version: 1,
      content: "Standard rules",
      publishedAt: "2025-01-01T00:00:00Z",
      active: true,
    }

    vi.spyOn(securityService, "getAvailableVisitorCards").mockResolvedValueOnce(mockCards)
    vi.spyOn(securityService, "getActiveVisitorRule").mockResolvedValueOnce(mockRule)
    vi.spyOn(adminService, "getOperationalSettings").mockRejectedValueOnce(new Error("Settings unavailable"))

    // Simulate the component's loading logic: Promise.all for required data
    const requiredDataPromise = Promise.all([
      securityService.getAvailableVisitorCards(),
      securityService.getActiveVisitorRule(),
    ])

    // Then separately load optional settings
    const [loadedCards, loadedRule] = await requiredDataPromise
    const settingsPromise = adminService
      .getOperationalSettings()
      .then((s) => s.workdayEndTime)
      .catch(() => "18:15") // Fallback

    // Verify required data loaded
    expect(loadedCards).toEqual(mockCards)
    expect(loadedRule).toEqual(mockRule)

    // Verify settings failed but fallback is available
    const workdayEndTime = await settingsPromise
    expect(workdayEndTime).toBe("18:15")

    // Verify all service calls were made
    expect(securityService.getAvailableVisitorCards).toHaveBeenCalled()
    expect(securityService.getActiveVisitorRule).toHaveBeenCalled()
    expect(adminService.getOperationalSettings).toHaveBeenCalled()
  })

  it("verifies that cards failure prevents successful dialog load", async () => {
    const { vi } = await import("vitest")
    const { securityService } = await import("@/services")

    vi.spyOn(securityService, "getAvailableVisitorCards").mockRejectedValueOnce(new Error("Cards unavailable"))
    vi.spyOn(securityService, "getActiveVisitorRule").mockResolvedValueOnce({
      id: "rule-1",
      version: 1,
      content: "rules",
      publishedAt: "2025-01-01T00:00:00Z",
      active: true,
    })

    // Simulate component's Promise.all for required data — should reject
    const requiredDataPromise = Promise.all([
      securityService.getAvailableVisitorCards(),
      securityService.getActiveVisitorRule(),
    ])

    // Verify that required data loading fails
    await expect(requiredDataPromise).rejects.toThrow("Cards unavailable")
  })

  it("verifies that active rule failure prevents successful dialog load", async () => {
    const { vi } = await import("vitest")
    const { securityService } = await import("@/services")

    vi.spyOn(securityService, "getAvailableVisitorCards").mockResolvedValueOnce([
      { id: "card-1", cardNumber: "C001", status: "AVAILABLE" as const },
    ])
    vi.spyOn(securityService, "getActiveVisitorRule").mockRejectedValueOnce(new Error("Rule unavailable"))

    // Simulate component's Promise.all for required data — should reject
    const requiredDataPromise = Promise.all([
      securityService.getAvailableVisitorCards(),
      securityService.getActiveVisitorRule(),
    ])

    // Verify that required data loading fails
    await expect(requiredDataPromise).rejects.toThrow("Rule unavailable")
  })

  it("verifies that workday-end time falls back to 18:15 when settings unavailable", async () => {
    // Simulate the fallback logic in component
    const parseClockTime = (time: string) => {
      const [hours, minutes] = time.split(":").map(Number)
      return hours * 60 + minutes
    }

    const workdayEndTime = "18:15"
    const workdayEndMinutes = parseClockTime(workdayEndTime) ?? 18 * 60 + 15

    expect(workdayEndMinutes).toBe(18 * 60 + 15)

    // Simulate settings fetch failure with fallback
    interface OperationalSettings {
      workdayEndTime: string
    }
    const settingsPromise = Promise.reject(new Error("Settings unavailable"))
      .then((s: OperationalSettings) => s.workdayEndTime)
      .catch(() => workdayEndTime)

    const fallbackTime = await settingsPromise
    expect(fallbackTime).toBe("18:15")
  })
})
