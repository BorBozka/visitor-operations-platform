import {
  AlertCircle,
  Check,
  ChevronRight,
  Minus,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useVisits } from "@/features/visits/visit-context"
import { cn } from "@/lib/utils"
import type {
  DesiredResourceState,
  EquipmentAvailabilityInfo,
  RoomAvailabilityInfo,
} from "@/domain/resources"
import type { ResourceAssignmentService } from "@/services/resource-assignment-service"
import { isMeetingResourceReadOnly } from "@/lib/meeting-lifecycle"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// A persisted assignment whose catalog resource was hard-deleted keeps its snapshot name but has
// no resourceId left. Such an assignment can only appear on an already-immutable Meeting, so it is
// displayed and never re-submitted (see draftToDesired).
interface DraftRoom {
  resourceId: string | null
  resourceName: string
}

interface DraftEquipmentItem {
  /** Stable key for React lists and draft edits — unique even without a resourceId. */
  draftKey: string
  resourceId: string | null
  resourceName: string
  requestedQuantity: number
  /** Used for display only; sourced from catalog at load-time. */
  totalQuantity: number
}

interface ResourceDraft {
  room: DraftRoom | null
  equipment: DraftEquipmentItem[]
}

/** Convert draft to the atomic-save shape. */
function draftToDesired(draft: ResourceDraft): DesiredResourceState {
  return {
    roomResourceId: draft.room?.resourceId ?? null,
    equipment: draft.equipment.flatMap((e) => e.resourceId === null ? [] : [{
      resourceId: e.resourceId,
      requestedQuantity: e.requestedQuantity,
    }]),
  }
}

