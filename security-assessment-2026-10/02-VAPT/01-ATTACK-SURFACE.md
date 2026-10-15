# 01 — Attack Surface Inventory (VAPT of Citykart Desk, CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This file lists every door into CKDesk that the repository shows: pages, route handlers, server actions, database functions, roles, background jobs, outside services and the paths sensitive data takes. It is a list of facts, not a list of faults. Faults are in files 03 to 06.

Facts come from three places and each table says which:
- **Repository (class B):** `git ls-files`, the source files, and `proxy.ts`. The working tree includes this assessment's uncommitted LOCAL fixes, so a few role checks below are stricter than what runs in production.
- **Audit database (class A):** read-only `SELECT` queries against the disposable audit database `supabase_db_ckdesk_audit` (it has migrations up to 164, where 164 is the LOCAL VAPT hardening migration). Nothing was written.
- **Earlier review files (class B):** the five source reviews in `vapt-2026-10/work/review-*.md`.

Nothing in this file describes production as tested. Production (build `20261015-145217`, main `717e5c6`) does not contain the assessment's fixes. Plain terms: a "page" is a screen; a "route handler" is a web address that returns data and not a screen; a "server action" is a function the browser can call on the server; an "RPC" is a function inside the database that the app calls; "RLS" is the database rule that decides which rows a person may see.

---

## 1. The numbers, re-counted on 2026-10-15

| Item | Count | How it was counted | Note |
|---|---|---|---|
| Pages (`page.tsx`) | **60** | `git ls-files 'app/**/page.tsx'` | 54 inside the signed-in area `(app)`, 6 outside it |
| Route handlers (`route.ts`) | **27** | `git ls-files` for `route.ts` | 25 under `app/api`, 2 under `app/auth` |
| Server-action files (`'use server'`) | **54** | files that start with `'use server'` | 22 in `lib/actions/admin`, 10 in `lib/actions/intake`, 22 other |
| Exported server actions | **295** | exported functions in those 54 files | 143 admin, 39 intake, 113 other (adds up to 295) |
| Database functions called from code (`.rpc(...)`) | **19** distinct names | grep of `.rpc('...')` in `app`, `lib`, `components` | 15 are `SECURITY DEFINER`; 4 are not (see section 5) |
| `SECURITY DEFINER` functions in schema `public` (audit DB) | **39** | `pg_proc.prosecdef` | all 39 have `search_path` pinned (0 unpinned) |
| Row-security policies, schema `public` | **221 now** (222 in the database review) | `pg_policies` | migration 164 removed one (`requests_insert`), so 222 before and 221 after; 6 more policies sit on the `storage` schema |
| Tables in `public` | **106** | `pg_class` ordinary tables | **105 have RLS on**. The one without is `system_log_chain_head` (no rights for `anon` or `authenticated`). The brief said "106 with RLS"; the live count is 105 of 106, so use this figure |
| Triggers in `public` | 85 (45 write to the System Log) | `pg_trigger` | the 45 match "45 audited business tables" in the control inventory |
| Users in the audit DB sample | 300 requester / 24 technician / 5 manager / 5 admin / 2 platform owner | review file | synthetic data only |

The old documents quote slightly different totals (for example 109 `ENABLE ROW LEVEL SECURITY` statements across the migration files). Those count statements in files, not objects in the database. This file uses the live database figures.

---

## 2. Roles

| Role in database | Shown as | What it is for | Where the line is drawn |
|---|---|---|---|
| `user` | Requester | raises and follows own tickets; approves when named as approver | RLS limits tickets to own (plus direct-report view); most admin screens redirect away |
| `agent` | Technician | works tickets of the technician groups they belong to | RLS: tickets of own group(s); report scope = own group(s) |
| `manager` | Manager | reads **every** ticket in the organisation (by design, open decision D-005); edits some configuration | RLS role list `manager/admin/platform_owner` on most tables; app gates differ (see file 05) |
| `admin` | Admin | administers users, services, SLA, intake, logs | cannot change another admin or platform owner (target guard) |
| `platform_owner` | Platform Owner | highest role; only role that may grant `admin` or `platform_owner` | the database makes global tables (business hours, holidays, priorities, app settings) writable by this role only, but the app lets managers and admins edit them (VA-ADM-03, decision open) |

