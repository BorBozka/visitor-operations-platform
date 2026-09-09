import type { Prisma, PrismaClient } from "@prisma/client"
import { ApiError } from "../lib/api-error.js"
import { withWriteConflictRetry } from "../lib/prisma-conflict.js"
import { parseResourceType, type FacilityResource, type ResourceInput } from "../modules/resources/types.js"
import type { ResourceRepository } from "./resource-repository.js"

const TERMINAL_VISIT_STATUSES = ["CHECKED_OUT", "CANCELLED", "NO_SHOW"]
const VEHICLE_PLATE_UNIQUE_INDEX = "Resource_companyId_licensePlate_key"

function isDuplicateLicensePlateError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || (error as { code: unknown }).code !== "P2002") return false
  const candidate = error as { message?: unknown; meta?: { target?: unknown } }
  const target = candidate.meta?.target
  const targetText = Array.isArray(target) ? target.map(String).join(",") : String(target ?? "")
  const message = String(candidate.message ?? "")
  return targetText.includes(VEHICLE_PLATE_UNIQUE_INDEX)
    || (targetText.includes("companyId") && targetText.includes("licensePlate"))
    || message.includes(VEHICLE_PLATE_UNIQUE_INDEX)
}

function duplicateLicensePlate(): ApiError {
  return new ApiError(409, "DUPLICATE_LICENSE_PLATE", "Bu şirket için aynı plakaya sahip bir araç zaten kayıtlı.")
}

function resourceInUse(): ApiError {
  return new ApiError(409, "RESOURCE_IN_USE", "Bu kaynak aktif veya planlanmış bir operasyonda kullanıldığı için değiştirilemez.")
}

/**
 * References that make deleting this resource destroy live planning rather than history: a
 * ROOM/POOLED_EQUIPMENT booked by a Meeting that is still open (same "still mutable" rule as
 * `assertMeetingResourcesMutable`), or a VEHICLE/DRIVER held by an ACTIVE transport assignment.
 * Terminal/historical assignments are not counted — they keep working from their snapshots.
 */
async function countLiveReferences(tx: Prisma.TransactionClient, resourceId: string): Promise<number> {
  const openMeetingAssignments = await tx.resourceAssignment.count({
    where: {
      resourceId,
      meeting: {
        actualMeetingEnd: null,
        OR: [{ visits: { none: {} } }, { visits: { some: { status: { notIn: TERMINAL_VISIT_STATUSES } } } }],
      },
    },
  })
  const activeTransportAssignments = await tx.transportAssignment.count({
    where: { status: "ACTIVE", OR: [{ vehicleResourceId: resourceId }, { driverResourceId: resourceId }] },
  })
  return openMeetingAssignments + activeTransportAssignments
}

const include = { company: { select: { name: true } }, facility: { select: { name: true } }, driverLicenseClasses: { select: { value: true } }, driverDocuments: { select: { name: true } } } as const
type Row = { id: string; type: string; companyId: string; facilityId: string; name: string | null; totalQuantity: number | null; brand: string | null; model: string | null; licensePlate: string | null; fullName: string | null; canDriveCommercialVehicles: boolean | null; active: boolean; createdAt: Date; updatedAt: Date; company: { name: string }; facility: { name: string }; driverLicenseClasses: { value: string }[]; driverDocuments: { name: string }[] }

