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
export const invalidRequestBodyError = () => new ApiError(400, "INVALID_REQUEST_BODY", "İstek gövdesi geçerli JSON formatında değil.")
export const rateLimitedError = () => new ApiError(429, "RATE_LIMITED", "Çok fazla istek gönderildi. Lütfen kısa bir süre sonra tekrar deneyin.")
export const payloadTooLargeError = () => new ApiError(413, "PAYLOAD_TOO_LARGE", "İstek gövdesi izin verilen boyuttan büyük.")
export const unsupportedMediaTypeError = () => new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "İstek içerik türü desteklenmiyor.")