/** True when two drafts represent the same desired state. */
function draftEquals(a: ResourceDraft, b: ResourceDraft): boolean {
  if (a.room?.resourceId !== b.room?.resourceId) return false
  if (a.equipment.length !== b.equipment.length) return false
  for (const ae of a.equipment) {
    const be = b.equipment.find((e) => e.resourceId === ae.resourceId)
    if (!be || be.requestedQuantity !== ae.requestedQuantity) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Load state — tracks the initial persisted data fetch
// ---------------------------------------------------------------------------

interface LoadState {
  status: "loading" | "idle" | "error"
  message?: string
  eligibleRooms: RoomAvailabilityInfo[]
  eligibleEquipment: EquipmentAvailabilityInfo[]
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MeetingResourcePanelProps {
  meetingId: string
  service: ResourceAssignmentService
  isReadOnly?: boolean
  onAssignmentsCountChange?(count: number): void
  onDirtyChange?(isDirty: boolean): void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MeetingResourcePanel({
  meetingId,
  service,
  isReadOnly: isReadOnlyProp,
  onAssignmentsCountChange,
  onDirtyChange,
}: MeetingResourcePanelProps) {
  const { meetings, visits } = useVisits()
  const computedReadOnly = useMemo(() => {
    if (isReadOnlyProp !== undefined) return isReadOnlyProp
    const meeting = meetings.find((item) => item.id === meetingId)
    return meeting ? isMeetingResourceReadOnly(meeting, visits) : true
  }, [isReadOnlyProp, meetingId, meetings, visits])

  // Persisted draft — what was last successfully saved.
  const [persistedDraft, setPersistedDraft] = useState<ResourceDraft>({ room: null, equipment: [] })
  // Working draft — what the manager is editing.
  const [draft, setDraft] = useState<ResourceDraft>({ room: null, equipment: [] })

  const isDirty = useMemo(() => !draftEquals(draft, persistedDraft), [draft, persistedDraft])

  // Notify parent of dirty state changes.
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  useEffect(() => {
    onDirtyChangeRef.current?.(isDirty)
  }, [isDirty])

  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    eligibleRooms: [],
    eligibleEquipment: [],
  })

  // Inline editor toggles
  const [isRoomPickerOpen, setIsRoomPickerOpen] = useState(false)
  const [isEquipPickerOpen, setIsEquipPickerOpen] = useState(false)
  const [pickerEquipId, setPickerEquipId] = useState<string | null>(null)
  const [pickerQty, setPickerQty] = useState(1)
  // Edit-in-place for existing draft equipment
  const [editingDraftKey, setEditingDraftKey] = useState<string | null>(null)
  const [editQty, setEditQty] = useState(1)

  // Save/error state
  const [saving, setSaving] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    setLoadState((prev) => ({ ...prev, status: "loading" }))
    setIsRoomPickerOpen(false)
    setIsEquipPickerOpen(false)
    setPickerEquipId(null)
    setEditingDraftKey(null)
    setErrorBanner(null)

    try {
      const [assignments, eligibleRooms, eligibleEquipment] = await Promise.all([
        service.listAssignmentsForMeeting(meetingId),
        service.getEligibleRooms(meetingId),
        service.getEligibleEquipment(meetingId),
      ])

      // Build persisted draft from assignments.
      const roomAsgn = assignments.find((a) => a.resourceType === "ROOM")
      const equipAsgnList = assignments.filter((a) => a.resourceType === "POOLED_EQUIPMENT")

      const newPersisted: ResourceDraft = {
        room: roomAsgn
          ? { resourceId: roomAsgn.resourceId, resourceName: roomAsgn.resourceName }
          : null,
        equipment: equipAsgnList.map((a) => ({
          draftKey: `persisted-${a.id}`,
          resourceId: a.resourceId,
          resourceName: a.resourceName,
          requestedQuantity: (a as { requestedQuantity?: number }).requestedQuantity ?? 0,
          totalQuantity:
            eligibleEquipment.find((e) => e.resource.id === a.resourceId)?.resource.totalQuantity ?? 0,
        })),
      }

      setPersistedDraft(newPersisted)
      setDraft(newPersisted)
      setLoadState({ status: "idle", eligibleRooms, eligibleEquipment })
    } catch (err) {
      setLoadState({
        status: "error",
        message: err instanceof Error ? err.message : "Kaynaklar yüklenirken bir hata oluştu.",
        eligibleRooms: [],
        eligibleEquipment: [],
      })
    }
  }, [meetingId, service])

  useEffect(() => {
    void load()
  }, [load])

  // Report only persisted assignments; unsaved draft changes use the dirty indicator.
  const onAssignmentsCountChangeRef = useRef(onAssignmentsCountChange)
  onAssignmentsCountChangeRef.current = onAssignmentsCountChange
  useEffect(() => {
    onAssignmentsCountChangeRef.current?.((persistedDraft.room ? 1 : 0) + persistedDraft.equipment.length)
  }, [persistedDraft])

  // ---------------------------------------------------------------------------
  // Draft mutations (no service calls)
  // ---------------------------------------------------------------------------

  function openRoomPicker() {
    if (computedReadOnly) return
    setIsEquipPickerOpen(false)
    setPickerEquipId(null)
    setEditingDraftKey(null)
    setIsRoomPickerOpen(true)
  }

  function closeRoomPicker() {
    setIsRoomPickerOpen(false)
  }

  function selectDraftRoom(resourceId: string, resourceName: string) {
    setDraft((prev) => ({ ...prev, room: { resourceId, resourceName } }))
    setIsRoomPickerOpen(false)
  }

  function removeDraftRoom() {
    setDraft((prev) => ({ ...prev, room: null }))
  }

  function openEquipPicker() {
    if (computedReadOnly) return
    setIsRoomPickerOpen(false)
    setEditingDraftKey(null)
    setPickerEquipId(null)
    setPickerQty(1)
    setIsEquipPickerOpen(true)
  }

  function closeEquipPicker() {
    setIsEquipPickerOpen(false)
    setPickerEquipId(null)
  }

  function addDraftEquipment() {
    if (!pickerEquipId) return
    const info = loadState.eligibleEquipment.find((e) => e.resource.id === pickerEquipId)
    if (!info) return

    setDraft((prev) => ({
      ...prev,
      equipment: [
        ...prev.equipment,
        {
          draftKey: `new-${pickerEquipId}-${Date.now()}`,
          resourceId: pickerEquipId,
          resourceName: info.resource.name,
          requestedQuantity: pickerQty,
          totalQuantity: info.resource.totalQuantity,
        },
      ],
    }))
    setIsEquipPickerOpen(false)
    setPickerEquipId(null)
  }

  function openEditEquip(draftKey: string, currentQty: number) {
    if (computedReadOnly) return
    setIsRoomPickerOpen(false)
    setIsEquipPickerOpen(false)
    setPickerEquipId(null)
    setEditingDraftKey(draftKey)
    setEditQty(currentQty)
  }

  function applyEditEquip(draftKey: string) {
    setDraft((prev) => ({
      ...prev,
      equipment: prev.equipment.map((e) =>
        e.draftKey === draftKey ? { ...e, requestedQuantity: editQty } : e,
      ),
    }))
    setEditingDraftKey(null)
  }

  function removeDraftEquipment(draftKey: string) {
    setDraft((prev) => ({
      ...prev,
      equipment: prev.equipment.filter((e) => e.draftKey !== draftKey),
    }))
    if (editingDraftKey === draftKey) setEditingDraftKey(null)
  }

  function discardDraft() {
    setDraft(persistedDraft)
    setIsRoomPickerOpen(false)
    setIsEquipPickerOpen(false)
    setPickerEquipId(null)
    setEditingDraftKey(null)
    setErrorBanner(null)
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!isDirty || computedReadOnly) return
    setSaving(true)
    setErrorBanner(null)
    try {
      const views = await service.saveMeetingAssignments(meetingId, draftToDesired(draft))
      // Rebuild persisted draft from the returned views.
      const roomView = views.find((v) => v.resourceType === "ROOM")
      const equipViews = views.filter((v) => v.resourceType === "POOLED_EQUIPMENT")
      const newPersisted: ResourceDraft = {
        room: roomView ? { resourceId: roomView.resourceId, resourceName: roomView.resourceName } : null,
        equipment: equipViews.map((v) => ({
          draftKey: `saved-${v.id}`,
          resourceId: v.resourceId,
          resourceName: v.resourceName,
          requestedQuantity: (v as { requestedQuantity?: number }).requestedQuantity ?? 0,
          totalQuantity:
            loadState.eligibleEquipment.find((e) => e.resource.id === v.resourceId)?.resource.totalQuantity ?? 0,
        })),
      }
      setPersistedDraft(newPersisted)
      setDraft(newPersisted)
      setEditingDraftKey(null)
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Kaynak atamaları kaydedilemedi.")
      // Refresh eligibility so stale conflict/capacity info is not shown after a failed save.
      // Draft is preserved — the manager can correct and retry.
      try {
        const [freshRooms, freshEquipment] = await Promise.all([
          service.getEligibleRooms(meetingId),
          service.getEligibleEquipment(meetingId),
        ])
        setLoadState((prev) => ({
          ...prev,
          eligibleRooms: freshRooms,
          eligibleEquipment: freshEquipment,
        }))
      } catch {
        // Ignore secondary failure; the primary error banner is already shown.
      }
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Availability helpers
  // ---------------------------------------------------------------------------

  /**
   * maxAssignableQuantity for a resource = totalQuantity - usedByOtherMeetings.
   * getEligibleEquipment already excludes this meeting, so remainingQuantity IS the max.
   * The UI must not subtract the current draft quantity from this value.
   */
  function maxAssignableQty(resourceId: string): number {
    return loadState.eligibleEquipment.find((e) => e.resource.id === resourceId)?.remainingQuantity ?? 0
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loadState.status === "loading") {
    return (
      <div className="space-y-3 py-6">
        <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      </div>
    )
  }

  if (loadState.status === "error") {
    return (
      <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3.5" role="alert">
        <p className="flex items-center gap-1.5 text-xs font-medium text-red-800">
          <AlertCircle className="size-4 shrink-0 text-red-600" />
          {loadState.message}
        </p>
        <Button size="sm" variant="outline" className="w-fit text-xs" onClick={() => void load()}>
          Tekrar dene
        </Button>
      </div>
    )
  }

  const { eligibleRooms, eligibleEquipment } = loadState

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
      {/* Error banner */}
      {errorBanner && (
        <div
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />
          <span className="flex-1 leading-4">{errorBanner}</span>
          <button
            type="button"
            aria-label="Hata mesajını kapat"
            className="rounded text-xs font-medium underline hover:text-red-950"
            onClick={() => setErrorBanner(null)}
          >
            Kapat
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Room Section                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="Toplantı Odası">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
          Toplantı Odası
        </h4>

        {isRoomPickerOpen && !computedReadOnly ? (
          <div className="space-y-2 rounded-lg border bg-slate-50/80 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">Oda seçin</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs font-medium text-slate-500 hover:text-slate-800"
                onClick={closeRoomPicker}
              >
                Vazgeç
              </Button>
            </div>

            {eligibleRooms.length === 0 ? (
              <p className="py-2 text-center text-xs text-slate-500">Bu tesis için oda bulunamadı.</p>
            ) : (
              <ul className="max-h-48 divide-y overflow-y-auto rounded-md border bg-white text-xs">
                {eligibleRooms.map(({ resource, isAvailable, conflictReason }) => {
                  const isDraftSelected = resource.id === draft.room?.resourceId
                  return (
                    <li key={resource.id} className="flex items-center justify-between p-2.5 gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900">{resource.name}</p>
                        {isDraftSelected && (
                          <p className="text-[11px] font-medium text-blue-600">Seçili (kaydedilmedi)</p>
                        )}
                        {!isAvailable && !isDraftSelected && conflictReason && (
                          <p className="text-[11px] text-red-600">{conflictReason}</p>
                        )}
                      </div>
                      {isDraftSelected ? (
                        <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">
                          Seçili
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant={isAvailable ? "default" : "outline"}
                          className="h-7 shrink-0 text-xs"
                          disabled={!isAvailable}
                          onClick={() => selectDraftRoom(resource.id, resource.name)}
                        >
                          Seç
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : draft.room ? (
          <div className="flex items-center justify-between rounded-lg border bg-slate-50/70 p-3">
            <div className="min-w-0 pr-2">
              <p className="truncate text-xs font-semibold text-slate-900">{draft.room.resourceName}</p>
              <p className="mt-0.5 text-[11px] font-medium text-emerald-700">
                {persistedDraft.room?.resourceId === draft.room.resourceId ? "Atandı" : "Atanacak (kaydedilmedi)"}
              </p>
            </div>
            {!computedReadOnly && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={openRoomPicker}
                  disabled={saving}
                >
                  Değiştir
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={removeDraftRoom}
                  disabled={saving}
                  title="Oda atamasını kaldır"
                  aria-label="Oda atamasını kaldır"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between border-t border-slate-100 py-2.5">
            <span className="text-xs text-slate-500">Oda atanmamış.</span>
            {!computedReadOnly && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs text-blue-700 hover:text-blue-800"
                onClick={openRoomPicker}
                disabled={saving}
              >
                <Plus className="size-3.5" />
                Oda ata
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Equipment Section                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="Ekipman Havuzu">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            Ekipman
          </h4>
          {draft.equipment.length > 0 && !isEquipPickerOpen && !computedReadOnly && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs text-blue-700 hover:text-blue-800"
              onClick={openEquipPicker}
              disabled={saving}
            >
              <Plus className="size-3.5" />
              Ekipman ekle
            </Button>
          )}
        </div>

        {/* Equipment picker */}
        {isEquipPickerOpen && !computedReadOnly && (
          <div className="mb-3 space-y-2 rounded-lg border bg-slate-50/80 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">Ekipman seçin</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs font-medium text-slate-500 hover:text-slate-800"
                onClick={closeEquipPicker}
              >
                Vazgeç
              </Button>
            </div>

            {eligibleEquipment.length === 0 ? (
              <p className="py-2 text-center text-xs text-slate-500">Bu tesis için ekipman bulunamadı.</p>
            ) : (
              <div className="max-h-48 divide-y overflow-y-auto rounded-md border bg-white">
                {eligibleEquipment.map(({ resource }) => {
                  const alreadyInDraft = draft.equipment.some((e) => e.resourceId === resource.id)
                  const remaining = maxAssignableQty(resource.id)
                  const isAvailable = remaining > 0 && !alreadyInDraft
                  const isSelected = pickerEquipId === resource.id

                  return (
                    <button
                      key={resource.id}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => {
                        if (isAvailable) {
                          setPickerEquipId(resource.id)
                          setPickerQty(1)
                        }
                      }}
                      className={cn(
                        "group flex w-full items-center justify-between px-2.5 py-2 text-left text-xs transition-colors",
                        isSelected
                          ? "bg-blue-50/90 font-medium text-blue-900 ring-1 ring-inset ring-blue-300"
                          : alreadyInDraft
                            ? "cursor-not-allowed bg-slate-100/70 text-slate-400"
                            : isAvailable
                              ? "text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
                              : "cursor-not-allowed bg-slate-100/60 text-slate-400 opacity-60",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className={cn(
                            "flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isSelected
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-300 group-hover:border-blue-400",
                          )}
                        >
                          {isSelected && <Check className="size-2.5 stroke-[3]" />}
                        </div>
                        <span className="truncate font-medium">{resource.name}</span>
                      </div>

                      <div className="ml-2 flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
                        {alreadyInDraft ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            Zaten eklendi
                          </span>
                        ) : isAvailable ? (
                          <>
                            <span className="text-slate-600">
                              {remaining} / {resource.totalQuantity} kullanılabilir
                            </span>
                            <ChevronRight className="size-3 text-slate-400 group-hover:text-blue-600" />
                          </>
                        ) : (
                          <span className="text-slate-400">Stok yetersiz</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Quantity stepper for selected equipment */}
            {pickerEquipId &&
              (() => {
                const target = eligibleEquipment.find((e) => e.resource.id === pickerEquipId)
                if (!target) return null
                const maxQty = target.remainingQuantity

                return (
                  <div className="border-t pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">Miktar</span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-7"
                          disabled={pickerQty <= 1}
                          onClick={() => setPickerQty((prev) => Math.max(1, prev - 1))}
                          aria-label="Miktarı azalt"
                        >
                          <Minus className="size-3" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={maxQty}
                          value={pickerQty}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            setPickerQty(isNaN(val) ? 1 : val)
                          }}
                          className="h-7 w-14 text-center text-xs font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-7"
                          disabled={pickerQty >= maxQty}
                          onClick={() => setPickerQty((prev) => prev + 1)}
                          aria-label="Miktarı artır"
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs font-medium"
                        onClick={closeEquipPicker}
                      >
                        Vazgeç
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={pickerQty <= 0 || pickerQty > maxQty}
                        onClick={addDraftEquipment}
                      >
                        <Check className="mr-1 size-3" />
                        Ekle
                      </Button>
                    </div>
                  </div>
                )
              })()}
          </div>
        )}

        {/* Draft equipment list */}
        {draft.equipment.length === 0 ? (
          !isEquipPickerOpen && (
            <div className="flex items-center justify-between border-t border-slate-100 py-2.5">
              <span className="text-xs text-slate-500">Ekipman atanmamış.</span>
              {!computedReadOnly && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs text-blue-700 hover:text-blue-800"
                  onClick={openEquipPicker}
                  disabled={saving}
                >
                  <Plus className="size-3.5" />
                  Ekipman ekle
                </Button>
              )}
            </div>
          )
        ) : (
          <ul className="space-y-2" aria-label="Taslak ekipman atamaları">
            {draft.equipment.map((item) => {
              const isEditing = editingDraftKey === item.draftKey && !computedReadOnly
              const info = eligibleEquipment.find((e) => e.resource.id === item.resourceId)
              // maxAssignableQuantity: service excludes THIS meeting, so remainingQuantity
              // is the full capacity available to this meeting — no addback needed.
              const maxQtyForEdit = info?.remainingQuantity ?? 0

              return (
                <li key={item.draftKey} className="rounded-lg border bg-white p-3 text-xs shadow-xs">
                  {isEditing ? (
                    <div className="space-y-2">
                      <p className="font-semibold text-slate-900">{item.resourceName}</p>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="block text-xs text-slate-600">Miktar düzenle</span>
                          <span className="text-[11px] text-slate-500">
                            En fazla: {maxQtyForEdit} adet
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-7"
                            disabled={editQty <= 1}
                            onClick={() => setEditQty((prev) => Math.max(1, prev - 1))}
                            aria-label="Miktarı azalt"
                          >
                            <Minus className="size-3" />
                          </Button>
                          <Input
                            type="number"
                            min={1}
                            max={maxQtyForEdit}
                            value={editQty}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10)
                              setEditQty(isNaN(val) ? 1 : val)
                            }}
                            className="h-7 w-14 text-center text-xs font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-7"
                            disabled={editQty >= maxQtyForEdit}
                            onClick={() => setEditQty((prev) => prev + 1)}
                            aria-label="Miktarı artır"
                          >
                            <Plus className="size-3" />
                          </Button>
                        </div>
                      </div>

                      {editQty > maxQtyForEdit && (
                        <p className="text-[11px] font-medium text-red-600">
                          Bu zaman aralığında yalnızca {maxQtyForEdit} adet kullanılabilir.
                        </p>
                      )}

                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs font-medium"
                          onClick={() => setEditingDraftKey(null)}
                        >
                          Vazgeç
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={editQty <= 0 || editQty > maxQtyForEdit}
                          onClick={() => applyEditEquip(item.draftKey)}
                        >
                          <Check className="mr-1 size-3" />
                          Uygula
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-900">{item.resourceName}</p>
                        <p className="mt-0.5 text-[11px] font-medium text-slate-600">
                          {item.requestedQuantity} adet
                          {persistedDraft.equipment.find(
                            (e) => e.resourceId === item.resourceId && e.requestedQuantity === item.requestedQuantity,
                          )
                            ? " atandı"
                            : " (kaydedilmedi)"}
                        </p>
                      </div>
                      {!computedReadOnly && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            onClick={() => openEditEquip(item.draftKey, item.requestedQuantity)}
                            disabled={saving}
                          >
                            <Pencil className="size-3" />
                            Düzenle
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            onClick={() => removeDraftEquipment(item.draftKey)}
                            disabled={saving}
                            title="Ekipman atamasını kaldır"
                            aria-label="Ekipman atamasını kaldır"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Unsaved-changes footer                                               */}
      {/* ------------------------------------------------------------------ */}
      {isDirty && !computedReadOnly && (
        <div className="shrink-0 border-t bg-white px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium text-amber-700">
              Kaydedilmemiş değişiklikler
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs font-medium"
                disabled={saving}
                onClick={discardDraft}
              >
                Vazgeç
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                <Save className="size-3" />
                {saving ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
