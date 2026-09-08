import type { SessionUser } from "@/services/session-service"

/**
 * Stable key for "who is signed in, as what". Providers key their session-scoped loads on it so a
 * logout, an account switch, and a role change on the same account all restart the load the same
 * way — and so a new `SessionUser` object with unchanged identity does not re-fetch.
 */
export function getSessionKey(user: SessionUser | null): string | null {
  return user ? `${user.id}:${user.role}` : null
}
