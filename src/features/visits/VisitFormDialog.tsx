import { zodResolver } from "@hookform/resolvers/zod"
import { addHours, setMinutes } from "date-fns"
import { Plus, Send, Trash2 } from "lucide-react"
import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react"
import { type FieldErrors, type FieldPath, useFieldArray, useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  InternalDialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { hasVisitorEmail, type InvitationStatus, type Visit } from "@/domain/visits"
import { HostEmployeeCombobox } from "@/features/visits/HostEmployeeCombobox"
import { getInvitationSendFeedback } from "@/features/visits/invitation-send-feedback"
import { getInvitationActionLabel, isInvitationRetryable } from "@/features/visits/invitation-status"
import { useVisits } from "@/features/visits/visit-context"
import { toMeetingInput, visitFormSchema, type VisitFormValues } from "@/features/visits/visit-form-schema"
import { formatTr } from "@/lib/date"
import { formatLocalVisitorPhone } from "@/lib/phone"

const invitationStatusLabels: Record<InvitationStatus, string> = {
  NOT_SENT: "Gönderilmedi",
  SENDING: "Gönderiliyor",
  SENT: "Gönderildi",
  FAILED: "Gönderilemedi",
}

function getPhoneDefaults(phone?: string) {
  return { visitorPhone: phone ? formatLocalVisitorPhone(phone) : "" }
}

function blankVisitor() {
  return {
    visitId: undefined,
    visitorFirstName: "",
    visitorLastName: "",
    visitorEmail: "",
    visitorCompany: "",
    visitorPhone: "",
  }
}

function defaultsFor(visits: Visit[] = []): VisitFormValues {
  const visit = visits[0]
  const roundedNow = setMinutes(addHours(new Date(), 1), 0)
  const end = addHours(roundedNow, 1)
  return {
    visitors: visits.length > 0
      ? visits.map((item) => ({
          visitId: item.id,
          visitorFirstName: item.visitor.firstName,
          visitorLastName: item.visitor.lastName,
          visitorEmail: item.visitor.email ?? "",
          visitorCompany: item.visitor.company,
          ...getPhoneDefaults(item.visitor.phone),
        }))
      : [blankVisitor()],
    visitTypeId: visit?.visitTypeId ?? "",
    hostEmployeeId: visit?.hostEmployeeId ?? "",
    hostEmployeeName: visit?.hostEmployeeName ?? "",
    hostCompanyId: visit?.hostCompanyId ?? "",
    facilityId: visit?.facilityId ?? "",
    visitDate: formatTr(visit ? new Date(visit.plannedStart) : roundedNow, "yyyy-MM-dd"),
    startTime: formatTr(visit ? new Date(visit.plannedStart) : roundedNow, "HH:mm"),
    endTime: formatTr(visit ? new Date(visit.plannedEnd) : end, "HH:mm"),
    note: visit?.note ?? "",
    hasAdditionalRequirements: visit?.hasAdditionalRequirements ?? false,
    additionalRequirementNote: visit?.additionalRequirementNote ?? "",
  }
}

function findFirstErrorPath(errors: FieldErrors<VisitFormValues>, prefix = ""): FieldPath<VisitFormValues> | undefined {
  for (const [key, value] of Object.entries(errors)) {
    if (!value) continue
    const path = prefix ? `${prefix}.${key}` : key
    if ("message" in value && value.message) return path as FieldPath<VisitFormValues>
    const nested = findFirstErrorPath(value as FieldErrors<VisitFormValues>, path)
    if (nested) return nested
  }
  return undefined
}

interface VisitFormDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  visit?: Visit
  invitationScope?: "MEETING" | "VISIT"
  onSaved(message: string): void
}