Also present but not enforced: the "Roles & Permissions" matrix (`custom_roles`, `permission_overrides`). It stores choices that nothing reads for decisions. It is not a control.

---

## 3. Trust boundaries (outside to inside)

1. **Network edge.** Public address `http://182.72.84.10:3210` is forwarded by the router to the app server 10.0.1.98. It is plain HTTP (finding VA-API-01, decision open). Source: `CLAUDE.md`, runbook.
2. **Browser to the three back-end services.** The browser holds the same login as the server and talks directly to a small reverse proxy on port 8443 (`deploy/windows/proxy/server.js`). It forwards `/auth/v1` to the login service (GoTrue, 9999), `/rest/v1` to the data API (PostgREST, 3001) and `/storage/v1` to file storage (5000), all on 10.0.1.98. Whether port 8443 is reachable from outside the LAN is **not known from the repository** — management/network owner to confirm. This matters because anything the browser can send to `/rest/v1` is a path around the screens.
3. **`proxy.ts` (Next.js).** Checks the session on every page and route except an exact allowlist (section 4.2). Signs the "verified user" header; strips any client copy of it on every path.
4. **Server actions and route handlers.** Role and ownership checks in code via `getCurrentProfile()`.
5. **PostgreSQL.** RLS on 105 of 106 tables, triggers, column grants. Normal work uses the signed-in person's own database login, not the service role. About 104 source files use the service-role client (`createAdminClient`), which skips RLS, so for those the role check inside the action is the only barrier.
6. **Storage.** Attachment routes check access with the caller's own RLS session and then stream with the server key. Files sit on the NAS 10.0.0.25 in production.

**Architecture point repeated in files 04 and 05:** because the browser holds the same login as the server actions, a rule that exists only in a server action or a page is a **screen rule**. The database must repeat any rule that matters.

---

## 4. Entry points

### 4.1 The 60 pages

The "who can open it" column is read from the page file itself (a role redirect, `notFound()`, or none). The layouts add more: `app/(app)/layout.tsx` needs a profile and handles forced password reset and trial expiry; `app/(app)/admin/layout.tsx` lets only admin, manager and platform owner through. Layout checks do not protect server actions or other routes; those have their own checks (section 4.3).

**Outside the signed-in area (6)**

| Page | Who can open it | Note |
|---|---|---|
| `/login` | anyone (no session) | proxy lets `/login`, `/auth*`, `/forgot-password`, `/reset-password` through |
| `/forgot-password` | anyone | 3 reset e-mails per address per hour (in memory) |
| `/reset-password` | anyone, but needs a recovery or signed-in session to change a password | reached through `/auth/confirm` |
| `/approve/[token]` | anyone holding the signed link | proxy skips the session check for `/approve/*`; page decides: signed in as the approver, or the 6-digit code mailed to the approver |
| `/csat/[token]` | anyone holding the signed link | proxy skips the session check for `/csat/*`; rating/reopen page |
| `/trial-expired` | any signed-in user | shown when the licence trial is over |

**Signed-in area, any role (page shows no role check; the data is decided by RLS) — 9**
`/home`, `/requests`, `/requests/[id]`, `/services`, `/services/[slug]`, `/notifications`, `/profile`, `/approvals` (list scope depends on role), `/reports/pivot` (Report Builder; scope depends on role through `authorizeReportAccess`).

**Technician and above — 5**
`/requests/queue`, `/reports/analytics`, `/reports/analytics/[slug]` (also needs the Requests module), `/dashboards` (technicians; managers and above are sent to `/admin/reports`; a requester with direct reports gets a team view), `/dashboards/executive` (not a plain requester).

**Intake intelligence — 8**
`/intake` (admin, platform owner), `/intake/channels` (admin, platform owner), `/intake/settings` (admin, platform owner), `/intake/rules` (admin, platform owner), `/intake/inbox`, `/intake/inbox/[id]`, `/intake/review/[id]` (reviewers; the page file checks admin flags for extra tools, and the actions use `canReview`, which means technician and above), `/intake/queue` (redirects to the inbox).

