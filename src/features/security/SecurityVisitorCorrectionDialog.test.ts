import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(process.cwd(), "src/features/security/SecurityVisitorCorrectionDialog.tsx"), "utf8")

describe("SecurityVisitorCorrectionDialog contract", () => {
  it("does not move focus to or select the visitor name when the correction dialog opens", () => {
    expect(source).toContain("onOpenAutoFocus={(event) => event.preventDefault()}")
    expect(source).not.toContain("<Input autoFocus")
  })

  it("keeps the correction dialog header compact", () => {
    expect(source).not.toContain("Kapıda tespit edilen yazım hatalarını düzeltin.")
    expect(source).not.toContain("DialogDescription")
  })

  it("drops the e-mail field and edits the host name as free text instead", () => {
    expect(source).not.toContain("E-posta")
    expect(source).not.toContain("isValidVisitorEmail")
    expect(source).not.toContain("draft.email")
    expect(source).toContain('label="Ev sahibi"')
    expect(source).toContain("hostEmployeeName: visit.hostEmployeeName")
    expect(source).not.toContain("visitTypeId")
    expect(source).not.toContain("<Select")
    expect(source).not.toContain("required")
  })

  it("disables Save when nothing changed and requires name, company and host", () => {
    expect(source).toContain("!dirty")
    expect(source).toContain("!firstName || !lastName || !company || !hostEmployeeName")
    expect(source).toContain("draft.hostEmployeeName !== initial.hostEmployeeName")
    expect(source).toContain("saveDisabled = invalid || !dirty || saving")
  })

  it("sends the host name without a meeting-level visit type or e-mail field", () => {
    expect(source).toContain("hostEmployeeName,")
    expect(source).not.toContain("visitTypeId")
    expect(source).not.toContain("email:")
  })

  it("only lets Security correct an existing phone, using the shared local formatter", () => {
    expect(source).toContain('from "@/lib/phone"')
    expect(source).toContain("visit.visitor.phone && (")
    expect(source).toContain('placeholder="05XX XXX XX XX"')
    expect(source).toContain("...(visit.visitor.phone ? { phone: draft.phone.trim() ? normalizeVisitorPhone(draft.phone) : undefined } : {})")
  })

  it("routes the mutation through SecurityService.correctVisitor, not Admin/Manager APIs", () => {
    expect(source).toContain("securityService.correctVisitor(")
    expect(source).not.toContain("adminService")
    expect(source).not.toContain('from "@/features/manager/')
  })
})
