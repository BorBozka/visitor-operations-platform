import { getGoodsDirectionLabel, getGoodsMovementDisplayStatus, type GoodsMovement } from "@/domain/goods-movements"
import type { PlannedTransportAssignment } from "@/domain/transport-assignments"
import type { Meeting, Visit } from "@/domain/visits"
import { formatTransportAssignmentSchedule } from "@/features/transport/transport-assignment-time"
import { getRelatedRecordLabel } from "@/features/reports/fleet-report-utils"
import { GOODS_REPORT_STATUS_LABELS } from "@/features/reports/goods-report-utils"
import { getVisitDelayMinutes, getVisitReportStatusGroup, VISITS_REPORT_STATUS_LABELS } from "@/features/reports/visits-report-utils"
import { formatTr } from "@/lib/date"

export interface ReportColumn {
  key: string
  header: string
}

// Exposed via ref from each report tab so the single "Dışa Aktar" dropdown fixed at the
// Reports tab row can trigger the active tab's own export handlers unchanged.
export interface ReportExportHandle {
  exportCsv(): void
  exportExcel(): void
  exportPdf(): void
  exportChartPng?(): void
}

// Single source of truth for the Visits report table, CSV, Excel, and PDF exports —
// keeps the on-screen table and every export format aligned to the same column set.
export const VISITS_REPORT_COLUMNS: ReportColumn[] = [
  { key: "visitor", header: "Ziyaretçi" },
  { key: "visitorCompany", header: "Ziyaretçi Şirketi" },
  { key: "host", header: "Ev Sahibi" },
  { key: "date", header: "Tarih" },
  { key: "plannedCheckIn", header: "Planlanan Giriş" },
  { key: "plannedCheckOut", header: "Planlanan Çıkış" },
  { key: "actualCheckIn", header: "Gerçek Giriş" },
  { key: "actualCheckOut", header: "Gerçek Çıkış" },
  { key: "status", header: "Durum" },
  { key: "delayMinutes", header: "Gecikme (dk)" },
]

export function buildVisitsReportRows(visits: Visit[]): string[][] {
  return visits.map((visit) => {
    const delay = getVisitDelayMinutes(visit)
    return [
      `${visit.visitor.firstName} ${visit.visitor.lastName}`,
      visit.visitor.company,
      visit.hostEmployeeName,
      formatTr(new Date(visit.plannedStart), "d MMM yyyy"),
      formatTr(new Date(visit.plannedStart), "HH:mm"),
      formatTr(new Date(visit.plannedEnd), "HH:mm"),
      visit.actualCheckIn ? formatTr(new Date(visit.actualCheckIn), "HH:mm") : "—",
      visit.actualCheckOut ? formatTr(new Date(visit.actualCheckOut), "HH:mm") : "—",
      VISITS_REPORT_STATUS_LABELS[getVisitReportStatusGroup(visit.status)],
      delay === null ? "—" : String(delay),
    ]
  })
}

// Single source of truth for the Araç/Şoför report table, CSV, Excel, and PDF exports.
export const FLEET_REPORT_COLUMNS: ReportColumn[] = [
  { key: "purpose", header: "Amaç" },
  { key: "vehicle", header: "Araç" },
  { key: "driver", header: "Şoför" },
  { key: "companyFacility", header: "Şirket / Tesis" },
  { key: "planned", header: "Planlanan Başlangıç - Bitiş" },
  { key: "status", header: "Durum" },
  { key: "related", header: "İlişkili Ziyaret / Toplantı" },
]

export function buildFleetReportRows(assignments: PlannedTransportAssignment[], meetings: Meeting[], visits: Visit[]): string[][] {
  return assignments.map((assignment) => [
    assignment.purpose,
    `${assignment.vehicleName} · ${assignment.vehicleLicensePlate}`,
    assignment.driverName,
    `${assignment.companyName} · ${assignment.facilityName}`,
    formatTransportAssignmentSchedule(assignment, true),
    assignment.status === "ACTIVE" ? "Aktif" : "İptal",
    getRelatedRecordLabel(assignment, meetings, visits),
  ])
}

