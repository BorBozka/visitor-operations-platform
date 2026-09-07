import { differenceInMinutes, isBefore, isSameDay } from "date-fns"

import type { Visit } from "@/domain/visits"

export interface SecurityVisitRow {
  visit: Visit
  isDelayed: boolean
  delayMinutes: number
}

export interface ExpectedSecurityVisitGroups {
  delayed: SecurityVisitRow[]
  upcoming: SecurityVisitRow[]
}

export function hasSecurityNote(note: string | undefined) {
  return Boolean(note && note.trim().length > 0)
}

export function getSecurityScopedVisits(visits: Visit[], companyId: string, facilityId: string) {
  return visits.filter((visit) => visit.hostCompanyId === companyId && visit.facilityId === facilityId)
}

export function getExpectedSecurityVisits(visits: Visit[], now: Date): SecurityVisitRow[] {
  return visits
    .filter((visit) => visit.status === "PLANNED" && isSameDay(new Date(visit.plannedStart), now))
    .map((visit) => {
      const isDelayed = isBefore(new Date(visit.plannedStart), now)
      return { visit, isDelayed, delayMinutes: isDelayed ? differenceInMinutes(now, new Date(visit.plannedStart)) : 0 }
    })
    .sort((left, right) => {
      if (left.isDelayed !== right.isDelayed) return left.isDelayed ? -1 : 1
      return new Date(left.visit.plannedStart).getTime() - new Date(right.visit.plannedStart).getTime()
        || left.visit.id.localeCompare(right.visit.id)
    })
}

export function groupExpectedSecurityVisits(rows: SecurityVisitRow[]): ExpectedSecurityVisitGroups {
  return {
    delayed: rows.filter((row) => row.isDelayed),
    upcoming: rows.filter((row) => !row.isDelayed),
  }
}

export function getInsideSecurityVisits(visits: Visit[], now: Date): SecurityVisitRow[] {
  return visits
    .filter((visit) => visit.status === "CHECKED_IN")
    .map((visit) => {
      const isDelayed = isBefore(new Date(visit.plannedEnd), now)
      return { visit, isDelayed, delayMinutes: isDelayed ? differenceInMinutes(now, new Date(visit.plannedEnd)) : 0 }
    })
    .sort((left, right) => {
      if (left.isDelayed !== right.isDelayed) return left.isDelayed ? -1 : 1
      if (left.isDelayed && right.isDelayed) return right.delayMinutes - left.delayMinutes
      return new Date(left.visit.plannedEnd).getTime() - new Date(right.visit.plannedEnd).getTime()
        || new Date(left.visit.actualCheckIn ?? left.visit.plannedStart).getTime() - new Date(right.visit.actualCheckIn ?? right.visit.plannedStart).getTime()
        || left.visit.id.localeCompare(right.visit.id)
    })
}

export function filterSecurityVisitRows(rows: SecurityVisitRow[], search: string) {
  const query = normalizeTurkishSearch(search)
  if (!query) return rows

  return rows.filter(({ visit }) => normalizeTurkishSearch([
    visit.visitor.firstName,
    visit.visitor.lastName,
    visit.visitor.company,
    visit.hostEmployeeName,
  ].join(" ")).includes(query))
}

function normalizeTurkishSearch(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR")
}
