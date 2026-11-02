# Inventory A: tickets, service catalogue, statuses, SLA, Business Rules, CSAT, data API

Read-only evidence inventory of the TICKET core of Citykart Desk, for the AI-assistant design team.
Prepared 2026-11-02 from the local repo `D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate` (branch `main`, HEAD `96bf6be`; working tree has uncommitted CKOneAI files, none of which touch the files cited here except `lib/data-api/params.ts` and `docs/CKDESK-DATA-API.md`, both modified but not committed).

How to read this file
- Every claim carries a path and a line (`file:line`) or a migration number (`M###` = `supabase/migrations/20240101000###_*.sql`).
- No database or server was queried. Anything that depends on live data (which SLA hours, which Business Rules, which business hours are configured) is marked **UNVERIFIED**.
- `types/database.ts` is generated and is slightly behind the migrations (for example it lacks the vendor-program tables); where they differ the migration wins.
- The user said request numbers look like "CKSD-123". The real format is zero-padded: `CKSD-000123` (see 1.6).

Roles used below (`lib/constants/roles.ts:11-17`): enum `user` shown as Requester, `agent` = Technician, `manager`, `admin`, `platform_owner`. Vendor (OEM engineer) is not a role value: it is `profiles.vendor_role` (`technician` or manager) plus `vendor_company_id` (`lib/vendor/access.ts`, `lib/rules/run.ts:163-168`).

---

## 1. Service catalogue and ticket creation

### 1.1 Tables

| Table | Purpose | Key columns (from `types/database.ts` + migrations) | Source |
|---|---|---|---|
| `services` | One row per service a requester can raise a ticket on (live: 17 rows, `docs/CKDESK-DATA-API.md:135`) | `id, org_id, name, slug, description, icon, icon_image_url, is_active, status (draft/review/published/retired), team_id (NOT NULL), default_priority, sla_policy_id, template_id, form_fields (legacy JSONB), form_sections (JSONB), owner_id, backup_owner_id, escalation_policy_id, approval_workflow_id, visibility, visibility_scope, version, keywords[], auto_oem_routing, sort_order` | M000 (base), M022 (status/owner/visibility/version), M037, M108 (template_id), M110 (sla_policy_id), M128 (auto_oem_routing), M111 (icon_image_url) |
| `service_categories` | Top level of the category tree (live: 112) | `id, org_id, name, slug, description, icon, is_active, sort_order, auto_oem_kind, auto_cvm_approval, show_approval_history, is_pms, program_id` | M000, M172 (auto_oem_kind), M174 (auto_cvm_approval), M183, M184 (is_pms), M186 (program_id) |
| `service_sub_categories` | Second level (live: 618). Carries the priority label | `id, category_id, name, slug, is_active, sla_priority (request_priority, nullable), sort_order` | M005, M110 (sla_priority added; the old per-sub-category `sla_config` hours were dropped) |
| `service_sub_category_tags` | Which sub-categories a service offers (many-to-many, but each sub-category belongs to at most ONE service: `UNIQUE (sub_category_id)`) | `service_id, sub_category_id` | M109 (create), M118 (unique) |
| `service_location_tags` | Which Locations (Head Office / Stores) may see a service | `service_id, location_id` | M127, data fix M189 |
| `form_templates` | Reusable intake form; a tagged service reads the template live | `id, org_id, name, description, form_sections JSONB, is_active` | M108 |
| `form_field_library` | Org-wide reusable field definitions linked into templates via `library_field_id` | `id, org_id, label, type, placeholder, help_text, options, is_active` (unique `(org_id, lower(label))`) | M141 |
| `sla_policies` | Named SLA table, mapped to services (live: 17) | `id, org_id, name, description, config JSONB, is_active` | M110 |
| `field_sla_overrides` | Per (service, form field, option) SLA hours that beat the policy | `service_id, field_id, option_value, sla_config JSONB, ...` | M092, M099 (atomic upsert) |
| `vendor_programs` (called "programs" in the data API) | Admin-defined service lines (AC, Genset, RO ...): own Google sheet, mail to vendor, optional vendor portal. Live: 4 rows | `id, org_id, name, slug, is_active (default false), level (mail/portal), row_type (store/machine), spreadsheet_id, tab_name, mail_subject, mail_body_html, ...` | M186, M187, M188, M191 |
| `teams` ("Technician Groups" in the UI) | Group of technicians a service routes to (live: 12) | `id, org_id, name, slug, prefix (unused for numbering), department_id, notification_email, is_active` | M000, M112 note |
| `team_members` | Group membership | `team_id, user_id, is_lead, org_id` | M000 |
| `requests` | The ticket | see 1.5 / 2 / 3 | M000 + many |

Category rules worth knowing
- A ticket has `category_id` and `sub_category_id` (M109:25-26). Only `sub_category_id` is accepted from the caller; `category_id` is derived from it server-side (`lib/requests/create-request-core.ts:213-222`, `lib/requests/resolve-sub-category.ts:24-52`).
- If a service has any sub-category tagged, a sub-category is REQUIRED ("Category is required.") and must be one of the tagged set ("Selected category is not valid for this service."); if none are tagged it is optional (`resolve-sub-category.ts:41-44`).
- A category can belong to at most one Vendor Program, and not to a program AND an AC/Genset OEM type or the PMS category (`service_categories_program_exclusive_check`, M186:82-84).
- `is_pms` categories (AC PMS) can only be raised by the daily job or by admin/platform_owner on the web form (`create-request-core.ts:223-227`). Services containing a PMS category are hidden from everyone except admin/platform_owner (`lib/queries/services.ts:94-114`).

### 1.2 Active / inactive and visibility rules (what a requester can actually see)

| Rule | Where | Detail |
|---|---|---|
| `services.is_active = false` hides the service | `lib/queries/services.ts:174-190` (`getServices`), `149-170` (`searchServices`), `257-270` (`getServiceBySlug`); creation also refuses it: `.eq('is_active', true)` at `create-request-core.ts:192` | "Archive" = `is_active=false` (`lib/actions/admin/services.ts:382-388`). Deleting is a separate action. |
| `services.status` filter | `lib/queries/services.ts:21-27` | admin and manager may see draft/review/published; everyone else (agent, requester, **and platform_owner, which is not listed**) sees published only. `retired` is never listed. |
| Location rule | `lib/services/location-visibility.ts:9-18`, `lib/queries/services.ts:69-92`, `create-request-core.ts:200-211` | Service is visible only if the person's `profiles.location_id` is among the ticked locations. No location ticked = visible ONLY to admin and platform_owner. A person with no location sees no service. Technicians and managers are NOT exempt when logging a ticket (checked against the ACTING user, also for "book on behalf"). Exempt: `admin`, `platform_owner`. M189 ticked every active location on pre-existing untagged services to keep behaviour unchanged. |
| Sub-category active | RLS `sub_categories_select` (M080:139-143) allows only `is_active = true` rows to normal users; admin/platform_owner have an all-rows policy | The picker and the creation check use the signed-in user's own client, so an inactive sub-category is not selectable by a requester. UNVERIFIED by test; no `is_active` filter exists in `getAllowedSubCategoriesForService` (`lib/queries/services.ts:241-255`) itself, it relies on RLS. |
| Category active | `service_categories.is_active` is toggled by admin (`lib/actions/admin/categories.ts:125-146`) but RLS `categories_select` is only `org_id = current_org_id()` (M033:165) | So an inactive CATEGORY is not hidden by RLS. Whether the form hides its sub-categories is UNVERIFIED (not checked in `DynamicForm`). |
| `services.visibility` (`all`/`agents_only`/`managers_only`) and `visibility_scope` | Written by admin UI (`lib/actions/admin/services.ts:173,251`) | **No read-side enforcement found** (grep of `lib/` and `app/` finds only the admin form). Treat as stored but not applied. |
| `services.escalation_policy_id` / `escalation_policies.rules` | Joined in `SERVICE_SELECT` (`lib/queries/services.ts:42`) | No executor found for `after_minutes` / `notify_backup_owner` anywhere in `lib/`, `app/`, `scripts/`. Stored but not applied. |
| `services.approval_workflow_id` | `lib/actions/requests.ts:1293-1307` | Not auto-started at creation (`create-request-core.ts:721-723`). Used only when a technician clicks "Send for Approval" (`submitForApproval`). The service page shows a "Requires approval" badge (`app/(app)/services/[slug]/page.tsx:100-105`). |
| Vendor logins | `lib/ui/requireStaff.ts` | A vendor (OEM engineer) is redirected away from `/services` and cannot raise tickets (`lib/actions/requests.ts:60`). |

