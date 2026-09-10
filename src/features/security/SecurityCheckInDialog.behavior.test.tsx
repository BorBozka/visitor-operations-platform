// @vitest-environment happy-dom
//
// Behavioural cover for the visitor-card load in `SecurityCheckInDialog`: a source-string contract
// test cannot tell a settled rejection from a hung promise, so this file mounts the real dialog with
// `react-dom/client` and a stubbed `SecurityService` (same exception as `demo-login.test.tsx`).
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { VisitorCardInventoryItem } from "@/domain/admin"
import type { Visit } from "@/domain/visits"
import { SecurityCheckInDialog } from "@/features/security/SecurityCheckInDialog"
import { securityService } from "@/services"

vi.mock("@/services", () => ({
  securityService: {
    getAvailableVisitorCards: vi.fn(),
    checkInVisit: vi.fn(),
    updateVisitorDetails: vi.fn(),
  },
}))

vi.mock("@/features/visits/visit-context", () => ({ useVisits: () => ({ referenceData: null, reload: vi.fn() }) }))

const getAvailableVisitorCards = vi.mocked(securityService.getAvailableVisitorCards)

const CARDS: VisitorCardInventoryItem[] = [
  { id: "card-1", cardNumber: "K-001", status: "AVAILABLE" },
  { id: "card-2", cardNumber: "K-002", status: "AVAILABLE" },
]

const VISIT = {
  id: "visit-1",
  meetingId: "meeting-1",
  visitor: { firstName: "Ayşe", lastName: "Yılmaz", company: "Tedarik A.Ş." },
  hostEmployeeName: "Mehmet Demir",
  visitTypeName: "İş görüşmesi",
  plannedStart: "2026-09-10T09:00:00+03:00",
  status: "PLANNED",
} as unknown as Visit

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

function mount() {
  return render(<SecurityCheckInDialog visit={VISIT} open onOpenChange={() => {}} onCheckedIn={() => {}} />)
}

// Radix portals the dialog content out of `container`, so assertions read the whole document.
const text = () => document.body.textContent ?? ""
const cardSelect = () => document.querySelector<HTMLSelectElement>("#security-checkin-card")
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)
const submitButton = () => button("Giriş yap")!
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent).join(" ")
const plateInput = () => document.querySelector<HTMLInputElement>("#security-checkin-plate")!

// React tracks the last value it wrote, so a plain assignment is treated as a no-op change; go
// through the prototype setter the way React's own event plumbing expects.
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("SecurityCheckInDialog visitor-card loading", () => {
  it("renders the loaded cards on success", async () => {
    getAvailableVisitorCards.mockResolvedValue(CARDS)
    await mount()

    expect(cardSelect()).not.toBeNull()
    expect([...cardSelect()!.options].map((option) => option.textContent)).toEqual(["Kart seçin", "K-001", "K-002"])
    expect(text()).not.toContain("Kartlar yükleniyor…")
    expect(alertText()).toBe("")
  })

  it("shows the loading state while the card request is pending", async () => {
    getAvailableVisitorCards.mockReturnValue(new Promise(() => {}))
    await mount()

    expect(text()).toContain("Kartlar yükleniyor…")
    expect(cardSelect()).toBeNull()
    expect(submitButton().disabled).toBe(true)
  })

  it("ends the loading state when the card request rejects", async () => {
    getAvailableVisitorCards.mockRejectedValue(new Error("Ziyaretçi kartları alınamadı."))
    await mount()

    expect(text()).not.toContain("Kartlar yükleniyor…")
  })

  it("surfaces the failure instead of the no-cards empty state", async () => {
    getAvailableVisitorCards.mockRejectedValue(new Error("Ziyaretçi kartları alınamadı."))
    await mount()

    expect(alertText()).toContain("Ziyaretçi kartları alınamadı.")
    expect(text()).not.toContain("Şu anda uygun ziyaretçi kartı yok.")
  })

  it("keeps the session message of an unauthorized failure rather than a generic load error", async () => {
    getAvailableVisitorCards.mockRejectedValue(new Error("Oturum gerekli."))
    await mount()

    expect(alertText()).toContain("Oturum gerekli.")
    expect(alertText()).not.toContain("Ziyaretçi kartları yüklenemedi.")
  })

  it("falls back to a safe Turkish message for a non-Error rejection", async () => {
    getAvailableVisitorCards.mockRejectedValue("boom")
    await mount()

    expect(alertText()).toContain("Ziyaretçi kartları yüklenemedi. Lütfen tekrar deneyin.")
  })

  it("leaves submit disabled after a failed card load", async () => {
    getAvailableVisitorCards.mockRejectedValue(new Error("Ziyaretçi kartları alınamadı."))
    await mount()

    expect(submitButton().disabled).toBe(true)
  })

  it("re-requests the cards from the service when retry is pressed", async () => {
    getAvailableVisitorCards.mockRejectedValue(new Error("Ziyaretçi kartları alınamadı."))
    await mount()
    expect(getAvailableVisitorCards).toHaveBeenCalledTimes(1)

    await act(async () => { button("Tekrar dene")!.click() })

    expect(getAvailableVisitorCards).toHaveBeenCalledTimes(2)
  })

  it("renders the cards and clears the error when a retry succeeds, without reopening the dialog", async () => {
    getAvailableVisitorCards.mockRejectedValueOnce(new Error("Ziyaretçi kartları alınamadı.")).mockResolvedValue(CARDS)
    await mount()

    await act(async () => { type(plateInput(), "34ABC01") })
    expect(plateInput().value).toBe("34ABC01")

    await act(async () => { button("Tekrar dene")!.click() })

    expect(alertText()).toBe("")
    expect(button("Tekrar dene")).toBeUndefined()
    expect([...cardSelect()!.options].map((option) => option.textContent)).toEqual(["Kart seçin", "K-001", "K-002"])
    // The retry reloads only the card list; typed input survives.
    expect(plateInput().value).toBe("34ABC01")
  })
})
