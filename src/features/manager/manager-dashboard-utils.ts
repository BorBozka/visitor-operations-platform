import { addMinutes, differenceInMinutes, format, isAfter, isBefore, isSameDay } from "date-fns"

import type { GoodsMovement } from "@/domain/goods-movements"
import type { PlannedTransportAssignment } from "@/domain/transport-assignments"
import type { Visit, VisitStatus } from "@/domain/visits"
import { getIstanbulHour } from "@/lib/date"

export type DashboardScope = { companyId: string; facilityId: string }
export const dashboardVisitStatuses = ["PLANNED", "LATE", "CHECKED_IN", "OVERDUE", "CHECKED_OUT", "CANCELLED"] as const
export type DashboardVisitStatus = (typeof dashboardVisitStatuses)[number]
export type OtherVisitsTab = "planned" | "completed"
export type TableStatusFilter = "ALL" | VisitStatus
export type OtherVisitsFilters = { tab: OtherVisitsTab; search: string; status: TableStatusFilter; facilityId: string }

export type OperationBin = {
  hour: number
  planned: number
  actual: number
  deliveries: GoodsMovement[]
  transportAssignments: PlannedTransportAssignment[]
}

export function getScopedVisits(visits: Visit[], scope: DashboardScope) {
  return visits.filter((visit) =>
    (scope.companyId === "all" || visit.hostCompanyId === scope.companyId) &&
    (scope.facilityId === "all" || visit.facilityId === scope.facilityId),
  )
}

export function getTodayVisits(visits: Visit[], now: Date) {
  return visits.filter((visit) => isSameDay(new Date(visit.plannedStart), now))
}

export function getTodayScopedTransportAssignments(assignments: PlannedTransportAssignment[], scope: DashboardScope, now: Date) {
  return assignments.filter((assignment) =>
    assignment.status === "ACTIVE"
    && (scope.companyId === "all" || assignment.companyId === scope.companyId)
    && (scope.facilityId === "all" || assignment.facilityId === scope.facilityId)
    && isSameDay(new Date(assignment.plannedStart), now),
  )
}

export function getTodayScopedGoodsMovements(movements: GoodsMovement[], scope: DashboardScope, now: Date) {
  const today = format(now, "yyyy-MM-dd")
  return movements.filter((movement) =>
    movement.status === "PLANNED"
    && Boolean(movement.plannedTime)
    && (scope.companyId === "all" || movement.companyId === scope.companyId)
    && (scope.facilityId === "all" || movement.facilityId === scope.facilityId)
    && movement.plannedDate === today,
  )
}

export function getOperationBins(visits: Visit[], deliveries: GoodsMovement[], transportAssignments: PlannedTransportAssignment[], startHour = 8, endHour = 23): OperationBin[] {
  return Array.from({ length: endHour - startHour + 1 }, (_, index) => {
    const hour = startHour + index
    return {
      hour,
      planned: visits.filter((visit) => getIstanbulHour(visit.plannedStart) === hour).length,
      actual: visits.filter((visit) => visit.actualCheckIn && getIstanbulHour(visit.actualCheckIn) === hour).length,
      deliveries: deliveries.filter((delivery) => delivery.plannedTime?.startsWith(String(hour).padStart(2, "0"))),
      transportAssignments: transportAssignments.filter((assignment) => getIstanbulHour(assignment.plannedStart) === hour),
    }
  })
}

export function getActiveTransportAssignments(assignments: PlannedTransportAssignment[], scope: DashboardScope, now: Date) {
  return assignments.filter((assignment) =>
    assignment.status === "ACTIVE"
    && (scope.companyId === "all" || assignment.companyId === scope.companyId)
    && (scope.facilityId === "all" || assignment.facilityId === scope.facilityId)
    && new Date(assignment.plannedStart) <= now
    && new Date(assignment.plannedEnd) > now,
  )
}

/**
 * A checked-in visitor is overdue once the current time passes
 * `plannedEnd + toleranceMinutes` (the Admin "Ziyaret gecikme toleransı" setting).
 * Landing exactly on the threshold is not yet overdue.
 */
export function isVisitOverdue(visit: Visit, now: Date, toleranceMinutes: number): boolean {
  return visit.status === "CHECKED_IN"
    && !visit.actualCheckOut
    && addMinutes(new Date(visit.plannedEnd), toleranceMinutes) < now
}

export function getDashboardVisitStatus(visit: Visit, now: Date, toleranceMinutes: number): DashboardVisitStatus | null {
  if (visit.status === "PLANNED") {
    return !visit.actualCheckIn && isBefore(new Date(visit.plannedStart), now) ? "LATE" : "PLANNED"
  }

  if (visit.status === "CHECKED_IN") {
    return isVisitOverdue(visit, now, toleranceMinutes) ? "OVERDUE" : "CHECKED_IN"
  }

  if (visit.status === "CHECKED_OUT" || visit.status === "CANCELLED") return visit.status
  return null
}

export function getStatusCounts(visits: Visit[], now: Date, toleranceMinutes: number) {
  return dashboardVisitStatuses.map((status) => ({
    status,
    value: visits.filter((visit) => getDashboardVisitStatus(visit, now, toleranceMinutes) === status).length,
  }))
}

export function getDelayMinutes(visit: Visit, now: Date) {
  return Math.max(0, differenceInMinutes(now, new Date(visit.plannedEnd)))
}

export function getNextPlannedVisits(visits: Visit[], now: Date, limit = 5) {
  return visits
    .filter((visit) => visit.status === "PLANNED" && isAfter(new Date(visit.plannedStart), now))
    .sort((left, right) => new Date(left.plannedStart).getTime() - new Date(right.plannedStart).getTime())
    .slice(0, limit)
}

export function getOtherVisits(visits: Visit[], filters: OtherVisitsFilters) {
  const query = filters.search.trim().toLocaleLowerCase("tr-TR")
  return visits.filter((visit) => {
    const tabMatches = filters.tab === "planned" ? visit.status === "PLANNED" : visit.status === "CHECKED_OUT"
    const text = (visit.visitor.firstName + " " + visit.visitor.lastName + " " + visit.hostCompanyName + " " + visit.hostEmployeeName).toLocaleLowerCase("tr-TR")
    return visit.status !== "CHECKED_IN" && tabMatches && (filters.status === "ALL" || visit.status === filters.status) && (filters.facilityId === "all" || visit.facilityId === filters.facilityId) && (!query || text.includes(query))
  })
}
