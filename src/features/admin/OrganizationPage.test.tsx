import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { OrganizationSnapshot } from "@/domain/organization"
import { OrganizationHierarchy, OrganizationWorkspace } from "@/features/admin/OrganizationPage"
import {
  companyNodeKey,
  departmentsGroupKey,
  facilitiesGroupKey,
  facilityNodeKey,
  getDefaultOrganizationNavigation,
  getOrganizationNodeParam,
  getOrganizationSelectionFromNodeParam,
  getOrganizationTreeKeyboardAction,
  restoreOrganizationExpandedKeys,
  getVisibleOrganizationTreeItems,
  type OrganizationSelection,
} from "@/features/admin/organization-tree"
import {
  buildOrganizationSaveInput,
  getInitialOrganizationDraft,
  getOrganizationContextLabel,
  getOrganizationNameError,
  isOrganizationDraftDirty,
  type OrganizationWorkspaceMode,
} from "@/features/admin/organization-workspace"
const organization: OrganizationSnapshot = {
  companies: [
    { id: "bplas", name: "BPLAS A.Ş.", active: true },
    { id: "bplas-otomotiv", name: "BPLAS Otomotiv A.Ş.", active: true },
    { id: "anadolu-lojistik", name: "Anadolu Lojistik A.Ş.", active: true },
  ],
  facilities: [
    { id: "bplas-merkez", parentId: "bplas", name: "Merkez Tesis", active: true },
    { id: "bplas-arge", parentId: "bplas", name: "Ar-Ge Merkezi", active: true },
    { id: "otomotiv-uretim", parentId: "bplas-otomotiv", name: "Üretim Tesisi", active: true },
  ],
  departments: [
    { id: "department-bplas-satin-alma", parentId: "bplas", name: "Satın Alma", active: true },
  ],
  securityGates: [
    { id: "gate-bplas-merkez-ana-giris", parentId: "bplas-merkez", name: "Ana Giriş", active: true },
    { id: "gate-bplas-merkez-lojistik", parentId: "bplas-merkez", name: "Lojistik Kapısı", active: true },
    { id: "gate-bplas-arge-eski-giris", parentId: "bplas-arge", name: "Eski Giriş", active: false },
  ],
}
const noop = () => undefined
const saveNoop = async () => undefined
const pageSource = readFileSync(resolve(process.cwd(), "src/features/admin/OrganizationPage.tsx"), "utf8")
const contextSource = readFileSync(resolve(process.cwd(), "src/features/admin/admin-context.tsx"), "utf8")

function hierarchyMarkup(expandedKeys = getDefaultOrganizationNavigation(organization).expandedKeys) {
  return renderToStaticMarkup(
    <OrganizationHierarchy
      organization={organization}
      selection={{ kind: "COMPANY", id: "bplas" }}
      expandedKeys={expandedKeys}
      focusKey={companyNodeKey("bplas")}
      onExpandedKeysChange={noop}
      onFocusKeyChange={noop}
      onSelect={noop}
      onCreateCompany={noop}
    />,
  )
}

function workspaceMarkup(kind: OrganizationSelection["kind"], id: string, mode: OrganizationWorkspaceMode = { type: "view" }) {
  return renderToStaticMarkup(
    <OrganizationWorkspace
      organization={organization}
      selection={{ kind, id }}
      mode={mode}
      onSelect={noop}
      onEdit={noop}
      onCreate={noop}
      onDirtyChange={noop}
      onSave={saveNoop}
      onCancel={noop}
    />,
  )
}

