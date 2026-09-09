import type { Prisma, PrismaClient } from "@prisma/client"

import { ApiError } from "../lib/api-error.js"
import { parseEnum } from "../lib/parse-enum.js"
import { isWriteConflictError, withWriteConflictRetry } from "../lib/prisma-conflict.js"
import type { DriverResource, FacilityResource, VehicleResource } from "../modules/resources/types.js"
import { transportAssignmentStatuses, type PlannedTransportAssignmentDto } from "../modules/transport-assignments/types.js"
import { RESOURCE_INCLUDE, toFacilityResource, type ResourceRow } from "./resource-projection.js"

export interface PersistTransportAssignmentInput {
  companyId: string
  facilityId: string
  plannedStart: string
  plannedEnd: string
  purpose: string
  vehicleResourceId: string
  vehicleName: string
  vehicleLicensePlate: string
  driverResourceId: string
  driverName: string
  relatedMeetingId?: string
  relatedVisitId?: string
}

export interface OverlappingActiveAssignment {
  id: string
  vehicleResourceId: string | null
  driverResourceId: string | null
}

export interface TransportAssignmentRepository {
  list(): Promise<PlannedTransportAssignmentDto[]>
  find(id: string): Promise<PlannedTransportAssignmentDto | null>
  companyAndFacilityMatch(companyId: string, facilityId: string): Promise<boolean>
  findResource(resourceId: string): Promise<FacilityResource | null>
  findMeetingScope(meetingId: string): Promise<{ companyId: string; facilityId: string } | null>
  findVisitScope(visitId: string): Promise<{ companyId: string; facilityId: string } | null>
  listActiveResources(companyId: string, facilityId: string): Promise<{ vehicles: VehicleResource[]; drivers: DriverResource[] }>
  findOverlappingActive(input: { plannedStart: string; plannedEnd: string; excludeAssignmentId?: string }): Promise<OverlappingActiveAssignment[]>
  create(input: PersistTransportAssignmentInput): Promise<PlannedTransportAssignmentDto>
  update(id: string, input: PersistTransportAssignmentInput): Promise<PlannedTransportAssignmentDto>
  /** Returns null when the assignment was already CANCELLED (lost an optimistic status race). */
  cancel(id: string): Promise<PlannedTransportAssignmentDto | null>
}

export const TRANSPORT_ASSIGNMENT_INCLUDE = { company: { select: { name: true } }, facility: { select: { name: true } } } as const
const include = TRANSPORT_ASSIGNMENT_INCLUDE

type Row = {
  id: string
  companyId: string
  facilityId: string
  plannedStart: Date
  plannedEnd: Date
  purpose: string
  vehicleResourceId: string | null
  vehicleName: string
  vehicleLicensePlate: string
  driverResourceId: string | null
  driverName: string
  relatedMeetingId: string | null
  relatedVisitId: string | null
  status: string
  createdAt: Date
  company: { name: string }
  facility: { name: string }
}

export function toTransportAssignmentDto(row: Row): PlannedTransportAssignmentDto {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    facilityId: row.facilityId,
    facilityName: row.facility.name,
    plannedStart: row.plannedStart.toISOString(),
    plannedEnd: row.plannedEnd.toISOString(),
    purpose: row.purpose,
    vehicleResourceId: row.vehicleResourceId,
    vehicleName: row.vehicleName,
    vehicleLicensePlate: row.vehicleLicensePlate,
    driverResourceId: row.driverResourceId,
    driverName: row.driverName,
    relatedMeetingId: row.relatedMeetingId ?? undefined,
    relatedVisitId: row.relatedVisitId ?? undefined,
    status: parseEnum(transportAssignmentStatuses, row.status, "transport assignment status"),
    createdAt: row.createdAt.toISOString(),
  }
}

function toData(input: PersistTransportAssignmentInput) {
  return {
    companyId: input.companyId,
    facilityId: input.facilityId,
    plannedStart: new Date(input.plannedStart),
    plannedEnd: new Date(input.plannedEnd),
    purpose: input.purpose,
    vehicleResourceId: input.vehicleResourceId,
    vehicleName: input.vehicleName,
    vehicleLicensePlate: input.vehicleLicensePlate,
    driverResourceId: input.driverResourceId,
    driverName: input.driverName,
    relatedMeetingId: input.relatedMeetingId ?? null,
    relatedVisitId: input.relatedVisitId ?? null,
  }
}

const CONFLICT = () => new ApiError(409, "TRANSPORT_ASSIGNMENT_CONFLICT", "Seçilen araç veya şoför bu zaman aralığında müsait değil.")

