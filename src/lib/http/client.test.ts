import { afterEach, describe, expect, it, vi } from "vitest"

import { HttpClient, serializeQuery } from "@/lib/http/client"
import { ApiClientError, isApiClientError } from "@/lib/http/errors"

interface FetchCall {
  url: string
  init: RequestInit
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function makeClient(handler: (call: FetchCall) => Response | Promise<Response>, options?: { onUnauthorized?: (error: ApiClientError) => void }) {
  const calls: FetchCall[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return handler(call)
  }) as unknown as typeof fetch
  const client = new HttpClient({ baseUrl: "http://api.test/api/", fetchImpl, onUnauthorized: options?.onUnauthorized })
  return { client, calls, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("serializeQuery", () => {
  it("drops null/undefined and repeats array keys", () => {
    expect(serializeQuery({ a: 1, b: undefined, c: null, d: ["x", "y"], e: false })).toBe("?a=1&d=x&d=y&e=false")
  })

  it("returns an empty string when there is nothing to serialize", () => {
    expect(serializeQuery(undefined)).toBe("")
    expect(serializeQuery({ a: undefined })).toBe("")
  })
})

describe("HttpClient", () => {
  it("issues a GET with credentials, JSON Accept, query string, and no body", async () => {
    const { client, calls } = makeClient(() => jsonResponse(200, { ok: true }))
    const result = await client.get<{ ok: boolean }>("/visits", { query: { companyId: "all", facilityId: ["f1", "f2"] } })

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("http://api.test/api/visits?companyId=all&facilityId=f1&facilityId=f2")
    expect(calls[0].init.method).toBe("GET")
    expect(calls[0].init.credentials).toBe("include")
    expect(calls[0].init.body).toBeUndefined()
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe("application/json")
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBeUndefined()
  })

  it("sends a JSON body with Content-Type for POST and returns the parsed payload", async () => {
    const { client, calls } = makeClient(() => jsonResponse(201, { id: "m1" }))
    const result = await client.post<{ id: string }>("/meetings", { visitTypeId: "vt1" })

    expect(result).toEqual({ id: "m1" })
    expect(calls[0].init.method).toBe("POST")
    expect(calls[0].init.body).toBe(JSON.stringify({ visitTypeId: "vt1" }))
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
  })

  it("resolves undefined for a 204 response", async () => {
    const { client } = makeClient(() => new Response(null, { status: 204 }))
    await expect(client.delete<void>("/resource-assignments/a1")).resolves.toBeUndefined()
  })

  it("maps a backend error envelope to ApiClientError with the same code/message/status", async () => {
    const { client } = makeClient(() => jsonResponse(409, { error: { code: "ROOM_CONFLICT", message: "Oda çakışması var." } }))

    const error = await client.post("/meetings/m1/resource-assignments/room", { resourceId: "r1" }).catch((cause) => cause)
    expect(isApiClientError(error)).toBe(true)
    expect(error).toMatchObject({ code: "ROOM_CONFLICT", message: "Oda çakışması var.", status: 409 })
    expect((error as ApiClientError).isConflict).toBe(true)
  })

  it("carries the backend's throttle response through as status 429, which login classification keys on", async () => {
    const { client } = makeClient(() => jsonResponse(429, { error: { code: "RATE_LIMITED", message: "Çok fazla istek gönderildi. Lütfen kısa bir süre sonra tekrar deneyin." } }))

    const error = await client.post("/auth/login", { username: "calisan", password: "hatali" }).catch((cause) => cause)
    expect(isApiClientError(error)).toBe(true)
    expect((error as ApiClientError).status).toBe(429)
    expect((error as ApiClientError).code).toBe("RATE_LIMITED")
  })

  it("surfaces 401 through onUnauthorized before throwing", async () => {
    const onUnauthorized = vi.fn()
    const { client } = makeClient(() => jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Oturum gerekli." } }), { onUnauthorized })

    const error = await client.get("/visits").catch((cause) => cause)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect((error as ApiClientError).isUnauthorized).toBe(true)
  })

  it("hides server-fault detail behind a generic message", async () => {
    const { client } = makeClient(() => jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "SELECT * FROM Visit failed: deadlock", details: { sql: "..." } } }))

    const error = await client.get("/reports/visits").catch((cause) => cause) as ApiClientError
    expect(error.code).toBe("INTERNAL_ERROR")
    expect(error.message).not.toContain("SELECT")
    expect(error.details).toBeUndefined()
  })

  it("wraps a transport failure as a NETWORK_ERROR with status 0", async () => {
    const { client } = makeClient(() => {
      throw new TypeError("Failed to fetch")
    })

    const error = await client.get("/visits").catch((cause) => cause) as ApiClientError
    expect(error.code).toBe("NETWORK_ERROR")
    expect(error.status).toBe(0)
    expect(error.isNetworkError).toBe(true)
  })

  it("never retries a failed unsafe mutation", async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse(409, { error: { code: "CONFLICT", message: "çakışma" } }))
    await client.post("/transport-assignments", { purpose: "x" }).catch(() => undefined)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("lets an AbortError propagate untouched", async () => {
    const { client } = makeClient(() => {
      throw new DOMException("The operation was aborted.", "AbortError")
    })

    const error = await client.get("/visits").catch((cause) => cause)
    expect(isApiClientError(error)).toBe(false)
    expect((error as DOMException).name).toBe("AbortError")
  })
})
