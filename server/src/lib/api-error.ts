export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export const invalidCredentialsError = () => new ApiError(401, "INVALID_CREDENTIALS", "Kullanıcı adı veya şifre hatalı.")
export const unauthorizedError = () => new ApiError(401, "UNAUTHENTICATED", "Oturum gerekli veya geçersiz.")
export const forbiddenError = () => new ApiError(403, "FORBIDDEN", "Bu işlem için yetkiniz yok.")
export const validationError = () => new ApiError(400, "VALIDATION_ERROR", "Geçersiz istek gövdesi.")
export const rateLimitedError = () => new ApiError(429, "RATE_LIMITED", "Çok fazla istek gönderildi. Lütfen kısa bir süre sonra tekrar deneyin.")
