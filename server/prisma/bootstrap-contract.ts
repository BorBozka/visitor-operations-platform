import { z } from "zod"

import { normalizeIdentity } from "../src/lib/names.js"
import { normalizeOrganizationName } from "../src/modules/organization/types.js"

/**
 * Input contract and safe-state rules for the production bootstrap
 * (`pnpm --filter @visitor-management/api db:bootstrap`).
 *
 * This module is deliberately database-free: it decides *whether* a bootstrap may run and *what*
 * it would create, so both halves are unit-testable without SQL Server. The writes themselves
 * live in `bootstrap-runner.ts`, the operator entrypoint in `bootstrap.ts`.
 *
 * It has nothing to do with the development demo seed (`seed.ts` / `seed-data.ts`): no demo user,
 * no demo password, no development reference data is reachable from here.
 */

export interface BootstrapEnvironment {
  BOOTSTRAP_ENABLED?: string
  BOOTSTRAP_COMPANY_NAME?: string
  BOOTSTRAP_FACILITY_NAME?: string
  BOOTSTRAP_ADMIN_USERNAME?: string
  BOOTSTRAP_ADMIN_FULL_NAME?: string
  BOOTSTRAP_ADMIN_EMAIL?: string
  BOOTSTRAP_ADMIN_PASSWORD?: string
}

export class BootstrapInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BootstrapInputError"
  }
}

export interface BootstrapInput {
  company: { name: string; nameNormalized: string }
  facility: { name: string; nameNormalized: string }
  admin: { username: string; usernameNormalized: string; fullName: string; email: string; emailNormalized: string }
  /**
   * Plain text only in memory and only until `hashPassword` runs. It is never persisted, never
   * logged, and never placed in an error message — Zod issues carry the field path, not its value.
   */
  adminPassword: string
}

/**
 * The bootstrap is fail-closed: every value is required, none has a default, and the operator
 * must additionally acknowledge the run with `BOOTSTRAP_ENABLED=true` — mirroring the
 * `DEMO_SEED_ENABLED` convention so an accidental invocation with a half-filled environment
 * cannot write to a production database.
 *
 * The password rule is the one the running application already enforces for local accounts
 * (`AdminService.createUser` / `AuthService.changePassword`): at least eight characters. The
 * bootstrap Admin is an ordinary LOCAL account, so it must not be held to a different bar.
 */
const environmentSchema = z.object({
  BOOTSTRAP_ENABLED: z.literal("true", { errorMap: () => ({ message: "bootstrap yalnız BOOTSTRAP_ENABLED=true ile çalışır." }) }),
  BOOTSTRAP_COMPANY_NAME: z.string().trim().min(1, "zorunludur.").max(200, "en fazla 200 karakter olabilir."),
  BOOTSTRAP_FACILITY_NAME: z.string().trim().min(1, "zorunludur.").max(200, "en fazla 200 karakter olabilir."),
  BOOTSTRAP_ADMIN_USERNAME: z.string().trim().min(1, "zorunludur.").max(100, "en fazla 100 karakter olabilir."),
  BOOTSTRAP_ADMIN_FULL_NAME: z.string().trim().min(1, "zorunludur.").max(200, "en fazla 200 karakter olabilir."),
  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().min(1, "zorunludur.").max(320, "en fazla 320 karakter olabilir.").email("geçerli bir e-posta adresi olmalıdır."),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8, "en az sekiz karakter olmalıdır."),
})

export function readBootstrapInput(environment: BootstrapEnvironment): BootstrapInput {
  const parsed = environmentSchema.safeParse(environment)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    throw new BootstrapInputError(`Geçersiz bootstrap yapılandırması: ${issues}`)
  }
  const data = parsed.data
  return {
    company: { name: data.BOOTSTRAP_COMPANY_NAME, nameNormalized: normalizeOrganizationName(data.BOOTSTRAP_COMPANY_NAME) },
    facility: { name: data.BOOTSTRAP_FACILITY_NAME, nameNormalized: normalizeOrganizationName(data.BOOTSTRAP_FACILITY_NAME) },
    admin: {
      username: data.BOOTSTRAP_ADMIN_USERNAME,
      usernameNormalized: normalizeIdentity(data.BOOTSTRAP_ADMIN_USERNAME),
      fullName: data.BOOTSTRAP_ADMIN_FULL_NAME,
      email: data.BOOTSTRAP_ADMIN_EMAIL,
      emailNormalized: normalizeIdentity(data.BOOTSTRAP_ADMIN_EMAIL),
    },
    adminPassword: data.BOOTSTRAP_ADMIN_PASSWORD,
  }
}

