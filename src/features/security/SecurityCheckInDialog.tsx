import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import type { Visit } from "@/domain/visits"
import type { VisitorCardInventoryItem } from "@/domain/admin"
import { SecurityVisitorCorrectionDialog } from "@/features/security/SecurityVisitorCorrectionDialog"
import { formatTr } from "@/lib/date"
import { normalizeVisitorPhone } from "@/lib/phone"
import { cn } from "@/lib/utils"
import { securityService } from "@/services"

interface SecurityCheckInDialogProps {
  visit: Visit | null
  open: boolean
  onOpenChange(open: boolean): void
  onCheckedIn(visit: Visit): void
}

export function SecurityCheckInDialog({ visit, open, onOpenChange, onCheckedIn }: SecurityCheckInDialogProps) {
  const [currentVisit, setCurrentVisit] = useState<Visit | null>(visit)
  const [availableCards, setAvailableCards] = useState<VisitorCardInventoryItem[]>([])
  const [cardsLoading, setCardsLoading] = useState(true)
  const [cardsError, setCardsError] = useState<string | null>(null)
  const [cardsReloadToken, setCardsReloadToken] = useState(0)
  const [selectedCardId, setSelectedCardId] = useState("")
  const [plate, setPlate] = useState("")
  const [phone, setPhone] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCorrection, setShowCorrection] = useState(false)

  useEffect(() => {
    if (!open || !visit) return
    setCurrentVisit(visit)
    setSelectedCardId("")
    setPlate("")
    setPhone("")
    setSubmitting(false)
    setError(null)
    setShowCorrection(false)
    setCardsReloadToken(0)
  }, [open, visit])

  // Kept apart from the form reset so a retry reloads only the card list and keeps what was typed.
  useEffect(() => {
    if (!open || !visit) return
    setCardsLoading(true)
    setCardsError(null)
    let cancelled = false
    void securityService.getAvailableVisitorCards()
      .then((cards) => { if (!cancelled) setAvailableCards(cards) })
      .catch((reason) => {
        if (cancelled) return
        setAvailableCards([])
        setCardsError(reason instanceof Error ? reason.message : "Ziyaretçi kartları yüklenemedi. Lütfen tekrar deneyin.")
      })
      .finally(() => { if (!cancelled) setCardsLoading(false) })
    return () => { cancelled = true }
  }, [open, visit, cardsReloadToken])

  if (!currentVisit) return null

  const noCardsAvailable = !cardsLoading && !cardsError && availableCards.length === 0
  const submitDisabled = submitting || !selectedCardId || noCardsAvailable

  const submit = async () => {
    if (submitDisabled) return
    setSubmitting(true)
    setError(null)
    try {
      const updated = await securityService.checkInVisit({
        visitId: currentVisit.id,
        visitorCardId: selectedCardId,
        vehiclePlate: plate.trim() || undefined,
        phone: phone.trim() ? normalizeVisitorPhone(phone) : undefined,
      })
      onCheckedIn(updated)
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Giriş işlemi tamamlanamadı.")
      setSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
        <DialogContent
          className={cn("max-w-sm", showCorrection && "pointer-events-none opacity-50 transition-opacity")}
          hideOverlay={showCorrection}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Giriş Yap</DialogTitle>
          </DialogHeader>

          <div className="space-y-2.5 rounded-md border bg-slate-50/60 p-2.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-y-1">
                <dt className="text-slate-500">Ziyaretçi</dt>
                <dd className="font-medium text-slate-900">{currentVisit.visitor.firstName} {currentVisit.visitor.lastName}</dd>
                <dt className="text-slate-500">Firma</dt>
                <dd className="font-medium text-slate-900">{currentVisit.visitor.company}</dd>
                <dt className="text-slate-500">Ev sahibi</dt>
                <dd className="font-medium text-slate-900">{currentVisit.hostEmployeeName}</dd>
                <dt className="text-slate-500">Tür</dt>
                <dd className="font-medium text-slate-900">{currentVisit.visitTypeName}</dd>
                {currentVisit.visitor.phone && <>
                  <dt className="text-slate-500">Telefon</dt>
                  <dd className="font-medium text-slate-900">{currentVisit.visitor.phone}</dd>
                </>}
                <dt className="text-slate-500">Saat</dt>
                <dd className="font-medium text-slate-900">{formatTr(new Date(currentVisit.plannedStart), "HH:mm")}</dd>
              </dl>
              <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px] text-slate-600" onClick={() => setShowCorrection(true)}>
                Bilgileri düzelt
              </Button>
            </div>
          </div>

          <div className="grid gap-2.5">
            <div>
              <Label htmlFor="security-checkin-card">Ziyaretçi kartı <span className="text-destructive">*</span></Label>
              {cardsLoading
                ? <p className="mt-1 text-xs text-slate-500">Kartlar yükleniyor…</p>
                : cardsError
                  ? (
                    <div className="mt-1 space-y-1.5">
                      <p className="text-xs text-red-700" role="alert">{cardsError}</p>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setCardsReloadToken((current) => current + 1)}>Tekrar dene</Button>
                    </div>
                  )
                  : noCardsAvailable
                  ? <p className="mt-1 text-xs text-amber-700">Şu anda uygun ziyaretçi kartı yok.</p>
                  : (
                    <Select id="security-checkin-card" className="mt-1" value={selectedCardId} onChange={(event) => setSelectedCardId(event.target.value)}>
                      <option value="" disabled>Kart seçin</option>
                      {availableCards.map((card) => <option key={card.id} value={card.id}>{card.cardNumber}</option>)}
                    </Select>
                  )}
            </div>
            <div>
              <Label htmlFor="security-checkin-plate">Plaka (opsiyonel)</Label>
              <Input id="security-checkin-plate" className="mt-1" value={plate} onChange={(event) => setPlate(event.target.value)} />
            </div>
            {!currentVisit.visitor.phone && (
              <div>
                <Label htmlFor="security-checkin-phone">Telefon (opsiyonel)</Label>
                <Input id="security-checkin-phone" type="tel" placeholder="05XX XXX XX XX" className="mt-1" value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
            )}
          </div>

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>İptal</Button>
            <Button type="button" disabled={submitDisabled} onClick={() => void submit()}>{submitting ? "Giriş yapılıyor…" : "Giriş yap"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecurityVisitorCorrectionDialog
        visit={currentVisit}
        open={showCorrection}
        onOpenChange={setShowCorrection}
        onSaved={(updated) => setCurrentVisit(updated)}
      />
    </>
  )
}
