# Visitor Management System — Technical Stack

## Frontend

- React 19 and TypeScript
- Vite
- Tailwind CSS and shadcn/ui primitives
- React Router
- React Hook Form and Zod
- date-fns
- Recharts
- write-excel-file, jsPDF / jspdf-autotable, html2canvas, and native CSV downloads

The frontend is a production-oriented single-page application. Runtime domain access goes
through `Http*` service adapters and the shared HTTP client; there is no runtime mock fallback.
Unit/component tests use focused local fixtures, fakes, or stubs rather than an alternate
application runtime composition.

## Backend

- Node.js and TypeScript
- Fastify
- Prisma ORM 6.19.3
- Microsoft SQL Server
- Argon2id password hashing
- Cryptographically random opaque sessions stored server-side; only the session token is sent in
  an HttpOnly cookie
- Nodemailer behind a log/SMTP delivery boundary

Production code follows `route -> service/use case -> repository -> Prisma`. HTTP routes do not
query Prisma directly. Authentication is LOCAL-only. Active Directory integration is outside the
implemented scope.

## Data and security boundaries

- Prisma migrations under `server/prisma/migrations` are the canonical schema history.
- Authorization scope is derived from the authenticated server-side session and enforced in the
  backend for reads and mutations.
- Invitation and session tokens are opaque; only hashes are persisted.
- Email delivery defaults to a non-delivering log adapter and uses SMTP only when explicitly
  configured through environment variables.
- Visitor cards are application-tracked physical cards, not access-control hardware credentials.

## Testing and validation

- Vitest for frontend and backend unit/component tests
- Real MSSQL integration suites for repository, transaction, and authorization behavior
- Playwright for browser E2E over the real frontend/backend/MSSQL stack
- ESLint and TypeScript project checks
- Prisma validate, generate, and migrate status checks

## Build and deployment shape

- `pnpm build` builds the frontend into root `dist/`.
- `pnpm build:api` compiles backend production sources into `server/dist/`.
- `pnpm start:api` runs the compiled backend with Node.js.
- `prisma migrate dev` is development-only; staging/production uses `prisma migrate deploy`.

The current session cookie uses `SameSite=lax`. A same-site frontend/backend production topology
is therefore preferred. A cross-site topology requires an explicit cookie and CORS security
review; the defaults must not be loosened incidentally.

## Dependency discipline

Add a dependency only for a current requirement that cannot reasonably be met by the existing
stack. Keep frontend domain access behind service adapters and backend persistence behind
repositories. Do not introduce a second state, API, ORM, or validation architecture without an
approved requirement.
