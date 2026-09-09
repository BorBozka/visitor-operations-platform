import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/http"
import { classifyLoginError } from "@/features/auth/login-error-messages"

describe("classifyLoginError", () => {
  it("classifies invalid credentials error", () => {
    const error = new ApiClientError({
      code: "INVALID_CREDENTIALS",
      message: "Kullanıcı adı veya şifre hatalı.",
      status: 401,
    })

    const classified = classifyLoginError(error)

    expect(classified.type).toBe("invalid_credentials")
    expect(classified.message).toBe("Kullanıcı adı veya şifre hatalı.")
  })

  it("classifies network error", () => {
    const error = new ApiClientError({
      code: "NETWORK_ERROR",
      message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.",
      status: 0,
    })

    const classified = classifyLoginError(error)

    expect(classified.type).toBe("network_error")
    expect(classified.message).toBe("Sunucuya ulaşılamıyor. Bağlantınızı kontrol edip tekrar deneyin.")
  })

  it("classifies rate limit error (429)", () => {
    const error = new ApiClientError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests",
      status: 429,
    })

    const classified = classifyLoginError(error)

    expect(classified.type).toBe("rate_limited")
    expect(classified.message).toBe("Çok fazla giriş denemesi yapıldı. Lütfen kısa bir süre sonra tekrar deneyin.")
  })

  it("classifies server error (5xx)", () => {
    const error = new ApiClientError({
      code: "INTERNAL_ERROR",
      message: "Sunucuda beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.",
      status: 500,
    })

    const classified = classifyLoginError(error)

    expect(classified.type).toBe("server_error")
    expect(classified.message).toBe("Sunucu tarafında geçici bir hata oluştu. Lütfen tekrar deneyin.")
  })

  it("classifies 503 service unavailable as server error", () => {
    const error = new ApiClientError({
      code: "SERVICE_UNAVAILABLE",
      message: "Service Unavailable",
      status: 503,
    })

    const classified = classifyLoginError(error)

    expect(classified.type).toBe("server_error")
    expect(classified.message).toBe("Sunucu tarafında geçici bir hata oluştu. Lütfen tekrar deneyin.")
  })

  it("classifies non-ApiClientError as unknown error", () => {
    const error = new Error("Some unexpected error")

    const classified = classifyLoginError(error)

    expect(classified.type).toBe("unknown_error")
    expect(classified.message).toBe("Giriş sırasında bir hata oluştu. Lütfen tekrar deneyin.")
  })

  it("classifies null/undefined as unknown error", () => {
    const classified1 = classifyLoginError(null)
    const classified2 = classifyLoginError(undefined)

    expect(classified1.type).toBe("unknown_error")
    expect(classified2.type).toBe("unknown_error")
  })

  it("does not expose username enumeration for other 401 errors", () => {
    const error = new ApiClientError({
      code: "UNAUTHENTICATED",
      message: "Session required or invalid",
      status: 401,
    })

    const classified = classifyLoginError(error)

    // Should not reveal "invalid credentials" for non-login auth failures
    expect(classified.type).toBe("unknown_error")
    expect(classified.message).toBe("Giriş sırasında bir hata oluştu. Lütfen tekrar deneyin.")
  })

  it("prioritizes network error over other status codes", () => {
    const error = new ApiClientError({
      code: "NETWORK_ERROR",
      message: "Network failure",
      status: 0,
    })

    const classified = classifyLoginError(error)

    expect(classified.type).toBe("network_error")
  })

  it("prioritizes rate limit (429) over server errors", () => {
    const error = new ApiClientError({
      code: "TOO_MANY_REQUESTS",
      message: "Rate limited",
      status: 429,
    })

    const classified = classifyLoginError(error)

    expect(classified.type).toBe("rate_limited")
  })
})
