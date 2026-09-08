# UI_SPEC.md

# Visitor Management System — UI / UX Specification

## 1. Direction

Use a:

**modern, compact, minimalist enterprise interface**

The desired balance:

- mature enterprise information density,
- modern SaaS clarity,
- restrained styling,
- fast operational usability.

Do not create:

- a legacy ERP/Windows form look,
- a decorative consumer dashboard,
- glassmorphism,
- a marketing-page aesthetic.

---

## 2. Visual System

Use:

- neutral backgrounds,
- dark readable text,
- thin borders,
- subtle shadows,
- restrained border radius,
- compact tables,
- compact controls,
- consistent typography,
- one restrained accent color,
- semantic colors for status.

Avoid:

- large gradients,
- oversized KPI cards,
- oversized icons,
- excessive whitespace,
- decorative charts,
- unnecessary animation,
- visually noisy components.

---

## 3. Density

Operational desktop screens should expose useful amounts of information.

On a typical 1920×1080 security screen, aim to display roughly 10–15 visitor rows without excessive scrolling.

Compact does not mean cramped.

Spacing should clarify grouping.

---

## 4. Internal Application Shell

Desktop-first.

Recommended:

- collapsible left sidebar,
- compact top bar,
- main content,
- right-side drawer for quick operational actions where useful.

Sidebar and navigation are role-aware.

---

## 5. Visitor Public Flow

Mobile-first.

No internal sidebar.

Use:

- organization logo,
- short visit summary,
- visitor form,
- rules,
- acceptance,
- confirmation/QR.

---

## 6. Navigation

### Employee

- Home / My Visits
- Visits
- Goods Deliveries

### Security

- Dashboard
- Visitors
- Goods Deliveries

### Manager

- Dashboard
- Visits
- Goods Deliveries
- Reports

### Admin

- Dashboard
- Users
- Organization
- Visit Types
- Visitor Cards
- Visitor Rules
- Settings

Show only allowed routes.

---

## 7. Top Bar

May include:

- company/facility context,
- notifications,
- current user/profile.

The Manager notification list may be cleared in bulk. Clearing only dismisses the current
notification presentation and must not change Visit invitation domain states.

All role shells use one compact account-menu trigger. It shows an image avatar with initials
fallback and opens the same profile actions across Employee, Security, Manager, and Admin.
The Manager/Admin sidebar profile trigger opens this menu; it does not toggle sidebar collapse.

Example:

`Company B / Factory 1 ▼`

Security restricted to one site may not need the context switcher.

---

## 8. Components and Styling

Use Tailwind CSS and shadcn/ui.

shadcn/ui is a foundation, not a visual constraint.

Adjust component:

- padding,
- density,
- radius,
- table spacing,
- drawer width,
- form spacing

to match this specification.

Do not blindly accept default library spacing.

---

## 9. Tables

Tables are core.

Use:

- compact rows,
- sticky headers where useful,
- clear status chips,
- responsive column priority,
- one obvious primary action,
- secondary actions under a three-dot menu.

Use TanStack Table when advanced behavior justifies it.

---

## 10. Drawers

Prefer right-side drawers for:

- visitor detail,
- check-in,
- card assignment,
- visitor corrections,
- check-out.

This reduces navigation for security users.

---

## 11. Forms

Use compact grouped forms.

Use React Hook Form + Zod for non-trivial forms.

Use:

- labels above fields,
- clear required markers,
- inline validation,
- conditional fields.

Example:

Vehicle = No:
- hide plate.

Vehicle = Yes:
- show plate.

---

## 12. Employee Dashboard

Planning-oriented, not analytics-oriented.

Primary:

- page title,
- New Visit,
- Day / Week / Month,
- visit timeline,
- upcoming visits.

The timeline is Gantt-like but visitor-specific.

Do not use a full project-management Gantt library in the initial implementation.

Implement a focused timeline with React/Tailwind/CSS layout.

Visit blocks should show:

- visitor,
- time range,
- status.

Cancelled visits remain visible with muted/cancelled treatment.

