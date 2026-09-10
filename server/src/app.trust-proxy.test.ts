import { afterEach, describe, expect, it } from "vitest"

import { buildApp } from "./app.js"
import { InMemoryAuthRepository } from "./auth/testing/in-memory-auth-repository.js"
import { loadConfig } from "./config/env.js"
import type { EmailSender } from "./delivery/email-sender.js"
import type { VisitorOperationsRepository } from "./repositories/visitor-operations-repository.js"
import { hashToken } from "./modules/visitor-operations/service.js"
import type { MeetingDto, VisitDto } from "./modules/visitor-operations/types.js"

/**
 * Client IP resolution across the reverse proxy boundary (NEW-4).
 *
 * `request.ip` is what the login rate limiter keys on and what a public rule acceptance records,
 * so both depend on the same Fastify trust contract. `inject` drives that contract end to end:
 * `remoteAddress` becomes the socket peer proxy-addr validates, and `x-forwarded-for` is only
 * believed when that peer is trusted.
 */

const databaseUrl = "sqlserver://localhost:1433;database=visitor_operations;user=sa;password=placeholder;encrypt=true;trustServerCertificate=true"
const configFor = (environment: NodeJS.ProcessEnv) => loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test", ...environment })

const PROXY_IP = "198.51.100.9"
const CLIENT_IP = "203.0.113.7"
const OTHER_CLIENT_IP = "203.0.113.8"
const RAW_TOKEN = "public-invitation-token-value"

const at = "2026-01-01T00:00:00.000Z"
const meeting: MeetingDto = { id: "meeting-1", creatorEmployeeId: "employee-1", visitTypeId: "type-1", visitTypeName: "Toplantı", hostEmployeeName: "Maya Kara", hostCompanyId: "company-1", hostCompanyName: "BPLAS", facilityId: "facility-1", facilityName: "Merkez", plannedStart: at, plannedEnd: at, hasAdditionalRequirements: false, createdAt: at, updatedAt: at }
const activeRule = { id: "rule-1", version: 1, content: "Ziyaretçi kuralı", publishedAt: at, active: true }
const emailSender: EmailSender = { send: async () => undefined }

/** Records the IP the route hands the repository, which is what lands in the acceptance audit row. */
function recordingRepository(recorded: { ipAddress?: string }) {
  const visitor = { id: "visitor-1", firstName: "Ada", lastName: "Yılmaz", email: "ada@example.test", company: "Acme" }
  const visit = (): VisitDto => ({ id: "visit-1", meetingId: meeting.id, visitor, status: "PLANNED", invitationStatus: "SENT", createdAt: at, updatedAt: at, meeting })
  return {
    findPublicPreRegistration: async (tokenHash: string) => tokenHash === hashToken(RAW_TOKEN) ? { visit: visit(), activeRule } : null,
    acceptPublicRule: async (_tokenHash: string, ipAddress?: string) => {
      recorded.ipAddress = ipAddress
      return { id: "acceptance-1", ruleId: activeRule.id, ruleVersion: activeRule.version, acceptedAt: at, method: "INVITATION_LINK" as const, contentSnapshot: activeRule.content }
    },
  } as unknown as VisitorOperationsRepository
}

describe("client IP resolution behind a reverse proxy", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  async function acceptedIpFor(environment: NodeJS.ProcessEnv, remoteAddress: string) {
    const recorded: { ipAddress?: string } = {}
    const app = await buildApp(configFor(environment), {
      authRepository: new InMemoryAuthRepository(),
      visitorOperationsRepository: recordingRepository(recorded),
      emailSender,
    })
    apps.push(app)
    const response = await app.inject({
      method: "POST",
      url: `/api/public/invitations/${RAW_TOKEN}/rule-acceptances`,
      remoteAddress,
      headers: { "x-forwarded-for": CLIENT_IP },
    })
    expect(response.statusCode).toBe(200)
    return recorded.ipAddress
  }

  it("audits the socket peer and ignores a spoofable forwarding header while proxy trust is off", async () => {
    expect(await acceptedIpFor({}, PROXY_IP)).toBe(PROXY_IP)
    expect(await acceptedIpFor({ TRUST_PROXY: "false" }, PROXY_IP)).toBe(PROXY_IP)
  })

  it("audits the forwarded client IP once the request arrives from a trusted proxy", async () => {
    expect(await acceptedIpFor({ TRUST_PROXY: PROXY_IP }, PROXY_IP)).toBe(CLIENT_IP)
    expect(await acceptedIpFor({ TRUST_PROXY: `127.0.0.1, ${PROXY_IP}` }, PROXY_IP)).toBe(CLIENT_IP)
  })

  it("still audits the socket peer for a client that did not come through a trusted proxy", async () => {
    expect(await acceptedIpFor({ TRUST_PROXY: PROXY_IP }, "192.0.2.50")).toBe("192.0.2.50")
  })
})

describe("login rate limit isolation across the proxy boundary", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  async function loginApp(environment: NodeJS.ProcessEnv) {
    const app = await buildApp(configFor({ AUTH_RATE_LIMIT_MAX: "1", ...environment }), { authRepository: new InMemoryAuthRepository() })
    apps.push(app)
    return app
  }

  /**
   * The limiter's own `retry-after` header is the throttling signal here: an exceeded limit is
   * raised as an error and the app's error handler rewrites its status, so the header — not the
   * status code — says whether this request consumed an already-empty bucket.
   */
  async function throttled(app: Awaited<ReturnType<typeof buildApp>>, forwardedFor: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: PROXY_IP,
      headers: { "x-forwarded-for": forwardedFor },
      payload: { username: "calisan", password: "calisan" },
    })
    return response.headers["retry-after"] !== undefined
  }

  it("collapses every proxied client into the proxy's single bucket while proxy trust is off", async () => {
    const app = await loginApp({})

    expect(await throttled(app, CLIENT_IP)).toBe(false)
    expect(await throttled(app, OTHER_CLIENT_IP)).toBe(true)
  })

  it("gives each forwarded client its own bucket behind a trusted proxy", async () => {
    const app = await loginApp({ TRUST_PROXY: PROXY_IP })

    expect(await throttled(app, CLIENT_IP)).toBe(false)
    expect(await throttled(app, OTHER_CLIENT_IP)).toBe(false)
    expect(await throttled(app, CLIENT_IP)).toBe(true)
  })
})
