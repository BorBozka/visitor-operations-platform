/**
 * Provider data is scoped to the signed-in session, but the requests that fill it are not: a
 * response for the previous account can land after the next account already signed in. The guard
 * hands out a monotonically increasing token; a run may commit only while its token is still the
 * newest one, so a superseded response is dropped instead of written into the current session.
 */
export interface SessionGuard {
  /** Starts a new run and invalidates every run started before it. */
  begin(): number
  /** The newest token, without starting a run — for follow-up fetches inside the current session. */
  current(): number
  /** True while `token` is still the newest run. */
  isCurrent(token: number): boolean
}

export function createSessionGuard(): SessionGuard {
  let latest = 0
  return {
    begin: () => (latest += 1),
    current: () => latest,
    isCurrent: (token: number) => token === latest,
  }
}