describe("Organization hierarchy projection", () => {
  it("renders every canonical Company at tree root level", () => {
    const roots = getVisibleOrganizationTreeItems(organization, new Set()).filter((item) => item.parentKey === null)
    expect(roots.map((item) => item.label)).toEqual(["BPLAS A.Ş.", "BPLAS Otomotiv A.Ş.", "Anadolu Lojistik A.Ş."])
  })

  it("places each Facility and Department only below its own Company grouping node", () => {
    const expanded = new Set([companyNodeKey("bplas"), facilitiesGroupKey("bplas"), departmentsGroupKey("bplas")])
    const items = getVisibleOrganizationTreeItems(organization, expanded)
    expect(items.find((item) => item.label === "Merkez Tesis")?.parentKey).toBe(facilitiesGroupKey("bplas"))
    expect(items.find((item) => item.label === "Satın Alma")?.parentKey).toBe(departmentsGroupKey("bplas"))
    expect(items.some((item) => item.label === "Üretim Tesisi")).toBe(false)
  })

  it("places SecurityGate records only below their Facility", () => {
    const expanded = new Set([companyNodeKey("bplas"), facilitiesGroupKey("bplas"), facilityNodeKey("bplas-merkez")])
    const gates = getVisibleOrganizationTreeItems(organization, expanded).filter((item) => item.entityKind === "SECURITY_GATE")
    expect(gates.map((item) => [item.label, item.parentKey])).toEqual([
      ["Ana Giriş", facilityNodeKey("bplas-merkez")],
      ["Lojistik Kapısı", facilityNodeKey("bplas-merkez")],
    ])
  })

  it("keeps grouping nodes navigational and never models them as selected domain entities", () => {
    const groups = getVisibleOrganizationTreeItems(organization, getDefaultOrganizationNavigation(organization).expandedKeys).filter((item) => item.nodeType === "GROUP")
    expect(groups.every((item) => item.entity === undefined && item.entityKind === undefined)).toBe(true)
  })

  it("keeps passive entities visible and selectable", () => {
    const markup = hierarchyMarkup(new Set([companyNodeKey("bplas"), facilitiesGroupKey("bplas"), facilityNodeKey("bplas-arge")]))
    expect(markup).toContain("Eski Giriş")
    expect(markup).toContain("Pasif")
    expect(markup).not.toMatch(/organization-tree-security-gate-gate-bplas-arge-eski-giris[^>]*disabled/)
  })

  it("preserves tree semantics and keyboard navigation", () => {
    const markup = hierarchyMarkup()
    const expanded = getDefaultOrganizationNavigation(organization).expandedKeys
    const items = getVisibleOrganizationTreeItems(organization, expanded)
    expect(markup).toContain('role="tree"')
    expect(markup).toContain('role="treeitem"')
    expect(getOrganizationTreeKeyboardAction("ArrowDown", companyNodeKey("bplas"), items, expanded)).toEqual({ type: "FOCUS", key: facilitiesGroupKey("bplas") })
    expect(getOrganizationTreeKeyboardAction("Enter", companyNodeKey("bplas"), items, expanded)).toEqual({ type: "ACTIVATE" })
  })

  it("shows the contextual + Şirket action and a compact scrollbar", () => {
    const markup = hierarchyMarkup()
    expect(markup).toContain("+ Şirket")
    expect(markup).toContain("scrollbar-thin")
  })

  it("keeps newly selected nodes visible", () => {
    expect(pageSource).toContain('scrollIntoView({ block: "nearest" })')
  })
})

describe("Organization navigation persistence", () => {
  it("serializes every selectable entity type using canonical IDs", () => {
    expect(getOrganizationNodeParam({ kind: "COMPANY", id: "bplas" })).toBe("company:bplas")
    expect(getOrganizationNodeParam({ kind: "FACILITY", id: "bplas-merkez" })).toBe("facility:bplas-merkez")
    expect(getOrganizationNodeParam({ kind: "DEPARTMENT", id: "department-bplas-satin-alma" })).toBe("department:department-bplas-satin-alma")
    expect(getOrganizationNodeParam({ kind: "SECURITY_GATE", id: "gate-bplas-merkez-ana-giris" })).toBe("gate:gate-bplas-merkez-ana-giris")
  })

  it("parses valid URL selections and safely rejects grouping or malformed values", () => {
    expect(getOrganizationSelectionFromNodeParam("company:bplas")).toEqual({ kind: "COMPANY", id: "bplas" })
    expect(getOrganizationSelectionFromNodeParam("facility:bplas-merkez")).toEqual({ kind: "FACILITY", id: "bplas-merkez" })
    expect(getOrganizationSelectionFromNodeParam("department:department-bplas-satin-alma")).toEqual({ kind: "DEPARTMENT", id: "department-bplas-satin-alma" })
    expect(getOrganizationSelectionFromNodeParam("gate:gate-bplas-merkez-ana-giris")).toEqual({ kind: "SECURITY_GATE", id: "gate-bplas-merkez-ana-giris" })
    expect(getOrganizationSelectionFromNodeParam("group:bplas:facilities")).toBeNull()
    expect(getOrganizationSelectionFromNodeParam("facility:")).toBeNull()
    expect(getOrganizationSelectionFromNodeParam("unknown:record")).toBeNull()
  })

  it("restores only existing expansion keys and always exposes selected ancestors", () => {
    const selectedGate = { kind: "SECURITY_GATE", id: "gate-bplas-merkez-ana-giris" } satisfies OrganizationSelection
    const restored = restoreOrganizationExpandedKeys(organization, [companyNodeKey("missing"), facilityNodeKey("missing"), companyNodeKey("bplas")], selectedGate)
    expect(restored).toEqual(new Set([companyNodeKey("bplas"), facilitiesGroupKey("bplas"), facilityNodeKey("bplas-merkez")]))
  })

  it("keeps URL selection, expansion storage, and form mode responsibilities separate", () => {
    expect(pageSource).toContain('useSearchParams')
    expect(pageSource).toContain('"admin-organization-expanded-nodes"')
    expect(pageSource).toContain("restoreOrganizationExpandedKeys")
    expect(pageSource).toContain("setWorkspaceMode(viewOrganizationWorkspace())")
    expect(pageSource).not.toContain("organization-workspace-mode")
    expect(pageSource).not.toContain("organization-form-draft")
  })

  it("does not let an internal tree selection be overwritten by the preceding URL render", () => {
    expect(pageSource).toContain("pendingSelectionRef")
    expect(pageSource).toContain("!sameSelection(requestedSelection, pendingSelectionRef.current)")
    expect(pageSource).toContain("applySelectionToUrl(next)")
  })
})