// Single source of truth for the Mal Hareketi report table, CSV, Excel, and PDF exports.
export const GOODS_REPORT_COLUMNS: ReportColumn[] = [
  { key: "direction", header: "Yön" },
  { key: "companyFacility", header: "Şirket / Tesis" },
  { key: "counterparty", header: "Karşı Taraf" },
  { key: "planned", header: "Planlanan Tarih / Saat" },
  { key: "actual", header: "Gerçek Zaman" },
  { key: "status", header: "Durum" },
  { key: "reference", header: "Referans No" },
  { key: "plateDriver", header: "Plaka / Şoför" },
]

export function buildGoodsReportRows(movements: GoodsMovement[]): string[][] {
  return movements.map((movement) => [
    getGoodsDirectionLabel(movement.direction),
    `${movement.companyName} · ${movement.facilityName}`,
    movement.counterpartyName,
    `${formatTr(new Date(`${movement.plannedDate}T12:00:00`), "d MMM yyyy")}${movement.plannedTime ? ` · ${movement.plannedTime}` : ""}`,
    movement.actualAt ? formatTr(new Date(movement.actualAt), "d MMM yyyy HH:mm") : "—",
    GOODS_REPORT_STATUS_LABELS[getGoodsMovementDisplayStatus(movement)],
    movement.referenceNumber ?? "—",
    movement.actualPlate || movement.actualDriverName ? `${movement.actualPlate ?? "—"} / ${movement.actualDriverName ?? "—"}` : "—",
  ])
}

// Spreadsheet apps evaluate a cell whose text starts with one of these as a formula. Report rows
// carry visitor/public-invitation input, and the CSV is written with a BOM so Excel opens it
// directly — so a value like `=SUM(A1:A2)` would really execute on open.
const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"]

// Formula neutralization only: prefixing with an apostrophe makes Excel/LibreOffice/Sheets read
// the value as literal text. CSV delimiter/quote escaping stays separate and runs afterwards.
function neutralizeCsvFormula(value: string): string {
  return CSV_FORMULA_PREFIXES.includes(value.charAt(0)) ? `'${value}` : value
}

