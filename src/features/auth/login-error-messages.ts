import { isApiClientError } from "@/lib/http"

export type LoginErrorType = "invalid_credentials" | "rate_limited" | "network_error" | "server_error" | "unknown_error"

export interface ClassifiedLoginError {
  type: LoginErrorType
  message: string
}

export function classifyLoginError(error: unknown): ClassifiedLoginError {
  if (!isApiClientError(error)) {
    return {
      type: "unknown_error",
      message: "Giriş sırasında bir hata oluştu. Lütfen tekrar deneyin.",
    }
  }

  // Network error: request never reached the server
  if (error.isNetworkError) {
    return {
      type: "network_error",
      message: "Sunucuya ulaşılamıyor. Bağlantınızı kontrol edip tekrar deneyin.",
    }
  }

  // Rate limit: too many login attempts
  if (error.status === 429) {
    return {
      type: "rate_limited",
      message: "Çok fazla giriş denemesi yapıldı. Lütfen kısa bir süre sonra tekrar deneyin.",
    }
  }

  // Server error: 5xx responses
  if (error.status >= 500) {
    return {
      type: "server_error",
      message: "Sunucu tarafında geçici bir hata oluştu. Lütfen tekrar deneyin.",
    }
  }

  // Invalid credentials: authentication failed
  if (error.code === "INVALID_CREDENTIALS") {
    return {
      type: "invalid_credentials",
      message: "Kullanıcı adı veya şifre hatalı.",
    }
  }

  // Fallback for other errors
  return {
    type: "unknown_error",
    message: "Giriş sırasında bir hata oluştu. Lütfen tekrar deneyin.",
  }
}
