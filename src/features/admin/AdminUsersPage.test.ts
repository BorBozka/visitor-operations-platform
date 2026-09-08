import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const componentSource = readFileSync(resolve(process.cwd(), "src/features/admin/AdminUsersPage.tsx"), "utf8")

describe("AdminUsersPage dialog focus", () => {
  it("does not auto-focus (and thus auto-select) the first field when a detail/create dialog opens, but keeps focus trapped inside the dialog", () => {
    const openAutoFocusCount = componentSource.split("event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus()").length - 1
    expect(openAutoFocusCount).toBe(2)
  })
})

describe("AdminUsersPage temporary password workflow", () => {
  it("requires a temporary password and its confirmation only when creating a local user, and forwards it through the options bag (not on the AdminUser value)", () => {
    expect(componentSource).toContain("Geçici parola")
    expect(componentSource).toContain("Geçici parolayı doğrula")
    expect(componentSource).toContain("isCreating &&")
    expect(componentSource).toContain("isTemporaryPasswordValid(temporaryPassword)")
    expect(componentSource).toContain("doPasswordsMatch(temporaryPassword, temporaryPasswordConfirm)")
    // The backend needs the temp password to hash on create; it rides in the options bag so it
    // is never a field of the AdminUser payload and is never sent on update.
    expect(componentSource).toContain("await adminService.saveUser(value, { actingUserId: CURRENT_ADMIN_USER_ID, temporaryPassword })")
    expect(componentSource).not.toContain("saveUser({ ...value, temporaryPassword")
    expect(componentSource).not.toContain("saveUser({ ...value, password")
  })

  it("blocks a mismatched confirmation with an inline error", () => {
    expect(componentSource).toContain('"Parolalar eşleşmiyor."')
  })

  it("supports a shared show/hide toggle component reused by create and reset", () => {
    expect(componentSource).toContain("function PasswordInput(")
    expect(componentSource).toContain('type={show ? "text" : "password"}')
  })
})

describe("AdminUsersPage local password reset", () => {
  it("offers a secondary reset action only for an existing Local user, never for Active Directory", () => {
    expect(componentSource).toContain("Parolayı sıfırla")
    expect(componentSource).toMatch(/value\.id && !adOwned && <Button[^>]*onClick=\{\(\) => \{ setResetSuccess\(false\); setResetPasswordOpen\(true\) \}\}/)
    expect(componentSource).toContain("value.id && !adOwned && <ResetPasswordDialog")
  })

  it("resets through a dedicated service call, never through saveUser", () => {
    expect(componentSource).toContain("adminService.resetLocalUserPassword(userId, password)")
  })

  it("requires the reset confirmation to match before allowing save", () => {
    expect(componentSource).toContain("function ResetPasswordDialog(")
    const resetDialogSource = componentSource.slice(componentSource.indexOf("function ResetPasswordDialog("))
    expect(resetDialogSource).toContain("const canSave = passwordValid && passwordsMatch")
  })

  it("only reveals validation errors after the relevant field is touched or a submit is attempted, mirroring the create dialog's pattern", () => {
    const resetDialogSource = componentSource.slice(componentSource.indexOf("function ResetPasswordDialog("))
    expect(resetDialogSource).toContain("passwordTouched || submitAttempted")
    expect(resetDialogSource).toContain("confirmationTouched || submitAttempted")
    expect(resetDialogSource).toContain("setSubmitAttempted(true)")
    // Save must stay clickable while invalid, or clicking it could never act as the "submit
    // attempt" that reveals a pristine, untouched field's error.
    expect(resetDialogSource).not.toContain("disabled={!canSave}")
  })

  it("shows non-blocking success feedback in the parent dialog after a successful reset, and closes only the reset dialog", () => {
    expect(componentSource).toContain("Parola başarıyla sıfırlandı.")
    expect(componentSource).toContain('role="status"')
    expect(componentSource).toContain("onSuccess()")
    expect(componentSource).toContain("onSuccess={() => setResetSuccess(true)}")
  })

  it("suppresses the parent dialog's own overlay and dims it while the reset dialog is open, instead of stacking two overlays", () => {
    expect(componentSource).toContain("hideOverlay={resetPasswordOpen}")
    expect(componentSource).toContain('resetPasswordOpen && "pointer-events-none opacity-50 transition-opacity"')
  })

  it("keeps the password reset entirely separate from the parent edit form's own save payload and dirty-state", () => {
    // ResetPasswordDialog only receives userId/open/onOpenChange/onSuccess — never `value`,
    // `setValue` or the parent's draft — so it structurally cannot mutate the edit form.
    expect(componentSource).toMatch(/<ResetPasswordDialog userId=\{value\.id\} open=\{resetPasswordOpen\} onOpenChange=\{setResetPasswordOpen\} onSuccess=\{[^}]+\} \/>/)
    expect(componentSource).not.toContain("resetLocalUserPassword(userId, password), { actingUserId")
  })
})

