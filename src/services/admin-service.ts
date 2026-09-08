import type { AdminUser, CreateVisitorCardInput, OperationalSettings, OrganizationEntity, OrganizationKind, OrganizationSnapshot, UpdateVisitorCardInventoryInput, VisitTypeDefinition, VisitorCardInventoryItem, VisitorRuleVersion } from "@/domain/admin"

export interface SaveAdminUserOptions {
  // The id of the currently signed-in Admin, used only for the page's proactive
  // self-deactivation/self-demotion UI guards. The real backend derives the actor from the
  // session and re-enforces these rules; the HTTP adapter never sends this field.
  actingUserId?: string
  // Temporary password for a brand-new LOCAL user. The HTTP adapter forwards it to
  // `POST /api/admin/users` so the backend can hash it. Not used on update
  // (an existing user's password is changed only through `resetLocalUserPassword`).
  temporaryPassword?: string
}

export interface AdminService {
  getUsers(): Promise<AdminUser[]>
  saveUser(user: Omit<AdminUser, "id"> & { id?: string }, options?: SaveAdminUserOptions): Promise<AdminUser>
  // Never returns or stores the password in the frontend. Rejects for Active Directory-owned users.
  resetLocalUserPassword(userId: string, newPassword: string): Promise<void>
  getOrganization(): Promise<OrganizationSnapshot>
  saveOrganizationEntity(kind: OrganizationKind, entity: Omit<OrganizationEntity, "id"> & { id?: string }): Promise<OrganizationEntity>
  getVisitTypes(): Promise<VisitTypeDefinition[]>
  saveVisitType(visitType: Omit<VisitTypeDefinition, "id"> & { id?: string }): Promise<VisitTypeDefinition>
  getVisitorCards(): Promise<VisitorCardInventoryItem[]>
  createVisitorCard(input: CreateVisitorCardInput): Promise<VisitorCardInventoryItem>
  updateVisitorCardInventory(id: string, input: UpdateVisitorCardInventoryInput): Promise<VisitorCardInventoryItem>
  markVisitorCardLost(id: string): Promise<VisitorCardInventoryItem>
  restoreVisitorCard(id: string): Promise<VisitorCardInventoryItem>
  getVisitorRuleVersions(): Promise<VisitorRuleVersion[]>
  publishVisitorRule(content: string): Promise<VisitorRuleVersion>
  getOperationalSettings(): Promise<OperationalSettings>
  saveOperationalSettings(settings: OperationalSettings): Promise<OperationalSettings>
}