export function VisitFormDialog({ open, onOpenChange, visit, invitationScope = "MEETING", onSaved }: VisitFormDialogProps) {
  const {
    visits,
    referenceData,
    createMeeting,
    updateMeeting,
    sendMeetingInvitations,
    sendVisitInvitation,
  } = useVisits()
  const meetingVisits = useMemo(
    () => visit ? visits.filter((item) => item.meetingId === visit.meetingId) : [],
    [visit, visits],
  )
  const initialVisits = useMemo(
    () => meetingVisits.length > 0 ? meetingVisits : visit ? [visit] : [],
    [meetingVisits, visit],
  )
  const initialVisitsRef = useRef(initialVisits)
  initialVisitsRef.current = initialVisits
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [saveNoticeTone, setSaveNoticeTone] = useState<"info" | "success">("success")
  const [savedMeetingId, setSavedMeetingId] = useState<string | null>(visit?.meetingId ?? null)
  const [savedVisits, setSavedVisits] = useState<Visit[]>(initialVisits)
  const [isSendingInvitation, setIsSendingInvitation] = useState(false)
  const [showValidationErrors, setShowValidationErrors] = useState(false)
  const [noteEnabled, setNoteEnabled] = useState(Boolean(visit?.note))
  const form = useForm<VisitFormValues>({ resolver: zodResolver(visitFormSchema), defaultValues: defaultsFor(initialVisits), mode: "onChange" })
  const visitorFields = useFieldArray({ control: form.control, name: "visitors" })
  const companyId = form.watch("hostCompanyId")
  const facilityId = form.watch("facilityId")
  const hostEmployeeId = form.watch("hostEmployeeId")
  const hasAdditionalRequirements = form.watch("hasAdditionalRequirements")
  const note = form.watch("note")
  const hostEmployeeField = form.register("hostEmployeeId")

  // The scoped roster changes with company/facility, so a previously picked host
  // no longer belongs once either changes.
  const clearHostEmployee = () => {
    form.setValue("hostEmployeeId", "", { shouldDirty: true, shouldValidate: true })
    form.setValue("hostEmployeeName", "", { shouldDirty: true, shouldValidate: true })
  }
  const invitationHelpId = useId()
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const formContentRef = useRef<HTMLDivElement | null>(null)
  const { ref: noteFieldRef, ...noteField } = form.register("note")

  useEffect(() => {
    if (open) {
      const nextInitialVisits = initialVisitsRef.current
      form.reset(defaultsFor(nextInitialVisits))
      setSubmitError(null)
      setSaveNotice(null)
      setSaveNoticeTone("success")
      setSavedMeetingId(visit?.meetingId ?? null)
      setSavedVisits(nextInitialVisits)
      setIsSendingInvitation(false)
      setShowValidationErrors(false)
      setNoteEnabled(Boolean(visit?.note))
    }
  }, [form, open, visit?.meetingId, visit?.note])

  useEffect(() => {
    const textarea = noteTextareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [note])

  useEffect(() => {
    if (!form.formState.isDirty) return
    setSaveNotice(null)
    setSaveNoticeTone("success")
    setSubmitError(null)
  }, [form.formState.isDirty])

  const facilities = useMemo(
    () => referenceData?.facilities.filter((facility) => facility.companyId === companyId) ?? [],
    [companyId, referenceData],
  )

  const scrollToNextFields = () => {
    window.requestAnimationFrame(() => formContentRef.current?.scrollBy({ top: 160, behavior: "smooth" }))
  }

  const saveVisit = async (values: VisitFormValues) => {
    setSubmitError(null)
    try {
      const saved = savedMeetingId
        ? await updateMeeting(savedMeetingId, toMeetingInput(values))
        : await createMeeting(toMeetingInput(values))
      setSavedMeetingId(saved.meeting.id)
      setSavedVisits(saved.visits)
      form.reset(defaultsFor(saved.visits))
      await form.trigger()
      const message = saved.visits.length === 1
        ? "Ziyaret kaydedildi. Davet henüz gönderilmedi."
        : `${saved.visits.length} ziyaret kaydedildi. Davetler henüz gönderilmedi.`
      setSaveNotice(message)
      setSaveNoticeTone("success")
      onSaved(message)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Ziyaret kaydedilemedi.")
    }
  }

  const onInvalidSave = (errors: FieldErrors<VisitFormValues>) => {
    setShowValidationErrors(true)
    const firstInvalidField = findFirstErrorPath(errors)
    if (firstInvalidField) window.requestAnimationFrame(() => form.setFocus(firstInvalidField))
  }

  const onSave = form.handleSubmit(saveVisit, onInvalidSave)

  const selectedVisit = savedVisits.find((item) => item.id === visit?.id) ?? savedVisits[0]
  const sendInvitation = async () => {
    if (!savedMeetingId || form.formState.isDirty || isSendingInvitation) return

    setIsSendingInvitation(true)
    setSubmitError(null)
    try {
      const results = invitationScope === "VISIT" && selectedVisit
        ? [await sendVisitInvitation(selectedVisit.id)]
        : await sendMeetingInvitations(savedMeetingId)
      const resultById = new Map(results.map((item) => [item.id, item]))
      const nextSavedVisits = savedVisits.map((item) => resultById.get(item.id) ?? item)
      setSavedVisits(nextSavedVisits)
      const feedback = getInvitationSendFeedback(results)
      if (feedback.kind === "error") {
        setSubmitError(feedback.message)
        return
      }
      if (feedback.kind === "mixed") {
        setSaveNotice(feedback.message)
        setSaveNoticeTone("success")
        setSubmitError(feedback.message)
        return
      }
      setSaveNotice(feedback.message)
      setSaveNoticeTone(feedback.kind)
      if (feedback.kind === "success") onSaved(feedback.message)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Davet gönderilemedi.")
    } finally {
      setIsSendingInvitation(false)
    }
  }

  const invitationTargets = invitationScope === "VISIT" && selectedVisit ? [selectedVisit] : savedVisits
  const pendingInvitationCount = invitationTargets.filter((item) => item.status === "PLANNED" && hasVisitorEmail(item.visitor) && isInvitationRetryable(item)).length
  const hasPendingInvitation = pendingInvitationCount > 0
  // Only a send actually in flight blocks the button. A `SENDING` record the backend has marked
  // stale lost its attempt to a process restart, and blocking on it would leave this dialog
  // permanently unable to send — for that record or for any other visitor on the same meeting.
  const hasSendingInvitation = invitationTargets.some((item) => item.invitationStatus === "SENDING" && !item.invitationSendStale)
  const canSendInvitation = Boolean(savedMeetingId) && !form.formState.isDirty && hasPendingInvitation && !hasSendingInvitation && !isSendingInvitation
  const invitationDisabledReason = !savedMeetingId
    ? "Davet göndermek için önce ziyareti kaydedin."
    : form.formState.isDirty
      ? "Davet göndermek için değişiklikleri kaydedin."
      : isSendingInvitation || hasSendingInvitation
        ? "Davet gönderiliyor."
        : !hasPendingInvitation
          ? "Gönderilmeyi bekleyen davet yok."
          : invitationScope === "VISIT"
            ? "Bu ziyaretçinin daveti gönderilmeye hazır."
            : "Gönderilmemiş davetler gönderilmeye hazır."
  const invitationActionLabel = invitationScope === "VISIT" && selectedVisit
    ? getInvitationActionLabel(selectedVisit, isSendingInvitation)
    : isSendingInvitation
      ? "Gönderiliyor…"
      : pendingInvitationCount > 1
        ? `${pendingInvitationCount} Daveti Gönder`
        : "Daveti Gönder"

  const fieldError = (name: FieldPath<VisitFormValues>) => {
    const message = form.getFieldState(name).error?.message
    return showValidationErrors && message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <InternalDialogContent className="!max-h-[85vh] !w-[min(820px,calc(100vw-2rem))] !max-w-none flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b bg-white px-5 pb-3 pt-3 pr-12">
          <DialogTitle>{visit ? "Ziyareti düzenle" : "Yeni ziyaret"}</DialogTitle>
          <DialogDescription>
            {visit ? "Bu ziyaretin bilgilerini güncelleyin." : "Tesise gelecek ziyaretçiler için ziyaret kaydı oluşturun."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSave} className="flex min-h-0 flex-col" noValidate>
          <div ref={formContentRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 scrollbar-thin">
            <section className="space-y-3" aria-labelledby="visitors-heading">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 pb-1.5">
                <div>
                  <h3 id="visitors-heading" className="text-xs font-semibold text-slate-700">Ziyaretçiler</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">Her kişi için ayrı bir ziyaret kaydı oluşturulur.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => visitorFields.append(blankVisitor(), { focusName: `visitors.${visitorFields.fields.length}.visitorFirstName` })}
                >
                  <Plus />Ziyaretçi Ekle
                </Button>
              </div>

              {visitorFields.fields.map((field, index) => {
                const canRemove = visitorFields.fields.length > 1 && !field.visitId
                const { ref: phoneFieldRef, onChange: onPhoneChange, ...phoneField } = form.register(`visitors.${index}.visitorPhone`)
                return (
                  <div key={field.id} className="space-y-2.5 rounded-md border border-slate-200/80 bg-slate-50/20 p-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-xs font-semibold text-slate-700">Ziyaretçi {index + 1}</h4>
                      {canRemove && (
                        <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-red-50 hover:text-destructive" onClick={() => visitorFields.remove(index)} aria-label={`Ziyaretçi ${index + 1} kaydını kaldır`}>
                          <Trash2 />Ziyaretçiyi Kaldır
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                      <FormField label="Ad" required error={fieldError(`visitors.${index}.visitorFirstName`)}>
                        <Input autoFocus={index === 0} {...form.register(`visitors.${index}.visitorFirstName`)} />
                      </FormField>
                      <FormField label="Soyad" required error={fieldError(`visitors.${index}.visitorLastName`)}>
                        <Input {...form.register(`visitors.${index}.visitorLastName`)} />
                      </FormField>
                      <FormField label="E-posta (opsiyonel)" error={fieldError(`visitors.${index}.visitorEmail`)}>
                        <Input type="email" placeholder="ziyaretci@firma.com" {...form.register(`visitors.${index}.visitorEmail`)} />
                      </FormField>
                      <FormField label="Ziyaretçi Şirketi" required error={fieldError(`visitors.${index}.visitorCompany`)}>
                        <Input {...form.register(`visitors.${index}.visitorCompany`)} />
                      </FormField>
                      <FormField label="Telefon (opsiyonel)" error={fieldError(`visitors.${index}.visitorPhone`)}>
                        <Input
                          {...phoneField}
                          ref={phoneFieldRef}
                          type="tel"
                          inputMode="numeric"
                          maxLength={14}
                          placeholder="05XX XXX XX XX"
                          onChange={(event) => {
                            event.target.value = formatLocalVisitorPhone(event.target.value)
                            onPhoneChange(event)
                          }}
                        />
                      </FormField>
                    </div>
                    {field.visitId && visitorFields.fields.length > 1 && (
                      <p className="text-[11px] text-slate-500">Kaydedilmiş ziyaretçi silinmez; gerektiğinde ziyaret detayından ayrı olarak iptal edilir.</p>
                    )}
                  </div>
                )
              })}
            </section>

            <section className="space-y-2.5" aria-labelledby="visit-details-heading">
              <div className="flex items-baseline gap-2 border-b border-slate-200/70 pb-1.5">
                <h3 id="visit-details-heading" className="text-sm font-semibold text-slate-900">Ziyaret Bilgileri</h3>
                <span className="text-[11px] text-slate-500">Tüm ziyaretçiler için ortak</span>
              </div>
              <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
                <FormField label="Ziyaret Türü" required error={fieldError("visitTypeId")}>
                  <Select {...form.register("visitTypeId", { onChange: scrollToNextFields })}>
                    <option value="" disabled hidden>Ziyaret türü seçin</option>
                    {referenceData?.visitTypes
                      .filter((type) => type.active || type.id === visit?.visitTypeId)
                      .map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                  </Select>
                </FormField>
                <FormField label="Ziyaret Edilecek Şirket" required error={fieldError("hostCompanyId")}>
                  <Select
                    {...form.register("hostCompanyId", {
                      onChange: () => {
                        form.setValue("facilityId", "", { shouldDirty: true, shouldValidate: true })
                        clearHostEmployee()
                        scrollToNextFields()
                      },
                    })}
                  >
                    <option value="" disabled hidden>Şirket seçin</option>
                    {referenceData?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </Select>
                </FormField>
                <FormField label="Tesis" required error={fieldError("facilityId")}>
                  <Select {...form.register("facilityId", { onChange: clearHostEmployee })} disabled={!companyId}>
                    <option value="" disabled hidden>Tesis seçin</option>
                    {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
                  </Select>
                </FormField>
                <FormField label="İlgili Personel" required error={fieldError("hostEmployeeId")}>
                  <HostEmployeeCombobox
                    ref={hostEmployeeField.ref}
                    name={hostEmployeeField.name}
                    employees={referenceData?.employees ?? []}
                    companyId={companyId}
                    facilityId={facilityId}
                    value={hostEmployeeId}
                    selectedName={visit?.hostEmployeeName}
                    disabled={!companyId || !facilityId}
                    invalid={showValidationErrors && Boolean(form.getFieldState("hostEmployeeId").error)}
                    onChange={(employeeId, employeeName) => {
                      form.setValue("hostEmployeeId", employeeId, { shouldDirty: true, shouldValidate: true })
                      form.setValue("hostEmployeeName", employeeName, { shouldDirty: true, shouldValidate: true })
                    }}
                  />
                </FormField>
                <FormField label="Tarih" required error={fieldError("visitDate")}>
                  <Input type="date" {...form.register("visitDate")} />
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Başlangıç" required error={fieldError("startTime")}>
                    <Input type="time" {...form.register("startTime")} />
                  </FormField>
                  <FormField label="Bitiş" required error={fieldError("endTime")}>
                    <Input type="time" {...form.register("endTime")} />
                  </FormField>
                </div>
              </div>
            </section>

            <section className="space-y-2.5 border-t border-slate-200/60 pt-3" aria-label="Ek Bilgiler">
              <OptionalNote
                expanded={hasAdditionalRequirements}
                label="İlave gereksinim var"
                hint="İnsan kaynakları ve bilgi işleme iletilir: toplantı odası, projeksiyon, erişim izni gibi hazırlıklar."
                checkbox={<input type="checkbox" className={checkboxClassName} {...form.register("hasAdditionalRequirements")} />}
              >
                {hasAdditionalRequirements && (
                  <FormField label="İlave gereksinim notu" error={fieldError("additionalRequirementNote")}>
                    <Textarea rows={2} className="min-h-16 resize-y" placeholder="Toplantı odasında projeksiyon hazır olmalı." {...form.register("additionalRequirementNote")} />
                  </FormField>
                )}
              </OptionalNote>

              <OptionalNote
                expanded={noteEnabled}
                label="Güvenlik notu var"
                hint="Güvenlik görevlisi giriş anında görür: karşılama, araç, kargo gibi bilgiler."
                checkbox={
                  <input
                    type="checkbox"
                    className={checkboxClassName}
                    checked={noteEnabled}
                    onChange={(event) => {
                      setNoteEnabled(event.target.checked)
                      if (!event.target.checked) form.setValue("note", "", { shouldDirty: true })
                    }}
                  />
                }
              >
                {noteEnabled && (
                  <FormField label="Güvenlik notu" error={fieldError("note")}>
                    <Textarea
                      {...noteField}
                      ref={(element) => {
                        noteFieldRef(element)
                        noteTextareaRef.current = element
                      }}
                      rows={2}
                      className="min-h-16 resize-y"
                      placeholder="Ziyaretçi yan kapıdan gelecek, kargo teslimatı var."
                    />
                  </FormField>
                )}
              </OptionalNote>
            </section>

            {savedVisits.length > 0 && savedMeetingId && (
              <section className="space-y-2.5" aria-labelledby="invitation-status-heading">
                <div className="flex items-baseline gap-2 border-b border-slate-200/70 pb-1.5">
                  <h3 id="invitation-status-heading" className="text-sm font-semibold text-slate-900">Davet Durumu</h3>
                </div>
                <ul className="grid gap-1.5 border-b border-slate-200 pb-2.5 text-xs" aria-label="Ziyaretçi davet durumları">
                  {savedVisits.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium text-slate-700">{item.visitor.firstName} {item.visitor.lastName}</span>
                      {hasVisitorEmail(item.visitor)
                        ? (
                          <span className={item.invitationStatus === "FAILED" ? "font-semibold text-red-700" : item.invitationStatus === "SENT" ? "font-semibold text-emerald-700" : "font-medium text-amber-700"}>
                            {invitationStatusLabels[item.invitationStatus]}
                          </span>
                        )
                        : <span className="font-medium text-slate-500">E-posta yok</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {submitError && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{submitError}</p>}
            {saveNotice && <p className={saveNoticeTone === "success" ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"} role="status">{saveNotice}</p>}
          </div>

          <DialogFooter className="shrink-0 items-stretch border-t bg-card px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p id={invitationHelpId} className="text-xs text-slate-500" aria-live="polite">{invitationDisabledReason}</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <Button
                type="button"
                variant="outline"
                disabled={form.formState.isSubmitting || isSendingInvitation}
                onClick={() => onOpenChange(false)}
              >
                Vazgeç
              </Button>
              <Button
                type="submit"
                disabled={
                  form.formState.isSubmitting ||
                  isSendingInvitation ||
                  !form.formState.isValid ||
                  (Boolean(savedMeetingId) && !form.formState.isDirty)
                }
              >
                {form.formState.isSubmitting ? "Kaydediliyor…" : "Ziyareti Kaydet"}
              </Button>
              {savedMeetingId && hasPendingInvitation && (
                <Button
                  type="button"
                  className="col-span-2 sm:col-span-1"
                  onClick={() => void sendInvitation()}
                  disabled={!canSendInvitation || form.formState.isSubmitting}
                  aria-describedby={invitationHelpId}
                  aria-label={`${invitationActionLabel}. ${invitationDisabledReason}`}
                >
                  <Send />
                  {invitationActionLabel}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </InternalDialogContent>
    </Dialog>
  )
}

const checkboxClassName =
  "mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/**
 * A checkbox that reveals an optional note, with a line naming who actually reads
 * it. The two notes on this form go to different teams, and without that line the
 * only difference visible to the user was the field label.
 *
 * Both toggles sit at the bottom of a scrolling form, so ticking one brings the
 * revealed field into view and focuses it — otherwise the user has to scroll to
 * reach the box they just asked for.
 */
function OptionalNote({
  label,
  hint,
  expanded,
  checkbox,
  children,
}: {
  label: string
  hint: string
  expanded: boolean
  checkbox: React.ReactNode
  children: React.ReactNode
}) {
  const hintId = useId()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const wasExpanded = useRef(expanded)

  useEffect(() => {
    // Only react to the user opening it, never to a dialog that opens already filled in.
    if (expanded && !wasExpanded.current) {
      const field = bodyRef.current?.querySelector("textarea")
      field?.focus({ preventScroll: true })
      field?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      })
    }
    wasExpanded.current = expanded
  }, [expanded])

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-start gap-2">
        {isValidElement<{ "aria-describedby"?: string }>(checkbox) ? cloneElement(checkbox, { "aria-describedby": hintId }) : checkbox}
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-700">{label}</span>
          <span id={hintId} className="mt-0.5 block text-[11px] leading-4 text-slate-500">{hint}</span>
        </span>
      </label>
      <div ref={bodyRef}>{children}</div>
    </div>
  )
}

function FormField({
  label,
  required,
  error,
  className,
  children,
}: {
  label: string
  required?: boolean
  error?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const id = useId()
  const control = isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children
  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}{required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
      </Label>
      <div className="mt-1">{control}</div>
      {error}
    </div>
  )
}
