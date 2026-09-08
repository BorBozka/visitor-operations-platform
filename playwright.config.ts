import { defineConfig, devices } from "@playwright/test"

/**
 * Browser E2E against the real stack: Vite dev server + Fastify backend + local MSSQL with the
 * controlled two-company integration seed. Sessions are real HttpOnly cookies. Run with:
 *
 *   pnpm db:migrate && pnpm db:seed         # once, controlled seed
 *   pnpm e2e                                # starts both servers and runs the suite
 *
 * The backend must reach MSSQL via server/.env (DATABASE_URL) and use EMAIL_DELIVERY_MODE=log —
 * no real SMTP is contacted.
 */
const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:5173"
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001"

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // The Vite dev server recompiles on demand; a first hit after HMR can be slow, so allow one retry.
  retries: 1,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: FRONTEND_URL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @visitor-management/api start",
      url: `${API_URL}/api/health`,
      reuseExistingServer: true,
      timeout: 90_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { AUTH_RATE_LIMIT_MAX: "500", EMAIL_DELIVERY_MODE: "log" },
    },
    {
      // A production build served by `vite preview` — no on-demand recompilation mid-suite, so
      // navigations stay fast and deterministic. VITE_API_BASE_URL falls back to :3001/api.
      command: "pnpm build && pnpm exec vite preview --port 5173 --strictPort",
      url: FRONTEND_URL,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
})
