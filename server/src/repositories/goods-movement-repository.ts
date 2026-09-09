import type { PrismaClient } from "@prisma/client"

import { parseEnum } from "../lib/parse-enum.js"
import type { AuthorizationScope } from "../lib/scope.js"
import { goodsMovementDirections, goodsMovementStatuses, type GoodsMovementDto } from "../modules/goods/types.js"

export interface PersistGoodsMovementInput {
  direction: string
  companyId: string
  facilityId: string
  counterpartyName: string
  plannedDate: string
  plannedTime?: string
  goodsDescription: string
  referenceNumber?: string
  note?: string
  createdByUserId?: string
}

export interface CompleteGoodsMovementPersistInput {
  actualAt: Date
  actualPlate?: string
  actualDriverName?: string
}

export interface GoodsMovementRepository {
  list(): Promise<GoodsMovementDto[]>
  listByCreatorUserId(userId: string): Promise<GoodsMovementDto[]>
  find(id: string): Promise<GoodsMovementDto | null>
  companyAndFacilityMatch(companyId: string, facilityId: string): Promise<boolean>
  create(input: PersistGoodsMovementInput): Promise<GoodsMovementDto>
  /** Returns null when the record is no longer PLANNED (lost an optimistic status race). */
  update(id: string, input: PersistGoodsMovementInput): Promise<GoodsMovementDto | null>
  cancel(id: string): Promise<GoodsMovementDto | null>
  complete(id: string, input: CompleteGoodsMovementPersistInput): Promise<GoodsMovementDto | null>
  findUserScope(userId: string): Promise<AuthorizationScope | null>
}

const include = { company: { select: { name: true } }, facility: { select: { name: true } } } as const

type GoodsMovementRow = {
  id: string
  direction: string
  companyId: string
  facilityId: string
  counterpartyName: string
  plannedDate: Date
  plannedTime: string | null
  goodsDescription: string
  referenceNumber: string | null
  note: string | null
  status: string
  actualAt: Date | null
  actualPlate: string | null
  actualDriverName: string | null
  createdAt: Date
  company: { name: string }
  facility: { name: string }
}

export const GOODS_MOVEMENT_INCLUDE = include

export function toGoodsMovementDto(row: GoodsMovementRow): GoodsMovementDto {
  return {
    id: row.id,
    direction: parseEnum(goodsMovementDirections, row.direction, "goods movement direction"),
    companyId: row.companyId,
    companyName: row.company.name,
    facilityId: row.facilityId,
    facilityName: row.facility.name,
    counterpartyName: row.counterpartyName,
    plannedDate: row.plannedDate.toISOString().slice(0, 10),
    plannedTime: row.plannedTime ?? undefined,
    goodsDescription: row.goodsDescription,
    referenceNumber: row.referenceNumber ?? undefined,
    note: row.note ?? undefined,
    status: parseEnum(goodsMovementStatuses, row.status, "goods movement status"),
    actualAt: row.actualAt?.toISOString(),
    actualPlate: row.actualPlate ?? undefined,
    actualDriverName: row.actualDriverName ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }
}

function toData(input: PersistGoodsMovementInput) {
  return {
    direction: input.direction,
    companyId: input.companyId,
    facilityId: input.facilityId,
    counterpartyName: input.counterpartyName,
    plannedDate: new Date(`${input.plannedDate}T00:00:00.000Z`),
    plannedTime: input.plannedTime ?? null,
    goodsDescription: input.goodsDescription,
    referenceNumber: input.referenceNumber ?? null,
    note: input.note ?? null,
    createdByUserId: input.createdByUserId,
  }
}

export class PrismaGoodsMovementRepository implements GoodsMovementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list() {
    const rows = await this.prisma.goodsMovement.findMany({ include, orderBy: [{ plannedDate: "desc" }, { plannedTime: "desc" }, { createdAt: "desc" }] })
    return rows.map(toGoodsMovementDto)
  }

  async listByCreatorUserId(userId: string) {
    const rows = await this.prisma.goodsMovement.findMany({
      where: { createdByUserId: userId },
      include,
      orderBy: [{ plannedDate: "asc" }, { plannedTime: "asc" }, { createdAt: "asc" }],
    })
    return rows.map(toGoodsMovementDto)
  }

  async find(id: string) {
    const row = await this.prisma.goodsMovement.findUnique({ where: { id }, include })
    return row ? toGoodsMovementDto(row) : null
  }

  async companyAndFacilityMatch(companyId: string, facilityId: string) {
    return (await this.prisma.facility.count({ where: { id: facilityId, companyId } })) > 0
  }

  async create(input: PersistGoodsMovementInput) {
    return toGoodsMovementDto(await this.prisma.goodsMovement.create({ data: toData(input), include }))
  }

  async update(id: string, input: PersistGoodsMovementInput) {
    const changed = await this.prisma.goodsMovement.updateMany({ where: { id, status: "PLANNED" }, data: toData(input) })
    return changed.count === 0 ? null : this.find(id)
  }

  async cancel(id: string) {
    const changed = await this.prisma.goodsMovement.updateMany({ where: { id, status: "PLANNED" }, data: { status: "CANCELLED" } })
    return changed.count === 0 ? null : this.find(id)
  }

  async complete(id: string, input: CompleteGoodsMovementPersistInput) {
    const changed = await this.prisma.goodsMovement.updateMany({
      where: { id, status: "PLANNED" },
      data: { status: "COMPLETED", actualAt: input.actualAt, actualPlate: input.actualPlate ?? null, actualDriverName: input.actualDriverName ?? null },
    })
    return changed.count === 0 ? null : this.find(id)
  }

  async findUserScope(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { companyScopes: { select: { companyId: true } }, facilityScopes: { select: { facilityId: true } }, securityGateScopes: { select: { securityGateId: true } } },
    })
    if (!user) return null
    return {
      companyIds: user.companyScopes.map((scope) => scope.companyId),
      facilityIds: user.facilityScopes.map((scope) => scope.facilityId),
      securityGateIds: user.securityGateScopes.map((scope) => scope.securityGateId),
    }
  }
}
