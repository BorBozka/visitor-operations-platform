/**
 * Development/demo-only login shortcuts for the login screen.
 *
 * The four accounts below are the dedicated demo accounts provisioned by the development-only
 * seed (`server/prisma/seed-data.ts`, guarded by `NODE_ENV=development` + `DEMO_SEED_ENABLED=true`).
 * They are not production credentials and unlock nothing on their own: the buttons only fill the
 * login form, and authentication still goes through the normal `POST /api/auth/login` LOCAL flow.
 *
 * Rendering is gated on `VITE_DEMO_LOGIN=true`. The variable is unset in `.env.example` and in
 * production builds, so the buttons do not exist in a production bundle's rendered output.
 */
export interface DemoLoginAccount {
  label: string
  username: string
  password: string
}

export const demoLoginAccounts: readonly DemoLoginAccount[] = [
  { label: "Admin", username: "admin", password: "admin" },
  { label: "Yönetici", username: "yonetici", password: "yonetici" },
  { label: "Çalışan", username: "calisan", password: "calisan" },
  { label: "Güvenlik", username: "guvenlik", password: "guvenlik" },
] as const

/** Only the exact string `true` enables the demo buttons; anything else (including unset) disables them. */
export function isDemoLoginEnabled(value: unknown = import.meta.env.VITE_DEMO_LOGIN): boolean {
  return typeof value === "string" && value.trim() === "true"
}
