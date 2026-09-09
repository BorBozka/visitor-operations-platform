/**
 * True when a Prisma error is a SQL Server write conflict we must translate into a generic
 * domain conflict — never leaking the engine/deadlock/serialization detail to the API.
 * P2002 unique violation, P2034 transaction write conflict / deadlock, plus the raw SQL Server
 * deadlock (1205) / lock-timeout (1222) messages Prisma sometimes surfaces verbatim.
 */
export function isWriteConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const code = "code" in error ? String((error as { code: unknown }).code) : ""
  if (code === "P2002" || code === "P2034") return true
  const message = "message" in error ? String((error as { message: unknown }).message).toLowerCase() : ""
  return /deadlock|serializ|write conflict|snapshot isolation|lock request time out|1205|1222/.test(message)
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs a serializable transaction, retrying a bounded number of times when SQL Server aborts it
 * as a deadlock victim / write conflict. Any non-conflict error (including a domain `ApiError`
 * raised inside the transaction) propagates immediately. After the retries are exhausted the
 * final write-conflict error is rethrown for the caller to map to a generic 409.
 */
export async function withWriteConflictRetry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!isWriteConflictError(error)) throw error
      lastError = error
      if (attempt < attempts - 1) await delay(10 + Math.floor(Math.random() * 25))
    }
  }
  throw lastError
}