export function rowsToCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string) => {
    const safe = neutralizeCsvFormula(value)
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const REPORT_PNG_CAPTURE_OPTIONS = {
  backgroundColor: "#ffffff",
  scale: 2,
} as const

const REPORT_PNG_TRANSIENT_SELECTOR = ".recharts-tooltip-wrapper, .recharts-tooltip-cursor, .recharts-active-dot, .recharts-active-bar, [role=tooltip]"
const REPORT_PNG_COMPARISON_LABEL_SELECTOR = ".report-png-comparison-label"

export function getReportPngCaptureSize(element: HTMLElement) {
  const bounds = element.getBoundingClientRect()
  return {
    width: Math.max(1, Math.ceil(element.scrollWidth || bounds.width)),
    height: Math.max(1, Math.ceil(element.scrollHeight || bounds.height)),
  }
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

function hideTransientChartUi(captureCard: HTMLElement) {
  captureCard.querySelectorAll<HTMLElement>(REPORT_PNG_TRANSIENT_SELECTOR).forEach((node) => {
    node.style.display = "none"
  })
}

function prepareComparisonLabelsForPngCapture(captureCard: HTMLElement) {
  // `truncate` gives the live label an overflow boundary. Under html2canvas' cloned layout,
  // the fractional 11px/16.5px line box can be rounded below an ascender and clip the label's
  // top edge. Keep its original box and flex allocation, but allow that raster-only clone to
  // paint its full glyph bounds above the chart boundary.
  captureCard.querySelectorAll<HTMLElement>(REPORT_PNG_COMPARISON_LABEL_SELECTOR).forEach((label) => {
    label.style.overflow = "visible"
    label.style.textOverflow = "clip"
    label.style.position = "relative"
    label.style.zIndex = "1"
  })
}

export async function downloadElementAsPng(element: HTMLElement, filename: string) {
  // Capture a detached copy. The live card can use a constrained viewport height and contains
  // responsive Recharts markup; capturing it in-place caused clipping and hover artifacts.
  await document.fonts?.ready
  await nextAnimationFrame()
  await nextAnimationFrame()

  const { width, height } = getReportPngCaptureSize(element)
  const host = document.createElement("div")
  const captureCard = element.cloneNode(true) as HTMLElement
  host.setAttribute("aria-hidden", "true")
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;pointer-events:none;overflow:visible;background:#ffffff;`
  captureCard.classList.add("report-png-capture")
  captureCard.style.width = `${width}px`
  captureCard.style.height = `${height}px`
  captureCard.style.minHeight = "0"
  captureCard.style.maxHeight = "none"
  captureCard.style.overflow = "visible"
  captureCard.style.backgroundColor = REPORT_PNG_CAPTURE_OPTIONS.backgroundColor
  captureCard.style.cursor = "default"
  captureCard.querySelectorAll<HTMLElement>("p, h1, h2, h3, span, li, text").forEach((node) => {
    node.style.wordSpacing = "normal"
    node.style.letterSpacing = node.style.letterSpacing || "normal"
  })
  hideTransientChartUi(captureCard)
  prepareComparisonLabelsForPngCapture(captureCard)
  host.appendChild(captureCard)
  document.body.appendChild(host)

  try {
    const { default: html2canvas } = await import("html2canvas")
    const canvas = await html2canvas(captureCard, {
      ...REPORT_PNG_CAPTURE_OPTIONS,
      height,
      width,
      windowHeight: height,
      windowWidth: width,
      scrollX: 0,
      scrollY: 0,
      logging: false,
      useCORS: true,
    })
    const link = document.createElement("a")
    link.download = filename
    link.href = canvas.toDataURL("image/png")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } finally {
    host.remove()
  }
}

const UTF8_BOM = String.fromCharCode(0xfeff)

export function downloadReportCsv(headers: string[], rows: string[][], filename: string) {
  // UTF-8 BOM keeps Excel from mangling Turkish characters when it opens the CSV directly.
  const blob = new Blob([UTF8_BOM + rowsToCsv(headers, rows)], { type: "text/csv;charset=utf-8;" })
  triggerBrowserDownload(blob, filename)
}

export async function downloadReportExcel(sheetName: string, headers: string[], rows: string[][], filename: string) {
  const { downloadReportExcelFile } = await import("@/features/reports/report-excel-export")
  await downloadReportExcelFile(sheetName, headers, rows, filename)
}

export async function downloadReportPdf(title: string, headers: string[], rows: string[][], filename: string) {
  const [{ jsPDF }, { default: autoTable }, { loadReportPdfFont, registerReportPdfFont, REPORT_PDF_FONT }] = await Promise.all([import("jspdf"), import("jspdf-autotable"), import("@/features/reports/report-pdf-font")])
  const doc = new jsPDF({ orientation: "landscape" })
  registerReportPdfFont(doc, await loadReportPdfFont())
  doc.setFontSize(12)
  doc.text(title, 14, 12)
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 17,
    margin: { left: 10, right: 10, bottom: 12 },
    styles: { font: REPORT_PDF_FONT.family, fontStyle: "normal", fontSize: 7, cellPadding: 1.6, overflow: "linebreak", valign: "middle" },
    headStyles: { font: REPORT_PDF_FONT.family, fontStyle: "normal", fontSize: 7.2, fillColor: [30, 58, 95], textColor: [255, 255, 255], halign: "center" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didDrawPage: () => { doc.setFont(REPORT_PDF_FONT.family, "normal") },
  })
  doc.save(filename)
}
