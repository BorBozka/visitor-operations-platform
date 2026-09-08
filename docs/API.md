# API Contract

## Base path and versioning

The unversioned base path is `/api`. As of Phase 5 the frontend consumes it through
`src/lib/http` (base URL from `VITE_API_BASE_URL`, default `http://localhost:3001/api`); every
authenticated request sends `credentials: "include"`. The first externally deployed breaking
contract will introduce a versioned base path (for example `/api/v1`) as an explicit
API-integration decision; this phase deliberately does not expose parallel aliases.

All timestamps returned by future API endpoints will be ISO-8601 UTC strings. Time-only values,
such as `workdayEndTime`, remain `HH:mm` semantic values rather than timestamps.

## Error shape

Handled application errors use one shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Geçersiz istek gövdesi."
  }
}
```

Unexpected errors return `INTERNAL_ERROR` without implementation, database, credential, or
session-token detail. Login rejects unknown usernames, incorrect passwords, inactive accounts,
and non-LOCAL accounts with the same `401 INVALID_CREDENTIALS` response.

## Authentication and session

`POST /api/auth/login`

```json
{ "username": "calisan", "password": "calisan" }
```

On success the endpoint sets the configured `HttpOnly` opaque-session cookie and returns:

```json
{
  "user": {
    "id": "current-employee-maya-kara",
    "username": "calisan",
    "fullName": "Maya Kara",
    "initials": "MK",
    "role": "EMPLOYEE",
    "roleLabel": "Çalışan",
    "authenticationSource": "LOCAL",
    "authorizationScope": { "companyIds": ["bplas"], "facilityIds": ["bplas-merkez"], "securityGateIds": ["gate-bplas-merkez-ana-giris"] },
    "employeeId": "maya-kara"
  }
}
```

`authorizationScope` and `employeeId` (Phase 5) are the raw assigned scope and the linked
Employee id (`null` for a pure Admin). The backend is the authorization source of truth; the
frontend uses them only for scope-aware UI defaults.

The browser receives only a cryptographically random token. The server stores its SHA-256 hash,
expiry, last-use timestamp, and optional revocation timestamp. Cookies are `HttpOnly`,
`SameSite=Lax`, `Path=/`, and `Secure` only in production. Session TTL comes from
`SESSION_TTL_HOURS`.

`GET /api/auth/session` returns `{ "user": <projection> }` for an active session or
`{ "user": null }` when no valid session exists.

`POST /api/auth/logout` revokes the corresponding server-side session when present, clears the
cookie, and returns `204`. It is intentionally idempotent.

## Account

`POST /api/account/change-password` requires an active LOCAL session cookie.

```json
{ "currentPassword": "calisan", "newPassword": "yeni-parola" }
```

The authenticated session determines the account; no target user ID is accepted. New passwords
must be at least eight characters and must differ from the current password. A successful change
returns `204`; invalid current passwords return `400 CURRENT_PASSWORD_INVALID`.

## Health

`GET /api/health` returns `{ "status": "ok" }` without touching the database.

`GET /api/ready` checks database reachability. It returns `{ "status": "ok" }` when ready or
`503 { "status": "unavailable" }` without database detail.

## Organization

All organization reads require an authenticated session. Operational lookups return active
records by default; append `?includeInactive=true` for administration/history screens.
Organization mutations require the `ADMIN` role. Responses use the frontend-compatible shape
`{ id, parentId?, name, active, createdAt, updatedAt }`; timestamps are ISO-8601 UTC strings.

- `GET /api/organization` returns `{ companies, facilities, departments, securityGates }`.
- `GET /api/companies`, `GET /api/facilities`, `GET /api/departments`, and
  `GET /api/security-gates` list each hierarchy level.
- `GET /api/companies/:id`, `GET /api/facilities/:id`, `GET /api/departments/:id`, and
  `GET /api/security-gates/:id` return a detail record.
- `POST /api/<kind>` and `PATCH /api/<kind>/:id` create or update a record for each hierarchy
  list path. Bodies are `{ name, active }` for companies and `{ parentId, name, active }` for
  child records.
- `GET /api/employees?companyId=&facilityId=&includeInactive=` lists employees; filters are
  optional. `GET /api/employees/:id` returns one employee, including `facilityIds`.

The service rejects an active child below an inactive parent, parent changes on existing child
records, duplicate sibling names, and deactivation while active children exist.

## Admin users

Every endpoint in this section requires `ADMIN`. User projections are compatible with the
frontend `AdminUser` model and include `authorizationScope` with `companyIds`, `facilityIds`,
and `securityGateIds` arrays. Password hashes are never returned.

- `GET /api/admin/users` and `GET /api/admin/users/:id` list/get users.
- `POST /api/admin/users` creates a `LOCAL` user. Body:

```json
{
  "fullName": "Yeni Kullanıcı",
  "username": "yeni.kullanici",
  "email": "yeni@example.com",
  "password": "en-az-sekiz-karakter",
  "role": "SECURITY",
  "authorizationScope": { "companyIds": ["bplas"], "facilityIds": ["bplas-merkez"], "securityGateIds": [] },
  "active": true
}
```

- `PATCH /api/admin/users/:id` updates identity (LOCAL only), role, scopes, and/or active state.
- `PATCH /api/admin/users/:id/status` accepts `{ "active": true }`.
- `PATCH /api/admin/users/:id/role` accepts `{ "role": "MANAGER" }`.
- `PUT /api/admin/users/:id/scopes` replaces the three scope arrays transactionally.
- `POST /api/admin/users/:id/reset-password` accepts `{ "password": "..." }` for LOCAL users.

New users are always `LOCAL`; Active Directory creation/integration is not exposed. Scope
references and their company relationships are validated, and self-lockout/last-active-Admin
changes are rejected. `EMPLOYEE`, `MANAGER`, and `SECURITY` require exactly one facility scope.
The User, its scope rows, Employee profile, and Employee facility scope are provisioned in one
transaction; Employee `companyId` comes from the persisted Facility parent. `ADMIN` creates no
Employee profile. Role changes preserve an existing Employee row for history, synchronize its
name, keep it active only while the User has an Employee-requiring role, and create/reactivate the
same operational identity transactionally when needed.

## Operational settings

Both endpoints require `ADMIN` and use the singleton `OperationalSettings` record with
`id = "default"`.

- `GET /api/settings/operational`
- `PUT /api/settings/operational`

```json
{ "overdueToleranceMinutes": 15, "overdueAlertRepeatMinutes": 10, "workdayEndTime": "18:15" }
```

Minutes must be whole numbers (`tolerance >= 0`, `repeat >= 1`) and `workdayEndTime` must be a
valid 24-hour `HH:mm` value.

## Resource catalog

`GET /api/resources`, `GET /api/resources/:id`, `POST /api/resources`, `PATCH /api/resources/:id`,
and `PATCH /api/resources/:id/status` require `MANAGER` or `ADMIN`. The list accepts
`includeInactive`, `companyId`, `facilityId`, and `type` (`ROOM`, `POOLED_EQUIPMENT`, `VEHICLE`,
or `DRIVER`). Status updates accept `{ "active": true }`.

Create/update bodies are type-discriminated and match the frontend catalog contract:

- `ROOM`: `{ type, companyId, facilityId, name }`
- `POOLED_EQUIPMENT`: `{ type, companyId, facilityId, name, totalQuantity }`
- `VEHICLE`: `{ type, companyId, facilityId, brand, model, licensePlate }`
- `DRIVER`: `{ type, companyId, facilityId, fullName, licenseClasses, documents, canDriveCommercialVehicles }`

The service verifies company/facility consistency, type-specific required fields, driver license
classes, positive pool quantity, company-local vehicle plate uniqueness, and immutable resource
type during editing.

## Phase 3 visitor operations

`GET /api/visit-types` lists active types by default (`includeInactive=true` keeps historical
types resolvable). `POST`, `PATCH /:id`, and `PATCH /:id/status` require `ADMIN`; names use the
same Turkish normalization and duplicate rule as the frontend.

`GET /api/meetings`, `GET /api/meetings/:id`, `GET /api/visits`,
`GET /api/visits/:id`, and `GET /api/visits/reference-data` serve the flattened visitor read
model and Meeting's shared fields. Authenticated employee/manager/admin callers can create and
edit meetings (`POST/PATCH /api/meetings`), reschedule/cancel a planned visit, cancel planned
visits in a meeting, and use host-only `POST /api/meetings/:id/extend` or `/close`. The server
resolves creator/actor identity from the session's User → Employee relation.

`POST /api/meetings/:id/invitations` sends eligible planned visitors in bulk and
`POST /api/visits/:id/invitation` sends/retries one. Visitors without email are skipped in bulk
and rejected for single delivery. State transitions are `NOT_SENT|FAILED → SENDING → SENT|FAILED`;
`SENT`/`SENDING` are never duplicated. The persisted `Invitation` row contains only a SHA-256
hash of a cryptographically-random opaque token. The email's public URL is based on `WEB_ORIGIN`
and contains no Visit ID or personal data.

Public endpoints do not need a session: `GET/PATCH /api/public/invitations/:token` reads/updates
the permitted visitor pre-registration data, and `POST .../:token/rule-acceptances` records the
active immutable rule acceptance. Invalid, cancelled, and completed invitation links return the
same generic not-found response and no internal organization/user data.

Admin inventory/rule endpoints are `GET/POST /api/admin/visitor-cards`,
`PATCH /api/admin/visitor-cards/:id`, `/status`, `/mark-lost`, `/restore`, and
`GET/POST /api/admin/visitor-rules`. Card ownership is enforced as
`AVAILABLE|DISABLED` (Admin), `IN_USE|NOT_RETURNED` (Security), and
`NOT_RETURNED → LOST → AVAILABLE` for admin write-off/restore. Rule publishing atomically
deactivates the prior version and creates the next active immutable version.

Security endpoints are `GET /api/security/visitor-cards/available`,
`GET /api/security/visitor-rules/active`, check-in/out and correction under
`/api/security/visits/:id/*`, `GET /api/security/visitor-card-issues`, and
`POST /api/security/unplanned-visits`. Check-in/out, card transitions, late return, unplanned
create/check-in, correction/audit, and last-visitor meeting auto-close run transactionally.
Host notification email is attempted only after a successful planned check-in commit; a delivery
failure is logged without rolling back the operational change.

## Phase 4 goods movements

`GET/POST /api/goods-movements` and `PATCH /api/goods-movements/:id` require `MANAGER` or
`ADMIN`; `POST /api/goods-movements/:id/cancel` cancels a record without physical deletion.
Persisted statuses are `PLANNED`, `COMPLETED`, and `CANCELLED`; `LATE` is never stored — it stays
a presentation-only derivation from `plannedDate`/`plannedTime` vs. the current time. Create/update
bodies match the frontend contract exactly: `direction` (`INBOUND`/`OUTBOUND`), `companyId`,
`facilityId`, `counterpartyName`, `plannedDate` (`yyyy-MM-dd`), optional `plannedTime` (`HH:mm`),
`goodsDescription`, optional `referenceNumber`, optional `note`. The service verifies the
company/facility pair, and create/update/cancel apply only to editable `PLANNED` records (an
optimistic `status = PLANNED` guard rejects a lost race). `INBOUND` keeps arrival semantics and
`OUTBOUND` departure semantics; no separate status kinds are introduced.

Security endpoints require `SECURITY`. `GET /api/security/goods-movements` returns only today's
`PLANNED` records inside the authenticated user's company/facility authorization scope (both
directions, as canonical records; search/sort stay on the client).
`POST /api/security/goods-movements/:id/complete` accepts `{ companyId, facilityId, actualPlate?,
actualDriverName? }`; the request-supplied `companyId`/`facilityId` are not trusted — they must be
within the Security user's authorization scope and must match the movement's own company/facility.
Completion applies only to a `PLANNED` record, writes a server-generated `actualAt`, records the
optional actual plate/driver, and moves the status to `COMPLETED`.

## Phase 4 meeting resource assignments

All endpoints require `MANAGER` or `ADMIN`. Assignment rows carry an immutable snapshot
(`resourceName`, `companyId`, `facilityId`, and equipment `totalQuantity`); projections are built
from that snapshot, so a later rename/deactivate/delete of the catalog resource never rewrites a
past assignment.

- `GET /api/meetings/:meetingId/resource-assignments`
- `GET /api/meetings/:meetingId/eligible-rooms` — active `ROOM` resources for the Meeting's
  facility, each flagged available/unavailable with a conflict reason.
- `GET /api/meetings/:meetingId/eligible-equipment` — active `POOLED_EQUIPMENT` for the facility
  with `usedQuantity` / `remainingQuantity` over overlapping valid Meetings.
- `POST /api/meetings/:meetingId/resource-assignments/room` `{ resourceId }` — assign or atomically
  replace the Meeting's single room. The new room is validated and availability-checked first; the
  existing assignment is only removed if the new one is valid.
- `POST /api/meetings/:meetingId/resource-assignments/equipment` `{ resourceId, requestedQuantity }`
- `PATCH /api/resource-assignments/:id` `{ requestedQuantity }` — update an equipment quantity.
- `DELETE /api/resource-assignments/:id` — remove one assignment (`204`).
- `PUT /api/meetings/:meetingId/resource-assignments` `{ roomResourceId: string | null, equipment:
  [{ resourceId, requestedQuantity }] }` — full desired state; validated entirely before any
  write, then the Meeting's whole assignment slice is replaced in one transaction.

Room availability excludes only rooms already held by another active/open Meeting whose time range
overlaps (`startA < endB && endA > startB`; a touching boundary is not a conflict). Equipment
availability subtracts other valid overlapping Meetings' quantity use; a Meeting's own current use
is never counted against itself on re-save, and total demand may not exceed `totalQuantity`.
Closed (`actualMeetingEnd` set) and fully-cancelled Meetings consume no capacity. A Meeting is
read-only for assignments once it is explicitly closed or all its visits are terminal.
`saveMeetingAssignments` and the incremental mutations all commit under a `SERIALIZABLE`
transaction that re-validates inside the transaction and retries a bounded number of times on a
deadlock/write-conflict; an unresolved race returns `409 RESOURCE_ASSIGNMENT_CONFLICT` with no
SQL Server detail.

## Phase 4 meeting extension integration

`POST /api/meetings/:id/extend` (host-only, unchanged auth) now re-validates the Meeting's
existing `ROOM` and `POOLED_EQUIPMENT` assignments for the extended time range and moves
`plannedEnd` in the **same** `SERIALIZABLE` transaction. A room conflict or equipment
capacity violation rejects the whole extension — `plannedEnd` and the assignments are unchanged —
and returns an explanatory `409` (`ROOM_CONFLICT` / `EQUIPMENT_CAPACITY`), or
`409 MEETING_EXTENSION_CONFLICT` if an unresolved concurrency conflict remains.

## Phase 4 transport assignments

All endpoints require `MANAGER` or `ADMIN`. Canonical statuses are `ACTIVE` and `CANCELLED`.
Create/update input: `companyId`, `facilityId`, `plannedStart`, `plannedEnd`, `purpose`,
`vehicleResourceId`, `driverResourceId`, optional `relatedMeetingId`, optional `relatedVisitId`
(never both). The vehicle must be an active `VEHICLE` and the driver an active `DRIVER`, each in
the assignment's company/facility; an optional related Meeting/Visit must exist and match that
company/facility. Each row stores a display snapshot (company/facility identity, `vehicleName`,
`vehicleLicensePlate`, `driverName`) so historical reports survive catalog changes.

- `GET /api/transport-assignments`
- `POST /api/transport-assignments/availability` `{ companyId, facilityId, plannedStart,
  plannedEnd, excludeAssignmentId? }` — active, scoped vehicles/drivers not already in an
  overlapping `ACTIVE` assignment.
- `POST /api/transport-assignments` (`201`) / `PATCH /api/transport-assignments/:id` /
  `POST /api/transport-assignments/:id/cancel`

Only `ACTIVE` assignments create conflicts; a vehicle or driver may not be double-booked for an
overlapping range (touching ranges are allowed); on edit `excludeAssignmentId` omits the row
being edited. A cancelled assignment cannot be edited and re-cancelling returns `409`. Create and
update re-check availability inside a `SERIALIZABLE` transaction with bounded deadlock retry;
an unresolved race returns `409 TRANSPORT_ASSIGNMENT_CONFLICT` without SQL Server detail.

## Phase 4 reporting datasets

`GET /api/reports/visits`, `GET /api/reports/fleet`, and `GET /api/reports/goods` require
`MANAGER` or `ADMIN` (read only) and return the raw records the frontend report utilities
consume — `{ visits }`, `{ assignments }`, `{ movements }` respectively. No KPI/chart aggregation
or CSV/XLSX/PDF generation is done server-side. Query filters: `startDate`, `endDate`
(`yyyy-MM-dd`), `companyId`, `facilityId`. As of Phase 5, `all`/omitted means "everything inside
the caller's authorization scope", never everything; a concrete out-of-scope id yields an empty
dataset (see Phase 5 authorization). The date range is inclusive local-day boundaries
(`startOfDay(start) .. endOfDay(end)`) on the record's planned instant — `Meeting.plannedStart`
for visits, `plannedStart` for fleet, `plannedDate` for goods — matching the frontend
`reports-filters` semantics; an inverted range yields an empty dataset. `startDate`/`endDate`
are validated with a strict calendar-date parser: `2026-02-31` and other well-formed but
non-existent dates are rejected.

## Phase 5 authorization and scope enforcement

The session projection carries `authorizationScope` (`{ companyIds, facilityIds,
securityGateIds }`) and `employeeId` (`null` for a pure Admin). Route role guards are not the
security boundary — every read is scope-filtered and every mutation is scope- and
ownership-checked server-side, derived entirely from the session:

- **`companyId=all` / `facilityId=all` / omitted** on any list or report resolves to the
  caller's assigned scope. Every role is company-scoped; an empty assigned scope sees nothing.
- **`GET /api/meetings`, `GET /api/visits`, `GET /api/visits/reference-data`** accept
  `EMPLOYEE|MANAGER|ADMIN|SECURITY`. EMPLOYEE receives only meetings it created or hosts;
  MANAGER/ADMIN their full scope; SECURITY the operational (`PLANNED`/`CHECKED_IN`) subset inside
  its company/facility. Reference-data company/facility/employee option lists are narrowed to
  scope; visit types stay global.
- **Meeting/visit mutations** (`POST/PATCH /api/meetings`, reschedule, cancel, invitations):
  the meeting must be in the actor's scope; EMPLOYEE and MANAGER may mutate only meetings they
  created; ADMIN may mutate any in-scope meeting. Host lifecycle (`/extend`, `/close`) stays
  gated on host identity.
- **Security operations** (`/api/security/*` visits, unplanned, correction, card return, goods
  completion): confined to the gate user's scope. The `companyId`/`facilityId` sent with an
  unplanned create or a goods completion are verified against that scope, not trusted.
- **Goods, resource assignments, transport assignments, resource catalog**: reads scope-filtered;
  create/update/cancel reject a company/facility outside scope.
- **`404` vs `403`**: an out-of-scope entity id is reported as `404 NOT_FOUND` (no cross-scope
  existence leak); an in-scope meeting owned by another non-admin user is `403
  VISIT_MUTATION_FORBIDDEN`. Security operations outside scope return `403 OUT_OF_SCOPE`.

`DELETE /api/resources/:id` (`MANAGER`/`ADMIN`) hard-deletes a catalog resource and its owned
driver license-class / document rows; a resource still referenced by an immutable assignment
snapshot returns `409 RESOURCE_IN_USE` and must be deactivated instead.

`AUTH_RATE_LIMIT_MAX` (default `10`) sets the per-minute-per-IP login attempt limit; an E2E run
raises it so its many rapid seeded logins are not throttled.

## Email delivery configuration

`EMAIL_DELIVERY_MODE=log|smtp` defaults to `log`, which sends nothing and does not log email
bodies or raw invitation tokens. `smtp` requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM_ADDRESS`, and `MAIL_FROM_NAME`; startup fails clearly
when any required value is absent. The SMTP adapter is isolated behind the backend `EmailSender`
boundary; no provider-specific logic is present in visitor services.