describe("Organization contextual actions and headers", () => {
  it("shows Company Düzenle, Tesis ekle, and Departman ekle actions", () => {
    const markup = workspaceMarkup("COMPANY", "bplas")
    expect(markup).toContain("Düzenle")
    expect(markup).toContain("Tesis ekle")
    expect(markup).toContain("Departman ekle")
  })

  it("shows Facility Düzenle and Güvenlik kapısı ekle actions", () => {
    const markup = workspaceMarkup("FACILITY", "bplas-merkez")
    expect(markup).toContain("Düzenle")
    expect(markup).toContain("Güvenlik kapısı ekle")
    expect(markup).not.toContain("Departman ekle")
  })

  it("shows only Düzenle for a Department", () => {
    const markup = workspaceMarkup("DEPARTMENT", "department-bplas-satin-alma")
    expect(markup).toContain("Düzenle")
    expect(markup).not.toContain("Tesis ekle")
    expect(markup).not.toContain("Güvenlik kapısı ekle")
  })

  it("shows only Düzenle for a SecurityGate", () => {
    const markup = workspaceMarkup("SECURITY_GATE", "gate-bplas-merkez-ana-giris")
    expect(markup).toContain("Düzenle")
    expect(markup).not.toContain("Tesis ekle")
    expect(markup).not.toContain("Departman ekle")
  })

  it("does not expose a generic Ekle action", () => {
    expect(pageSource).not.toContain("+ Ekle")
    expect(pageSource).not.toMatch(/>Ekle</)
  })

  it("uses the standardized entity context formats", () => {
    expect(getOrganizationContextLabel(organization, { kind: "COMPANY", id: "bplas" })).toBe("ŞİRKET")
    expect(getOrganizationContextLabel(organization, { kind: "FACILITY", id: "bplas-merkez" })).toBe("TESİS · BPLAS A.Ş.")
    expect(getOrganizationContextLabel(organization, { kind: "DEPARTMENT", id: "department-bplas-satin-alma" })).toBe("DEPARTMAN · BPLAS A.Ş.")
    expect(getOrganizationContextLabel(organization, { kind: "SECURITY_GATE", id: "gate-bplas-merkez-ana-giris" })).toBe("GÜVENLİK KAPISI · BPLAS A.Ş. / Merkez Tesis")
  })

  it("does not duplicate status in Facility, Department, or Gate metadata", () => {
    for (const markup of [
      workspaceMarkup("FACILITY", "bplas-merkez"),
      workspaceMarkup("DEPARTMENT", "department-bplas-satin-alma"),
      workspaceMarkup("SECURITY_GATE", "gate-bplas-merkez-ana-giris"),
    ]) expect(markup).not.toContain(">Durum<")
  })

  it("keeps child rows clickable, fixed-height, and status-bearing in view mode", () => {
    const markup = workspaceMarkup("COMPANY", "bplas")
    expect(markup).toContain("h-10")
    expect(markup).toContain("Aktif")
    expect(markup).toContain("<button")
  })
})

