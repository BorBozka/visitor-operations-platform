import { describe, expect, it } from "vitest"

import { getDemoSeedUsers, shouldSeedDemoData } from "../../prisma/seed-data.js"
import { ConfigError, loadConfig } from "./env.js"

describe("server configuration", () => {
  const databaseUrl = "sqlserver://localhost:1433;database=visitor_operations;user=sa;password=not-a-secret;encrypt=true;trustServerCertificate=true"
  const smtpConfig = {
    EMAIL_DELIVERY_MODE: "smtp",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "user",
    SMTP_PASSWORD: "test-only-password",
    MAIL_FROM_ADDRESS: "no-reply@example.test",
    MAIL_FROM_NAME: "Visitor",
  }

  it("fails clearly when DATABASE_URL is missing or not a SQL Server URL", () => {
    expect(() => loadConfig({ WEB_ORIGIN: "http://localhost:5173" })).toThrow(ConfigError)
    expect(() => loadConfig({ DATABASE_URL: "postgresql://localhost/test" })).toThrow("Prisma SQL Server")
  })

  it("parses the documented development configuration", () => {
    expect(loadConfig({
      API_PORT: "3001",
      WEB_ORIGIN: "http://localhost:5173",
      DATABASE_URL: "sqlserver://localhost:1433;database=visitor_operations;user=sa;password=not-a-secret;encrypt=true;trustServerCertificate=true",
      SESSION_COOKIE_NAME: "bplas_session",
      SESSION_TTL_HOURS: "8",
      NODE_ENV: "development",
      DEMO_SEED_ENABLED: "true",
    })).toMatchObject({ apiPort: 3001, sessionTtlHours: 8, demoSeedEnabled: true })
  })

  it("keeps log delivery as the development and test default", () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl }).emailDelivery).toMatchObject({ mode: "log" })
    expect(loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "development", EMAIL_DELIVERY_MODE: "log" }).emailDelivery).toMatchObject({ mode: "log" })
    expect(loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test", EMAIL_DELIVERY_MODE: "log" }).emailDelivery).toMatchObject({ mode: "log" })
  })

  it("fails closed before startup when production does not select SMTP", () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "production" })).toThrow(ConfigError)
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "production" })).toThrow("EMAIL_DELIVERY_MODE=smtp zorunludur")
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "production", EMAIL_DELIVERY_MODE: "log" })).toThrow("EMAIL_DELIVERY_MODE=smtp zorunludur")
  })

  it("keeps the existing SMTP required-field validation and accepts complete production SMTP", () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "production", EMAIL_DELIVERY_MODE: "smtp" })).toThrow("SMTP_HOST")
    expect(loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "production", ...smtpConfig }).emailDelivery).toMatchObject({
      mode: "smtp", smtp: { host: "smtp.example.test", port: 465, secure: true },
    })
  })
})

describe("development demo seed definitions", () => {
  it("exposes the demo credentials only with the explicit development flag", () => {
    expect(shouldSeedDemoData({ NODE_ENV: "production", DEMO_SEED_ENABLED: "true" })).toBe(false)
    expect(getDemoSeedUsers({ NODE_ENV: "production", DEMO_SEED_ENABLED: "true" })).toEqual([])
    expect(getDemoSeedUsers({ NODE_ENV: "development", DEMO_SEED_ENABLED: "false" })).toEqual([])
    expect(getDemoSeedUsers({ NODE_ENV: "development", DEMO_SEED_ENABLED: "true" }).map((user) => `${user.username}/${user.password}`)).toEqual([
      "calisan/calisan",
      "yonetici/yonetici",
      "admin/admin",
      "guvenlik/guvenlik",
      "calisan2/calisan2",
      "yonetici2/yonetici2",
    ])
  })
})
