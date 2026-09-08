import { describe, expect, it } from "vitest"

import type { GoodsMovement } from "@/domain/goods-movements"
import type { PlannedTransportAssignment } from "@/domain/transport-assignments"
import type { Meeting, Visit } from "@/domain/visits"
import {
  buildFleetReportRows,
  buildGoodsReportRows,
  buildVisitsReportRows,
  formatReportWorksheet,
  FLEET_REPORT_COLUMNS,
  getReportExcelColumnWidths,
  GOODS_REPORT_COLUMNS,
  REPORT_PNG_CAPTURE_OPTIONS,
  rowsToCsv,
  VISITS_REPORT_COLUMNS,
} from "@/features/reports/report-export"
import { buildTransportAvailabilityInput } from "@/features/transport/transport-assignment-time"
import { visitReferenceDataFixture } from "@/test/fixtures/visit-reference-data"

describe("VISITS_REPORT_COLUMNS", () => {
  it("defines the export-ready column set shared by the table and every export format", () => {
    expect(VISITS_REPORT_COLUMNS.map((column) => column.key)).toEqual([
      "visitor",
      "visitorCompany",
      "host",
      "date",
      "plannedCheckIn",
      "plannedCheckOut",
      "actualCheckIn",
      "actualCheckOut",
      "status",
      "delayMinutes",
    ])
    expect(VISITS_REPORT_COLUMNS.map((column) => column.header)).toEqual([
      "Ziyaretçi",
      "Ziyaretçi Şirketi",
      "Ev Sahibi",
      "Tarih",
      "Planlanan Giriş",
      "Planlanan Çıkış",
      "Gerçek Giriş",
      "Gerçek Çıkış",
      "Durum",
      "Gecikme (dk)",
    ])
  })
})

describe("buildVisitsReportRows", () => {
  it("produces one formatted row per visit matching the column order", () => {
    const rows = buildVisitsReportRows([completedVisit(), noCheckInVisit(), noShowVisit()])

    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveLength(VISITS_REPORT_COLUMNS.length)
    expect(rows[0]).toEqual([
      "Ayşe Test",
      "Test A.Ş.",
      "Maya Kara",
      "10 Ağu 2026",
      "08:00",
      "09:00",
      "08:12",
      "08:58",
      "Gerçekleşti",
      "12",
    ])
    expect(rows[1]).toEqual([
      "Bora Test",
      "Test A.Ş.",
      "Maya Kara",
      "10 Ağu 2026",
      "08:00",
      "09:00",
      "—",
      "—",
      "Planlandı",
      "—",
    ])
    expect(rows[2][8]).toBe("Gerçekleşmedi")
  })
})

describe("FLEET_REPORT_COLUMNS", () => {
  it("defines the export-ready column set shared by the table and every export format", () => {
    expect(FLEET_REPORT_COLUMNS.map((column) => column.key)).toEqual([
      "purpose",
      "vehicle",
      "driver",
      "companyFacility",
      "planned",
      "status",
      "related",
    ])
  })
})

describe("buildFleetReportRows", () => {
  it("produces one formatted row per assignment, resolving related records and untimed schedules", () => {
    const relatedMeeting = testMeeting("meeting-1", "Maya Kara")
    const timed = testAssignment({ purpose: "Tedarikçi saha ziyareti", relatedMeetingId: "meeting-1" })
    const untimedInput = buildTransportAvailabilityInput("bplas", "bplas-merkez", "2027-01-20", "", "")!
    const untimed = testAssignment({ purpose: "Günlük saha görevi", plannedStart: untimedInput.plannedStart, plannedEnd: untimedInput.plannedEnd, status: "CANCELLED" })

    const rows = buildFleetReportRows([timed, untimed], [relatedMeeting], [])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveLength(FLEET_REPORT_COLUMNS.length)
    expect(rows[0]).toEqual([
      "Tedarikçi saha ziyareti",
      "Transit · 16 BPL 101",
      "Ayşe Demir",
      "BPLAS A.Ş. · Merkez Tesis",
      "10 Ağustos 2026 · 08:00 – 09:00",
      "Aktif",
      "Toplantı · Maya Kara",
    ])
    expect(rows[1]).toEqual([
      "Günlük saha görevi",
      "Transit · 16 BPL 101",
      "Ayşe Demir",
      "BPLAS A.Ş. · Merkez Tesis",
      expect.stringContaining("Saat belirtilmedi"),
      "İptal",
      "—",
    ])
  })
})

