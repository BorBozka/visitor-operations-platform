import type { AuthenticationSource, ApplicationRole, AuthorizationScope } from "@/domain/admin"

export interface SessionUser {
  id: string
  username: string
  fullName: string
  initials: string
  role: ApplicationRole
  roleLabel: string
  authenticationSource: AuthenticationSource
  /**
   * Raw assigned scope from the backend session. The server is the authorization source of
   * truth; the frontend uses this only for scope-aware UI defaults, never as a security check.
   * Optional for compatibility with session responses that do not carry an assigned scope.
   */
  authorizationScope?: AuthorizationScope
  /** Linked employee id, or `null` for a pure Admin account. */
  employeeId?: string | null
}

export interface SessionService {
  login(username: string, password: string): Promise<SessionUser>
  logout(): Promise<void>
  getCurrentSession(): Promise<SessionUser | null>
  subscribe(listener: (session: SessionUser | null) => void): () => void
}