**Admin and platform owner only (page file) — 4**
`/tasks`, `/tasks/[id]`, `/projects`, `/projects/[id]`. The page comment says "Tasks isn't fully built out yet — Admin/Owner only". The matching server actions and database rules are wider (technician and above, and for creating a task any role), which is a screen-rule gap (VA-TKT-09).

**Admin area (`/admin/*`, 28 pages; the layout allows admin, manager, platform owner)**

| Gate in the page file | Pages |
|---|---|
| admin + platform owner only | `categories`, `categories/[slug]`, `field-library`, `form-templates`, `form-templates/[id]`, `monitoring`, `services`, `sla-policies` |
| admin + manager + platform owner | `/admin` (sends to `users`), `approvals`, `business-rules`, `desktime`, `master-data`, `org`, `reports`, `request-config`, `roles` (viewing; editing admin only), `runbooks`, `settings`, `task-config`, `users` |
| role-scoped view inside the page | `logs` (`resolveLogsView`: managers see ticket and task activity only; admins see the System Log) |
| **no check in the page file** (layout only) | `knowledge-base`, `teams` — reads go through RLS; finding VA-ADM-13 (Low, open) |
| redirects only | `audit`, `event-log`, `system-log` (to `/admin/logs`), `reports/pivot` (to `/reports/pivot`) |

### 4.2 The public-route allowlist in `proxy.ts`

Read from the working-tree `proxy.ts` (includes the LOCAL fix for VA-API-04).

| Rule | What passes without a session check | Authenticates itself with |
|---|---|---|
| Static fast path | `/_next*`, `/favicon*`, and **root-level** image files only (`/<name>.svg/.png/.jpg/.jpeg/.gif/.webp/.ico`) | nothing needed (public files). Before the fix, *any* path ending in `.png` etc. skipped the check (VA-API-04) |
| Exact API allowlist (15 paths) | `/api/health`, `/api/version`, `/api/alerts/run`, `/api/business-rules/run`, `/api/desktime/sync`, `/api/intake/cron/classify`, `/api/intake/webhook/gmail`, `/api/intake/webhook/outlook`, `/api/intake/webhook/whatsapp`, `/api/email/inbound-sync`, `/api/csat/run`, `/api/system-log/ingest`, `/api/system-log/archive`, `/api/approvals/reminders`, `/api/csp-report` | see the route table below |
| Prefix `/csat/` | the rating page | signed link |
| Prefix `/approve/` | the approval page | signed link + login or code |
| Auth pages (inside the session rule) | `/login`, `/auth*`, `/forgot-password`, `/reset-password` are allowed *without* a session; everything else without a session is redirected to `/login?next=` | n/a |
| Public form body cap | 256 KB limit on POSTs to `login`, `auth`, `forgot-password`, `reset-password`, `approve`, `csat` | `lib/http/public-body-limit.ts` |

Every other `/api/*` route needs a session at the proxy.

### 4.3 The 27 route handlers

