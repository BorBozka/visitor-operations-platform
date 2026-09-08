import { describe, expect, it } from "vitest"

import {
  isAdminEmailTaken,
  isAdminUsernameTaken,
  isAuthorizationScopeValid,
  isTimeBoundVisitType,
  isVisitTypeNameTaken,
  canMarkVisitorCardLost,
  canRestoreVisitorCard,
  isVisitorCardNumberTaken,
  normalizeVisitorCardNumber,
  normalizeVisitTypeName,
  isSelfAdminDemotionAttempt,
  isSelfDeactivationAttempt,
  provisionEmployeeFacilityScope,
  requiresCompanyScope,
  roleRequiresEmployeeProfile,
  wouldRemoveLastActiveAdmin,
  type AdminUser,
} from "@/domain/admin"

const scope = (companyIds: string[]) => ({ companyIds, facilityIds: [], securityGateIds: [] })

const users: AdminUser[] = [
  { id: "admin-1", fullName: "Admin Bir", username: "admin.bir", email: "admin.bir@bplas.com", authenticationSource: "ACTIVE_DIRECTORY", role: "ADMIN", authorizationScope: scope(["a"]), active: true },
  { id: "admin-2", fullName: "Admin İki", username: "admin.iki", email: "admin.iki@bplas.com", authenticationSource: "LOCAL", role: "ADMIN", authorizationScope: scope(["a"]), active: true },
  { id: "employee-1", fullName: "Çalışan Bir", username: "calisan.bir", email: "calisan.bir@bplas.com", authenticationSource: "LOCAL", role: "EMPLOYEE", authorizationScope: scope(["b"]), active: true },
]

describe("Company scope requirement", () => {
  it("requires at least one company for every current role and exactly one facility for operational roles", () => {
    for (const role of ["EMPLOYEE", "MANAGER", "SECURITY", "ADMIN"] as const) {
      expect(requiresCompanyScope(role)).toBe(true)
      expect(isAuthorizationScopeValid(role, scope([]))).toBe(false)
      expect(isAuthorizationScopeValid(role, scope(["a"]))).toBe(role === "ADMIN")
      expect(isAuthorizationScopeValid(role, { ...scope(["a"]), facilityIds: ["facility-a"] })).toBe(true)
    }
  })

  it("automatically binds operational roles to the sole facility without adding a separate form field", () => {
    const facilities = [{ id: "facility-a", parentId: "a" }, { id: "facility-b", parentId: "b" }]
    const assigned = provisionEmployeeFacilityScope("SECURITY", scope(["a"]), facilities)
    expect(assigned.facilityIds).toEqual(["facility-a"])
    expect(roleRequiresEmployeeProfile("SECURITY")).toBe(true)
    expect(provisionEmployeeFacilityScope("ADMIN", scope(["a"]), facilities).facilityIds).toEqual([])
  })

  it("preserves one existing operational facility when the authorization scope spans companies", () => {
    const facilities = [{ id: "facility-a", parentId: "a" }, { id: "facility-b", parentId: "b" }]
    const assigned = provisionEmployeeFacilityScope("MANAGER", { ...scope(["a", "b"]), facilityIds: ["facility-b"] }, facilities)
    expect(assigned.facilityIds).toEqual(["facility-b"])
  })
})

describe("Username/email uniqueness", () => {
  it("is case-insensitive", () => {
    expect(isAdminUsernameTaken(users, null, "Admin.Bir")).toBe(true)
    expect(isAdminUsernameTaken(users, null, "ADMIN.BIR")).toBe(true)
    expect(isAdminEmailTaken(users, null, "Admin.Bir@BPLAS.com")).toBe(true)
  })

  it("does not flag a user's own current value as a conflict during edit", () => {
    expect(isAdminUsernameTaken(users, "admin-1", "admin.bir")).toBe(false)
    expect(isAdminEmailTaken(users, "admin-1", "admin.bir@bplas.com")).toBe(false)
  })

  it("still flags a conflict with a different user's value during edit", () => {
    expect(isAdminUsernameTaken(users, "admin-1", "admin.iki")).toBe(true)
    expect(isAdminEmailTaken(users, "admin-1", "admin.iki@bplas.com")).toBe(true)
  })

  it("allows a genuinely new username/email", () => {
    expect(isAdminUsernameTaken(users, null, "yeni.kullanici")).toBe(false)
    expect(isAdminEmailTaken(users, null, "yeni.kullanici@bplas.com")).toBe(false)
  })
})

describe("Visit type uniqueness", () => {
  const visitTypes = [{ id: "type-1", name: "Toplantı", active: true }]

  it("normalizes Turkish natural-language text for duplicate comparison", () => {
    expect(normalizeVisitTypeName(" Toplantı ")).toBe("toplantı")
    expect(isVisitTypeNameTaken(visitTypes, null, "Toplantı")).toBe(true)
    expect(isVisitTypeNameTaken(visitTypes, null, "TOPLANTI")).toBe(true)
    expect(isVisitTypeNameTaken(visitTypes, null, " toplantı ")).toBe(true)
  })

  it("does not treat an edited record as its own duplicate", () => {
    expect(isVisitTypeNameTaken(visitTypes, "type-1", "Toplantı")).toBe(false)
  })
})

