# Citykart Desk — Architecture, Features, Workflows and Test Guide

Version of this document: **2026-10-26**. Written so that a person **or another AI model** can understand the whole application and test every flow end to end.
Source of truth is the code of this repository (branch `feature/sheet-masters`, commit `0e5639f` or later). Where a claim could not be confirmed it is marked **(verify)**.

---

## 0. Read this first (rules for whoever tests)

1. **Never test on the production system.** Production is read-only for testing purposes. Test only on the local sites described in section 3.
2. **No real e-mail is ever sent from the local sites.** Every message the app would send is saved as a `.json` file in `local-mail-outbox/` (fields: `to`, `cc`, `subject`, `text`, `html`). Read those files to check e-mails.
3. **Do not push, deploy, or change the live server.** Do not run anything against the production database (database `ckdesk`) or the network file store.
4. **Do not write passwords, keys or tokens into reports.** The local test password is *not* in this document: the owner gives it to you (it is in `local-testing/README-LOCAL-TESTING.md`). Use `<LOCAL_TEST_PASSWORD>` in any report you write.
5. The dev site's database is a **copy of real company data** (real names and e-mail addresses of staff, store codes, tickets). Do not copy that data out of the machine. Prefer the isolated demo site (section 3) when sharing screenshots.
6. WhatsApp intake, DeskTime time-sync and the engineer-visit module exist in the code or database but are **out of scope** for testing (switched off / dropped).

---

## 1. What the product is

**Citykart Desk (CK Desk)** is an in-house, single-company **IT / facilities service-desk and ticketing system** for Citykart (a retail chain). It replaces ManageEngine/Zoho Desk. Stores and head-office staff raise **requests (tickets)**; technician groups work them; managers watch SLAs and dashboards; OEM/vendor engineers (outside companies that service ACs and gensets) work their own tickets in a restricted portal.

Typical business uses in the data:
- AC problems of stores ("AC not cooling") routed to an OEM/vendor technician, with purchase-order approval for parts.
- Genset problems routed the same way.
- Fixtures / Hangers / Fixture attachments requests that need the store's **CVM** (Cluster/Visual Merchandising manager) to approve a **quantity**.
- Scheduled **AC PMS** (preventive maintenance) visits created automatically from a Google Sheet.
- General admin, IT, HR/finance requests with forms, SLAs and approvals.

### Words used in the application
| Term | Meaning |
|---|---|
| Request / ticket | One piece of work. Number looks like `CKSD-000448`. |
| Service | A request type with its own form, team and SLA (e.g. "ADMIN - REQUIREMENTS (NON TRADING)", "AC-PMS"). |
| Category / Sub-category | The kind of problem inside a service (e.g. FIXTURES › 4 WAYS( SS)). Drives priority, SLA, rules, approvals. |
| Form template | The list of boxes (fields) a service shows. Reusable across services. |
| Technician group (team) | A group of technicians that owns services (e.g. "ADMIN GROUP"). |
| Store | A Citykart store (code such as `ALC`, `MAR`). Store users are requesters linked to a store. |
| CVM | The store's approver for fixtures/hangers; comes from the CVM Google Sheet. |
| OEM | The equipment maker/AMC company (Voltas, Blue Star, genset makers). |
| Vendor technician / manager | A login for an OEM employee (see §8.8). |
| PO | Purchase order for parts, approved by a Citykart approver. |
| FSR | Field Service Report (the document a vendor attaches when resolving). |
| PMS | Preventive maintenance service of ACs (scheduled visits). |
| SLA | Response/resolution deadlines per priority, counted in business hours. |
| CSAT | Customer satisfaction rating after resolution. |
| Sheet masters | Google Sheets that are the master list of ACs, gensets, CVMs and PMS dates. |

---

## 2. Architecture

