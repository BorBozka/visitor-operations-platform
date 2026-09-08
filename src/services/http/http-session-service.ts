import { apiClient, ApiClientError } from "@/lib/http"
import type { SessionService, SessionUser } from "@/services/session-service"

interface SessionUserDto {
  id: string
  username: string
  fullName: string
  initials: string
  role: SessionUser["role"]
  roleLabel: string
  authenticationSource: SessionUser["authenticationSource"]
  authorizationScope?: { companyIds: string[]; facilityIds: string[]; securityGateIds: string[] }
  employeeId?: string | null
}

function mapSessionUser(dto: SessionUserDto): SessionUser {
  return {
    id: dto.id,
    username: dto.username,
    fullName: dto.fullName,
    initials: dto.initials,
    role: dto.role,
    roleLabel: dto.roleLabel,
    authenticationSource: dto.authenticationSource,
    authorizationScope: dto.authorizationScope,
    employeeId: dto.employeeId ?? null,
  }
}

/**
 * Real session adapter over `POST /api/auth/login`, `GET /api/auth/session`, and
 * `POST /api/auth/logout`. It keeps its own in-memory listener set for the `subscribe`
 * contract and registers a process-wide 401 handler so an expired/revoked cookie surfaced by
 * any request drops every subscriber to the logged-out state.
 */
export class HttpSessionService implements SessionService {
  private readonly listeners = new Set<(session: SessionUser | null) => void>()
  private current: SessionUser | null = null

  constructor() {
    apiClient.setUnauthorizedHandler((error: ApiClientError) => {
      // The 401 a rejected login itself produces is not a lost session.
      if (error.code === "INVALID_CREDENTIALS") return
      if (this.current !== null) this.notify(null)
    })
  }

  async login(username: string, password: string): Promise<SessionUser> {
    const { user } = await apiClient.post<{ user: SessionUserDto }>("/auth/login", { username, password })
    const session = mapSessionUser(user)
    this.notify(session)
    return session
  }

  async logout(): Promise<void> {
    try {
      await apiClient.post<void>("/auth/logout")
    } finally {
      this.notify(null)
    }
  }

  async getCurrentSession(): Promise<SessionUser | null> {
    const { user } = await apiClient.get<{ user: SessionUserDto | null }>("/auth/session")
    const session = user ? mapSessionUser(user) : null
    this.notify(session)
    return session
  }

  subscribe(listener: (session: SessionUser | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(session: SessionUser | null): void {
    this.current = session
    this.listeners.forEach((listener) => listener(session))
  }
}