describe("AdminUsersPage toolbar and filters", () => {
  it("keeps search, adds role/auth/status/company filters, and drops the redundant total count", () => {
    expect(componentSource).toContain('aria-label="Rol filtresi"')
    expect(componentSource).toContain('aria-label="Kimlik doğrulama filtresi"')
    expect(componentSource).toContain('aria-label="Durum filtresi"')
    expect(componentSource).toContain('aria-label="Şirket filtresi"')
    expect(componentSource).not.toContain("{filteredUsers.length} kullanıcı")
  })

  it("labels the authentication-source filter's default option distinctly from the Kaynaklar module, without clipping in the select width", () => {
    expect(componentSource).toContain('<option value="all">Tüm kimlik türleri</option>')
    expect(componentSource).not.toContain('<option value="all">Tüm kaynaklar</option>')
    expect(componentSource).not.toContain('<option value="all">Tüm kimlik kaynakları</option>')
  })

  it("persists filters, sort and page through the URL like the other list screens", () => {
    expect(componentSource).toContain("useSearchParams")
    expect(componentSource).toContain("parseAdminUsersQuery")
    expect(componentSource).toContain("updateAdminUsersSearchParams")
    expect(componentSource).toContain("setAdminUsersSort")
  })

  it("shows an empty state instead of an empty table when nothing matches", () => {
    expect(componentSource).toContain("EmptyAdminUsersState")
    expect(componentSource).toContain("filteredUsers.length === 0")
  })

  it("lets the search field shrink and keeps filters/action from shrinking away at narrower desktop widths", () => {
    expect(componentSource).toContain("flex-wrap")
    expect(componentSource).toMatch(/relative min-w-\[\d+px\] flex-1/)
    expect(componentSource).toContain('className="ml-auto shrink-0"')
  })
})

describe("AdminUsersPage table sorting and company scope column", () => {
  it("wires the five specified columns to the shared 3-state sort toggle", () => {
    expect(componentSource).toContain('<SortableHeader label="Ad soyad" field="fullName"')
    expect(componentSource).toContain('<SortableHeader label="Kullanıcı adı" field="username"')
    expect(componentSource).toContain('<SortableHeader label="Rol" field="role"')
    expect(componentSource).toContain('<SortableHeader label="Şirket" field="company"')
    expect(componentSource).toContain('<SortableHeader label="Durum" field="status"')
    expect(componentSource).toContain("toggleAdminUserSort")
  })

  it("uses consistent, non-uppercased casing for the two non-sortable header cells", () => {
    expect(componentSource).toContain('<th className="px-3 py-2 normal-case">E-posta</th>')
    expect(componentSource).toContain('<th className="px-3 py-2 normal-case">Kimlik doğrulama</th>')
  })

  it("renders the compact multi-company display and exposes the full list to mouse, keyboard and screen readers when truncated", () => {
    expect(componentSource).toContain("getAdminUserCompanyDisplay")
    expect(componentSource).toContain("companyDisplay.truncated")
    expect(componentSource).toContain("title={companyDisplay.full}")
    expect(componentSource).toContain("aria-label={companyDisplay.full}")
    expect(componentSource).toMatch(/tabIndex=\{0\}[^>]*title=\{companyDisplay\.full\}/)
  })
})

