import {
  Bell,
  Boxes,
  CarFront,
  CalendarDays,
  FileBarChart,
  LoaderCircle,
  LayoutDashboard,
  Menu,
  PackageCheck,
  Settings,
  Users,
  Building2,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"

import bplasLogo from "@/assets/bplas-logo.svg"
import { AccountMenu } from "@/components/account/AccountMenu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { startMinuteClock } from "@/features/manager/manager-clock"
import { toAccountProfile } from "@/features/account/account-profile"
import { useAuth } from "@/features/auth/auth-context"
import { ManagerRefreshProvider } from "@/features/manager/manager-refresh-context"
import { getSavedReportsHref } from "@/features/reports/reports-filters"
import { getVisiblePendingInvitationVisits } from "@/features/visits/invitation-status"
import { useVisits } from "@/features/visits/visit-context"
import type { InvitationStatus } from "@/domain/visits"
import type { ApplicationRole } from "@/domain/admin"
import { formatTr } from "@/lib/date"
import { cn } from "@/lib/utils"

const personalNavigationItems = (basePath: string) => [{ label: "Ziyaretlerim", icon: CalendarDays, to: `${basePath}/my-visits` }]
const managementNavigationItems = (basePath: string) => [
  { label: "Dashboard", icon: LayoutDashboard, to: `${basePath}/dashboard` },
  { label: "Tüm Ziyaretler", icon: CalendarDays, to: `${basePath}/all-visits` },
  { label: "Kaynaklar", icon: Boxes, to: `${basePath}/resources` },
  { label: "Mal hareketleri", icon: PackageCheck, to: `${basePath}/goods-movements` },
  { label: "Araç planı", icon: CarFront, to: `${basePath}/transport-planning` },
  { label: "Raporlar", icon: FileBarChart, to: `${basePath}/reports` },
]
const systemNavigationItems = [
  { label: "Kullanıcılar", icon: Users, to: "/admin/users" },
  { label: "Organizasyon", icon: Building2, to: "/admin/organization" },
  { label: "Sistem Ayarları", icon: Settings, to: "/admin/system-settings" },
]

export function ManagerShell({ role = "MANAGER" }: { role?: Extract<ApplicationRole, "MANAGER" | "ADMIN"> }) {
  const isAdmin = role === "ADMIN"
  const basePath = isAdmin ? "/admin" : "/manager"
  const [collapsed, setCollapsed] = useState(() => window.sessionStorage.getItem(`${role.toLowerCase()}-navigation-collapsed`) === "true")
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [companyId, setCompanyId] = useState("all")
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [facilityId, setFacilityId] = useState("all")
  const [lastUpdated, setLastUpdated] = useState(() => new Date())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const { reload } = useVisits()
  const { currentUser } = useAuth()

  useEffect(() => {
    window.sessionStorage.setItem(`${role.toLowerCase()}-navigation-collapsed`, String(collapsed))
  }, [collapsed, role])

  useEffect(() => startMinuteClock(setCurrentTime), [])

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await reload()
      setLastUpdated(new Date())
      setRefreshVersion((value) => value + 1)
    } finally {
      setIsRefreshing(false)
    }
  }, [reload])

  const selectCompany = useCallback((nextCompanyId: string) => {
    setCompanyId(nextCompanyId)
    setFacilityId("all")
  }, [])

  if (!currentUser) return null
  const account = toAccountProfile(currentUser)

  return (
    <ManagerRefreshProvider value={{ companyId, currentTime, facilityId, isRefreshing, lastUpdated, refreshVersion, refresh, selectCompany, selectFacility: setFacilityId }}>
      <div className={cn("min-h-[111.112vh] overflow-x-hidden bg-slate-50 transition-[padding-left] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[padding-left] motion-reduce:transition-none", collapsed ? "md:pl-[60px]" : "md:pl-[188px]")} style={{ zoom: 0.9 }}>
        <ManagerSidebar collapsed={collapsed} onCollapsedChange={setCollapsed} role={role} basePath={basePath} />
        <ManagerMobileNavigation open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen} role={role} basePath={basePath} />

        <header className="sticky top-0 z-30 flex h-12 items-center border-b bg-white/95 px-3 backdrop-blur md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileNavigationOpen(true)}
            aria-label="Yönetici menüsünü aç"
            aria-controls="manager-mobile-navigation"
            aria-expanded={mobileNavigationOpen}
          >
            <Menu />
          </Button>
          <AccountMenu profile={account} className="ml-auto" />
        </header>

        <main className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-2.5 md:px-5 md:py-3 lg:px-6"><Outlet /></main>
      </div>
    </ManagerRefreshProvider>
  )
}