function toResource(row: Row): FacilityResource {
  const base = { id: row.id, companyId: row.companyId, companyName: row.company.name, facilityId: row.facilityId, facilityName: row.facility.name, isActive: row.active, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
  switch (parseResourceType(row.type)) {
    case "ROOM": if (!row.name) throw new Error("Invalid ROOM resource."); return { ...base, type: "ROOM", name: row.name }
    case "POOLED_EQUIPMENT": if (!row.name || !row.totalQuantity) throw new Error("Invalid POOLED_EQUIPMENT resource."); return { ...base, type: "POOLED_EQUIPMENT", name: row.name, totalQuantity: row.totalQuantity }
    case "VEHICLE": if (!row.brand || !row.model || !row.licensePlate) throw new Error("Invalid VEHICLE resource."); return { ...base, type: "VEHICLE", brand: row.brand, model: row.model, licensePlate: row.licensePlate }
    case "DRIVER": if (!row.fullName || row.canDriveCommercialVehicles === null) throw new Error("Invalid DRIVER resource."); return { ...base, type: "DRIVER", fullName: row.fullName, licenseClasses: row.driverLicenseClasses.map((item) => item.value), documents: row.driverDocuments.map((item) => item.name), canDriveCommercialVehicles: row.canDriveCommercialVehicles }
    default: throw new Error("Unsupported persisted resource type.")
  }
}

function createData(input: ResourceInput, active: boolean): Prisma.ResourceUncheckedCreateInput {
  const empty = { name: null, totalQuantity: null, brand: null, model: null, licensePlate: null, fullName: null, canDriveCommercialVehicles: null }
  switch (input.type) {
    case "ROOM": return { ...empty, type: input.type, companyId: input.companyId, facilityId: input.facilityId, name: input.name, active }
    case "POOLED_EQUIPMENT": return { ...empty, type: input.type, companyId: input.companyId, facilityId: input.facilityId, name: input.name, totalQuantity: input.totalQuantity, active }
    case "VEHICLE": return { ...empty, type: input.type, companyId: input.companyId, facilityId: input.facilityId, brand: input.brand, model: input.model, licensePlate: input.licensePlate, active }
    case "DRIVER": return { ...empty, type: input.type, companyId: input.companyId, facilityId: input.facilityId, fullName: input.fullName, canDriveCommercialVehicles: input.canDriveCommercialVehicles, active, driverLicenseClasses: { create: input.licenseClasses.map((value) => ({ value })) }, driverDocuments: { create: input.documents.map((name) => ({ name })) } }
  }
}

function updateData(input: ResourceInput): Prisma.ResourceUncheckedUpdateInput {
  const empty = { name: null, totalQuantity: null, brand: null, model: null, licensePlate: null, fullName: null, canDriveCommercialVehicles: null }
  switch (input.type) {
    case "ROOM": return { ...empty, type: input.type, companyId: input.companyId, facilityId: input.facilityId, name: input.name }
    case "POOLED_EQUIPMENT": return { ...empty, type: input.type, companyId: input.companyId, facilityId: input.facilityId, name: input.name, totalQuantity: input.totalQuantity }
    case "VEHICLE": return { ...empty, type: input.type, companyId: input.companyId, facilityId: input.facilityId, brand: input.brand, model: input.model, licensePlate: input.licensePlate }
    case "DRIVER": return { ...empty, type: input.type, companyId: input.companyId, facilityId: input.facilityId, fullName: input.fullName, canDriveCommercialVehicles: input.canDriveCommercialVehicles, driverLicenseClasses: { deleteMany: {}, create: input.licenseClasses.map((value) => ({ value })) }, driverDocuments: { deleteMany: {}, create: input.documents.map((name) => ({ name })) } }
  }
}

export class PrismaResourceRepository implements ResourceRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async list(filters: { includeInactive: boolean; companyId?: string; facilityId?: string; type?: string }) { const rows = await this.prisma.resource.findMany({ where: { ...(filters.includeInactive ? {} : { active: true }), ...(filters.companyId ? { companyId: filters.companyId } : {}), ...(filters.facilityId ? { facilityId: filters.facilityId } : {}), ...(filters.type ? { type: filters.type } : {}) }, include, orderBy: { createdAt: "asc" } }); return rows.map(toResource) }
  async find(id: string) { const row = await this.prisma.resource.findUnique({ where: { id }, include }); return row ? toResource(row) : null }
  async save(input: ResourceInput, id?: string, active = true) {
    try {
      const row = id
        ? await withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
          const current = await tx.resource.findUnique({ where: { id }, select: { companyId: true, facilityId: true } })
          if (!current) throw new ApiError(404, "NOT_FOUND", "Kaynak bulunamadı.")
          const scopeChanges = current.companyId !== input.companyId || current.facilityId !== input.facilityId
          if (scopeChanges && await countLiveReferences(tx, id) > 0) throw resourceInUse()
          return tx.resource.update({ where: { id }, data: updateData(input), include })
        }, { isolationLevel: "Serializable" }))
        : await this.prisma.resource.create({ data: createData(input, active), include })
      return toResource(row)
    } catch (error) {
      if (isDuplicateLicensePlateError(error)) throw duplicateLicensePlate()
      throw error
    }
  }
  async setActive(id: string, active: boolean) {
    if (active) return toResource(await this.prisma.resource.update({ where: { id }, data: { active }, include }))
    return toResource(await withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
      const current = await tx.resource.findUnique({ where: { id }, select: { id: true } })
      if (!current) throw new ApiError(404, "NOT_FOUND", "Kaynak bulunamadı.")
      if (await countLiveReferences(tx, id) > 0) throw resourceInUse()
      return tx.resource.update({ where: { id }, data: { active: false }, include })
    }, { isolationLevel: "Serializable" })))
  }
  /**
   * Checks live references and deletes in one serializable transaction so no booking can slip in
   * between the two. `ResourceAssignment.resourceId` is nulled by the database (ON DELETE SET
   * NULL); `TransportAssignment` cannot use that action (see the schema comment) so its two
   * historical columns are nulled here, inside the same transaction.
   */
  async delete(id: string) {
    return withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
      if (await countLiveReferences(tx, id) > 0) return false
      await tx.transportAssignment.updateMany({ where: { vehicleResourceId: id }, data: { vehicleResourceId: null } })
      await tx.transportAssignment.updateMany({ where: { driverResourceId: id }, data: { driverResourceId: null } })
      await tx.driverLicenseClass.deleteMany({ where: { resourceId: id } })
      await tx.driverDocument.deleteMany({ where: { resourceId: id } })
      await tx.resource.delete({ where: { id } })
      return true
    }, { isolationLevel: "Serializable" }))
  }
  async companyAndFacilityExist(companyId: string, facilityId: string) { return Boolean(await this.prisma.facility.findFirst({ where: { id: facilityId, companyId }, select: { id: true } })) }
  async findVehicleByCompanyAndPlate(companyId: string, licensePlate: string, excludeId?: string) { const row = await this.prisma.resource.findFirst({ where: { type: "VEHICLE", companyId, licensePlate, ...(excludeId ? { id: { not: excludeId } } : {}) }, include }); return row ? toResource(row) : null }
}
