import type { VisitReferenceData } from "@/domain/visits"

export const visitReferenceDataFixture: VisitReferenceData = {
  companies: [
    { id: "bplas", name: "BPLAS A.Ş." },
    { id: "bplas-otomotiv", name: "BPLAS Otomotiv A.Ş." },
  ],
  facilities: [
    { id: "bplas-merkez", companyId: "bplas", name: "Merkez Tesis" },
    { id: "bplas-arge", companyId: "bplas", name: "Ar-Ge Merkezi" },
    { id: "otomotiv-uretim", companyId: "bplas-otomotiv", name: "Üretim Tesisi" },
  ],
  employees: [
    { id: "maya-kara", companyId: "bplas", facilityIds: ["bplas-merkez"], name: "Maya Kara", departmentId: "yonetim", department: "Yönetim" },
    { id: "emre-yilmaz", companyId: "bplas", facilityIds: ["bplas-arge"], name: "Emre Yılmaz", departmentId: "muhendislik", department: "Mühendislik" },
    { id: "selin-aydin", companyId: "bplas-otomotiv", facilityIds: ["otomotiv-uretim"], name: "Selin Aydın", departmentId: "uretim", department: "Üretim" },
  ],
  visitTypes: [
    { id: "meeting", name: "Toplantı", active: true },
    { id: "audit", name: "Denetim", active: true },
  ],
  currentEmployee: {
    employeeId: "maya-kara",
    companyId: "bplas",
    facilityId: "bplas-merkez",
    role: "EMPLOYEE",
  },
}
