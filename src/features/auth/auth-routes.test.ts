import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { getRoleHomeRoute } from "@/features/auth/auth-routes"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")
const appSource = read("src/app/App.tsx")
const loginSource = read("src/features/auth/LoginPage.tsx")
const loginErrorSource = read("src/features/auth/login-error-messages.ts")
const guardSource = read("src/features/auth/RoleGuard.tsx")
const menuSource = read("src/components/account/AccountMenu.tsx")

describe("authentication routes", () => {
  it.each([
    ["EMPLOYEE", "/employee/my-visits"],
    ["MANAGER", "/manager/dashboard"],
    ["ADMIN", "/admin/dashboard"],
    ["SECURITY", "/security/operations"],
  ] as const)("maps %s to its canonical home", (role, path) => {
    expect(getRoleHomeRoute(role)).toBe(path)
  })

  it("uses shared guards instead of legacy manager-to-admin routing", () => {
    expect(appSource).toContain('<RoleGuard role="EMPLOYEE" />')
    expect(appSource).toContain('<RoleGuard role="MANAGER" />')
    expect(appSource).toContain('<RoleGuard role="ADMIN" />')
    expect(appSource).toContain('<RoleGuard role="SECURITY" />')
    expect(appSource).toContain('<ManagerShell role="MANAGER" />')
    expect(appSource).not.toContain("ManagerRouteRedirect")
    expect(appSource).not.toContain('path="/my-visits"')
    expect(appSource).toContain('<Route path="/" element={<RoleHomeRedirect />} />')
    expect(appSource).toContain('<Route path="*" element={<RoleHomeRedirect />} />')
  })

  it("sends unauthenticated users to login and redirects cross-role users home", () => {
    expect(guardSource).toContain('to="/login"')
    expect(guardSource).toContain("getRoleHomeRoute(currentUser.role)")
  })

  it("keeps required validation and password visibility without embedded accounts", () => {
    expect(loginSource).toContain('"Kullanıcı adı ve şifre zorunludur."')
    expect(loginErrorSource).toContain('"Kullanıcı adı veya şifre hatalı."')
    expect(loginErrorSource).toContain('"Sunucuya ulaşılamıyor. Bağlantınızı kontrol edip tekrar deneyin."')
    expect(loginErrorSource).toContain('"Çok fazla giriş denemesi yapıldı. Lütfen kısa bir süre sonra tekrar deneyin."')
    expect(loginErrorSource).toContain('"Sunucu tarafında geçici bir hata oluştu. Lütfen tekrar deneyin."')
    expect(loginSource).toContain('type={showPassword ? "text" : "password"}')
    // Demo shortcuts live behind the `VITE_DEMO_LOGIN` flag in `@/config/demo-login`, never
    // behind the dev-server check and never as credentials embedded in this component.
    expect(loginSource).not.toContain("import.meta.env.DEV")
    expect(loginSource).toContain("isDemoLoginEnabled(import.meta.env.VITE_DEMO_LOGIN)")
    expect(loginSource).toContain("demoLoginAccounts.map")
    expect(loginSource).not.toContain('password: "')
  })

  it("uses the current authentication session for account-menu logout", () => {
    expect(menuSource).toContain("useAuth")
    expect(menuSource).toContain("await logout()")
    expect(menuSource).toContain('navigate("/login", { replace: true })')
  })
})