### 2.1 Technology
| Layer | Choice |
|---|---|
| Web framework | **Next.js 16** (App Router, React Server Components, Server Actions), React 19, TypeScript. *Not the Next.js of older tutorials: read `node_modules/next/dist/docs/` before changing framework code.* |
| Edge/proxy | `proxy.ts` (**not** `middleware.ts`): session refresh, login redirects, public-route allow-list. The vendor page restriction is in `app/(app)/layout.tsx`; security headers (and a report-only Content-Security-Policy) are set in `next.config.ts`. |
| Database | **PostgreSQL** through a self-hosted **Supabase** stack (PostgREST API, GoTrue auth, Storage, Realtime). Row-level security (RLS) on tables. |
| Styling/UI | Tailwind CSS 4, shadcn-style components on `@base-ui/react`, `lucide-react` icons, `sonner` toasts, `@dnd-kit` drag and drop, TipTap rich text. |
| Forms/validation | `react-hook-form` + `zod`. |
| E-mail | Outbound SMTP via `nodemailer` (settings in table `email_smtp_settings`, or env), inbound IMAP via `imapflow` + `mailparser`; local sink directory when `MAIL_SINK_DIR` is set. |
| Files/PDF/Excel | `pdfkit` (ticket PDF), `exceljs` (exports/workbooks), Supabase Storage (files; on production the file volume is on a NAS). |
| Push | `web-push` (browser push; needs VAPID keys, off on production). |
| Tests | `vitest` (unit, integration, security "vapt", remediation suites). |
| Production host | Windows servers: app server (Node, standalone Next build as a service), separate database server, files on a NAS, scheduled tasks for jobs. (Details in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`; not needed for testing.) |

### 2.2 Layers and how a request flows
```
Browser ──► proxy.ts (session, redirects, public allow-list)
          ──► app/ pages (Server Components read data via lib/queries/*, using the user's own Supabase session = RLS applies)
          ──► Server Actions in lib/actions/* (writes; check role/capability; use user client or the service-role "admin" client for system writes)
                 ├─ lib/requests/*   ticket creation core, status-change core, routing
                 ├─ lib/rules/*      Business Rules engine
                 ├─ lib/sla/*        deadlines, pause/resume, breach
                 ├─ lib/approvals/*  ad-hoc approvals, e-mail links, reminders, history box
                 ├─ lib/vendor/*     vendor flow, PO, mail
                 ├─ lib/masters/*    Google Sheet masters (parse, sync, diff, resolve)
                 ├─ lib/pms/*        AC PMS tickets from the sheet
                 ├─ lib/notifications.ts, lib/email/*   bell, e-mail, push
                 └─ lib/syslog/*     tamper-evident System Log
          ──► Postgres (RLS + RPC functions) ◄── scheduled jobs call /api/* routes with a shared secret
```
Three Supabase clients (in `lib/supabase/`): `server.ts` (user session, **respects RLS**), `client.ts` (browser), `admin.ts` (**service role, bypasses RLS, server only**, used for system writes: activity log, notifications, approvals state, job work, sheet sync).

### 2.3 Folder map
```
app/(auth)/            login, forgot-password, reset-password
app/(app)/             the signed-in product (home, requests, services, approvals, tasks, projects, dashboards, reports, intake, vendor, admin/...)
app/approve/[token]    approve/reject from an e-mailed link (needs the approver to prove identity)
app/csat/[token]       rate / reopen from the CSAT e-mail (signed link)
app/api/               job endpoints (cron secret), file downloads, health/version, OAuth callbacks, webhooks
components/            UI (requests, admin, vendor, executive dashboard, layout, ui)
lib/                   all server logic (see 2.2)
supabase/migrations/   184 numbered SQL migrations (20240101000000 … 20240101000184_ac_pms.sql); supabase/rollback/ keeps rollbacks for the recent ones (from 164)
scripts/               cron runner, Windows scheduled-task installers
tests/                 unit/, integration/, vapt/ (isolated stack), remediation/
docs/                  design and guides (this file lives here)
local-testing/         local seed/helper scripts and the local test README
```

### 2.4 Security model (what a tester should know)
- **Roles** (`profiles.role`): `user` (requester), `agent` (technician), `manager`, `admin`, `platform_owner`. A **vendor** is a `user` that also has `vendor_company_id` + `vendor_role` (`technician` or `manager`); there is no separate role.
- **Row-level security**: a requester sees own tickets; agents see their groups' tickets; vendors see only tickets assigned to them (manager: their company's technicians'); admins/managers see the organisation.
- **Permission matrix with owner switches** (`lib/permissions/matrix.ts`, stored as `app_settings` `policy.*`): who may change company-wide settings, Business Rules, approval workflows; whether intake reviewers may override priority; whether external e-mail domains may be invited; who may receive scheduled reports. Defaults keep today's behaviour.
- **Separation of duties**: nobody can approve their own request, or one they sent for approval.
- **Cron/job endpoints** (`/api/.../run`, `/api/masters/sync`, `/api/pms/daily`, ...) need header `x-cron-secret`; they are on the public allow-list in `proxy.ts` but refuse without the secret.
- **Passwords**: no shared default; invitations or one-time passwords; forced change on first sign-in; rate limiting on sensitive actions.
- **System Log**: append-only, hash-chained (tamper-evident); admin actions are also written to `admin_audit_log`.
- Output encoding: e-mail templates escape all user text; attachments are served through authenticated routes.

---

## 3. Environments and accounts for testing

| Site | URL | Database | Data | Use |
|---|---|---|---|---|
| **Dev site** | `http://localhost:3210` | local Supabase (`supabase_db_citykart_desk`) | **copy of live data** (231 stores, 554 people, ~430 tickets) plus test logins | The complete feature set, incl. vendor, PMS, approval history. Owner's machine only. |
| **Demo site** | `http://localhost:3310` | isolated "audit" Supabase stack | synthetic data, sample sheets from CSV files | Safe to share; start with preview configuration `citykart-desk-demo` (runs an isolation gate first). Older sample data (check it contains the feature you test). |
| Test automation | n/a | isolated "audit" stack | created and removed by each test | `npx vitest ...` (see §11). |

**Start the dev site:** preview configuration `citykart-desk-dev` (runs `node node_modules/next/dist/bin/next dev --port 3210`). Local Supabase containers must be running (`docker ps` shows `supabase_*_citykart_desk`). After applying a new migration restart the PostgREST container (`supabase_rest_citykart_desk`) so it sees new tables/columns.

**Logins on the dev site** (all use `<LOCAL_TEST_PASSWORD>`; ask the owner):

| Who | E-mail |
|---|---|
| Administrator | `local.admin@example.test` |
| Technician (ADMIN GROUP) | `local.tech@example.test` |
| Store requesters | `local.alc@example.test` (store ALC), `local.mar@example.test` (MAR), `local.cob@example.test` (COB) |
| Vendor technicians | `voltas.tech1@example.test`, `voltas.tech2@example.test`, `bluestar.tech1@example.test`, `bluestar.tech2@example.test`, `bluestar.tech3@example.test` |
| Vendor managers (view only) | `voltas.manager@example.test`, `bluestar.manager@example.test` |
| PO approver | `local.po.approver@example.test` |

Every real staff member also has a local login with their real e-mail and the same test password (e.g. the CVM of store ALC is a real person's profile). Do not publish those addresses.

**Login quirks (browser automation):** typing into the login form with simulated key presses works; setting field values by script may not. After login the first page can be blank — reload once. Sign out by clearing the `sb-*` cookies.

**Useful local state (2026-10-26):** stores ALC/MAR with test ACs, vendor companies Voltas/Blue Star with the logins above, two routing rules for normal AC tickets, two for AC PMS, demo tickets `CKSD-000435` (vendor AC ticket, reopened), `CKSD-000441/442` (AC PMS), `CKSD-000448/449` (Fixtures/Hangers waiting for CVM), and `[DEMO HISTORY]` earlier approvals for store ALC.

---

## 4. Roles and what each can do

| Capability | Requester (`user`) | Technician (`agent`) | Manager | Admin / Platform owner | Vendor technician | Vendor manager |
|---|---|---|---|---|---|---|
| Raise a request from the Service Catalog | yes (services visible for their location) | yes (also on behalf of others) | yes | yes | no | no |
| See own requests | yes | yes + their groups' queue | all | all | only tickets assigned to them | tickets of their company's technicians (read only) |
| Work a ticket (start, status, resolve, internal notes) | cancel/reopen own only | yes | yes | yes | Start / Resolve / Part required / PO required / messages on own tickets | none |
| Assign / reassign | no | yes | yes | yes | no | no |
| Approve/reject approvals sent to them | if named | if named | if named / any-manager steps | if named | no | no |
| Dashboards (Home, Smart Dashboard, Calendar) | Home only | Home + team views | all | all | own vendor dashboard | company dashboard |
| Reports (predefined, Report Builder, saved, scheduled) | no | depends on role settings | yes | yes | no | no |
| Admin screens (users, services, forms, SLA, rules, masters, vendors...) | no | no | some (per permission matrix) | yes | no | no |
| Platform settings and owner switches | no | no | no | admin: some; owner: all | no | no |

Vendors may open only `/vendor...`, `/profile`, `/notifications`; any other address (including a ticket link from an e-mail) sends them to their own vendor ticket page or dashboard (`lib/vendor/access.ts`, enforced in `app/(app)/layout.tsx`).

---

## 5. Data model (overview of tables)

Group | Tables
---|---
People and org | `organizations`, `profiles` (role, store_id, location_id, vendor_company_id, vendor_role), `custom_roles`, `permission_overrides`, `teams`, `team_members`, `departments`, `designations`, `locations`, `job_functions`, `cost_centers`, `stores`, `oems`
Catalog and forms | `services`, `service_categories` (flags: `auto_oem_kind`, `auto_cvm_approval`, `show_approval_history`, `is_pms`), `service_sub_categories`, `service_sub_category_tags`, `service_location_tags`, `form_templates`, `form_field_library`, `request_priorities`
Requests | `requests`, `request_comments`, `request_activity`, `request_attachments`, `request_collaborators`, `related_requests`, `request_time_entries`, `request_sequences`, `request_conversations`, `request_master_snapshots` (copy of the AC/genset row a ticket was raised for), `csat_surveys`
SLA and alerts | `sla_policies`, `field_sla_overrides`, `global_sla_config`, `business_hours`, `holidays`, `escalation_policies`, `sla_escalation_rules`, `sla_escalation_events`, `alert_rules`
Approvals | `approvals`, `approval_workflows`, `approval_workflow_steps`, `approval_decisions`, `approval_email_codes`
Automation | `business_rules`, `business_rule_events`, `assignment_rules`
Sheet masters | `master_sources` (sheet id per kind `ac|genset|cvm|pms`), `master_ac_units`, `master_gensets`, `master_store_cvm`, `master_pms_dates`, `pms_ticket_log`, `master_issues` (problem list), `master_mail_templates`, `master_google_connection`
Vendor | `vendor_companies`, `vendor_requests` (kind `parts|po`, versions, statuses), `vendor_request_items`
Intake | `intake_channels`, `intake_messages`, `intake_threads`, `intake_classifications`, `intake_reviews`, `intake_rules`, `intake_notes`, `intake_outbound`, ... (e-mail → ticket with human review)
Notifications | `notifications`, `notification_rules`, `notification_preferences`, `push_subscriptions`
Work management | `tasks` (+ assignees, comments, attachments, dependencies, custom fields, templates), `projects`, `milestones`, `project_*`
Knowledge/reports | `kb_articles`, `kb_article_services`, `saved_reports`, `scheduled_reports`
Logs/ops | `system_log`, `system_log_archive`, `system_log_chain_head`, `admin_audit_log`, `owner_audit_log`, `error_reports`, `app_settings`, `app_event_log`, `rate_limit_counters`, `retention_policies`
Weather (AC calendar) | `weather_city_geo`, `weather_city_daily`

Request status (application statuses): `open`, `assigned`, `in_progress`, `waiting_user`, `hold_purchase_ho`, `pending_approval`, `resolved`, `closed`, `cancelled`. Priorities: `low`, `medium`, `high`, `urgent`. (The database enum also holds three old unused labels; ignore them.)

---

## 6. Ticket lifecycle (state machine)

### 6.1 Statuses and who may move a ticket
| From → To | Requester | Technician/Manager/Admin | Vendor technician | Automatic |
|---|---|---|---|---|
| (new) → Open | creates | creates on behalf | – | – |
| Open → Assigned | – | via **Assign** panel only | – | Business Rule can assign |
| Open/Assigned → In Progress | – | **Start working** button only (compulsory first-response message) | **Start working** (OEM ticket number, or none for AC PMS) | CVM-category tickets go In Progress by themselves; AC OEM auto-mail tickets too |
| In Progress → Waiting on User | – | yes, **remark required** | – | – |
| Waiting on User → In Progress | replies (automatic) | yes | – | requester reply flips it back |
| In Progress → Hold due to Purchase from HO | – | yes, **remark required**, SLA paused | via Part required / PO required windows | – |
| Hold → In Progress | – | yes, **separate remark required** | Parts received / withdraw | PO approve; "end hold yourself" for Citykart |
| In Progress → Resolved | – | yes, resolution remark rules | **Resolve** (list + FSR, or PMS report) | – |
| Any → Pending Approval | – | **Send for approval** | – | CVM auto approval |
| Pending Approval → back / Cancelled | – | – | – | **approve** → returns to the status it had before; **reject** → **Cancelled** with reason "approval rejected" and a **48-hour window** for the requester to reopen |
| Resolved → Open (reopen) | yes (within window) | yes | never | CSAT link reopen |
| Resolved → Closed | – | – | – | **auto-close** after the reopen window (days set in Request Configuration) |
| Open/Assigned/… → Cancelled | own request | yes, **remark** | never | rejected PO cancels the ticket (48 h to reopen) |
| Closed, Cancelled | final | final | – | – |

Rules to test:
- `assigned` is reached **only** through assignment; `open → in_progress` only through *Start working* (`lib/constants/request-transitions.ts` is the single source for server and UI).
- Status changes by Business Rules are limited to the list `SERVER_ALLOWED_TRANSITIONS`.
- Every status change writes a row in `request_activity` and, for most, a notification/e-mail.

### 6.2 SLA
- A **SLA policy** gives response and resolution hours per priority (low/medium/high/urgent); optional **field-level overrides** can change them when a form answer has a given value. Hours count only **business hours** and skip **holidays** (Request Configuration).
- The clock **pauses** in Waiting on User, Hold due to Purchase from HO and Pending Approval, and **resumes** with the paused time credited back.
- Breach views/highlights on queue and dashboards; escalation rules fire warnings/breach notifications by percentage elapsed (job `business-rules`/`alerts`).
- Priority comes from the **sub-category**; a requester cannot choose it. Manual priority change is switched off.

### 6.3 Remarks and conversation
- Public conversation (visible to the requester and vendor), **internal notes** (staff only, never to a vendor or requester), CC of a comment to chosen people, reply-by-e-mail threading (needs the inbound mailbox; not available locally).
- Compulsory remarks: Waiting on User, Hold, Resolve, Cancel, Reject, and the second remark when leaving Hold.

---

## 7. Setting things up (administrator)

| Screen (Admin ›) | Purpose |
|---|---|
| Users, Teams (technician groups), Roles, Org, Departments/Locations/Master data | People, groups, many groups per technician, org structure. |
| Categories | Categories and sub-categories with per-category switches: *auto-send to AC/Genset OEM*, *auto approval by the store's CVM*, *show earlier requests in the approval mail*, *AC PMS category*. |
| Services | Service, its team, form template, SLA policy, allowed sub-categories, location restriction. |
| Form Templates, Field Library | Build forms: field types (text, textarea, number with min/max/integer, date, select, multi-select, checkbox, radio, email, phone, file, toggle, store address); show-only-for-categories; requester can view/set; technician-only fields; *Show in approval history*; AC picker (`options_source ac_units`). |
| SLA policies, Request Configuration | Business hours, holidays, priorities, alert/escalation rules, auto-close days, reopen window. |
| Business Rules | When a ticket is created/updated or on a schedule: conditions (category, template, requester, AC vendor, etc.) → actions (assign: direct/round-robin/load-balanced, set priority/status/team, notify). |
| Approvals (workflow builder) | Multi-step approval workflows; ad-hoc parallel approvals are created from a ticket. |
| Vendors | Vendor companies, create vendor technician/manager logins (e-mail invitation), default PO approver. |
| Sheet Masters | Connect Google, paste the sheet address of AC / Genset / CVM / AC PMS sheets, "Update from sheets now", health list, e-mail templates for OEM mails. |
| Reports, Report Builder | Predefined reports, pivot builder, saved/scheduled reports. |
| Settings, Platform settings (owner), System Log, Event log, Monitoring, Runbooks, Knowledge Base, Desktime (out of scope), Roles | Platform and operations. |

---

## 8. Feature workflows (what to test, step by step)

Each flow lists **actors → steps → expected result**. "Mail" means a file in `local-mail-outbox/`.

### 8.1 Sign-in and accounts
1. Open `/login`; sign in with e-mail + password → lands on `/home` (vendors on `/vendor`).
2. Forgot password → reset mail (file) → set new password.
3. Admin invites a user (Admin › Users) → invitation mail; user sets password; must change on first sign-in.
4. Wrong password repeatedly → rate limited message. Signed-out user opening any `/…` page → redirect to `/login?next=…`.
5. Requester opening `/admin/*` → redirected home. Vendor opening `/requests/<id>` → redirected to `/vendor/tickets/<id>`.

### 8.2 Raising a request (requester)
1. **New Request** (`/services`) lists only services visible to the requester's *location* (a service tagged to locations is hidden from others; the dev test store login needs location STORES to see "ADMIN - REQUIREMENTS (NON TRADING)").
2. Open a service → pick **Category** then **Sub-category** (search boxes) → the form shows the fields of the template; fields limited to certain categories appear after the choice (e.g. **Qty** for FIXTURES/HANGERS).
3. Fill required fields (number limits, e.g. Qty 1–10000; text lengths), attach a file (attachments required on some services) → **Submit**.
4. Expected: ticket `CKSD-nnnnnn` is created (double-submit does not create two), status Open (or automatically In Progress for auto-flow categories), SLA deadlines set from the sub-category priority, requester gets "request created" mail/notification, team members are notified, the form snapshot is stored on the ticket (later form edits do not change old tickets).
5. AC service: the **AC Serial Number** drop-down shows only the store's *Active* ACs (from the AC sheet); the chosen AC's details are saved on the ticket (`request_master_snapshots`).

### 8.3 Handling a ticket (technician)
1. `/requests/queue` (**Agent Requests**): my queue / team queue, filters, bulk actions (up to 500), nudge.
2. Open ticket → **Pick up / Assign** → **Start working** (mandatory first-response message) → status In Progress, response SLA met.
3. Use conversation (public/internal), attachments, collaborators, related tickets, tasks, **Catch me up** summary, **Download PDF**, time tracking.
4. Status panel: Waiting on User / Hold / Resolve / Cancel each with the required remark; Hold from the status list requires a separate remark when leaving.
5. Resolve → requester gets resolution mail with a CSAT link; auto-close after the reopen window.
6. **Hand a vendor-type ticket to a vendor technician** (assign to the vendor login) or let a Business Rule do it.

### 8.4 Notifications and e-mail
- Bell (unread count, pop-up), `/notifications`, per-user preferences (`/profile`), admin Notification Rules (in-app/e-mail/push per event), browser push (needs keys; off locally).
- E-mails are escaped HTML + plain text; ticket e-mails include the ticket number in the subject.
- Outbound is a file in `local-mail-outbox/`; inbound reply sync needs a real mailbox (not testable locally).

### 8.5 Approvals

**a) Ad-hoc approval by a technician.** Ticket › *Send for approval* → choose one or more approvers → ticket becomes **Pending Approval** (SLA paused) → **all approvers act in parallel; the first decision is final**. Approve → back to the previous status; Reject → Cancelled (reason "approval rejected", the requester may reopen within 48 hours, a banner offers it); every decision needs a comment. Approver can **delegate**; the sender/requester can never decide (separation of duties).
**b) Automatic CVM approval** (categories FIXTURES, FIXTURES-ATTACHMENT, HANGERS): on creation the ticket goes **In Progress** by itself, is sent to the **store's CVM** (from the CVM sheet; must be an active staff member) and waits in Pending Approval. If there is no usable CVM the ticket stays Open with an internal note.
**c) Approve from the e-mail**: the mail has Approve/Reject buttons (when a signing secret is configured) and "Review & Approve". `/approve/<signed-token>`: the page shows **only the ticket number** until the visitor proves identity (signed in as the approver, or a one-time e-mailed code); then shows details, history box and the decision form (comment required). Links expire after a number of days; a decided/closed approval shows its outcome only.
**d) Daily approval reminder** (job 10:00): one mail per approver listing everything still waiting.
**e) Approval history box (new):** for categories with the switch on (default: the three CVM categories), the approval mail, the `/approve` page and the ticket's **Approvals** tab show *Asking now* (store, category › sub-category, ticked answers such as Qty) and the **last 5 decisions of the same store and same sub-category in the last 12 months** (date, ticket, Qty, Approved/Rejected by whom, reason) and *Approved in these 12 months: Qty N*. Which answers appear is set per form field (*Show in approval history*). A form with nothing ticked shows date, ticket and decision only. A store is "everyone linked to the requester's store"; a requester without a store is compared with their own earlier requests.
Test: raise Hangers qty 80 as store ALC → mail to the CVM lists the earlier ALC hanger approvals (60 and 120 in the demo data) and "Qty 180".

### 8.6 Business Rules and assignment
- Rules run when a ticket is **created**, **updated**, or **on a schedule** (SLA-based). Conditions combine with AND/OR; actions: assign (direct / round-robin / load-balanced), set priority/status/team, notify. Rule search and execution order exist. A rule never takes a ticket away from a vendor technician.
- Test: ticket of category AC ISSUE for a Voltas store → rule gives it to a Voltas technician (round-robin between two). AC PMS ticket → the matching AC PMS rule.

### 8.7 Sheet masters (AC, Genset, CVM, AC PMS) and OEM auto-mail
Four Google Sheets are the **master lists**. CK Desk only **reads** them (read-only OAuth), copies them to its database at **11:00, 15:00 and 19:00** (and on demand), and uses the copy everywhere.
| Sheet | One row per | Used for |
|---|---|---|
| AC details | AC | AC drop-down in the ticket form, OEM e-mail addresses ("OEM Ticket Mail To"), PO approver addresses ("CK PO Approver Mail To"), PO document mail ("OEM PO Mail To"), AMC vendor, store address/cluster/region/opening date |
| Genset details | genset | OEM e-mail addresses for genset tickets |
| CVM | store | the approver of the automatic CVM approval |
| AC PMS | store + PMS date | automatic AC PMS tickets (see 8.9) |
Behaviour to test: Inactive AC leaves the store's list; a renumbered row keeps its unit; a broken sheet (missing column, unreadable) is **not applied** and the last good copy stays; a sudden mass disappearance is only applied at a later update (≥ 30 min); problems appear in **Admin › Sheet Masters › Master data health** (replaced at every update, with the check time shown) with filters AC/Genset/CVM/AC PMS; unknown store codes, bad e-mail addresses, misspelt company domains and stores with several genset rows are reported.
**OEM auto-mail:** a category set to "auto-send to the AC/Genset OEM" mails the ticket (table-style mail, To = OEM addresses, CC = company addresses) and moves it to In Progress; replies by OEM appear in the conversation; reopening mails the OEM again. For tickets assigned to a **vendor technician** the ticket stays Open for the vendor to start instead. No AC row in the sheet → ticket stays Open with an internal note.

### 8.8 Vendor portal (OEM engineers) and purchase orders
**Accounts:** Admin › Vendors › add a vendor company, then "Add a vendor login" (e-mail, name, company, *Technician* or *Manager (view only)*) → invitation mail. One login belongs to one company.
**Dashboard `/vendor`:** two tabs **My tickets** and **AC PMS tickets** (see 8.9), each with 7 boxes — *Revise price required, Open, In process, Part required, PO required from Citykart, Resolved, Cancelled* — counts, search (ticket, store, AC, OEM ticket number), list. Tab badge = tickets waiting for the vendor. **My POs** lists purchase orders; **Notifications**.
**Vendor technician steps on a normal AC ticket**
1. Ticket arrives Open (assigned by rule/technician).
2. **Start working** → must type the **OEM ticket number** (saved in the form box "AC OEM Ticket Number" + date) → In Progress, store/Citykart notified.
3. **Resolve** → choose from the **AC resolution** list (Other needs ≥10 characters of remarks) and attach the **FSR** → Resolved; the FSR shows under the resolution in the conversation.
4. **Part required** (no PO): list items (name, qty) → ticket goes on **Hold**; **Parts received** brings it back; list can be changed; withdraw.
5. **PO required**: list items with price **without GST** and attach the **quote** → on Hold; one approval request goes to the PO approvers (from the AC sheet "CK PO Approver Mail To", else the default approver set in Admin › Vendors); **any one approver can decide**.
   - **Approve** (PO number, date, PO document) → ticket back to In Progress, OEM mailed the PO.
   - **Ask for revised price** (with a note) → vendor sees "Revise price required", sends a **new quote version** (versions kept; old ones "replaced").
   - **Reject only the quote** → ticket back to In Progress, the vendor may submit another.
   - **Reject** → ticket Cancelled (48 hours to reopen), OEM mailed.
6. Messages to the store/Citykart (public only). A vendor never sees internal notes, never cancels, reassigns or reopens.
**Vendor manager:** same tabs and lists for all technicians of the company, with a Technician column, **no buttons**.
**Reopen:** the store reopens a resolved vendor ticket → it returns to the **same** vendor technician with the OEM boxes emptied; the list shows a **Reopened ×N** tag; the OEM gets a mail.
**Citykart-side:** the Purchase orders register (`/purchase-orders`, Excel export), PO decision page `/vendor-po/<id>`, "end a vendor hold yourself" for technicians.
**Limitation:** a vendor manager cannot span two companies; in a non-AC template the OEM-number box, the resolution list and the PO approver come from the AC set-up (see §12).

### 8.9 AC PMS (preventive maintenance) — new
1. **Set-up (admin):** service "AC-PMS", form template, SLA, category + sub-category "AC-PMS"; on the category tick **AC PMS category**; Admin › Sheet Masters › *AC PMS MASTER SHEET*: paste the sheet address (columns **Store Code** and **AC PMS Date**) → Save → Update; Business Rules route AC-PMS tickets to the vendor technicians of the store's AC vendor.
2. **Ticket creation:** every day at **09:00 IST** (job `pms-daily`; also after each 11/15/19 copy) one ticket per store and PMS date due is created, from **09:00 on the date**, raised from the store's active login, title `AC PMS - <store> - <dd Mon yyyy>`, with the AC-PMS service/category/sub-category. A date missed because the job did not run is still made for **2 days**, never older. `pms_ticket_log` guarantees **one ticket per store+date** even if two runs overlap. No store login / unknown store / refused ticket / no AC PMS category → no ticket, reason shown in Sheet Masters (health list "AC PMS" + "AC PMS tickets" card), retried at the next run. A date removed from the sheet does not touch tickets already made.
3. **Vendor view:** PMS tickets appear **only** in the *AC PMS tickets* tab (never in *My tickets*), same 7 boxes. Lighter visit: button **Start PMS visit** (no OEM number) → **Resolve** needs only the **PMS report** attachment (+ optional remarks) → text "AC PMS done. …". Parts required / PO required / Revise price work as for AC.
4. **Reports:** AC Ticket Calendar and the AC complaint reports do not count PMS tickets.

### 8.10 Dashboards, Ticket Calendar and reports
- **Home** (`/home`): KPI tiles and my requests / my queue / tasks (streaming; one RPC `get_home_dashboard`).
- **Smart (interactive) Dashboard** `/dashboards/executive`: KPI scorecard with trend, click-to-drill pop-up (4 steps), cascading filters (group, service, category, sub-category, technician, region/cluster/state), time periods (7/30/60/90/120 days, FY), priority strip, Stores & Regions view, Group & OEM matrix, Workload & Approvals view, heatmap and ticket explorer, export, drag-and-drop widgets.
- **Ticket Calendar** (inside the dashboard): one calendar per group the viewer may see ("IT Ticket Calendar", …), days coloured green / yellow (> 10 % over the group's normal) / red (> 30 %), future days grey; **machine mode** (AC/genset serial, "ACs that fail again and again", same issue again) and **ticket-volume mode**; break-down by service/category/sub-category/technician/cluster/region/state; day pop-up; **outside temperature** (daily high/low, fetched once at 08:00 per city by a job; only city names are sent out).
- **Reports:** Predefined Reports (`/reports/analytics`, e.g. AC Issues, Red Flag Store, AMC Vendor, Repeated AC Complain, weekly/monthly summaries), **Report Builder** (`/reports/pivot` and Admin › Reports) with saved reports and scheduled reports (the screens exist; automatic e-mailing of schedules is **not built**), Excel/CSV exports (each export is logged). All dates are India time.

### 8.11 CSAT, auto-close, reopen
- Resolved → mail with signed link `/csat/<token>` (no login) to rate 1–5 or reopen; a low rating alerts managers; one reminder; **auto-close** after the configured days (job `csat`, every 30 min).
- Requester can reopen within the window; closed is final. A rejected approval can be reopened by the requester with a banner.

### 8.12 Intake, projects, tasks, knowledge
- **E-mail intake** (`/intake`): messages from a connected mailbox are classified and reviewed by a human before becoming tickets (needs a real mailbox; not testable locally). WhatsApp/DeskTime: out of scope.
- **Projects/milestones**, **Tasks** (subtasks, templates, custom fields, dependencies), **Knowledge Base**, **Runbooks**: standard CRUD flows.

---

## 9. Scheduled jobs

| Job (cron-tick name) | Route | Frequency (production tasks) | What it does |
|---|---|---|---|
| `alerts` | `/api/alerts/run` | 30 min | due-soon / overdue / unassigned alerts; 08:00 daily digest |
| `business-rules` | `/api/business-rules/run` | 15 min | scheduled rules, SLA escalation |
| `email-reply-sync` | `/api/email/inbound-sync` | 1 min | pull replies from the mailbox |
| `csat` | `/api/csat/run` | 30 min | auto-close, CSAT reminder |
| `system-log-archive` | `/api/system-log/archive` | 6 h | move old log rows to the archive |
| `approval-reminders` | `/api/approvals/reminders` | daily 10:00 | one mail per approver |
| `masters-sync` | `/api/masters/sync` | 11:00, 15:00, 19:00 | copy AC/Genset/CVM/PMS sheets; make due PMS tickets |
| `weather-daily` | `/api/weather/daily` | daily 08:00 | daily high/low temperature per city |
| `pms-daily` | `/api/pms/daily` | daily 09:00 | re-read sheets, make the PMS tickets due today |
| intake classify, desktime | `/api/intake/cron/classify`, `/api/desktime/sync` | – | out of scope |

How to run a job locally: `GET http://localhost:3210/api/<route>` with header `x-cron-secret: <value of CRON_SECRET in .env.local>` (do not print the secret). The "Update from sheets now" button runs the sheet copy and the PMS step.

---

## 10. End-to-end test scenarios (suggested)

Record for each: steps done, expected, actual, screenshot, files checked in `local-mail-outbox/`.

| # | Scenario | Key checks |
|---|---|---|
| E1 | Store raises a general request, technician handles and resolves, requester rates | ticket number, SLA times, remarks compulsory, status history, mails, CSAT link, auto-close |
| E2 | Waiting on User round trip | SLA pause/resume, requester reply flips status back |
| E3 | Hold due to Purchase from HO | only technician can set/leave, two remarks, requester sees no option |
| E4 | Store raises an **AC ticket** | AC list = active ACs only; OEM mail table; ticket In Progress (non-vendor) or Open for vendor |
| E5 | **Vendor flow**: Start (OEM no.) → Part required → Parts received → PO required → revise price → approve | statuses, versions, mails, PO register, approver rules ("any one decides") |
| E6 | PO **reject** and **reject only the quote** | cancelled with 48 h reopen vs back to In Progress |
| E7 | Reopen a resolved vendor ticket | same technician, OEM boxes cleared, "Reopened ×1" tag, OEM mail |
| E8 | **CVM approval with history**: raise Fixtures (qty) and Hangers (qty) as a store | auto In Progress → Pending Approval; mail and Approvals tab show earlier same-store/same-sub-category decisions and total; approve/reject needs comment; status resumes |
| E9 | **AC PMS**: sheet date today → job → ticket; vendor sees it only in PMS tab | one ticket per store+date; no OEM number; PMS report needed; AC calendar excludes it |
| E10 | Sheet health | edit/break a sheet (demo CSV) → error shown, last copy kept; fix → problems cleared |
| E11 | Business rule routing and round-robin | assignment alternates; ticket never taken from a vendor |
| E12 | Smart Dashboard and Ticket Calendar | filters change KPIs; drill-down pop-up; calendar colours; group visibility only for groups the user may see |
| E13 | Reports and exports | predefined report numbers match the ticket list; CSV/Excel download; export logged |
| E14 | Admin: create user, vendor login, category/service/form change | invitation mail; old tickets keep their old form snapshot |
| E15 | Role boundaries | requester cannot open admin pages; vendor sees only own tickets and no internal notes; vendor manager has no buttons; approver cannot approve own request |

### 10.1 Negative and security checks
- Direct URL access to another user's ticket (`/requests/<id>`) → not found/redirect.
- Vendor opening `/admin`, `/requests/...`, `/dashboards/...` → redirected to `/vendor`.
- Internal notes never visible to requester/vendor (UI and API).
- `/api/*` job routes without `x-cron-secret` → 401; with wrong secret → 401.
- `/approve/<tampered token>` → "link not valid"; before identity proof only the ticket number is visible.
- Forms: number outside limits, over-long text, missing required fields, wrong sub-category for a service → rejected server-side.
- Double click on Submit → one ticket. Two PMS job runs at once → one ticket per store+date.
- HTML/script in titles, comments, names → escaped in UI and in e-mails.

---

## 11. Test automation in the repository

| Suite | Where | How to run | Notes |
|---|---|---|---|
| Unit (≈1,560 tests, no database) | `tests/unit` | `npx vitest run tests/unit` | fast; run after every change |
| Security / feature suites on the **isolated** stack | `tests/vapt/*.test.ts` | `bash security-assessment-2026-10/07-FINAL-REMEDIATION/tools/run-suite.sh <logfile> --config vitest.vapt.config.ts tests/vapt/<file>` | runs an **isolation gate** first (21 checks that nothing can reach production); never bypass it |
| Remediation / hardening | `tests/remediation` | same runner with `--config vitest.remediation.config.ts` | |
| Integration | `tests/integration` | `npx vitest run tests/integration` (**verify** which need the stack) | |
Quality gates: `npm run typecheck` (tsc), `npm run lint`. Build with `node node_modules/next/dist/bin/next build`.
Relevant suites for the newest features: `tests/vapt/34-sheet-masters`, `36-vendor-module`, `37-vendor-mail-journey`, `38-ac-calendar-weather`, `39-approval-history`, `40-ac-pms`, `21-approvals-separation`.

---

## 12. Known limitations, open points, not built

- **Vendor flow in other templates (design suggested, not built):** today *Start working* always asks for a number (saved in a form box only if the form has "AC OEM Ticket Number", otherwise only in the conversation text); *Resolve* offers only "Other" (+ remarks ≥ 10 chars) + attachment when the form has no "AC resolution" list; the PO approver is the AC sheet's, else the single default approver (no per-category approver); the PO mail to the OEM needs an AC-sheet row (otherwise skipped with an internal note). AC PMS uses a lighter flag (`is_pms`).
- Tickets do not store the store; the store of an old ticket is the requester's **current** store (affects the approval-history box when a person moves store).
- Not built: automatic e-mailing of scheduled reports, reminder for a waiting quote, vendor replies by e-mail, weather fallback by nearest store, calendar fix for reopened tickets, CK Desk Bot, Google Workspace user sync.
- Blank page after the first login in a fresh browser tab (reload fixes). The vendor ticket form can be stale after "Ask for revised price" until reloaded.
- A vendor manager cannot manage two vendor companies with one login.
- Engineer-visit module and WhatsApp/DeskTime: not part of the delivered scope.
- Local site cannot test: inbound e-mail reply sync, browser push (no keys), real Google Sheets without the OAuth connection (the demo site uses CSV sheets).

---

## 13. Where to read more

| Topic | File |
|---|---|
| Original architecture (2026-08, partly outdated) | `docs/ARCHITECTURE.md`, `docs/DATABASE.md` |
| Full application design | `docs/CITYKART-DESK-FULL-APPLICATION-DESIGN.md`, `CITYKART_DESK_COMPLETE_SPEC.md` |
| Sheet masters | `docs/SHEET-MASTERS-GUIDE.md`, `docs/OEM-BY-TYPE-GUIDE.md`, `docs/STORE-CVM-AND-CATEGORY-FIELDS-GUIDE.md` |
| Vendor design / e-mails | `docs/VENDOR-TECHNICIAN-DESIGN.md`, `docs/VENDOR-EMAIL-MAP.md` |
| AC PMS, AC calendar | `docs/AC-PMS.md`, `docs/AC-CALENDAR.md` |
| Manual UAT checklist | `docs/CITYKART-DESK-MANUAL-UAT-CHECKLIST.md` |
| Feature lists by role / management status (Excel) | `docs/CKDESK-FEATURES-BY-ROLE.xlsx`, `docs/CKDESK-MANAGEMENT-FEATURE-STATUS.xlsx` |
| Production topology and deployment (not for testing) | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` |

---

## Appendix A — Feature inventory (generated from the verified feature list)

Columns: module · feature · what it does · who uses it · status on the **local** site / on **live**. "Done" = working and verified; "Pending" = not built.

| Module | Feature | What it does | Who | Local | Live |
|---|---|---|---|---|---|
| Sign-in and accounts | Sign in with e-mail and password | Everyone logs in with their e-mail; no public sign-up. | Requester, Technician, Manager/Admin, Vendor | Done | Done |
| Sign-in and accounts | Forgot password and invitation by e-mail | Reset a password or accept an invitation by e-mail (sent through the app mailbox). | Requester, Technician, Manager/Admin, Vendor | Done | Done |
| Sign-in and accounts | Password rules | No shared default password; random one-time passwords or invitations; must change on first sign-in. | Requester, Technician, Manager/Admin, Vendor | Done | Done |
| Sign-in and accounts | My Profile | See who you report to and your team; set which notifications you want. | Requester, Technician, Manager/Admin | Done | Done |
| Sign-in and accounts | Roles | Requester, technician, manager, admin, platform owner, each with its own pages and rights. | Manager/Admin | Done | Done |
| Sign-in and accounts | Permission matrix with owner switches | Four switches the owner controls; defaults keep today's behaviour. | Manager/Admin | Done | Done |
| Sign-in and accounts | User administration | Invite or create users, bulk Excel import, change role, change sign-in e-mail, deactivate, reset password. | Manager/Admin | Done | Done |
| Sign-in and accounts | Technician groups and many groups per technician | Create groups; one technician can belong to several. | Technician, Manager/Admin | Done | Done |
| Sign-in and accounts | Vendor logins (technician and manager) | OEM engineers and their managers get their own limited logins. | Manager/Admin, Vendor | Done | Pending |
| Raising a request | Create Request page | One page with three panels and personal shortcuts to raise a request quickly. | Requester, Technician | Done | Done |
| Raising a request | Service catalogue | Services with categories and sub categories, tags and locations. | Requester, Manager/Admin | Done | Done |
| Raising a request | Dynamic forms per service | Each service has its own form: field types, required fields, conditions. | Requester, Manager/Admin | Done | Done |
| Raising a request | Form Templates and Field Library | Reusable forms and reusable field definitions. | Manager/Admin | Done | Done |
| Raising a request | Number and text limits in the form builder | Smallest and largest number, whole numbers only, shortest and longest text. | Manager/Admin, Requester | Done | Done |
| Raising a request | Fields limited to categories | A field (for example Qty) appears only for chosen categories. | Manager/Admin, Requester | Done | Done |
| Raising a request | Attachments with preview | Add files, get a clear popup if a file is too big, preview without downloading. | Requester, Technician | Done | Done |
| Raising a request | Ticket title from the Subject field | The ticket is named after the Subject the requester typed. | Requester | Done | Done |
| Raising a request | No double tickets | Pressing Submit twice within 15 seconds makes one ticket. | Requester | Done | Done |
| Raising a request | Ticket numbers | Every request gets a number such as CKSD-000385. | Requester, Technician, Manager/Admin, Vendor | Done | Done |
| Raising a request | Pick your own AC | For an AC problem the form lists the store's own ACs from the AC sheet. | Requester | Done | Pending |
| Handling requests | Agent Requests (my queue and team queue) | Work queue with search by requester, store, technician, service and description; resolved hidden by default. | Technician, Manager/Admin | Done | Done |
| Handling requests | Assignment | Assign by hand, by Business Rules, round-robin or load-balanced. | Technician, Manager/Admin | Done | Done |
| Handling requests | Start working with first response | One click starts work and posts an automatic first response. | Technician | Done | Done |
| Handling requests | Status flow with compulsory remarks | Open, In Progress, Waiting on user, Hold due to Purchase from HO, Resolved, Closed, Cancelled; remarks required. | Technician | Done | Done |
| Handling requests | Hold due to Purchase from HO | A status for tickets waiting for a Head Office purchase; the clock pauses. | Technician | Done | Done |
| Handling requests | Resolution note rules | A resolution note must say what was done (10+ characters) and never carry a password. | Technician | Done | Done |
| Handling requests | Cancel with a remark | Requester or technician cancels; a remark is compulsory. | Requester, Technician | Done | Done |
| Handling requests | Reopen a resolved request | Banner with a countdown, compulsory remark, expiry message. | Requester, Technician | Done | Done |
| Handling requests | Reopen after a rejected approval | The requester can reopen within 48 hours. | Requester | Done | Done |
| Handling requests | Priority from the sub category | Priority comes from the sub category; nobody can change it by hand. | Technician, Manager/Admin | Done | Done |
| Handling requests | Service of a ticket is locked | Nobody can change the service of an existing ticket. | Manager/Admin | Done | Done |
| Handling requests | Collaborators and related requests | Add people to a ticket; see related requests. | Technician | Done | Done |
| Handling requests | "Catch me up" summary | A short summary of what happened and what is pending on a ticket. | Technician, Manager/Admin | Done | Done |
| Handling requests | Ticket as PDF | Download the ticket, the form, the whole conversation and the history in one PDF. | Requester, Technician, Manager/Admin | Done | Done |
| Handling requests | Automatic time tracking | Time starts when work starts and stops when it leaves In Progress. | Technician | Done | Done |
| Handling requests | Nudge | Remind the handling technician from the dashboard. | Manager/Admin, Technician | Done | Done |
| Handling requests | Bulk actions | Act on many tickets at once (up to 500). | Technician, Manager/Admin | Done | Done |
| Handling requests | Auto-close after the reopen window | A resolved ticket closes by itself when nobody reopens it in time. *(Runs whenever someone opens the Home page (there is no scheduled job))* | Technician, Manager/Admin | Done | Done |
| Handling requests | Ticket history | Every change recorded and shown as a timeline. | Requester, Technician | Done | Done |
| Handling requests | Hand AC tickets to a vendor technician | Rules give the AC ticket to the OEM's engineer; the ticket shows "With vendor". | Manager/Admin, Technician | Done | Pending |
| Handling requests | End a vendor hold yourself | A Citykart technician can take the ticket back from hold; the vendor is told. | Technician | Done | Pending |
| Conversation and e-mail | Public conversation | Messages between requester and technician with files under each message. | Requester, Technician, Vendor | Done | Done |
| Conversation and e-mail | Internal notes | Notes only Citykart staff can see. | Technician, Manager/Admin | Done | Done |
| Conversation and e-mail | CC a comment | Send a comment, with the whole ticket, to CK Desk users and OEM contacts. | Technician | Done | Done |
| Conversation and e-mail | Reply by e-mail | A reply to a ticket mail is read from the mailbox every minute and added to the conversation. | Requester, Technician | Done | Done |
| Conversation and e-mail | AC ticket: automatic OEM e-mail and In Progress | The ticket is mailed to the store's AC OEM by itself (table-style mail) and moves to In Progress; OEM replies show in the conversation. *(Works when the store has an AC OEM mapped; confirmed working on main)* | Technician | Done | Done |
| Conversation and e-mail | Genset ticket: automatic OEM e-mail and In Progress | The same automatic mail and In Progress for genset tickets. *(Code is on main but NOT switched on: needs the category set to Genset in Admin and a Genset OEM on each store (the Genset sheet will supply the addresses))* | Technician | Done | Built - switched off |
| Conversation and e-mail | Ticket e-mails | Mails for logged, assigned, status change, resolved, cancelled, with the technician's comment and real ticket title. | Requester, Technician | Done | Done |
| Conversation and e-mail | Notification rules | Admin chooses, per event, in-app, e-mail or push; users can opt out. | Manager/Admin, Requester, Technician | Done | Done |
| Conversation and e-mail | Bell, unread count and pop-up | A bell and a small corner pop-up for new notifications. | Requester, Technician, Manager/Admin, Vendor | Done | Done |
| Conversation and e-mail | Browser push notifications | Optional push messages in the browser. *(Code is on main but the live server has no push keys, so it is switched off)* | Requester, Technician, Manager/Admin, Vendor | Done | Built - switched off |
| Conversation and e-mail | Mailbox settings | Admin sets the sending mailbox without a redeploy. | Manager/Admin | Done | Done |
| SLA | SLA policies and business hours | Response and resolution targets per service and priority, business hours, holidays. | Manager/Admin | Done | Done |
| SLA | Field-level SLA overrides | A form answer can set a shorter SLA. | Manager/Admin | Done | Done |
| SLA | Pause and resume | The clock pauses while waiting on the user or on hold and resumes with the paused time credited. | Technician | Done | Done |
| SLA | Breach views and highlights | "Currently breached", SLA compliance %, breach counts on dashboards and in reports. | Technician, Manager/Admin | Done | Done |
| SLA | Escalation and alert rules | Rules at 15-minute checks for SLA % used or unassigned tickets; alerts by e-mail. | Manager/Admin | Done | Done |
| SLA | Daily alert digest | One summary mail every morning at 08:00. | Manager/Admin | Done | Done |
| Approvals | Approval flows | Single or multi-step, sequential or parallel; flows set per service. | Technician, Manager/Admin | Done | Done |
| Approvals | Approve from the e-mail link | Approve or reject from a personal link with identity check and compulsory comment; links expire after 7 days. | Requester, Technician, Manager/Admin | Done | Done |
| Approvals | Quick approve | Approve from the Approvals list or the bell. | Technician, Manager/Admin | Done | Done |
| Approvals | Add approvers and delegate | Add approvers while pending; delegate a step; first answer decides. | Technician, Manager/Admin | Done | Done |
| Approvals | Separation of duties | Nobody approves what they raised or sent. | Manager/Admin | Done | Done |
| Approvals | Daily approval reminder | One mail at 10:00 to each approver listing what is waiting. | Manager/Admin | Done | Done |
| Approvals | Automatic CVM approval | Fixtures / Hangers tickets go to the store's CVM for approval by themselves. *(Works once each store has its CVM assigned in Admin (set-up in progress))* | Technician, Requester | Done | Done |
| Automation | Business Rules | No-code rules on create, update or schedule: assign, set status, priority, team, notify. | Manager/Admin | Done | Done |
| Automation | Round-robin and load-balanced assignment | Spread tickets over technicians. | Manager/Admin | Done | Done |
| Automation | Rule search | Find a rule by typing part of its name or description. | Manager/Admin | Done | Done |
| Automation | Rules for vendor technicians | A rule can give a ticket to a vendor technician and never takes it away from him. | Manager/Admin | Done | Pending |
| Equipment (AC, Genset) and OEM | OEMs by type (AC and Genset) | One OEM per type per store; a category can send its tickets to the store's OEM. | Manager/Admin | Done | Done |
| Equipment (AC, Genset) and OEM | Red-flag stores | Stores whose open AC tickets exceed a percentage of their ACs. | Technician, Manager/Admin | Done | Done |
| Equipment (AC, Genset) and OEM | AC and AMC reports | Store AC Not Working, AMC vendor, AC issues, repeated AC complaints. | Technician, Manager/Admin | Done | Done |
| Equipment (AC, Genset) and OEM | OEM mail again on reopen | When a store reopens a resolved ticket the OEM is mailed again. | Technician | Done | Pending |
| Equipment (AC, Genset) and OEM | AC and Genset master screens | Lists with filters, counts by brand, tonnage and region, Excel download. | Manager/Admin | Done | Pending |
| Master data | Store Master | Stores with cluster, region, state, AC brand, priority list; Excel upload (with sample) and export. | Manager/Admin | Done | Done |
| Master data | Organisation structure | Departments, locations, cost centres, job functions, designations. | Manager/Admin | Done | Done |
| Master data | Store CVM | One CVM per store; one CVM can have many stores. | Manager/Admin | Done | Done |
| Master data | Google Sheets as master data | AC, Genset and CVM sheets copied into CK Desk at 11:00, 15:00, 19:00 or by "Update now". | Manager/Admin | Done | Pending |
| Master data | Sheet health page | Shows bad rows, bad addresses, approvers who are not CK Desk users. | Manager/Admin | Done | Pending |
| Master data | CVM from the sheet | The store's CVM comes from the CVM sheet. | Manager/Admin | Done | Pending |
| Vendor portal | Vendor dashboard | Boxes: Revise price required, Open, In process, Part required, PO required, Resolved, Cancelled, each with whose turn it is. | Vendor | Done | Pending |
| Vendor portal | Vendor manager view | A vendor manager sees all tickets of his company, view only. | Vendor | Done | Pending |
| Vendor portal | Start working with the OEM ticket number | The engineer enters the OEM's ticket number to start; the store is told. | Vendor | Done | Pending |
| Vendor portal | Resolve with AC RESOLUTION list and FSR | Pick the fix from the list (or Other with a note) and attach the FSR (compulsory). | Vendor | Done | Pending |
| Vendor portal | Messages with the store | Two-way conversation with files. | Vendor, Requester | Done | Pending |
| Vendor portal | Part required (no PO) | Parts list, ticket on hold, correct the list, withdraw, "Parts received" with a remark. | Vendor, Requester | Done | Pending |
| Vendor portal | PO required with a quote | Items with prices (without GST) and a compulsory quote file; approver told. | Vendor | Done | Pending |
| Vendor portal | Revise price required | The approver asks for a lower price; the ticket moves to a box; send a new quote. | Vendor | Done | Pending |
| Vendor portal | Quote versions | Every change is a new version; old versions cannot be approved. | Vendor, Manager/Admin | Done | Pending |
| Vendor portal | Reject only the quote | The ticket goes on; the vendor arranges the parts himself. | Vendor, Manager/Admin | Done | Pending |
| Vendor portal | Vendor e-mails | Mails for assigned, revised price, PO approved (with document), quote not approved, cancelled, reopened, hold ended. | Vendor | Done | Pending |
| Vendor portal | Reopened tag | A red "Reopened xN" tag and the old OEM ticket number cleared. | Vendor | Done | Pending |
| Vendor portal | Safe vendor access | A vendor sees only his own tickets, cannot raise requests, never sees internal notes. | Vendor | Done | Pending |
| Purchase orders | PO approval page | Approve (PO number, date, document), ask for a revised price, reject quote only, or reject and cancel. | Manager/Admin | Done | Pending |
| Purchase orders | Approvers from the AC sheet | The AC sheet names the approvers per AC (several allowed); one mail to all; first decision wins. | Manager/Admin | Done | Pending |
| Purchase orders | Default PO approver | Used when the sheet names nobody. | Manager/Admin | Done | Pending |
| Purchase orders | Purchase orders register | All POs with search and Excel download; vendors see their own. | Manager/Admin, Vendor | Done | Pending |
| Purchase orders | OEM mail on PO decision | The OEM gets the approved PO with the document, or a short rejection note. | Manager/Admin | Done | Pending |
| Dashboards - interactive | Home dashboard | Counts and lists for you: my open, my queue, team open, my requests. | Requester, Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Interactive Smart Dashboard | One dashboard for every role, narrowed to what the viewer may see; every number, bar and name can be clicked. | Requester, Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | KPI scorecard with trend | Created, resolved, backlog, breaches, SLA %, resolution time, CSAT, reopened, first response, each with a trend and the previous period. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Click-to-drill pop-up (4 steps) | Click a number: cohort, then stores and technicians, then the ticket list, then one ticket with its history. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Cascading filter bar | Group, technician, region, state, cluster, store type, OEM brand, AC health, status, SLA, search; each list shows only what fits the others. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Time periods | 30, 60, 90, 120 days, this financial year or custom dates, with a compare-to-previous switch. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Priority highlights strip | Six signals such as SLA risk, workload, OEM, approvals, AC red flags, new stores. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Stores and Regions view | Regions, states, clusters and stores side by side with AC position. | Manager/Admin | Done | Done |
| Dashboards - interactive | Group and OEM matrix | Group by OEM brand matrices with clickable cells. | Manager/Admin | Done | Done |
| Dashboards - interactive | Workload and Approvals view | Technician workload and approvals waiting, with Nudge. | Manager/Admin | Done | Done |
| Dashboards - interactive | Heatmap and ticket explorer | A ticket list that follows every filter, with heatmap. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Export from the dashboard | Download the filtered tickets as CSV. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Technician dashboard and workload | Group workload, 9-bucket ageing, daily activity, highest-open banner. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Drag-and-drop dashboard widgets | Reorder widgets on the normal dashboards. | Technician, Manager/Admin | Done | Done |
| Dashboards - interactive | Service, Category and Sub category filters | Three more filters in the dashboard bar, each narrowing the next. | Technician, Manager/Admin | Done | Pending |
| Ticket Calendar | Ticket Calendar for every group | A month calendar named after the group ("IT Ticket Calendar"); days coloured green, yellow, red, grey for the future. | Technician, Manager/Admin | Done | Pending |
| Ticket Calendar | Colour by the group's own normal | For groups without assets the colour compares each day with that group's usual open level over 90 days. | Technician, Manager/Admin | Done | Pending |
| Ticket Calendar | Place picker | Look at all Citykart, a state, region, cluster or one store. | Technician, Manager/Admin, Requester | Done | Pending |
| Ticket Calendar | Faulty AC and genset calendar | For AC and Genset work: share of faulty machines per day (above 10% yellow, above 30% red), raised and fixed. | Technician, Manager/Admin, Requester | Done | Pending |
| Ticket Calendar | ACs that fail again and again | Repeat-fault ACs by serial number (4+ = repeat, 2-3 = watch) with "came back within 30 days of a fix" and who fixed it last. | Technician, Manager/Admin | Done | Pending |
| Ticket Calendar | Same issue again | Same store and same issue raised again; the repeat list for groups without assets. | Technician, Manager/Admin | Done | Pending |
| Ticket Calendar | Break it down by | Technician, cluster, region, state, store, category, sub category: open now, raised, fixed. | Technician, Manager/Admin | Done | Pending |
| Ticket Calendar | Day pop-up | Click a day to see the tickets raised, fixed and still open that day. | Technician, Manager/Admin, Requester | Done | Pending |
| Ticket Calendar | Worst places right now | Ranking of stores, clusters, regions or states by share of faulty ACs; click to open. | Manager/Admin | Done | Pending |
| Ticket Calendar | Outside temperature | Highest and lowest temperature per day for the place, collected once a day at 08:00 (AC and genset views only). | Technician, Manager/Admin | Done | Pending |
| Reports | Report Builder | Build your own pivot or table report from requests, tasks, projects, milestones and approvals. | Technician, Manager/Admin | Done | Done |
| Reports | Saved reports | Save a report and open it again. | Technician, Manager/Admin | Done | Done |
| Reports | Report Analytics | Fixed reports: age bucket, ticket status, store-wise, AC Not Working, AMC vendor (Excel-style, expand and collapse). | Technician, Manager/Admin | Done | Done |
| Reports | Predefined Reports | 12 fixed Excel-style reports plus weekly, monthly, priority-wise and repeated AC complaint reports; search by name. | Technician, Manager/Admin | Done | Done |
| Reports | Excel and CSV exports | Download a report or a list as CSV or Excel; every export is logged. | Technician, Manager/Admin | Done | Done |
| Reports | India-time reporting | Dates and weeks use India time everywhere. | Technician, Manager/Admin | Done | Done |
| Projects, tasks, knowledge | Projects and milestones | Projects with owner, team, dates, milestones, updates and progress %. | Technician, Manager/Admin, Requester | Done | Done |
| Projects, tasks, knowledge | Tasks | Personal and team tasks with subtasks, dependencies, templates, custom fields, comments, files. | Technician, Manager/Admin, Requester | Done | Done |
| Projects, tasks, knowledge | Knowledge Base | Help articles per service. | Requester, Technician, Manager/Admin | Done | Done |
| Projects, tasks, knowledge | Runbooks | A documentation browser for the admin set-up. | Manager/Admin | Done | Done |
| Customer satisfaction | Rate the fix (CSAT) | One-click 1-5 stars in the "resolved" mail, or "not fixed, reopen"; one reminder. | Requester | Done | Done |
| Customer satisfaction | Low-rating alert | An alert when a rating is low. | Manager/Admin | Done | Done |
| Intake channels | E-mail intake with human review | Mails are classified (rules, optional AI) and a reviewer turns them into tickets. *(Built, switched off for the organisation)* | Manager/Admin | Done | Built - switched off |
| Intake channels | Intake rules and classification | Rules and an optional AI model sort incoming messages. *(Part of the e-mail intake)* | Manager/Admin | Done | Built - switched off |
| Administration, security and logs | Categories, services and SLA set-up screens | All admin screens to define categories, services, templates, SLA, priorities, business hours. | Manager/Admin | Done | Done |
| Administration, security and logs | Platform settings | Retention, integrations, sending mailbox. | Manager/Admin | Done | Done |
| Administration, security and logs | Security hardening | Server-only writes, row-level security, per-purpose secrets, rate limits, report-only content policy, Next.js 16.3.8. | Manager/Admin | Done | Done |
| Administration, security and logs | System Log (tamper-evident) | One Logs menu: system log with a hash chain, ticket activity, event log, errors, retention. | Manager/Admin | Done | Done |
| Administration, security and logs | Monitoring and health | Live stats, health address, version address, log shipper. | Manager/Admin | Done | Done |
| Administration, security and logs | Daily weather job | A scheduled task at 08:00 that saves the day's highest and lowest temperature of each city. | Manager/Admin | Done | Pending |
| Not built yet | Send scheduled reports by e-mail | The screens to define a schedule exist, but no job sends the reports yet. | Manager/Admin | Pending | Pending |
| Not built yet | Reminder for a waiting quote | Remind the approver after 1 day and the vendor after 2 days if a revised price is not answered. | Manager/Admin, Vendor | Pending | Pending |
| Not built yet | Vendor replies by e-mail | A vendor answers a mail and it lands in the conversation (not tested for vendors). | Vendor | Pending | Pending |
| Not built yet | Weather fallback by the nearest store | For cities the weather service cannot find, use the nearest store of the same cluster. | Manager/Admin | Pending | Pending |
| Not built yet | Calendar fix for reopened tickets | A reopened ticket counts as open for its whole life in the calendar; correct it from the history. | Manager/Admin | Pending | Pending |
| Not built yet | CK Desk Bot | A question-and-answer assistant on tickets and knowledge (plan only). | Requester, Technician | Pending | Pending |
| Not built yet | Google Workspace user sync | Create and update users from Google Workspace (plan only). | Manager/Admin | Pending | Pending |
| AC PMS (new) | AC PMS Google Sheet and daily tickets | Store Code + AC PMS Date sheet; one ticket per store and date from 09:00; same date only (a passed date is never made); log prevents duplicates; reasons shown in Sheet Masters. *(Local only (migration 184))* | Manager/Admin, Technician | Done | Pending |
| AC PMS (new) | Vendor tabs: My tickets / AC PMS tickets | Two tabs with the same 7 boxes; a ticket is in exactly one tab; tab badge shows what waits for the vendor. *(Local only)* | Vendor | Done | Pending |
| AC PMS (new) | Lighter PMS visit for vendors | Start PMS visit without OEM ticket number; resolve with the PMS report attachment. *(Local only)* | Vendor | Done | Pending |
| Approvals (new) | Approval history box | Approval mail, approve page and Approvals tab show what the store asks now and the last decisions of the same store and sub-category (Qty etc. ticked per form field). *(Local only (migration 183))* | Technician, Manager/Admin | Done | Pending |
| Sheet masters (new) | Master data health with check time | Problem list replaced at every update, shows when it was checked; filter AC / Genset / CVM / AC PMS. *(Local only)* | Manager/Admin | Done | Pending |

(155 rows. "Live" = the production system as of the last comparison; "Built - switched off" means the code is on live but the switch is off.)

## Errata found by the QA of 26 Oct 2026

The independent QA (folder `qa-release-candidate-2026-10/`) read the code behind every row of Appendix A. Where the text above is wrong or incomplete, the code is right. Nothing above was rewritten, so the first reading stays visible.

### Where the guide and the code differ

* **D001** — Guide: Guide 8.8 step 5 and scenario E6: 'Reject only the quote' puts the ticket back to In Progress. **Code:** The ticket stays on Hold (SLA still paused) and moves to the vendor's Part required box with the quote items (no prices). Only cancelTicket=true cancels.
* **D002** — Guide: Appendix A, Auto-close: 'Runs whenever someone opens the Home page (there is no scheduled job)'. Sections 8.11 and 9 say job csat every 30 minutes. **Code:** Auto-close is done by /api/csat/run (every 30 min, all organisations); the Home trigger is only a legacy extra for managers. The guide contradicts itself.
* **D003** — Guide: Appendix A: Permission matrix has 'four switches'. **Code:** Six policy keys exist (global_settings_write, business_rules_write, workflow_edit, intake_priority_override, external_invites, report_recipients). Guide section 2.4 lists six.
* **D004** — Guide: Guide 8.10: time periods 7/30/60/90/120 days, FY. **Code:** Period options are 30d, 60d, 90d, 120d, fy and custom; no 7-day option (Appendix A is right).
* **D005** — Guide: Guide 8.10 lists drag-and-drop widgets as part of the Smart Dashboard. **Code:** @dnd-kit widget reordering exists only in AnalyticsDashboard (/dashboards and /admin/reports), not in the Smart Dashboard (Appendix A says normal dashboards).
* **D006** — Guide: Guide 8.10: calendar days are yellow when >10% and red when >30% over the group's normal. **Code:** The 10%/30% rule applies to the share of faulty ACs (AC/genset calendar). Groups without assets use the median and busiest-15% level of the last 90 days.
* **D007** — Guide: Appendix A lists Requester as a user of the Smart Dashboard, Place picker, Faulty AC calendar and Day pop-up ('one dashboard for every role'). Section 4 says requesters get Home only. **Code:** /dashboards/executive redirects role user to /home and the sidebar hides it from requesters. Section 4 is right; Appendix A 'Who' is wrong for those rows (the requester level copy in levels.ts is unreachable).
* **D008** — Guide: Section 4: Reports - requester: no. **Code:** Report Builder (/reports/pivot) is open to every signed-in role with the Requests module; a requester sees only their own tickets (scope own). Other entities stay manager+.
* **D009** — Guide: Appendix A: Knowledge Base used by Requester and Technician. **Code:** The only Knowledge Base screen is /admin/knowledge-base (manager, admin, platform owner); no requester-facing article page was found.
* **D010** — Guide: Appendix A 'Roles ... each with its own pages and rights' and section 7 Roles screen. **Code:** Admin > Roles permission matrix (custom roles / overrides) is read-only and labelled 'Not enforced - Coming soon'; toggles change nothing. Only the five fixed roles are enforced.
* **D011** — Guide: Section 6.1 transition table. **Code:** Agents may also move Waiting on User -> Resolved; requesters may move Waiting on User -> Open and -> Cancelled; agents cannot cancel from Waiting on User or Hold (Hold -> Cancelled exists only for a system PO rejection). Table says Open/Assigned/... -> Cancelled.
* **D012** — Guide: Section 9 scheduled job list. **Code:** install-cron-tasks.ps1 also registers CitykartDesk-Cron-Visits (job visit-automation, every 15 min) for the dropped engineer-visit module. cron-tick.mjs has no such job, so it would call /api/visit-automation/run (no such route) and log a failure every 15 minutes. Re-running the installer on the server would create it.
* **D013** — Guide: Sheet copies run at 11:00, 15:00, 19:00 (section 8.7, 9). **Code:** Times agree with schedule.ts and the installer, but the route comment in app/api/masters/sync/route.ts says 'Scheduled job (every minute)' and docs/SHEET-MASTERS-GUIDE.md still says three sheets (now four).
* **D014** — Guide: Section 8.8 / 12: the PO default approver is the single approver set in Admin > Vendors. **Code:** When no approver is set, code falls back to a hard-coded person's company e-mail address (DEFAULT_PO_APPROVER_EMAIL) found in auth users.
* **D015** — Guide: Appendix A, SLA escalation and alert rules 'at 15-minute checks'. **Code:** Scheduled Business Rules (SLA %, unassigned minutes) run every 15 min; alert rules (unassigned requests, task/milestone alerts) run in the alerts job every 30 min.
* **D016** — Guide: Appendix A, Daily alert digest: 'One summary mail every morning at 08:00'. **Code:** The digest is an in-app notification to the alert rule's roles (manager, admin by default); an e-mail goes out only when the rule has the email channel. The hour test uses server local time (getHours()===8), not explicit India time.
* **D017** — Guide: Section 11: 'Unit (about 1,560 tests)'. **Code:** A count of it/test declarations in tests/unit gives about 1,405 (before it.each expansion). Cannot confirm 1,560 without running.
* **D018** — Guide: Section 2.3: 184 numbered migrations (000 ... 184); rollbacks kept from 164. **Code:** There are 184 files because number 176 does not exist (175 -> 177); there is no 176 rollback.
* **D019** — Guide: docs/ARCHITECTURE.md vs the guide. **Code:** ARCHITECTURE.md states Next.js 16.2.9 (package.json: 16.3.8), e-mail via Resend (code: SMTP, Resend only as fallback), deployment 'local only' (CLAUDE.md: production on 10.0.1.98), 87 migrations (184), in-process rate limiting only, and has no vendor/PMS/sheet masters. The guide calls it partly outdated.
* **D020** — Guide: HANDOVER.md (old session note) vs the guide. **Code:** HANDOVER.md says Docker is not running, describes a single-admin model and QA leftovers, and treats SLA escalation as Business Rules; the guide section 5 still lists escalation_policies / sla_escalation_rules / sla_escalation_events as current tables. Code reads sla_escalation_rules only in the one-time conversion action.
* **D021** — Guide: Guide 8.9(4) and docs/AC-PMS.md: PMS tickets are not counted in the AC Ticket Calendar and AC complaint reports. **Code:** No PMS check exists in the calendar or report code. Exclusion happens only because those read categories with auto_oem_kind ac/genset and services with auto_oem_routing, so it holds only if the AC-PMS category/service lack those flags. Untested.
* **D022** — Guide: Guide 8.5e: last 5 decisions of the same store and sub-category in the last 12 months. **Code:** Rows also include approvals still waiting; the window is 12 x 31 days; at most 100 earlier approvals are read (totals could be understated for very large histories).
* **D023** — Guide: Section 10.1: job routes without x-cron-secret return 401. **Code:** They return 401 for a missing/wrong secret but 503 when CRON_SECRET is not configured on the server.
* **D024** — Guide: Guide and Appendix: vendor dashboard has 7 boxes. **Code:** Code and tests agree (7), but a code comment in lib/vendor/access.ts and the test title 'the six boxes' still say six.
* **D025** — Guide: Comment in lib/constants/request-transitions.ts points to tests/vapt/23-business-rule-limits.test.ts. **Code:** That file does not exist; the matching test is tests/vapt/23-permission-matrix-and-rules.test.ts.
* **D026** — Guide: Guide 8.11 / Appendix: a low CSAT rating alerts managers. **Code:** Ratings of 1-2 stars notify the technician who handled the ticket and the leads of its group (bell).
* **D027** — Guide: Guide 8.2: Qty appears for FIXTURES/HANGERS. **Code:** Depends on the form configuration; the automated test only proves Qty for the Fixture category and absence elsewhere.
* **D028** — Guide: CLAUDE.md and AGENTS.md vs the guide. **Code:** No contradiction found: guide section 0 (no push, no deploy, test locally) is consistent with CLAUDE.md; CLAUDE.md production topology is not repeated in the guide.

### Things the application does that the guide does not describe

* Kanban board view of requests and tasks (drag between statuses using AGENT_TRANSITIONS) (components/requests/RequestBoardView.tsx, components/tasks/TaskBoardView.tsx, app/(app)/requests/queue/page.tsx)
* Global search box in the top bar (components/layout/GlobalSearch.tsx, lib/actions/search.ts)
* Manual Send now for a scheduled report (lib/actions/admin/reports.ts, app/(app)/admin/reports/ScheduledReportsClient.tsx)
* Duplicate a ticket; edit category / sub-category and form answers after creation; change ticket source (lib/actions/requests.ts)
* Admin > Task Configuration (task statuses, priorities, templates) (app/(app)/admin/task-config/page.tsx, lib/actions/admin/config.ts)
* Admin > Audit Logs and Event Log screens; /api/admin/audit (app/(app)/admin/audit/page.tsx, app/(app)/admin/event-log/page.tsx, app/api/admin/audit/route.ts)
* Trial banner and Trial expired page (app/trial-expired/page.tsx, components/layout/TrialBanner.tsx, lib/queries/profiles.ts)
* WhatsApp intake, conversation engine, questionnaire (out of scope, code present) (lib/whatsapp, lib/conversations, lib/requests/questionnaire, app/api/intake/webhook/whatsapp/route.ts, lib/actions/intake/whatsapp-channel.ts)
* DeskTime sync and admin screen (out of scope, code present) (lib/desktime, app/(app)/admin/desktime/page.tsx, app/api/desktime/sync/route.ts)
* Mobile-number management for users (used by WhatsApp) (lib/actions/admin/users.ts, lib/users/mobile.ts)
* Server Room AC is excluded from counted ACs in the calendar and AC reports (lib/reporting/analytics/facts.ts, lib/queries/ac-calendar.ts)
* Home cards: store snapshot and technician workload (components/home/StoreSnapshotCard.tsx, components/home/TechnicianWorkloadCard.tsx, lib/queries/store-snapshot.ts)
* Theme switcher, mobile navigation, new-version banner (components/layout/ThemeSwitcher.tsx, components/layout/MobileNav.tsx, components/layout/NewVersionBanner.tsx)
* Public endpoints: CSP report, system-log ingest, public storage route (app/api/csp-report/route.ts, app/api/system-log/ingest/route.ts, app/api/storage/public/[bucket]/[...path]/route.ts)
* Preview configuration citykart-desk-qa (port 3310, same as demo) (.claude/launch.json, qa-release-candidate-2026-10/tooling/qa-start.cjs)
* Engineer-visit scheduled task still in the installer (module dropped) (scripts/windows/install-cron-tasks.ps1)
* Resend e-mail provider as third sending option (lib/email/config.ts, lib/email/send.ts)
* Intake pages: queue, inbox, channels, settings (app/(app)/intake/queue/page.tsx, app/(app)/intake/inbox/page.tsx, app/(app)/intake/channels/page.tsx, app/(app)/intake/settings/page.tsx)

### Added by the QA itself

* Vendor logins see their own phone menu (My tickets / My POs / Notifications).
* Round-robin takes its place with a compare-and-set (a burst of tickets is spread).
* The System Log integrity check walks the whole chain in pieces of 250,000 rows.
* Sign-in says "temporarily unavailable" when the sign-in service is down; an attachment answers 503 when file storage is down.
* Migration 185 (categories, form templates and technician groups: administrators and platform owners only).