function ManagerSidebar({ collapsed, onCollapsedChange, role, basePath }: { collapsed: boolean; onCollapsedChange(value: boolean): void; role: "MANAGER" | "ADMIN"; basePath: string }) {
  return (
    <aside className={cn("fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-r border-slate-800 bg-slate-950 text-slate-200 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[width] motion-reduce:transition-none md:flex md:flex-col", collapsed ? "w-[60px]" : "w-[188px]")}>
      <button
        type="button"
        className={cn("flex h-[66px] w-full shrink-0 cursor-pointer items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500", collapsed ? "justify-center px-1" : "gap-3 pl-2.5 pr-2.5")}
        onClick={() => onCollapsedChange(!collapsed)}
        aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
        title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
      >
        <img src={bplasLogo} alt="BPLAS" className="size-10 rounded-lg object-cover shadow-sm" />
        <p aria-hidden={collapsed} className={cn("min-w-0 shrink-0 truncate text-sm font-semibold text-white transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none", collapsed ? "w-0 translate-x-1 opacity-0" : "translate-x-0 opacity-100 delay-100")}>Yönetim Sistemi</p>
      </button>

      <nav
        className="flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden px-2 py-1"
        aria-label={role === "ADMIN" ? "Admin menüsü" : "Yönetici menüsü"}
        onClick={(event) => { if (event.target === event.currentTarget) onCollapsedChange(!collapsed) }}
      >
        <NavigationGroup label="Yönetim" collapsed={collapsed} items={managementNavigationItems(basePath)} />
        {role === "ADMIN" && <NavigationGroup label="Sistem Yönetimi" collapsed={collapsed} items={systemNavigationItems} className="mt-3" />}
        <NavigationGroup label="Kişisel" collapsed={collapsed} items={personalNavigationItems(basePath)} className="mt-3" />
      </nav>

      <div
        className="shrink-0 cursor-pointer border-t border-slate-800 p-1.5"
        onClick={(event) => { if (event.target === event.currentTarget) onCollapsedChange(!collapsed) }}
      >
        <ManagerNotifications collapsed={collapsed} />
        <ManagerProfile collapsed={collapsed} role={role} />
      </div>
    </aside>
  )
}

