# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

## Project

A role-focused full-stack visitor management system (Turkish UI) for multi-company,
multi-facility operations — visit planning/timeline, Security operations, Manager/Admin
workspaces, resource/fleet/goods-movement planning, and reporting. The React frontend uses
`Http*` adapters to the Fastify/Prisma/MSSQL backend; there is no runtime mock fallback. See
`README.md` for a feature overview.

**Authoritative docs — read before non-trivial changes:**
- `AGENTS.md` — stack constraints, phased-development rules, business rules that must not be
  reinterpreted, and the required phase-completion report format. Read this first.
- `docs/PRODUCT_SPEC.md` — business behavior.
- `docs/UI_SPEC.md` — interface direction.
- `docs/TECH_STACK.md` — technology choices and dependency discipline.
- `docs/DEVELOPMENT_PLAN.md` — final phase status and architectural contracts.

## Commands

Package manager is **pnpm** (`pnpm-lock.yaml` is canonical; there is no `package-lock.json`).

```bash
pnpm install              # install deps
pnpm dev                  # Vite dev server
pnpm build                # tsc -b && vite build
pnpm build:api            # compile backend production sources to server/dist
pnpm start:api            # run the compiled backend with Node.js
pnpm typecheck             # tsc -b --pretty false (no emit)
pnpm typecheck:api         # backend TypeScript check
pnpm lint                  # eslint .
pnpm test                  # vitest run (whole suite)
pnpm test:api              # backend unit suite
pnpm test -- <name-or-path> # vitest run, filtered (e.g. `pnpm test -- visits-report-utils`)
```

After any dependency change in `package.json`, run `pnpm install --lockfile-only` (or a normal
install) so `pnpm-lock.yaml` stays in sync — Vercel deploys with `pnpm install --frozen-lockfile`
and will hard-fail the build if the lockfile drifts (this has happened before, see PR history).

Vitest has no separate config file and no jsdom/`@testing-library` setup — see Testing below.

## Architecture

### Layering

- `src/domain/*` — plain TypeScript types shared across the app (`visits.ts`, `resources.ts`,
  `transport-assignments.ts`, `goods-movements.ts`). No logic beyond small label/derivation
  helpers (e.g. `getGoodsMovementDisplayStatus`).
- `src/services/*` — domain service interfaces plus `http/Http*` production adapters.
  `src/services/index.ts` wires only HTTP adapters. Unit/component tests use focused local
  fixtures, fakes, or stubs; there is no alternate application runtime composition.
- `src/features/<domain>/*` — UI + feature-local logic (filtering, sorting, pagination,
  export), grouped by domain: `visits`, `manager`, `resources`, `transport`, `goods`, `reports`.
- `src/components/app-shell/*` — Employee, Manager/Admin, and Security route shells (see Routing).
- `src/components/ui/*` — shadcn/ui primitives (`style: new-york`, see `components.json`),
  adapted to the app's compact density.
- `src/lib/*` — cross-domain utilities with no domain dependency: `sort.ts` (generic 3-state
  sort toggle), `pagination.ts` (generic paginate/page-count), `date.ts` (see Timestamps below),
  `meeting-lifecycle.ts`, `utils.ts` (`cn`).
- Path alias `@/` → `src/` (see `vite.config.ts`).

### Meeting vs. Visit — the core domain model

A **Meeting** is one planned event (host, company, facility, time window, one record). Each
individual visitor invited to it gets a separate **VisitRecord** (check-in/out, status,
invitation state). The **`Visit`** type used almost everywhere in the UI (`domain/visits.ts`)
is `VisitRecord & MeetingDetails` — a flattened read-model the service layer projects by
joining a VisitRecord with its parent Meeting's details, purely for convenience so screens don't
need a second fetch. When changing Meeting-level fields (time, host, company/facility), remember
every Visit sharing that Meeting reflects the change; don't treat `Visit` fields as independently
editable per-visitor unless they belong to `VisitRecord` (check-in/out, status, invitation).
Meeting lifecycle rules (extend/close, auto-close on last checkout) live in
`src/lib/meeting-lifecycle.ts` and `VisitService`'s lifecycle methods — read the JSDoc on
`visit-service.ts` before touching close/extend/checkout flows.

