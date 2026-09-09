import writeXlsxFile, { type CellObject, type Feature, type SheetData, type SheetOptions } from "write-excel-file/browser"
import { getOrderOfSiblings, getSelfClosingTagMarkup, insertElementMarkupAccordingToOrderOfSiblings } from "write-excel-file/utility"

type BrowserFileContent = File | Blob | ArrayBuffer

export interface ReportExcelSheet {
  data: SheetData
  options: SheetOptions<BrowserFileContent>
  autoFilterRef: string
}

function spreadsheetColumnName(index: number) {
  let value = index + 1
  let name = ""
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function getExcelColumnLimits(header: string) {
  if (/^(Yön|Tarih|Durum|Süre|Referans No|Gecikme \(dk\)|Planlanan Giriş|Planlanan Çıkış|Gerçek Giriş|Gerçek Çıkış)$/u.test(header)) return { min: 12, max: 20 }
  if (/Şirket|Karşı Taraf|İlişkili/u.test(header)) return { min: 18, max: 40 }
  return { min: 16, max: 30 }
}

export function getReportExcelColumnWidths(headers: string[], rows: string[][]) {
  return headers.map((header, index) => {
    const longestValue = rows.reduce((longest, row) => Math.max(longest, row[index]?.length ?? 0), header.length)
    const limits = getExcelColumnLimits(header)
    return { wch: Math.min(limits.max, Math.max(limits.min, longestValue + 2)) }
  })
}

export function createReportAutoFilterFeature(ref: string): Feature<BrowserFileContent> {
  return {
    files: {
      transform: {
        "xl/worksheets/sheet{id}.xml": {
          transform(xml, _sheetOptions, { sheetIndex }) {
            if (sheetIndex !== 0) return xml
            const order = getOrderOfSiblings("xl/worksheets/sheet{id}.xml", "worksheet")
            if (!order) throw new Error("XLSX worksheet element order is unavailable")
            return insertElementMarkupAccordingToOrderOfSiblings(
              xml,
              getSelfClosingTagMarkup("autoFilter", { ref }),
              order,
              "worksheet",
            )
          },
        },
      },
    },
  }
}

export function buildReportExcelSheet(sheetName: string, headers: string[], rows: string[][]): ReportExcelSheet {
  const headerRow: CellObject[] = headers.map((value) => ({
    value,
    type: String,
    height: 24,
    fontWeight: "bold",
    textColor: "#FFFFFF",
    backgroundColor: "#1E3A5F",
    align: "center",
    alignVertical: "center",
    wrap: true,
  }))
  const dataRows: CellObject[][] = rows.map((row) => row.map((value) => ({ value, type: String, height: 20 })))
  const widths = getReportExcelColumnWidths(headers, rows)

  return {
    data: [headerRow, ...dataRows],
    options: {
      sheet: sheetName,
      columns: widths.map(({ wch }) => ({ width: wch })),
    },
    autoFilterRef: `A1:${spreadsheetColumnName(headers.length - 1)}${rows.length + 1}`,
  }
}

export async function createReportExcelBlob(sheetName: string, headers: string[], rows: string[][]) {
  const sheet = buildReportExcelSheet(sheetName, headers, rows)
  return writeXlsxFile(sheet.data, sheet.options, {
    features: [createReportAutoFilterFeature(sheet.autoFilterRef)],
  }).toBlob()
}

export async function downloadReportExcelFile(sheetName: string, headers: string[], rows: string[][], filename: string) {
  const sheet = buildReportExcelSheet(sheetName, headers, rows)
  await writeXlsxFile(sheet.data, sheet.options, {
    features: [createReportAutoFilterFeature(sheet.autoFilterRef)],
  }).toFile(filename)
}