### 1.3 Forms: field types, mandatory and conditional fields

Field types (`types/index.ts:168-185`): `text, textarea, number, date, select, multiselect, checkbox, radio, email, phone, file, toggle, store_address`.

Field properties (`types/index.ts:198-260`): `id, type, label, required, order, placeholder, help_text, options[] (value,label,children,archived), validation {min,max,integer,min_length,max_length}`, plus:

| Property | Meaning | Where enforced |
|---|---|---|
| `requester_can_view` / `requester_can_set` (absent = true) | Technician-only boxes: hidden from, or read-only to, the requester | `lib/forms/sections.ts:72-78`; a plain `user` role's submitted keys outside the settable set are dropped (`create-request-core.ts:286-292`) |
| `required` | Requester-mandatory if visible+settable (`isRequesterMandatory`, `sections.ts:94`); otherwise **technician-mandatory** (`isTechnicianMandatory`, `sections.ts:101`) | Requester: `validate-requester-form-completion.ts:66-95` called at `create-request-core.ts:371`. Technician: blocks ANY agent status move until filled (`lib/requests/status-change.ts:344-374`, `store_address` exempt). |
| `show_for_categories[]` (conditional field) | Field exists only for the listed categories; others drop the answer so it is neither required nor stored | `sections.ts:80-86`; `create-request-core.ts:282-284`; `status-change.ts:367` |
| `options_source` = `ac_units` / `program_machines` | Dropdown choices come from the requester's store AC sheet / the program's machine rows | `create-request-core.ts:302-358` (web channel only validates the pick) |
| `store_address` type | Always auto-filled from the requester's store; never editable | `create-request-core.ts:294-300` |
| `semantic_role` (`request_title`/`request_description`) | Used only by the WhatsApp conversational engine | `types/index.ts:250` |
| `library_field_id` | Link to Field Library; definition re-copied on save; reports group by it | `lib/forms/library.ts` |
| `file` type | A required file field is NOT checked at creation (a file can only be stored after the ticket exists). `confirmRequiredFiles()` after upload adds an internal note "A required file was not attached" | `create-request-core.ts:360-370` |

Resolution order for a service's form: if `template_id` is set the template's `form_sections` ARE the form (live reference, editing a template changes every tagged service at once); else the service's own `form_sections`; else the legacy flat `form_fields` wrapped as one "Request Details" section (`sections.ts:13-64`). A ticket stores a frozen copy: `form_sections_snapshot` and `form_schema_snapshot` (`create-request-core.ts:496-501`), so old tickets keep the form they were raised with.

Title of the ticket: the field labelled "Subject" if any, else first of text, textarea, select, radio, multiselect, else the service name; `"<Service>: <answer>"` form capped to one line and 200 chars (`lib/requests/title-field.ts`, `create-request-core.ts:381-409`).

Attachment rules (for "attach a file"): types jpeg, png, gif, webp, pdf, doc/docx, xls/xlsx, ppt/pptx, txt, csv, zip, mp4, webm, mp3, wav; SVG refused; 25 MB per file; 200 MB per ticket; 500 MB per user per day; magic-byte check; optional ClamAV (`lib/attachments/validate.ts:4-26`, `quota.ts:16-18`).

### 1.4 Owners and routing

| Concept | Implementation | Evidence |
|---|---|---|
| Service owner / backup owner | `services.owner_id`, `backup_owner_id` (profiles). **Recorded and shown in admin; no routing, notification or escalation code reads them** (only the data API exposes `owner_id`) | M022; `lib/actions/admin/services.ts:171,244-246`; `lib/data-api/entities.ts:113` |
| Default technician group | `services.team_id` NOT NULL is copied to `requests.team_id` at creation | `create-request-core.ts:462`, insert at `:484-508` |
| Email-intake team override | `teamIdOverride`, validated against the org | `create-request-core.ts:463-472` |
| Business Rules re-route | action `set_team`, `assign` (direct / round_robin / load_balanced / vendorCompanyId) | section 4 |
| Visibility of tickets | follows `team_id`: an `agent` sees a ticket only if in the ticket's group; manager/admin/platform_owner see all of the org. A rule-assigned technician must be in the group (or be a vendor technician) | `lib/actions/requests.ts:205-212`, `lib/rules/actions.ts:103-120` |
| Manual assign | `assignRequest`: open + assignee becomes `assigned`; unassigning an `assigned`/`in_progress` ticket returns it to `open`; a plain technician can only hand to a teammate and cannot unassign | `lib/actions/requests.ts:181-327` (status rule at `:249-252`) |
| OEM / program routing at creation | Category flag `auto_oem_kind` (ac/genset) or Vendor Program `program_id` mails the store's vendor/OEM, saves a snapshot, and moves `open -> in_progress` with `responded_at` set (unless the ticket is with a vendor technician) | `create-request-core.ts:593-648`, `lib/requests/master-routing.ts:117-131`, `lib/programs/routing.ts:153` |
| CVM auto approval | Category flag `auto_cvm_approval`: ticket goes `in_progress` then an ad-hoc approval to the store's CVM, status `pending_approval` | `create-request-core.ts:650-669`, `lib/cvm/auto-approval.ts:51-58` |
| Legacy tables | `assignment_rules`, `sla_escalation_rules`, `alert_rules` are no longer read at runtime; superseded by `business_rules` (M096). A one-time admin button converts them (`lib/actions/admin/business-rules.ts:171-260`) | M096 header |

### 1.5 How a ticket is created (the engine)

Entry points (all call the same core): web `createRequest()` (`lib/actions/requests.ts:52-166`), email intake, WhatsApp, API (`CreateRequestSource = 'web' | 'email_intake' | 'whatsapp' | 'api'`, `create-request-core.ts:51`).

Web pre-steps (`requests.ts:52-155`): signed in; not a vendor login; `requests` module enabled; `service_id` present; "book on behalf" only for agent/manager/admin/platform_owner and the target must be an active profile of the same org; 15-second double-submit guard (sha256 of requester+service+sub-category+project+answers, claimed atomically; a repeat returns the first ticket) (`lib/requests/submission-key.ts:8-44`).