export class PrismaTransportAssignmentRepository implements TransportAssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list() {
    return (await this.prisma.transportAssignment.findMany({ include, orderBy: { plannedStart: "asc" } })).map(toTransportAssignmentDto)
  }

  async find(id: string) {
    const row = await this.prisma.transportAssignment.findUnique({ where: { id }, include })
    return row ? toTransportAssignmentDto(row) : null
  }

  async companyAndFacilityMatch(companyId: string, facilityId: string) {
    return (await this.prisma.facility.count({ where: { id: facilityId, companyId } })) > 0
  }

  async findResource(resourceId: string) {
    const row = await this.prisma.resource.findUnique({ where: { id: resourceId }, include: RESOURCE_INCLUDE })
    return row ? toFacilityResource(row as ResourceRow) : null
  }

  async findMeetingScope(meetingId: string) {
    const row = await this.prisma.meeting.findUnique({ where: { id: meetingId }, select: { hostCompanyId: true, facilityId: true } })
    return row ? { companyId: row.hostCompanyId, facilityId: row.facilityId } : null
  }

  async findVisitScope(visitId: string) {
    const row = await this.prisma.visit.findUnique({ where: { id: visitId }, select: { meeting: { select: { hostCompanyId: true, facilityId: true } } } })
    return row ? { companyId: row.meeting.hostCompanyId, facilityId: row.meeting.facilityId } : null
  }

  async listActiveResources(companyId: string, facilityId: string) {
    const rows = await this.prisma.resource.findMany({
      where: { companyId, facilityId, active: true, type: { in: ["VEHICLE", "DRIVER"] } },
      include: RESOURCE_INCLUDE,
      orderBy: { createdAt: "asc" },
    })
    const resources = rows.map((row) => toFacilityResource(row as ResourceRow))
    return {
      vehicles: resources.filter((resource): resource is VehicleResource => resource.type === "VEHICLE"),
      drivers: resources.filter((resource): resource is DriverResource => resource.type === "DRIVER"),
    }
  }

  findOverlappingActive(input: { plannedStart: string; plannedEnd: string; excludeAssignmentId?: string }) {
    return this.queryOverlapping(this.prisma, input)
  }

  async create(input: PersistTransportAssignmentInput) {
    try {
      const created = await withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
        const verifiedInput = await this.revalidateResources(tx, input)
        await this.assertNoOverlap(tx, verifiedInput, undefined)
        return tx.transportAssignment.create({ data: { ...toData(verifiedInput), status: "ACTIVE" }, include })
      }, { isolationLevel: "Serializable" }))
      return toTransportAssignmentDto(created)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async update(id: string, input: PersistTransportAssignmentInput) {
    try {
      const updated = await withWriteConflictRetry(() => this.prisma.$transaction(async (tx) => {
        const current = await tx.transportAssignment.findUnique({ where: { id }, select: { status: true } })
        if (!current) throw new ApiError(404, "NOT_FOUND", "Planlı atama bulunamadı.")
        if (current.status === "CANCELLED") throw new ApiError(409, "TRANSPORT_ASSIGNMENT_NOT_EDITABLE", "İptal edilen atama düzenlenemez.")
        const verifiedInput = await this.revalidateResources(tx, input)
        await this.assertNoOverlap(tx, verifiedInput, id)
        return tx.transportAssignment.update({ where: { id }, data: toData(verifiedInput), include })
      }, { isolationLevel: "Serializable" }))
      return toTransportAssignmentDto(updated)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async cancel(id: string) {
    const changed = await this.prisma.transportAssignment.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CANCELLED" } })
    return changed.count === 0 ? null : this.find(id)
  }

  private async revalidateResources(
    tx: Prisma.TransactionClient,
    input: PersistTransportAssignmentInput,
  ): Promise<PersistTransportAssignmentInput> {
    const resources = await tx.resource.findMany({
      where: { id: { in: [input.vehicleResourceId, input.driverResourceId] } },
      select: {
        id: true, type: true, companyId: true, facilityId: true, active: true,
        brand: true, model: true, licensePlate: true, fullName: true,
      },
    })
    const byId = new Map(resources.map((resource) => [resource.id, resource]))
    const vehicle = byId.get(input.vehicleResourceId)
    const driver = byId.get(input.driverResourceId)
    if (!vehicle
      || !driver
      || !vehicle.active
      || !driver.active
      || vehicle.type !== "VEHICLE"
      || driver.type !== "DRIVER"
      || vehicle.companyId !== input.companyId
      || vehicle.facilityId !== input.facilityId
      || driver.companyId !== input.companyId
      || driver.facilityId !== input.facilityId
      || !vehicle.brand
      || !vehicle.model
      || !vehicle.licensePlate
      || !driver.fullName) {
      throw CONFLICT()
    }
    return {
      ...input,
      companyId: vehicle.companyId,
      facilityId: vehicle.facilityId,
      vehicleName: `${vehicle.brand} ${vehicle.model}`.trim(),
      vehicleLicensePlate: vehicle.licensePlate,
      driverName: driver.fullName,
    }
  }

  private async assertNoOverlap(
    tx: Pick<PrismaClient, "transportAssignment">,
    input: PersistTransportAssignmentInput,
    excludeAssignmentId: string | undefined,
  ) {
    const overlapping = await this.queryOverlapping(tx, { plannedStart: input.plannedStart, plannedEnd: input.plannedEnd, excludeAssignmentId })
    if (overlapping.some((item) => item.vehicleResourceId === input.vehicleResourceId || item.driverResourceId === input.driverResourceId)) {
      throw CONFLICT()
    }
  }

  private async queryOverlapping(
    client: Pick<PrismaClient, "transportAssignment">,
    input: { plannedStart: string; plannedEnd: string; excludeAssignmentId?: string },
  ): Promise<OverlappingActiveAssignment[]> {
    const rows = await client.transportAssignment.findMany({
      where: {
        status: "ACTIVE",
        ...(input.excludeAssignmentId ? { id: { not: input.excludeAssignmentId } } : {}),
        plannedStart: { lt: new Date(input.plannedEnd) },
        plannedEnd: { gt: new Date(input.plannedStart) },
      },
      select: { id: true, vehicleResourceId: true, driverResourceId: true },
    })
    return rows
  }

  private mapError(error: unknown): unknown {
    if (error instanceof ApiError) return error
    if (isWriteConflictError(error)) return CONFLICT()
    return error
  }
}