describe("Organization inline create and edit forms", () => {
  const companyEdit = { type: "edit", selection: { kind: "COMPANY", id: "bplas" } } satisfies OrganizationWorkspaceMode
  const facilityEdit = { type: "edit", selection: { kind: "FACILITY", id: "bplas-merkez" } } satisfies OrganizationWorkspaceMode
  const facilityCreate = { type: "create", kind: "FACILITY", parentId: "bplas", returnSelection: { kind: "COMPANY", id: "bplas" } } satisfies OrganizationWorkspaceMode

  it("opens edit mode inline without a modal", () => {
    const markup = workspaceMarkup("COMPANY", "bplas", companyEdit)
    expect(markup).toContain("Şirket düzenleme formu")
    expect(markup).toContain("Kaydet")
    expect(pageSource).not.toContain('from "@/components/ui/dialog"')
  })

  it("opens create mode inline and replaces view child lists", () => {
    const markup = workspaceMarkup("COMPANY", "bplas", facilityCreate)
    expect(markup).toContain("Tesis oluşturma formu")
    expect(markup).toContain("Yeni tesis")
    expect(markup).not.toContain("Departman ekle")
  })

  it("renders existing parent context as static, non-editable presentation", () => {
    const markup = workspaceMarkup("FACILITY", "bplas-merkez", facilityEdit)
    expect(markup).toContain("Bağlı şirket")
    expect(markup).toContain('aria-labelledby="organization-parent-company"')
    expect(markup).toContain("bg-slate-50")
    expect(markup).not.toContain("<select")
    expect(markup).not.toContain('id="organization-parent-company" value=')
  })

  it("builds contextual create input with the correct parentId", () => {
    expect(buildOrganizationSaveInput(facilityCreate, { name: "Yeni Tesis", active: true }, null)).toEqual({ name: "Yeni Tesis", active: true, parentId: "bplas" })
  })

  it("preserves the existing parentId in edit input", () => {
    const entity = organization.facilities.find((item) => item.id === "bplas-merkez")!
    expect(buildOrganizationSaveInput(facilityEdit, { name: entity.name, active: false }, entity)).toEqual({ id: entity.id, name: entity.name, active: false, parentId: "bplas" })
  })

  it("disables pristine edit Save", () => {
    const markup = workspaceMarkup("COMPANY", "bplas", companyEdit)
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/)
  })

  it("enables dirty edit and disables again after a revert", () => {
    const initial = getInitialOrganizationDraft(companyEdit, organization.companies[0])
    expect(isOrganizationDraftDirty(initial, initial)).toBe(false)
    expect(isOrganizationDraftDirty({ ...initial, name: "BPLAS" }, initial)).toBe(true)
    expect(isOrganizationDraftDirty({ ...initial, name: initial.name }, initial)).toBe(false)
  })

  it("rejects empty and whitespace-only names without showing errors on pristine render", () => {
    expect(getOrganizationNameError("")).toBe("Ad alanı boş bırakılamaz.")
    expect(getOrganizationNameError("   ")).toBe("Ad alanı boş bırakılamaz.")
    const markup = workspaceMarkup("COMPANY", "bplas", facilityCreate)
    expect(markup).not.toContain("Ad alanı boş bırakılamaz.")
  })

  it("shows service errors inline through an alert region", () => {
    expect(pageSource).toContain('role="alert"')
    expect(pageSource).toContain("error instanceof Error ? error.message")
  })

  it("routes successful saves through the service-backed Admin context and returns to view", () => {
    expect(contextSource).toContain("service.saveOrganizationEntity(kind, entity)")
    expect(contextSource).toContain("loader.commitIfCurrent(() => service.getOrganization()")
    expect(pageSource).toContain("setWorkspaceMode(viewOrganizationWorkspace())")
  })

  it("selects the saved entity and expands its ancestors after create", () => {
    expect(pageSource).toContain("const nextSelection = { kind, id: saved.id }")
    expect(pageSource).toContain("getExpansionKeysForNewEntity(organization, kind, saved.parentId)")
  })

  it("returns create cancel to its parent context and edit cancel to the same entity", () => {
    expect(pageSource).toContain("workspaceMode.returnSelection")
    expect(pageSource).toContain("applySelection(workspaceMode.returnSelection)")
  })

  it("uses the accessible design-system Switch and submits its active state", () => {
    const markup = workspaceMarkup("COMPANY", "bplas", companyEdit)
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-label="Aktif"')
    expect(buildOrganizationSaveInput(companyEdit, { name: "BPLAS A.Ş.", active: false }, organization.companies[0]).active).toBe(false)
  })
})

describe("Organization dirty navigation and phase boundary", () => {
  it("asks for confirmation only when an inline form is dirty", () => {
    expect(pageSource).toContain('workspaceMode.type === "view" || !formDirty')
    expect(pageSource).toContain('window.confirm("Kaydedilmemiş değişiklikler silinecek. Devam etmek istiyor musunuz?")')
  })

  it("keeps the form and selection when confirmation is cancelled", () => {
    expect(pageSource).toContain("if (!confirmDiscard()) return")
  })

  it("discards the draft and changes selection when confirmation is accepted", () => {
    expect(pageSource).toContain("setWorkspaceMode(viewOrganizationWorkspace())")
    expect(pageSource).toContain("applySelection(next)")
  })

  it("does not bypass the canonical hierarchy service guards", () => {
    expect(pageSource).not.toContain("MockOrganizationStore")
    expect(pageSource).not.toContain("organization.companies.push")
    expect(contextSource).toContain("service.saveOrganizationEntity")
  })

  it("does not introduce delete, Dialog, search, or filtering", () => {
    expect(pageSource).not.toContain("Sil")
    expect(pageSource).not.toContain("Dialog")
    expect(pageSource).not.toContain("searchTerm")
  })
})
