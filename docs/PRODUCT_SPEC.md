# PRODUCT_SPEC.md

# Visitor Management System — Product Specification

## 1. Purpose

This project is a web-based visitor management and security operations application for a multi-company, multi-facility organization.

The application manages:

- planned visitors,
- unplanned visitors,
- visitor pre-registration,
- visitor rule acceptance,
- visitor check-in and check-out,
- physical visitor card assignment and return,
- visit duration monitoring and overdue alerts,
- after-hours goods deliveries,
- multi-company and multi-facility operations,
- role-based dashboards,
- reporting and exports,
- LOCAL users with role- and scope-based authorization.

This is **not** an employee HR/PDKS/access-control replacement.

Visitor cards are **not electronically connected to Starkom or any physical access-control system**. They are physical numbered visitor cards tracked by the application.

All actual visitor check-in and check-out actions are performed manually by security personnel in the web application.

---

## 2. Out of Scope

Unless explicitly added later:

- employee payroll,
- employee HR/personnel records,
- attendance/PDKS,
- antipassback,
- door/device IP or port management,
- physical turnstile/device configuration,
- Starkom card authorization,
- access-control schedules,
- biometric access,
- employee leave management,
- salary data,
- detailed employee personal records,
- automatic physical door unlocking using visitor QR.

---

## 3. Organization Model

Support:

- multiple companies,
- multiple facilities/sites per company,
- multiple security gates per facility.

A user belonging to Company A may create a visit at Company B.

Visit records must distinguish:

- creator user,
- creator company,
- host company,
- host facility,
- host employee.

Company and facility are separate concepts.

---

## 4. Roles

Initial roles:

- Employee
- Security
- Manager
- Admin

### Employee

Can:

- create planned visits,
- create visits at other active companies/facilities,
- view own created visits,
- edit permitted visit data,
- reschedule,
- cancel,
- view personal visitor timeline,
- create after-hours goods-delivery records.

### Security

Can:

- view relevant expected visitors,
- search visitors,
- locate visits using QR,
- create unplanned visits,
- correct permitted visitor data,
- assign physical visitor cards,
- check in,
- check out,
- confirm card return,
- mark card not returned,
- see visitors currently inside,
- see overdue visitors,
- see expected goods deliveries,
- record delivery arrival/departure.

Security cannot delete visit records.

Security may correct fields such as:

- visitor company,
- phone,
- plate,
- optional visitor information,
- note,
- host employee display name.

Visitor company is a required field; Security's correction here may update it but must not
clear it. The gate correction form edits name, company, host name and phone (no e-mail field).
Correcting the host name updates the displayed name only and is recorded as an audit note on
the visit (previous name, timestamp, acting security employee); the linked host employee
reference is not changed.

### Manager

Can:

- create visits,
- view dashboards,
- use reports,
- filter reports,
- export reports.

### Admin

Manages:

- users,
- roles,
- companies,
- facilities,
- security gates,
- departments where applicable,
- visit types,
- visitor cards,
- visitor rules and versions,
- overdue/system parameters.

---

## 5. Authentication

The implemented system authenticates `LOCAL` users through the Fastify/MSSQL backend. Passwords
are Argon2id hashes. Successful login creates an opaque server-side session whose token is sent
only in an HttpOnly cookie; logout revokes that session. Authentication source and role remain
separate concepts in the data model.

Active Directory integration is not in this project's implementation scope. If required, an
organization may integrate its own Active Directory environment in a separate future delivery;
the current API and UI neither offer an AD login choice nor implement AD provisioning.

Authorization is derived from the authenticated session on the server. Role and company,
facility, and security-gate scopes are enforced for reads and mutations; client-supplied actor or
scope identifiers are not trusted as authorization proof.

LOCAL users in the `EMPLOYEE`, `MANAGER`, or `SECURITY` roles are provisioned with an operational
Employee identity in the same transaction as the User and authorization scope. Their scope must
contain exactly one facility; the Employee's company is derived from that facility on the server.
`ADMIN` users do not require an Employee identity. The Admin user form does not introduce a
separate “primary facility” field: this product is deployed for one operational facility, and a
different facility uses a separate installation.

