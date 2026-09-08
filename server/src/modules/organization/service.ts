import { ApiError } from "../../lib/api-error.js"
import { resolveScopeFilter, type AccessContext } from "../../lib/authorization.js"
import type { OrganizationRepository } from "../../repositories/organization-repository.js"
import { normalizeOrganizationName, type OrganizationEntity, type OrganizationKind, type OrganizationSnapshot, type SaveOrganizationInput } from "./types.js"

const parentKind: Record<Exclude<OrganizationKind, "COMPANY">, OrganizationKind> = { FACILITY: "COMPANY", DEPARTMENT: "COMPANY", SECURITY_GATE: "FACILITY" }

/**
 * Organization directory reads and writes, all bounded by the caller's assigned scope
 * (`AccessContext`), which routes derive from the session — never from a client-supplied filter.
 *
 * Every read is filtered in the query itself, so a record outside the caller's scope is never
 * loaded; a single-entity read of one is reported as the same 404 an absent record gets, so the
 * response cannot be used to probe for records in another company. Writes reach an existing
 * record only through that same scoped read, and a new child only through a scoped parent lookup
 * — a scoped Admin therefore cannot create, rename or deactivate another company's records.
 *
 * Creating a *root* Company is refused outright (403): a brand-new company is by definition
 * outside every existing scope, so no scoped Admin may create one — and every Admin is scoped,
 * since an assigned scope needs at least one company. Editing an existing in-scope Company, and
 * creating a Facility / Department / Security Gate under an in-scope parent, are unaffected.
 * Onboarding a new company is therefore an out-of-band provisioning step, not a self-service one.
 */
export class OrganizationService {
  constructor(private readonly repository: OrganizationRepository) {}

  async getSnapshot(includeInactive = false, ctx: AccessContext): Promise<OrganizationSnapshot> {
    const [companies, facilities, departments, securityGates] = await Promise.all([
      this.repository.list("COMPANY", includeInactive, ctx.scope), this.repository.list("FACILITY", includeInactive, ctx.scope), this.repository.list("DEPARTMENT", includeInactive, ctx.scope), this.repository.list("SECURITY_GATE", includeInactive, ctx.scope),
    ])
    return { companies, facilities, departments, securityGates }
  }

  list(kind: OrganizationKind, includeInactive = false, ctx: AccessContext) { return this.repository.list(kind, includeInactive, ctx.scope) }
  async get(kind: OrganizationKind, id: string, ctx: AccessContext) { return this.requireEntity(kind, id, ctx) }

  /** `companyId`/`facilityId` narrow *within* the caller's scope; they can never widen past it. */
  listEmployees(filters: { companyId?: string; facilityId?: string; includeInactive: boolean }, ctx: AccessContext) {
    const resolved = resolveScopeFilter(ctx, filters)
    return this.repository.listEmployees({ ...resolved, includeInactive: filters.includeInactive })
  }

  async getEmployee(id: string, ctx: AccessContext) {
    const employee = await this.repository.findEmployee(id, ctx.scope)
    if (!employee) throw new ApiError(404, "NOT_FOUND", "Çalışan bulunamadı.")
    return employee
  }

  async save(kind: OrganizationKind, input: SaveOrganizationInput, ctx: AccessContext): Promise<OrganizationEntity> {
    const name = input.name.trim()
    if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Organizasyon adı zorunludur.")
    const existing = input.id ? await this.requireEntity(kind, input.id, ctx) : null
    const parentId = await this.validateParent(kind, input.parentId, input.active, existing, ctx)
    if (existing && existing.active && !input.active && await this.repository.hasActiveChildren(kind, existing.id)) {
      throw new ApiError(409, "ACTIVE_CHILDREN", "Aktif alt kayıtları bulunan organizasyon kaydı pasife alınamaz.")
    }
    const nameNormalized = normalizeOrganizationName(name)
    const sibling = await this.repository.findSibling(kind, parentId, nameNormalized)
    if (sibling && sibling.id !== existing?.id) {
      throw new ApiError(409, "DUPLICATE_NAME", "Bu kapsamda aynı ada sahip bir organizasyon kaydı zaten var.")
    }
    return this.repository.save(kind, { ...input, ...(parentId ? { parentId } : {}), name, nameNormalized })
  }

  private async validateParent(kind: OrganizationKind, parentId: string | undefined, active: boolean, existing: OrganizationEntity | null, ctx: AccessContext): Promise<string | undefined> {
    if (kind === "COMPANY") {
      if (parentId) throw new ApiError(400, "VALIDATION_ERROR", "Şirket kaydının üst organizasyonu olamaz.")
      // A root Company sits above every scope, so creating one would place a record outside the
      // acting Admin's authority boundary. `existing` is only ever set by the scoped read above,
      // so no client-supplied id can turn a creation into an "edit" of a record they cannot see.
      if (!existing) throw new ApiError(403, "OUT_OF_SCOPE", "Yeni şirket kaydı oluşturmak yetki kapsamınızın dışındadır.")
      return undefined
    }
    if (!parentId) throw new ApiError(400, "VALIDATION_ERROR", "Üst organizasyon seçilmelidir.")
    if (existing && parentId !== existing.parentId) throw new ApiError(409, "PARENT_IMMUTABLE", "Mevcut organizasyon kaydının üst ilişkisi değiştirilemez.")
    // A parent outside the caller's scope reads as absent — the same 404 an unknown id gets.
    const parent = await this.repository.find(parentKind[kind], parentId, ctx.scope)
    if (!parent) throw new ApiError(404, "PARENT_NOT_FOUND", "Üst organizasyon kaydı bulunamadı.")
    if (active && !parent.active) throw new ApiError(409, "INACTIVE_PARENT", "Pasif üst organizasyon altında aktif kayıt bulunamaz.")
    return parentId
  }

  private async requireEntity(kind: OrganizationKind, id: string, ctx: AccessContext) {
    const entity = await this.repository.find(kind, id, ctx.scope)
    if (!entity) throw new ApiError(404, "NOT_FOUND", "Organizasyon kaydı bulunamadı.")
    return entity
  }
}