| # | Route | Methods | Reachable without a session? | Authentication / protection used |
|---|---|---|---|---|
| 1 | `/api/admin/audit` | GET | no | session; admin-tier role check; org-scoped RLS on audit tables; entity type allowlisted |
| 2 | `/api/alerts/run` | GET | yes (allowlist) | cron secret (`x-cron-secret` or Bearer), constant-time compare, 503 if unset |
| 3 | `/api/approvals/reminders` | GET | yes | cron secret; `?sampleTo=` limited to company mail domain (LOCAL fix VA-API-10) |
| 4 | `/api/business-rules/run` | GET | yes | cron secret |
| 5 | `/api/csat/run` | GET | yes | cron secret |
| 6 | `/api/csp-report` | POST | yes | none by design (browsers post here); per-address limit, global cap, size check first (LOCAL fix VA-API-07) |
| 7 | `/api/desktime/sync` | GET | yes | cron secret |
| 8 | `/api/email/inbound-sync` | GET | yes | cron secret |
| 9 | `/api/events` | POST | no | session (signed header); 64 KB cap; per-user limit; only browser event kinds; max 50 events (LOCAL fix) |
| 10 | `/api/health` | GET | yes | none; runs a service-role query and returns database status, latency and version |
| 11 | `/api/intake/cron/classify` | GET | yes | cron secret |
| 12 | `/api/intake/oauth/callback` | GET | no | session; admin or platform owner; HMAC-signed state, 15 min, bound to the admin who started it |
| 13 | `/api/intake/oauth/start` | GET | no | session; admin or platform owner |
| 14 | `/api/intake/webhook/gmail` | POST | yes | static token in the URL query (`INTAKE_WEBHOOK_TOKEN`, else worker secret, else `CRON_SECRET`), constant-time; 401 if none set. Google's signed token is not verified (VA-API-12) |
| 15 | `/api/intake/webhook/outlook` | GET, POST | yes | token in URL plus `clientState` re-checked per notification; GET echoes Microsoft's `validationToken` |
| 16 | `/api/intake/webhook/whatsapp` | GET, POST | yes | GET: verify token, constant-time. POST: HMAC-SHA256 `X-Hub-Signature-256` over the raw body; channel chosen by the destination phone-number id, never by the sender |
| 17 | `/api/notifications/new` | GET | no | session; own rows only |
| 18 | `/api/requests/[id]/pdf` | GET | no | session; UUID shape check; every query on the viewer's RLS; internal notes and internal files left out |
| 19 | `/api/storage/attachment/intake/[id]` | GET | no | session; RLS limits to technician-and-above of the same organisation; forced download; `nosniff` |
| 20 | `/api/storage/attachment/request/[id]/preview` | GET | no | session; RLS on the attachment row; spreadsheet preview |
| 21 | `/api/storage/attachment/request/[id]` | GET | no | session; RLS on every fetch; path must start with the ticket's own id; content type from a fixed extension table; `nosniff`; `no-store` |
| 22 | `/api/storage/public/[bucket]/[...path]` | GET | no (not on the allowlist) | session at the proxy; only buckets `icons` and `avatars`; strict path shape (LOCAL fix of the dot regex, VA-API-14) |
| 23 | `/api/system-log/archive` | GET | yes | cron secret |
| 24 | `/api/system-log/ingest` | POST | yes | shared secret of 16+ characters; accepts only `error`/`event` rows from listed sources; identity forced to none; 512 KB and 200-entry caps |
| 25 | `/api/version` | GET | yes | none; returns the build stamp |
| 26 | `/auth/callback` | GET | yes (auth path) | sign-in code exchange; `safeNextPath` for the redirect |
| 27 | `/auth/confirm` | GET, POST | yes (auth path) | GET shows a Continue button; POST consumes the one-time reset or invite token; `Origin`/`Sec-Fetch-Site` check added in LOCAL (VA-API-08) |

Eight routes use the shared cron secret check (`verifyCronSecret`: rows 2, 3, 4, 5, 7, 8, 11, 23). The log ingest route (row 24) uses the same secret with a 16-character minimum. The Gmail and Outlook webhooks (rows 14, 15) fall back to the same `CRON_SECRET` when no dedicated token is set. So one secret opens many doors (VA-API-05, open).

### 4.4 The 54 server-action files (295 exported actions)

All actions run on the server, but any signed-in browser can call any of them by posting to a page with the right action id. So each action must check the caller itself. The "gate" below was read from the source (working tree).

**Admin area — 22 files, 143 actions**