The timeline and Upcoming Visits remain limited to Visits created by the current employee.
On desktop, use one persistent compact `İşlem gerekenler` panel fixed to the lower-right.
It contains every manually actionable Meeting hosted by the current employee whose planned
end has arrived or passed. A Meeting is manually actionable only after `plannedStart`, while it is explicitly
open, and while at least one linked Visit is non-terminal. Fully `CHECKED_OUT`, `CANCELLED`,
or `NO_SHOW` Meetings do not appear even if historical data lacks `actualMeetingEnd`. The
panel also contains planned Visits created by the current employee whose invitation is
`NOT_SENT` or `FAILED`; `SENDING` is not an actionable state. Keep invitation rows visibly
separate from Meeting rows and route their action into the existing single-Visit invitation
dialog. Do not change the left-navigation invitation notifications in this phase. The panel
must not push the timeline down. Each Meeting row must be distinguishable by
visitor/meeting context and expose +15, +30, an anchored custom-minute popover, and an
immediate `Toplantıyı Bitir` action. Multiple records scroll inside the panel and its header
shows the total action count. The user can minimize it to a lower-right
`N işlem gerekiyor` control, but cannot dismiss notifications. Extending
removes the row until the new end time; closing removes it permanently. Do not add these
host-only notification Meetings to the personal timeline/list, and do not use recurring
popups or escalation.

---

## 13. New Visit

Compact form.

Visitors:
- At least one visitor is required.
- Visitors can be added and removed without repeating shared meeting fields.
- First name, last name, and email are validated separately for every visitor.
- Visitor company is required and blocks Save when blank. Email and phone remain optional.
- Phone remains optional.

Shared meeting/visit information, shown once:
- Visit type
- Host employee
- Host company
- Facility
- Date
- Start
- End

Additional:
- Note
- Additional-requirement indicator and description

Actions:
- Save creates one Meeting and a separate Visit for every visitor.
- Send Invitation remains disabled until Save succeeds.
- Changing saved shared or visitor data requires another successful save before sending.
- The first Send Invitation action sends only the Meeting's visitors whose invitations
  have not already been sent.
- Invitation success or failure is shown and retained per visitor. Failed invitations can
  be retried individually.

Keep accessible labels and keyboard behavior, and focus the first invalid field when Save
validation fails.

Do not force employee to enter all visitor details that can later be completed by the visitor.

---

## 14. Security Dashboard

Top:

- visitor/QR search,
- Unplanned Visitor action.

Compact indicators:

- Inside
- Expected
- Overdue
- Cards Not Returned

Tabs:

- Expected
- Inside
- Overdue
- Completed

Main:
- visitor table.

### Unplanned Visitor Dialog

`+ Plansız ziyaret` opens one compact Security-desk dialog. It contains required first name,
last name, visitor company, free-text host/person, active visit type, optional plate, estimated
duration, available visitor-card selection, and the required `Ziyaretçi kuralları okudu ve kabul etti`
checkbox. The unplanned desk flow does not collect phone.

Estimated duration defaults to one hour. The dialog offers 30 minutes, 1 hour, 2 hours, 4 hours,
until noon (before 12:00), and until the configured workday end. The last two options are hidden
when their target time has passed. It is presented as a Security default rather than as a question
that must be asked of the visitor.

The dialog does not show e-mail, company/facility selection, planned start, or invitation state.
Its sole primary action is `Kaydet ve giriş yap`; it disables repeat submission, renders validation
and service errors in place, closes after success, and leaves existing search and panel state
unchanged. The new visitor immediately appears in `İçeride`.

---

### Security Goods Movements

Security `Mal Hareketleri` uses the same shell header, digital clock, and navigation as the
operations route. A single compact search input uses the placeholder `Firma, mal veya referans ara`.
There are no company/facility selectors, create/edit/cancel controls, date filters, or pagination.

The main area is two equal operation panels: `Gelenler · N` and `Gidenler · N`. Each panel shows
only today's scoped `PLANNED` records and renders `GECİKENLER` and/or `SIRADAKİLER` only when that
subsection has records. Rows show planned time (or `Saat belirtilmedi`), counterparty, truncated
goods description, optional muted reference number, and a light `Gecikti` state. The right-side
action remains fixed: `Geldi` for inbound and `Çıkış yaptı` for outbound. Empty panels state
`Bugün beklenen gelen hareket yok.` or `Bugün beklenen giden hareket yok.`.