`createRequestCore()` steps in order (`create-request-core.ts:150-726`):
1. Load active service of the org with team, template and SLA policy (`:187-198`).
2. Location check for the acting user (`:200-211`).
3. Validate sub-category, derive `category_id` (`:219-222`); PMS guard (`:224-227`).
4. Resolve form, drop category-inapplicable answers, drop non-settable keys for role `user`, force `store_address` (`:232-300`).
5. AC / machine pickers validated for web (`:302-358`).
6. Mandatory-field gate; first missing field returns `"<label> is required."` (`:371-378`).
7. Title (`:381-409`).
8. Priority (`:426`), SLA deadlines (`:449-457`), team (`:462-472`), `source_metadata.created_via` (`:477-480`; web is stored as `portal`).
9. INSERT into `requests` with `request_no: ''` (trigger fills it), `status` default `open`, deadlines in the insert (`:482-510`).
10. `request_automation_state` row started (M190; `markAutomationStarted`, `:518`) so an interrupted ticket can be re-run ("Run automation again" / 15-min retry, 3 tries then "Stuck tickets").
11. SLA safety net: if deadlines could not be written or the calendar was unreadable the ticket is logged `create_request.sla_missing` and is NOT marked finished (`:520-548`).
12. Save AC / program snapshots BEFORE rules (`:550-570`).
13. Run Business Rules trigger `created` (`:572-581`).
14. Activity `created` (`:583-591`).
15. OEM / program mail, CVM approval (`:593-669`).
16. Notify requester ("ticket logged"), or the requester if booked on behalf, and the (post-rule) team members (in-app only) (`:671-719`).
17. Mark automation finished (`:725`). Result: `{requestId, requestNo}`.

Not done at creation: no approval is auto-created from the service's workflow; no automatic assignment unless a Business Rule does it; status stays `open` (DB guard on user writes allows only `open`/`pending_approval` at insert, M163:34-37).

### 1.6 Request numbers

- Format `CKSD-` + zero-padded counter: `CKSD-000123`; from 1,000,000 up unpadded `CKSD-1000000` (M117 created the series; M159 fixed the LPAD truncation after 999,999).
- Generated by `generate_request_no()` (SECURITY DEFINER) from table `request_sequences` (one global `CKSD` counter, not per org, not per team prefix). A BEFORE INSERT trigger `trg_requests_assign_no` overwrites `request_no` (M112:30-37). `requests.request_no` is `UNIQUE NOT NULL` (M000:260).
- History: M112 made one org-wide `CK-0001` series (teams.prefix no longer used); M117 switched to `CKSD-000001`.
- A signed-in user cannot change `request_no` or `created_at` (`guard_request_client_write`, M163:40-49).

### 1.7 Priority: derived, never typed

- Enum `request_priority` = `low, medium, high, urgent` (M000:27). `requests.priority` NOT NULL default `medium`.
- At creation: `priority = priorityOverride ?? sub_category.sla_priority ?? service.default_priority` (`create-request-core.ts:426`). `priorityOverride` is only passed by Email Intake after a human reviewer confirmed it (doc comment `:112-124`); web, WhatsApp and API never set it.
- After creation priority changes ONLY through: (a) `updateRequestCategory(requestId, newSubCategoryId, reason>=10 chars)` which re-derives priority from the new sub-category's `sla_priority` (keeps the old one if the new sub-category has none) and recomputes both deadlines (`lib/actions/requests.ts:949-1081`, priority at `:1006`; refused on resolved/closed/cancelled `:990`); (b) a Business Rule action `set_priority` (`lib/rules/actions.ts:256-299`).
- There is deliberately NO `changePriority` / `bulkChangePriority`, for any role (comment `lib/actions/requests.ts:934-936`, guard test `tests/unit/no-priority-change.test.ts`; shipped build 20261015-145217 per memory). Ticket page priority is read-only.
- A service-change is also not possible ("The service of a ticket cannot be changed", `requests.ts:938`).

---

## 2. Ticket statuses

### 2.1 Enum values (exact)

`request_status` (M000:16-25 plus M148:10): `pending_approval, open, assigned, in_progress, waiting_user, resolved, closed, cancelled, hold_purchase_ho` (9 values). UI labels (`lib/constants/requests.ts:19-28`):

| Value | Label | Meaning in the app | SLA clock |
|---|---|---|---|
| `open` | Open | New, or reopened, or un-assigned. May already HAVE a technician (a Business Rule assign leaves status `open`, B-31, `lib/rules/actions.ts:216-219`) | running |
| `assigned` | Assigned | Set ONLY by `assignRequest()` when an `open` ticket gets a person, or by approval-rejection reopen. Not a manual dropdown choice | running |
| `in_progress` | In Progress | Work started: via the "Start Working" button (mandatory first-response message auto-written), or auto from OEM/program mail or CVM approval | running |
| `waiting_user` | Waiting on User | Technician needs the requester; message mandatory | PAUSED |
| `hold_purchase_ho` | Hold due to Purchase from HO | Technician-only hold (also used by vendor "part required / PO required / revise price" requests); note mandatory both ways | PAUSED |
| `pending_approval` | Pending Approval | An approval is open (ad-hoc "Send for Approval", workflow, or CVM auto approval); `pre_approval_status` remembers what to return to | PAUSED |
| `resolved` | Resolved | Fixed; resolution note mandatory (>=10 chars, must say cause and fix, no password: `lib/requests/resolution-note.ts:36-43`); opens the reopen window and CSAT | stopped (finished) |
| `closed` | Closed | Final. Reached only by auto-close after the reopen window (or a Business Rule `set_status closed` from resolved) | finished |
| `cancelled` | Cancelled | Final, except an approval-rejected / PO-rejected cancel which the requester may reopen within 48 h | finished |

Groupings: `OPEN_REQUEST_STATUSES` = open, assigned, in_progress, waiting_user, hold_purchase_ho, pending_approval (`requests.ts:6`); `PAUSED_SLA_STATUSES` = waiting_user, hold_purchase_ho, pending_approval (`:12`); `CLOSED_LIKE` = resolved, closed, cancelled (`:16`); `TERMINAL_STATUSES` = closed, cancelled (`:72`). Project roll-up groups: `lib/constants/status-groups.ts:22-32`.

### 2.2 Allowed transitions (UI/server action level)

Source of truth `lib/constants/request-transitions.ts`; enforced by `applyStatusChange()` (`lib/requests/status-change.ts:162-500`).

| From | Agent / manager / admin (`AGENT_TRANSITIONS`, :35-48) | Requester (`REQUESTER_TRANSITIONS`, :68-80) | Vendor technician (`VENDOR_TRANSITIONS`, :55-65) |
|---|---|---|---|
| open | cancelled (+ Start Working to in_progress; + Assign makes it `assigned`) | cancelled | in_progress |
| assigned | cancelled (+ Start Working) | none | in_progress |
| in_progress | waiting_user, hold_purchase_ho, resolved, cancelled | none | resolved, hold_purchase_ho |
| waiting_user | in_progress, resolved | open, cancelled (a reply in the conversation also auto-resumes to in_progress) | none |
| hold_purchase_ho | in_progress | none (requester can neither set nor leave it) | in_progress |
| pending_approval | none (only the approval decision or a recall moves it) | none | none |
| resolved | open (agent reopen) | open (requester reopen, window + reason) | none |
| closed | none | none | none |
| cancelled | none | `assigned` via the special approval-rejection reopen | none |