| File | Actions | Role gate found |
|---|---|---|
| `admin/users.ts` | 14 | admin, platform owner for role, active, invite, bulk create, e-mail, password set/reset, export. **Manager also allowed** for `updateUserProfile`, `addMobileNumber`, `removeMobileNumber`, `setUserTeams` (LOCAL fix added a target guard; phones and reporting line admin-only) |
| `admin/config.ts` | 20 | **admin, manager, platform owner** for application settings, sender name, test e-mail, task templates, business hours, holidays, alert rules, request priorities (VA-ADM-03). admin, platform owner for mailbox settings, log retention, retention policy |
| `admin/org.ts` | 21 | admin, manager, platform owner (departments, locations, stores, cost centres, job functions, designations, user org fields) |
| `admin/categories.ts` | 9 | admin, platform owner |
| `admin/services.ts` | 5 | admin, platform owner |
| `admin/form-templates.ts` | 8 | admin, platform owner |
| `admin/field-library.ts` | 6 | admin, platform owner |
| `admin/sla-policies.ts` | 4 | admin, platform owner |
| `admin/sla-matrix.ts` | 1 | admin, manager, platform owner |
| `admin/business-rules.ts` | 5 | admin, **manager**, platform owner (VA-TKT-02) |
| `admin/workflows.ts` | 7 | admin, **manager**, platform owner (VA-ADM-06) |
| `admin/oems.ts` | 4 | admin, manager, platform owner |
| `admin/teams.ts` | 5 | admin, platform owner |
| `admin/task-config.ts` | 7 | admin, manager, platform owner |
| `admin/notificationRules.ts` | 2 | admin, manager, platform owner |
| `admin/storeMaster.ts` | 3 | admin, manager, platform owner |
| `admin/reports.ts` | 5 | list: admin, manager, platform owner; create, update, delete, send: admin, platform owner |
| `admin/desktime.ts` | 6 | admin, platform owner |
| `admin/events.ts` | 2 | admin, platform owner |
| `admin/system-log.ts` | 5 | admin, platform owner (every function re-checks) |
| `admin/permissions.ts` | 3 | admin, platform owner (stores a matrix nothing enforces) |
| `admin/icons.ts` | 1 | admin, platform owner |

**Intake — 10 files, 39 actions**

| File | Actions | Role gate found |
|---|---|---|
| `intake/channels.ts` | 9 | admin, platform owner (`canManageChannels`) |
| `intake/whatsapp-channel.ts` | 6 | admin, platform owner |
| `intake/rules.ts` | 4 | admin, platform owner |
| `intake/pipeline.ts` | 3 | admin, platform owner for test and reclassify; reviewers for progress |
| `intake/reviews.ts` | 4 | reviewers (`canReview`: technician, manager, admin, platform owner) |
| `intake/work.ts` | 3 | reviewers |
| `intake/communication.ts` | 6 | reviewers for notes, send, close (LOCAL fix VA-ADM-11 on `addNote`); read/archive: signed-in |
| `intake/detail.ts` | 1 | reviewers |
| `intake/flags.ts` | 2 | reviewers |
| `intake/brief.ts` | 1 | reviewers (the only outside language-model call in the web app) |

**Other — 22 files, 113 actions**