The action opens a compact confirmation dialog with direction, counterparty, goods/description,
planned time, and optional `Plaka` / `Şoför adı` inputs. Its primary action is `Geldi olarak kaydet`
for inbound or `Çıkışı tamamla` for outbound. Repeat submission is disabled, errors render in the
dialog, and a successful completion immediately removes the record from the operational panel.

---

## 15. Security Visitor Drawer

Show:

- visitor,
- visitor company,
- host,
- host company/facility,
- visit type,
- planned times,
- rule acceptance,
- plate,
- note.

Do not show the additional-requirement description to the Security role.

Before check-in:
- visitor card selector,
- optional plate,
- optional phone,
- Check In.

The correction dialog reachable from here edits visitor name, company, phone and the host
display name as free text (no e-mail field, no host picker).

After check-in:
- actual check-in,
- current duration,
- planned end,
- overdue if relevant,
- Check Out.

Check-out supports:
- card returned,
- card not returned.

---

## 16. Overdue Alert

Do not use a weak disappearing toast.

Use a persistent actionable notification/alert.

Show:

- visitor,
- amount overdue,
- host,
- visitor card when relevant,
- action to open visit.

May be dismissed temporarily and reappear later.

Avoid a full-screen blocking modal by default.

---

## 17. Visitor Pre-registration

Mobile-first public page.

Suggested:

- logo,
- invitation title,
- date/time,
- facility,
- host,
- visitor details,
- company,
- phone,
- vehicle yes/no,
- conditional plate,
- rules,
- explicit acceptance,
- complete registration.

After completion:

- confirmation,
- QR,
- short visit summary.

---

## 18. Goods Delivery

Separate module.

Employee:
- create expected delivery,
- view own delivery records.

Security:
- expected,
- arrived,
- completed.

Important information:

- company,
- goods/material,
- facility,
- expected time,
- optional plate,
- optional driver.

Clearly show:

- gate-only delivery,
- driver entering facility.

---

## 19. Manager Dashboard

Initial indicators:

- Inside
- Expected Today
- Arrived Today
- Overdue
- Cards Not Returned
- Expected After-Hours Deliveries

Below:

- operational summaries,
- limited charts only when useful.

The upper operational surface is titled `Şu Anda Aktif` and uses two compact tabs:

- `Ziyaretçiler` retains the existing inside-visitor table and its filters.
- `Araç görevleri` lists only currently ongoing Fleet assignments in the selected Manager scope.
  Each compact, clickable row shows vehicle, plate, driver, purpose, and time interval and opens a
  read-only assignment detail dialog.

`Bugünün Operasyonu` preserves its visit-bar semantics. Today's Fleet assignments appear as a
separate vehicle-icon event marker, using the delivery-marker interaction pattern. Multiple Fleet
assignments show a count; a Fleet marker and delivery marker at the same hour sit side by side.
Selecting a Fleet marker lists that hour's assignments and lets the Manager open the read-only
detail dialog.

---

## 20. Reports

Filter-first.

Potential filters:

- date,
- company,
- facility,
- department,
- host,
- visitor company,
- visit type,
- status,
- plate,
- overdue.

Actions:
- Excel
- PDF

The table is primary.

Limit charts to useful summaries.

### Manager Reports

- A tabbed page (`Ziyaretler` | `Araç/Şoför` | `Mal Hareketi`) reachable from the Manager
  sidebar `Raporlar` entry. The active tab persists in the URL (`?tab=...`), omitted for the
  default `Ziyaretler` tab. All three tabs are implemented and enabled.
- A single filter bar sits above the tabs and stays fixed across tab switches: date range
  (default last 30 days, quick-select chips for `Bugün` / `Son 7 gün` / `Son 30 gün` / `Bu ay`,
  no maximum span) plus a company/facility scope control using the Dashboard's combined
  `Şirket: … · Tesis: …` dropdown pattern. All shared filters persist in the URL the same way
  All Visits filters do.
- A single "Dışa Aktar" button + dropdown (CSV/Excel/PDF) sits fixed at the top-right of the tab
  row, independent of the active tab, and triggers that tab's own export handlers.
