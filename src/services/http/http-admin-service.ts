import { apiClient } from "@/lib/http"
import type {
  AdminUser,
  CreateVisitorCardInput,
  OperationalSettings,
  OrganizationEntity,
  OrganizationKind,
  OrganizationSnapshot,
  UpdateVisitorCardInventoryInput,
  VisitTypeDefinition,
  VisitorCardInventoryItem,
  VisitorRuleVersion,
} from "@/domain/admin"
import type { AdminService, SaveAdminUserOptions } from "@/services/admin-service"
import {
  mapAdminUser,
  mapOperationalSettings,
  mapOrganizationChild,
  mapOrganizationEntity,
  mapVisitType,
  mapVisitorCard,
  mapVisitorRule,
  type AdminUserDto,
  type OperationalSettingsDto,
  type OrganizationEntityDto,
  type OrganizationSnapshotDto,
  type VisitTypeDto,
  type VisitorCardDto,
  type VisitorRuleDto,
} from "@/services/http/mappers"

const organizationPaths: Record<OrganizationKind, string> = {
  COMPANY: "companies",
  FACILITY: "facilities",
  DEPARTMENT: "departments",
  SECURITY_GATE: "security-gates",
}

/**
 * Admin/organization adapter. Every write derives its actor from the session — the page's
 * `actingUserId` is only a UI hint and is never sent. Identity fields are submitted on update
 * only for LOCAL users, matching the backend's "identity is external for AD" rule.
 */
export class HttpAdminService implements AdminService {
  async getUsers(): Promise<AdminUser[]> {
    return (await apiClient.get<AdminUserDto[]>("/admin/users")).map(mapAdminUser)
  }

  async saveUser(
    input: Omit<AdminUser, "id"> & { id?: string },
    options: SaveAdminUserOptions = {},
  ): Promise<AdminUser> {
    if (!input.id) {
      const created = await apiClient.post<AdminUserDto>("/admin/users", {
        fullName: input.fullName,
        username: input.username,
        email: input.email,
        password: options.temporaryPassword ?? "",
        role: input.role,
        authorizationScope: input.authorizationScope,
        active: input.active,
      })
      return mapAdminUser(created)
    }

    const identity =
      input.authenticationSource === "ACTIVE_DIRECTORY"
        ? {}
        : { fullName: input.fullName, username: input.username, email: input.email }
    const updated = await apiClient.patch<AdminUserDto>(`/admin/users/${encodeURIComponent(input.id)}`, {
      ...identity,
      role: input.role,
      authorizationScope: input.authorizationScope,
      active: input.active,
    })
    return mapAdminUser(updated)
  }

  async resetLocalUserPassword(userId: string, newPassword: string): Promise<void> {
    await apiClient.post<void>(`/admin/users/${encodeURIComponent(userId)}/reset-password`, { password: newPassword })
  }

  async getOrganization(): Promise<OrganizationSnapshot> {
    const dto = await apiClient.get<OrganizationSnapshotDto>("/organization", { query: { includeInactive: "true" } })
    return {
      companies: dto.companies.map(mapOrganizationEntity),
      facilities: dto.facilities.map(mapOrganizationChild),
      departments: dto.departments.map(mapOrganizationChild),
      securityGates: dto.securityGates.map(mapOrganizationChild),
    }
  }

  async saveOrganizationEntity(
    kind: OrganizationKind,
    entity: Omit<OrganizationEntity, "id"> & { id?: string },
  ): Promise<OrganizationEntity> {
    const path = organizationPaths[kind]
    const body = { parentId: entity.parentId, name: entity.name, active: entity.active }
    const saved = entity.id
      ? await apiClient.patch<OrganizationEntityDto>(`/${path}/${encodeURIComponent(entity.id)}`, body)
      : await apiClient.post<OrganizationEntityDto>(`/${path}`, body)
    return mapOrganizationEntity(saved)
  }

  async getVisitTypes(): Promise<VisitTypeDefinition[]> {
    return (await apiClient.get<VisitTypeDto[]>("/visit-types", { query: { includeInactive: "true" } })).map(mapVisitType)
  }

  async saveVisitType(visitType: Omit<VisitTypeDefinition, "id"> & { id?: string }): Promise<VisitTypeDefinition> {
    const body = { name: visitType.name, active: visitType.active }
    const saved = visitType.id
      ? await apiClient.patch<VisitTypeDto>(`/visit-types/${encodeURIComponent(visitType.id)}`, body)
      : await apiClient.post<VisitTypeDto>("/visit-types", body)
    return mapVisitType(saved)
  }

  async deleteVisitType(id: string): Promise<void> {
    await apiClient.delete<void>(`/visit-types/${encodeURIComponent(id)}`)
  }

  async getVisitorCards(): Promise<VisitorCardInventoryItem[]> {
    return (await apiClient.get<VisitorCardDto[]>("/admin/visitor-cards")).map(mapVisitorCard)
  }

  async createVisitorCard(input: CreateVisitorCardInput): Promise<VisitorCardInventoryItem> {
    return mapVisitorCard(await apiClient.post<VisitorCardDto>("/admin/visitor-cards", { cardNumber: input.cardNumber }))
  }

  async updateVisitorCardInventory(
    id: string,
    input: UpdateVisitorCardInventoryInput,
  ): Promise<VisitorCardInventoryItem> {
    return mapVisitorCard(
      await apiClient.patch<VisitorCardDto>(`/admin/visitor-cards/${encodeURIComponent(id)}`, {
        cardNumber: input.cardNumber,
        active: input.active,
      }),
    )
  }

  async markVisitorCardLost(id: string): Promise<VisitorCardInventoryItem> {
    return mapVisitorCard(await apiClient.post<VisitorCardDto>(`/admin/visitor-cards/${encodeURIComponent(id)}/mark-lost`))
  }

  async restoreVisitorCard(id: string): Promise<VisitorCardInventoryItem> {
    return mapVisitorCard(await apiClient.post<VisitorCardDto>(`/admin/visitor-cards/${encodeURIComponent(id)}/restore`))
  }

  async deleteVisitorCard(id: string): Promise<void> {
    await apiClient.delete<void>(`/admin/visitor-cards/${encodeURIComponent(id)}`)
  }

  async getVisitorRuleVersions(): Promise<VisitorRuleVersion[]> {
    return (await apiClient.get<VisitorRuleDto[]>("/admin/visitor-rules")).map(mapVisitorRule)
  }

  async publishVisitorRule(content: string): Promise<VisitorRuleVersion> {
    return mapVisitorRule(await apiClient.post<VisitorRuleDto>("/admin/visitor-rules", { content }))
  }

  async getOperationalSettings(): Promise<OperationalSettings> {
    return mapOperationalSettings(await apiClient.get<OperationalSettingsDto>("/settings/operational"))
  }

  async saveOperationalSettings(settings: OperationalSettings): Promise<OperationalSettings> {
    return mapOperationalSettings(
      await apiClient.put<OperationalSettingsDto>("/settings/operational", {
        overdueToleranceMinutes: settings.overdueToleranceMinutes,
        overdueAlertRepeatMinutes: settings.overdueAlertRepeatMinutes,
        workdayEndTime: settings.workdayEndTime,
      }),
    )
  }
}