describe("isTimeBoundVisitType", () => {
  it("identifies time-bound visit types correctly", () => {
    expect(isTimeBoundVisitType("Toplantı")).toBe(true)
    expect(isTimeBoundVisitType("İş Görüşmesi")).toBe(true)
    expect(isTimeBoundVisitType("Eğitim")).toBe(true)
    expect(isTimeBoundVisitType("Müşteri Ziyareti")).toBe(true)
    expect(isTimeBoundVisitType("  toplantı  ")).toBe(true)
    expect(isTimeBoundVisitType("İŞ GÖRÜŞMESİ")).toBe(true)
  })

  it("identifies non-time-bound types and defaults unknowns to false", () => {
    expect(isTimeBoundVisitType("Tedarikçi")).toBe(false)
    expect(isTimeBoundVisitType("Teknik Servis / Bakım")).toBe(false)
    expect(isTimeBoundVisitType("Denetim")).toBe(false)
    expect(isTimeBoundVisitType("Bilinmeyen")).toBe(false)
    expect(isTimeBoundVisitType("")).toBe(false)
    expect(isTimeBoundVisitType(undefined)).toBe(false)
    expect(isTimeBoundVisitType(null)).toBe(false)
  })
})

describe("Visitor card number uniqueness", () => {
  const cards = [{ id: "card-1", cardNumber: "001", status: "AVAILABLE" as const }, { id: "card-2", cardNumber: "ABC-01", status: "DISABLED" as const }]

  it("trims and compares identifiers case-insensitively without changing leading-zero meaning", () => {
    expect(normalizeVisitorCardNumber(" 001 ")).toBe("001")
    expect(isVisitorCardNumberTaken(cards, null, " 001 ")).toBe(true)
    expect(isVisitorCardNumberTaken(cards, null, "abc-01")).toBe(true)
    expect(isVisitorCardNumberTaken(cards, null, "01")).toBe(false)
  })

  it("does not treat the card being edited as its own duplicate", () => {
    expect(isVisitorCardNumberTaken(cards, "card-1", "001")).toBe(false)
  })
})

describe("Visitor card write-off transitions", () => {
  const statuses = ["AVAILABLE", "IN_USE", "NOT_RETURNED", "LOST", "DISABLED"] as const

  it("allows marking only NOT_RETURNED cards as lost", () => {
    expect(statuses.filter((status) => canMarkVisitorCardLost({ status }))).toEqual(["NOT_RETURNED"])
  })

  it("allows restoring only LOST cards to inventory", () => {
    expect(statuses.filter((status) => canRestoreVisitorCard({ status }))).toEqual(["LOST"])
  })
})

describe("Self-lockout guards", () => {
  it("flags deactivating your own currently-active account", () => {
    expect(isSelfDeactivationAttempt("admin-1", users[0], false)).toBe(true)
    expect(isSelfDeactivationAttempt("admin-1", users[0], true)).toBe(false)
    expect(isSelfDeactivationAttempt("admin-2", users[0], false)).toBe(false)
    expect(isSelfDeactivationAttempt(null, users[0], false)).toBe(false)
  })

  it("flags demoting your own Admin role away", () => {
    expect(isSelfAdminDemotionAttempt("admin-1", users[0], "EMPLOYEE")).toBe(true)
    expect(isSelfAdminDemotionAttempt("admin-1", users[0], "ADMIN")).toBe(false)
    expect(isSelfAdminDemotionAttempt("admin-2", users[0], "EMPLOYEE")).toBe(false)
    expect(isSelfAdminDemotionAttempt("employee-1", users[2], "MANAGER")).toBe(false)
  })
})

describe("Last active Admin guard", () => {
  it("blocks demoting or deactivating the only remaining active Admin", () => {
    const onlyAdmin: AdminUser[] = [users[0], users[2]]
    expect(wouldRemoveLastActiveAdmin(onlyAdmin, users[0], "EMPLOYEE", true)).toBe(true)
    expect(wouldRemoveLastActiveAdmin(onlyAdmin, users[0], "ADMIN", false)).toBe(true)
  })

  it("allows the change when another active Admin remains", () => {
    expect(wouldRemoveLastActiveAdmin(users, users[0], "EMPLOYEE", true)).toBe(false)
    expect(wouldRemoveLastActiveAdmin(users, users[0], "ADMIN", false)).toBe(false)
  })

  it("does not block edits to a non-Admin, or edits that keep the user an active Admin", () => {
    expect(wouldRemoveLastActiveAdmin(users, users[2], "MANAGER", false)).toBe(false)
    expect(wouldRemoveLastActiveAdmin(users, users[0], "ADMIN", true)).toBe(false)
  })
})
