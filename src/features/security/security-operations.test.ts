import { describe, expect, it } from "vitest"

import type { Visit, VisitStatus } from "@/domain/visits"
import {
  filterSecurityVisitRows,
  getExpectedSecurityVisits,
  getInsideSecurityVisits,
  groupExpectedSecurityVisits,
  hasSecurityNote,
} from "./security-operations"

function makeVisit(id: string, status: VisitStatus, plannedStart: string, overrides: Partial<Visit> = {}): Visit {
  return {
    id,
    meetingId: `meeting-${id}`,
    creatorEmployeeId: "creator-1",
    visitor: { id: `visitor-${id}`, firstName: id, lastName: "Ziyaretçi", email: `${id}@example.com`, company: "Örnek Firma" },
    visitTypeId: "meeting",
    visitTypeName: "Toplantı",
    hostEmployeeId: "host-1",
    hostEmployeeName: "İpek Işık",
    hostCompanyId: "bplas",
    hostCompanyName: "BPLAS A.Ş.",
    facilityId: "bplas-merkez",
    facilityName: "Merkez Tesis",
    plannedStart,
    plannedEnd: "2026-08-28T13:00:00+03:00",
    status,
    invitationStatus: "SENT",
    hasAdditionalRequirements: false,
    createdAt: plannedStart,
    updatedAt: plannedStart,
    ...overrides,
  }
}

describe("security expected visits", () => {
  const now = new Date("2026-08-28T12:00:00+03:00")

  it("keeps only today's planned visits and excludes every other operational status", () => {
    const visits = [
      makeVisit("Planlı", "PLANNED", "2026-08-28T12:30:00+03:00"),
      makeVisit("Dün", "PLANNED", "2026-08-27T12:30:00+03:00"),
      makeVisit("İçeride", "CHECKED_IN", "2026-08-28T10:00:00+03:00"),
      makeVisit("Çıktı", "CHECKED_OUT", "2026-08-28T09:00:00+03:00"),
      makeVisit("İptal", "CANCELLED", "2026-08-28T14:00:00+03:00"),
    ]

    expect(getExpectedSecurityVisits(visits, now).map(({ visit }) => visit.id)).toEqual(["Planlı"])
  })

  it("marks delayed visits and sorts both delayed and upcoming visits by start time", () => {
    const visits = [
      makeVisit("Sonra", "PLANNED", "2026-08-28T15:00:00+03:00"),
      makeVisit("Geciken geç", "PLANNED", "2026-08-28T10:30:00+03:00"),
      makeVisit("Geciken erken", "PLANNED", "2026-08-28T09:30:00+03:00"),
      makeVisit("Yaklaşan", "PLANNED", "2026-08-28T12:30:00+03:00"),
    ]

    const rows = getExpectedSecurityVisits(visits, now)
    expect(rows.map(({ visit }) => visit.id)).toEqual(["Geciken erken", "Geciken geç", "Yaklaşan", "Sonra"])
    expect(rows[0]).toMatchObject({ isDelayed: true, delayMinutes: 150 })
    expect(rows[2].isDelayed).toBe(false)
  })

  it("splits sorted expected rows into delayed and upcoming groups without empty records", () => {
    const rows = getExpectedSecurityVisits([
      makeVisit("Geciken", "PLANNED", "2026-08-28T10:30:00+03:00"),
      makeVisit("Sıradaki", "PLANNED", "2026-08-28T12:30:00+03:00"),
    ], now)

    const groups = groupExpectedSecurityVisits(rows)
    expect(groups.delayed.map(({ visit }) => visit.id)).toEqual(["Geciken"])
    expect(groups.upcoming.map(({ visit }) => visit.id)).toEqual(["Sıradaki"])
  })
})

describe("security inside visits", () => {
  const now = new Date("2026-08-28T12:00:00+03:00")

  it("keeps only checked-in visits and orders overdue records by greatest delay", () => {
    const visits = [
      makeVisit("Normal", "CHECKED_IN", "2026-08-28T11:00:00+03:00", { plannedEnd: "2026-08-28T13:00:00+03:00", actualCheckIn: "2026-08-28T11:05:00+03:00" }),
      makeVisit("Az aştı", "CHECKED_IN", "2026-08-28T10:00:00+03:00", { plannedEnd: "2026-08-28T11:45:00+03:00" }),
      makeVisit("Çok aştı", "CHECKED_IN", "2026-08-28T09:00:00+03:00", { plannedEnd: "2026-08-28T10:30:00+03:00" }),
      makeVisit("Planlı", "PLANNED", "2026-08-28T12:30:00+03:00"),
      makeVisit("Çıktı", "CHECKED_OUT", "2026-08-28T09:00:00+03:00"),
    ]

    const rows = getInsideSecurityVisits(visits, now)
    expect(rows.map(({ visit }) => visit.id)).toEqual(["Çok aştı", "Az aştı", "Normal"])
    expect(rows[0]).toMatchObject({ isDelayed: true, delayMinutes: 90 })
    expect(rows[2].isDelayed).toBe(false)
  })
})

describe("security operations search", () => {
  const rows = getExpectedSecurityVisits([
    makeVisit("Ayça", "PLANNED", "2026-08-28T12:30:00+03:00", { visitor: { id: "visitor-1", firstName: "Ayça", lastName: "Yılmaz", email: "ayca@example.com", company: "İzmir Lojistik" }, hostEmployeeName: "İpek Işık" }),
  ], new Date("2026-08-28T12:00:00+03:00"))

  it.each([
    ["visitor full name", "AYÇA YILMAZ"],
    ["company", "izmir lojistik"],
    ["host", "İPEK IŞIK"],
  ])("matches %s with Turkish-aware case-insensitive behavior", (_label, query) => {
    expect(filterSecurityVisitRows(rows, query)).toHaveLength(1)
  })

  it("returns no records for an unrelated search", () => {
    expect(filterSecurityVisitRows(rows, "eşleşmeyen")).toEqual([])
  })
})

describe("security note visibility", () => {
  it.each([undefined, "", "   "])("hides the note icon for an empty note (%s)", (note) => {
    expect(hasSecurityNote(note)).toBe(false)
  })

  it("shows the note icon for a non-empty note", () => {
    expect(hasSecurityNote("Girişte güvenliği bilgilendirin.")).toBe(true)
  })
})
