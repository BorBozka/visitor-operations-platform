import { ArrowDown, ArrowUp, Eye, EyeOff, FilterX, KeyRound, Plus, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { PaginationFooter } from "@/components/common/PaginationFooter"
import { ActiveStatusPill } from "@/components/common/ActiveStatusPill"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  applicationRoleLabels,
  applicationRoles,
  authenticationSourceLabels,
  authenticationSources,
  isAdminEmailTaken,
  isAdminUsernameTaken,
  isAuthorizationScopeValid,
  provisionEmployeeFacilityScope,
  roleRequiresEmployeeProfile,
  type AdminUser,
  type ApplicationRole,
  type AuthenticationSource,
} from "@/domain/admin"
import {
  ADMIN_USERS_PAGE_SIZE,
  clearAdminUsersSearchParams,
  CURRENT_ADMIN_USER_ID,
  doPasswordsMatch,
  filterAndSortAdminUsers,
  getAdminUserCompanyDisplay,
  getAdminUsersPageCount,
  hasActiveAdminUserFilters,
  isAdminUserFormDirty,
  isTemporaryPasswordValid,
  paginateAdminUsers,
  parseAdminUsersQuery,
  setAdminUsersPage,
  setAdminUsersSort,
  shouldConfirmAdminRoleChange,
  shouldConfirmAnotherAdminDeactivation,
  shouldConfirmAnotherAdminDemotion,
  toggleAdminUserSort,
  updateAdminUsersSearchParams,
  TEMPORARY_PASSWORD_MIN_LENGTH,
  type AdminUserSortField,
} from "@/features/admin/admin-utils"
import { useAdmin } from "@/features/admin/admin-context"
import { cn } from "@/lib/utils"
import { adminService } from "@/services"

const emptyLocalUserDraft = (facilities: { id: string; parentId?: string }[]): AdminUser => ({
  id: "",
  fullName: "",
  username: "",
  email: "",
  authenticationSource: "LOCAL",
  role: "EMPLOYEE",
  authorizationScope: provisionEmployeeFacilityScope("EMPLOYEE", { companyIds: [], facilityIds: [], securityGateIds: [] }, facilities),
  active: true,
})

