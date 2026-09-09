import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(process.cwd(), "src/features/admin/SystemSettingsPage.tsx"), "utf8")
const mainSource = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8")

describe("System settings workspace patterns", () => {
  it("uses a selectable rules master/detail workspace rather than native disclosure rows", () => {
    expect(source).toContain("Kural versiyonları")
    expect(source).toContain("Ziyaretçi kuralı detayı")
    expect(source).toContain("overflow-y-auto p-4 scrollbar-thin")
    expect(source).not.toContain("<details")
    expect(source).not.toContain("<summary")
  })

  it("guards unsaved operational settings while preserving tab changes", () => {
    expect(source).toContain("useBlocker")
    expect(source).toContain("useBeforeUnload")
    expect(source).toContain("shouldBlockSystemSettingsNavigation")
    expect(source).toContain('blocker.state !== "blocked"')
    expect(source).toContain("blocker.proceed()")
    expect(source).toContain("blocker.reset()")
    expect(source).not.toContain('document.addEventListener("click"')
    expect(source).toContain('setSystemSettingsTab(searchParams, nextTab)')
    expect(mainSource).toContain("createBrowserRouter")
    expect(mainSource).toContain("<RouterProvider router={router} />")
    expect(mainSource).not.toContain("<BrowserRouter>")
  })

  it("keeps visitor usage detail beside status instead of a mostly empty column", () => {
    expect(source).toContain("Durum ve kullanım bilgisi")
    expect(source).toContain("item.assignedVisitorName &&")
    expect(source).not.toContain("Kullanım bilgisi</th>")
  })

  it("offers a permanent visitor-card delete behind the project's destructive confirmation dialog", () => {
    // The row action is offered exactly where the card is Admin-managed (AVAILABLE / DISABLED);
    // the backend stays authoritative and its 409 message is surfaced in the dialog.
    expect(source).toContain("Kartı kalıcı olarak sil")
    expect(source).toContain("<DeleteCardDialog")
    expect(source).toContain("Ziyaretçi Kartını Sil")
    expect(source).toContain("Kalıcı olarak sil")
    expect(source).toContain("Geçmiş ziyaret kayıtları ve üzerlerinde görünen kart numarası korunur.")
    expect(source).toContain("deleteVisitorCard")
    expect(source).toContain('variant="destructive"')
    expect(source).toContain('role="alert"')
  })

  it("draws a bottom border below the final visit type and visitor card rows", () => {
    expect(source.match(/<tbody className="divide-y border-b">/g)).toHaveLength(2)
  })
})
