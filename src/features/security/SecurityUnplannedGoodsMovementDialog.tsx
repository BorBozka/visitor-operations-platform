import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { GoodsMovement, GoodsMovementDirection } from "@/domain/goods-movements"
import { goodsMovementService } from "@/services"

interface SecurityUnplannedGoodsMovementDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  onCreated(movement: GoodsMovement): void
  scope: { companyId: string; facilityId: string }
}

const emptyDraft = () => ({
  direction: "INBOUND" as GoodsMovementDirection,
  counterpartyName: "",
  goodsDescription: "",
  referenceNumber: "",
  actualPlate: "",
  actualDriverName: "",
})

export function SecurityUnplannedGoodsMovementDialog({ open, onOpenChange, onCreated, scope }: SecurityUnplannedGoodsMovementDialogProps) {
  const [draft, setDraft] = useState(emptyDraft)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setDraft(emptyDraft())
    setError("")
    setSubmitting(false)
  }, [open])

  const update = <K extends keyof ReturnType<typeof emptyDraft>>(key: K, value: ReturnType<typeof emptyDraft>[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const submit = async () => {
    if (!draft.counterpartyName.trim()) { setError(draft.direction === "INBOUND" ? "Gönderen firma zorunludur." : "Alıcı firma zorunludur."); return }
    if (!draft.goodsDescription.trim()) { setError("Mal / açıklama zorunludur."); return }

    setSubmitting(true)
    setError("")
    try {
      const movement = await goodsMovementService.createUnplannedGoodsMovement({
        direction: draft.direction,
        counterpartyName: draft.counterpartyName,
        goodsDescription: draft.goodsDescription,
        referenceNumber: draft.referenceNumber || undefined,
        actualPlate: draft.actualPlate || undefined,
        actualDriverName: draft.actualDriverName || undefined,
        ...scope,
      })
      onCreated(movement)
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Plansız mal hareketi kaydedilemedi.")
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <DialogContent className="max-w-md" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Plansız mal hareketi</DialogTitle>
          <DialogDescription>Kapıda şu anda gerçekleşen bir hareketi kaydedin.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-1">
          <legend className="px-1 text-xs font-medium text-slate-700">Yön <span className="text-destructive">*</span></legend>
          <div className="flex gap-1.5">
            <Button type="button" variant={draft.direction === "INBOUND" ? "default" : "outline"} className="h-8 flex-1 text-xs" onClick={() => update("direction", "INBOUND")}>Gelen</Button>
            <Button type="button" variant={draft.direction === "OUTBOUND" ? "default" : "outline"} className="h-8 flex-1 text-xs" onClick={() => update("direction", "OUTBOUND")}>Giden</Button>
          </div>
        </fieldset>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label={draft.direction === "INBOUND" ? "Gönderen firma" : "Alıcı firma"} required>
            <Input autoFocus value={draft.counterpartyName} onChange={(event) => update("counterpartyName", event.target.value)} />
          </Field>
          <Field label="Referans"><Input value={draft.referenceNumber} onChange={(event) => update("referenceNumber", event.target.value)} /></Field>
          <Field label="Mal / açıklama" className="sm:col-span-2"><Input value={draft.goodsDescription} onChange={(event) => update("goodsDescription", event.target.value)} /></Field>
          <Field label="Plaka"><Input value={draft.actualPlate} onChange={(event) => update("actualPlate", event.target.value)} /></Field>
          <Field label="Şoför adı"><Input value={draft.actualDriverName} onChange={(event) => update("actualDriverName", event.target.value)} /></Field>
        </div>
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>İptal</Button>
          <Button type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? "Kaydediliyor…" : "Kaydet"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, required = false, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={`space-y-1 ${className ?? ""}`}><Label>{label}{required && <span className="text-destructive"> *</span>}</Label>{children}</div>
}
