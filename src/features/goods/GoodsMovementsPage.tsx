import { zodResolver } from "@hookform/resolvers/zod"
import { startOfDay, endOfDay } from "date-fns"
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, ChevronDown, FilterX, Pencil, Plus, Search, XCircle } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { PaginationFooter } from "@/components/common/PaginationFooter"
import { QuickDateRangeSelect } from "@/components/common/QuickDateRangeSelect"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, InternalDialogContent } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { getGoodsCompletionLabel, getGoodsCounterpartyLabel, getGoodsDirectionLabel, getGoodsMovementDisplayStatus, type GoodsMovement, type GoodsMovementDirection, type GoodsMovementInput } from "@/domain/goods-movements"
import { goodsMovementFormSchema, type GoodsMovementFormValues } from "@/features/goods/goods-movement-form-schema"
import { getGoodsPageCount, getVisibleGoodsPageNumbers, GOODS_PAGE_SIZE, paginateGoodsMovements, sortGoodsMovements, toggleGoodsSort, type Sort, type SortField } from "@/features/goods/goods-movement-sorting"
import { useVisits } from "@/features/visits/visit-context"
import { formatTr } from "@/lib/date"
import { getQuickDateRangeOptions } from "@/lib/quick-date-range"
import { useFillViewportHeight } from "@/lib/use-fill-viewport-height"
import { cn } from "@/lib/utils"
import { goodsMovementService } from "@/services"

const empty = { direction: "", companyId: "", facilityId: "", plannedDate: "", plannedTime: "", counterpartyName: "", goodsDescription: "", referenceNumber: "", note: "" } as unknown as GoodsMovementFormValues
type Filters = { query: string; from: string; to: string; companyId: string; facilityId: string; direction: "all" | GoodsMovementDirection; status: "all" | "PLANNED" | "COMPLETED" | "CANCELLED" | "LATE" }
const initialFilters: Filters = { query: "", from: "", to: "", companyId: "all", facilityId: "all", direction: "all", status: "all" }

