import "dotenv/config"

import { PrismaClient } from "@prisma/client"

import { BootstrapInputError, readBootstrapInput } from "./bootstrap-contract.js"
import { BootstrapStateError, runProductionBootstrap } from "./bootstrap-runner.js"

/**
 * Explicit production bootstrap entrypoint — `pnpm --filter @visitor-management/api db:bootstrap`.
 *
 * Nothing invokes this on its own: not `db:seed`, not the server startup, not the API. It runs
 * only when an operator runs the command with a complete `BOOTSTRAP_*` environment.
 */
async function bootstrap(): Promise<void> {
  // Read the operator input before opening a database connection, so a missing or malformed
  // BOOTSTRAP_* value is reported as such instead of as a connection failure.
  const input = readBootstrapInput(process.env)
  const prisma = new PrismaClient()
  try {
    const outcome = await runProductionBootstrap(prisma, input)
    console.info(outcome.status === "CREATED"
      ? `Production bootstrap tamamlandı. Şirket: ${outcome.root.companyId}, tesis: ${outcome.root.facilityId}, Admin kullanıcı: ${outcome.root.adminUserId}. Admin artık normal LOCAL giriş akışıyla oturum açabilir.`
      : `Veritabanı zaten bootstrap edilmiş; hiçbir değişiklik yapılmadı. Şirket: ${outcome.root.companyId}, tesis: ${outcome.root.facilityId}, Admin kullanıcı: ${outcome.root.adminUserId}.`)
  } finally {
    await prisma.$disconnect()
  }
}

try {
  await bootstrap()
} catch (error) {
  // Both carry operator-facing, credential-free messages; anything else is a genuine failure and
  // keeps its original stack.
  if (!(error instanceof BootstrapInputError) && !(error instanceof BootstrapStateError)) throw error
  console.error(error.message)
  process.exitCode = 1
}