### Account self-service UI

All authenticated role shells expose the same account menu with the current user's avatar,
name, role, profile-photo action, and logout action. Only `LOCAL` users see password change;
`ACTIVE_DIRECTORY` records must not be offered a local-password flow even though AD login is out
of scope. Account identity comes from the backend session, LOCAL password changes use the account
API, and the profile-photo preference remains per-browser `localStorage`. Logout goes through the
session-service boundary, revokes the backend session, and redirects to `/login`.

---

## 6. Visitor vs Visit

A Visitor is a person.

A Visit is one occurrence of that person's visit.

A returning visitor should be searchable/reusable.

Previous visitor information may be pre-filled but must remain editable because company/phone/plate may change.

Every individual person has a separate visit record, even when several people arrive together.

### Meeting and Visit grouping

A `Meeting` is the business event that groups one or more individual `Visit` records.

- Every `Visit` belongs to exactly one `Meeting` through a required `meetingId`.
- Each visitor still has a separate `Visit` record, including when several visitors attend
  the same meeting.
- Existing and newly created single-visitor visits are represented by a one-to-one
  `Meeting` and `Visit` relationship.
- The `Meeting` domain object is not the same concept as the configurable `Meeting` visit
  type. Any visit type may use Meeting grouping.

The Meeting is the single source of truth for information shared by its visits:

- creator employee,
- host company,
- host facility,
- host employee,
- visit type,
- planned start and end,
- general meeting/visit note,
- additional-requirement indicator and description.

The Visit remains the source of truth for visitor-specific and operational information:

- visitor identity and contact details,
- invitation status, sent time, and delivery error,
- operational visit status,
- actual check-in and check-out times,
- visitor card,
- rule acceptance and other visitor-specific operational data.

Invitation state and operational state remain independent and are tracked per Visit.
Cancellation and security overdue behavior also remain Visit-based. Shared Meeting fields
must not be maintained as a second editable data source on Visit; screens that need both
sets of data use a combined projection.

Manager resource assignment (rooms and pooled equipment) and host-only Meeting lifecycle
behavior are implemented at the Meeting level. Source/integration tracking remains a later
phase.

---

## 7. Visitor Data

National identity number is not required.

Potential fields:

- first name,
- last name,
- email,
- phone,
- arrives by vehicle,
- plate if applicable.

For a planned visitor, email is optional. A visitor without email can be planned and processed
normally at Security; only invitation and pre-registration delivery require an email address.

Company is a required field on every visitor, not a potential/optional one, since a monthly
manager report depends on a company value existing for every visit (see
`STAKEHOLDER_NOTES.md`).

Plate is required only if the person is arriving by vehicle and the flow requires it.

---

## 8. Visit Data

At minimum:

- visitor,
- visitor company,
- creator,
- host company,
- host facility,
- host employee,
- visit type,
- visit date,
- planned start,
- planned end,
- status.

Host employee is mandatory.

Optional/additional:

- security gate,
- note,
- plate,
- visitor card,
- actual check-in,
- actual check-out,
- cancellation/reschedule metadata.

Planned start and end are mandatory.

A note field exists for special situations, including an intentionally extended visit.

---

## 9. Visit Types

Configurable by Admin.

Examples:

- Meeting
- Technical Service / Maintenance
- Supplier
- Job Interview
- Audit
- Customer Visit
- Official Visit
- Other

Goods Delivery is a separate module.

---

## 10. Planned Visit Workflow

1. Employee creates visit.
2. If the visitor has an email address, the visitor may receive a secure pre-registration link.
3. Visitor may complete/correct information before arrival.
4. Visitor reads and explicitly accepts company rules.
5. Visitor may receive/display QR for quick visit lookup.
6. Security locates visit using QR or search.
7. Security assigns an available visitor card.
8. Security manually checks visitor in.
9. Host employee may receive "visitor checked in" email.
10. Security manually checks visitor out and processes card return.

No internal approval workflow exists.

---

## 11. Visitor Pre-registration

Visitor can use the invitation link to:

- review visit,
- complete/correct personal data,
- enter company,
- enter phone if needed,
- indicate vehicle,
- enter plate if applicable,
- read rules,
- explicitly accept rules.

Company is mandatory here; the visitor cannot complete pre-registration without entering it.
Email and phone remain optional visitor fields. A visitor without email cannot receive an
invitation link but can still be planned and processed at Security.

Pre-registration itself must not block arrival.

If the visitor did not complete it, security may complete necessary data at the desk.

Rule acceptance is mandatory before check-in.

---

## 12. QR

QR is used to locate/open the visit and speed up check-in.

It does not open doors.

QR should represent a non-guessable visit token, not plaintext personal information.

Cancelled/completed/invalid visits cannot use the QR to check in.

Rescheduling may retain the same visit identity/QR.

---

## 13. Unplanned Visit

1. Visitor arrives at security.
2. Security creates one unplanned Meeting and one Visit from the Security user's current
   company/facility scope; company, facility, planned start and invitation controls are not
   selected or shown at the desk.
3. Security may phone host employee.
4. Security records required name, surname, visitor company, a free-text host/person name,
   an active visit type, and an optional plate. The unplanned desk flow does not collect phone.
5. Security uses the current time for both planned start and actual check-in. Planned end is
   calculated from a default one-hour estimate. Fast choices are 30 minutes, 1 hour, 2 hours,
   4 hours, until noon (when before 12:00), and until the configured workday end.
6. Rules are shown at the security desk. Security records the active rule/version snapshot only
   after confirming that the visitor read and explicitly accepted it.
7. Security assigns an `AVAILABLE` visitor card.
8. One `Kaydet ve giriş yap` operation creates the Visit directly as `CHECKED_IN`, records the
   `SECURITY_DESK` rule acceptance, moves the card to `IN_USE`, and does not send an invitation.

An unplanned free-text host does not receive a fabricated employee identity. The display name is
stored, while host-only lifecycle permission remains unavailable until a real employee link exists.

No internal digital approval workflow is required.

---

## 14. Rule Acceptance

Mandatory before check-in.

Store separately:

- visit ID,
- visitor ID,
- rule/version ID,
- rule version,
- acceptance timestamp,
- acceptance method,
- accepted content snapshot or integrity hash.

Recommended methods:

- `INVITATION_LINK`
- `SECURITY_DESK`

IP may be retained where appropriate.

Rules are versioned.

Changing rules creates a new version.

Historical versions and acceptance records are immutable.

Admin publishes a complete rule text directly; there is no draft, edit, or delete lifecycle.
Publishing atomically makes the new version active and deactivates the previous active version.
Each published version has one `publishedAt` timestamp; a separate creation timestamp is not kept
because a rule cannot exist before publication.

Legal/KVKK review may later add requirements.

---

## 15. Visitor Cards

Physical numbered cards only.

Suggested states:

- `AVAILABLE`
- `IN_USE`
- `NOT_RETURNED`
- `LOST`
- `DISABLED`

Only available cards can be assigned.

An in-use card cannot be assigned to another active visit.

Card state ownership is explicit:

- Admin creates cards and may edit the card number or disable/enable cards only while they are `AVAILABLE` or `DISABLED`.
- Security changes a card to `IN_USE` at check-in and to `NOT_RETURNED` when the visitor leaves without returning it.
- Admin may write off a `NOT_RETURNED` card as `LOST`, and may return a `LOST` card to `AVAILABLE` inventory.
- `IN_USE` and `NOT_RETURNED` cards cannot be renumbered, disabled, or reassigned by Admin.

Check-in:

- security selects card,
- confirms check-in,
- actual check-in time is stored,
- card becomes `IN_USE`.

Normal check-out:

- security checks visitor out,
- confirms card returned,
- actual check-out time is stored,
- card becomes `AVAILABLE`.

Preferred UI action:

`Check Out + Confirm Card Return`

If card is not returned:

- visit may still be checked out,
- card becomes `NOT_RETURNED`.

---

## 16. Visit Status

Stored states:

- `PLANNED`
- `CHECKED_IN`
- `CHECKED_OUT`
- `CANCELLED`
- `NO_SHOW`