### Routing and shells

`src/app/App.tsx` defines role route trees under three shells:
- `EmployeeShell` (`src/components/app-shell/EmployeeShell.tsx`) — `/employee/*`.
- `ManagerShell` (`src/components/app-shell/ManagerShell.tsx`) — `/manager/*` and `/admin/*`, holds the
  collapsible sidebar, company/facility scope selector, notifications, and the per-minute clock
  (`manager-clock.ts`) driving live dashboard indicators.
- `SecurityShell` (`src/components/app-shell/SecurityShell.tsx`) — `/security/*` operations.

All route pages are lazy-loaded (`React.lazy`). `useVisits()` (`features/visits/visit-context.tsx`)
is the shared context providing `meetings`, `visits`, `referenceData`, load/reload state to
everything under both shells. `useManagerRefresh()` (`features/manager/manager-refresh-context.ts`)
carries the Manager area's company/facility scope and refresh state separately.

### Reports feature

`src/features/reports/` is a tabbed page (`Ziyaretler` / `Araç-Şoför` / `Mal Hareketi`) sharing
one filter bar (date range + company/facility, URL-persisted like All Visits), one
`ReportKpiCard` component, and one CSV/Excel/PDF export layer (`report-export.ts` —
`downloadReportCsv/Excel/Pdf`, each tab supplies its own `ReportColumn[]` + row builder). The XLSX writer
and jspdf/jspdf-autotable are dynamically imported only when an export button is clicked, so
viewing the Reports page doesn't pull their weight into the initial bundle. Each tab has its own
`*-report-utils.ts` for domain-specific filtering/KPI calculation — follow that split (shared
mechanics in `report-export.ts`/`reports-filters.ts`, domain logic in the tab-specific utils
file) rather than growing one tab's file to do another tab's job.

### Timestamps and timezones

Some ISO timestamps in this codebase encode a wall-clock time meant to be read literally
regardless of the runtime's system timezone (e.g. dashboard/timeline data seeded with explicit
`+03:00` fixtures); others (e.g. transport assignment planning, built from
`new Date(...).toISOString()`) are genuine instants meant to be read via normal `Date` semantics
and compared with `isAfter`/`isSameDay`/etc. These are **not interchangeable** — converting a
"real instant" field to literal-digit reading (or vice versa) breaks correctness for whichever
runtime timezone doesn't match. `src/lib/date.ts` (`getIsoWallClockTime`, `getIsoHour`,
`getIsoWallClockMinutes`, `formatIsoWallClockTime`) is for the literal-digit case only. Before
changing how a timestamp field is read, check how it's *written* elsewhere in the codebase first.

### Testing conventions

No jsdom, no `@testing-library/react` — not installed, not needed for how tests here work:
- Most logic (filtering, KPI calc, sort/pagination, formatting) is tested as plain functions via
  `vitest`.
- Many `*.test.tsx` files test JSX/structural facts by reading the component file as a **raw
  source string** (`readFileSync` + `toContain`/`not.toContain`) rather than rendering it — this
  locks in specific className/structure/prop decisions cheaply without a DOM. Follow this pattern
  for that kind of test; don't introduce a rendering-library dependency to do the same thing.
- When actual rendering is needed, tests use `renderToStaticMarkup` from `react-dom/server`
  (SSR-style static render), not jsdom-based mounting.

### Shared helpers worth reusing instead of reimplementing

- `src/lib/sort.ts` (`toggleSort`) and `src/lib/pagination.ts` (`paginate`, `getPageCount`) —
  every list/table's 3-state column-sort toggle and page-slicing logic should delegate to these
  rather than reimplementing the same `find`/`map`/`filter` or `slice` inline.
- Domain-specific comparator functions (`compareVisits`, `compareGoodsMovements`,
  `compareResources`, etc.) intentionally stay local to their feature file — only the generic
  toggle/paginate mechanics are shared.

## Imported Claude Cowork project instructions
