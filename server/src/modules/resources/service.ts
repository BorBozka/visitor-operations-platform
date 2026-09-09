import { ApiError } from "../../lib/api-error.js"
import { matchesScopeFilter, resolveScopeFilter, scopeAllows, type AccessContext } from "../../lib/authorization.js"
import type { ResourceRepository } from "../../repositories/resource-repository.js"
import { normalizeLicensePlate, type ResourceInput } from "./types.js"

function normalizeList(values: string[]) { return [...new Set(values.map((value) => value.trim()).filter(Boolean))] }

export class ResourceService {
  constructor(private readonly repository: ResourceRepository) {}

  async list(filters: { includeInactive: boolean; companyId?: string; facilityId?: string; type?: string }, ctx?: AccessContext) {
    const resources = await this.repository.list(filters)
    if (!ctx) return resources
    const scope = resolveScopeFilter(ctx, {})
    return resources.filter((resource) => matchesScopeFilter(scope, resource))
  }

  async get(id: string, ctx?: AccessContext) {
    const resource = await this.repository.find(id)
    if (!resource) throw new ApiError(404, "NOT_FOUND", "Kaynak bulunamadı.")
    if (ctx && !scopeAllows(ctx, { companyId: resource.companyId, facilityId: resource.facilityId })) {
      throw new ApiError(404, "NOT_FOUND", "Kaynak bulunamadı.")
    }
    return resource
  }

  async create(input: ResourceInput, ctx?: AccessContext) {
    if (ctx && !scopeAllows(ctx, { companyId: input.companyId, facilityId: input.facilityId })) {
      throw new ApiError(403, "OUT_OF_SCOPE", "Bu şirket/tesis yetki kapsamınız dışında.")
    }
    const validated = await this.validateInput(input)
    return this.repository.save(validated)
  }

  async update(id: string, input: ResourceInput, ctx?: AccessContext) {
    const current = await this.get(id, ctx)
    if (ctx && !scopeAllows(ctx, { companyId: input.companyId, facilityId: input.facilityId })) {
      throw new ApiError(403, "OUT_OF_SCOPE", "Bu şirket/tesis yetki kapsamınız dışında.")
    }
    if (current.type !== input.type) throw new ApiError(409, "RESOURCE_TYPE_IMMUTABLE", "Kaynak türü düzenleme sırasında değiştirilemez.")
    const validated = await this.validateInput(input, id)
    return this.repository.save(validated, id, current.isActive)
  }

  async setActive(id: string, active: boolean, ctx?: AccessContext) { await this.get(id, ctx); return this.repository.setActive(id, active) }

  /**
   * Hard delete. Its `DriverLicenseClass` / `DriverDocument` sub-rows go with it, and historical
   * assignments stay — they keep their own name/type/quantity snapshot and only lose the live
   * catalog reference. Assignment *history* therefore never blocks a delete; a resource still held
   * by an open Meeting or an ACTIVE transport assignment does, and must be deactivated instead.
   */
  async remove(id: string, ctx?: AccessContext) {
    await this.get(id, ctx)
    const deleted = await this.repository.delete(id)
    if (!deleted) throw new ApiError(409, "RESOURCE_IN_USE", "Bu kaynak aktif veya planlanmış bir operasyonda kullanıldığı için silinemez; pasife alın.")
  }

  private async validateInput(input: ResourceInput, excludeId?: string): Promise<ResourceInput> {
    if (!await this.repository.companyAndFacilityExist(input.companyId, input.facilityId)) throw new ApiError(400, "INVALID_SCOPE", "Şirket ve tesis eşleşmesi geçersiz.")
    switch (input.type) {
      case "ROOM": { const name = input.name.trim(); if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Kaynak adı zorunludur."); return { ...input, name } }
      case "POOLED_EQUIPMENT": { const name = input.name.trim(); if (!name || !Number.isInteger(input.totalQuantity) || input.totalQuantity <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Kaynak adı ve pozitif ekipman miktarı zorunludur."); return { ...input, name } }
      case "VEHICLE": { const brand = input.brand.trim(); const model = input.model.trim(); const licensePlate = normalizeLicensePlate(input.licensePlate); if (!brand || !model || !licensePlate) throw new ApiError(400, "VALIDATION_ERROR", "Araç markası, modeli ve plakası zorunludur."); if (await this.repository.findVehicleByCompanyAndPlate(input.companyId, licensePlate, excludeId)) throw new ApiError(409, "DUPLICATE_LICENSE_PLATE", "Bu şirket için aynı plakaya sahip bir araç zaten kayıtlı."); return { ...input, brand, model, licensePlate } }
      case "DRIVER": { const fullName = input.fullName.trim(); const licenseClasses = normalizeList(input.licenseClasses); const documents = normalizeList(input.documents); if (!fullName || licenseClasses.length === 0 || typeof input.canDriveCommercialVehicles !== "boolean") throw new ApiError(400, "VALIDATION_ERROR", "Şoför adı, en az bir ehliyet sınıfı ve ticari araç bilgisi zorunludur."); return { ...input, fullName, licenseClasses, documents } }
    }
  }
}