`OVERDUE` is calculated, not permanently stored.

A visit is overdue when:

- status is `CHECKED_IN`,
- no actual check-out exists,
- current time exceeds planned end plus configured tolerance.

A visit that never checked in must not generate an overdue alert.

It may become `NO_SHOW`.

---

## 17. Cancellation and Rescheduling

Employees may cancel and reschedule their own planned visits.

Cancelled visits are not deleted and remain visible historically/timeline.

Cancelled visits cannot be checked in.

Their QR cannot be used for check-in.

Rescheduling changes planned date/time on the existing visit.

---

## 18. Overdue Logic

Mandatory planned start and end.

Configurable:

- overdue tolerance in minutes,
- security alert repeat interval.

Suggested defaults:

- tolerance: 0 minutes,
- repeat: 15 minutes.

If a checked-in visitor is overdue:

- show overdue state,
- security receives persistent actionable alert,
- alert may be dismissed temporarily,
- alert may repeat after configured interval until visitor exits.

No overdue email is sent to the host employee.

---

## 19. Notifications

Planned:

- invitation email to visitor,
- "visitor checked in" email to host employee.

No host overdue email.

Clearing invitation notifications is a local presentation action. It does not mutate the
Visit invitation state, and the same Visit may remain actionable in other authorized UI surfaces.

---

## 20. Employee Interface

Planning-oriented.

Core:

- create visit,
- own visit timeline,
- Day / Week / Month,
- upcoming visits,
- edit,
- reschedule,
- cancel.

The personal timeline and Upcoming Visits list remain creator-scoped: they show only
Visits whose `creatorEmployeeId` matches the current employee. Independently, My Visits
shows a persistent Meeting-end notification when the current employee is the host of an
open Meeting whose `plannedEnd` has arrived or passed. Host notifications do not add the
Meeting's Visits to the personal timeline or Upcoming Visits list.

Timeline statuses include:

- Planned
- Checked In
- Checked Out
- Cancelled
- No Show

---

## 21. Security Interface

Operational.

Primary indicators:

- inside,
- expected today,
- overdue,
- cards not returned.

Primary tabs:

- Expected
- Inside
- Overdue
- Completed

Primary actions:

- search/QR,
- unplanned visitor,
- card assignment,
- check-in,
- check-out,
- card returned/not returned.

### Security Goods Movements

Security sees only today's `PLANNED` goods movements in its current company/facility scope;
there is no company/facility selector, record creation, editing, cancellation, date filter, or
pagination workflow on this operational screen. Inbound and outbound movements are presented
separately. Within each direction, time-scheduled records whose planned datetime has passed are
shown first as delayed, followed by the remaining records in planned-time order; records with no
planned time remain in the latter group after timed records.

Security can search counterparty, goods description, and reference number. Completing an inbound
record means arrival; completing an outbound record means departure. A Security completion may
capture an optional actual plate and driver name, records a service-generated actual timestamp,
and changes the shared goods-movement record from `PLANNED` to `COMPLETED`. The operation rejects
out-of-scope or non-planned records. Manager, Dashboard, and reporting views continue to read the
same completed record.

---

## 22. Manager and Reporting

Initial indicators:

- currently inside,
- expected today,
- arrived today,
- overdue,
- cards not returned,
- expected after-hours deliveries.

Initial report filters:

- date range,
- company,
- facility,
- department,
- visitor,
- visitor company,
- host employee,
- visit type,
- visit status,
- plate,
- overdue.

Exports:

- Excel
- PDF

Use limited charts; filtered table is primary.

The manager `All Visits` view is read-only and provides:

- URL-persisted date-range and operational filters,
- compact paginated visit records,
- only operationally opened Visits whose invitation state is not `NOT_SENT`,
- invitation and additional-requirement visibility in the detail dialog,
- a centered, compact Manager Visit Detail dialog.

The table continues to display one row per visitor/Visit and is not redesigned for Meeting
grouping. The centered Manager Visit Detail dialog provides visit details and Meeting-level
room and pooled equipment resource assignments. It does not show Meeting lifecycle data or
actions; host lifecycle management is available only from the My Visits floating notification.

