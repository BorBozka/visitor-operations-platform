import { afterEach, describe, expect, it } from "vitest"

import { buildApp } from "./app.js"
import { hashPassword } from "./auth/password.js"
import { InMemoryAuthRepository } from "./auth/testing/in-memory-auth-repository.js"
import { loadConfig } from "./config/env.js"
import { ApiError } from "./lib/api-error.js"

/**
 * The global error handler's HTTP contract (NEW-11, NEW-12).
 *
 * `@fastify/rate-limit` writes its `retry-after`/`x-ratelimit-*` headers onto the reply and then
 * throws a plain `Error` carrying only `statusCode: 429`. Because that error is not an `ApiError`,
 * the handler used to sanitize it into a generic `500 INTERNAL_ERROR`, leaving the headers correct
 * but the status/body wrong — so the frontend's `status === 429` classification never fired at
 * runtime. The handler now maps 429 explicitly while still collapsing genuinely unexpected
 * exceptions into the generic 500 envelope.
 *
 * Fastify's own body-parser and content-type errors (NEW-12) hit the same handler before any route
 * or Zod schema runs, carrying a real client status the app used to discard. Only the named
 * framework codes below are mapped, and only when the status they carry matches the one pinned for
 * that code — an arbitrary `statusCode` on an exception is still no contract.
 */

const databaseUrl = "sqlserver://localhost:1433;database=visitor_operations;user=sa;password=placeholder;encrypt=true;trustServerCertificate=true"
const configFor = (environment: NodeJS.ProcessEnv = {}) => loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test", ...environment })

const attemptLogin = (app: Awaited<ReturnType<typeof buildApp>>) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "calisan", password: "wrong-password" } })

describe("global error handler", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  async function loginApp(environment: NodeJS.ProcessEnv = {}) {
    const repository = new InMemoryAuthRepository([{
      id: "user-1",
      username: "calisan",
      fullName: "Maya Kara",
      role: "EMPLOYEE",
      authenticationSource: "LOCAL",
      active: true,
      passwordHash: await hashPassword("calisan"),
      authorizationScope: { companyIds: ["bplas"], facilityIds: [], securityGateIds: [] },
      employeeId: "maya-kara",
    }])
    const app = await buildApp(configFor(environment), { authRepository: repository })
    apps.push(app)
    return app
  }

  it("keeps the credential-failure contract for attempts inside the limit", async () => {
    const app = await loginApp({ AUTH_RATE_LIMIT_MAX: "2" })

    const first = await attemptLogin(app)
    expect(first.statusCode).toBe(401)
    expect(first.json()).toEqual({ error: { code: "INVALID_CREDENTIALS", message: "Kullanıcı adı veya şifre hatalı." } })
    expect(first.headers["retry-after"]).toBeUndefined()

    expect((await attemptLogin(app)).statusCode).toBe(401)
  })

  it("answers an exceeded login rate limit with 429 and a safe body", async () => {
    const app = await loginApp({ AUTH_RATE_LIMIT_MAX: "1" })

    expect((await attemptLogin(app)).statusCode).toBe(401)
    const throttled = await attemptLogin(app)

    expect(throttled.statusCode).toBe(429)
    expect(throttled.json()).toEqual({ error: { code: "RATE_LIMITED", message: "Çok fazla istek gönderildi. Lütfen kısa bir süre sonra tekrar deneyin." } })
  })

  it("leaks no plugin, stack or exception detail in the throttled body", async () => {
    const app = await loginApp({ AUTH_RATE_LIMIT_MAX: "1" })

    await attemptLogin(app)
    const body = (await attemptLogin(app)).body

    expect(body).not.toContain("Rate limit exceeded")
    expect(body).not.toContain("retry in")
    expect(body).not.toContain("stack")
    expect(body).not.toContain("fastify")
    expect(body).not.toContain("node_modules")
  })

  it("preserves the rate-limit plugin's own headers on the throttled response", async () => {
    const app = await loginApp({ AUTH_RATE_LIMIT_MAX: "1" })

    await attemptLogin(app)
    const throttled = await attemptLogin(app)

    expect(throttled.statusCode).toBe(429)
    expect(throttled.headers["retry-after"]).toBeDefined()
    expect(throttled.headers["x-ratelimit-limit"]).toBe("1")
    expect(throttled.headers["x-ratelimit-remaining"]).toBe("0")
    expect(throttled.headers["x-ratelimit-reset"]).toBeDefined()
  })

  it("still collapses an unexpected application exception into the generic 500 envelope", async () => {
    const app = await buildApp(configFor(), { authRepository: new InMemoryAuthRepository() })
    apps.push(app)
    app.get("/api/testing/boom", async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:1433 — sa@visitor_operations")
    })

    const response = await app.inject({ method: "GET", url: "/api/testing/boom" })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Beklenmeyen bir sunucu hatası oluştu." } })
    expect(response.body).not.toContain("ECONNREFUSED")
    expect(response.body).not.toContain("visitor_operations")
  })

  it("still sanitizes a non-ApiError that carries an unrelated status code", async () => {
    const app = await buildApp(configFor(), { authRepository: new InMemoryAuthRepository() })
    apps.push(app)
    app.get("/api/testing/teapot", async () => {
      const error = new Error("internal teapot detail") as Error & { statusCode: number }
      error.statusCode = 418
      throw error
    })

    const response = await app.inject({ method: "GET", url: "/api/testing/teapot" })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Beklenmeyen bir sunucu hatası oluştu." } })
  })

  it("still sanitizes an error that borrows a framework code but not its status", async () => {
    const app = await buildApp(configFor(), { authRepository: new InMemoryAuthRepository() })
    apps.push(app)
    app.get("/api/testing/spoofed", async () => {
      const error = new Error("internal detail") as Error & { code: string; statusCode: number }
      error.code = "FST_ERR_CTP_INVALID_MEDIA_TYPE"
      error.statusCode = 500
      throw error
    })

    const response = await app.inject({ method: "GET", url: "/api/testing/spoofed" })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Beklenmeyen bir sunucu hatası oluştu." } })
  })

  it("answers an unsupported request content type with 415 and a safe body", async () => {
    const app = await loginApp()

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/xml" },
      payload: "<login><username>calisan</username></login>",
    })

    expect(response.statusCode).toBe(415)
    expect(response.json()).toEqual({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "İstek içerik türü desteklenmiyor." } })
    expect(response.body).not.toContain("FST_ERR")
    expect(response.body).not.toContain("application/xml")
    expect(response.body).not.toContain("stack")
    expect(response.body).not.toContain("fastify")
    expect(response.body).not.toContain("node_modules")
  })

  it("answers a request body over the body limit with 413 and a safe body", async () => {
    const app = await loginApp()

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ username: "calisan", password: "x".repeat(1_048_576) }),
    })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ error: { code: "PAYLOAD_TOO_LARGE", message: "İstek gövdesi izin verilen boyuttan büyük." } })
    expect(response.body).not.toContain("FST_ERR")
    expect(response.body).not.toContain("xxxx")
    expect(response.body).not.toContain("stack")
    expect(response.body).not.toContain("fastify")
    expect(response.body).not.toContain("node_modules")
  })

  it("keeps forwarding the application's own ApiError statuses untouched", async () => {
    const app = await buildApp(configFor(), { authRepository: new InMemoryAuthRepository() })
    apps.push(app)
    app.get("/api/testing/conflict", async () => { throw new ApiError(409, "CONFLICT", "Çakışma." ) })

    const response = await app.inject({ method: "GET", url: "/api/testing/conflict" })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: { code: "CONFLICT", message: "Çakışma." } })
  })
})
