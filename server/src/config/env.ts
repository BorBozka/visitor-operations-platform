import { z } from "zod"

const booleanFromEnvironment = z.enum(["true", "false"]).transform((value) => value === "true")

const emailDeliveryModeSchema = z.enum(["log", "smtp"])

const environmentSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL zorunludur.").regex(/^sqlserver:\/\//, "DATABASE_URL Prisma SQL Server formatında olmalıdır."),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/, "SESSION_COOKIE_NAME yalnız güvenli cookie karakterleri içermelidir.").default("bplas_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(8),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Login attempts per minute per IP. The default protects real deployments; an E2E run raises
  // it so its many rapid seeded logins are not throttled.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(10),
  DEMO_SEED_ENABLED: booleanFromEnvironment.default("false"),
  EMAIL_DELIVERY_MODE: emailDeliveryModeSchema.default("log"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SMTP_SECURE: booleanFromEnvironment.optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM_ADDRESS: z.string().email().optional(),
  MAIL_FROM_NAME: z.string().min(1).max(200).optional(),
})

export type EmailDeliveryConfig =
  | { mode: "log"; fromAddress: string; fromName: string }
  | { mode: "smtp"; fromAddress: string; fromName: string; smtp: { host: string; port: number; secure: boolean; user: string; password: string } }

export type AppConfig = {
  apiPort: number
  webOrigin: string
  databaseUrl: string
  sessionCookieName: string
  sessionTtlHours: number
  nodeEnv: "development" | "test" | "production"
  authRateLimitMax: number
  demoSeedEnabled: boolean
  emailDelivery: EmailDeliveryConfig
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    throw new ConfigError(`Geçersiz server yapılandırması: ${issues}`)
  }

  const smtpFields = [
    ["SMTP_HOST", parsed.data.SMTP_HOST],
    ["SMTP_PORT", parsed.data.SMTP_PORT],
    ["SMTP_SECURE", parsed.data.SMTP_SECURE],
    ["SMTP_USER", parsed.data.SMTP_USER],
    ["SMTP_PASSWORD", parsed.data.SMTP_PASSWORD],
    ["MAIL_FROM_ADDRESS", parsed.data.MAIL_FROM_ADDRESS],
    ["MAIL_FROM_NAME", parsed.data.MAIL_FROM_NAME],
  ] as const
  if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_DELIVERY_MODE !== "smtp") {
    throw new ConfigError("Geçersiz server yapılandırması: production ortamında EMAIL_DELIVERY_MODE=smtp zorunludur.")
  }
  if (parsed.data.EMAIL_DELIVERY_MODE === "smtp") {
    const missing = smtpFields.filter(([, value]) => value === undefined || value === "").map(([name]) => name)
    if (missing.length > 0) throw new ConfigError(`Geçersiz server yapılandırması: EMAIL_DELIVERY_MODE=smtp için ${missing.join(", ")} zorunludur.`)
  }

  const emailDelivery: EmailDeliveryConfig = parsed.data.EMAIL_DELIVERY_MODE === "smtp"
    ? {
        mode: "smtp",
        fromAddress: parsed.data.MAIL_FROM_ADDRESS!,
        fromName: parsed.data.MAIL_FROM_NAME!,
        smtp: {
          host: parsed.data.SMTP_HOST!,
          port: parsed.data.SMTP_PORT!,
          secure: parsed.data.SMTP_SECURE!,
          user: parsed.data.SMTP_USER!,
          password: parsed.data.SMTP_PASSWORD!,
        },
      }
    : {
        mode: "log",
        fromAddress: parsed.data.MAIL_FROM_ADDRESS ?? "no-reply@example.test",
        fromName: parsed.data.MAIL_FROM_NAME ?? "Ziyaretçi Operasyonları",
      }

  return {
    apiPort: parsed.data.API_PORT,
    webOrigin: parsed.data.WEB_ORIGIN,
    databaseUrl: parsed.data.DATABASE_URL,
    sessionCookieName: parsed.data.SESSION_COOKIE_NAME,
    sessionTtlHours: parsed.data.SESSION_TTL_HOURS,
    nodeEnv: parsed.data.NODE_ENV,
    authRateLimitMax: parsed.data.AUTH_RATE_LIMIT_MAX,
    demoSeedEnabled: parsed.data.DEMO_SEED_ENABLED,
    emailDelivery,
  }
}
