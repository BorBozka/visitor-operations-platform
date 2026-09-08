import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { getRoleHomeRoute } from "@/features/auth/auth-routes"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")
const appSource = read("src/app/App.tsx")
const loginSource = read("src/features/auth/LoginPage.tsx")
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
    expect(loginSource).toContain('"Kullanıcı adı veya şifre hatalı."')
    expect(loginSource).toContain('type={showPassword ? "text" : "password"}')
    expect(loginSource).not.toContain("import.meta.env.DEV")
    expect(loginSource).not.toContain("Demo hesapları")
    expect(loginSource).not.toContain("demoAccounts")
  })

  it("uses the current authentication session for account-menu logout", () => {
    expect(menuSource).toContain("useAuth")
    expect(menuSource).toContain("await logout()")
    expect(menuSource).toContain('navigate("/login", { replace: true })')
  })
})