Who counts as "agent" for a ticket: manager, admin, platform_owner, or an `agent` who is a member of the ticket's `team_id`, or the assigned vendor technician (`status-change.ts:199-205`). Requester = `requests.requester_id`.

Mandatory remarks (`status-change.ts`): cancel `:299` (both roles, "explain why"); reopen `:282` and `:289`; waiting_user `:325`; resolved `:329-332`; hold `:337`; hold-to-in_progress `:340`. First "Start Working" with no text auto-posts "Hello X, <tech> has started working on your request <no>..." (`:309-320`, `lib/requests/first-response.ts`).

Server-side only list (`SERVER_ALLOWED_TRANSITIONS`, :87-95) used by Business Rules `set_status` (`rules/actions.ts:304`) and equal to the database function `request_status_transition_allowed()` (M163; latest definition M179:19-29) PLUS `resolved -> closed`. Extra pairs vs the table above: assigned->open, waiting_user->open, hold_purchase_ho->cancelled (PO rejected), resolved->closed. A signed-in user writing directly to the table is blocked by trigger `guard_request_client_write` (M163:33-55); since M165 user writes to `requests` are server-only anyway.

### 2.3 Reopen rules

| Case | Who | Condition | Effect | Evidence |
|---|---|---|---|---|
| Resolved -> open | Requester | `reopen_deadline_at` (stored when resolved) not passed; reason mandatory | `reopen_count + 1`, `resolved_at`/`closed_at` cleared, SLA reset (see 3.5), OEM mail resent, vendor told | `status-change.ts:239-291`, `:412-416`, `:546-564`, `:600-605` |
| Resolved -> open | Agent | No deadline; reason mandatory | same, counted as a reopen | `:246-248`, `:289` |
| Reopen window length | admin setting `app_settings.auto_close_days` (whole days, default 3 = 72 h) | stored per ticket as `reopen_deadline_at = now + hours` at resolve | `lib/settings/reopenWindow.ts:19-40`, M138, `status-change.ts:404-407` |
| Cancelled (approval rejected) -> assigned | Requester only | `cancellation_reason='approval_rejected'` and `reopen_deadline_at` (fixed 48 h) in the future | returns to the same technician as `assigned`; SLA reset | `status-change.ts:231-237`, `lib/approvals/decision.ts:418` (`REOPEN_WINDOW_HOURS = 48`), M114 |
| Cancelled (manual) | nobody | permanent (`cancellation_reason='manual'`) | | `status-change.ts:390-392` |
| Auto close | cron `csat` job (every 30 min) | `status=resolved` and `reopen_deadline_at < now` | `closed`, bell only, history entry `via: auto_close` | `lib/requests/auto-close.ts:14-60`, `app/api/csat/run/route.ts` |
| Reopen from the e-mail link | Requester (no login) | signed CSAT token, same rules as in-app | `applyStatusChange(..., 'open', reason)` | `lib/actions/csatPublic.ts:40-63` |
| Closed | nobody | "closed has no outgoing transitions" | | `request-transitions.ts:28-32` |

Other status writers (not in the matrix): requester reply in `waiting_user` -> `in_progress` with pause credit (`lib/actions/requests.ts:826-871`, email version `lib/requests/email-reply-comment.ts:106`); approval decisions/recall (`lib/approvals/decision.ts`, `recall.ts`); vendor flows `start/resolve/hold/resume` (`status-change.ts:104-109`); PO approve/reject (`:102`).

### 2.4 `hold_purchase_ho`

Added by M148 (`ALTER TYPE ... ADD VALUE`). Only a technician (or vendor technician via the "Part required"/"PO required" windows) can enter it, only from `in_progress`; leaving returns to `in_progress` (note required) or `cancelled` when a PO is rejected. It pauses the SLA like `waiting_user` (`status-change.ts:418-440`). Home dashboard counts it as open (M149, M193). Vendor boxes: shown as `po_required` / `revise_price` / `part_required` depending on the hold kind (`lib/vendor/access.ts:70-80`). Starting a hold from a Citykart technician side cancels any open vendor hold request (`status-change.ts:485-492`).

### 2.5 Status history completeness (matters for the data API `request_status_history`)

History = `request_activity` rows with `action='status_changed'`. NOT written as `status_changed`: the initial `open` at creation (only `created`), `open <-> assigned` caused by assign/unassign (only `assigned`/`unassigned`, `lib/actions/requests.ts:288-296`), and a Business Rule assignment (no status change). A rule-driven `set_status` logs `{to, via, rule_id, rule_name}` WITHOUT `from` (`lib/rules/actions.ts:428-430`), so `from_status` is NULL for those rows in the API (`lib/data-api/entities.ts:94`). A recall of an already-moved ticket logs `status_changed` with no from/to (`lib/approvals/recall.ts:101`).

---

## 3. SLA

### 3.1 Model

Three layers resolved at ticket time, tightest wins at field level (`lib/sla/resolve.ts:88-131`):
1. `field_sla_overrides` for (service, selected option value, priority); if several selected options carry hours, the MINIMUM hours win, response and resolution independently (`resolve.ts:28-67`).
2. else the service's `sla_policy.config[priority]`.
3. else no deadline (the org-wide `global_sla_config` screen was removed; tables remain but `lib/` does not read them. `resolve.ts:19-21`).

`sla_policies.config` JSON shape (`types/index.ts:285-295`): `{ low|medium|high|urgent: { response_hours: number|null, resolution_hours: number|null } }`. Hours are clamped to >= 0 and non-finite values become null (`resolve.ts:116-122`). Priority comes from 1.7. Live policy values are **UNVERIFIED** (not in repo; 17 `sla_policies` rows exist on live per `docs/CKDESK-DATA-API.md:222`).

Sub-categories carry only a priority label, never hours (M110).

### 3.2 Business hours and holidays

- Tables `business_hours` (`day_of_week 0-6, start_time, end_time, is_active`, one row per weekday, UNIQUE) and `holidays` (`date, is_recurring, name`); both GLOBAL (no `org_id`); M017. Seed default Mon-Fri 09:00-17:00, Sat/Sun inactive. The live values are **UNVERIFIED** (admin edits them at `/admin/request-config?tab=business-hours`; the code handles a 24x7 calendar specially).
- `computeSLADeadline(start, minutes)` (`lib/sla/business-hours.ts:113-177`) walks the calendar day by day inside each active window, skipping inactive days and holidays (recurring holidays match month+day, `:58-75`). A window 00:00-23:59 is treated as the whole day to 24:00 (`:89-93`). Timezone: process local time (the app runs with `TZ=Asia/Kolkata`, comment `:61-67`). If no usable window exists it returns `null` => ticket gets no deadline, logged and alerted (`:159-176`).
- The calendar is read with the server key (cron, WhatsApp, PMS job have no browser session) (`:14-18`).

### 3.3 Stored vs computed

