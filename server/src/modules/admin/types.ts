import { applicationRoles, parseApplicationRole, type ApplicationRole } from "../../auth/auth-types.js"

export { applicationRoles, type ApplicationRole }

export const employeeProfileRoles = ["EMPLOYEE", "MANAGER", "SECURITY"] as const

export function roleRequiresEmployeeProfile(role: ApplicationRole): boolean {
  return employeeProfileRoles.includes(role as (typeof employeeProfileRoles)[number])
}

export interface AuthorizationScope {
  companyIds: string[]
  facilityIds: string[]
  securityGateIds: string[]
}

export interface AdminUser {
  id: string
  fullName: string
  username: string
  email: string
  authenticationSource: "LOCAL" | "ACTIVE_DIRECTORY"
  role: ApplicationRole
  authorizationScope: AuthorizationScope
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateAdminUserInput {
  fullName: string
  username: string
  email: string
  password: string
  role: ApplicationRole
  authorizationScope: AuthorizationScope
  active: boolean
}

export interface UpdateAdminUserInput {
  fullName?: string
  username?: string
  email?: string
  role?: ApplicationRole
  authorizationScope?: AuthorizationScope
  active?: boolean
}

export { parseApplicationRole }
