import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { isApiClientError } from "@/lib/http"
import type { SessionService, SessionUser } from "@/services/session-service"

interface AuthContextValue {
  currentUser: SessionUser | null
  authenticated: boolean
  /** True until the first `GET /api/auth/session` settles (success or failure). */
  initializing: boolean
  /** Set when session hydration could not reach the backend — the app is neither in nor out. */
  initError: string | null
  loading: boolean
  login(username: string, password: string): Promise<SessionUser>
  logout(): Promise<void>
  /** Re-run session hydration after an `initError` (or to refresh the current session). */
  retryHydration(): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ service, children }: { service: SessionService; children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hydrationNonce, setHydrationNonce] = useState(0)

  useEffect(() => {
    let active = true
    setInitializing(true)
    setInitError(null)
    void service
      .getCurrentSession()
      .then((session) => {
        if (!active) return
        setCurrentUser(session)
        setInitializing(false)
      })
      .catch((error: unknown) => {
        if (!active) return
        // A hydration failure is a reachability problem, not "logged out" — do not bounce to a
        // login form that also cannot reach the backend. Surface it and offer a retry.
        setInitError(
          isApiClientError(error) ? error.message : "Oturum bilgisi alınamadı. Bağlantınızı kontrol edin.",
        )
        setInitializing(false)
      })
    const unsubscribe = service.subscribe((session) => {
      if (active) {
        setCurrentUser(session)
        setInitializing(false)
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [service, hydrationNonce])

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true)
    try {
      const session = await service.login(username, password)
      setCurrentUser(session)
      return session
    } finally {
      setLoading(false)
    }
  }, [service])

  const logout = useCallback(async () => {
    setLoading(true)
    try {
      await service.logout()
      setCurrentUser(null)
    } finally {
      setLoading(false)
    }
  }, [service])

  const retryHydration = useCallback(() => setHydrationNonce((value) => value + 1), [])

  const value = useMemo(
    () => ({
      currentUser,
      authenticated: currentUser !== null,
      initializing,
      initError,
      loading,
      login,
      logout,
      retryHydration,
    }),
    [currentUser, initializing, initError, loading, login, logout, retryHydration],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The hook intentionally shares this module with its provider so the context remains private.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth, AuthProvider içinde kullanılmalıdır.")
  return context
}
