import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, InternalDialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { GoodsMovement } from "@/domain/goods-movements"
import type { VisitReferenceData } from "@/domain/visits"
import { formatTr } from "@/lib/date"
import { goodsMovementService } from "@/services"
import { plannedGoodsDeliveryFormSchema, toPlannedGoodsDeliveryInput, type PlannedGoodsDeliveryFormValues } from "./planned-goods-delivery-form-schema"

function getDefaults(references: VisitReferenceData | null, selectedDate: Date): PlannedGoodsDeliveryFormValues {
  const employee = references?.currentEmployee
  return {
    companyId: employee?.companyId ?? references?.companies[0]?.id ?? "",
    facilityId: employee?.facilityId ?? "",
    plannedDate: formatTr(selectedDate, "yyyy-MM-dd"),
    counterpartyName: "",
    goodsDescription: "",
  }
}

export function PlannedGoodsDeliveryDialog({ open, onOpenChange, references, selectedDate, onSaved }: {
  open: boolean
  onOpenChange(open: boolean): void
  references: VisitReferenceData | null
  selectedDate: Date
  onSaved(movement: GoodsMovement): void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<PlannedGoodsDeliveryFormValues>({
    resolver: zodResolver(plannedGoodsDeliveryFormSchema),
    defaultValues: getDefaults(references, selectedDate),
  })
  const companyId = form.watch("companyId")
  const facilities = useMemo(
    () => references?.facilities.filter((facility) => facility.companyId === companyId) ?? [],
    [companyId, references],
  )

  useEffect(() => {
    if (!open) return
    form.reset(getDefaults(references, selectedDate))
    setSubmitError(null)
  }, [form, open, references, selectedDate])

  const submit = async (values: PlannedGoodsDeliveryFormValues) => {
    setSubmitError(null)
    try {
      onSaved(await goodsMovementService.createGoodsMovement(toPlannedGoodsDeliveryInput(values)))
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Mal teslimatı kaydedilemedi.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <InternalDialogContent className="!w-[min(560px,calc(100vw-2rem))] !max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b bg-white px-5 pb-3 pt-4 pr-12">
          <DialogTitle>Yeni mal teslimatı</DialogTitle>
          <DialogDescription>Fabrikaya gün içinde gelmesi beklenen malı kaydedin.</DialogDescription>
        </DialogHeader>
        <form id="planned-goods-delivery-form" className="grid gap-3 px-5 py-4 sm:grid-cols-2" onSubmit={form.handleSubmit(submit)} noValidate>
          <Field label="Şirket" error={form.formState.errors.companyId?.message}>
            <Select {...form.register("companyId", { onChange: () => form.setValue("facilityId", "") })}>
              <option value="" disabled hidden>Şirket seçin</option>
              {references?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </Select>
          </Field>
          <Field label="Fabrika / tesis" error={form.formState.errors.facilityId?.message}>
            <Select {...form.register("facilityId")} disabled={!companyId}>
              <option value="" disabled hidden>Tesis seçin</option>
              {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
            </Select>
          </Field>
          <Field label="Planlanan gün" error={form.formState.errors.plannedDate?.message}>
            <Input type="date" {...form.register("plannedDate")} />
          </Field>
          <Field label="Gönderici firma" error={form.formState.errors.counterpartyName?.message}>
            <Input {...form.register("counterpartyName")} />
          </Field>
          <Field label="Gelecek mal / teslimat açıklaması" error={form.formState.errors.goodsDescription?.message} className="sm:col-span-2">
            <Textarea rows={3} {...form.register("goodsDescription")} />
          </Field>
          {submitError && <p className="text-xs text-red-700 sm:col-span-2" role="alert">{submitError}</p>}
        </form>
        <DialogFooter className="border-t bg-card px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button type="submit" form="planned-goods-delivery-form" disabled={form.formState.isSubmitting}>Kaydı oluştur</Button>
        </DialogFooter>
      </InternalDialogContent>
    </Dialog>
  )
}

function Field({ label, error, className, children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return <div className={className}><Label className="text-xs">{label}<span className="ml-0.5 text-red-600">*</span></Label><div className="mt-1">{children}</div>{error && <p className="mt-1 text-xs text-red-600">{error}</p>}</div>
}
