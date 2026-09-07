import { AlertCircle, ArrowDown, ArrowUp, Boxes, ChevronDown, FilterX, Plus, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { PaginationFooter } from "@/components/common/PaginationFooter"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { getResourceDisplayName, resourceTypeLabels, resourceTypes, type FacilityResource, type ResourceInput } from "@/domain/resources"
import {
  defaultResourceFilters,
  filterResources,
  getResourcePageCount,
  getVisibleResourcePageNumbers,
  hasActiveResourceFilters,
  paginateResources,
  RESOURCE_PAGE_SIZE,
  type ResourceFilters,
  type ResourceSort,
  sortResources,
  toggleResourceSort,
} from "@/features/resources/resource-filters"
import { ResourceFormDialog } from "@/features/resources/ResourceFormDialog"
import { useResources } from "@/features/resources/resource-context"
import { useVisits } from "@/features/visits/visit-context"
import { useFillViewportHeight } from "@/lib/use-fill-viewport-height"
import { cn } from "@/lib/utils"

export function ResourceCatalogPage() {
  const { resources, isLoading, error, reload, createResource, updateResource, setResourceActive, deleteResource } = useResources()
  const { referenceData, isLoading: visitsLoading, error: visitsError, reload: reloadVisits } = useVisits()
  const [filters, setFilters] = useState<ResourceFilters>(defaultResourceFilters)
  const [sorts, setSorts] = useState<ResourceSort[]>([])
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedResource, setSelectedResource] = useState<FacilityResource | null>(null)
  const [transitioningResourceId, setTransitioningResourceId] = useState<string | null>(null)
  const [deletingResourceId, setDeletingResourceId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null)
  const tableSectionRef = useRef<HTMLElement>(null)
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null)

  const facilities = useMemo(
    () => referenceData?.facilities.filter((facility) => filters.companyId === "all" || facility.companyId === filters.companyId) ?? [],
    [filters.companyId, referenceData?.facilities],
  )
  const filteredResources = useMemo(
    () => sortResources(filterResources(resources, filters), sorts),
    [filters, resources, sorts],
  )
  const pageCount = getResourcePageCount(filteredResources.length)
  const paginatedResources = paginateResources(filteredResources, page)
  const activeFilters = hasActiveResourceFilters(filters)
  const visibleStart = filteredResources.length === 0 ? 0 : (page - 1) * RESOURCE_PAGE_SIZE + 1
  const visibleEnd = Math.min(page * RESOURCE_PAGE_SIZE, filteredResources.length)
  const { ref: tableViewportRef, height: tableViewportHeight } = useFillViewportHeight<HTMLElement>(14, [filteredResources.length])

  const setTableSectionRefs = (node: HTMLElement | null) => {
    tableSectionRef.current = node
    tableViewportRef(node)
  }

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  if (isLoading || visitsLoading) return <ResourceCatalogSkeleton />

  if (error || visitsError || !referenceData) {
    return (
      <section className="rounded-lg border border-red-200 bg-white px-5 py-12 text-center shadow-panel" role="alert">
        <AlertCircle className="mx-auto size-8 text-red-600" />
        <h1 className="mt-3 text-base font-semibold text-slate-900">Kaynak kataloğu yüklenemedi</h1>
        <p className="mt-1 text-sm text-slate-600">{error ?? visitsError ?? "Organizasyon referansları alınamadı."}</p>
        <Button className="mt-4" onClick={() => void Promise.all([reload(), reloadVisits()])}>Tekrar dene</Button>
      </section>
    )
  }

  const openCreateDialog = (trigger: HTMLElement) => {
    dialogReturnFocusRef.current = trigger
    setSelectedResource(null)
    setDialogOpen(true)
  }

  const openEditDialog = (resource: FacilityResource, trigger: HTMLElement) => {
    dialogReturnFocusRef.current = trigger
    setSelectedResource(resource)
    setDialogOpen(true)
  }

  const updateFilters = (updater: (current: ResourceFilters) => ResourceFilters) => {
    setFilters(updater)
    setPage(1)
  }

  const clearFilters = () => {
    setFilters(defaultResourceFilters)
    setPage(1)
  }

  const changePage = (nextPage: number) => {
    setPage(nextPage)
    window.requestAnimationFrame(() => tableSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }))
  }

  const saveResource = async (input: ResourceInput) => {
    const displayName = getResourceDisplayName(input)
    if (selectedResource) {
      await updateResource(selectedResource.id, input)
      setFeedback({ tone: "success", message: `${displayName} güncellendi.` })
    } else {
      await createResource(input)
      setFeedback({ tone: "success", message: `${displayName} oluşturuldu.` })
    }
  }

  const toggleResource = async (resource: FacilityResource) => {
    setTransitioningResourceId(resource.id)
    try {
      const updated = await setResourceActive(resource.id, !resource.isActive)
      setSelectedResource((current) => current?.id === updated.id ? updated : current)
      setFeedback({
        tone: "success",
        message: `${getResourceDisplayName(resource)} ${resource.isActive ? "pasife" : "aktife"} alındı.`,
      })
    } catch (toggleError) {
      setFeedback({
        tone: "error",
        message: toggleError instanceof Error ? toggleError.message : "Kaynak durumu değiştirilemedi.",
      })
    } finally {
      setTransitioningResourceId(null)
    }
  }

  const hardDeleteResource = async (resource: FacilityResource) => {
    setDeletingResourceId(resource.id)
    try {
      await deleteResource(resource.id)
      setFeedback({ tone: "success", message: `${getResourceDisplayName(resource)} silindi.` })
      setSelectedResource(null)
    } finally {
      setDeletingResourceId(null)
    }
  }

  return (
    <div className="min-w-0 space-y-3 md:space-y-3.5">
      <section className="rounded-lg border bg-card p-3 shadow-panel" aria-label="Kaynak filtreleri">
        <div className="flex items-center justify-between pb-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Kaynak Filtreleri</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("h-5 gap-1 border-none px-1 text-[11px] font-medium text-slate-500 shadow-none hover:bg-transparent hover:text-slate-900", !activeFilters && "invisible")}
            onClick={clearFilters}
          >
            <FilterX className="size-3 text-slate-500" />
            Filtreleri temizle
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1.5fr)_repeat(4,minmax(120px,1fr))_auto]">
          <FilterField label="Arama" htmlFor="resource-search" className="sm:col-span-2 xl:col-span-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="resource-search"
                value={filters.search}
                onChange={(event) => updateFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Kaynak, plaka, şoför, şirket veya tesis ara"
                className="pl-8 h-9 text-xs"
              />
            </div>
          </FilterField>
          <FilterField label="Şirket" htmlFor="resource-company">
            <FilterSelect
              id="resource-company"
              value={filters.companyId}
              emptyLabel="Tüm şirketler"
              options={referenceData.companies.map((company) => ({ value: company.id, label: company.name }))}
              onValueChange={(value) => updateFilters((current) => ({ ...current, companyId: value, facilityId: "all" }))}
            />
          </FilterField>
          <FilterField label="Tesis" htmlFor="resource-facility">
            <FilterSelect id="resource-facility" value={filters.facilityId} emptyLabel="Tüm tesisler" options={facilities.map((facility) => ({ value: facility.id, label: facility.name }))} onValueChange={(value) => updateFilters((current) => ({ ...current, facilityId: value }))} />
          </FilterField>
          <FilterField label="Kaynak türü" htmlFor="resource-type">
            <FilterSelect id="resource-type" value={filters.type} emptyLabel="Tüm kaynak türleri" options={resourceTypes.map((type) => ({ value: type, label: resourceTypeLabels[type] }))} onValueChange={(value) => updateFilters((current) => ({ ...current, type: value as ResourceFilters["type"] }))} />
          </FilterField>
          <FilterField label="Durum" htmlFor="resource-status">
            <FilterSelect id="resource-status" value={filters.active} emptyLabel="Tüm durumlar" options={[{ value: "active", label: "Aktif" }, { value: "inactive", label: "Pasif" }]} onValueChange={(value) => updateFilters((current) => ({ ...current, active: value as ResourceFilters["active"] }))} />
          </FilterField>
          <div className="flex flex-col justify-end">
            <Button className="h-9 w-full gap-1 text-xs" onClick={(event) => openCreateDialog(event.currentTarget)}><Plus className="size-3.5" />Yeni kaynak</Button>
          </div>
        </div>

        {activeFilters && (
          <div className="mt-1.5 flex justify-start sm:hidden">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 border-none px-1 text-xs font-medium text-slate-500 shadow-none hover:bg-transparent hover:text-slate-900"
              onClick={clearFilters}
            >
              <FilterX className="size-3.5 text-slate-500" />
              Filtreleri temizle
            </Button>
          </div>
        )}
      </section>

      {feedback && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between rounded-lg border px-3 py-2 text-xs shadow-xs",
            feedback.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900",
          )}
        >
          <span>{feedback.message}</span>
          <button type="button" className="rounded p-0.5 hover:bg-black/5" onClick={() => setFeedback(null)} aria-label="Geri bildirimi kapat"><X className="size-3" /></button>
        </div>
      )}

      <section ref={setTableSectionRefs} className={cn("scroll-mt-3 flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-lg border bg-card shadow-panel", tableViewportHeight === undefined && "min-h-[35.5rem]")} style={tableViewportHeight !== undefined ? { height: tableViewportHeight } : undefined} aria-label="Kaynak kataloğu">
        {filteredResources.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
            <Boxes className="mx-auto size-8 text-slate-400" />
            <h2 className="mt-3 text-sm font-semibold text-slate-900">Eşleşen kaynak bulunamadı</h2>
            <p className="mt-1 text-xs text-slate-600">Seçilen filtrelerle eşleşen herhangi bir kaynak bulunmuyor.</p>
            {activeFilters && <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Filtreleri temizle</Button>}
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <div className="hidden h-full min-h-0 overflow-x-auto overflow-y-hidden scrollbar-thin md:block">
              <table className="h-full w-full min-w-[920px] table-fixed text-left text-xs">
                <thead className="sticky top-0 z-10 border-b bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-[32%] px-3 py-2"><SortButton label="KAYNAK" field="name" sorts={sorts} onToggle={(field) => setSorts((current) => toggleResourceSort(current, field))} /></th>
                    <th className="w-[20%] px-3 py-2"><SortButton label="TÜR" field="type" sorts={sorts} onToggle={(field) => setSorts((current) => toggleResourceSort(current, field))} /></th>
                    <th className="w-[20%] px-3 py-2"><SortButton label="ŞİRKET" field="location" sorts={sorts} onToggle={(field) => setSorts((current) => toggleResourceSort(current, field))} /></th>
                    <th className="w-[14%] px-3 py-2"><SortButton label="MİKTAR / DETAY" field="quantity" sorts={sorts} onToggle={(field) => setSorts((current) => toggleResourceSort(current, field))} /></th>
                    <th className="w-[14%] px-3 py-2"><SortButton label="DURUM" field="status" sorts={sorts} onToggle={(field) => setSorts((current) => toggleResourceSort(current, field))} /></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paginatedResources.map((resource) => (
                    <tr
                      key={resource.id}
                      tabIndex={0}
                      className={cn("record-row-hover cursor-pointer select-none transition-colors hover:bg-slate-50 focus-visible:bg-blue-50/60 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-blue-500", !resource.isActive && "bg-slate-50/70 hover:bg-slate-100/70")}
                      onClick={(event) => openEditDialog(resource, event.currentTarget)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          openEditDialog(resource, event.currentTarget)
                        }
                      }}
                    >
                      <td className="px-3 py-1.5 sm:py-2"><ResourceIdentity resource={resource} /></td>
                      <td className="px-3 py-1.5 sm:py-2">{resourceTypeLabels[resource.type]}</td>
                      <td className="px-3 py-1.5 sm:py-2">
                        <p className="truncate font-normal text-slate-900">{resource.companyName}</p>
                      </td>
                      <td className="px-3 py-1.5 sm:py-2 tabular-nums">{formatQuantity(resource)}</td>
                      <td className="px-3 py-1.5 sm:py-2"><ResourceStatus active={resource.isActive} /></td>
                    </tr>
                  ))}
                  {Array.from({ length: Math.max(0, RESOURCE_PAGE_SIZE - paginatedResources.length) }).map((_, index) => (
                    <tr key={`filler-${index}`} aria-hidden="true" className={cn("pointer-events-none select-none", index > 0 && "border-transparent")}>
                      <td className="px-3 py-1.5 sm:py-2">
                        <p className="truncate font-semibold text-transparent">&nbsp;</p>
                      </td>
                      <td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td>
                      <td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td>
                      <td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td>
                      <td className="px-3 py-1.5 sm:py-2 text-transparent">&nbsp;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y md:hidden">
              {paginatedResources.map((resource) => (
                <article
                  key={resource.id}
                  tabIndex={0}
                  className={cn("cursor-pointer select-none p-3.5 transition-colors hover:bg-slate-50 focus-visible:bg-blue-50/60 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-blue-500", !resource.isActive && "bg-slate-50/70 hover:bg-slate-100/70")}
                  onClick={(event) => openEditDialog(resource, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      openEditDialog(resource, event.currentTarget)
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-900">{getResourceDisplayName(resource)}</h3>
                      <p className="mt-0.5 text-xs text-slate-600">{resourceTypeLabels[resource.type]}</p>
                    </div>
                    <ResourceStatus active={resource.isActive} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div><dt className="text-slate-500">Şirket</dt><dd className="mt-0.5 font-medium text-slate-800">{resource.companyName}</dd></div>
                    <div><dt className="text-slate-500">Miktar</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{formatQuantity(resource)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        )}

        <PaginationFooter
          page={page}
          pageCount={pageCount}
          visibleStart={visibleStart}
          visibleEnd={visibleEnd}
          total={filteredResources.length}
          visiblePageNumbers={getVisibleResourcePageNumbers(page, Math.max(1, pageCount))}
          onPageChange={changePage}
          ariaLabel="Kaynak sayfaları"
        />
      </section>

      <ResourceFormDialog
        open={dialogOpen}
        resource={selectedResource}
        referenceData={referenceData}
        returnFocusRef={dialogReturnFocusRef}
        onOpenChange={setDialogOpen}
        onSave={saveResource}
        onToggleActive={toggleResource}
        onDelete={hardDeleteResource}
        isTogglingActive={transitioningResourceId === selectedResource?.id}
        isDeleting={deletingResourceId === selectedResource?.id}
      />
    </div>
  )
}

function FilterField({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label id={`${htmlFor}-label`} htmlFor={htmlFor} className="mb-1 block text-[11px] font-medium text-slate-600">{label}</label>
      {children}
    </div>
  )
}

function FilterSelect({ id, value, emptyLabel, options, onValueChange }: {
  id: string
  value: string
  emptyLabel: string
  options: { value: string; label: string }[]
  onValueChange(value: string): void
}) {
  const fullOptions = useMemo(() => {
    if (options.some((option) => option.value === "all")) return options
    return [{ value: "all", label: emptyLabel }, ...options]
  }, [emptyLabel, options])

  const selectedLabel = fullOptions.find((option) => option.value === value)?.label ?? emptyLabel

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id={id} variant="outline" className="h-9 w-full justify-between px-3 text-left text-xs font-normal" aria-labelledby={`${id}-label ${id}`}>
          <span className="truncate">{selectedLabel}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {fullOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortButton({ label, field, sorts, onToggle }: {
  label: string
  field: ResourceSort["field"]
  sorts: ResourceSort[]
  onToggle(field: ResourceSort["field"]): void
}) {
  const activeSort = sorts.find((sort) => sort.field === field)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-sm hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600"
      onClick={() => onToggle(field)}
      aria-label={`${label} sütununu ${activeSort?.direction === "asc" ? "azalan" : "artan"} sırala`}
    >
      {label}
      {activeSort ? (
        activeSort.direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
      ) : null}
    </button>
  )
}

function ResourceIdentity({ resource }: { resource: FacilityResource }) {
  const displayName = getResourceDisplayName(resource)

  return (
    <div>
      <p className="truncate font-semibold text-slate-900" title={displayName}>{displayName}</p>
    </div>
  )
}

function ResourceStatus({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-100 text-slate-600",
      )}
    >
      {active ? "Aktif" : "Pasif"}
    </span>
  )
}

function formatQuantity(resource: FacilityResource) {
  switch (resource.type) {
    case "POOLED_EQUIPMENT":
      return `${resource.totalQuantity} adet`
    case "VEHICLE":
      return resource.licensePlate
    case "DRIVER":
      return resource.licenseClasses.join(", ") || "—"
    case "ROOM":
      return "1 oda"
  }
}

function ResourceCatalogSkeleton() {
  return (
    <div className="space-y-3" aria-label="Kaynaklar yükleniyor" role="status">
      <div className="rounded-lg border bg-white p-3 shadow-panel">
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-9 animate-pulse rounded bg-slate-100" />)}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-white shadow-panel">
        <div className="h-10 animate-pulse border-b bg-slate-100" />
        {Array.from({ length: 9 }, (_, index) => <div key={index} className="h-12 animate-pulse border-b bg-white px-3 py-2.5"><div className="h-full rounded bg-slate-100" /></div>)}
      </div>
    </div>
  )
}