describe("AdminUsersPage local user dialog", () => {
  it("drops the local-only helper description and the disabled authentication-source input", () => {
    expect(componentSource).not.toContain("Yerel kullanıcı kimlik bilgilerini ve yetkilerini tanımlayın.")
    expect(componentSource).not.toContain("authenticationSourceLabels[value.authenticationSource]} disabled")
    expect(componentSource).toContain("AuthSourceBadge")
  })

  it("uses a compact, scrollable checkbox list for company scope instead of a large bordered box", () => {
    expect(componentSource).not.toContain('rounded-md border p-2.5">{companies.map')
    expect(componentSource).toContain("max-h-28")
    expect(componentSource).toContain("overflow-y-auto")
  })

  it("replaces the active/passive checkbox with the shared Switch control, with an accessible name", () => {
    expect(componentSource).toContain('import { Switch } from "@/components/ui/switch"')
    expect(componentSource).toContain("checked={value.active}")
    expect(componentSource).toContain("onCheckedChange={(checked) => setValue({ active: checked })}")
    expect(componentSource).toContain('aria-label="Aktif kullanıcı"')
  })

  it("confirms before an Admin role escalation and does not gate any other role change", () => {
    expect(componentSource).toContain("shouldConfirmAdminRoleChange")
    expect(componentSource).toContain("window.confirm")
    expect(componentSource).toContain("tam sistem yönetimi yetkisi")
  })

  it("confirms before demoting or deactivating someone else's Admin account", () => {
    expect(componentSource).toContain("shouldConfirmAnotherAdminDemotion")
    expect(componentSource).toContain("shouldConfirmAnotherAdminDeactivation")
    expect(componentSource).toContain("Admin yetkisi kaldırılacak")
    expect(componentSource).toContain("Admin hesabı pasif hale getirilecek")
  })

  it("uses read-only (not disabled) presentation for AD-owned identity fields so the value stays selectable/copyable", () => {
    const identityFieldCount = componentSource.split("readOnly={adOwned}").length - 1
    expect(identityFieldCount).toBe(3)
    expect(componentSource).not.toContain("disabled={adOwned}")
    expect(componentSource).not.toMatch(/Select value=\{value\.role\}[^>]*disabled=\{adOwned\}/)
    expect(componentSource).not.toMatch(/Switch checked=\{value\.active\}[^>]*disabled=\{adOwned\}/)
  })

  it("flags duplicate usernames/emails inline and blocks save, without introducing a second uniqueness implementation", () => {
    expect(componentSource).toContain("isAdminUsernameTaken(users, value.id || null, value.username)")
    expect(componentSource).toContain("isAdminEmailTaken(users, value.id || null, value.email)")
    expect(componentSource).toContain("Bu kullanıcı adı zaten kullanılıyor.")
    expect(componentSource).toContain("Bu e-posta adresi zaten kullanılıyor.")
  })

  it("requires a valid company/facility scope before saving, but only reveals the error after the field is touched or a submit is attempted", () => {
    expect(componentSource).toContain("isAuthorizationScopeValid(value.role, value.authorizationScope)")
    expect(componentSource).toContain("En az bir şirket seçilmelidir.")
    expect(componentSource).toContain("Operasyonel roller için kapsam tam olarak bir tesis içermelidir.")
    expect(componentSource).toContain("provisionEmployeeFacilityScope")
    expect(componentSource).not.toContain("Ana tesis")
    expect(componentSource).toContain("const showScopeError = (scopeTouched || submitAttempted) && !scopeValid")
    expect(componentSource).toContain("error={showScopeError ? scopeError : undefined}")
    expect(componentSource).not.toContain('error={!scopeValid ? "En az bir şirket seçilmelidir." : undefined}')
    expect(componentSource).toContain("setScopeTouched(true)")
    expect(componentSource).toContain("setSubmitAttempted(true)")
    // Kaydet must stay clickable when scope is the only blocker, or "submit attempt" could never happen.
    expect(componentSource).toContain("const canSaveExceptScope = requiredFieldsFilled && !usernameTaken && !emailTaken && passwordValid && !selfDeactivation && !selfDemotion && !removesLastAdmin && isDirty")
    expect(componentSource).toContain("const canSave = canSaveExceptScope && scopeValid")
    expect(componentSource).toContain("disabled={!canSaveExceptScope}")
  })

  it("blocks self-deactivation and self-demotion, and disables the controls that would cause them", () => {
    expect(componentSource).toContain("Kendi hesabınızı pasif hale getiremezsiniz.")
    expect(componentSource).toContain("Kendi Admin rolünüzü kaldıramazsınız.")
    expect(componentSource).toContain("disabled={isSelf}")
    expect(componentSource).toMatch(/disabled=\{isSelf && user\?\.role === "ADMIN"\}/)
  })

  it("blocks removing the last active Admin", () => {
    expect(componentSource).toContain("Sistemde en az bir aktif Admin bulunmalıdır.")
    expect(componentSource).toContain("removesLastAdmin")
  })

  it("disables Kaydet on a pristine edit dialog and only re-enables it once the form is actually dirty, for both Local and AD users", () => {
    expect(componentSource).toContain("isAdminUserFormDirty")
    expect(componentSource).toContain("const isDirty = !user || (value ? isAdminUserFormDirty(user, value) : false)")
    // isDirty feeds canSaveExceptScope -> canSave, with no Local/AD special-casing in the component
    // itself: isAdminUserFormDirty already excludes AD's read-only identity fields internally.
    expect(componentSource).toContain("&& isDirty")
  })
})

describe("AdminUsersPage never adds a hard-delete action", () => {
  it("has no delete/remove user affordance", () => {
    expect(componentSource.toLowerCase()).not.toContain("deleteuser")
    expect(componentSource.toLowerCase()).not.toContain("removeuser")
    expect(componentSource).not.toContain("Trash")
  })
})