function ManagerNotifications({ collapsed }: { collapsed: boolean }) {
  const { visits, sendVisitInvitation } = useVisits()
  const [dismissedVisitIds, setDismissedVisitIds] = useState<Set<string>>(() => new Set())
  const [sendingVisitIds, setSendingVisitIds] = useState<Set<string>>(() => new Set())
  const [failedVisitIds, setFailedVisitIds] = useState<Set<string>>(() => new Set())
  const [sentVisitIds, setSentVisitIds] = useState<Set<string>>(() => new Set())
  const sendingVisitIdsRef = useRef(new Set<string>())
  const pendingInvitations = getVisiblePendingInvitationVisits(visits, dismissedVisitIds)
  const allPendingInvitations = getVisiblePendingInvitationVisits(visits, new Set())
  const visibleInvitationIds = new Set([...pendingInvitations.map((visit) => visit.id), ...sentVisitIds])
  const notificationInvitations = visits.filter((visit) => visibleInvitationIds.has(visit.id))

  const sendInvitation = async (visitId: string) => {
    if (sendingVisitIdsRef.current.has(visitId)) return

    sendingVisitIdsRef.current.add(visitId)
    setSendingVisitIds(new Set(sendingVisitIdsRef.current))
    setFailedVisitIds((current) => {
      const next = new Set(current)
      next.delete(visitId)
      return next
    })
    try {
      const result = await sendVisitInvitation(visitId)
      if (result.invitationStatus === "SENT") {
        setSentVisitIds((current) => new Set(current).add(visitId))
      } else if (result.invitationStatus === "FAILED") {
        setFailedVisitIds((current) => new Set(current).add(visitId))
      }
    } catch {
      setFailedVisitIds((current) => new Set(current).add(visitId))
    } finally {
      sendingVisitIdsRef.current.delete(visitId)
      setSendingVisitIds(new Set(sendingVisitIdsRef.current))
    }
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (!open) setSentVisitIds(new Set()) }}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="relative mb-1.5 w-full justify-start gap-2 overflow-hidden px-3.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label={`Bildirimler${pendingInvitations.length ? `, ${pendingInvitations.length} eylem bekleyen davet` : ""}`}
            title={collapsed ? "Bildirimler" : undefined}
          >
            <Bell />
            <span aria-hidden={collapsed} className={cn("shrink-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none", collapsed ? "translate-x-1 opacity-0" : "translate-x-0 opacity-100 delay-100")}>Bildirimler</span>
            {pendingInvitations.length > 0 && <span className="absolute right-1 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{pendingInvitations.length}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-[360px] max-w-[calc(100vw-1rem)] overflow-hidden p-0" aria-label="Yönetici bildirimleri">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <DropdownMenuLabel className="p-0 text-sm font-semibold text-slate-900">Bildirimler</DropdownMenuLabel>
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-slate-100 px-1 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-slate-600">{pendingInvitations.length}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              onClick={() => setDismissedVisitIds(new Set(allPendingInvitations.map((visit) => visit.id)))}
            >
              Tümünü temizle
            </Button>
          </div>
          <div className="max-h-[min(28rem,calc(100vh-7rem))] overflow-y-auto">
            {notificationInvitations.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-500">Eylem bekleyen davet yok.</p>
            ) : notificationInvitations.map((visit) => {
              const isSending = visit.invitationStatus === "SENDING" || sendingVisitIds.has(visit.id)
              const invitationStatus: InvitationStatus = isSending ? "SENDING" : failedVisitIds.has(visit.id) ? "FAILED" : visit.invitationStatus
              return (
                <DropdownMenuItem
                  key={visit.id}
                  className="items-start gap-3 rounded-none border-b border-slate-100 px-3 py-2 whitespace-normal hover:bg-slate-50 focus:bg-slate-50 last:border-b-0"
                  aria-label={`${visit.visitor.firstName} ${visit.visitor.lastName} için bildirim`}
                  onSelect={(event) => event.preventDefault()}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-900">{visit.visitor.firstName} {visit.visitor.lastName}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{formatTr(new Date(visit.plannedStart), "d MMM yyyy · HH:mm")}</p>
                    {invitationStatus !== "SENDING" && <InvitationNotificationStatus status={invitationStatus} />}
                  </div>
                  {invitationStatus === "SENDING" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700" role="status">
                      <LoaderCircle className="size-3 animate-spin" />Gönderiliyor…
                    </span>
                  ) : invitationStatus !== "SENT" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                      onClick={(event) => { event.stopPropagation(); void sendInvitation(visit.id) }}
                    >
                      {invitationStatus === "FAILED" ? "Yeniden gönder" : "Daveti gönder"}
                    </Button>
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

function InvitationNotificationStatus({ status }: { status: InvitationStatus }) {
  const statusContent = status === "FAILED" ? "Gönderim başarısız" : status === "SENDING" ? "Gönderiliyor…" : status === "SENT" ? "Davet gönderildi" : "Davet gönderilmedi"
  const statusClass = status === "FAILED"
    ? "border-red-200 bg-red-50 text-red-700"
    : status === "SENDING"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : status === "SENT"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-amber-200 bg-amber-50 text-amber-700"
  return <span className={cn("mt-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium", statusClass)}>{statusContent}</span>
}

function ManagerProfile({ collapsed = false }: { collapsed?: boolean; role?: "MANAGER" | "ADMIN" }) {
  const { currentUser } = useAuth()
  if (!currentUser) return null
  return <AccountMenu variant="sidebar" collapsed={collapsed} profile={toAccountProfile(currentUser)} className="w-full" />
}

function ManagerMobileNavigation({ open, onOpenChange, role, basePath }: { open: boolean; onOpenChange(open: boolean): void; role: "MANAGER" | "ADMIN"; basePath: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        id="manager-mobile-navigation"
        className="left-0 top-0 h-dvh max-h-none w-[min(18rem,calc(100%-3rem))] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 bg-slate-950 p-0 text-slate-200 [&>button]:text-slate-400 [&>button:hover]:text-white"
      >
        <DialogHeader className="border-b border-slate-800 px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <img src={bplasLogo} alt="BPLAS" className="size-9 rounded-lg object-cover shadow-sm" />
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm text-white">Yönetim Sistemi</DialogTitle>
              <DialogDescription className="text-[10px] uppercase tracking-[0.12em] text-slate-400">BPLAS</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label={role === "ADMIN" ? "Mobil admin menüsü" : "Mobil yönetici menüsü"}>
          <MobileNavigationGroup label="Yönetim" items={managementNavigationItems(basePath)} onNavigate={() => onOpenChange(false)} />
          {role === "ADMIN" && <MobileNavigationGroup label="Sistem Yönetimi" items={systemNavigationItems} onNavigate={() => onOpenChange(false)} className="mt-5" />}
          <MobileNavigationGroup label="Kişisel" items={personalNavigationItems(basePath)} onNavigate={() => onOpenChange(false)} className="mt-5" />
        </nav>

        <div className="border-t border-slate-800 p-2">
          <ManagerNotifications collapsed={false} />
          <ManagerProfile role={role} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NavigationGroup({ label, collapsed, items, className }: { label: string; collapsed: boolean; items: { label: string; icon: typeof CalendarDays; to?: string }[]; className?: string }) {
  const { pathname } = useLocation()
  const labelTransition = cn("min-w-0 shrink-0 truncate transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none", collapsed ? "translate-x-1 opacity-0" : "translate-x-0 opacity-100 delay-100")
  return <div className={className}><p className="h-5 overflow-hidden px-2 pb-1 text-[10px] font-medium text-slate-400"><span aria-hidden={collapsed} className={cn("inline-block whitespace-nowrap", labelTransition)}>{label}</span></p>{items.map(({ label: itemLabel, icon: Icon, to }) => to ? <NavLink key={itemLabel} to={to.endsWith("/reports") ? getSavedReportsHref(to.slice(0, -"/reports".length)) : to} title={collapsed ? itemLabel : undefined} aria-label={collapsed ? itemLabel : undefined} aria-current={pathname === to ? "page" : undefined} className={({ isActive }) => cn("mb-0.5 flex h-9 items-center gap-3 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150", isActive ? "bg-blue-600 text-white shadow-sm" : "text-slate-300 hover:bg-slate-800 hover:text-white")}><Icon className="size-5 shrink-0" /><span aria-hidden={collapsed} className={labelTransition}>{itemLabel}</span></NavLink> : <div key={itemLabel} className="mb-0.5 flex h-9 cursor-not-allowed items-center gap-3 whitespace-nowrap rounded-md px-3 text-sm text-slate-600" aria-disabled="true"><Icon className="size-5 shrink-0" /><span aria-hidden={collapsed} className={labelTransition}>{itemLabel}</span></div>)}</div>
}

function MobileNavigationGroup({ label, items, onNavigate, className }: { label: string; items: { label: string; icon: typeof CalendarDays; to?: string }[]; onNavigate(): void; className?: string }) {
  return (
    <div className={className}>
      <p className="px-2 pb-2 text-xs font-medium text-slate-400">{label}</p>
      {items.map(({ label: itemLabel, icon: Icon, to }) => to ? (
        <NavLink key={itemLabel} to={to.endsWith("/reports") ? getSavedReportsHref(to.slice(0, -"/reports".length)) : to} onClick={onNavigate} className={({ isActive }) => cn("mb-1 flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium", isActive ? "bg-blue-600 text-white shadow-sm" : "text-slate-300 hover:bg-slate-800 hover:text-white")}>
          <Icon className="size-5 shrink-0" />
          <span className="truncate">{itemLabel}</span>
        </NavLink>
      ) : (
        <div key={itemLabel} className="mb-1 flex h-11 cursor-not-allowed items-center gap-3 rounded-md px-3 text-sm text-slate-600" aria-disabled="true">
          <Icon className="size-5 shrink-0" />
          <span className="truncate">{itemLabel}</span>
        </div>
      ))}
    </div>
  )
}
