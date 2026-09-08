/**
 * Client-side profile-photo preference.
 *
 * Phase 5 keeps avatars as a per-browser convenience in `localStorage` rather than inventing
 * blob/database infrastructure. The HTTP `AccountService` uses this browser-local store for
 * avatars; only password changes go to the backend.
 */
const avatarStoragePrefix = "visitor-management:account-avatar:"
export const avatarChangedEvent = "visitor-management:account-avatar-changed"

function getStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function avatarStorageKey(userId: string): string {
  return `${avatarStoragePrefix}${userId}`
}

function announceAvatarChange(userId: string): void {
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(avatarChangedEvent, { detail: { userId } }))
  }
}

export function readStoredAvatar(userId: string): string | undefined {
  return getStorage()?.getItem(avatarStorageKey(userId)) ?? undefined
}

export function writeStoredAvatar(userId: string, avatar: string): void {
  if (!avatar.startsWith("data:image/")) throw new Error("Geçerli bir görsel kaydedilemedi.")
  getStorage()?.setItem(avatarStorageKey(userId), avatar)
  announceAvatarChange(userId)
}

export function clearStoredAvatar(userId: string): void {
  getStorage()?.removeItem(avatarStorageKey(userId))
  announceAvatarChange(userId)
}
