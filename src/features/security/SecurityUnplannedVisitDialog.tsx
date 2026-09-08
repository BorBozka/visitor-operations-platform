import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import type { Visit, VisitTypeOption } from "@/domain/visits"
import { adminService, securityService } from "@/services"
import { DEFAULT_UNPLANNED_DURATION_MINUTES, getTimeOptionMinutes, getClockMinutes, parseClockTime, UNPLANNED_UNTIL_NOON, UNPLANNED_UNTIL_WORKDAY_END, unplannedDurationOptions } from "./unplanned-visit-utils"

interface SecurityUnplannedVisitDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  onCreated(visit: Visit): void
  scope: { companyId: string; facilityId: string; creatorEmployeeId: string }
  visitTypes: VisitTypeOption[]
}

const emptyDraft = () => ({ firstName: "", lastName: "", company: "", hostEmployeeName: "", visitTypeId: "", vehiclePlate: "", durationMinutes: String(DEFAULT_UNPLANNED_DURATION_MINUTES), visitorCardId: "", rulesAccepted: false })

export function SecurityUnplannedVisitDialog({ open, onOpenChange, onCreated, scope, visitTypes }: SecurityUnplannedVisitDialogProps) {
  const [draft, setDraft] = useState(emptyDraft)
  const [cards, setCards] = useState<Awaited<ReturnType<typeof securityService.getAvailableVisitorCards>>>([])
  const [activeRule, setActiveRule] = useState<Awaited<ReturnType<typeof securityService.getActiveVisitorRule>>>(null)
  const [workdayEndTime, setWorkdayEndTime] = useState("18:15")
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const activeVisitTypes = useMemo(() => visitTypes.filter((type) => type.active), [visitTypes])

  useEffect(() => {
    if (!open) return
    setDraft(emptyDraft())
    setError("")
    setSubmitting(false)
    setLoading(true)
    // Load required data: cards and active visitor rule are mandatory for unplanned visits
    void Promise.all([securityService.getAvailableVisitorCards(), securityService.getActiveVisitorRule()])
      .then(([nextCards, nextRule]) => {
        setCards(nextCards)
        setActiveRule(nextRule)
        // Settings is optional; use fallback if fetch fails
        void adminService
          .getOperationalSettings()
          .then((settings) => setWorkdayEndTime(settings.workdayEndTime))
          .catch(() => {
            // Fallback to default time; no error to user
          })
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Plansız ziyaret için gereken bilgiler yüklenemedi."))
      .finally(() => setLoading(false))
  }, [open])

  const update = <K extends keyof ReturnType<typeof emptyDraft>>(key: K, value: ReturnType<typeof emptyDraft>[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const submit = async () => {
    const required = [[draft.firstName, "Ad"], [draft.lastName, "Soyad"], [draft.company, "Firma / Kurum"], [draft.hostEmployeeName, "Ev sahibi / ilgili personel"], [draft.visitTypeId, "Ziyaret türü"], [draft.visitorCardId, "Ziyaretçi kartı"]] as const
    const missing = required.find(([value]) => !value.trim())
    if (missing) { setError(`${missing[1]} zorunludur.`); return }
    const durationMinutes = getTimeOptionMinutes(draft.durationMinutes, new Date(), workdayEndTime)
    if (durationMinutes === null) { setError("Geçerli bir tahmini süre seçin."); return }
    if (!draft.rulesAccepted) { setError("Ziyaretçi kuralları kabul edilmelidir."); return }
    if (!activeRule) { setError("Aktif ziyaretçi kuralı bulunamadı."); return }

    setSubmitting(true)
    setError("")
    try {
      const visit = await securityService.createAndCheckInUnplannedVisit({
        firstName: draft.firstName,
        lastName: draft.lastName,
        company: draft.company,
        hostEmployeeName: draft.hostEmployeeName,
        visitTypeId: draft.visitTypeId,
        vehiclePlate: draft.vehiclePlate,
        durationMinutes,
        visitorCardId: draft.visitorCardId,
        rulesAccepted: draft.rulesAccepted,
        ...scope,
      })
      onCreated(visit)
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Plansız ziyaret kaydedilemedi.")
      setSubmitting(false)
    }
  }

  const now = new Date()
  const nowMinutes = getClockMinutes(now)
  const workdayEndMinutes = parseClockTime(workdayEndTime) ?? 18 * 60 + 15
  const durationChoices = [...unplannedDurationOptions.map((minutes) => ({ value: String(minutes), label: minutes < 60 ? `${minutes} dk` : `${minutes / 60} saat` })), ...(nowMinutes < 12 * 60 ? [{ value: UNPLANNED_UNTIL_NOON, label: "Öğlene kadar" }] : []), ...(nowMinutes < workdayEndMinutes ? [{ value: UNPLANNED_UNTIL_WORKDAY_END, label: "Mesai sonuna kadar" }] : [])]
  const noCardsAvailable = !loading && cards.length === 0
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <DialogContent className="max-w-md" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Plansız ziyaret</DialogTitle>
          <DialogDescription>Ziyaretçi bilgilerini girerek giriş kaydını oluşturun.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Ad" required><Input autoFocus value={draft.firstName} onChange={(event) => update("firstName", event.target.value)} /></Field>
          <Field label="Soyad" required><Input value={draft.lastName} onChange={(event) => update("lastName", event.target.value)} /></Field>
          <Field label="Firma / Kurum" required><Input value={draft.company} onChange={(event) => update("company", event.target.value)} /></Field>
          <Field label="Ev sahibi / ilgili personel" required><Input value={draft.hostEmployeeName} onChange={(event) => update("hostEmployeeName", event.target.value)} /></Field>
          <Field label="Ziyaret türü" required><Select value={draft.visitTypeId} onChange={(event) => update("visitTypeId", event.target.value)}><option value="">Seçin</option>{activeVisitTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</Select></Field>
          <Field label="Plaka"><Input value={draft.vehiclePlate} onChange={(event) => update("vehiclePlate", event.target.value)} /></Field>
        </div>
        <fieldset className="space-y-1">
          <legend className="px-1 text-xs font-medium text-slate-700">Tahmini süre <span className="text-destructive">*</span></legend>
          <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-0.5">{durationChoices.map((option) => <Button key={option.value} type="button" variant={draft.durationMinutes === option.value ? "default" : "outline"} className="h-7 shrink-0 px-1.5 text-[11px]" onClick={() => update("durationMinutes", option.value)}>{option.label}</Button>)}</div>
        </fieldset>
        <Field label="Ziyaretçi kartı" required>{loading ? <p className="h-9 pt-2 text-xs text-slate-500">Kartlar yükleniyor…</p> : noCardsAvailable ? <p className="pt-2 text-xs text-amber-700">Uygun ziyaretçi kartı yok.</p> : <Select value={draft.visitorCardId} onChange={(event) => update("visitorCardId", event.target.value)}><option value="">Kart seçin</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.cardNumber}</option>)}</Select>}</Field>
        {activeRule && <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"><input type="checkbox" className="size-3.5" checked={draft.rulesAccepted} onChange={(event) => update("rulesAccepted", event.target.checked)} /><span>Ziyaretçi kuralları okudu ve kabul etti</span></label>}
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>İptal</Button><Button type="button" disabled={submitting || loading || noCardsAvailable || !activeRule} onClick={() => void submit()}>{submitting ? "Kaydediliyor…" : "Kaydet ve giriş yap"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}{required && <span className="text-destructive"> *</span>}</Label>{children}</div>
}
