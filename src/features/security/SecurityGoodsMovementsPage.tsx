import { Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { GoodsMovement } from "@/domain/goods-movements"
import { SecurityUnplannedGoodsMovementDialog } from "@/features/security/SecurityUnplannedGoodsMovementDialog"
import { useVisits } from "@/features/visits/visit-context"
import { cn } from "@/lib/utils"
import { goodsMovementService } from "@/services"
import type { CompleteGoodsMovementInput } from "@/services/goods-movement-service"
import {
  filterSecurityGoodsMovements,
  getSecurityScopedTodayPlannedGoodsMovements,
  groupSecurityGoodsMovements,
  formatSecurityGoodsMovementPlannedAt,
  type SecurityGoodsMovementGroups,
  type SecurityGoodsMovementRow,
} from "./security-goods-movements"

export function SecurityGoodsMovementsPage() {
  const { referenceData } = useVisits()
  const [movements, setMovements] = useState<GoodsMovement[]>([])
  const [search, setSearch] = useState("")
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [completionTarget, setCompletionTarget] = useState<GoodsMovement | null>(null)
  const [unplannedOpen, setUnplannedOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void goodsMovementService.listSecurityGoodsMovements()
      .then((next) => { if (!cancelled) setMovements(next) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Mal hareketleri yüklenemedi.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const scope = useMemo(() => referenceData ? {
    companyId: referenceData.currentEmployee.companyId,
    facilityId: referenceData.currentEmployee.facilityId,
  } : null, [referenceData])
  const scopedMovements = useMemo(() => scope ? getSecurityScopedTodayPlannedGoodsMovements(movements, scope, now) : [], [movements, now, scope])
  const filteredMovements = useMemo(() => filterSecurityGoodsMovements(scopedMovements, search), [scopedMovements, search])
  const panels = useMemo(() => groupSecurityGoodsMovements(filteredMovements, now), [filteredMovements, now])

  const completeMovement = async (id: string, input: Omit<CompleteGoodsMovementInput, "companyId" | "facilityId">) => {
    if (!scope) return
    const completed = await goodsMovementService.completeGoodsMovement(id, { ...input, ...scope })
    setMovements((current) => current.map((movement) => movement.id === completed.id ? completed : movement))
    setCompletionTarget(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <h1 className="sr-only">Güvenlik Mal Hareketleri</h1>
      <div className="flex shrink-0 items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Firma, mal veya referans ara</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Firma, mal veya referans ara" aria-label="Firma, mal veya referans ara" className="h-9 border-slate-300 bg-white pl-9 shadow-none transition-colors placeholder:text-slate-500 focus-visible:border-blue-400 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:ring-offset-0" />
        </label>
        <Button type="button" className="h-9 shrink-0" disabled={!scope} onClick={() => setUnplannedOpen(true)}>+ Plansız mal hareketi</Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-2 gap-3 overflow-hidden lg:grid-cols-2 lg:grid-rows-1">
        <GoodsPanel title="Gelenler" groups={panels.inbound} loading={loading} error={error} search={search} emptyMessage="Bugün beklenen gelen hareket yok." onComplete={setCompletionTarget} />
        <GoodsPanel title="Gidenler" groups={panels.outbound} loading={loading} error={error} search={search} emptyMessage="Bugün beklenen giden hareket yok." onComplete={setCompletionTarget} />
      </div>

      <SecurityGoodsCompletionDialog movement={completionTarget} open={completionTarget !== null} onOpenChange={(open) => { if (!open) setCompletionTarget(null) }} onComplete={completeMovement} />
      {scope && <SecurityUnplannedGoodsMovementDialog
        open={unplannedOpen}
        onOpenChange={setUnplannedOpen}
        onCreated={(movement) => setMovements((current) => [...current, movement])}
        scope={scope}
      />}
    </div>
  )
}

function GoodsPanel({ title, groups, loading, error, search, emptyMessage, onComplete }: {
  title: string
  groups: SecurityGoodsMovementGroups
  loading: boolean
  error: string
  search: string
  emptyMessage: string
  onComplete(movement: GoodsMovement): void
}) {
  const count = groups.late.length + groups.upcoming.length
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-white shadow-panel" aria-label={`${title} mal hareketleri`}>
      <header className="flex shrink-0 items-center border-b bg-slate-50/80 px-3 py-2"><h2 className="text-xs font-semibold text-slate-700">{title} <span className="tabular-nums text-slate-400">· {count}</span></h2></header>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {loading ? <PanelState message="Yükleniyor…" />
          : error ? <PanelState message={error} tone="error" />
            : count === 0 ? <PanelState message={search.trim() ? "Aramayla eşleşen kayıt yok." : emptyMessage} />
              : <div className="py-1">{groups.late.length > 0 && <GoodsGroup title="Gecikenler" rows={groups.late} onComplete={onComplete} />}{groups.upcoming.length > 0 && <GoodsGroup title="Sıradakiler" rows={groups.upcoming} onComplete={onComplete} />}</div>}
      </div>
    </section>
  )
}

function GoodsGroup({ title, rows, onComplete }: { title: string; rows: SecurityGoodsMovementRow[]; onComplete(movement: GoodsMovement): void }) {
  return <section className="py-1.5" aria-label={title}><h3 className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3><ul>{rows.map((row) => <GoodsRow key={row.movement.id} row={row} onComplete={onComplete} />)}</ul></section>
}

function GoodsRow({ row, onComplete }: { row: SecurityGoodsMovementRow; onComplete(movement: GoodsMovement): void }) {
  const { movement, isLate } = row
  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <div className="grid min-h-14 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-2">
        <div className="self-start text-xs font-semibold tabular-nums text-slate-900"><span>{movement.plannedTime ?? "Saat belirtilmedi"}</span>{isLate && <span className="mt-0.5 block text-[10px] text-amber-700">Gecikti</span>}</div>
        <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-900" title={movement.counterpartyName}>{movement.counterpartyName}</p><p className="mt-0.5 truncate text-[11px] text-slate-500" title={movement.goodsDescription}>{movement.goodsDescription}</p>{movement.referenceNumber && <p className="mt-0.5 truncate text-[10px] text-slate-400" title={movement.referenceNumber}>{movement.referenceNumber}</p>}</div>
        <Button type="button" size="sm" variant="default" className="h-7 w-[5.25rem] px-2 text-[11px]" onClick={() => onComplete(movement)}>{movement.direction === "INBOUND" ? "Geldi" : "Çıkış yaptı"}</Button>
      </div>
    </li>
  )
}

function SecurityGoodsCompletionDialog({ movement, open, onOpenChange, onComplete }: {
  movement: GoodsMovement | null
  open: boolean
  onOpenChange(open: boolean): void
  onComplete(id: string, input: Omit<CompleteGoodsMovementInput, "companyId" | "facilityId">): Promise<void>
}) {
  const [actualPlate, setActualPlate] = useState("")
  const [actualDriverName, setActualDriverName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setActualPlate("")
    setActualDriverName("")
    setSubmitting(false)
    setError("")
  }, [open])

  if (!movement) return null
  const actionLabel = movement.direction === "INBOUND" ? "Geldi olarak kaydet" : "Çıkışı tamamla"
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError("")
    try { await onComplete(movement.id, { actualPlate, actualDriverName }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Mal hareketi tamamlanamadı."); setSubmitting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{movement.direction === "INBOUND" ? "Gelen hareket" : "Giden hareket"}</DialogTitle><DialogDescription>{movement.counterpartyName} · {movement.goodsDescription}</DialogDescription></DialogHeader>
        <div className="space-y-2 text-xs"><p className="text-slate-500">Planlanan: <span className="font-medium text-slate-700">{formatSecurityGoodsMovementPlannedAt(movement)}</span></p><div className="grid gap-2 sm:grid-cols-2"><Field label="Plaka"><Input value={actualPlate} onChange={(event) => setActualPlate(event.target.value)} /></Field><Field label="Şoför adı"><Input value={actualDriverName} onChange={(event) => setActualDriverName(event.target.value)} /></Field></div></div>
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>İptal</Button><Button type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? "Kaydediliyor…" : actionLabel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>
}

function PanelState({ message, tone = "neutral" }: { message: string; tone?: "neutral" | "error" }) {
  return <div className={cn("flex h-full min-h-32 items-center justify-center px-4 text-center text-sm", tone === "error" ? "text-rose-700" : "text-slate-500")} role={tone === "error" ? "alert" : "status"}>{message}</div>
}
