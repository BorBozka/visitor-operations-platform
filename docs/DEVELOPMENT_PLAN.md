# Visitor Management System — Final Development Summary

## Current status

Product implementation is complete through Backend/Full-stack Phase 5. The application runs
against the Fastify/Prisma/MSSQL backend through frontend HTTP adapters; runtime mock fallback is
not permitted. LOCAL authentication, server-side authorization/scope enforcement, SMTP delivery
boundary, real MSSQL integration coverage, and Playwright E2E coverage are implemented.

Remaining work is limited to final visual UI polish and repository closure. No new product,
backend, infrastructure, Active Directory, or deployment scope is implied by that polish.

## Frontend, product, and UI phases

- Established the React/TypeScript/Vite application, compact Tailwind/shadcn enterprise visual
  system, role-aware routing, shared shells, and domain/service boundaries.
- Delivered Employee visit creation, editing, rescheduling, cancellation, timeline, upcoming
  visits, invitation actions, and host-scoped Meeting lifecycle notifications.
- Introduced the canonical `Meeting` plus individual `VisitRecord` model. Meeting-owned fields
  and resource reservations are shared by every visitor record in the Meeting.
- Delivered Manager/Admin dashboards, scoped all-visits view, organization and user management,
  operational settings, visit types, visitor cards/rules, resource catalog and Meeting resource
  assignment, goods movement, transport planning, and visits/fleet/goods reports.
- Reports retain client-side filtering, KPI calculation, charts, pagination, and CSV/XLSX/PDF
  export while their source datasets come from authorized backend APIs.
- Final UI contracts remain compact, role-appropriate, and behavior-preserving. Meeting lifecycle
  ownership, Security operations, and Admin visitor-card ownership must not be blurred by polish.

## Security operations

- Delivered separate Security navigation and the `Expected` / `Inside` operational workspace.
- Implemented planned check-in/out, permitted visitor corrections, rule acceptance, visitor-card
  assignment/return, pending returns, unplanned immediate check-in, and scoped daily goods
  arrival/departure completion.
- Security lifecycle mutations stay behind the Security service/API boundary. Physical cards are
  numbered inventory; the application does not integrate with door or turnstile hardware.
- Unplanned visits use the active company/facility/gate scope, free-text host display where no
  employee identity exists, server time for arrival, an available card, and explicit rule
  acceptance.

## LOCAL authentication

- One `/login` flow authenticates LOCAL users and redirects by role.
- The backend verifies Argon2id password hashes and persists only hashed opaque session tokens.
- The browser receives an HttpOnly session cookie; logout revokes the server-side session.
- All role shells use the current session account. LOCAL password changes go through the backend;
  the profile-photo preference remains client-side `localStorage` by design.
- Active Directory authentication and user provisioning are not implemented and remain outside
  project scope.

## Backend Phase 1 — Foundation, schema, and authentication

- Added the independent Fastify/TypeScript backend workspace, Prisma 6.15 SQL Server schema, the
  initial migration history, environment validation, health/readiness endpoints, and API error
  contract.
- Added LOCAL login/logout/session/current-user/password-change behavior using Argon2id and
  hashed opaque server-side sessions.
- Established route -> service -> repository -> Prisma layering and MSSQL-free unit-test
  repositories.

## Backend Phase 2 — Organization, administration, settings, and resources

- Added organization hierarchy, admin user/role/scope operations, operational settings, account
  operations, and typed resource-catalog APIs.
- Enforced company/facility relationships, LOCAL identity rules, last-admin/self-lockout guards,
  resource type invariants, and server-owned validation.
- Operational LOCAL roles are provisioned atomically with their Employee identity and single
  facility binding; pure Admin accounts remain User-only and role changes retain Employee history.

## Backend Phase 3 — Visitor operations

- Added visit types, Meetings/Visits, reschedule/cancel/lifecycle operations, invitations and
  public pre-registration, visitor rules, visitor cards, and Security check-in/out/correction/
  unplanned flows.
- Invitation links use hashed opaque tokens. Operational writes that span Meeting, Visit, card,
  acceptance, and audit state are transactional.
- Email delivery is isolated behind log and SMTP adapters; operational commits are not rolled back
  by a later notification-delivery failure.

## Backend Phase 4 — Operations and reporting data

- Added goods-movement, transport-assignment, Meeting resource-assignment, resource availability,
  and report-dataset APIs.
- Used SQL Server transactions and bounded conflict retry for assignment availability and Meeting
  extension consistency.
- Preserved immutable display snapshots where historical assignments must remain readable after
  catalog changes.

## Backend/Full-stack Phase 5 — HTTP integration and authorization

- Replaced runtime frontend service composition with `Http*` adapters backed by a central
  credentials-aware HTTP client and normalized API error handling.
- Enforced role, ownership, company/facility/gate scope, and non-leaking out-of-scope behavior on
  the server. Request-supplied actor IDs or scope IDs are never trusted as authorization proof.
- Completed full-stack regression coverage: frontend/backend units, real MSSQL integration,
  authorization smoke coverage, and Playwright E2E over seeded LOCAL users.
- Finalized ManagerShell hook ordering and lint/type safety without changing role UI behavior.

## Architectural contracts to preserve

- A Meeting owns shared planning fields; each visitor owns a separate VisitRecord and operational
  state.
- Employee/Manager mutations respect creator or host ownership; Admin and Security powers remain
  limited to their explicit server-enforced roles and scopes.
- Security card flows and Admin card lifecycle actions have separate ownership.
- `all` or omitted filters mean all records inside the authenticated scope, never a global bypass.
- Out-of-scope entity lookups do not leak existence.
- Wall-clock fixtures and genuine instants use their respective date semantics; do not interchange
  them during UI polish.
- Prisma migration files already present are immutable history. Schema changes require an explicit
  new phase; final polish must not generate migrations.

## Closure criteria

Final visual polish may adjust presentation without changing domain behavior, authorization,
API contracts, schema, migrations, environment security defaults, or deployment topology. Closure
requires passing lint, typechecks, relevant tests/builds, Prisma checks, and a clean Git state.