The Manager `Reports` area is a separate, tabbed surface (`Ziyaretler`, `Araç/Şoför`,
`Mal Hareketi`) reachable from Manager navigation. A single filter bar sits above the tabs and
is shared by all of them:

- date range, defaulting to the last 30 days, with `Bugün` / `Son 7 gün` / `Son 30 gün` / `Bu ay`
  quick-select options and no maximum span,
- company and facility, using the same unscoped-by-default (`all`) pattern as the Dashboard.

All shared filters are URL-persisted, matching the All Visits pattern. All three tabs are
read-only reporting surfaces with no row-level detail dialog, and each offers CSV, Excel, and
PDF export of its currently filtered result.

The `Ziyaretler` report tab reuses the All Visits filter/sort logic but is not the All Visits
list: it has its own report-specific KPI cards (total visits, completed visits, the
no-show/cancellation rate, and average visit duration), and unlike All Visits it does not
exclude Visits whose invitation state is `NOT_SENT` — a report must stay complete for audit
purposes.

The `Araç/Şoför` report tab reads planned transport assignment data only (no actual start/end
time or odometer capture exists yet, so a distance/km report is a separate later phase). Its
KPI cards are total assignments, cancelled assignments, the cancellation rate, and the average
planned duration. Its table shows purpose, vehicle (name and plate), driver, company/facility,
planned start–end, status (Aktif/İptal), and the related Visit or Meeting if the assignment was
created from one (otherwise `—`).

The `Mal Hareketi` report tab reads goods movement data. Its KPI cards are total movements,
inbound movements, outbound movements, and the late rate (derived the same way the operational
Goods Movements list derives a `Gecikti` status). Its table shows direction, company/facility,
counterparty, planned date/time, actual time (if recorded), status (Planlandı/Tamamlandı/
İptal/Gecikti), reference number, and the actual plate/driver recorded at completion (otherwise
`—`).

---

## 22A. Resource Catalog

Managers maintain a backend-persisted catalog of facility resources through the frontend HTTP
service boundary, independently from visit types.

Supported catalog records:

- `ROOM`: one named meeting room belonging to one company and one facility; it has no
  quantity field.
- `POOLED_EQUIPMENT`: a named facility equipment pool belonging to one company and one
  facility; it stores a positive total quantity rather than serialized devices.
- `VEHICLE`: one individual company vehicle belonging to one company and one facility;
  brand, model, and license plate are stored separately and it has no quantity field.
- `DRIVER`: one individual driver resource belonging to one company and one facility;
  full name, one or more license classes, textual document/qualification names, and an
  explicitly recorded commercial-vehicle capability are stored independently from any
  vehicle.

Vehicles and drivers are separate catalog resources. A vehicle has no permanent/default
driver, and the catalog does not pair vehicles with drivers. Employees do not select
resources while creating visits. The existing additional-requirement note remains free
text and is not a structured resource request or assignment.

Every resource has an active/inactive lifecycle and can also be permanently deleted from
the catalog. Deactivation is temporary and reversible; deletion removes the catalog
record. The selected facility must belong to the selected company.

The catalog supports listing, filtering, creating, editing, and activating or deactivating
or permanently deleting all four resource types. Meeting resource assignment for `ROOM` and `POOLED_EQUIPMENT` is fully
supported for Managers with real-time availability and capacity validation. Vehicle and driver planning
is a separate Manager workflow defined in section 22D; it does not assign fleet resources to Meetings.
Conflict overrides and automated notifications are not supported.
Resource availability does not block Meeting or Visit creation, and an additional-requirement note
is not a resource request.

Deleting a `ROOM` or `POOLED_EQUIPMENT` catalog record does not cascade-delete historical
Meeting assignments. Each assignment retains an immutable snapshot of the resource name,
type, company, facility, and equipment capacity where applicable. Historical assignment
details continue to render from that snapshot after deletion. A deleted resource is absent
from catalog lists, cannot be assigned again, and is excluded from availability and conflict
calculations for new use.

---

## 22B. Manager Resource Assignment

