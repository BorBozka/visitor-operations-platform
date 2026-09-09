import type { AuthorizationScope } from "../../../lib/scope.js"
import type {
  CompleteGoodsMovementPersistInput,
  GoodsMovementRepository,
  PersistGoodsMovementInput,
} from "../../../repositories/goods-movement-repository.js"
import type { GoodsMovementDirection, GoodsMovementDto, GoodsMovementStatus } from "../types.js"

const clone = <T>(value: T): T => structuredClone(value)
type StoredGoodsMovement = GoodsMovementDto & { createdByUserId?: string }

export interface InMemoryFacilityScope {
  companyId: string
  facilityId: string
  companyName?: string
  facilityName?: string
}

export class InMemoryGoodsMovementRepository implements GoodsMovementRepository {
  private movements: StoredGoodsMovement[]
  private sequence = 0

  constructor(
    seed: GoodsMovementDto[] = [],
    private readonly facilityScopes: InMemoryFacilityScope[] = [],
    private readonly userScopes: Record<string, AuthorizationScope> = {},
  ) {
    this.movements = clone(seed)
  }

  async list() {
    return clone(this.movements)
  }

  async listByCreatorUserId(userId: string) {
    return clone(this.movements.filter((movement) => movement.createdByUserId === userId))
  }

  async find(id: string) {
    const movement = this.movements.find((item) => item.id === id)
    return movement ? clone(movement) : null
  }

  async companyAndFacilityMatch(companyId: string, facilityId: string) {
    return this.facilityScopes.some((scope) => scope.companyId === companyId && scope.facilityId === facilityId)
  }

  async create(input: PersistGoodsMovementInput) {
    const record = this.toRecord(input, `goods-${++this.sequence}`, "PLANNED", new Date("2026-01-01T00:00:00.000Z").toISOString())
    this.movements = [...this.movements, record]
    return clone(record)
  }

  async update(id: string, input: PersistGoodsMovementInput) {
    const current = this.movements.find((item) => item.id === id)
    if (!current || current.status !== "PLANNED") return null
    const record = this.toRecord(input, id, "PLANNED", current.createdAt)
    this.movements = this.movements.map((item) => (item.id === id ? record : item))
    return clone(record)
  }

  async cancel(id: string) {
    const current = this.movements.find((item) => item.id === id)
    if (!current || current.status !== "PLANNED") return null
    const record: GoodsMovementDto = { ...current, status: "CANCELLED" }
    this.movements = this.movements.map((item) => (item.id === id ? record : item))
    return clone(record)
  }

  async complete(id: string, input: CompleteGoodsMovementPersistInput) {
    const current = this.movements.find((item) => item.id === id)
    if (!current || current.status !== "PLANNED") return null
    const record: GoodsMovementDto = {
      ...current,
      status: "COMPLETED",
      actualAt: input.actualAt.toISOString(),
      actualPlate: input.actualPlate,
      actualDriverName: input.actualDriverName,
    }
    this.movements = this.movements.map((item) => (item.id === id ? record : item))
    return clone(record)
  }

  async findUserScope(userId: string) {
    return this.userScopes[userId] ?? null
  }

  private toRecord(input: PersistGoodsMovementInput, id: string, status: GoodsMovementStatus, createdAt: string): StoredGoodsMovement {
    const scope = this.facilityScopes.find((item) => item.companyId === input.companyId && item.facilityId === input.facilityId)
    return {
      id,
      direction: input.direction as GoodsMovementDirection,
      companyId: input.companyId,
      companyName: scope?.companyName ?? input.companyId,
      facilityId: input.facilityId,
      facilityName: scope?.facilityName ?? input.facilityId,
      counterpartyName: input.counterpartyName,
      plannedDate: input.plannedDate,
      plannedTime: input.plannedTime,
      goodsDescription: input.goodsDescription,
      referenceNumber: input.referenceNumber,
      note: input.note,
      createdByUserId: input.createdByUserId,
      status,
      createdAt,
    }
  }
}