- The `Ziyaretler` tab reuses the All Visits filter/sort core (`all-visits-utils`) rather than
  reimplementing it, but is a distinct, read-only reporting surface:
  - a compact summary row above the table, laid out horizontally: a narrow number-focused stat
    strip (small icon + value, total visits and average visit duration only), a compact
    read-only status-distribution donut in the same visual language as the Dashboard's
    `Durum Dağılımı` donut (covering `Planlandı` / `İçeride` / `Çıkış Yapıldı` / `Gelmedi` /
    `İptal Edildi` for the visits in the selected date range and scope), and a simple Recharts
    bar chart of daily visit counts across the selected date range,
  - a dense export-ready table with visitor, visitor company, host, date, planned and actual
    check-in/check-out, status, and delay-in-minutes columns,
  - no row click or detail dialog — the operational drill-down affordances from All Visits are
    intentionally not carried over,
  - CSV, Excel, and PDF export buttons that export the currently filtered and sorted result.
  - Unlike All Visits, it does not exclude Visits whose invitation state is `NOT_SENT`; a report
    must stay complete for audit purposes.
- The `Araç/Şoför` tab reads `PlannedTransportAssignment` (planned data only — no actual
  start/end or odometer capture exists yet):
  - KPI cards: total assignments, cancelled assignments, the cancellation rate, and the average
    planned duration (`plannedEnd − plannedStart`),
  - a dense export-ready table with purpose, vehicle (name + plate), driver, company/facility,
    planned start–end (reusing the existing untimed-daily-aware schedule formatter), status
    (`Aktif` / `İptal`), and the related Visit or Meeting if the assignment originated from one
    (otherwise `—`),
  - no row click or detail dialog,
  - CSV, Excel, and PDF export of the currently filtered result.
  - A vehicle distance/km report is a separate later mini-phase once odometer capture exists.
- The `Mal Hareketi` tab reads `GoodsMovement`:
  - KPI cards: total movements, inbound movements, outbound movements, and the late rate
    (derived with the same `getGoodsMovementDisplayStatus` logic the operational Goods
    Movements list uses),
  - a dense export-ready table with direction, company/facility, counterparty, planned
    date/time, actual time (if recorded, otherwise `—`), status (`Planlandı` / `Tamamlandı` /
    `İptal` / `Gecikti`), reference number (otherwise `—`), and the actual plate/driver recorded
    at completion (otherwise `—`),
  - no row click or detail dialog,
  - CSV, Excel, and PDF export of the currently filtered result.
- Each tab's table lives in a single bordered/shadowed card whose footer follows the Manager
  All Visits pattern: record-count text (`{start}–{end} / {total} kayıt`) on the left, page-numbered pagination on the right.

### Manager All Visits

- Remains a read-only operational list.
- Uses compact date-range, company, facility, status, visit-type, host, and additional-requirement filters.
- Excludes Visits whose invitation state is `NOT_SENT`; the list contains only operationally opened Visits.
- Persists filters in the URL and paginates the filtered result.
- Opens visit details in a centered, compact dialog which provides tabs for visit details and Meeting resource assignment.
- Uses separate Visitor and Visit Type columns and does not include a Tracking column; invitation delivery and additional-requirement details remain available in the detail dialog.
- Continues to show one row per visitor/Visit; do not redesign or group the table by Meeting.

### Manager Resource Catalog

- Matches the headerless Manager All Visits hierarchy: a compact filter card first,
  followed directly by the dense resource list and its pagination footer.
- Keeps an accessible non-visual page heading and places the Add action in the filter
  card instead of creating a separate visible title/action row.
- Uses company/facility/type/active filters and nine records per page.
- Lists rooms, pooled equipment, individual vehicles, and individual drivers together.
- Shows resource identity/details, user-facing type label, company/facility, quantity,
  and status without adding vehicle/driver-specific table columns.
- Shows vehicle brand, model, and license plate; shows driver full name, license classes,
  commercial-vehicle capability, and a compact document/qualification summary.
- Displays `—` for room, vehicle, and driver quantity and a numeric total only for pooled
  equipment.
- Uses one compact create/edit dialog with type-specific fields. Type can be selected only
  during creation and is read-only while editing.
- Requires name for rooms/equipment, positive whole-number quantity for pooled equipment,
  brand/model/license plate for vehicles, and full name plus at least one license class for
  drivers. Driver documents remain optional textual names; commercial-vehicle capability
  uses a user-facing Yes/No control.
- Clears an invalid facility selection when company changes.
- Keeps reversible active/inactive actions separate from permanent deletion.
- Places a visually distinct destructive `Sil` action in the edit dialog and requires a
  confirmation dialog before deleting the catalog record.