| Item | Stored on `requests` | Computed |
|---|---|---|
| `response_due_at`, `resolution_due_at` | stored at creation (insert, B-26) and rewritten on: resume from pause (shifted later), sub-category change, Business Rule `set_priority`, reopen (resolution only) | |
| `responded_at` | stored: set by first agent move to `in_progress`/`assigned` (`status-change.ts:443-445`), first PUBLIC agent comment (`lib/actions/requests.ts:739-748`), OEM/CVM auto-start (`master-routing.ts:123`) | |
| `waiting_since` | stored: start of the CURRENT pause (set for waiting_user, hold_purchase_ho; for pending_approval set by `approvals/adhoc.ts:76` keeping an earlier pause start) | |
| `paused_ms_total` | stored: cumulative credited pause (business-time ms) | |
| `resolved_at`, `closed_at`, `reopen_count`, `reopen_deadline_at` | stored | |
| Breached / at risk / on track / % elapsed | **not stored** | computed at read time from the columns above |
| Response vs resolution | two separate columns and two separate "breached" notions (below) | |

### 3.4 Pause and resume

- PAUSE statuses: `waiting_user`, `hold_purchase_ho`, `pending_approval` (`lib/constants/requests.ts:12`; the comment says the server pauses on exactly these). Entering sets `waiting_since = now` (`status-change.ts:418-421`; approvals `adhoc.ts:76`).
- RESUME: leaving `waiting_user` or `hold_purchase_ho` in `applyStatusChange` (`:423-440`), a requester reply in `waiting_user` (`lib/actions/requests.ts:845-856`), an email reply (`email-reply-comment.ts`), and approval approve/reject/recall (`lib/approvals/decision.ts:55-72` `creditHoldTime`, `recall.ts`). Mechanism: both `response_due_at` and `resolution_due_at` are moved LATER by the pause, credited in BUSINESS minutes when the calendar has gaps and wall-clock for an always-on calendar (`business-hours.ts:223-258`), and the same credit is added to `paused_ms_total`. While paused the deadlines do NOT move; they move once, when the pause ends.
- Consequence for reading data: a ticket in a paused status shows a stale `resolution_due_at` until it resumes; it is never "breached" while paused.

### 3.5 Reopen resets the clock

`resetSlaAfterReopen` (`status-change.ts:119-160`): recomputes `resolution_due_at` from NOW (field override > policy), clears `resolved_at`, `closed_at`, `waiting_since`, sets `paused_ms_total = 0`. `response_due_at` is NOT recomputed on reopen. Later re-classification counts from the last `reopened` activity (`slaClockStart`, `resolve.ts:142-157`).

### 3.6 Breach definitions (the code has four, kept deliberately separate: `lib/sla/breach.ts:1-31`)

| Name | Rule | Code |
|---|---|---|
| Currently breached (live ops number; Home, Monitoring, Smart Dashboard) | `resolution_due_at < now` AND status not in resolved/closed/cancelled AND not in the paused statuses | `lib/sla/breach.ts:66-70`; SQL twin in `get_home_dashboard` (M193:68-72, 87-88); executive `breachedAt` `lib/reporting/executive/engine.ts:154` |
| Ever breached / resolved late (Report Builder column `is_sla_breached`) | resolved or closed time > `resolution_due_at`; still-open past the deadline also counts | `breach.ts:77-81`; `lib/queries/reporting.ts:305` (tickets cancelled by approval flow and never resolved count as not breached, F-12) |
| Response breached (`is_response_sla_breached`) | `responded_at > response_due_at`, or unanswered and now > `response_due_at` | `breach.ts:84-87`, `reporting.ts:306` |
| Data API `resolution_breached` / `response_breached` | `resolved_at > resolution_due_at` / `responded_at > response_due_at`; NULL while not resolved / not answered / no target. This is "resolved late" only; it says nothing about open tickets | `lib/data-api/entities.ts:77-82` |
| SLA compliance % (Smart Dashboard) | of tickets resolved in the window that HAVE a deadline, share with `resolved <= due` | `lib/reporting/executive/engine.ts:335-337, 348` |

Timestamps are compared as real instants, not text (F-03, `breach.ts:54-60`).

### 3.7 "About to breach": exactly what the code supports

There is NO stored "about to breach" flag and no single official definition. Two read-side definitions exist, plus one configurable scheduled rule:

1. **UI badge "At risk"** (ticket lists/detail): `now <= resolution_due_at` and `(due - now) < 4 hours` in plain WALL-CLOCK hours (not business hours), for a ticket that is not finished and not paused. `lib/utils.ts:15-27` (`computeSLAState`: `'none'` for closed-like or paused, `'breached'` if due < now, `'at_risk'` if < 4 h, else `'on_track'`). The badge uses `resolution_due_at ?? response_due_at` (`components/requests/SLABadge.tsx:60`). The 4 h is a hard-coded constant, not per priority. A paused ticket shows "On Hold - <reason>" instead (`SLABadge.tsx:36-47`).
2. **Percentage elapsed** (configurable, per rule): Business Rule with trigger `schedule`, `schedule_check='sla_pct_elapsed'`, `schedule_threshold` N. Fires once per (rule, ticket) when `elapsed business minutes since the SLA clock start, minus completed and live pauses, divided by the SLA length (business minutes between clock start and `resolution_due_at`, minus `paused_ms_total`) * 100 >= N`. Considers every non-finished ticket with a `resolution_due_at`, paused ones included (their live pause is subtracted so the % does not climb). Cron every 15 min. `app/api/business-rules/run/route.ts:176-203`; dedupe table `business_rule_events` UNIQUE(rule_id, request_id). The legacy escalation seed was Urgent 75%, High 80%, Medium 85%, Low 90% (M018 seed, M095 renamed critical to urgent; names "Urgent/High/Medium/Low Warning"). Whether equivalent Business Rules exist on live is **UNVERIFIED**.
3. **Manual "Nudge"**: manager/technician reminder, reuses notification type `sla_warning` with `metadata.nudge='1'`, 4 h cooldown, only for open/assigned/in_progress (`lib/requests/nudge.ts:9-14`).

Not supported: `alert_rules` types `sla_warning`/`sla_breached` exist in the DB enum but the alerts cron has no branch for them (`app/(app)/admin/request-config/AlertRulesClient.tsx:25-29`; `app/api/alerts/run/route.ts` handles due_soon/overdue for tasks and milestones, `unassigned` for requests, `daily_digest`). So a data question "which tickets will breach in the next X hours" must be computed from `resolution_due_at` and `status`, not read from a flag, and must exclude paused and finished statuses. Business-hours caveat: `resolution_due_at` is already a business-calendar instant, so "hours until due" in wall-clock overstates urgency across nights/weekends compared with rule 2.

### 3.8 Escalation

- Legacy `sla_escalation_rules` (`name, tier (low/medium/high/urgent), trigger_pct 1-100, notify_roles[]`) and `sla_escalation_events` exist (M018, constraint M095). The old runner route `app/api/escalation/run` NO LONGER EXISTS in the repo; the docs that mention it are history (`docs/ARCHITECTURE.md`, `docs/RAILWAY-DEPLOYMENT.md`).
- Live escalation = Business Rules with `sla_pct_elapsed` + `notify` action (above). Cron task `CitykartDesk-Cron-BusinessRules` every 15 min "scheduled business rules / SLA escalation" (`scripts/windows/install-cron-tasks.ps1:7`).
- `escalation_policies` / `services.escalation_policy_id`: not executed (see 1.2).