describe("GOODS_REPORT_COLUMNS", () => {
  it("defines the export-ready column set shared by the table and every export format", () => {
    expect(GOODS_REPORT_COLUMNS.map((column) => column.key)).toEqual([
      "direction",
      "companyFacility",
      "counterparty",
      "planned",
      "actual",
      "status",
      "reference",
      "plateDriver",
    ])
  })
})

describe("buildGoodsReportRows", () => {
  it("produces one formatted row per movement", () => {
    const rows = buildGoodsReportRows([
      testMovement({ direction: "INBOUND", status: "COMPLETED", plannedTime: "09:00", actualAt: "2026-08-10T09:12:00+03:00", referenceNumber: "REF-1", actualPlate: "16 BPL 101", actualDriverName: "Ayşe Demir" }),
      testMovement({ direction: "OUTBOUND" }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveLength(GOODS_REPORT_COLUMNS.length)
    expect(rows[0]).toEqual([
      "Gelen",
      "BPLAS A.Ş. · Merkez Tesis",
      "Test Tedarikçi",
      "10 Ağu 2026 · 09:00",
      "10 Ağu 2026 09:12",
      "Tamamlandı",
      "REF-1",
      "16 BPL 101 / Ayşe Demir",
    ])
    expect(rows[1]).toEqual([
      "Giden",
      "BPLAS A.Ş. · Merkez Tesis",
      "Test Tedarikçi",
      "10 Ağu 2026",
      "—",
      "Planlandı",
      "—",
      "—",
    ])
  })
})

describe("rowsToCsv", () => {
  it("joins headers and rows with commas and CRLF line breaks", () => {
    const csv = rowsToCsv(["A", "B"], [["1", "2"], ["3", "4"]])
    expect(csv).toBe("A,B\r\n1,2\r\n3,4")
  })

  it("quotes values containing commas, quotes, semicolons or newlines", () => {
    const csv = rowsToCsv(["Name"], [['Say "hi", please'], ["line1\nline2"], ["a;b"]])
    expect(csv).toBe('Name\r\n"Say ""hi"", please"\r\n"line1\nline2"\r\n"a;b"')
  })
})

describe("Excel report formatting", () => {
  it("calculates capped readable widths from headers and complete export rows", () => {
    const widths = getReportExcelColumnWidths(["Durum", "Ziyaretçi Şirketi"], [["Planlandı", "Çok Uzun Bir Şirket Adı ve Açıklaması"]])

    expect(widths).toEqual([{ wch: 12 }, { wch: 39 }])
  })

  it("adds widths, autofilter, row heights and a styled header to the worksheet", () => {
    const worksheet: Record<string, unknown> = { A1: {}, B1: {} }
    formatReportWorksheet(worksheet, ["Durum", "Ziyaretçi"], [["Planlandı", "Ayşe Yılmaz"]])

    expect(worksheet["!cols"]).toEqual([{ wch: 12 }, { wch: 16 }])
    expect(worksheet["!autofilter"]).toEqual({ ref: "A1:B2" })
    expect(worksheet["!rows"]).toEqual([{ hpt: 24 }, { hpt: 20 }])
    expect(worksheet.A1).toMatchObject({ s: { font: { bold: true }, alignment: { wrapText: true } } })
  })
})

describe("PNG capture configuration", () => {
  it("uses a solid white, two-times raster capture independent of browser pixel ratio", () => {
    expect(REPORT_PNG_CAPTURE_OPTIONS).toEqual({ backgroundColor: "#ffffff", scale: 2 })
  })
})

function testAssignment(overrides: {
  purpose: string
  plannedStart?: string
  plannedEnd?: string
  status?: PlannedTransportAssignment["status"]
  relatedMeetingId?: string
}): PlannedTransportAssignment {
  return {
    id: "assignment-1",
    companyId: "bplas",
    companyName: "BPLAS A.Ş.",
    facilityId: "bplas-merkez",
    facilityName: "Merkez Tesis",
    plannedStart: overrides.plannedStart ?? "2026-08-10T08:00:00+03:00",
    plannedEnd: overrides.plannedEnd ?? "2026-08-10T09:00:00+03:00",
    purpose: overrides.purpose,
    vehicleResourceId: "vehicle-1",
    vehicleName: "Transit",
    vehicleLicensePlate: "16 BPL 101",
    driverResourceId: "driver-1",
    driverName: "Ayşe Demir",
    relatedMeetingId: overrides.relatedMeetingId,
    status: overrides.status ?? "ACTIVE",
    createdAt: "2026-08-10T08:00:00+03:00",
  }
}

function testMeeting(id: string, hostEmployeeName: string): Meeting {
  return {
    id,
    creatorEmployeeId: "creator-1",
    visitTypeId: "meeting",
    visitTypeName: "Toplantı",
    hostEmployeeId: "host-1",
    hostEmployeeName,
    hostCompanyId: "bplas",
    hostCompanyName: "BPLAS A.Ş.",
    facilityId: "bplas-merkez",
    facilityName: "Merkez Tesis",
    plannedStart: "2026-08-10T08:00:00+03:00",
    plannedEnd: "2026-08-10T09:00:00+03:00",
    hasAdditionalRequirements: false,
    createdAt: "2026-08-10T08:00:00+03:00",
    updatedAt: "2026-08-10T08:00:00+03:00",
  }
}

function testMovement(overrides: {
  direction: GoodsMovement["direction"]
  status?: GoodsMovement["status"]
  plannedTime?: string
  actualAt?: string
  referenceNumber?: string
  actualPlate?: string
  actualDriverName?: string
}): GoodsMovement {
  return {
    id: "movement-1",
    direction: overrides.direction,
    companyId: "bplas",
    companyName: "BPLAS A.Ş.",
    facilityId: "bplas-merkez",
    facilityName: "Merkez Tesis",
    counterpartyName: "Test Tedarikçi",
    plannedDate: "2026-08-10",
    plannedTime: overrides.plannedTime,
    goodsDescription: "Test kalemi",
    referenceNumber: overrides.referenceNumber,
    status: overrides.status ?? "PLANNED",
    actualAt: overrides.actualAt,
    actualPlate: overrides.actualPlate,
    actualDriverName: overrides.actualDriverName,
    createdAt: "2026-08-10T08:00:00+03:00",
  }
}

function completedVisit(): Visit {
  return baseVisit({
    firstName: "Ayşe",
    status: "CHECKED_OUT",
    actualCheckIn: "2026-08-10T08:12:00+03:00",
    actualCheckOut: "2026-08-10T08:58:00+03:00",
  })
}

function noCheckInVisit(): Visit {
  return baseVisit({ firstName: "Bora", status: "PLANNED" })
}

function noShowVisit(): Visit {
  return baseVisit({ firstName: "Ceren", status: "NO_SHOW" })
}

function baseVisit(overrides: {
  firstName: string
  status: Visit["status"]
  actualCheckIn?: string
  actualCheckOut?: string
}): Visit {
  const company = visitReferenceDataFixture.companies.find((item) => item.id === "bplas")!
  const facility = visitReferenceDataFixture.facilities.find((item) => item.id === "bplas-merkez")!
  const employee = visitReferenceDataFixture.employees.find((item) => item.id === "maya-kara")!
  const type = visitReferenceDataFixture.visitTypes.find((item) => item.id === "meeting")!
  return {
    id: "v-1",
    meetingId: "meeting-1",
    creatorEmployeeId: "creator-1",
    visitor: { id: "visitor-1", firstName: overrides.firstName, lastName: "Test", email: "test@example.com", company: "Test A.Ş." },
    visitTypeId: type.id,
    visitTypeName: type.name,
    hostEmployeeId: employee.id,
    hostEmployeeName: employee.name,
    hostCompanyId: company.id,
    hostCompanyName: company.name,
    facilityId: facility.id,
    facilityName: facility.name,
    plannedStart: "2026-08-10T08:00:00+03:00",
    plannedEnd: "2026-08-10T09:00:00+03:00",
    status: overrides.status,
    invitationStatus: "SENT",
    hasAdditionalRequirements: false,
    actualCheckIn: overrides.actualCheckIn,
    actualCheckOut: overrides.actualCheckOut,
    createdAt: "2026-08-10T08:00:00+03:00",
    updatedAt: "2026-08-10T08:00:00+03:00",
  }
}
