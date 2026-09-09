// @vitest-environment happy-dom
//
// The demo shortcuts are React state wiring (fill the form, do not submit), so this file mounts the
// real `LoginPage` with `react-dom/client` and a fake `SessionService`, the same exception the
// provider tests make (see `provider-wiring.test.tsx`). No rendering library is involved.
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { demoLoginAccounts } from "@/config/demo-login"
import { AuthProvider } from "@/features/auth/auth-context"
import { LoginPage } from "@/features/auth/LoginPage"
import type { SessionService, SessionUser } from "@/services/session-service"

const ADMIN_SESSION: SessionUser = {
  id: "admin-1",
  username: "admin",
  fullName: "Demo Admin",
  initials: "DA",
  role: "ADMIN",
  roleLabel: "Admin",
  authenticationSource: "LOCAL",
}

function fakeSessionService(login: SessionService["login"]): SessionService {
  return {
    login,
    logout: () => Promise.resolve(),
    getCurrentSession: () => Promise.resolve(null),
    subscribe: () => () => {},
  }
}

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
  vi.unstubAllEnvs()
})

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

async function mountLoginPage(service: SessionService) {
  await render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider service={service}>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

const usernameInput = () => container.querySelector<HTMLInputElement>("#login-username")!
const passwordInput = () => container.querySelector<HTMLInputElement>("#login-password")!
const demoButtons = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    demoLoginAccounts.some((account) => account.label === button.textContent),
  )

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

describe("demo role shortcuts on the login screen", () => {
  it("renders no demo buttons when VITE_DEMO_LOGIN is not enabled", async () => {
    vi.stubEnv("VITE_DEMO_LOGIN", "")
    await mountLoginPage(fakeSessionService(() => Promise.resolve(ADMIN_SESSION)))

    expect(container.textContent).not.toContain("Demo hesapları")
    expect(demoButtons()).toHaveLength(0)
  })

  it("renders the four role buttons when VITE_DEMO_LOGIN=true", async () => {
    vi.stubEnv("VITE_DEMO_LOGIN", "true")
    await mountLoginPage(fakeSessionService(() => Promise.resolve(ADMIN_SESSION)))

    expect(container.textContent).toContain("Demo hesapları")
    expect(demoButtons().map((button) => button.textContent)).toEqual(["Admin", "Yönetici", "Çalışan", "Güvenlik"])
  })

  it.each(demoLoginAccounts.map((account) => [account.label, account.username, account.password] as const))(
    "fills the form with the %s credentials without logging in",
    async (label, username, password) => {
      vi.stubEnv("VITE_DEMO_LOGIN", "true")
      const login = vi.fn(() => Promise.resolve(ADMIN_SESSION))
      await mountLoginPage(fakeSessionService(login))

      await click(demoButtons().find((button) => button.textContent === label)!)

      expect(usernameInput().value).toBe(username)
      expect(passwordInput().value).toBe(password)
      expect(login).not.toHaveBeenCalled()
    },
  )

  it("logs in through the normal submit flow after a demo selection", async () => {
    vi.stubEnv("VITE_DEMO_LOGIN", "true")
    const login = vi.fn(() => Promise.resolve(ADMIN_SESSION))
    await mountLoginPage(fakeSessionService(login))

    await click(demoButtons()[0])
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(login).toHaveBeenCalledWith("admin", "admin")
  })
})