Users with the Manager role can assign, edit, and remove facility meeting rooms and pooled equipment for meetings.

### Business Rules

- **Meeting Scope:** Resource assignments belong to the `Meeting` record, not to individual `Visit` records or participants.
- **Resource Types Supported:**
  - `ROOM`: At most one room may be assigned to a meeting. Assigning a new room atomically replaces any previous room assignment.
  - `POOLED_EQUIPMENT`: Multiple distinct pooled equipment items may be assigned to a meeting, each with a required positive integer quantity.
  - `VEHICLE` & `DRIVER`: Vehicle and driver resources remain catalog-only entities in this phase and are not assigned to meetings.
- **Scope & Active Rule:** Assigned resources must belong to the meeting's host facility and must be active.
- **Overlap Definition:** Two meetings overlap when their planned time ranges intersect (defined as half-open time intervals where meeting A planned start is before meeting B planned end, and meeting A planned end is after meeting B planned start). Cancelled meetings (meetings where all visits are `CANCELLED`) and closed meetings (meetings where `actualMeetingEnd` is set) are excluded and create no conflicts.
- **ROOM Conflict Rule:** A room cannot be assigned if it is already assigned to another overlapping, non-cancelled, non-closed meeting.
- **POOLED_EQUIPMENT Capacity Rule:** An equipment pool cannot be assigned if the total requested quantity across all overlapping non-cancelled, non-closed meetings plus the newly requested quantity exceeds the total pool capacity.
- **Atomic Save Semantics:** All resource changes for a meeting are validated and saved atomically. If any requested room or equipment assignment violates availability or capacity, the persisted state remains completely unchanged.
- **Completed Meeting Rule:** Resource assignments cannot be created, edited, or removed for meetings whose visits are all in terminal states (`CHECKED_OUT`, `CANCELLED`, or `NO_SHOW`). This rule is independent of the explicit-closure rule below.
- **Closed Meeting Rule:** Resource assignments cannot be created, edited, or removed for meetings where `actualMeetingEnd` is set, regardless of visitor visit statuses. Explicit Meeting closure takes effect immediately.
- **Permissions:** Any user with the Manager role can create, modify, or remove resource assignments.
- **No Conflict Override:** Conflict overrides are not supported. Availability conflicts must be resolved operationally by selecting available resources or rescheduling the meeting.

---

## 22C. Meeting Lifecycle

A Meeting does not change status automatically when its planned end time passes.

### Extension

Only the Meeting host employee can extend the planned end time of an open Meeting at any
point after it starts. Manager role or Meeting creator identity alone grants no lifecycle
mutation permission.

- Available actions: +15 minutes, +30 minutes, or a custom positive integer number of minutes.
- The new planned end is computed as: `max(current plannedEnd, current time) + extensionMinutes`.
- Before the extension is applied, all existing ROOM and POOLED_EQUIPMENT assignments are re-validated against the extended time range.
- If any conflict or capacity violation is detected, the entire extension is rejected. No partial change is persisted and no automatic alternative is suggested.
- Extensions are not available after the Meeting has been explicitly closed.
- Extensions are not available when every linked Visit is terminal (`CHECKED_OUT`,
  `CANCELLED`, or `NO_SHOW`).

### Manual Close

Only the Meeting host employee can explicitly close a Meeting at any time after it starts.

- Closing records `actualMeetingEnd` (ISO timestamp of the close action) and `meetingEndSource = MANUAL`.
- The host's close action applies immediately without a separate confirmation step.
- A Meeting can only be closed once.
- `extendMeeting` and `MANUAL` `closeMeeting` validate the actor employee identity against
  `meeting.hostEmployeeId`, verify that the Meeting has started, and reject Meetings whose
  linked Visits are all terminal at the service boundary.

### Automatic Close (Visitor Checkout)

When the last checked-in visitor in a Meeting is checked out, the Meeting is automatically closed.

- Automatically records `actualMeetingEnd` and `meetingEndSource = VISITOR_CHECK_OUT`.
- Auto-close fires only when: (a) there are no remaining `CHECKED_IN` visitors in the Meeting, and (b) the Meeting has not already been manually closed.
- If the Meeting was manually closed before the last checkout, no change is made to `actualMeetingEnd` or `meetingEndSource`.

