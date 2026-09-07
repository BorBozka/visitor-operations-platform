import { AlertTriangle, CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock3, LoaderCircle, MapPin } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import { isTimeBoundVisitType, type InvitationStatus, type Meeting, type Visit } from "@/domain/visits"
import { MeetingLifecycleActions } from "@/features/visits/MeetingLifecycleActions"
import { getNextExpandedMeetingId } from "@/features/visits/hosted-meeting-notifications-utils"
import { getActionRequiredInvitationVisits, getInvitationActionLabel } from "@/features/visits/invitation-status"
import { useInvitationSend } from "@/features/visits/use-invitation-send"
import { useVisits } from "@/features/visits/visit-context"
import { formatMinutesDuration, formatTr } from "@/lib/date"
import { shouldShowDifferentFacility } from "@/lib/facility-visibility"
import { getOverdueOpenHostedMeetings } from "@/lib/meeting-lifecycle"
import { visitService } from "@/services"

interface HostedMeetingEndNotificationsProps {
  onInvitationEdit?(visit: Visit): void
  isEmployeeView?: boolean
}

export function HostedMeetingEndNotifications({ onInvitationEdit = () => undefined, isEmployeeView = false }: HostedMeetingEndNotificationsProps) {
  const { meetings, visits, referenceData, reload } = useVisits()
  const { sendInvitation, resolveStatus, sentIds } = useInvitationSend()
  const [now, setNow] = useState(() => new Date())
  const [isMinimized, setIsMinimized] = useState(false)
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null)
  const actionContentRef = useRef<HTMLDivElement>(null)
  const actorEmployeeId = referenceData?.currentEmployee.employeeId
  const currentFacilityId = referenceData?.currentEmployee.facilityId

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const overdueMeetings = useMemo(
    () => getOverdueOpenHostedMeetings(meetings, visits, actorEmployeeId, now),
    [actorEmployeeId, meetings, now, visits],
  )
  const timeBoundOverdueMeetings = useMemo(
    () => overdueMeetings.filter((meeting) => isTimeBoundVisitType(meeting.visitTypeName)),
    [overdueMeetings],
  )
  const untimedOverdueMeetings = useMemo(
    () => overdueMeetings.filter((meeting) => !isTimeBoundVisitType(meeting.visitTypeName)),
    [overdueMeetings],
  )
  const invitationVisits = useMemo(
    () => getActionRequiredInvitationVisits(visits, actorEmployeeId),
    [actorEmployeeId, visits],
  )
  // A freshly-sent invitation leaves the actionable set immediately; keep it on screen for a
  // moment so its "Davet gönderildi" result is visible in place before the row clears.
  const recentlySentInvitationVisits = useMemo(
    () => visits.filter((visit) => sentIds.has(visit.id) && !invitationVisits.some((candidate) => candidate.id === visit.id)),
    [invitationVisits, sentIds, visits],
  )
  const displayedInvitationVisits = [...invitationVisits, ...recentlySentInvitationVisits]
  const actionCount = timeBoundOverdueMeetings.length + invitationVisits.length

  if ((actionCount === 0 && recentlySentInvitationVisits.length === 0) || !actorEmployeeId) return null

  if (isMinimized) {
    return (
      <Button type="button" variant="outline" className={`fixed bottom-4 ${isEmployeeView ? "right-3" : "right-4"} z-40 h-10 max-w-[calc(100vw-2rem)] gap-2 border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-950 shadow-lg hover:bg-amber-100`} onClick={() => setIsMinimized(false)} aria-label={`${actionCount} işlem gerekiyor. Paneli genişlet`} aria-expanded={false} aria-controls="action-required-content">
        <AlertTriangle className="size-4 shrink-0 text-amber-700" />
        <span>{actionCount} işlem gerekiyor</span>
        <ChevronUp className="size-3.5 shrink-0" />
      </Button>
    )
  }

  return (
    <section className={`fixed ${isEmployeeView ? "bottom-[14px] right-3 w-[min(244px,calc(100vw-2rem))]" : "bottom-4 right-4 w-[min(288px,calc(100vw-2rem))]"} z-40 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl`} style={{ maxHeight: isEmployeeView ? "calc(100dvh - 90px)" : "calc(100dvh - 94px)" }}>
      <button type="button" className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-2 py-2 text-left hover:bg-amber-100" onClick={() => setIsMinimized(true)} aria-expanded aria-controls="action-required-content">
        <AlertTriangle className="size-4 shrink-0 text-amber-700" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-amber-950">İşlem gerekenler</span>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-200 px-1.5 text-[11px] font-bold text-amber-900">{actionCount}</span>
        <ChevronDown className="size-4 shrink-0 text-amber-800" />
      </button>
      <div ref={actionContentRef} id="action-required-content" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {timeBoundOverdueMeetings.length > 0 && (
          <section aria-labelledby="meeting-actions-heading">
            <div id="meeting-actions-heading" className="sticky top-0 z-10 flex items-center justify-between bg-slate-100 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Süresi aşılanlar</span><span>{timeBoundOverdueMeetings.length}</span>
            </div>
            <div className="divide-y divide-slate-200">
              {timeBoundOverdueMeetings.map((meeting) => (
                <HostedMeetingNotificationRow key={meeting.id} meeting={meeting} meetingVisits={visits.filter((visit) => visit.meetingId === meeting.id)} actorEmployeeId={actorEmployeeId} currentFacilityId={currentFacilityId} now={now} scrollContainerRef={actionContentRef} isExpanded={expandedMeetingId === meeting.id} onExpandedChange={() => setExpandedMeetingId((current) => getNextExpandedMeetingId(current, meeting.id))} onChanged={reload} />
              ))}
            </div>
          </section>
        )}
        {displayedInvitationVisits.length > 0 && (
          <section aria-labelledby="invitation-actions-heading" className={timeBoundOverdueMeetings.length > 0 ? "border-t border-slate-200" : undefined}>
            <div id="invitation-actions-heading" className="sticky top-0 z-10 flex items-center justify-between bg-slate-100 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Davetler</span><span>{displayedInvitationVisits.length}</span>
            </div>
            <div className="divide-y divide-slate-200">
              {displayedInvitationVisits.map((visit) => <InvitationNotificationRow key={visit.id} visit={visit} currentFacilityId={currentFacilityId} status={resolveStatus(visit)} onEdit={() => onInvitationEdit(visit)} onSend={() => { void sendInvitation(visit.id) }} />)}
            </div>
          </section>
        )}
        {untimedOverdueMeetings.length > 0 && (
          <section aria-labelledby="untimed-meetings-heading" className={timeBoundOverdueMeetings.length > 0 || displayedInvitationVisits.length > 0 ? "border-t border-slate-200" : undefined}>
            <div id="untimed-meetings-heading" className="sticky top-0 z-10 flex items-center justify-between bg-slate-100 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Süresiz ziyaretler</span><span>{untimedOverdueMeetings.length}</span>
            </div>
            <div className="divide-y divide-slate-200">
              {untimedOverdueMeetings.map((meeting) => (
                <UntimedMeetingNotificationRow key={meeting.id} meeting={meeting} meetingVisits={visits.filter((visit) => visit.meetingId === meeting.id)} currentFacilityId={currentFacilityId} now={now} />
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}

interface InvitationNotificationRowProps {
  visit: Visit
  currentFacilityId?: string
  status: InvitationStatus
  onEdit?(): void
  onSend(): void
}

// The button sends the invitation directly, reusing the shared send flow — it no longer opens
// the visit form. Sending disables the button, and the result (sent / failed with retry) shows
// in the row.
export function InvitationNotificationRow({ visit, currentFacilityId, status, onEdit = () => undefined, onSend }: InvitationNotificationRowProps) {
  const isSending = status === "SENDING"
  const isSent = status === "SENT"
  const hasFailed = status === "FAILED"
  const statusLabel = isSent ? "Davet gönderildi" : hasFailed ? "Gönderim başarısız" : "Gönderilmedi"
  const statusClass = isSent ? "text-emerald-700" : hasFailed ? "text-red-700" : "text-amber-800"

  return (
    <article className="min-w-0 px-2 py-2 transition-shadow hover:shadow-[inset_3px_0_0_hsl(var(--primary))]">
      <div role="button" tabIndex={0} className="flex min-w-0 cursor-pointer items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onEdit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onEdit() } }} aria-label={`${visit.visitor.firstName} ${visit.visitor.lastName} ziyaretini düzenle`}>
        <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">{visit.visitor.firstName} {visit.visitor.lastName}</h3>
          <span className={`shrink-0 whitespace-nowrap text-[11px] font-medium ${statusClass}`}>{statusLabel}</span>
        </div>
        <p className="mt-0.5 min-w-0 truncate text-xs text-slate-400">{visit.visitTypeName}</p>
        <div className="mt-1 flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-[11px] text-slate-600">
          {shouldShowDifferentFacility(visit.facilityId, currentFacilityId) && (
            <span className="inline-flex min-w-0 flex-1 items-center gap-1"><MapPin className="size-3 shrink-0" /><span className="min-w-0 truncate">{visit.facilityName}</span></span>
          )}
          <span className="inline-flex min-w-0 shrink items-center gap-1"><CalendarDays className="size-3 shrink-0" /><span className="min-w-0 truncate">Başlangıç {formatTr(new Date(visit.plannedStart), "d MMM · HH:mm")}</span></span>
        </div>
        </div>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
      </div>
      {!isSent && (
        <Button type="button" variant="outline" size="sm" className="mt-2 h-7 px-2 text-[11px]" onClick={(event) => { event.stopPropagation(); onSend() }} disabled={isSending}>
          {isSending && <LoaderCircle className="mr-1 size-3 shrink-0 animate-spin" aria-hidden="true" />}
          {isSending ? "Gönderiliyor…" : getInvitationActionLabel({ ...visit, invitationStatus: status })}
        </Button>
      )}
    </article>
  )
}

interface HostedMeetingNotificationRowProps {
  meeting: Meeting
  meetingVisits: Visit[]
  actorEmployeeId: string
  currentFacilityId?: string
  now: Date
  scrollContainerRef: RefObject<HTMLDivElement | null>
  isExpanded: boolean
  onExpandedChange(): void
  onChanged(): Promise<void>
}

export function HostedMeetingNotificationRow({ meeting, meetingVisits, actorEmployeeId, currentFacilityId, now, scrollContainerRef, isExpanded, onExpandedChange, onChanged }: HostedMeetingNotificationRowProps) {
  const actionsRef = useRef<HTMLDivElement>(null)
  const isTimeBound = isTimeBoundVisitType(meeting.visitTypeName)
  const canExpand = isTimeBound
  const isRowExpanded = canExpand && isExpanded
  const visitorNames = meetingVisits.map((visit) => `${visit.visitor.firstName} ${visit.visitor.lastName}`)
  const visitorSummary = visitorNames.length > 2 ? `${visitorNames.slice(0, 2).join(", ")} +${visitorNames.length - 2}` : visitorNames.join(", ") || "Ziyaretçi kaydı yok"
  const overdueMinutes = Math.max(0, Math.floor((now.getTime() - new Date(meeting.plannedEnd).getTime()) / 60_000))

  useEffect(() => {
    if (!isRowExpanded) return
    const frame = window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      const actions = actionsRef.current
      if (!container || !actions) return
      const containerBounds = container.getBoundingClientRect()
      const actionsBounds = actions.getBoundingClientRect()
      if (actionsBounds.bottom > containerBounds.bottom) container.scrollTop += actionsBounds.bottom - containerBounds.bottom
      if (actionsBounds.top < containerBounds.top) container.scrollTop += actionsBounds.top - containerBounds.top
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isRowExpanded, scrollContainerRef])

  return (
    <article className={`min-w-0 px-2 py-2 transition-shadow ${canExpand && !isRowExpanded ? "hover:shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""}`}>
      {canExpand ? (
        <button type="button" className="flex min-w-0 w-full items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onExpandedChange} aria-expanded={isExpanded} aria-controls={`hosted-meeting-actions-${meeting.id}`}>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">{visitorSummary}</h3>
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium text-amber-800"><Clock3 className="size-3 shrink-0" />{overdueMinutes === 0 ? "Bitiş saati geldi" : `${formatMinutesDuration(overdueMinutes)} geçti`}</span>
            </div>
            <p className="mt-0.5 min-w-0 truncate text-xs text-slate-400">{meeting.visitTypeName}</p>
            <div className="mt-1 flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-[11px] text-slate-600">
              {shouldShowDifferentFacility(meeting.facilityId, currentFacilityId) && (
                <span className="inline-flex min-w-0 flex-1 items-center gap-1"><MapPin className="size-3 shrink-0" /><span className="min-w-0 truncate">{meeting.facilityName}</span></span>
              )}
              <span className="inline-flex min-w-0 shrink items-center gap-1"><CalendarDays className="size-3 shrink-0" /><span className="min-w-0 truncate">Çıkış {formatTr(new Date(meeting.plannedEnd), "d MMM · HH:mm")}</span></span>
            </div>
          </div>
          <ChevronRight className={`mt-0.5 size-4 shrink-0 text-slate-500 transition-transform ${isRowExpanded ? "rotate-90" : ""}`} aria-hidden="true" />
        </button>
      ) : (
        <div className="min-w-0 w-full">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">{visitorSummary}</h3>
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium text-amber-800"><Clock3 className="size-3 shrink-0" />{overdueMinutes === 0 ? "Bitiş saati geldi" : `${formatMinutesDuration(overdueMinutes)} geçti`}</span>
          </div>
          <p className="mt-0.5 min-w-0 truncate text-xs text-slate-400">{meeting.visitTypeName}</p>
          <div className="mt-1 flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-[11px] text-slate-600">
            {shouldShowDifferentFacility(meeting.facilityId, currentFacilityId) && (
              <span className="inline-flex min-w-0 flex-1 items-center gap-1"><MapPin className="size-3 shrink-0" /><span className="min-w-0 truncate">{meeting.facilityName}</span></span>
            )}
            <span className="inline-flex min-w-0 shrink items-center gap-1"><CalendarDays className="size-3 shrink-0" /><span className="min-w-0 truncate">Çıkış {formatTr(new Date(meeting.plannedEnd), "d MMM · HH:mm")}</span></span>
          </div>
        </div>
      )}
      {isRowExpanded && (
        <div ref={actionsRef} id={`hosted-meeting-actions-${meeting.id}`} className="mt-2 border-t border-slate-100 pt-2" onClick={(event) => event.stopPropagation()}>
          <MeetingLifecycleActions visitTypeName={meeting.visitTypeName} meetingLabel={meeting.visitTypeName} onExtend={async (minutes) => {
            await visitService.extendMeeting(meeting.id, { extensionMinutes: minutes, actorEmployeeId, currentTime: now.toISOString() })
            await onChanged()
          }} now={now} onClose={async () => {
            await visitService.closeMeeting(meeting.id, { source: "MANUAL", actorEmployeeId })
            await onChanged()
          }} />
        </div>
      )}
    </article>
  )
}

export interface UntimedMeetingNotificationRowProps {
  meeting: Meeting
  meetingVisits: Visit[]
  currentFacilityId?: string
  now: Date
}

export function UntimedMeetingNotificationRow({ meeting, meetingVisits, currentFacilityId, now }: UntimedMeetingNotificationRowProps) {
  const visitorNames = meetingVisits.map((visit) => `${visit.visitor.firstName} ${visit.visitor.lastName}`)
  const visitorSummary = visitorNames.length > 2 ? `${visitorNames.slice(0, 2).join(", ")} +${visitorNames.length - 2}` : visitorNames.join(", ") || "Ziyaretçi kaydı yok"
  const overdueMinutes = Math.max(0, Math.floor((now.getTime() - new Date(meeting.plannedEnd).getTime()) / 60_000))

  return (
    <article className="min-w-0 px-2 py-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">{visitorSummary}</h3>
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium text-amber-800">
            <Clock3 className="size-3 shrink-0" />
            {overdueMinutes === 0 ? "Bitiş saati geldi" : `${formatMinutesDuration(overdueMinutes)} geçti`}
          </span>
        </div>
        <p className="mt-0.5 min-w-0 truncate text-xs text-slate-400">{meeting.visitTypeName}</p>
        <div className="mt-1 flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-[11px] text-slate-600">
          {shouldShowDifferentFacility(meeting.facilityId, currentFacilityId) && (
            <span className="inline-flex min-w-0 flex-1 items-center gap-1">
              <MapPin className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{meeting.facilityName}</span>
            </span>
          )}
          <span className="inline-flex min-w-0 shrink items-center gap-1">
            <CalendarDays className="size-3 shrink-0" />
            <span className="min-w-0 truncate">Çıkış {formatTr(new Date(meeting.plannedEnd), "d MMM · HH:mm")}</span>
          </span>
        </div>
      </div>
    </article>
  )
}
