// @vitest-environment happy-dom
//
// Behavioural cover for the initial goods-movement list load: a rejected fetch must not be
// indistinguishable from an empty result, which a source-string contract test cannot check. Mounts
// the real page with `react-dom/client` and a stubbed `GoodsMovementService`.
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { GoodsMovement } from "@/domain/goods-movements"
import type { VisitReferenceData } from "@/domain/visits"
import { GoodsMovementsPage } from "@/features/goods/GoodsMovementsPage"
import { useVisits } from "@/features/visits/visit-context"
import { goodsMovementService } from "@/services"

vi.mock("@/services", () => ({
  goodsMovementService: {
    listGoodsMovements: vi.fn(),
    cancelGoodsMovement: vi.fn(),
    createGoodsMovement: vi.fn(),
    updateGoodsMovement: vi.fn(),
  },
}))

vi.mock("@/features/visits/visit-context", () => ({ useVisits: vi.fn() }))

const listGoodsMovements = vi.mocked(goodsMovementService.listGoodsMovements)

const REFERENCE_DATA = {
  companies: [{ id: "c1", name: "BPLAS" }],
  facilities: [{ id: "f1", companyId: "c1", name: "Merkez" }],
  employees: [],
  visitTypes: [],
  currentEmployee: { employeeId: "e1", companyId: "c1", facilityId: "f1", role: "MANAGER" },
} as unknown as VisitReferenceData

const MOVEMENT: GoodsMovement = {
  id: "gm-1",
  direction: "INBOUND",
  companyId: "c1",
  companyName: "BPLAS",
  facilityId: "f1",
  facilityName: "Merkez",
  counterpartyName: "Tedarik A.Ş.",
  plannedDate: "2026-09-10",
  plannedTime: "10:00",
  goodsDescription: "Kalıp parçası",
  status: "PLANNED",
  createdAt: "2026-09-01T08:00:00+03:00",
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.mocked(useVisits).mockReturnValue({ referenceData: REFERENCE_DATA, isLoading: false } as never)
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

const mount = () => render(<GoodsMovementsPage />)

const text = () => container.textContent ?? ""
const dataRows = () => [...container.querySelectorAll("tbody tr")].filter((row) => !row.hasAttribute("aria-hidden"))
const retryButton = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "Tekrar dene")
const alertText = () => [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent).join(" ")

describe("GoodsMovementsPage initial list load", () => {
  it("renders the loaded records on a successful non-empty load", async () => {
    listGoodsMovements.mockResolvedValue([MOVEMENT])
    await mount()

    expect(text()).toContain("Tedarik A.Ş.")
    expect(text()).toContain("Kalıp parçası")
    expect(text()).not.toContain("Bu filtreler için kayıt yok.")
    expect(alertText()).toBe("")
  })

  it("shows the loading state instead of an empty result while the list request is pending", async () => {
    listGoodsMovements.mockReturnValue(new Promise(() => {}))
    await mount()

    expect(text()).toContain("Mal hareketleri yükleniyor…")
    expect(text()).not.toContain("Bu filtreler için kayıt yok.")
  })

  it("keeps the real empty state for a successful empty load", async () => {
    listGoodsMovements.mockResolvedValue([])
    await mount()

    expect(text()).toContain("Bu filtreler için kayıt yok.")
    expect(retryButton()).toBeUndefined()
    expect(alertText()).toBe("")
  })

  it("does not present a rejected load as an empty result", async () => {
    listGoodsMovements.mockRejectedValue(new Error("Mal hareketleri alınamadı."))
    await mount()

    expect(text()).not.toContain("Bu filtreler için kayıt yok.")
    expect(text()).not.toContain("Mal hareketleri yükleniyor…")
    expect(dataRows()).toHaveLength(1)
  })

  it("shows the failure and a retry affordance when the load rejects", async () => {
    listGoodsMovements.mockRejectedValue(new Error("Mal hareketleri alınamadı."))
    await mount()

    expect(alertText()).toContain("Mal hareketleri alınamadı.")
    expect(retryButton()).toBeDefined()
  })

  it("falls back to a safe Turkish message for a non-Error rejection", async () => {
    listGoodsMovements.mockRejectedValue("boom")
    await mount()

    expect(alertText()).toContain("Mal hareketleri yüklenemedi. Lütfen tekrar deneyin.")
  })

  it("re-requests the list from the service when retry is pressed", async () => {
    listGoodsMovements.mockRejectedValue(new Error("Mal hareketleri alınamadı."))
    await mount()
    expect(listGoodsMovements).toHaveBeenCalledTimes(1)

    await act(async () => { retryButton()!.click() })

    expect(listGoodsMovements).toHaveBeenCalledTimes(2)
  })

  it("shows the data and clears the error when a retry succeeds", async () => {
    listGoodsMovements.mockRejectedValueOnce(new Error("Mal hareketleri alınamadı.")).mockResolvedValue([MOVEMENT])
    await mount()

    await act(async () => { retryButton()!.click() })

    expect(alertText()).toBe("")
    expect(retryButton()).toBeUndefined()
    expect(text()).toContain("Tedarik A.Ş.")
  })

  it("still reports a failed cancellation through the mutation alert", async () => {
    listGoodsMovements.mockResolvedValue([MOVEMENT])
    vi.mocked(goodsMovementService.cancelGoodsMovement).mockRejectedValue(new Error("Kayıt iptal edilemedi."))
    await mount()

    await act(async () => { dataRows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    const cancelButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "İptal")!
    await act(async () => { cancelButton.click() })

    expect(alertText()).toContain("Kayıt iptal edilemedi.")
    expect(text()).toContain("Tedarik A.Ş.")
  })
})