---

## 4. Business Rules engine

Tables: `business_rules` (M096, M097 round-robin state `last_assigned_index`, M098 multi-trigger + AND/OR), `business_rule_events` (fired-once log for schedule rules). Columns: `name, description, is_active, trigger text[] (created/updated/schedule), schedule_check (sla_pct_elapsed | unassigned_minutes), schedule_threshold, conditions JSONB, conditions_logic (AND|OR), actions JSONB, execution_order`. RLS: org-scoped, manager/admin/platform_owner read and write (M096:44-52); admin UI `/admin/business-rules`, write capability `business_rules.write` (`lib/actions/admin/business-rules.ts:14-17`).

Note: there is no HTTP route named for "created/updated"; the endpoint `/api/business-rules/run` (`app/api/business-rules/run/route.ts`) is ONLY the scheduled-trigger runner (cron secret, GET). `created` and `updated` rules run inline in code.

### 4.1 Triggers

| Trigger | When | Code |
|---|---|---|
| `created` | Inside ticket creation, after the SLA and snapshots are saved | `create-request-core.ts:575-577` |
| `updated` | After every `applyStatusChange` (`status-change.ts:742-748`) and after `updateRequestCategory` (with `allowReassign: true`, `requests.ts:1069`); other edit paths UNVERIFIED | `lib/rules/run.ts:255-290` |
| `schedule` | Cron `business-rules` every 15 min; checks `sla_pct_elapsed` (resolution SLA %) or `unassigned_minutes` (open, `assigned_to` null, created more than N minutes ago) | `app/api/business-rules/run/route.ts:35-113, 176-215` |

A rule can have several triggers. `created`/`updated` rules run in `execution_order`, ALL matching rules execute (not first-match), the ticket is re-read after each matching rule so later rules see earlier writes (`run.ts:279-289`). A schedule rule fires at most once per ticket (claim row inserted first, kept after any success, released only if nothing worked: `route.ts:123-161`).

### 4.2 Conditions

Fields (`lib/rules/evaluate.ts:1-39`): `priority, status, service_id, category_id, sub_category_id, template_id, team_id, project_id, assigned_to, requester_id, requester_role, requester_department_id, requester_location_id, requester_designation_id, requester_function_id, title, description, source_channel, is_sla_breached, has_attachment, age_days, form_field (by form_field_id or library_field_id), ac_amc_vendor, ac_brand, store_region, store_state, store_cluster, store_city, store_priority, store_festival, store_open_months, vendor_line, vendor_company_id, is_with_vendor, requester_store_id`.

Operators (`:41-53`): `equals, not_equals, contains, not_contains, is_empty, is_not_empty, in, not_in, gt, gte, lt, lte` (gt.. numeric; contains is case-insensitive; array values match per element).

Logic: per condition `logic` AND/OR against the previous one, sum-of-products with AND binding tighter; legacy `conditions_logic` only for conditions without their own `logic`; empty list matches every ticket (`:211-229`).

Derived facts built in one place for all triggers (`run.ts:161-198`): `is_sla_breached` = `isSlaBreached` (`run.ts:79-86`; resolved/closed late counts as breached; paused is not breached), `age_days` = whole days since creation, `source_channel` from `source_metadata.created_via`, store facts from the store card first then AC / program snapshot as fallback, `has_attachment` (non-deleted attachment exists).

### 4.3 Actions (`lib/rules/actions.ts:24-44`)

| Action | Params | Behaviour and guards |
|---|---|---|
| `assign` | `strategy` direct / round_robin / load_balanced, `assigneeIds[]`, optional `vendorCompanyId` (all active technicians of that vendor company) | Candidates must be active, same org, on the ticket's team (or a vendor technician). Round robin uses compare-and-set on `last_assigned_index` (12 tries). load_balanced = fewest non-finished tickets. On an `updated` trigger it only fills an empty slot (or replaces an inactive person) unless `allowReassign`; never takes a ticket away from a vendor technician. Status stays as is (rule-assigned ticket remains `open`). Logs `assigned` with `via: business_rule`; notifies assignee and requester (`:122-253`). |
| `set_priority` | `priority` | No-op if same. Recomputes both deadlines from the SLA clock start; finished tickets only get the priority recorded. Logs `priority_changed` `via: business_rule` (`:256-299`). |
| `set_status` | `status` | Only moves allowed by `SERVER_ALLOWED_TRANSITIONS` (VAPT-008), re-checks that the status is unchanged, replicates pause/resume, reopen and timer bookkeeping, starts CSAT on resolve (`:301-444`). |
| `set_team` | `teamId` (same org) | Re-routes to another technician group; logs `reclassified` (`:446-462`). |
| `notify` | `roles[]`, `notifyAssignee`, `notifyRequester`, `channels` in_app/email | Recipients = union; in-app type `business_rule_notification`; email via `sendEmail`, failures alerted (`:464-565`). |

Actions run in array order and a failure in one does not stop the rest; each action's patch is folded into the ticket the next action sees (`:574-606`).

---

## 5. CSAT

### 5.1 Tables and rating scale

`csat_surveys` (M038:11-22, M151): `id, org_id, request_id (UNIQUE, one survey per ticket), requester_id, rating SMALLINT CHECK 1..5 (nullable), comment, sent_at (default now), submitted_at (nullable), reminder_sent_at`. Scale 1-5; labels in the portal: 1 Terrible, 2 Poor, 3 OK, 4 Good, 5 Excellent (`components/requests/CsatSurvey.tsx:8`). A 1 or 2 requires a comment (`lib/actions/requests.ts:1618`, `lib/actions/csatPublic.ts:17`; `LOW_CSAT_MAX = 2` `lib/csat/alerts.ts`). Signed-in users can update only `rating, comment, submitted_at` (M192:79-80).

### 5.2 Flow

1. A ticket becomes `resolved` (by technician, vendor, or Business Rule `set_status`): `issueCsat()` inserts the survey row (`sent_at = now`) and e-mails the requester ONE mail "resolved + how did we do" with five star links and a reopen link, all tied to a signed token (HMAC, 30 days, secret `csat_link`); if CSAT is off, no secret, or no address the plain "resolved" mail is sent instead (`lib/csat/issue.ts:57-109`, `lib/csat/token.ts:9-42`, `status-change.ts:520-540`).
2. If the same ticket is resolved again after a reopen, the survey is RESET (`rating, comment, submitted_at` null, `sent_at` now, `reminder_sent_at` null) (`issue.ts:82-86`). So one row per ticket holds only the latest attempt.
3. Requester rates either on the ticket page (`CsatSurvey` component, `submitCsatRating`, only while ticket is resolved/closed, `lib/actions/requests.ts:1606-1643`) or from the e-mail link `/csat/<token>` (`app/csat/[token]/CsatPublicForm.tsx`, `submitRatingByToken`, `lib/actions/csatPublic.ts:14-38`). Rating sets `rating, comment, submitted_at`. "Already rated" and "ticket reopened" are refused.
4. One reminder after `csat_reminder_days` (default 2; setting 0 disables), only if still `resolved`, not rated and not reopened (`lib/csat/reminders.ts`, `lib/csat/settings.ts:9-12`, keys `csat_enabled`, `csat_reminder_days` in `app_settings`; admin screen `CsatSettingsClient.tsx`). Cron `csat` every 30 min (`app/api/csat/run/route.ts`).
5. Low rating (1-2): bell + e-mail to the assigned technician and the leads of the group (type `csat_low_rating`) (`lib/csat/alerts.ts`).