### End-Time Variance

A signed variance in whole minutes is derived as: `actualMeetingEnd − plannedEnd`.

- Positive → meeting ran over planned time.
- Negative → meeting ended early.
- Zero → meeting ended exactly on time.
- Variance is derived and displayed; it is not stored as a separate field.

### Closed Meeting Behavior

Once a Meeting is closed (`actualMeetingEnd` is set):

- Resource assignment modifications are rejected immediately (service-layer guard).
- The Manager resource-assignment UI immediately becomes read-only even if linked Visits
  are not yet terminal.
- The Meeting no longer consumes room or equipment capacity in conflict / capacity calculations. Existing assignment records are preserved for audit purposes but do not affect availability of resources for other meetings.
- The close time, close source, and signed variance remain available in the Meeting domain
  projection; the Manager Visit Detail dialog intentionally does not display lifecycle UI.

### Lifecycle Action Visibility

- Manual lifecycle eligibility requires all of the following: the current employee is the
  Meeting host, current time is at or after `plannedStart`, `actualMeetingEnd` is absent,
  and at least one linked Visit is non-terminal.
- Manager role and Meeting creator identity do not grant lifecycle permission.
- The centered Manager Visit Detail dialog does not show lifecycle information or actions,
  including when the Manager is also the Meeting host.
- Host lifecycle actions are exposed only by the My Visits floating notification after
  `plannedEnd` arrives or passes.
- Lifecycle actions are never shown in Security UI screens (Security UI scope is a separate phase).

### Action-Required Panel in My Visits

- My Visits shows one persistent, actionable `İşlem gerekenler` panel. When a manually
  actionable Meeting hosted by the current employee reaches or passes `plannedEnd`, the
  panel includes it regardless of
  who created the Meeting. Meetings whose linked Visits are all terminal do not produce a
  notification even when historical data has no `actualMeetingEnd`. On desktop, the panel
  is fixed at the lower-right and does not take space from the personal timeline or Upcoming
  Visits layout.
- The notification offers +15 minutes, +30 minutes, a custom positive whole-number
  extension in a small anchored popover, and an immediate `Toplantıyı Bitir` action.
- A successful extension hides that Meeting's notification until its new `plannedEnd` is
  reached. Closing the Meeting removes its notification.
- Planned Visits created by the current employee whose invitation state is `NOT_SENT` or
  `FAILED` are listed as a distinct invitation-action group in the same panel. Their action
  opens the existing single-Visit invitation flow; `SENDING` does not require user action
  and is not listed. The left-navigation invitation notification behavior remains unchanged.
- Multiple qualifying actions are shown as distinct compact rows in one notification
  surface with an internal scroll area and total count. Meeting and invitation actions are
  visibly grouped. The panel can be minimized to a
  lower-right count control but notifications cannot be dismissed. No recurring popup or
  escalation is generated.
- Notification selection is host-scoped and independent from the creator-scoped personal
  calendar and Upcoming Visits data.

---

## 22D. Planned Vehicle and Driver Assignment

Managers can create a standalone planned assignment that always pairs one catalog `VEHICLE`
with one catalog `DRIVER`. This workflow is separate from Meeting room/equipment assignments
and does not change existing Meeting resource-assignment behavior.

### Business Rules

- Each assignment requires company, facility, planned date, a non-empty task/purpose, one
  vehicle, and one driver. Planned start and end times are optional together: both are supplied
  or both are omitted.
- A related Meeting or Visit may be selected, but is optional. One assignment may link to one
  Meeting or one Visit, not both; the linked record must be in the selected company and facility.
- Only active `VEHICLE` and `DRIVER` records in the selected company and facility are eligible.
- A time-less assignment reserves the selected vehicle and driver for the full selected day.
  Availability uses half-open planned time intervals. A vehicle or driver already used by an
  overlapping active assignment is unavailable for a new assignment. Adjacent assignments where
  one ends exactly when the other starts do not conflict.