export function GoodsMovementsPage() {
  const { referenceData, isLoading } = useVisits(); const [movements, setMovements] = useState<GoodsMovement[]>([]); const [filters, setFilters] = useState<Filters>(initialFilters); const [sorts, setSorts] = useState<Sort[]>([]); const [page, setPage] = useState(1); const [editing, setEditing] = useState<GoodsMovement | null>(null); const [viewing, setViewing] = useState<GoodsMovement | null>(null); const [formOpen, setFormOpen] = useState(false); const [error, setError] = useState<string | null>(null); const [now] = useState(() => new Date()); const [movementsLoading, setMovementsLoading] = useState(true); const [loadError, setLoadError] = useState<string | null>(null); const [reloadToken, setReloadToken] = useState(0)
  // A rejected list load must never render as a real "no records" result, so it keeps its own state.
  useEffect(() => {
    let cancelled = false
    setMovementsLoading(true)
    setLoadError(null)
    void goodsMovementService.listGoodsMovements()
      .then((next) => { if (!cancelled) setMovements(next) })
      .catch((reason) => { if (cancelled) return; setMovements([]); setLoadError(reason instanceof Error ? reason.message : "Mal hareketleri yüklenemedi. Lütfen tekrar deneyin.") })
      .finally(() => { if (!cancelled) setMovementsLoading(false) })
    return () => { cancelled = true }
  }, [reloadToken])
  const facilities = useMemo(() => referenceData?.facilities.filter((item) => filters.companyId === "all" || item.companyId === filters.companyId) ?? [], [filters.companyId, referenceData])
  const quickRanges = getQuickDateRangeOptions(now)
  const filteredRows = useMemo(() => sortGoodsMovements(movements.filter((item) => { const status = getGoodsMovementDisplayStatus(item); const text = `${item.counterpartyName} ${item.goodsDescription} ${item.companyName} ${item.facilityName}`.toLocaleLowerCase("tr-TR"); const planned = new Date(`${item.plannedDate}T12:00:00`); return (!filters.query || text.includes(filters.query.toLocaleLowerCase("tr-TR"))) && (filters.companyId === "all" || item.companyId === filters.companyId) && (filters.facilityId === "all" || item.facilityId === filters.facilityId) && (filters.direction === "all" || item.direction === filters.direction) && (filters.status === "all" || status === filters.status) && (!filters.from || planned >= startOfDay(new Date(`${filters.from}T12:00:00`))) && (!filters.to || planned <= endOfDay(new Date(`${filters.to}T12:00:00`))) }), sorts), [filters, movements, sorts])
  const pageCount = getGoodsPageCount(filteredRows.length)
  const visiblePage = Math.min(page, pageCount)
  const rows = paginateGoodsMovements(filteredRows, visiblePage)
  const visibleStart = filteredRows.length === 0 ? 0 : (visiblePage - 1) * GOODS_PAGE_SIZE + 1
  const visibleEnd = Math.min(visiblePage * GOODS_PAGE_SIZE, filteredRows.length)
  const { ref: recordsCardViewportRef, height: recordsCardHeight } = useFillViewportHeight(14, [filteredRows.length])
  useEffect(() => { setPage(1) }, [filters, sorts])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  if (isLoading || !referenceData) return <div className="h-64 animate-pulse rounded-lg border bg-slate-100" />
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }))
  const setRange = (from: string, to: string) => setFilters((current) => ({ ...current, from, to }))
  const activeFilters = Boolean(filters.query.trim() || filters.from || filters.to || filters.companyId !== "all" || filters.facilityId !== "all" || filters.direction !== "all" || filters.status !== "all" || sorts.length > 0)
  const cancel = async (item: GoodsMovement) => { try { const saved = await goodsMovementService.cancelGoodsMovement(item.id); setMovements((current) => current.map((row) => row.id === saved.id ? saved : row)); setViewing(null) } catch (e) { setError(e instanceof Error ? e.message : "Kayıt iptal edilemedi.") } }
  return (
    <>
      <h1 className="sr-only">Mal Giriş / Çıkış</h1>
      <div className="min-w-0 space-y-3 md:space-y-3.5">
      <section className="rounded-lg border bg-card p-3 shadow-panel" aria-label="Mal hareketi filtreleri">
        <div className="flex items-center justify-between pb-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">MAL HAREKETİ FİLTRELERİ</span>
          {activeFilters && <Button type="button" variant="ghost" size="sm" className="h-5 gap-1 border-none px-1 text-[11px] font-medium text-slate-500 shadow-none hover:bg-transparent hover:text-slate-900" onClick={() => { setFilters(initialFilters); setSorts([]) }}><FilterX className="size-3 text-slate-500" />Filtreleri temizle</Button>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1.3fr)_repeat(7,minmax(105px,1fr))_auto]">
          <FilterField label="Arama" htmlFor="goods-search" className="sm:col-span-2 xl:col-span-1"><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="goods-search" value={filters.query} onChange={(event) => update("query", event.target.value)} placeholder="Mal veya karşı firma ara" className="h-9 pl-8 text-xs" /></div></FilterField>
          <FilterField label="Başlangıç" htmlFor="goods-from"><Input id="goods-from" type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} className="h-9 text-xs" /></FilterField>
          <FilterField label="Bitiş" htmlFor="goods-to"><Input id="goods-to" type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} className="h-9 text-xs" /></FilterField>
          <FilterField label="Hızlı tarih" htmlFor="goods-quick-range"><QuickDateRangeSelect id="goods-quick-range" options={quickRanges} startDate={filters.from} endDate={filters.to} onSelect={setRange} ariaLabel="Hızlı tarih aralığı" className="h-9" /></FilterField>
          <FilterField label="Şirket" htmlFor="goods-company"><FilterSelect id="goods-company" value={filters.companyId} emptyLabel="Tüm şirketler" options={referenceData.companies.map((item) => ({ value: item.id, label: item.name }))} onValueChange={(value) => { update("companyId", value); update("facilityId", "all") }} /></FilterField>
          <FilterField label="Tesis" htmlFor="goods-facility"><FilterSelect id="goods-facility" value={filters.facilityId} emptyLabel="Tüm tesisler" options={facilities.map((item) => ({ value: item.id, label: item.name }))} onValueChange={(value) => update("facilityId", value)} /></FilterField>
          <FilterField label="Yön" htmlFor="goods-direction"><FilterSelect id="goods-direction" value={filters.direction} emptyLabel="Tüm yönler" options={[{ value: "INBOUND", label: "Gelen" }, { value: "OUTBOUND", label: "Giden" }]} onValueChange={(value) => update("direction", value as Filters["direction"])} /></FilterField>
          <FilterField label="Durum" htmlFor="goods-status"><FilterSelect id="goods-status" value={filters.status} emptyLabel="Tüm durumlar" options={[{ value: "PLANNED", label: "Planlı" }, { value: "LATE", label: "Gecikti" }, { value: "COMPLETED", label: "Tamamlandı" }, { value: "CANCELLED", label: "İptal" }]} onValueChange={(value) => update("status", value as Filters["status"])} /></FilterField>
          <div className="flex flex-col justify-end"><Button type="button" className="h-9 w-full gap-1 text-xs" onClick={() => { setEditing(null); setError(null); setFormOpen(true) }}><Plus className="size-3.5" />Yeni kayıt</Button></div>
        </div>
      </section>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div ref={recordsCardViewportRef} className="min-h-0" style={recordsCardHeight !== undefined ? { height: recordsCardHeight } : undefined}>
      <section className={cn("scroll-mt-3 flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-lg border bg-card shadow-panel", recordsCardHeight === undefined && "min-h-[35.5rem]")} aria-label="Mal hareketleri">
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"><table className="h-full w-full min-w-[1000px] text-left text-xs"><thead className="border-b bg-slate-50 text-[11px] font-semibold text-slate-500"><tr><th className="px-3 py-2"><SortButton label="YÖN" field="direction" sorts={sorts} onToggle={(field) => setSorts((current) => toggleGoodsSort(current, field))} /></th><th className="px-3 py-2"><SortButton label="KARŞI FİRMA" field="counterparty" sorts={sorts} onToggle={(field) => setSorts((current) => toggleGoodsSort(current, field))} /></th><th className="px-3 py-2"><SortButton label="MAL / AÇIKLAMA" field="goods" sorts={sorts} onToggle={(field) => setSorts((current) => toggleGoodsSort(current, field))} /></th><th className="px-3 py-2"><SortButton label="ŞİRKET" field="companyFacility" sorts={sorts} onToggle={(field) => setSorts((current) => toggleGoodsSort(current, field))} /></th><th className="px-3 py-2"><SortButton label="PLANLANAN ZAMAN" field="plannedAt" sorts={sorts} onToggle={(field) => setSorts((current) => toggleGoodsSort(current, field))} /></th><th className="px-3 py-2"><SortButton label="GERÇEKLEŞEN ZAMAN" field="actualAt" sorts={sorts} onToggle={(field) => setSorts((current) => toggleGoodsSort(current, field))} /></th><th className="px-3 py-2"><SortButton label="DURUM" field="status" sorts={sorts} onToggle={(field) => setSorts((current) => toggleGoodsSort(current, field))} /></th></tr></thead><tbody className="divide-y">{rows.map((item) => <tr key={item.id} role="button" tabIndex={0} className="record-row-hover cursor-pointer transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600" onClick={() => setViewing(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewing(item) } }}><td className="px-3 py-1.5 sm:py-2"><Direction direction={item.direction} /></td><td className="px-3 py-1.5 sm:py-2 font-medium">{item.counterpartyName}</td><td className="px-3 py-1.5 sm:py-2">{item.goodsDescription}</td><td className="px-3 py-1.5 sm:py-2"><p>{item.companyName}</p></td><td className="whitespace-nowrap px-3 py-1.5 sm:py-2">{formatPlanned(item)}</td><td className="whitespace-nowrap px-3 py-1.5 sm:py-2">{item.actualAt ? formatTr(new Date(item.actualAt), "d MMM HH:mm") : "—"}</td><td className="px-3 py-1.5 sm:py-2"><Status movement={item} /></td></tr>)}{rows.length > 0 && Array.from({ length: Math.max(0, GOODS_PAGE_SIZE - rows.length) }).map((_, index) => <tr key={`filler-${index}`} aria-hidden="true" className={cn("pointer-events-none select-none", index > 0 && "border-transparent")}><td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td><td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td><td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td><td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td><td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td><td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td><td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td></tr>)}{rows.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-500">{loadError ? <span className="flex flex-col items-center gap-2"><span role="alert" className="text-red-700">{loadError}</span><Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setReloadToken((current) => current + 1)}>Tekrar dene</Button></span> : movementsLoading ? "Mal hareketleri yükleniyor…" : "Bu filtreler için kayıt yok."}</td></tr>}</tbody></table></div>
      <PaginationFooter page={visiblePage} pageCount={pageCount} visibleStart={visibleStart} visibleEnd={visibleEnd} total={filteredRows.length} visiblePageNumbers={getVisibleGoodsPageNumbers(visiblePage, pageCount)} onPageChange={setPage} ariaLabel="Mal hareketleri sayfaları" />
      </section>
      </div>
      <GoodsForm open={formOpen} movement={editing} references={referenceData} onOpenChange={setFormOpen} onSave={(saved) => { setMovements((current) => editing ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]); setFormOpen(false) }} />
      <Details movement={viewing} onOpenChange={(open) => !open && setViewing(null)} onEdit={(item) => { setViewing(null); setEditing(item); setFormOpen(true) }} onCancel={cancel} />
      </div>
    </>
  )
}
function FilterField({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) { return <div className={className}><label id={`${htmlFor}-label`} htmlFor={htmlFor} className="mb-1 block text-[11px] font-medium text-slate-600">{label}</label>{children}</div> }

function FilterSelect({ id, value, emptyLabel, options, onValueChange }: { id: string; value: string; emptyLabel: string; options: { value: string; label: string }[]; onValueChange(value: string): void }) {
  const fullOptions = [{ value: "all", label: emptyLabel }, ...options]
  const selectedLabel = fullOptions.find((option) => option.value === value)?.label ?? emptyLabel
  return <DropdownMenu><DropdownMenuTrigger asChild><Button id={id} variant="outline" className="h-9 w-full justify-between px-3 text-left text-xs font-normal" aria-labelledby={`${id}-label ${id}`}><span className="truncate">{selectedLabel}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-64 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"><DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>{fullOptions.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
}

function SortButton({ label, field, sorts, onToggle }: { label: string; field: SortField; sorts: Sort[]; onToggle(field: SortField): void }) { const activeSort = sorts.find((sort) => sort.field === field); return <button type="button" className="inline-flex items-center gap-1 rounded-sm hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => onToggle(field)} aria-label={`${label} sütununu sırala`} aria-pressed={Boolean(activeSort)}>{label}{activeSort ? activeSort.direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}</button> }

function Direction({ direction }: { direction: GoodsMovementDirection }) { const Icon = direction === "INBOUND" ? ArrowDownToLine : ArrowUpFromLine; return <span className="inline-flex items-center gap-1 font-medium"><Icon className={cn("size-3.5", direction === "INBOUND" ? "text-emerald-700" : "text-blue-700")} />{getGoodsDirectionLabel(direction)}</span> }
function Status({ movement }: { movement: GoodsMovement }) { const status = getGoodsMovementDisplayStatus(movement); const labels = { PLANNED: "Planlı", LATE: "Gecikti", COMPLETED: getGoodsCompletionLabel(movement.direction), CANCELLED: "İptal" }; return <span className={cn("rounded-full px-2 py-1 text-[10px] font-semibold", status === "LATE" ? "bg-amber-50 text-amber-700" : status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : status === "CANCELLED" ? "bg-slate-200 text-slate-600" : "bg-blue-50 text-blue-700")}>{labels[status]}</span> }
function formatPlanned(movement: GoodsMovement, pattern = "d MMM") { return `${formatTr(new Date(`${movement.plannedDate}T12:00:00`), pattern)} · ${movement.plannedTime ?? "Saat belirtilmedi"}` }
function GoodsForm({ open, movement, references, onOpenChange, onSave }: { open: boolean; movement: GoodsMovement | null; references: { companies: { id: string; name: string }[]; facilities: { id: string; name: string; companyId: string }[] }; onOpenChange(open: boolean): void; onSave(movement: GoodsMovement): void }) {
  const formValues = movement ? { direction: movement.direction, companyId: movement.companyId, facilityId: movement.facilityId, plannedDate: movement.plannedDate, plannedTime: movement.plannedTime ?? "", counterpartyName: movement.counterpartyName, goodsDescription: movement.goodsDescription, referenceNumber: movement.referenceNumber ?? "", note: movement.note ?? "" } : empty
  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm<GoodsMovementFormValues>({ resolver: zodResolver(goodsMovementFormSchema), values: formValues })
  const direction = watch("direction")
  const companyId = watch("companyId")
  const note = watch("note")
  const company = register("companyId")
  const noteInput = register("note")
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const facilities = references.facilities.filter((item) => item.companyId === companyId)
  useLayoutEffect(() => {
    if (!open || !noteRef.current) return
    noteRef.current.style.height = "auto"
    noteRef.current.style.height = `${Math.min(noteRef.current.scrollHeight, 96)}px`
  }, [movement?.id, note, open])
  const submit = async (values: GoodsMovementFormValues) => {
    const input: GoodsMovementInput = { ...values, plannedTime: values.plannedTime || undefined }
    const saved = movement ? await goodsMovementService.updateGoodsMovement(movement.id, input) : await goodsMovementService.createGoodsMovement(input)
    onSave(saved)
    reset(empty)
  }
  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) reset(formValues)
    onOpenChange(nextOpen)
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <InternalDialogContent className="!max-h-[85vh] !w-[min(680px,calc(100vw-2rem))] !max-w-none flex flex-col gap-0 overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="shrink-0 border-b bg-white px-5 pb-3 pt-4 pr-12">
          <DialogTitle className="text-lg font-semibold text-slate-900">{movement ? "Mal hareketini düzenle" : "Yeni mal hareketi"}</DialogTitle>
        </DialogHeader>
        <form id="goods-movement-form" className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)} noValidate>
          <Field label="Yön" required error={errors.direction?.message}><Select {...register("direction")}><option value="" disabled hidden>Yön seçin</option><option value="INBOUND">Gelen</option><option value="OUTBOUND">Giden</option></Select></Field>
          <Field label="Planlanan tarih" required error={errors.plannedDate?.message}><Input type="date" {...register("plannedDate")} /></Field>
          <Field label="Şirket" required error={errors.companyId?.message}><Select {...company} onChange={(event) => { void company.onChange(event); setValue("facilityId", "", { shouldDirty: true, shouldValidate: true }) }}><option value="" disabled hidden>Şirket seçin</option>{references.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
          <Field label="Tesis" required error={errors.facilityId?.message}><Select {...register("facilityId")} disabled={!companyId}><option value="" disabled hidden>Tesis seçin</option>{facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
          <Field label={direction ? getGoodsCounterpartyLabel(direction) : "Karşı firma"} required error={errors.counterpartyName?.message}><Input {...register("counterpartyName")} /></Field>
          <Field label="Mal / açıklama" required error={errors.goodsDescription?.message}><Input {...register("goodsDescription")} /></Field>
          <Field label="Referans no"><Input {...register("referenceNumber")} /></Field>
          <Field label="Saat (opsiyonel)"><Input type="time" {...register("plannedTime")} /></Field>
          <Field label="Not (opsiyonel)" className="sm:col-span-2"><Textarea rows={1} className="h-9 min-h-9 max-h-24 resize-none overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:w-0" {...noteInput} ref={(element) => { noteInput.ref(element); noteRef.current = element }} /></Field>
        </form>
        <DialogFooter className="shrink-0 border-t bg-card px-5 py-3 sm:items-center">
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Vazgeç</Button>
          <Button disabled={isSubmitting} type="submit" form="goods-movement-form">{movement ? "Kaydet" : "Kaydı oluştur"}</Button>
        </DialogFooter>
      </InternalDialogContent>
    </Dialog>
  )
}
function Details({ movement, onOpenChange, onEdit, onCancel }: { movement: GoodsMovement | null; onOpenChange(open: boolean): void; onEdit(item: GoodsMovement): void; onCancel(item: GoodsMovement): void }) { if (!movement) return null; return <Dialog open onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Mal hareketi</DialogTitle><DialogDescription><Direction direction={movement.direction} /> · {formatPlanned(movement, "d MMMM yyyy")}</DialogDescription></DialogHeader><div className="grid gap-3 text-sm"><Detail label={getGoodsCounterpartyLabel(movement.direction)} value={movement.counterpartyName} /><Detail label="Mal / açıklama" value={movement.goodsDescription} /><Detail label="Şirket / tesis" value={`${movement.companyName} · ${movement.facilityName}`} />{movement.referenceNumber && <Detail label="Referans no" value={movement.referenceNumber} />}{movement.note && <Detail label="Not" value={movement.note} />}{movement.actualAt && <Detail label={getGoodsCompletionLabel(movement.direction)} value={formatTr(new Date(movement.actualAt), "d MMMM yyyy HH:mm")} />}</div>{movement.status === "PLANNED" && <DialogFooter><Button variant="ghost" onClick={() => onEdit(movement)}><Pencil />Düzenle</Button><Button variant="ghost" className="text-rose-700" onClick={() => onCancel(movement)}><XCircle />İptal</Button></DialogFooter>}</DialogContent></Dialog> }
function Field({ label, required, error, className, children }: { label: string; required?: boolean; error?: string; className?: string; children: React.ReactNode }) { return <div className={cn("space-y-1", className)}><Label className="text-xs">{label}{required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}</Label>{children}{error && <p className="text-xs text-red-600">{error}</p>}</div> }
function Detail({ label, value }: { label: string; value: string }) { return <p><span className="block text-xs font-medium text-slate-500">{label}</span>{value}</p> }