| File | Actions | Role gate found |
|---|---|---|
| `requests.ts` | 23 | signed-in; ticket-level checks inside each action (requester, technician of the ticket's group, manager and above); "on behalf of" needs technician and above |
| `tasks.ts` | 20 | signed-in; creating tasks needs technician and above in the action; the database allows any role (VA-TKT-09) |
| `projects.ts` | 13 | technician and above in the action; ticket-level project check `can_view_project` |
| `approvals.ts` | 9 | technician of the ticket's group or manager and above to send for approval; approver rules in `lib/approvals/decision.ts` |
| `reporting.ts` | 6 | signed-in; scope from `authorizeReportAccess` |
| `export.ts` | 5 | `exportRequests` and `exportStores`: admin, manager, platform owner; `exportApprovals`: admin, platform owner; `exportTasks` and `exportProjects`: any signed-in role, with org-wide scope only for admin, manager, platform owner (others are limited to their groups) |
| `auth.ts` | 5 | public (sign in, forgot password) or signed-in |
| `notifications.ts` | 5 | signed-in; own rows |
| `knowledge-base.ts` | 4 | manager and above to write |
| `approvalEmail.ts` | 3 | public link holder; decision needs login as approver or the e-mailed code |
| `profile.ts` | 3 | signed-in; own profile |
| `push.ts` | 3 | signed-in; own subscription |
| `csatPublic.ts` | 2 | public link holder (signed rating link) |
| `executiveDashboard.ts` | 2 | not a plain requester; scope re-applied |
| `attachments.ts` | 2 | requester of the ticket, or technician/manager of it |
| `ticketCopy.ts` | 2 | technician of the ticket (and comment author for the copy) |
| `analytics.ts`, `analytics-drill.ts`, `fixedReportExport.ts`, `reportExport.ts`, `search.ts`, `task-attachments.ts` | 1 each | signed-in; scope or RLS decides |

Five actions have no explicit sign-in check and rely on RLS only: `searchUsersForDelegation`, `fetchSubtasks`, `loadTaskPanelData`, `getApprovalPreview`, `getApprovalForRequestAction` (ticket review). With no session, RLS returns nothing.

### 4.5 The 19 database functions called from code (RPCs)

Grants read from the audit database with `has_function_privilege`.

| RPC | Called from | Type | Who may run it |
|---|---|---|---|
| `intake_read_credential` | `lib/actions/intake/channels.ts`, `whatsapp-channel.ts`, `lib/whatsapp/config.ts` | definer | service role only |
| `intake_store_credential` | same files and `app/api/intake/oauth/callback/route.ts` | definer | service role only |
| `email_smtp_has_password` / `_read_password` / `_store_password` / `_clear_password` | `lib/email/mailbox.ts`, `lib/actions/admin/config.ts` | definer | service role only |
| `org_read_desktime_key` | `lib/desktime/api.ts` | definer | service role only |
| `upsert_field_sla_override` | `lib/actions/admin/sla-matrix.ts` | definer | service role only |
| `system_log_verify_chain` | `lib/actions/admin/system-log.ts` | definer | service role only |
| `system_log_archive_old` | `app/api/system-log/archive/route.ts` | definer | service role only |
| `purge_app_event_log` | `app/api/alerts/run/route.ts` | definer | service role only |
| `replace_user_email` | `lib/actions/admin/users.ts` | definer | service role only |
| `commit_conversation_transition` | `lib/conversations/repository.ts` | definer | service role only |
| `get_home_dashboard` | `app/(app)/home/page.tsx` | definer | **anon and signed-in** (VA-DB-09: trusts caller-supplied role flags) |
| `can_view_project` | `lib/actions/projects.ts` | definer | anon and signed-in (keyed on the caller) |
| `merge_request_form_data` | `lib/actions/requests.ts` | **invoker** | service role only |
| `intake_validation_stats` | `lib/queries/intake/index.ts` | invoker | anon and signed-in (RLS applies) |
| `retag_service_categories`, `retag_service_locations` | `lib/actions/admin/services.ts` | invoker | anon and signed-in (RLS applies) |

That is 19 distinct names (the four e-mail functions count as four).

### 4.6 The 39 `SECURITY DEFINER` functions in the audit database

A definer function runs with its owner's rights, so its grants and its pinned `search_path` matter. All 39 have a pinned `search_path` (`public`, or `public, vault` for the 8 that touch stored secrets). **19 may be run by the service role only; 20 may be run by `anon` and signed-in users** (the default for functions; 3 of those 20 are trigger functions that cannot be called directly).

| Group | Functions | Grants |
|---|---|---|
| Service role only (19) | `commit_conversation_transition`, `email_smtp_clear_password`, `email_smtp_has_password`, `email_smtp_read_password`, `email_smtp_store_password`, `generate_request_no`, `intake_read_credential`, `intake_store_credential`, `org_read_desktime_key`, `org_store_desktime_key`, `owner_delete_org`, `purge_app_event_log`, `replace_user_email`, `seed_default_sla_config`, `system_log_archive_old`, `system_log_verify_chain`, `trg_assign_request_no`, `trg_seed_org_sla_config`, `upsert_field_sla_override` | `anon` no, `authenticated` no, `service_role` yes |
| Helpers keyed on the caller's login (15) | `can_manage_collaborators`, `can_view_project`, `current_org_id`, `current_user_approver_request_ids`, `current_user_collab_request_ids`, `current_user_role`, `current_user_subordinate_ids`, `current_user_team_ids`, `get_enabled_modules`, `has_module_access`, `is_agent`, `is_owner_org`, `is_request_approver`, `is_request_collaborator`, `is_team_member` (they answer only about the caller; they return nothing useful about another person) | anon yes, authenticated yes |
| Needs a decision or fix (2) | `get_home_dashboard` (trusts caller flags, VA-DB-09), `request_identity_unchanged` (a yes/no oracle for a known ticket id, VA-DB-12) | anon yes, authenticated yes |
| Trigger functions (3) | `handle_new_user`, `system_log_audit_trigger`, `system_log_chain` | executable by default but only usable as triggers |

Count check: 15 helpers + 2 + 3 trigger functions = 20 user-executable, plus 19 service-only = 39.

Other grant facts (audit DB, after migration 164): `TRUNCATE` is granted to no table for `anon` or `authenticated` (migration 164 revoked `TRUNCATE`, `TRIGGER`, `REFERENCES`); `anon` still holds table-level `INSERT/UPDATE/DELETE` on 18 tables and `SELECT` on 31, but every policy fails for `anon` (the read-only role simulation in the database review returned zero rows). The decision on narrowing these grants is part of VA-DB-12 (open).

---

## 5. Background jobs (Windows scheduled tasks on 10.0.1.98)

Source: `scripts/windows/install-cron-tasks.ps1`, `add-approval-reminder-task.ps1`, `scripts/cron-tick.mjs`. Tasks run as SYSTEM. They call the routes above with the shared secret. Whether they are all registered in production cannot be shown from the repository.

| Task | Interval | Calls |
|---|---|---|
| `CitykartDesk-Cron-Alerts` | 30 min | `/api/alerts/run` (due-soon and overdue alerts, 08:00 digest, event-log purge) |
| `CitykartDesk-Cron-BusinessRules` | 15 min | `/api/business-rules/run` |
| `CitykartDesk-Cron-EmailReplySync` | 1 min | `/api/email/inbound-sync` (reads the shared Gmail mailbox over IMAP) |
| `CitykartDesk-Cron-Csat` | 30 min | `/api/csat/run` (auto-close, survey reminder) |
| `CitykartDesk-Cron-SystemLogArchive` | 6 h | `/api/system-log/archive` |
| `CitykartDesk-Cron-ApprovalReminders` | daily 10:00 | `/api/approvals/reminders` |
| `CitykartDesk-LogShipper` | 2 min | reads service logs, posts to `/api/system-log/ingest` |
| DeskTime sync | no task created by the installer | `/api/desktime/sync` exists; the job name exists in `cron-tick.mjs` |
| Intake classify | no task created by the installer | `/api/intake/cron/classify` |
| Intake worker (`api/` folder, Express) | long-running, if deployed | polls IMAP, Gmail, Graph; classifies; sends mail (`/intake/*`, secret header `x-intake-worker-secret`). Whether it runs in production is **not known from the repository** |
| Database backup | nightly 02:30 on 10.0.0.205 | `CK_Backup_CKDESK`, script not in the repository |

---

## 6. External integrations (what the repository shows)

| Service | Direction | Data | Controls seen |
|---|---|---|---|
| Google Workspace mailbox (SMTP 587, IMAP 993) | out and in | notifications, approval and survey links, reset and invite links, vendor mail; incoming replies in full | password in the database vault; replies from senders failing DMARC/SPF/DKIM per Google's header are not attributed; sender must now take part in the ticket (LOCAL fix VA-INT-02) |
| Gmail API / Google Pub/Sub, Microsoft Graph | in | mailbox content for intake | OAuth state signed; webhook token in the URL |
| Meta WhatsApp Cloud API | in and out | staff mobile numbers, message text, media | HMAC signature on raw body; channel secrets in the vault |
| Language model provider (default Groq, only if `INTAKE_LLM_API_KEY` is set) | out | e-mail subject, From, first 2,000 characters of a mail body | used in two places, both off unless the key is set: the reviewer-only mail summary (`lib/actions/intake/brief.ts`) and an optional Stage-2 mail classifier in the intake worker (`api/src/intake/classify/local-model-classifier.ts`). Neither creates or changes a ticket on its own: results go to a human review queue. Whether the key is set in production is not known |
| DeskTime API | out and in | employee list, time and application usage | API key sent as a URL query parameter (`apiKey`) over https |
| Browser push services | out | notification title, body, link | endpoint allow-list of public https hosts |
| Resend | out (fallback) | as e-mail | used only if no SMTP is configured |
| Google Fonts / gstatic | browser to Google | visitor address | allowed in the report-only CSP |
| GitHub | out | source code | repository `kumarsuraj84/Citykartdesk` |

---

## 7. Sensitive data and the paths it takes

| Data | Where it lives | Moves through | Who can read it (by design) |
|---|---|---|---|
| Ticket text, form answers, comments (incl. internal notes) | database `ckdesk` on 10.0.0.205 | server actions, PostgREST `/rest/v1`, PDF route, e-mail copies, notifications | requester (own, without internal notes); technicians of the group; managers and above (all, org-wide) |
| Attachments | NAS 10.0.0.25 `CKDESK_DATA` | upload action → storage service → NAS; download route re-checks RLS | as the ticket; internal files staff-only after LOCAL fix VA-INT-01 |
| Staff profile data (name, e-mail, employee id, manager, store, mobile numbers) | `profiles`, `profile_mobile_numbers` | PostgREST, admin screens, WhatsApp identity map | profiles: every signed-in employee reads the org list (VA-DB-07, open); mobile numbers: own row or staff after LOCAL fix |
| Passwords and sessions | login service (GoTrue) tables; cookies in the browser | `/auth/v1`, `proxy.ts` | session cookie readable by scripts, not marked Secure, long-lived (VA-API-01) |
| Mailbox, WhatsApp, OAuth and DeskTime secrets | database vault (encrypted with a key held as a database setting) | service-role RPCs only | no user role |
| Approval e-mail codes | `approval_email_codes` (hash only) | e-mail body to approver; code check action | nobody by API (no grants) |
| System Log (audit, security, error, event) | `system_log` with hash chain | server writes; shipper posts errors | admin and platform owner of the organisation |
| Event Log (page views, clicks, browser errors) | `app_event_log` | `/api/events` | admin (via the log screens) |
| Reports and exports (CSV, Excel, PDF) | generated on demand | export actions, scheduled reports by e-mail | role-scoped; recipients of scheduled reports must be company addresses |
| Backups | `E:\DB BACKUP\...` on 10.0.0.205 (30 days) | nightly dump | not documented; no second copy ("Not done yet") |

---

## 8. What this inventory cannot show

- Production configuration of the login service (self sign-up, password rules, token lifetime), PostgREST, firewall rules and port 8443 exposure. These are not in the repository and were not touched. See VA-DB-08 (Not Verified).
- Whether the intake worker and each integration run in production.
- Whether the scheduled tasks and the log shipper are registered on the live server.

## Open questions / evidence requests for management

1. Is port 8443 (`/auth/v1`, `/rest/v1`, `/storage/v1`) reachable from the internet, or only from the office network? Please give the firewall and router rules.
2. Which integrations are switched on in production: Gmail IMAP reply sync, Gmail or Outlook intake channels, WhatsApp, the language model key (`INTAKE_LLM_API_KEY`), DeskTime, web push?
3. Is the Express intake worker (`api/`) deployed, on which server, and how is `x-intake-worker-secret` managed?
4. Please confirm which scheduled tasks exist on 10.0.1.98 and 10.0.0.205 (export from Task Scheduler).
5. Who owns each role list decision: should managers keep write access to workflows, business rules, global settings and the other configuration tables (VA-TKT-02, VA-ADM-03, VA-ADM-06, VA-DB-03)? Owner name to be assigned by management.
6. Please supply the real production settings of the login service (`GOTRUE_DISABLE_SIGNUP`, password minimum, token lifetime) from the server, typed by an authorised person.