export interface BootstrapDatabaseState {
  /** Every user row, not just Admins: "no user at all" is what makes a database fresh. */
  userCount: number
  companies: { id: string; nameNormalized: string; facilities: { id: string; nameNormalized: string }[] }[]
  adminUsers: { id: string; usernameNormalized: string; active: boolean; authenticationSource: string; companyScopeIds: string[] }[]
}

export interface BootstrapRoot {
  companyId: string
  facilityId: string
  adminUserId: string
}

export type BootstrapDecision =
  | { kind: "CREATE" }
  | { kind: "ALREADY_BOOTSTRAPPED"; root: BootstrapRoot }
  | { kind: "REFUSE"; reason: string }

const refuse = (reason: string): BootstrapDecision => ({ kind: "REFUSE", reason })

/**
 * The three states a bootstrap may observe, and nothing in between:
 *
 * - **Fresh** — no company and no user at all. The administrative root is created.
 * - **Already bootstrapped** — exactly the root this same input would have created is present and
 *   intact. Nothing is written: no duplicate, no silent password rotation, no repair.
 * - **Anything else** — refused. A database that already holds an organization graph (another
 *   company, another Admin, a company without its Admin, a differently named root) is one where
 *   only an operator can decide what "correct" means, so the bootstrap must not inject rows into
 *   it on a guess.
 *
 * Reasons describe the *shape* of the mismatch. They never echo persisted names or credentials.
 */
export function decideBootstrap(state: BootstrapDatabaseState, input: BootstrapInput): BootstrapDecision {
  if (state.companies.length === 0 && state.userCount === 0) return { kind: "CREATE" }

  if (state.companies.length !== 1) {
    return refuse(state.companies.length === 0
      ? "veritabanında kullanıcı kayıtları var fakat beklenen bootstrap şirketi yok."
      : "veritabanında birden fazla şirket var; hangisinin bootstrap kökü olduğu belirsiz.")
  }
  const [company] = state.companies
  if (company.nameNormalized !== input.company.nameNormalized) return refuse("veritabanındaki mevcut şirket, BOOTSTRAP_COMPANY_NAME değeriyle eşleşmiyor.")

  const facility = company.facilities.find((candidate) => candidate.nameNormalized === input.facility.nameNormalized)
  if (!facility) return refuse("mevcut şirket altında BOOTSTRAP_FACILITY_NAME ile eşleşen bir tesis yok.")

  if (state.adminUsers.length !== 1) {
    return refuse(state.adminUsers.length === 0
      ? "veritabanında organizasyon kayıtları var fakat hiç Admin kullanıcı yok."
      : "veritabanında birden fazla Admin kullanıcı var; bootstrap Admin'i belirsiz.")
  }
  const [admin] = state.adminUsers
  if (admin.usernameNormalized !== input.admin.usernameNormalized) return refuse("mevcut Admin kullanıcı adı, BOOTSTRAP_ADMIN_USERNAME değeriyle eşleşmiyor.")
  if (!admin.active || admin.authenticationSource !== "LOCAL") return refuse("mevcut Admin kullanıcı aktif bir LOCAL hesap değil.")
  if (!admin.companyScopeIds.includes(company.id)) return refuse("mevcut Admin kullanıcının yetki kapsamı bootstrap şirketini içermiyor.")

  return { kind: "ALREADY_BOOTSTRAPPED", root: { companyId: company.id, facilityId: facility.id, adminUserId: admin.id } }
}