- Removes a successfully deleted resource from the catalog and all new-assignment pickers;
  historical Meeting assignment details remain readable from their stored snapshot.
- Provides loading, error, unfiltered-empty, and filtered-empty states.
- Reflows without page-level horizontal overflow at tablet and narrow widths.
- Does not expose fleet planning controls in the catalog itself, reservation overrides, notifications,
  or audit controls. Employees continue to use the additional-requirement note rather than selecting resources.

### Manager Planned Vehicle and Driver Assignment

- Uses a dedicated compact Manager page, reachable from Manager navigation, rather than changing
  the Meeting resource-assignment tab or the Resource Catalog table.
- Opens with company, facility, date, start time, and end time unset. Native company/facility
  controls use placeholder text rather than a selectable `Şirket seçin` or `Tesis seçin` option.
- Keeps the planning form, selected-time availability, and planned assignments visible together.
  It does not add dashboard KPIs or charts.
- Requires company, facility, date, task/purpose, one vehicle, and one driver. Start and end
  times are optional together; entering only one is invalid. When both are omitted, the vehicle
  and driver are reserved for the full selected day and the UI shows `Saat belirtilmedi`.
  The task/purpose control is a compact single-line field. A Meeting or Visit relationship is
  optional, expressed as an understandable `Bağlantılı kayıt` type plus optional record selector.
- Calculates and shows availability after company, facility, and date are complete and either
  both time fields are supplied or both are blank. Until then, an instructional state explains
  how to continue; it does not claim that no resources are available.
- Shows only active, selected-company/facility resources that are available for the chosen time.
  Vehicles and drivers use clear, compact selectable rows; a complete context with no matches
  shows the no-availability state.
- Initially lists upcoming active assignments. Company/facility selections narrow that list, and a
  complete company/facility/date context shows that day's assignments, including cancellations.
  The compact table shows three records per page at a fixed/minimum list height, with the visible
  record range at lower-left and content-sized dynamic pagination at lower-right. The table body
  does not scroll vertically; page-number positions remain stable while unavailable direction
  arrows disappear.
- Assignment rows remain clickable and open the existing centered detail dialog. Active assignments
  expose edit and cancel actions only in that dialog; the table has no inline action column.
- Editing switches the detail dialog into an edit form that preserves vehicle, driver, company,
  facility, date, optional paired times, purpose, and optional related record. The upper planning
  card remains create-only.
- The Resource Catalog remains the single source for vehicle and driver records; no catalog fields
  or fleet-pairing controls are duplicated on the planning page.

### Manager Goods Movement

- Sidebar `Mal Giriş / Çıkış` opens a compact Manager operations page aligned with All Visits,
  Resources, and Fleet pages.
- A compact top filter row provides search, date range, company, facility, direction, status, and
  `+ Yeni kayıt`; the dense table shows direction, counterparty, goods/description, scope,
  planned/actual times, and status.
- Row click opens a centered detail dialog. Planned rows can be edited or cancelled; completed rows
  are read-only. The create/edit dialog changes `Gönderen firma` to `Alıcı firma` with direction.
- Manager forms use the shared internal dialog structure with fixed top alignment, header, scrollable
  content, and footer. They separate `Planlama` and `Mal bilgisi` with a light divider; planned date is
  required and planned time is optional. The list shows `Saat belirtilmedi` when no time is supplied.
- Manager forms do not expose plate or driver fields. Dashboard delivery-style markers list both
  `Gelen` and `Giden` movements clearly only when a planned time exists, without adding a Dashboard surface.
- The fixed-height movement list does not scroll vertically. Pagination keeps its page-number
  positions stable while unavailable direction arrows disappear.

### Manager Meeting Resource Assignment UI

- **Tabbed Detail Dialog:** The centered Manager visit detail dialog, shared by `All Visits` and Dashboard `Sıradaki Ziyaretler`, includes two restrained text tabs: `Ziyaret Bilgileri` and `Kaynaklar`.
- **Tab Indicators:**
  - The `Kaynaklar` tab header displays a compact numeric count badge (e.g. `1`, `2`) when the meeting has active resource assignments.
  - The `Kaynaklar` tab header displays a small amber dot indicator when the local resource draft has unsaved changes.