export function AdminUsersPage() {
  const { users, organization, reload } = useAdmin()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const companies = useMemo(() => organization?.companies.map((company) => ({ id: company.id, name: company.name })) ?? [], [organization])
  const facilities = useMemo(() => organization?.facilities.map((facility) => ({ id: facility.id, parentId: facility.parentId })) ?? [], [organization])

  const { filters, sort, page } = useMemo(() => parseAdminUsersQuery(searchParams), [searchParams])
  const filteredUsers = useMemo(() => filterAndSortAdminUsers(users, filters, sort, companies), [users, filters, sort, companies])
  const pageCount = getAdminUsersPageCount(filteredUsers.length)
  const safePage = Math.min(page, pageCount)
  const visibleUsers = paginateAdminUsers(filteredUsers, safePage)
  const activeFilters = hasActiveAdminUserFilters(filters)

  useEffect(() => {
    if (page <= pageCount) return
    setSearchParams(setAdminUsersPage(searchParams, 1), { replace: true })
  }, [page, pageCount, searchParams, setSearchParams])

  const setFilter = (key: "q" | "role" | "auth" | "status" | "company", value: string) => setSearchParams(updateAdminUsersSearchParams(searchParams, key, value))
  const setNextSort = (field: AdminUserSortField) => setSearchParams(setAdminUsersSort(searchParams, toggleAdminUserSort(sort, field)))
  const setPage = (nextPage: number) => setSearchParams(setAdminUsersPage(searchParams, nextPage))
  const clearFilters = () => setSearchParams(clearAdminUsersSearchParams(searchParams))

  return <div className="-mt-2.5 -mb-2.5 flex h-[111.112dvh] min-w-0 flex-col gap-3 pt-[11px] pb-[14px] md:-mt-3 md:-mb-3">
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-panel" aria-label="Kullanıcı yönetimi">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2.5">
        <div className="relative min-w-[160px] flex-1 basis-40"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" /><Input aria-label="Kullanıcı ara" value={filters.search} onChange={(event) => setFilter("q", event.target.value)} placeholder="Ad, kullanıcı adı veya e-posta ara" className="h-8 pl-8 text-xs" /></div>
        <Select aria-label="Rol filtresi" value={filters.role} onChange={(event) => setFilter("role", event.target.value)} className="h-8 w-[8.5rem] shrink-0 text-xs">
          <option value="all">Tüm roller</option>
          {applicationRoles.map((role) => <option key={role} value={role}>{applicationRoleLabels[role]}</option>)}
        </Select>
        <Select aria-label="Kimlik doğrulama filtresi" value={filters.authenticationSource} onChange={(event) => setFilter("auth", event.target.value)} className="h-8 w-[9.5rem] shrink-0 text-xs">
          <option value="all">Tüm kimlik türleri</option>
          {authenticationSources.map((source) => <option key={source} value={source}>{authenticationSourceLabels[source]}</option>)}
        </Select>
        <Select aria-label="Durum filtresi" value={filters.status} onChange={(event) => setFilter("status", event.target.value)} className="h-8 w-[7.5rem] shrink-0 text-xs">
          <option value="all">Tüm durumlar</option>
          <option value="active">Aktif</option>
          <option value="passive">Pasif</option>
        </Select>
        <Select aria-label="Şirket filtresi" value={filters.companyId} onChange={(event) => setFilter("company", event.target.value)} className="h-8 w-[9.5rem] shrink-0 text-xs">
          <option value="all">Tüm şirketler</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </Select>
        {activeFilters && <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={clearFilters}><FilterX className="size-3.5" />Filtreleri temizle</Button>}
        <Button size="sm" className="ml-auto shrink-0" onClick={() => setSelectedUser(emptyLocalUserDraft(facilities))}><Plus />Local kullanıcı</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {filteredUsers.length === 0 ? (
          <EmptyAdminUsersState hasFilters={activeFilters} />
        ) : (
          <table className="w-full min-w-[980px] table-fixed text-left text-xs">
            <thead className="sticky top-0 z-10 border-b bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <SortableHeader label="Ad soyad" field="fullName" sort={sort} onClick={setNextSort} />
                <SortableHeader label="Kullanıcı adı" field="username" sort={sort} onClick={setNextSort} />
                <th className="px-3 py-2 normal-case">E-posta</th>
                <th className="px-3 py-2 normal-case">Kimlik doğrulama</th>
                <SortableHeader label="Rol" field="role" sort={sort} onClick={setNextSort} />
                <SortableHeader label="Şirket" field="company" sort={sort} onClick={setNextSort} />
                <SortableHeader label="Durum" field="status" sort={sort} onClick={setNextSort} />
              </tr>
            </thead>
            <tbody className="divide-y border-b">
              {visibleUsers.map((user) => {
                const companyDisplay = getAdminUserCompanyDisplay(user.authorizationScope.companyIds, companies)
                return (
                  <tr key={user.id} tabIndex={0} onClick={() => setSelectedUser(user)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedUser(user) } }} className="record-row-hover h-11 cursor-pointer outline-none">
                    <td className="px-3 font-semibold text-slate-900">{user.fullName}</td>
                    <td className="px-3">{user.username}</td>
                    <td className="px-3">{user.email}</td>
                    <td className="px-3">{authenticationSourceLabels[user.authenticationSource]}</td>
                    <td className="px-3">{applicationRoleLabels[user.role]}</td>
                    <td className="px-3">{companyDisplay.truncated
                      ? <span tabIndex={0} title={companyDisplay.full} aria-label={companyDisplay.full} className="cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{companyDisplay.compact}</span>
                      : <span>{companyDisplay.compact}</span>}</td>
                    <td className="px-3"><ActiveStatusPill active={user.active} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <PaginationFooter page={safePage} pageCount={pageCount} visibleStart={filteredUsers.length ? (safePage - 1) * ADMIN_USERS_PAGE_SIZE + 1 : 0} visibleEnd={Math.min(safePage * ADMIN_USERS_PAGE_SIZE, filteredUsers.length)} total={filteredUsers.length} visiblePageNumbers={Array.from({ length: Math.min(3, pageCount) }, (_, index) => Math.max(1, Math.min(safePage - 1, pageCount - 2)) + index)} onPageChange={setPage} ariaLabel="Kullanıcı sayfaları" />
    </section>
    <UserDialog user={selectedUser} users={users} companies={companies} facilities={facilities} onOpenChange={(open) => !open && setSelectedUser(null)} onSaved={() => void reload()} />
  </div>
}

function SortableHeader({ label, field, sort, onClick }: { label: string; field: AdminUserSortField; sort: ReturnType<typeof toggleAdminUserSort>; onClick(field: AdminUserSortField): void }) { const active = sort?.field === field ? sort : null; return <th className="px-3 py-2"><button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => onClick(field)}>{label}{active && (active.direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button></th> }
function AuthSourceBadge({ source }: { source: AuthenticationSource }) { return <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", source === "LOCAL" ? "border-slate-200 bg-slate-100 text-slate-600" : "border-blue-200 bg-blue-50 text-blue-700")}>{authenticationSourceLabels[source]}</span> }

function EmptyAdminUsersState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center px-4 py-10 text-center">
      <Search className="mx-auto size-6 text-slate-400" />
      <h3 className="mt-2 text-xs font-semibold text-slate-900">Eşleşen kullanıcı bulunamadı</h3>
      <p className="mt-0.5 text-[11px] text-slate-600">{hasFilters ? "Arama veya filtre ölçütlerini değiştirerek yeniden deneyin." : "Henüz kullanıcı kaydı yok."}</p>
    </div>
  )
}

function UserDialog({ user, users, companies, facilities, onOpenChange, onSaved }: { user: AdminUser | null; users: AdminUser[]; companies: { id: string; name: string }[]; facilities: { id: string; parentId?: string }[]; onOpenChange(open: boolean): void; onSaved(): void }) {
  const [draft, setDraft] = useState<AdminUser | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState("")
  const [temporaryPasswordConfirm, setTemporaryPasswordConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [scopeTouched, setScopeTouched] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const open = Boolean(user)
  const value = draft && user && draft.id === user.id ? draft : user
  const setValue = (change: Partial<AdminUser>) => {
    setServerError(null)
    setResetSuccess(false)
    if (value) {
      const next = { ...value, ...change }
      setDraft({ ...next, authorizationScope: provisionEmployeeFacilityScope(next.role, next.authorizationScope, facilities) })
    }
  }

  useEffect(() => { setDraft(user ? { ...user, authorizationScope: provisionEmployeeFacilityScope(user.role, user.authorizationScope, facilities) } : null); setTemporaryPassword(""); setTemporaryPasswordConfirm(""); setShowPassword(false); setResetPasswordOpen(false); setResetSuccess(false); setServerError(null); setScopeTouched(false); setSubmitAttempted(false) }, [facilities, user])

  const isCreating = value?.id === ""
  const adOwned = value?.authenticationSource === "ACTIVE_DIRECTORY"
  const isSelf = user?.id === CURRENT_ADMIN_USER_ID

  const usernameTaken = value ? isAdminUsernameTaken(users, value.id || null, value.username) : false
  const emailTaken = value ? isAdminEmailTaken(users, value.id || null, value.email) : false
  const scopeValid = value ? isAuthorizationScopeValid(value.role, value.authorizationScope) : false
  const scopeError = value?.authorizationScope.companyIds.length === 0
    ? "En az bir şirket seçilmelidir."
    : value && roleRequiresEmployeeProfile(value.role) && value.authorizationScope.facilityIds.length !== 1
      ? "Operasyonel roller için kapsam tam olarak bir tesis içermelidir."
      : undefined
  const passwordsMatch = doPasswordsMatch(temporaryPassword, temporaryPasswordConfirm)
  const passwordValid = !isCreating || (isTemporaryPasswordValid(temporaryPassword) && passwordsMatch)

  const selfDeactivation = user && value ? isSelf && user.active && !value.active : false
  const selfDemotion = user && value ? isSelf && user.role === "ADMIN" && value.role !== "ADMIN" : false
  const removesLastAdmin = user && value
    ? user.role === "ADMIN" && user.active && !(value.role === "ADMIN" && value.active) && !users.some((item) => item.id !== user.id && item.role === "ADMIN" && item.active)
    : false

  const requiredFieldsFilled = Boolean(value?.fullName.trim() && value?.username.trim() && value?.email.trim())
  const isDirty = !user || (value ? isAdminUserFormDirty(user, value) : false)
  // Company scope is deliberately excluded here: Kaydet must stay clickable so pressing it can
  // act as the "submit attempt" that reveals the pristine scope error (see canSave below, which
  // still requires scopeValid before anything is actually persisted).
  const canSaveExceptScope = requiredFieldsFilled && !usernameTaken && !emailTaken && passwordValid && !selfDeactivation && !selfDemotion && !removesLastAdmin && isDirty
  const canSave = canSaveExceptScope && scopeValid
  const showScopeError = (scopeTouched || submitAttempted) && !scopeValid

  const lockoutMessage = selfDeactivation
    ? "Kendi hesabınızı pasif hale getiremezsiniz."
    : selfDemotion
      ? "Kendi Admin rolünüzü kaldıramazsınız."
      : removesLastAdmin
        ? "Sistemde en az bir aktif Admin bulunmalıdır."
        : null

  const save = async () => {
    setSubmitAttempted(true)
    if (!value || !canSave) return
    if (shouldConfirmAdminRoleChange(user?.id ? user.role : null, value.role)) {
      if (!window.confirm("Bu kullanıcıya tam sistem yönetimi yetkisi verilecek. Devam etmek istiyor musunuz?")) return
    }
    if (user && shouldConfirmAnotherAdminDemotion(CURRENT_ADMIN_USER_ID, user, value.role)) {
      if (!window.confirm("Bu kullanıcının Admin yetkisi kaldırılacak. Devam etmek istiyor musunuz?")) return
    }
    if (user && shouldConfirmAnotherAdminDeactivation(CURRENT_ADMIN_USER_ID, user, value.active)) {
      if (!window.confirm("Bu Admin hesabı pasif hale getirilecek. Devam etmek istiyor musunuz?")) return
    }
    try {
      // temporaryPassword stays out of `value` (it is not an AdminUser field); it rides in the
      // options bag so the HTTP adapter can forward it to the backend on create only.
      await adminService.saveUser(value, { actingUserId: CURRENT_ADMIN_USER_ID, temporaryPassword })
      setDraft(null)
      setTemporaryPassword("")
      setTemporaryPasswordConfirm("")
      onSaved()
      onOpenChange(false)
    } catch (reason) {
      setServerError(reason instanceof Error ? reason.message : "Kullanıcı kaydedilemedi.")
    }
  }

  if (!value) return null

  return <>
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) { setDraft(null); onOpenChange(false) } }}>
      <DialogContent
        className={cn("max-w-lg", resetPasswordOpen && "pointer-events-none opacity-50 transition-opacity")}
        hideOverlay={resetPasswordOpen}
        onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus() }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{value.id ? "Kullanıcı detayı" : "Local kullanıcı oluştur"}<AuthSourceBadge source={value.authenticationSource} /></DialogTitle>
          {adOwned && <DialogDescription>Active Directory tarafından yönetilen kimlik alanları düzenlenemez.</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Ad soyad"><Input value={value.fullName} readOnly={adOwned} onChange={(event) => setValue({ fullName: event.target.value })} /></Field>
          <Field label="Kullanıcı adı" error={usernameTaken ? "Bu kullanıcı adı zaten kullanılıyor." : undefined}><Input value={value.username} readOnly={adOwned} onChange={(event) => setValue({ username: event.target.value })} /></Field>
          <Field label="E-posta" className="sm:col-span-2" error={emailTaken ? "Bu e-posta adresi zaten kullanılıyor." : undefined}><Input type="email" value={value.email} readOnly={adOwned} onChange={(event) => setValue({ email: event.target.value })} /></Field>
          {isCreating && <>
            <Field label="Geçici parola" className="sm:col-span-2">
              <PasswordInput value={temporaryPassword} show={showPassword} onToggleShow={() => setShowPassword((current) => !current)} onChange={setTemporaryPassword} />
              <p className="mt-1 text-[11px] text-slate-500">En az {TEMPORARY_PASSWORD_MIN_LENGTH} karakter.</p>
            </Field>
            <Field label="Geçici parolayı doğrula" className="sm:col-span-2" error={temporaryPasswordConfirm && !passwordsMatch ? "Parolalar eşleşmiyor." : undefined}>
              <PasswordInput value={temporaryPasswordConfirm} show={showPassword} onToggleShow={() => setShowPassword((current) => !current)} onChange={setTemporaryPasswordConfirm} />
            </Field>
          </>}
          <Field label="Rol" className="sm:col-span-2"><Select value={value.role} disabled={isSelf && user?.role === "ADMIN"} title={isSelf && user?.role === "ADMIN" ? "Kendi Admin rolünüzü burada değiştiremezsiniz." : undefined} onChange={(event) => setValue({ role: event.target.value as ApplicationRole })}>{applicationRoles.map((role) => <option key={role} value={role}>{applicationRoleLabels[role]}</option>)}</Select></Field>
          <Field label="Şirket kapsamı" className="sm:col-span-2" error={showScopeError ? scopeError : undefined}>
            <div className="flex max-h-28 flex-col gap-1.5 overflow-y-auto sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1.5">
              {companies.map((company) => <label key={company.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value.authorizationScope.companyIds.includes(company.id)} onChange={(event) => { setScopeTouched(true); setValue({ authorizationScope: { ...value.authorizationScope, companyIds: event.target.checked ? [...value.authorizationScope.companyIds, company.id] : value.authorizationScope.companyIds.filter((id) => id !== company.id) } }) }} />{company.name}</label>)}
            </div>
          </Field>
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">Aktif kullanıcı</span>
            <Switch checked={value.active} disabled={isSelf} title={isSelf ? "Kendi hesabınızı burada pasif hale getiremezsiniz." : undefined} onCheckedChange={(checked) => setValue({ active: checked })} aria-label="Aktif kullanıcı" />
          </div>
        </div>
        {(lockoutMessage || serverError) && <p className="text-xs font-medium text-red-700" role="alert">{serverError ?? lockoutMessage}</p>}
        {resetSuccess && !lockoutMessage && !serverError && <p className="text-xs font-medium text-emerald-700" role="status">Parola başarıyla sıfırlandı.</p>}
        <DialogFooter>
          {value.id && !adOwned && <Button type="button" variant="outline" size="sm" className="mr-auto gap-1.5" onClick={() => { setResetSuccess(false); setResetPasswordOpen(true) }}><KeyRound className="size-3.5" />Parolayı sıfırla</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button disabled={!canSaveExceptScope} onClick={() => void save()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {value.id && !adOwned && <ResetPasswordDialog userId={value.id} open={resetPasswordOpen} onOpenChange={setResetPasswordOpen} onSuccess={() => setResetSuccess(true)} />}
  </>
}

function PasswordInput({ value, show, onToggleShow, onChange }: { value: string; show: boolean; onToggleShow(): void; onChange(value: string): void }) {
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} value={value} autoComplete="new-password" className="pr-9" onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700" onClick={onToggleShow} aria-label={show ? "Parolayı gizle" : "Parolayı göster"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

function ResetPasswordDialog({ userId, open, onOpenChange, onSuccess }: { userId: string; open: boolean; onOpenChange(open: boolean): void; onSuccess(): void }) {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [confirmationTouched, setConfirmationTouched] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)

  useEffect(() => { if (!open) { setPassword(""); setConfirmation(""); setShow(false); setError(null); setPasswordTouched(false); setConfirmationTouched(false); setSubmitAttempted(false) } }, [open])

  const passwordValid = isTemporaryPasswordValid(password)
  const passwordsMatch = doPasswordsMatch(password, confirmation)
  const canSave = passwordValid && passwordsMatch

  const passwordError = passwordTouched || submitAttempted
    ? (!password.trim() ? "Geçici parola zorunludur." : !passwordValid ? `En az ${TEMPORARY_PASSWORD_MIN_LENGTH} karakter olmalıdır.` : undefined)
    : undefined
  const confirmationError = confirmationTouched || submitAttempted
    ? (!confirmation.trim() ? "Geçici parolayı doğrulayın." : !passwordsMatch ? "Parolalar eşleşmiyor." : undefined)
    : undefined

  const save = async () => {
    setSubmitAttempted(true)
    if (!canSave) return
    try {
      await adminService.resetLocalUserPassword(userId, password)
      onOpenChange(false)
      onSuccess()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Parola sıfırlanamadı.")
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus() }}>
      <DialogHeader>
        <DialogTitle>Parolayı sıfırla</DialogTitle>
        <DialogDescription>Kullanıcı bir sonraki girişinde bu geçici parolayı kullanacak.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2.5">
        <Field label="Yeni geçici parola" error={passwordError}>
          <PasswordInput value={password} show={show} onToggleShow={() => setShow((current) => !current)} onChange={(next) => { setPasswordTouched(true); setPassword(next) }} />
          {!passwordError && <p className="mt-1 text-[11px] text-slate-500">En az {TEMPORARY_PASSWORD_MIN_LENGTH} karakter.</p>}
        </Field>
        <Field label="Geçici parolayı doğrula" error={confirmationError}>
          <PasswordInput value={confirmation} show={show} onToggleShow={() => setShow((current) => !current)} onChange={(next) => { setConfirmationTouched(true); setConfirmation(next) }} />
        </Field>
      </div>
      {error && <p className="text-xs font-medium text-red-700" role="alert">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
        <Button onClick={() => void save()}>Parolayı sıfırla</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function Field({ label, children, className, error }: { label: string; children: React.ReactNode; className?: string; error?: string }) { return <label className={className}><span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>{children}{error && <p className="mt-1 text-[11px] font-medium text-red-700" role="alert">{error}</p>}</label> }