### 5.3 What counts as a rated survey (surveys sent vs rated)

- A survey ROW exists for every resolved ticket where CSAT was enabled (`sent_at` set) whether or not the e-mail went out. It is **rated** only when `rating IS NOT NULL` (and `submitted_at IS NOT NULL`). So: surveys sent = count of rows; rated = rows with a non-null rating; response rate = rated / sent.
- Live, 2 Nov 2026 per data-API doc: 276 survey rows (271 created in the last 30 days) against 714 tickets (`docs/CKDESK-DATA-API.md:35,238`). The number of rated rows is **UNVERIFIED** (not in the doc).
- Averages must ignore null ratings: the Smart Dashboard CSAT = average rating of tickets resolved in the window that were rated (`lib/reporting/executive/engine.ts:348`, `:370-371`); Report Builder column `csat_rating` is null when unrated (`lib/queries/reporting.ts:348`). The executive per-ticket value takes the last non-null rating (`lib/queries/executive-dashboard.ts:114,165`).
- Between a reopen and the next resolve the survey row is not touched: the reset of `rating/comment/submitted_at` happens only inside `issueCsat()` at the next resolution (`issue.ts:82-86`). So an open, reopened ticket can still show its earlier rating. I found no test covering this; treat as UNVERIFIED.

---

## 6. Read-only data API (what the assistant's data platform can read)

Endpoints, auth and paging: `docs/CKDESK-DATA-API.md:1-60`; code `lib/data-api/{handler,auth,params,query,entities}.ts`; routes `app/api/data/v1/{meta,rows,ids}`. GET only, `Authorization: Bearer <DATA_API_TOKEN>` (>= 32 chars, else API answers 503 "off"), optional `DATA_API_ALLOWED_HOSTS`, one organisation only (`DATA_API_ORG_ID` when more than one), page size 1-5000 (default 1000), keyset cursor `(change column, id)`, every timestamp keeps its offset, `Cache-Control: no-store`, `X-Data-Api-Version: 1`. Deployment state: the doc header says "Nothing of this is on the live server yet" (`CKDESK-DATA-API.md:3`) but the project memory records main `96bf6be` deployed on 2026-11-02 with the API off until the owner sets `DATA_API_TOKEN` on 10.0.1.98. Treat as **UNVERIFIED** which is current; either way it answers 503 until a token exists.

Privacy rule header (`entities.ts:3-6`): no e-mail, mobile number or employee number; no typed free text (ticket title, description, comments, remarks, form answers, cancel reasons, CSAT comments); people are opaque ids except display name in `users` only. Flags: `pii` = `no` | `id` (opaque person id) | `name` (display name, only `users.full_name`) | `derived` (computed by the API).

| Entity | Source table (mode) | Columns returned (pii flag where not `no`) | Notes |
|---|---|---|---|
| `requests` (714 rows) | `requests` (incremental, `updated_at`) | `id, request_no, service_id, category_id, sub_category_id, status, priority, team_id, requester_id [id], assigned_to [id], parent_request_id, store_code [derived], created_at, updated_at, responded_at, resolved_at, closed_at, response_due_at, resolution_due_at, waiting_since, paused_ms_total, reopen_count, response_breached [derived], resolution_breached [derived]` | No title/description/form data, no `cancellation_reason`, no `reopen_deadline_at`, no `pre_approval_status`, no `source_metadata` (so the channel is NOT available), no `project_id`. `entities.ts:56-85` |
| `request_status_history` (1,071) | `request_activity` where `action='status_changed'` (append) | `id, request_id, actor_id [id], created_at, from_status, to_status` | Incomplete by design, see 2.5. `:86-96` |
| `request_comments` (1,298) | `request_comments` (append) | `id, request_id, author_id [id], is_internal, source, from_external [derived], text_length [derived], created_at` | Never the text. `:97-107` |
| `services` (17) | `services` (incremental) | `id, name, slug, is_active, status, team_id, sla_policy_id, default_priority, owner_id [id], created_at, updated_at` | No form, description, keywords, template, location tags, visibility. `:108-115` |
| `service_categories` (112) | same | `id, name, slug, is_active, is_pms, program_id, created_at, updated_at` | `:116-122` |
| `service_sub_categories` (618) | same | `id, category_id, name, slug, is_active, sla_priority, created_at, updated_at` | There is NO entity for `service_sub_category_tags`, so the service-to-sub-category link is only inferable from tickets. `:123-129` |
| `stores` (231) | `stores` | `id, code, name, address, city, state, pincode, region, cluster, priority_list, festival, open_date, is_active, ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, zenatix, created_at, updated_at` | `code` is the join key; `address` is flagged as a business address. `:130-138` |
| `sla_policies` (17) | `sla_policies` | `id, name, is_active, config [json, targets by priority], created_at, updated_at` | `:139-145` |
| `csat_surveys` (276) | `csat_surveys` (snapshot: read in full) | `id, request_id, rating (1-5, null until answered), sent_at, submitted_at, reminder_sent_at` | No comment, no requester id. `:146-152` |
| `approvals` (97) | `approvals` | `id, request_id, status, current_step, workflow_id, requested_by [id], created_at, updated_at` | `:153-159` |
| `approval_decisions` (88) | `approval_decisions` (append) | `id, approval_id, step_order, decision, decided_by [id], decided_at` | `:160-167` |
| `teams` (12) | `teams` | `id, name, slug, prefix, department_id, is_active, created_at, updated_at` | No `notification_email`. `:168-174` |
| `departments` (1) | `departments` (snapshot) | `id, name, code, parent_id, is_active, created_at` | `:175-181` |
| `locations` (2) | `locations` (snapshot) | `id, name, code, city, country, timezone, is_active, created_at` | `:182-188` |
| `approval_workflows` (97) | `approval_workflows` | `id, name, created_at, updated_at` | Mostly one ad-hoc workflow per approval. `:189-195` |
| `programs` (4) | `vendor_programs` | `id, name, slug, level, row_type, is_active, created_at, updated_at` | No sheet links, mail text or vendor addresses. `:196-202` |
| `users` (555) | `profiles` | `id [id], full_name [name], role, is_active, store_code [derived], department_id, location_id, is_vendor [derived], created_at, updated_at` | The only place a person name appears. `:203-214` |

NOT exposed by the API (so the assistant cannot answer these from it): business hours and holidays, `field_sla_overrides`, form templates and fields, Business Rules and their firing log, `team_members`/group leads, ticket tasks, time entries, attachments, tickets' source channel, request activity other than status changes, reopen/cancel reasons, `escalation_policies`, service location tags, notifications, KB articles, `request_automation_state`.

---

## 7. Scheduled jobs that affect ticket state (Windows scheduled tasks calling the app, `scripts/windows/install-cron-tasks.ps1:6-20`)