- Availability and all required-field, active-state, scope, link, and conflict rules are verified
  at the service/domain boundary as well as reflected in the Manager UI. No override is available.
- Assignment records retain the vehicle and driver display details used at creation so the plan
  remains readable if a catalog record is later changed or deleted.
- Managers may edit an active planned assignment. Its replacement vehicle, driver, scope, time,
  purpose, and optional link are revalidated with the assignment itself excluded from conflict
  checking.
- Managers may cancel an active planned assignment. A cancelled assignment remains readable in
  the plan history, cannot be edited, and no longer reserves its vehicle or driver for availability.
- The Manager Dashboard shows only assignments whose planned interval contains the current time.
  It also exposes today's active Fleet assignments as distinct operation-chart event markers; those
  markers do not alter the visit-bar calculations.

Not included in this feature:

- Security unplanned-assignment UI,
- odometer input or monthly kilometre reporting,
- permanent/default vehicle-driver pairing,
- any change to Meeting room/equipment assignment behavior.

---

## 23. After-Hours Goods Delivery

Separate module.

Any employee may create an expected delivery.

Required:

- target facility,
- expected date,
- expected time/time window,
- supplier/company,
- goods/material description.

Optional:

- plate,
- driver,
- driver phone,
- related employee,
- department,
- note,
- order/delivery reference.

Recommended states:

- `EXPECTED`
- `ARRIVED`
- `COMPLETED`
- `CANCELLED`

Track both:

- actual arrival time,
- actual departure/completion time.

### Manager Goods Movement

Managers use one goods-movement record for both inbound and outbound operations. A record has
direction (`INBOUND` or `OUTBOUND`), company, facility, counterparty, required planned date and
optional planned time,
goods/description, optional reference number and note, and a stored status of `PLANNED`,
`COMPLETED`, or `CANCELLED`.

- `INBOUND` is labelled `Gelen`; its counterparty is the `Gönderen firma`, and completion is `Geldi`.
- `OUTBOUND` is labelled `Giden`; its counterparty is the `Alıcı firma`, and completion is `Çıkış yaptı`.
- A planned record with a planned time whose scheduled date/time has passed is derived as `Gecikti`;
  `LATE` is not stored. A record without a planned time remains `PLANNED` until completed or cancelled.
- Actual timestamp plus optional plate and driver name belong to the Security completion flow.
  They are retained on the model but are not exposed in Manager create/edit forms in this phase.
- Managers may create, edit, and cancel only `PLANNED` records. Completed records are read-only;
  cancelled records remain historical.
- The Manager Dashboard's existing goods-delivery marker source is the same goods-movement service.
  It shows markers only for today's planned inbound and outbound records that have a planned time,
  without changing visit-bar calculations. Records without a planned time remain in daily lists and reports.

If driver only hands goods over at the gate, the driver is not treated as a visitor.

If driver enters the facility, the driver must also go through the visitor workflow.

---

## 24. Multi-Facility Context

Support top-level company/facility context.

Managers/Admin may switch context.

Security may be restricted to its facility/gate and therefore not need a switcher.

---

## 25. Historical Metadata

Full user-facing audit-log module is not initially required.

Retain useful metadata such as:

- created by,
- created at,
- updated at,
- cancelled at,
- cancellation actor where applicable.

Rule acceptance history is immutable.

Normal users do not delete visit records.

---

## 26. Retention

Legal data retention period is not yet finalized.

Do not hard-code a permanent retention policy.

Architecture should permit retention rules later.

---

## 27. UX Principles

Prioritize:

- fast security operations,
- low form friction,
- compact information density,
- minimal unnecessary navigation,
- role-specific interfaces,
- clear statuses,
- predictable workflows.

Employee visit creation should remain compact.

Visitor pre-registration is mobile-first.

Internal application is desktop-first.

---

## 28. Delivery Strategy

The project is developed module by module.

The product was delivered incrementally: production-oriented UI/domain boundaries first, then
Fastify/Prisma/MSSQL persistence and HTTP integration. Runtime service composition now uses only
real HTTP adapters; tests use focused local fixtures, fakes, or stubs where isolation requires them.
