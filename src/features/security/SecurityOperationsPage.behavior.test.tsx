// @vitest-environment happy-dom
//
// Behavioural cover for the secondary "unreturned visitor card" loader on `SecurityOperationsPage`:
// a settled rejection must not look like the real "no unreturned cards" result, which a source-string
// contract test cannot check. Mounts the real page with `react-dom/client` and a stubbed
// `SecurityService` (same exception as `demo-login.test.tsx`).
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { VisitReferenceData } from "@/domain/visits"
import { SecurityOperationsPage } from "@/features/security/SecurityOperationsPage"
import { useVisits } from "@/features/visits/visit-context"
import { securityService } from "@/services"
import type { SecurityCardIssue } from "@/services/security-service"

vi.mock("@/services", () => ({
  securityService: {
    getUnreturnedVisitorCardIssues: vi.fn(),
    receiveReturnedVisitorCard: vi.fn(),
    getAvailableVisitorCards: vi.fn(),
    getActiveVisitorRule: vi.fn(),
    checkInVisit: vi.fn(),
    checkOutVisit: vi.fn(),
    createAndCheckInUnplannedVisit: vi.fn(),
    correctVisitor: vi.fn(),
  },
}))

vi.mock("@/features/visits/visit-context", () => ({ useVisits: vi.fn() }))

const getUnreturnedVisitorCardIssues = vi.mocked(securityService.getUnreturnedVisitorCardIssues)

const REFERENCE_DATA = {
  companies: [{ id: "c1", name: "BPLAS" }],
  facilities: [{ id: "f1", companyId: "c1", name: "Merkez" }],
  employees: [],
  visitTypes: [],
  currentEmployee: { employeeId: "e1", companyId: "c1", facilityId: "f1", role: "SECURITY" },
} as unknown as VisitReferenceData

const ISSUE = {
  card: { id: "card-1", cardNumber: "K-001", status: "NOT_RETURNED" },
  visit: { id: "v1", hostCompanyId: "c1", facilityId: "f1", visitor: { firstName: "Ayşe", lastName: "Yılmaz" } },
} as unknown as SecurityCardIssue

let container: HTMLDivElement
let root: Root
let reload: ReturnType<typeof vi.fn>

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  reload = vi.fn()
  vi.mocked(useVisits).mockReturnValue({
    visits: [],
    referenceData: REFERENCE_DATA,
    isLoading: false,
    error: null,
    reload,
  } as never)
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

const mount = () => render(<SecurityOperationsPage />)

const text = () => document.body.textContent ?? ""
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent).join(" ")
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)
const retryButton = () => button("Tekrar dene")
const cardIssuesButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("İade bekleyen kartlar"))

describe("SecurityOperationsPage unreturned-card issues loader", () => {
  it("shows the secondary loading state while the request is pending", async () => {
    getUnreturnedVisitorCardIssues.mockReturnValue(new Promise(() => {}))
    await mount()

    expect(text()).toContain("İade bilgileri yükleniyor…")
    expect(alertText()).toBe("")
    expect(cardIssuesButton()).toBeUndefined()
  })

  it("renders the pending-returns action on a successful non-empty load", async () => {
    getUnreturnedVisitorCardIssues.mockResolvedValue([ISSUE])
    await mount()

    expect(cardIssuesButton()?.textContent).toContain("İade bekleyen kartlar · 1")
    expect(text()).not.toContain("İade bilgileri yükleniyor…")
    expect(alertText()).toBe("")
  })

  it("keeps the plain empty state for a successful empty load", async () => {
    getUnreturnedVisitorCardIssues.mockResolvedValue([])
    await mount()

    expect(cardIssuesButton()).toBeUndefined()
    expect(retryButton()).toBeUndefined()
    expect(alertText()).toBe("")
  })

  it("does not present a rejected load as an empty result", async () => {
    getUnreturnedVisitorCardIssues.mockRejectedValue(new Error("İade edilmemiş kart bilgileri alınamadı."))
    await mount()

    expect(cardIssuesButton()).toBeUndefined()
    expect(text()).not.toContain("İade bilgileri yükleniyor…")
    // The failure is visible rather than silent.
    expect(alertText()).not.toBe("")
    expect(retryButton()).toBeDefined()
  })

  it("surfaces a safe error message and a retry action when the load rejects", async () => {
    getUnreturnedVisitorCardIssues.mockRejectedValue(new Error("İade edilmemiş kart bilgileri alınamadı."))
    await mount()

    expect(alertText()).toContain("İade edilmemiş kart bilgileri alınamadı.")
    expect(retryButton()).toBeDefined()
  })

  it("falls back to a generic Turkish message for a non-Error rejection", async () => {
    getUnreturnedVisitorCardIssues.mockRejectedValue("boom")
    await mount()

    expect(alertText()).toContain("İade edilmemiş kart bilgileri yüklenemedi. Lütfen tekrar deneyin.")
  })

  it("re-requests only the card issues from the service when retry is pressed", async () => {
    getUnreturnedVisitorCardIssues.mockRejectedValue(new Error("İade edilmemiş kart bilgileri alınamadı."))
    await mount()
    expect(getUnreturnedVisitorCardIssues).toHaveBeenCalledTimes(1)

    await act(async () => { retryButton()!.click() })

    expect(getUnreturnedVisitorCardIssues).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it("renders the issues and clears the error when a retry succeeds", async () => {
    getUnreturnedVisitorCardIssues
      .mockRejectedValueOnce(new Error("İade edilmemiş kart bilgileri alınamadı."))
      .mockResolvedValue([ISSUE])
    await mount()

    await act(async () => { retryButton()!.click() })

    expect(alertText()).toBe("")
    expect(retryButton()).toBeUndefined()
    expect(cardIssuesButton()?.textContent).toContain("İade bekleyen kartlar · 1")
  })

  it("keeps the primary visit panels rendering when the secondary loader fails", async () => {
    getUnreturnedVisitorCardIssues.mockRejectedValue(new Error("İade edilmemiş kart bilgileri alınamadı."))
    await mount()

    expect(text()).toContain("Beklenenler")
    expect(text()).toContain("İçeride")
    expect(text()).toContain("Bugün beklenen ziyaret yok.")
    expect(text()).toContain("İçeride ziyaretçi yok.")
  })

  it("leaves the primary search and unplanned-visit action enabled after a secondary failure", async () => {
    getUnreturnedVisitorCardIssues.mockRejectedValue(new Error("İade edilmemiş kart bilgileri alınamadı."))
    await mount()

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')
    expect(search).not.toBeNull()
    expect(search!.disabled).toBe(false)
    expect(button("+ Plansız ziyaret")?.disabled).toBe(false)
  })
})