| Task | Interval | Effect on tickets |
|---|---|---|
| BusinessRules | 15 min | schedule Business Rules (SLA %, unassigned minutes) |
| Csat | 30 min | auto-close resolved tickets past `reopen_deadline_at`; the one CSAT reminder |
| AutomationRetry | 15 min | finishes missed creation steps (3 tries) |
| Alerts | 30 min | due-soon/overdue for TASKS and milestones, unassigned requests, 08:00 daily digest |
| PmsDaily | daily 09:00 | creates AC PMS tickets (system generated) |
| ApprovalReminders | daily 10:00 | one mail per approver of pending approvals |
| EmailReplySync | 1 min | email replies become ticket comments (and auto-resume `waiting_user`) |
| MastersSync | 11:00, 15:00, 19:00 | copies AC/Genset/CVM/program Google Sheets |

Nothing runs on `desktime-sync` or `intake-classify` (no task installed).

---

## 8. User-facing how-to knowledge implied by the UI

Navigation labels (`components/layout/Sidebar.tsx:70-117`, `MobileNav.tsx:39`): Home, Requests, Agent Requests (technicians), Approvals, Notifications, New Request (mobile) = Services catalog.

| Task | Who | Page / route | What the UI does (evidence) |
|---|---|---|---|
| See available services | Requester (own location only) | `/services` | Flat list of services visible by status/location rules (1.2). Search box via `searchServices` |
| Raise a ticket | Requester | `/services/<slug>` ("Create Request") | Three-panel workspace: service context, the form (`DynamicForm`), personal shortcuts "Recently used / Frequent" (`app/(app)/services/[slug]/page.tsx`). Pick Category/Sub-category (required when the service has any), fill mandatory fields, optionally attach files, submit. Confirmation shows the ticket number `CKSD-xxxxxx`; a "logged" bell/e-mail follows. Double click safe (15 s guard). |
| Raise on behalf of someone | Technician, manager, admin | same page, "Book on behalf of" field | `canBookOnBehalf` (`services/[slug]/page.tsx:64-70`); the requester is told by notification (`create-request-core.ts:681-692`) |
| Check status of my tickets | Requester | `/requests` (My requests; views `mine`, `collaborated`, `subordinates`; default status filter "active"; filters status, priority, service, category, sub-category, search `q`, sort, page size 25/50/100) | `app/(app)/requests/page.tsx:36-110`. Also `/home` cards and `/notifications` |
| Open a ticket | any | `/requests/<id>` with tabs Conversations, Details, Tasks, Approvals (only when relevant), Time Elapsed, History; `?tab=` deep links | `components/requests/RequestDetailTabs.tsx:6-13` |
| Read the SLA / due | any | SLA badge on lists and ticket: due date, "At risk" (< 4 h), "SLA Breached", or "On Hold - reason" | `components/requests/SLABadge.tsx` |
| Reply to the technician | Requester, collaborator, technician | Conversations tab, composer at the bottom ("Add a reply below"); max 20,000 characters; if status was `waiting_user` a requester reply auto-resumes it to `in_progress` and shows an "Action needed" box beforehand; also by replying to the notification e-mail (IMAP sync) | `app/(app)/requests/[id]/page.tsx:554-560,636-640`, `lib/actions/requests.ts:693-871` |
| Attach a file | any participant | file field on the form, or paperclip in the reply composer; 25 MB, listed types (1.3) | `lib/attachments/validate.ts` |
| Cancel my ticket | Requester | status control on the ticket; allowed when `open` or `waiting_user`; reason mandatory | `REQUESTER_TRANSITIONS`, `status-change.ts:299` |
| Reopen a resolved ticket | Requester | "Resolved Reopen banner" with countdown (`ResolvedReopenBanner`), reason mandatory; or the reopen button in the resolved e-mail (`/csat/<token>?reopen=1`) | 2.3 |
| Reopen an approval-rejected cancelled ticket | Requester | `ApprovalRejectedReopenBanner`, 48 h | 2.3 |
| Give feedback (rate) | Requester | stars + comment box on the ticket page after resolve, or the star links in the e-mail (`/csat/<token>?r=1..5`) | section 5 |
| Add people (cc) | any | collaborators panel on the ticket (CcField) | `lib/actions/requests.ts:535-690` |
| Approve a request | Approver | `/approvals`, or the e-mail link `/approve/<token>`; ticket tab `?tab=approvals` | `app/approve/[token]`, `lib/actions/approvals.ts` |
| Work a ticket | Technician | `/requests/queue` (Agent Requests; default hides resolved/closed/cancelled), "Start Working", status control, Assign, resolution note, "Send for Approval", Nudge | `lib/requests/queue-status-filter.ts`, `RequestActionBar.tsx` |
| Export / print a ticket | participants | `/api/requests/<id>/pdf`, Report Builder `/reports/pivot` | route list |
| Help articles | Admin/manager | `/admin/knowledge-base` and `/admin/runbooks` exist; there is NO requester-facing knowledge-base page in `app/(app)` | route list. `kb_articles` has `helpful_yes/no, view_count` (types/database.ts) |

Role caveats for any assistant answers: a vendor login only sees `/vendor`; the sidebar shows `/requests/queue` (Agent Requests) only to agent/manager/admin (`Sidebar.tsx:102-103`), Smart Dashboard not to a plain Requester (`:88`), Predefined Reports and the Admin menu only to staff; "Raise a ticket" needs the person's Location to match a ticked location on the service, otherwise the service is simply not offered.

---

## 9. Findings the design team should not miss

1. **Priority is a function of sub-category** (or the service default) and of Business Rules only; nobody (admin included) types it. An assistant must not offer "change priority".
2. **Rule-assigned tickets stay `open`** with `assigned_to` set; `assigned` appears only after a manual assign. "Unassigned" must be judged by `assigned_to IS NULL`, not by status `open`.
3. **Status history in the API is not a full audit** (2.5): no initial open, no open/assigned flips, null `from_status` for rule moves.
4. **Paused tickets keep an old `resolution_due_at`** until they resume; counting "overdue" from the raw column without the status filter overstates breaches.
5. **`resolution_breached` in the API is resolved-late only.** Currently-breached tickets must be derived: status not in resolved/closed/cancelled/waiting_user/hold_purchase_ho/pending_approval AND `resolution_due_at < now`.
6. **At-risk threshold is 4 wall-clock hours in the UI**, a % in Business Rules; there is no stored flag.
7. **Stored but unused settings**: `services.visibility`, `visibility_scope`, `owner_id`/`backup_owner_id` routing, `escalation_policy_id`, `global_sla_config`, legacy escalation runner. Do not describe them as working features.
8. **Surveys sent != rated**: use `rating IS NOT NULL`; one row per ticket, reset on re-resolve.
9. **Request number is `CKSD-` + 6 digits**, one global counter; the same number is shown in notifications and e-mails.
10. **Live configuration is not in the repo**: SLA hours per priority, business hours, holidays, which Business Rules exist, CSAT on/off and reminder days, reopen window days (default 3) are all **UNVERIFIED** here.
11. `getAllowedStatuses` omits `platform_owner` from the draft/review audience (`lib/queries/services.ts:21-27`): a platform owner sees only published services in the catalogue (possible oversight, UNVERIFIED as intended).
12. The comment on `ServiceInput.auto_oem_routing` in `lib/actions/admin/services.ts` still mentions `runOemAutoRouting()` in `lib/actions/requests.ts`; the real code is `runMasterOemRouting` in `lib/requests/master-routing.ts` (stale comment only).