- **Inline Editing & Pickers:**
  - Selecting a room displays an inline picker with real-time availability status (`Seç` button for available rooms; conflict reason text for unavailable rooms).
  - Selecting equipment displays an inline picker showing remaining available capacity (`X / Y kullanılabilir`).
  - Equipment quantity controls use explicit increment/decrement stepper buttons and numeric input validation capped at available capacity.
- **Local Draft & Unsaved Footer:**
  - All resource additions, replacements, quantity updates, and removals update a local working draft immediately without calling backend/service APIs.
  - When unsaved draft changes exist, a sticky bottom footer bar appears displaying `Kaydedilmemiş değişiklikler` with `Kaydet` and `Vazgeç` actions.
  - `Kaydet` triggers atomic save; `Vazgeç` restores the working draft back to the last persisted state.
- **Unsaved-Change Confirmation Guard:**
  - Attempting to close the centered dialog (via `✕` button, Escape key, or overlay click) while draft changes are unsaved is intercepted by a guard.
  - A modal confirmation dialog (`Kaydedilmemiş değişiklikler`) is presented with horizontally
    centered `Düzenlemeye dön` and `Kaydetmeden çık` actions. The latter discards the draft and
    closes the Manager Visit Detail dialog; the former returns to editing.
- **Read-Only UI State:**
  - For completed meetings (all visits `CHECKED_OUT`, `CANCELLED`, or `NO_SHOW`), the `Kaynaklar` panel is rendered in read-only mode, hiding all add, change, edit, remove, and save controls.
  - A Meeting with `actualMeetingEnd` is immediately rendered read-only even while one or more linked Visits remain non-terminal.

### Meeting Lifecycle UI

- The centered Manager Visit Detail dialog does not show Meeting lifecycle information or
  actions. Do not duplicate lifecycle UI there when the Manager is also the Meeting host.
- Manager role and Meeting creator identity do not grant lifecycle permission.
- Host-only lifecycle controls are available exclusively from the My Visits floating
  notification for overdue, manually actionable Meetings.
- `+15 dk`, `+30 dk`, `Özel`, and `Toplantıyı Bitir` remain in a stable action row. `Özel`
  opens a small anchored popover and does not reflow or reposition the action row.
- `Toplantıyı Bitir` applies the manual close immediately without a confirmation dialog.
- Dashboard `Sıradaki Ziyaretler` rows open the centered Manager Visit Detail dialog;
  `Tümünü gör` keeps its existing navigation behavior.
- Create, edit, reschedule, cancel, delete, and confirmation dialogs use `Vazgeç` for the
  applicable secondary action. Read-only information dialogs and operational drawers do not gain an
  unnecessary cancel action.
- The resource edit dialog keeps destructive `Sil` separately on the left; its right action
  group remains `Vazgeç`, `Aktife al`/`Pasife al`, and `Kaydet`.

---

## 21. Admin

Use one consistent management pattern:

- page title,
- Add action,
- search/filter,
- compact table,
- status,
- row actions.

Modules:

- Users
- Companies
- Facilities
- Gates
- Visit Types
- Visitor Cards
- Rule Versions
- Settings

Settings include:
- overdue tolerance,
- overdue alert repeat interval.

---

## 22. Responsive

Internal:
- desktop-first,
- tablet-usable.

Public visitor flow:
- mobile-first.

---

## 23. Accessibility

Use:

- visible focus,
- adequate contrast,
- semantic labels,
- keyboard accessibility,
- statuses not conveyed by color alone.

---

## 24. Interaction

Use restrained motion only:

- drawer transitions,
- loading skeletons,
- button feedback.

Avoid playful or decorative animation.

---

### Manager Visit Detail Dialog Update

Manager visit details use one centered, compact dialog for both Dashboard `Sıradaki Ziyaretler` and `All Visits`. The dialog body scrolls independently, retains the resource-assignment tabs and unsaved-draft close guard, and does not display Meeting lifecycle information or actions. Lifecycle management remains in the host-scoped My Visits floating notification panel.

## 25. Runtime Data Boundary

UI code created during early phases is retained.

Runtime data must be accessed through the existing frontend service interfaces and `Http*`
adapters. The UI must not bypass those boundaries or add a silent in-memory fallback. Focused
local fixtures, fakes, or stubs may remain for unit/component tests.
