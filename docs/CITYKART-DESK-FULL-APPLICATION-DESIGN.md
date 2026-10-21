# Citykart Desk — Full Application Design (Build Blueprint)

**Version:** 2026-10-21 · **Owner:** Citykart · **Audience:** another AI session or engineering team that must build a new application from this design.

This document describes **what Citykart Desk is, how it is built, how every part behaves, and in what order to build it**. It is written so that a builder who has *only this file* can produce a faithful new application. It merges three sources of truth: the original technical specification (September 2026), everything built and deployed in October 2026 (security release, OEM/CVM, CSAT, dashboards, system log), and the five features that are built and tested but not yet released (Sheet Masters for AC / Genset / CVM, Engineer Visits, AC & Genset master screens, clean-up).

> **Safety rules for the building session (read first)**
> 1. Never ask for, accept, print or store passwords, tokens or keys. Secrets are set by a human on the server. This document contains **no** secrets and **no** personal data.
> 2. Do not connect to, deploy to, or read data from any existing Citykart production system. Build and test on a fresh, isolated environment only.
> 3. No e-mail may leave a development or test environment: use a mail sink (see §19.6).
> 4. Prefer plain, simple wording in every screen text, e-mail and message (the owner's standing instruction): short sentences, no jargon.

---

## Table of contents

0. How to read this document (status labels, vocabulary)
1. Product overview
2. Users, roles and access model
3. Architecture and technology
4. Cross-cutting conventions
5. Data model
6. Ticket lifecycle
7. SLA engine
8. Business Rules engine
9. Approvals (including the CVM)
10. Service catalog and dynamic forms
11. Master data: stores, AC / Genset / CVM sheets, OEM routing
12. Engineer visits (FSR)
13. Notifications, e-mail, web push
14. Intake channels (e-mail, WhatsApp)
15. Reporting, analytics and dashboards
16. Projects and tasks
17. Administration screens
18. Security design
19. Operations: environments, jobs, backups, release, observability
20. Testing strategy
21. UX and design system
22. Reference configuration (seed data)
23. Build plan for a new application
24. Open decisions and known gaps
25. Glossary

---

## 0. How to read this document

### 0.1 Status labels used throughout

| Label | Meaning |
|---|---|
| **[LIVE]** | In production use at Citykart as of 2026-10-19. Must be reproduced. |
| **[RELEASE-1] … [RELEASE-6]** | Built and tested, waiting for the owner's go-ahead. Part of the target design; build them (see §23). |
| **[SUPERSEDED]** | An older design that a newer one replaces. Described only so the builder understands history; do **not** build it. |
| **[PLAN]** | Agreed idea, not built. Build only if asked. |

The six releases: **1** = AC Google Sheet as master (+ reopen re-mail), **2** = Genset sheet, **3** = CVM sheet and automatic approval, **4** = Engineer visits (FSR), **5** = AC / Genset master screens, **6** = clean-up of the old OEM-bucket and CVM-tag screens.

### 0.2 Vocabulary (Citykart's own words)

| Term | Meaning |
|---|---|
| **Requester** (role `user`) | A person who raises a ticket: head-office staff or a **store** login (one login per store, e-mail `sm.<storecode>@…`). |
| **Technician** (role `agent`) | Works tickets of the technician group(s) they belong to. |
| **Technician group / Team** | A fulfilment team (Admin, IT, HR, VM, Finance, Legal, L&D, BD, LP, PO Apps, PO GM…). One group serves one or more services. |
| **Service** | A catalogue item a requester picks (for example "ADMIN - AC"). Has a form, an SLA policy and a team. |
| **Category / Sub category** | Two-level topic list chosen on the form (for example category "ADMIN AC ISSUE" → sub category "COOLING ISSUE"). |
| **Store** | A physical shop, identified by a short code (for example `COB`). Has an address and AC / genset data. |
| **OEM** | The equipment maker's service desk (for example Bluestar for AC, Cummins for genset). Receives tickets by e-mail. |
| **CVM** | The person who approves for a store (Citykart's own word). One CVM can serve many stores; a store has one CVM. |
| **FSR** | Field Service Report: the signed paper/photo the OEM engineer leaves after a visit. |
| **AC number / CKDESK number** | Citykart's own running number of an air conditioner inside a store (1, 2, 3 …). |
| **Hold (HO purchase)** | Status `hold_purchase_ho`: the ticket waits for a purchase approved by head office. |
| **NSO** | New store opening (a store without an opening date, or opened less than 9 months ago). |

---

## 1. Product overview

### 1.1 What it is

Citykart Desk is the internal **service desk (ITSM)** of Citykart, a retail chain with about **230 stores** and about **550 staff logins**. Staff and store managers raise tickets against a **service catalogue**; technician groups fulfil them; managers watch performance. It replaces a hosted helpdesk product.

It is **single-tenant in practice** (one organisation, "CityKart") but built on a **multi-tenant-capable** schema: every business table carries `org_id`, row-level security isolates organisations, and no code assumes there is only one. Keep that.

### 1.2 Capabilities (all [LIVE] unless labelled)

1. **Ticketing** with a configurable service catalogue, dynamic forms, categories, attachments, conversations (public and internal), collaborators, time tracking.
2. **SLA management** that is business-hours aware, with response and resolution targets per priority, pause/resume, escalation and breach reporting.
3. **Approvals**: single or multi-step, sequential or parallel, approve/reject by e-mail link, delegation, reminders. **Automatic approval by the store's CVM** for configured categories.
4. **Business Rules**: no-code automation (assign, set priority/status/team, notify) on create/update/schedule.
5. **OEM routing**: a ticket for AC or genset equipment is e-mailed automatically to the equipment maker, using addresses kept in Google Sheets **[RELEASE-1/2]** (before that: OEM records per store **[LIVE, SUPERSEDED]**).
6. **Customer satisfaction (CSAT)**: after resolution, a "how did we do?" e-mail with one-click star links and a reopen link; a reminder; low-rating alert.
7. **Reply-by-e-mail**: replies to ticket e-mails are read from a mailbox and posted into the ticket (thread tags, sender checks).
8. **Intake**: tickets from inbound e-mail (reviewed by a human) and from WhatsApp conversations (coded, not connected).
9. **Reporting**: pivot/table **Report Builder**, a set of **fixed Report Analytics** reports (red-flag stores, AC reports, NSO, AMC vendor, weekly/monthly…), an **Executive Dashboard** per role level, a Home dashboard, Excel export, saved and scheduled reports.
10. **Projects and Tasks**: lighter work tracking, milestones, custom task fields.
11. **Engineer visits (FSR)** **[RELEASE-4]**: a public page where the OEM engineer reports a visit per air conditioner; the store confirms; automatic resolution rules.
12. **Administration**: organisation structure, users, teams, roles, services, forms, SLA, rules, e-mail settings, retention, audit, system log, monitoring.
13. **Security & audit**: per-purpose secrets, server-only writes, row-level security, hash-chained system log, rate limits, forced password change, no public sign-up.

### 1.3 Design principles

- **The database enforces what matters.** Rules that protect data (allowed status moves, who may write which table, organisation isolation) are enforced in PostgreSQL as well as in the app.
- **One implementation per rule.** SLA breach, status transitions, validation, labels each live in one module imported by server and client.
- **Server-only writes for sensitive tables.** The browser client never writes audit, notification, approval-state, master-data or secret tables.
- **Fail loudly, never silently.** A broken sync, a failed e-mail or an unreadable sheet is reported (health page, operator alert), not swallowed.
- **Simple language.** Every message a human reads is short and plain.
- **Releasable in small pieces.** Each feature has its own database step, its own switch, its own rollback.

### 1.4 Scale to design for

About 550 users, 230 stores, 14 services, ~610 tagged sub-categories, 11 technician groups, several thousand tickets per year growing; designed and load-tested to **500,000 tickets** (ticket numbers must not overflow at 999,999). Report fetches cap at 20,000 rows with an explicit "truncated" flag.

---

## 2. Users, roles and access model

### 2.1 Roles (enum `user_role`)

| Role | Who | Can do |
|---|---|---|
| `user` (Requester) | Staff, **store logins** | Raise tickets from the catalogue, follow own tickets, comment, reopen within the window, rate, see own dashboard. A store login is tied to a store (`profiles.store_id`). |
| `agent` (Technician) | Fulfilment staff | Work tickets of own group(s): assign, comment (public/internal), change status, resolve, time tracking, send for approval, see group reports. |
| `manager` | Team managers | All technician rights across own groups, approve, analytics, limited admin screens (e.g. AC master download). |
| `admin` | Administrators | Configure everything below the platform level. |
| `platform_owner` | Super-administrators | Everything, including owner-only functions and cross-organisation views. |

Roles are a **fixed enum** (the "Permission Matrix" screen is documentation only; an earlier editable version had no effect and was disabled).

### 2.2 Access rules in one table

| Area | Requester | Technician | Manager | Admin / Owner |
|---|---|---|---|---|
| Own tickets | read / comment / reopen / cancel (open) | — | — | — |
| Group tickets | — | read / work | read / work | all |
| Create ticket for someone else ("book on behalf") | — | yes | yes | yes |
| Approvals | respond if named | respond if named; send for approval | respond; send | respond; manage workflows |
| Report Builder (requests) | own rows | rows where assignee or requester | rows of own teams | all rows |
| Report Builder (other entities), fixed Analytics | — | analytics for own groups | own groups | all |
| Executive Dashboard | "My requests" | own groups (+ "only mine") | own groups | all groups |
| Admin screens | — | — | some (users view, org, reports…) | all (stricter set: admin/owner only) |
| System Log / Logs | — | — | audit tab only | all tabs |
| Engineer visit code (view) | own store only | any store | any store | any store |
| AC / Genset master screens + CSV | — | — | yes | yes |

### 2.3 Authentication

- Sign-in with **e-mail + password** only (Supabase GoTrue). **No public sign-up**; admins create users (invite) or bulk-import them.
- A new or admin-reset account has `must_reset_password = true`: until the person sets their own password the database treats them as having **no organisation and no role** (so row security blocks everything), and the app redirects to the reset page.
- Password reset by e-mail link. Rate limits on sign-in and reset (see §4.9).
- Session is cookie-based; the edge `proxy.ts` verifies the session once per request and forwards a server-verified user-id header (always **overwritten**, never merged, so a forged client header is useless).
- **Public (no session) routes**, and only these: `/login`, `/forgot-password`, `/reset-password`, `/approve/[token]` (approve/reject by e-mail link with a one-time code), `/csat/[token]` (rating / reopen link), `/engineer` + two API routes (engineer page, **[RELEASE-4]**), webhooks (`/api/intake/webhook/*`), cron endpoints (shared-secret protected), `/api/health`, `/api/version`. Everything else redirects to `/login`.

### 2.4 Multi-organisation capability

`organizations` (with `is_owner` flag for the platform operator's own org), `org_module_access` (module flags per org: requests, tasks, approvals, services, time_tracking, analytics, integrations, intake, projects), `license_keys`. Hidden navigation is **not** a security control: every server action re-checks the module flag (`requireModuleEnabled`).

---

## 3. Architecture and technology

### 3.1 Technology stack

| Layer | Choice |
|---|---|
| Web framework | **Next.js 16** (App Router, React Server Components, Server Actions), **React 19**, **TypeScript 5.9** |
| **Next.js 16 differences (must read)** | `proxy.ts` (root) replaces `middleware.ts` (a `middleware.ts` file crashes the server); ESLint no longer runs inside `next build` (run it separately); build with `node node_modules/next/dist/bin/next build`; output `standalone`; **Turbopack refuses a `node_modules` symlink pointing outside the project, so use `--webpack` for such a build**; read `node_modules/next/dist/docs/` before writing Next.js code. |
| Styling | Tailwind CSS 4 (`@tailwindcss/postcss`), shadcn/ui (`base-nova`), `@base-ui/react`, `lucide-react`, `tw-animate-css`, `sonner` toasts, `clsx` + `tailwind-merge` |
| Forms | `react-hook-form`, `zod`, `@hookform/resolvers`; rich e-mail editor `@tiptap/*` |
| Data / auth / storage | **Supabase**: PostgreSQL (17 locally, 18 in production), PostgREST, GoTrue (auth), Storage, Vault (secrets), `@supabase/supabase-js`, `@supabase/ssr` |
| Reports | `exceljs` (xlsx), `pdfkit` (ticket PDF), `@dnd-kit/*` (drag-and-drop report builder) |
| E-mail | `nodemailer` (SMTP send), `imapflow` + `mailparser` (reply sync), `sanitize-html` |
| Push | `web-push` (VAPID) |
| Tests | `vitest`, Testing Library, `jsdom` |

The app talks to the database **only through HTTP** (supabase-js → PostgREST); it never opens a direct Postgres connection.

### 3.2 Logical architecture

```
Browser (staff, store logins)              Anyone with a link (no login)
   │  HTTPS/HTTP                              │  /approve/<token>  /csat/<token>  /engineer
   ▼                                          ▼
┌───────────────────── Next.js app (standalone server) ─────────────────────┐
│ proxy.ts (edge): session check, public-route allow-list, security headers │
│ Server Components + Server Actions + Route Handlers (/api/*)              │
│   lib/actions/*  (mutations)   lib/queries/* (reads)   lib/requests/*     │
│   lib/sla  lib/rules  lib/notifications  lib/email  lib/masters  lib/visits│
└───────┬──────────────────────────────┬─────────────────────────────┬─────┘
        │ RLS client (user cookie)     │ service-role client          │ cron calls
        ▼                              ▼                              ▼
   PostgREST ──────────────► PostgreSQL (RLS, triggers, RPC, Vault) ◄── scheduler
   GoTrue (auth)                       │
   Storage ─────────────────────────────┴──► file store (attachments)
External: SMTP/IMAP mailbox · Google Sheets API (read-only) · Web Push · (WhatsApp/Graph/Gmail: coded, not connected)
```

Two Supabase clients, chosen per call: `createClient()` (cookie-bound, **RLS enforced**) and `createAdminClient()` (service role, **bypasses RLS**; server only; used for audit trails, notifications, approval transitions, master-data sync, cron, intake). Admin-client writes that store a foreign key must prove the referenced row belongs to the caller's organisation (`assertRefsInOrg`).

### 3.3 Production topology [LIVE] (reference only — do not reuse these systems)

| Component | What it is |
|---|---|
| **App server** (Windows Server) | Runs the Next.js standalone build (`CkDeskApp`), a small Node reverse proxy (`CkDeskProxy`, the "Supabase URL"), GoTrue (`CkDeskAuth`), PostgREST (`CkDeskPostgrest`) and Supabase Storage (`CkDeskStorage`), each as a Windows service (NSSM, auto-start). Scheduled tasks call the cron endpoints on localhost. |
| **Database server** | PostgreSQL 18, database `ckdesk`, application role (not superuser) plus `anon`, `authenticated`, `service_role`; nightly backup. Shared machine with other apps' databases: touch only `ckdesk`. |
| **NAS** | Attachment files (Storage "file" backend over an SMB share). |
| **Dev PC** | All development and testing; build and deploy from here. |
| Public access | One public address mapped by the router to the app server's single open port (plain HTTP today; HTTPS is parked). |

A new deployment may choose different hosting (containers, managed Supabase). The **contract** to keep: app → HTTP → proxy → {auth, REST, storage} → PostgreSQL; files outside the database; scheduler calling cron endpoints with a shared secret.

### 3.4 Repository structure (target)

```
app/
  (auth)/            login, forgot-password, reset-password
  (app)/             authenticated product: home, requests, requests/queue, services, approvals,
                     notifications, profile, tasks, projects, intake/*, reports/analytics, reports/pivot,
                     dashboards/executive, ac-visits [R4], visits [R4],
                     admin/* (users, teams, roles, org, master-data, categories, services, form-templates,
                              field-library, sla-policies, business-rules, request-config, approvals,
                              settings, masters [R1], masters/[kind] [R5], audit, logs, monitoring, runbooks,
                              knowledge-base, task-config, desktime(disconnected))
  approve/[token]    csat/[token]    engineer [R4]    trial-expired
  api/               health, version, cron endpoints (alerts, business-rules, csat, approvals/reminders,
                     email/inbound-sync, masters/sync [R1], visits/run [R4], system-log/archive,
                     intake/cron/classify), intake webhooks + oauth, masters/oauth + export [R1/R5],
                     engineer lookup/submit [R4], storage attachment download
components/          admin/, forms/, requests/, home/, layout/, reports/, analytics/, intake/, ui/ (shadcn)
lib/                 actions/ (use server), queries/, requests/, sla/, rules/, forms/, validation/, constants/,
                     email/, notifications.ts, push/, reporting/, csat/, approvals/, cvm/, masters/ [R1-3],
                     visits/ [R4], observability/, supabase/ (server, client, admin), secrets.ts, rate-limit.ts, cron-auth.ts
supabase/            migrations/ (sequential SQL), rollback/ (one per release migration), config.toml, seed.sql
scripts/             cron-tick.mjs, windows/ (build, deploy, install scheduled tasks)
tests/               unit/, integration/, vapt/ (isolated stack), setup/
types/               database.ts (generated), index.ts (domain types)
proxy.ts  next.config.ts  Dockerfile (optional)
```

The separate `api/` Express worker of the original design (IMAP/Gmail/Graph polling and LLM classification for e-mail intake) is optional; the **reply-by-e-mail** sync that matters today runs inside the main app as a cron endpoint.

---

## 4. Cross-cutting conventions

1. **Server Actions** live in `lib/actions/**` (`'use server'`; only async exports — helpers go in plain modules). Every action first checks the caller (`getCurrentProfile()`), role, module flag, and organisation scope. Admin actions define a local `requireAdmin…` guard.
2. **Time**: stored UTC (`timestamptz`); shown in **IST, 24-hour clock, no AM/PM**, through one helper (`formatDateTime`). Business-hours and cron gates use `TZ=Asia/Kolkata`. E-mails show an explicit date and time.
3. **Settings cache**: runtime settings read from `app_settings` use a 60-second in-memory cache that **caches success only** (a failure falls back to the default and is not cached).
4. **Error handling**: never return a raw database message to the user. `sanitizeError()` maps SQLSTATE codes (unique, FK, not-null, check, invalid input, privilege, serialisation, lock) to short plain messages. Operator alerts (`alertOperator`, webhook, de-duplicated) for batch-level failures such as every e-mail of a batch failing.
5. **Structured logging** (`logger`) with automatic secret redaction; the System Log (§19.5) is the durable record.
6. **Org-scope guard**: `assertRefsInOrg(admin, orgId, refs[])` before any admin-client write of a foreign key.
7. **Race guards**: status updates use `.eq('status', currentStatus)`; claim-style updates (approvals, review conversion, reply posting) are conditional so a double click or two workers cannot both win.
8. **Idempotency**: inbound e-mail reply posting de-duplicates by Message-ID; business-rule firing by `(rule, request)`; engineer reports replace unanswered ones; sheet sync is hash-skipped and idempotent.
9. **Rate limits** (`rateLimit(key, limit, windowMs)`, per process): sign-in `ip+email`, forgot-password `ip`, admin invite / password reset per admin, WhatsApp per sender, engineer page lookups (five wrong visit codes lock the store for a while).
10. **Per-purpose secrets** (`getSecret(purpose)`): `approval_link`, `csat_link`, `oauth_state`, `intake_webhook`, `intake_worker`, `system_log_ingest`, `visit_code` [R4], `cron`. Each has its own environment variable, a missing one **switches the feature off** (never falls back to another secret). A single transitional switch `ALLOW_SHARED_SECRET_FALLBACK=1` exists for migrations only and is reported by `auditSecrets()`. Minimum length 16; two purposes must not share a value.
11. **Attachments**: allow-list of MIME types (no SVG), 25 MB maximum, **magic-byte validation** per type, private buckets, downloads through an authenticated route or short signed URLs with forced `Content-Disposition: attachment`.
12. **Comments** explain *why*, placed above the non-obvious line; section banners `// ── Label ──`.
13. **Simple-language copy**: error and help texts are written for non-technical staff.
14. **Versioning**: every build has a build id (`/api/version`); open pages show a "new version available — refresh" bar.
15. **Health**: `/api/health` returns `{status, db}`; used by deploy checks and monitoring.

### 4.1 Environment variables (names only)

| Group | Variables |
|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` |
| App | `NEXT_PUBLIC_APP_URL` (also used in e-mail links), `TZ`, `PORT` |
| Secrets (one each) | `CRON_SECRET`, `APPROVAL_LINK_SECRET`, `CSAT_LINK_SECRET`, `OAUTH_STATE_SECRET`, `INTAKE_WEBHOOK_TOKEN`, `INTAKE_WORKER_SECRET`, `SYSTEM_LOG_INGEST_SECRET`, `VISIT_CODE_SECRET` [R4], optional `ALLOW_SHARED_SECRET_FALLBACK` |
| Scheduler | `CRON_TARGET_URL`, `CRON_JOBS` |
| Mail | mailbox (SMTP + IMAP) is saved in the **admin screen** and stored encrypted in Vault; optional env fallbacks `SMTP_*`, `EMAIL_FROM`; `RESEND_API_KEY` only if Resend is chosen |
| Google | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE_URL` (empty counts as not set) |
| Intake / push / alerts | `INTAKE_LLM_*`, `GOOGLE_PUBSUB_TOPIC`, `MS_OAUTH_*`, `META_GRAPH_API_VERSION`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `OPERATOR_ALERT_WEBHOOK_URL` |
| Local-only switches | `MAIL_SINK_DIR` (mail saved to files, not sent), `MASTERS_DEMO_DIR` (sheets read from CSV files); **both are ignored when `NODE_ENV=production`** |

`NEXT_PUBLIC_*` values are inlined at build time: changing an address means a rebuild.

---

## 5. Data model

PostgreSQL, schema `public` (plus `auth`, `storage`, `vault` from Supabase). About **110 tables** in production. Every business table has `id uuid` (default `gen_random_uuid()`), `org_id uuid` (FK `organizations`), `created_at`/`updated_at timestamptz`. Row-level security (RLS) is **on for every table**.

### 5.1 Multi-tenancy, RLS and privileges

**Helper functions** (all `STABLE SECURITY DEFINER`, `search_path = public`), used by policies:

| Function | Meaning |
|---|---|
| `current_org_id()`, `current_user_role()`, `current_user_team_ids()` | caller identity. **A person with `must_reset_password = true` resolves to no org / no role** (so they can do nothing until they set a password). |
| `is_team_member(team)`, `is_agent()`, `is_owner_org()` | team / staff predicates; `is_agent()` also requires the caller's org to match. |
| `is_request_approver(req)`, `is_request_collaborator(req)`, `can_manage_collaborators(req)`, `can_view_project(p)` | per-record predicates |
| `has_module_access(m)`, `get_enabled_modules()` | module flags |
| `generate_request_no()` | next ticket number (see 5.4) |
| `get_home_dashboard(...)` | one payload for the Home screen (counts and lists for my open / my queue / my requests, including status `hold_purchase_ho`) |
| `merge_request_form_data(req, patch)` | atomic partial JSONB merge (closes a concurrent-edit race) |
| `commit_conversation_transition(...)` | optimistic-concurrency state change for WhatsApp conversations |
| `upsert_field_sla_override(...)`, `retag_service_categories(...)`, `retag_service_locations(...)` | atomic admin operations |
| `intake_store_credential / read`, `email_smtp_store_password / read`, `masters_store_credential / read` [R1], `org_store_desktime_key / read` | Vault-backed secret storage (service role only) |
| `purge_app_event_log(days)`, `replace_user_email(...)`, `owner_delete_org(org)` | maintenance |

**Policy shape**: `<table>_select` (org-scoped read, role/membership narrowed) and `<table>_admin` (org-scoped write for `admin`,`manager`,`platform_owner` where the table is admin-managed). Row-security rules for tickets call helper functions through `(select …)` sub-selects so they are evaluated once per query, not once per row (performance finding, measured at 500,000 tickets).

**Server-only tables** (no right at all for `anon`/`authenticated`; only `service_role`): `notifications` writes, `request_activity`, `task_activity`, `approval_email_codes`, `app_event_log`, `system_log*`, `email_smtp_settings`, `intake_*` secrets, `master_*` [R1-3], `request_master_snapshots`, `ac_visit_*` [R4]. Migration pattern: `ENABLE ROW LEVEL SECURITY; REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT ALL … TO service_role;`. Ordinary users **cannot** insert activity rows, edit attachment rows directly, or touch another organisation's comments.

**Status transitions in the database**: a trigger (`request_status_transitions`) checks every status change made *as a signed-in user* against the same matrix the app uses; service-role writes (auto-close, approvals, rules, cron) are exempt.

**Table-rights convergence**: after any restore, verify that `authenticated` holds only the intended rights (a past drift gave it full rights on 26 tables).

### 5.2 Table catalogue by domain

*(Key columns only; every table also has the standard columns above. "→" means foreign key.)*

#### Identity and organisation
- **organizations**: `name`, `slug` (unique), `status` (`trial|active|suspended|cancelled`), `is_owner`, `seat_limit`, `trial_ends_at`, `desktime_*` (disconnected).
- **profiles** (1:1 with `auth.users`): `full_name`, `role` (`user_role`), `is_active`, `must_reset_password`, `employee_id`, `job_title`, `mobile_number`, `whatsapp_enabled`, `avatar_url`; → `department_id`, `location_id`, `cost_center_id`, `function_id`, `designation_id`, `manager_id` (self), **`store_id`** (→ stores; set for store logins).
- **profile_mobile_numbers**: several 10-digit numbers per person (WhatsApp identity), many-to-one.
- **teams** (`name`, `prefix`, `slug`, `notification_email`, → department), **team_members** (`team_id`, `user_id`, `is_lead`).
- **departments** (hierarchy `parent_id`, `head_user_id`), **locations** (`city`, `country`, `timezone`; the two live locations are "HEAD OFFICE" and "STORES"), **cost_centers**, **job_functions**, **designations**.
- **custom_roles**, **permission_overrides** (reference only; not enforced).
- **org_module_access**, **license_keys**, **org_signup_requests**, **ai_applications** (platform layer).

#### Stores and master data
- **stores**: `code` (unique per org, upper-case), `name`, `address`, `city`, `state`, `pincode`, `is_active`; **store master fields** `cluster`, `region`, `priority_list`, `open_date`, `festival`; **AC fields** `ac_total`, `ac_brand`, `ac_amc_brand`, `ac_amc_vendor`, `zenatix` (boolean); legacy mapping columns `oem_id` (AC OEM), `genset_oem_id`, `cvm_id` **[SUPERSEDED by the sheets, kept until Release 6]**.
- **oems** **[SUPERSEDED]**: `name`, `emails text[]`, `kind` (`ac|genset`), `email_subject_template`, `email_body_template`, `is_active`. Database rules: a store's AC slot can hold only an `ac` OEM, the genset slot only a `genset` OEM, same organisation; an OEM with mapped stores cannot change type.
- **master_sources** [R1]: `(org_id, kind ac|genset|cvm)` PK; `spreadsheet_id`, `tab_name`, `last_checked_at`, `last_applied_at`, `last_status ok|error`, `last_error`, `row_count`, `content_hash`.
- **master_google_connection** [R1]: one row per org; `account_email`, `secret_ref` (Vault id of the refresh token), `status connected|broken`, `last_error`, `connected_by`.
- **master_ac_units** [R1]: per AC unit — `store_code`, `ckdesk_no`, `serial`, `floor`, `ac_type`, `tonnage`, `brand`, `amc_vendor`, `amc_brand`, `zenatix`, `store_priority`, `festival`, `region`, `cluster`, `opening_date`, `city`, `state`, `address`, `pincode`, `is_active`, `emails text[]`, `sheet_row`, `previous_serials text[]`, `first_seen_at`, `last_seen_at`, `missing_since`, `removed_at`.
- **master_gensets** [R2]: `store_code`, `brand`, `kva`, `serial`, `cpcb_group`, `emails text[]`, `sheet_row`, `previous_serials`, `first/last_seen_at`, `missing_since`, `removed_at`.
- **master_store_cvm** [R3]: `store_code`, `cvm_email`, `sheet_row`, seen/missing/removed stamps; unique `(org_id, store_code)`.
- **master_issues** [R1]: problems found in the sheets (`kind`, `severity error|warning`, `code`, `store_code`, `sheet_row`, `message`), replaced as a whole at each applied sync.
- **master_mail_templates** [R1]: `(org_id, kind ac|genset|revisit)` PK; `subject`, `body_html`, `updated_by`.
- **request_master_snapshots** [R1]: per ticket and kind — `unit_ids`, `snapshot jsonb` (the unit as it was when the ticket was raised), `mailed_to`, `mailed_cc`; keeps old tickets readable whatever happens to the sheet later.

#### Tickets
- **requests**: `request_no` (e.g. `CKSD-000385`), `title`, `description`, `status` (see 6.1), `priority`, `pre_approval_status`, `form_data jsonb`, `form_schema_snapshot`, `form_sections_snapshot jsonb` (frozen form at creation), `source_metadata jsonb`, `source` (web | email_intake | whatsapp | api), SLA stamps (`response_due_at`, `resolution_due_at`, `responded_at`, `resolved_at`, `closed_at`, `waiting_since`, `paused_ms_total`), reopen (`reopen_count`, `reopen_deadline_at`), `cancellation_reason`; → `service_id`, `category_id`, `sub_category_id`, `team_id`, `requester_id`, `assigned_to`, `parent_request_id`, `project_id`, `intake_message_id` (unique: one e-mail → at most one ticket), `org_id`.
- **request_comments** (`body`, `is_internal`, `author_id`), **request_activity** (immutable audit: `action` enum, `metadata jsonb`; server-only write), **request_attachments** (`storage_path` unique, `file_name`, `mime`, `size`, `is_internal`, `comment_id`, soft delete `deleted_at`; rows cannot be edited/deleted by users directly), **request_collaborators**, **request_time_entries**, **related_requests**, **request_priorities** (global display metadata), **request_sequences** (per prefix counter), **csat_surveys** (`rating 1-5`, `comment`, `sent_at`, `submitted_at`, `reminder_sent_at`), **notification_rules** / **notification_preferences**, **processed_inbound_emails** (Message-ID de-duplication for reply sync).

#### Service catalogue
- **service_categories**: `name`, `slug`, `description`, `icon`/`icon_image_url`, `sort_order`, `is_active`, **`auto_oem_kind`** (`null|ac|genset`: mail tickets of this category to that OEM), **`auto_cvm_approval`** (boolean: send to the store's CVM for approval automatically).
- **service_sub_categories** (`category_id`, `name`, `slug`, `sla_priority`), **service_sub_category_tags** (`service_id`, `sub_category_id`, **unique on `sub_category_id`** — one sub-category belongs to exactly one service), **service_location_tags**.
- **services**: `name`, `slug`, `description`, `form_fields` (legacy), `form_sections jsonb`, `template_id` → form_templates, `team_id`, `sla_policy_id`, `approval_workflow_id`, `default_priority`, **`auto_oem_routing`** (the AC service flag), `status` (`draft|review|published|retired`), `is_active`, `keywords[]`, `owner_id`, `backup_owner_id`, `visibility*` (reserved).
- **form_templates** (`name`, `form_sections jsonb`), **form_field_library** (reusable field definitions, unique label per org), **kb_articles**, **kb_article_services**.

#### SLA, rules, approvals
- **sla_policies** (`config` = per-priority `{response_hours, resolution_hours}`), **field_sla_overrides** (`service_id`, `field_id`, `option_value`, `sla_config`), **global_sla_config**, **business_hours**, **holidays** (global), **sla_escalation_rules**, **sla_escalation_events**, **escalation_policies**, **alert_rules**.
- **business_rules** (`trigger text[]`, `conditions jsonb`, `conditions_logic`, `actions jsonb`, `schedule_check`, `schedule_threshold`, `execution_order`, `last_assigned_index`), **business_rule_events** (idempotency), **assignment_rules** (legacy).
- **approval_workflows** (+ **approval_workflow_steps**: `step_order`, `approver_type specific_user|any_manager`, `approver_user_id`), **approvals** (`request_id`, `workflow_id`, `status pending|approved|rejected|cancelled`, `current_step`, `requested_by`), **approval_decisions** (`step_order`, `decision`, `comment`, `decided_by`), **approval_email_codes** (random one-time 6-digit code stored only as a keyed hash with expiry and attempt counter; server-only).

#### Tasks and projects
**projects**, **milestones**, **project_members**, **project_updates**, **project_activity**, **tasks** (`parent_task_id`, `request_id`), **task_assignees**, **task_comments**, **task_attachments**, **task_activity**, **task_dependencies**, **task_custom_fields** / **task_custom_field_values**, **task_templates** / **task_template_items**, **task_priorities**, **task_statuses**.

#### Intake and conversations
**intake_channels**, **intake_messages**, **intake_threads**, **intake_attachments**, **intake_classifications**, **intake_reviews**, **intake_rules**, **intake_outbound**, **intake_notes**, **intake_pipeline_config**, **intake_audit_log**, **request_conversations**, **conversation_attachments**, **conversation_events** (see §14).

#### Engineer visits [R4]
- **ac_visit_settings** (per org): `auto_resolve_hours` (default 48, 1–720), `reminder_hours` (default 24, 1–720).
- **ac_visit_reports**: one per engineer submission — `store_code`, `engineer_name`, `engineer_mobile`, `visit_date`, `submitted_at`, `source_ip_hash`, `is_void`, `void_reason`.
- **ac_visit_items**: one per air conditioner in a report — `ac_unit_id`, `ckdesk_no`, `ac_details`, `request_ids uuid[]` (all tickets of that AC), `engineer_status resolved|not_resolved`, `reason`, `parts jsonb`, `engineer_remarks`, `fsr jsonb` (attachment ids), `store_status`, `store_remarks`, `store_decided_by/at`, **`outcome`** (`pending_store|resolved_both|resolved_by_store|resolved_auto|disputed|open|void`), `auto_resolve_at`, `reminder_sent_at`, `oem_notified_at`, purchase-order fields (`po_status`, `po_number`, `po_date`, `po_vendor`, `oem_parts_note`).

#### Notifications, push, platform
**notifications** (`type notification_type`, `title`, `body`, `link`, `metadata`, `read_at`, `archived_at`; server-written), **push_subscriptions**, **email_smtp_settings** (singleton; password in Vault), **app_settings** (key/value, global), **retention_policies**, **scheduled_reports**, **saved_reports** (`name`, `entity`, `config jsonb`), **error_reports**, **app_event_log** (client events), **system_log** + **system_log_archive** + **system_log_chain_head** (see §19.5), **admin_audit_log**, **owner_audit_log**, **desktime_*** (4 tables; integration disconnected).

### 5.3 Enums

`request_status`: `pending_approval, open, assigned, in_progress, waiting_user, hold_purchase_ho, resolved, closed, cancelled` — `request_priority`: `low, medium, high, urgent` — `user_role`: `user, manager, admin, agent, platform_owner` — `approval_status`: `pending, approved, rejected, cancelled` — `activity_action`: created, assigned, unassigned, status_changed, priority_changed, resolved, closed, reopened, cancelled, approval_requested, approved, rejected, comment_added, attachment_added, collaborator_added, collaborator_removed, reclassified, form_data_updated — `notification_type` (31 values: assigned, comment, approval requested/decided/approved/rejected, resolved, closed, reopened, created, internal note, reassigned, collaborator added/removed, auto-closed, cancelled, priority changed, status changed, sla warning/breached, mentioned, unassigned, task completed, milestone/task due-soon/overdue, daily digest, business-rule notification, **csat_low_rating**) — `module_slug`: requests, tasks, approvals, services, time_tracking, analytics, integrations, intake, projects — intake and conversation enums as in §14 — `task_*`, `project_*`, `report_*` enums.

Rule for new enum values: add each in **its own migration** (a new value cannot be used in the same transaction that adds it).

### 5.4 Ticket numbering

`generate_request_no()` returns `PREFIX-NNNNNN` from `request_sequences`; the current series prefix is **`CKSD-`** (six digits, **no truncation** — a past `LPAD` bug cut numbers after 999,999; use a pad that never truncates).

### 5.5 Storage buckets (all private except icons)

`request-attachments` (25 MB), `task-attachments` (25 MB), `intake-attachments` (25 MB), `icons` (public, 5 MB). Path for ticket files: `<request_id>/<timestamp>_<random>_<safe-name>`; served only through an authenticated route that checks the caller may see the ticket.

### 5.6 Key JSON shapes

- **FormField**: `{ id, type, label, placeholder?, help_text?, required, order, options?: [{value,label,children?,is_active?}], validation?: {min?,max?,min_length?,max_length?}, requester_can_view?, requester_can_set?, semantic_role?: 'request_title'|'request_description', show_for_categories?: string[], options_source?: 'ac_units' [R1] }`. Types: `text, textarea, number, date, select, multiselect, checkbox, radio, email, phone (10 digits), file, toggle, store_address`.
- **FormSection**: `{ id, title, description?, order, collapsed_by_default?, fields[] }`.
- **SLAConfig**: `{ low|medium|high|urgent: { response_hours, resolution_hours } }`.
- **RuleCondition / RuleAction**: §8.
- **ActivityMetadata**: `{from,to}` | `{assigned_to,…}` | `{remark}` | `{via:'business_rule'}` | `{automated:true, oem}` …

---

## 6. Ticket lifecycle

### 6.1 Statuses and groups

`open → assigned → in_progress → (waiting_user | hold_purchase_ho | pending_approval) → resolved → closed`, plus `cancelled`. Display groups: *Open / In process / Pending / Resolved / Closed*. Labels live in one constants module (`STATUS_LABELS`, `STATUS_STYLES`); badge colours: waiting_user orange, **hold_purchase_ho amber** ("Hold due to Purchase from HO"). `TERMINAL = closed, cancelled`.

**Hold due to Purchase from HO** [LIVE]: set only by a technician (mandatory remark that posts to the conversation), SLA clock paused exactly like `waiting_user`, **a requester reply does *not* move it back** (unlike `waiting_user`), only a technician can return it to `in_progress` (second mandatory remark). It appears everywhere `waiting_user` does (queues, home dashboard, analytics, exports, "open" report statuses). It is *not* shown as a column on the Kanban board. [RELEASE-4] sets it automatically for tickets that need a purchase order.

### 6.2 Allowed transitions (single source: `lib/constants/request-transitions.ts`, mirrored in the database trigger)

| From | Technician may go to | Requester may go to |
|---|---|---|
| open | cancelled (assigning auto-promotes to `assigned`) | cancelled |
| assigned | cancelled | — |
| in_progress | waiting_user, **hold_purchase_ho**, resolved, cancelled | — |
| waiting_user | in_progress, resolved | open, cancelled |
| hold_purchase_ho | in_progress | — (none) |
| pending_approval | — (system) | — |
| resolved | open (reopen, with comment) | open (reopen, with comment, **inside the reopen window**) |
| closed / cancelled | — | — (exception: approval-rejection reopen, §9.6) |

- `open|assigned → in_progress` is **not in the table on purpose**: it happens only through the **Start Working** button/modal, which forces the mandatory first-response message.
- Server-side automatic steps (rules, cron, approvals, e-mail replies) may use `SERVER_ALLOWED_TRANSITIONS`, the same list the database function `request_status_transition_allowed()` holds (adds `resolved → closed`, `waiting_user → open`, etc.). A rule cannot revive a cancelled ticket or close one that was never resolved.

### 6.3 Creating a ticket (`createRequest` → `createRequestCore`, shared by web, e-mail intake, WhatsApp)

1. Find the service (`id + org + is_active`); a requester only sees services visible to them (published + location tags).
2. Category/sub-category: only `sub_category_id` is accepted; the category is derived server-side and must be tagged to the service.
3. Resolve the form (template wins over the service's own form), drop answers of fields whose `show_for_categories` does not include the chosen category, drop fields a requester may not set.
4. Fill the requester's **store address** field from `stores.address` of the *requester* (not the acting user). For a field whose options come from the AC sheet, the chosen AC **must be an Active AC of the requester's own store** (checked on the server for the web channel) **[R1]**.
5. Mandatory-field gate (`validateRequesterFormCompletion`), identical to the browser's validation.
6. Title: trusted override ≤120 chars, else first text field / sub-category / service name. Priority: `priorityOverride ?? sub_category.sla_priority ?? service.default_priority`. SLA deadlines from `resolveSlaDeadlines()`.
7. Team = `service.team_id`. Insert the row (number assigned by the database).
8. Business Rules with trigger `created`.
9. Activity `created`. Save the chosen **AC snapshot** [R1].
10. **OEM routing** (§11.4) and **automatic CVM approval** (§9.5) according to the category/service switches.
11. Notifications: requester confirmation (with ticket number), assignee/team, "book on behalf" notice.
12. Approvals are never created implicitly except by the CVM rule.

### 6.4 Changing status (`applyStatusChange`, one function used by technicians, requesters, the CSAT link and cron)

Loads the row, decides *agent* vs *requester*, picks the special cases (start-working, requester reopen, agent reopen, approval-rejection reopen), enforces **mandatory comments**: reopen (requester and agent), cancel (agent), first `in_progress`, `waiting_user`, **`hold_purchase_ho` and back**, `resolved` (the resolution note must pass a quality check `checkResolutionNote`), then **technician-mandatory fields** (fields marked required but not requester-settable must be filled before any status change; `store_address` is exempt). Race guard `.eq('status', current)`. Side effects: stamps (`resolved_at`, `closed_at`), `reopen_deadline_at = now + reopen window` on resolve, SLA pause/resume with pause credit (§7.4), auto time-tracking (entering `in_progress` opens a time entry, leaving closes it), **CSAT start and e-mail on resolve** (§6.7), reopen bookkeeping (`reopen_count`+1, resolution deadline recomputed from now, pause ledger reset), activity entries (`status_changed`, plus `reopened` with reason `approval_rejected|unsatisfied_with_resolution|agent_reopened`), notifications, public comment, Business Rules `updated` trigger.

**When a resolved ticket is reopened, the OEM is e-mailed again** [R1]: same OEM, same AC, subject prefixed "REOPENED - ", the requester's reason inside; never for tickets that were not sent to an OEM, never overwrites the first-response time or the original snapshot.

### 6.5 Other ticket operations

- **Assign / reassign**: only to members of the ticket's team; `open → assigned` automatically; notifies assignee and requester.
- **Priority: nobody changes it by hand** [LIVE]. It is set only from the sub-category's SLA priority (when the category is changed) and by Business Rules. (The old `changePriority` / bulk change were removed; a guard test prevents re-adding.)
- **Reclassify**: change category/sub-category within the service (priority re-derived), or move to another service (priority unchanged); SLA deadlines are recomputed from creation *plus the pause credit*.
- **Collaborators** (watchers): agent+, same team, not the assignee. **Comments**: public/internal; `@mentions`; the first public technician comment sets `responded_at`; a requester reply while `waiting_user` resumes work automatically.
- **Attachments**: validated (§4.11); internal attachments hidden from requesters.
- **Time tracking**: automatic (see 6.4).
- **Reopen window**: `app_settings.auto_close_days` (default 3 days); after it the ticket auto-closes (cron).
- **Ticket PDF** download; **related requests**; **split/child** via `parent_request_id`.

### 6.6 Reopen rules recap

| Case | Who | Window | Comment |
|---|---|---|---|
| Unsatisfied with resolution | requester | `auto_close_days` after resolve | required |
| Technician reopens own resolved ticket | technician | none | required |
| Approval was rejected (cancelled) | requester | fixed 48 h | optional |
| From the CSAT e-mail link | requester | same as first row | reason typed on the page |

### 6.7 Customer satisfaction (CSAT) [LIVE]

On `resolved`, a `csat_surveys` row is created and **one** e-mail is sent: "your request is resolved", the resolution note, **five one-click star links** and a **"not fixed — reopen" link**, all tied to a signed token (purpose secret `csat_link`, valid ~30 days). The public page `/csat/<token>` shows what the requester can still do (rate, reopen inside the window, or nothing). A reminder is sent once after `csat_reminder_days` (default 2) if there was no rating or reopen. A rating of 1–2 creates a `csat_low_rating` notification for the technician and managers. Settings (`csat_enabled`, `csat_reminder_days`) are in Request Configuration → General. When CSAT e-mail cannot be sent (off, no secret, no address) the plain "resolved" e-mail is sent instead, so a requester always hears about it.

---

## 7. SLA engine

### 7.1 Inputs
`business_hours` (per weekday window), `holidays`, `sla_policies` (per service), `field_sla_overrides`, `request_priorities`, global time zone IST.

### 7.2 Deadline computation
- `computeSLADeadline(start, minutes)` walks business windows day by day (holidays skipped), local time, safety bound; returns **`null`** (never a far-future date) if the calendar has no usable window, and the caller logs and alerts.
- `computeElapsedBusinessMinutes(a, b)` is the inverse.
- `resolveSlaDeadlines({serviceId, priority, servicePolicyConfig, allFields, formData, from})` is the **only** function that turns priority + service + form answers into `response_due_at` / `resolution_due_at`:
  `hours = fieldTier ?? policyTier ?? null` independently for response and resolution; if several selected options carry overrides the **smallest** hours wins.
- Layers: **field-level override** (service + field + option value) beats **service SLA policy**. There is no third (sub-category) hours layer; a sub-category only supplies the *priority label*.

### 7.3 Breach logic (`lib/sla/breach.ts`) — one implementation
- `isCurrentlyBreached`: resolution due passed and status not resolved/closed/cancelled ("live" view — labelled **Currently Breached** in UI).
- `isEverBreached`: resolved/closed *after* due, or still open and past due ("history" view).
- `isEverResponseBreached`: same for first response.
Paused statuses (`waiting_user`, `hold_purchase_ho`, `pending_approval`) do **not** count as closed: a long pause can still show "currently breached" because the due date is extended only when the ticket *leaves* the pause.

### 7.4 Pause credit
`waiting_since` marks an active pause; leaving it adds the paused milliseconds to `paused_ms_total` and extends both due dates. Anything that recomputes deadlines from `created_at` (category change, reclassify, rule `set_priority`) must add `withPauseCredit(due, paused_ms_total, waiting_since)`. A reopen resets the ledger (new clock).

### 7.5 Escalation and alerts
`business_rules` with `schedule` trigger (`sla_pct_elapsed`, `unassigned_minutes`) every 15 minutes; `alert_rules` + daily digest every 30 minutes (self-gated to once a day at 08:00 IST). All idempotent through event tables.

---

## 8. Business Rules engine

One table (`business_rules`), one pipeline. Replaces the earlier separate routing / escalation / alert systems.

- **Trigger**: array of `created`, `updated`, `schedule` (schedule rules carry `schedule_check = sla_pct_elapsed | unassigned_minutes` + `schedule_threshold`).
- **Conditions**: `[ {field, form_field_id?, operator, value?, logic?} ]`. Fields: priority, status, service, category, sub-category, template, team, project, assignee, requester, requester role/department/location/designation/function, title, description, source channel, `is_sla_breached`, `has_attachment`, `age_days`, `form_field` (answer of a form field). Operators: equals, not_equals, contains, not_contains, is_empty, is_not_empty, in, gt, gte, lt, lte. Each condition after the first has its own AND/OR connector; evaluation is sum-of-products left to right; an empty list matches everything.
- **Actions** (run in order; one failure does not stop the rest):
  - `assign` {strategy `direct | round_robin | load_balanced`, assigneeIds} — verifies the chosen person is on the ticket's team (skips otherwise); writes only `assigned_to` (does **not** change status; round-robin cursor in `last_assigned_index`);
  - `set_priority`, `set_status` (limited to `SERVER_ALLOWED_TRANSITIONS`), `set_team`;
  - `notify` {roles, notifyAssignee, notifyRequester, channels in_app|email}; total e-mail failure triggers an operator alert.
- **Idempotency**: `business_rule_events (rule_id, request_id)`; a rule never fires twice on the same ticket.
- **Cron** `/api/business-rules/run` (every 15 min) handles schedule rules; `created`/`updated` rules run inline.
- **Reference rules**: one assignment rule per technician per (service, category[, sub-category]) — 38 rules today (see §22).

---

## 9. Approvals

### 9.1 Model
`approval_workflows` (named chain) → `approval_workflow_steps` (ordered; `specific_user` or `any_manager`). `approvals` = one run against a ticket; `approval_decisions` = one row per decision. `requests.pre_approval_status` remembers the status before submission.

### 9.2 Sequential vs parallel (ad-hoc)
- **Sequential** `submitForApproval`: steps in order. Hard-fails if the workflow has **zero steps**.
- **Parallel / ad-hoc** `sendAdHocApproval(request, approverIds[])`: a throw-away workflow with one step per approver and `current_step = 0`; all must approve. Almost all approvals in production are ad-hoc.
- Blocked when the ticket is resolved/closed/cancelled/already pending approval (ad-hoc also blocks `open`/`assigned`).

### 9.3 Submission effects
`status = pending_approval`, remember previous status, start the SLA pause, activity `status_changed` + `approval_requested`, notify approver(s) by in-app, e-mail and an **approve/reject link**.

### 9.4 Decide
- `approveApproval`: records the decision; when the last step is approved (race-guarded `UPDATE … WHERE status='pending'`) resume SLA, restore `pre_approval_status` (default `in_progress`), notify the requester.
- `rejectApproval`: ticket → `cancelled`, `cancellation_reason = 'approval_rejected'`, `reopen_deadline_at = now + 48 h` (fixed); requester can reopen within that window.
- `delegateApproval`: only the current approver; target must be an active person of the same org.
- **Separation of duties**: nobody can approve their own request, and the person who added an approver cannot be that approver (`requested_by` recorded).
- **E-mail approve/reject page** `/approve/<token>`: the link carries a signed token; to act without being signed in the approver types a **random single-use 6-digit code** e-mailed to them (stored only as a keyed hash, expiry, attempt counter; table `approval_email_codes`). The page shows a visitor who is not the approver nothing but the approver's name.
- **Reminders**: cron `/api/approvals/reminders` re-notifies pending approvers.

### 9.5 Automatic approval by the store's CVM [LIVE; source of CVM changes in R3]
Category flag `auto_cvm_approval`. On ticket creation (after OEM routing), for such a category: find the store's CVM (via **[RELEASE-3]** the CVM sheet row for the store code, matched by e-mail to an **active staff member**; before R3 `stores.cvm_id`) → move the ticket to `in_progress` (conditioned on still `open`) → create an ad-hoc approval to that CVM → post a plain public note to the requester ("sent for approval to <CVM>"). If there is no usable CVM (store not linked, not in sheet, e-mail not an active staff member, CVM is the requester) the ticket stays **Open** with an **internal note** telling the technician to send it by hand. Never throws; the ticket must not be lost. A technician sending a ticket for approval by hand also gets the CVM **pre-filled** as approver.

### 9.6 Status interplay
`pending_approval` accrues into the same pause ledger as `waiting_user`. Approval-rejection reopen is the only way out of `cancelled`.

---

## 10. Service catalogue and dynamic forms

### 10.1 Catalogue model
A **service** is not nested under one category: categories/sub-categories are many-to-many tags (`service_sub_category_tags`) with **exactly one service per sub-category** (database unique). The requester picks Category → Sub category as part of the form; the service has its own team, SLA policy, form (or a shared **form template**), location visibility and status (`draft|review|published|retired`; requesters see only `published` + `is_active`). Admin screens: Categories (tree + CSV export/import), Services (create/edit/duplicate/archive/delete; retag is atomic via RPC; delete blocked if tickets or SLA overrides exist), Form Templates, Field Library, SLA Policies.

### 10.2 Form builder
- Three-pane **Section Builder**: field library (11 types: text, textarea, number, date, select, multiselect, email, phone, file, toggle, store_address), canvas of sections/fields, inspector with live preview (requester vs technician view). Option trees can be nested; options are **archived, never deleted** (`is_active=false`), so old answers stay valid.
- **Field ids** are time-based and unique (`<base36 time>_<seq>`), **not** derived from labels: renaming never breaks stored answers or SLA overrides. Server re-validates ids (globally unique in the payload), required options for selects, and the visibility combination.
- **Visibility/mandatory semantics** (`requester_can_view`, `requester_can_set`, absent = true): requester-facing fields gate submission; fields the requester cannot set but that are `required` are **technician-mandatory** and gate status changes. `set=true` with `view=false` is invalid.
- **Category-limited fields** (`show_for_categories: [categoryId…]`) **[LIVE]**: the field exists only for those categories (client shows/hides; the server **drops** a value sent for another category and requires it for the listed ones). Example: the **Qty** field of "ADMIN REQUIREMENT TEMPLATE", type number, required, shown only for FIXTURES, FIXTURES-ATTACHMENT, HANGERS, with `validation {min: 1, max: 10000}`.
- **Number validation** (`validation.min/max`) is applied by the browser box and re-checked on the server.
- **AC dropdown** `options_source: 'ac_units'` **[RELEASE-1]**: the field "AC Serial Number" shows the requester's own store's **Active** ACs (from the AC sheet), labelled "`3 - FF_First Floor, Ductable 5.5 TR`"; the stored value is the CKDESK number (with the serial added only if two active ACs of a store share a number). A requester without a store gets the typed fallback list.
- `store_address` field: always system-filled, inert, exempt from validation.
- **Frozen snapshots**: `requests.form_sections_snapshot` stores the resolved form at creation; later edits never change what is mandatory on an old ticket.
- **Validation** (`validateFieldValue`) is shared by client and server: text length, number range, date format `YYYY-MM-DD`, option membership (including archived), e-mail regex, phone exactly 10 digits, required rules by audience.

### 10.3 Requester experience
`/services` catalogue (search, recently used) → `/services/<slug>` form (Category, Sub category, requester details, ticket details, description, attachments — attachments are **mandatory** on the production forms) → ticket page. Technician-only fields never reach the requester's form.

---

## 11. Master data: stores, AC / Genset / CVM sheets, OEM routing

### 11.1 Principle
Equipment and approver data is **owned by three Google Sheets** that the business edits; the application **copies them into PostgreSQL on a schedule and never writes to a sheet**. Everything else (ticket form, OEM mail, approvals, reports, dashboards) reads the **database copy**, never Google. This gives: fast pages, history when a sheet row disappears, and a clear health page for sheet mistakes.

### 11.2 The three sheets (headings found by name — capitals, spaces and punctuation ignored; any column order; extra columns ignored)

| Sheet | Columns used | Feeds |
|---|---|---|
| **AC DETAILS MASTER SHEET-ADMIN** [R1] | Store Code, **AC CKDESK SERIAL NO** (the AC number inside the store), AC Serial No, Status (`Active`/`Inactive`), Mail ID (OEM addresses, comma separated), AC Floor, AC Type, AC Tonnage, AC Brand, AC-AMC vendor, AC-AMC Brand, Zenatix (yes/no), Store Priority list, Festival, Region, Cluster, Opening date (date serial), City, State, Address, pincode | the AC dropdown of the ticket form, the AC OEM e-mail (To/CC), store details, AC counts and AMC-vendor reports |
| **GENSET Detail MASTER SHEET-ADMIN** [R2] | Store Code, Genset Brand, Genset KVA, Genset Serial No, CPCB Group, Mail ID | the genset OEM e-mail |
| **CVM Detail MASTER SHEET-ADMIN (for Approval)** [R3] | Store Code, CVM EMAIL ID | the approver for categories with automatic CVM approval; the pre-filled approver |

Company addresses (`@citykartstores.com`, `@citykart.org`) in a Mail ID cell are put in **CC**; every other address in **To**. Invalid addresses are skipped (the rest still receive the mail) and listed as problems; common typos of the company domain (for example a missing letter) are flagged, not silently fixed.

### 11.3 Sync engine (`lib/masters/*`)

- **Schedule**: scheduled task at **11:00, 15:00 and 19:00 IST** (`/api/masters/sync`, protected by the cron secret) plus an administrator button **"Update from sheets now"**. A hash of the sheet content skips unchanged sheets, except a full pass every 15 minutes while anything is waiting.
- **Google access**: one Google account (the "CK Desk" account) is shared Viewer on the sheets. An administrator presses **Connect Google Sheets** once; OAuth (scope `spreadsheets.readonly` only, `prompt=select_account consent`, `access_type=offline`) returns through the existing registered callback (`/api/intake/oauth/callback`, state `channel=masters`). The refresh token is stored in **Vault** (`master_google_connection.secret_ref`). If Google refuses the token the connection is marked **broken** and the page asks to connect again; administrators get one e-mail per new failure.
  - *Google rules to remember*: the OAuth consent screen should be **Internal** (otherwise Google expires the token every 7 days); a plain-`http` public address cannot be a redirect URI (only `https` with a domain, or `localhost`) — on an `http` deployment connect through a `localhost` tunnel or add HTTPS; the app must show Google's **account chooser** every time (`select_account`) so the CK Desk account is chosen deliberately.
- **Parse** (`parse.ts`): required columns checked (a sheet missing one is **not applied** and the last good copy stays); rows validated per kind; issues collected with `kind`, `severity`, `code`, `store_code`, `sheet_row`, grouped when the same problem repeats on many rows.
- **Match** (`diff.ts`): a stored unit is recognised by **store + serial** first, then **store + CKDESK number**; renumbering rows keeps units; a store with a single genset keeps its unit when the serial is corrected; units that leave the sheet are marked `missing_since` then `removed_at` (**never deleted**).
- **Removal brake**: if more than 20 units (or 15%) disappear at once, they are only removed at a **later** update at least 30 minutes on, so a mistaken deletion can be undone in the sheet.
- **Store master one-way update** (AC sheet wins): `ac_total` (count of Active ACs), address, city, state, pincode, cluster, region, priority list, festival, opening date, most common AC brand / AMC brand / AMC vendor, Zenatix.
- **Health page** (Admin → Sheet Masters): connection status, three source cards (sheet link, status, last checked/updated, rows, problems "N to fix, M to look at"), counts (Active ACs, Inactive, Gensets, Stores with a CVM, Removed), a filterable **Master data health** list, and the two mail templates. A new store that is in a sheet but not in the store master is a *warning*: its rows are kept, no ticket can be raised for it until the store exists.
- **Switches per release**: `lib/masters/kinds.ts` holds one boolean per sheet (AC / Genset / CVM); a sheet that is off is never read, has no card, and its tickets keep the earlier route. Each release changes only its own line, so releases merge in any order.

### 11.4 OEM routing at ticket creation [R1 AC, R2 Genset]

Trigger: the **category** has `auto_oem_kind = ac|genset`, or the **service** has the legacy `auto_oem_routing` flag (treated as AC and *quiet*: no note when the store has nothing in the sheet).
1. Requester must be linked to a store (else internal note "not linked to a store… send it to the OEM yourself").
2. **AC**: the unit the requester chose gives the addresses (without a choice, the store's other Active ACs do). **Genset**: every genset row of the store; **one mail to all addresses** listing every genset.
3. Render the template for the kind (placeholders `{{ticket_no}}, {{subject}}, {{description}}, {{requester_name}}, {{requester_email}}, {{requester_phone}}, {{store_address}}, {{store_code}}, {{category}}, {{ac_number}}, {{ac_serial}}, {{ac_brand}}, {{ac_floor}}, {{ac_type}}, {{ac_tonnage}}, {{ac_amc_vendor}}, {{ac_amc_brand}}, {{ac_details}}` and genset equivalents). Values are HTML-escaped as they are filled in; the template body is sanitized on save and again at send.
4. Send **ONE e-mail** (OEM in To, company people in CC; thread tag in the subject so replies come back to the ticket).
5. On success: save the **snapshot** (unit as raised + who was mailed), post a **public system comment** with the full mail text, and move the ticket `open → in_progress` (conditioned on still `open`; sets `responded_at`).
6. On failure or missing data the ticket stays **Open** with an **internal note** saying what to do (no store, store not in sheet, no address, mail failed).
7. A technician changing the category later never sends mail by surprise. **Exception [R1]: reopening a resolved ticket re-sends** (see 6.4).

### 11.5 Automatic CVM approval source [R3]
`master_store_cvm.cvm_email` (lower-cased) is matched to an **active** staff member (`agent|manager|admin|platform_owner`); the sheet may list an e-mail that has no login — that is reported as a warning ("not an active technician, manager or admin…").

### 11.6 AC and Genset master screens [R5]
`/admin/masters/ac` and `/admin/masters/genset` (admin, platform owner, manager): list of the database copy with filters (search, status Active/Inactive/Removed/All, brand, region, AMC vendor), counts by brand/tonnage/region (AC) or brand/KVA/CPCB group (genset), and **Download Excel (CSV)** of the filtered list through `/api/masters/export?kind=…` (CSV-injection-safe). The same columns serve dashboards. Store master keeps **only store facts** (address, opening date, AC total); equipment detail lives in these masters.

### 11.7 Store master, bulk imports
Admin → Organisation → Stores: create/edit, **Store Master Excel upload** (columns: code, name, address, city, state, pincode, cluster, region, priority list, open date, festival, AC fields). **[SUPERSEDED, removed in R6]**: the OEM / Genset OEM / CVM columns and the "assign stores to OEM/CVM" actions. Imports are per-row tolerant (`{imported, errors[]}`), Windows-1252 vs UTF-8 handled. Users import matches `store` by upper-cased store code.

### 11.8 Legacy OEM buckets and CVM tags [SUPERSEDED — understand, do not build]
Before the sheets: `oems` rows with `kind ac|genset`, one AC slot (`stores.oem_id`) and one genset slot (`stores.genset_oem_id`) per store, a store CVM tag (`stores.cvm_id`), categories pointing to the OEM type, screens to assign stores in bulk, and database guards (wrong-type OEM refused). Release 6 retires the screens and actions; the columns/table stay for history and can be dropped later.

---

## 12. Engineer visits (FSR) [RELEASE-4]

### 12.1 Purpose
After an OEM engineer visits a store for an AC, Citykart must know **per AC** whether it was fixed, what the engineer found, which parts need buying, and have the **store confirm** — and tickets must not stay open for ever when nobody answers.

### 12.2 Actors and screens
- **OEM engineer — no login.** Public page **`/engineer`** (plain, mobile-friendly): Step 1 store code + **today's visit code**; Step 2 name, mobile (10 digits), visit date (not in the future), **photo(s) of the signed FSR** (up to 5 files, 10 MB each, JPG/PNG/PDF, validated like every attachment); Step 3 tick each AC he worked on and choose **Resolved / Not resolved**; if not resolved choose one of four **reasons** — *the engineer will come again*, *parts needed and Citykart must raise a PO* (code `parts_po`), *parts needed and the OEM bears the cost* (code `parts_oem`), *other* — and list the **parts** (name + quantity, up to 15); remarks.
- **Store** — `/ac-visits` (store logins): shows **today's visit code** (to read out to the engineer), "Waiting for your answer" cards (engineer details, FSR links, reason, parts, remarks, countdown to automatic resolution), a list of ACs "waiting for the OEM engineer's report", and recent answers. The store answers **Yes, resolved / No, not resolved** with remarks (required when "no").
- **Technicians / managers / admins** — `/visits` ("AC visit reports"): all reports, a **Parts to order** list with purchase-order status, mark a report **wrong** (void), edit the two timings (administrators).

### 12.3 Visit code
A 6-digit code per store per day, **derived** (HMAC-SHA256 of org + store code + IST date with the `visit_code` secret, first 4 bytes modulo 1,000,000), nothing stored, changes every day, **valid for today and yesterday** (a visit that runs past midnight), compared in constant time, shown only to the store and staff. No secret configured = the feature is off. **Five wrong tries lock that store for a while**; the same refusal text is returned for an unknown store and a wrong code (no store enumeration). The public API routes (`/api/engineer/lookup`, `/api/engineer/submit`) are rate-limited and the report records only a hash of the source IP.

### 12.4 What the page lists
The store's **open AC tickets grouped by AC** (an AC with two tickets shows once and the answer covers both). Tickets of the genset or other services are not shown. An AC the engineer reports for another store, or an unknown AC, is refused.

### 12.5 Rules (the decision table)

| Engineer says | Store says | Result |
|---|---|---|
| Resolved | Resolved | all tickets of that AC are **resolved** (`resolved_both`) |
| Resolved | Not resolved | tickets stay open; **ONE e-mail to the OEM** "Please send an engineer again" (template kind `revisit`); item `disputed` |
| Not resolved | Resolved | **resolved** — the store's answer is final (`resolved_by_store`) |
| Not resolved | Not resolved | stays open, **nothing is e-mailed** |
| Resolved | no answer for **48 clock hours** (adjustable 1–720) | **resolved automatically** (`resolved_auto`); the store gets a **reminder after 24 hours** (adjustable) |
| Not resolved | no answer | nothing automatic |

- A fresh engineer report for the same AC **replaces** an unanswered earlier one.
- The same note, the FSR files and the engineer's details are written to **every ticket of that AC** (internal/public comment + attachments).
- **Parts needing a purchase order (`parts_po`)** put the tickets on **`hold_purchase_ho`** and appear on the technician's **Parts to order** list; a technician records the OEM's parts note and PO number/date/vendor and PO status (`to_raise → raised → revisit_planned → done`); when the store later resolves, the PO line closes.
- Resolving by this module goes through the server (the store requester cannot resolve in the normal UI) using the **same bookkeeping as the normal status change**: resolved timestamps, reopen window, SLA pause credit, stopped timers, activity entries, **CSAT survey and e-mail**, notifications.
- **Cron** `/api/visits/run` every **15 minutes** performs the automatic resolutions and the reminders.

### 12.6 Security notes
Public page over plain HTTP is an **accepted, parked risk** (HTTPS later): the code changes daily, locks after five tries, shows only that store's tickets and accepts no free-text store switching. Uploaded FSR files go through the standard attachment validator and are served only to authorised staff/store users.

---

## 13. Notifications, e-mail, web push

### 13.1 `notify()` (`lib/notifications.ts`) — never throws
Input `{recipientId, actorId, type, title, body?, requestId?, link?, metadata?}` (single or array). Steps: de-duplicate recipients → drop users who opted out (`notification_preferences`) → look up org → apply **org channel rules** (`notification_rules`: per event type `in_app|email|push`; **a missing row means all channels ON**) → insert in-app rows (server write) → detached e-mail and push fan-out per recipient with per-recipient try/catch → if 100% of an e-mail batch fails, `alertOperator`.
The **channel catalogue** exposed to admins has 21 event types in 6 groups (Requests, Assignment, Conversation, Collaborators, Approvals, Tasks). Types that have their own pickers (alert rules, business-rule notify) are excluded to avoid double gates.

### 13.2 E-mail sending (`lib/email/*`)
- **SMTP** (nodemailer) with the mailbox saved in **Admin → Platform Settings → Integrations → Email Sending** (host, port, username, From name/address, password in **Vault**); changes apply without a redeploy (60 s cache). Env fallbacks exist; **Resend** is an alternative provider. `sendEmail` returns `{error?}` and never throws; when no provider is configured it logs and returns success-shaped.
- Supports **cc**, plain-text + HTML, attachments, a **thread tag** in the subject (`withSubjectTag`) and a tagged reply address so replies are matched to the ticket.
- **Local mail sink** (`MAIL_SINK_DIR`, ignored in production): writes each message to a JSON file instead of sending, so whole workflows can be tested without a single mail leaving the PC.
- All user-controlled text is HTML-escaped (`escapeHtml`) before being placed in a mail; rich templates are sanitized (`sanitize-html` allow-list).
- Templates for: request created / assigned / status changed / comment / approval required / approval decision / SLA / CSAT resolved + reminder / OEM mails / revisit mail / alert emails / scheduled reports.
- E-mail links use `NEXT_PUBLIC_APP_URL` (the public address).

### 13.3 Reply by e-mail (`/api/email/inbound-sync`, cron every 1–5 min)
Reads the same mailbox over IMAP (look-back 3 days, de-dupe by Message-ID in `processed_inbound_emails`, a 2-minute time budget per pass). A reply is matched to its ticket by the **thread tag** in the subject/address; the sender must be a **known participant** (requester, assignee, collaborator, known OEM address from the sheets/OEM list) and pass sender-authenticity checks (SPF/DKIM-style result headers, plausible sender); quoted text is stripped; the reply is posted **once** as a comment (claim-then-post). Replies from OEM addresses are recognised by address and by domain; those addresses are also offered when copying people on a ticket.

### 13.4 Web push
`push_subscriptions` + VAPID (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); `public/sw.js` handles push and clicks; subscribe/unsubscribe actions; dead subscriptions (404/410) are deleted on send; the auto-prompt asks once per browser and records "asked" only after a real decision.

---

## 14. Intake channels

### 14.1 E-mail intake (module `intake`; currently **disabled** for the organisation)
Mailbox (Gmail/Outlook OAuth push or IMAP polling) → raw message stored idempotently (`intake_messages`, `intake_threads`, `intake_attachments` with validation) → **classification pipeline** (stage 1 deterministic rules incl. org-authored `intake_rules`; stage 2 optional OpenAI-compatible LLM; stage 3 reserved) writes `intake_classifications` and an `intake_reviews` row → a **human reviewer** converts (`approveAndCreate`) into a ticket (through the same `createRequestCore`, so SLA, rules and validation apply), task or approval, or marks informational/ignore. **One e-mail creates at most one ticket** (unique index). Webhook tokens are separate from the worker secret; webhooks always answer 200 to avoid retry storms.

### 14.2 WhatsApp conversational intake (coded, **never connected**)
Identity = `profiles.mobile_number` + `whatsapp_enabled`; a resumable state machine (`conversation_state`: identified → awaiting_service → awaiting_issue_search → awaiting_subcategory → awaiting_description → collecting_fields → awaiting_file → review → submitting → completed/cancelled/expired) in `request_conversations` with optimistic concurrency (`commit_conversation_transition`), idempotent webhook ledger (`conversation_events`), staged attachments, per-sender rate limits (30/60 s; 5/5 min for unregistered). Webhook route must stay reachable **without** a session (a `curl` must return 403, never a redirect to `/login`). Build only if a Meta account is available.

### 14.3 Intake worker
An optional standalone Express service (`api/`) holds IMAP/Gmail/Graph polling and LLM classification; talks to the app through a shared worker secret. Not required for the live product.

---

## 15. Reporting, analytics and dashboards

### 15.1 Home dashboard (`/home`)
One RPC `get_home_dashboard` returns counts and lists (my open, my queue, team open, my requests, assigned) per role; includes statuses `waiting_user`, `hold_purchase_ho`, `pending_approval`; deferred navigation counts.

### 15.2 Executive Dashboard (`/dashboards/executive`)
One dashboard narrowed by **level**: requester → own tickets; technician → own groups (+ "only mine"); manager → own groups; admin/owner → all groups. Interactive cross-filtering by dimensions (service, category, group, technician, store, cluster/region, priority, status, AC / non-AC, NSO, red-flag, OEM = AMC vendor from the AC sheet…), KPI tiles, trend, ageing, SLA compliance, workload, approvals. Data load: tickets within an 800-day look-back plus every still-open ticket, paged 1,000 at a time with a 30,000-row safety cap and a visible "truncated" notice; short-TTL cache. Uses store dimensions (`store-dims`), AC context (open AC tickets per store, Server Room AC excluded), IST date helpers, financial-year ranges (30/60/90/120 days, FY).

### 15.3 Report Analytics — fixed reports (`/reports/analytics/[slug]`)
Staff only (agent, manager, admin, owner); a manager/technician sees groups they belong to, admin all. Fixed list (each with its own layout, statuses and filters, downloadable to Excel): **Red Flag Store Report** (stores whose open AC tickets exceed a percentage of their ACs), **Store AC Not Working Report**, **AMC Vendor Report**, **Store Side Pending Tickets Report** (`waiting_user`), **AC Issues Report**, **Repair & Maintenance Report**, **Admin Requirement Report**, **NSO Status / NSO Summary**, **BD Status / Summary**, **Admin Summary**, **Weekly / Monthly Admin Report**, **Priority Wise Report**, **Repeated AC Complain Report**. "Open" means `open, assigned, in_progress, waiting_user, hold_purchase_ho, pending_approval`. NSO = no opening date or opened less than 9 months ago; "responsible" = the technician.

### 15.4 Report Builder (`/reports/pivot`)
Five entities (requests, tasks, projects, milestones, approvals) with a field registry (types string/number/date/boolean/enum, aggregations by type), dynamic columns (`form:<field_id>` labelled "Service: Field", `custom:<id>` for task fields), a pure client/server **pivot engine** (rows, columns, values, filters; table mode), drag-and-drop UI, row cap 20,000 with `truncated`, role-based row scope for requests (`all | own | agent | team`), saved reports (`saved_reports`), and **xlsx export** (table as a native Excel table; pivot as static cells + raw-data sheet) re-authorised and re-fetched on the server. SLA columns use the *ever-breached* formulas.

### 15.5 Exports and scheduled reports
CSV (formula-injection-safe, UTF-8 BOM) and xlsx; `scheduled_reports` (daily/weekly/monthly) with recipients; every export is written to the audit log.

### 15.6 Master-data reports
AC counts exclude Inactive ACs; "OEM" columns show the **AC-AMC vendor** from the AC sheet; genset tickets are not counted as AC tickets (AC reports use the AC service flag).

---

## 16. Projects and tasks

Projects (`status`, `priority P1–P3`, owner, functional owner, team, dates, milestones, members, updates with percent snapshots, activity), milestones, tasks (personal/team, subtasks, dependencies, multi-assignee, templates, per-team custom fields, comments, attachments, activity), task priorities/statuses lookups. "Overdue" is derived. Progress percent comes from one function (`computeProjectProgressPct`). Project detail is limited to admin/owner while the module matures. Alerts: task/milestone due-soon/overdue and a daily digest (cron `/api/alerts/run`).

---

## 17. Administration screens

Every admin page checks the role at the top of its own server component (`redirect('/login')` when signed out, `redirect('/home')` when not allowed); stricter subset (admin/owner only): Categories, Services, Form Templates, SLA Policies, Projects, Monitoring, Sheet Masters, Logs (System/Event tabs).

| Screen | Purpose |
|---|---|
| **Users** | list/search/filter; invite or create (forces password change), bulk Excel import (store matched by code), edit profile & org fields, change role (a plain admin cannot grant admin/owner), reset password, deactivate, change sign-in e-mail (`replace_user_email` updates every stored copy), WhatsApp number(s) |
| **Teams** | CRUD, membership with lead flag |
| **Roles** | read-only reference of roles and the (non-enforced) permission matrix |
| **Organisation** | Departments, Locations, Cost Centers, Job Functions, Designations, **Stores** (+ Excel upload and export) — OEM and CVM tabs **[SUPERSEDED, removed in R6]** |
| **Master Data** | Request priorities (order, SLA multiplier); task statuses/priorities live in Task Config |
| **Sheet Masters** [R1-3] | Google connection, "Update from sheets now", three source cards, health list, AC / Genset / re-visit e-mail wording |
| **AC master / Genset master** [R5] | filtered lists + CSV download |
| **Categories** | category/sub-category tree, per-category switches (**OEM: No / AC / Genset**, **send to CVM**), CSV import/export |
| **Services** | catalogue items, tags, team, SLA policy, template, locations, status |
| **Form Templates / Field Library** | reusable forms; reusable field definitions |
| **SLA Policies / Request Config** | policies; Field SLA Matrix; lifecycle matrix view; Business Hours + holidays; Alert Rules; Notification Rules; General (reopen window `auto_close_days`, CSAT settings) |
| **Business Rules** | rule builder (conditions with per-condition AND/OR, actions) |
| **Approval Flows** | workflow builder (steps) |
| **Task Config, Knowledge Base, Runbooks** | task statuses/priorities/custom fields/templates; KB articles per service; documentation browser |
| **Platform Settings** | Retention; Integrations → **Email Sending** (identity, mailbox, status) |
| **Logs** (`/admin/logs`) | tabs **System Log**, **Audit Log**, **Event Log** (see §19.5) |
| **Monitoring** | live operational stats |
| **Intake** (staff, separate menu) | inbox, review, rules, channels, settings (module off today) |

---

## 18. Security design

The application went through an external-style VAPT and a post-audit remediation (≈70 findings across critical/high/medium/low). The resulting design rules — a new build must follow all of them:

1. **Authentication**: e-mail + password only; no public sign-up; forced first password change **enforced in the database** (a person who must change their password has no org and no role in row security until they do); strong reset flow; rate limits on sign-in/forgot/invite/reset; cookies `Secure` when the public URL is https.
2. **Authorisation in three layers**: (a) page/route guard, (b) every server action re-checks identity, role, module flag and org scope, (c) **row-level security + table privileges in PostgreSQL**. Sensitive writes are **server-only** (service role) — the signed-in browser role has no insert/update/delete on audit, notification, approval-code, master-data, visit and secret tables, and cannot edit attachment rows or comment on another organisation's ticket. **Ownership checks** exist for projects, tasks, task files and approvals (the database checks *which* record a person touches, not just that they are staff).
3. **Status transitions** enforced by trigger as well as code (§5.1).
4. **Per-purpose secrets** (§4.10); signed links (`approve`, `csat`, OAuth state) carry expiry; webhook tokens are separate from the worker secret; constant-time comparison everywhere; **cron endpoints** require `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`.
5. **Approval e-mail codes** are random, single-use, hashed, expiring, attempt-limited. Separation of duties on approvals.
6. **Input and output safety**: all user text escaped before HTML mail; template HTML sanitized; CSV exports neutralise leading `= + - @`; attachment allow-list + magic bytes + no SVG; downloads forced as attachment; the AC / store / engineer values are validated server-side, never trusted from the browser.
7. **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment off), **`Content-Security-Policy-Report-Only`** built from the configured API address (an enforcing policy is a later step), **HSTS only when the public URL is https**.
8. **Public surface kept minimal** (list in §2.3). The engineer page (§12) is the only unauthenticated *write* path besides approval/CSAT links; it is guarded by the daily store code, lock-out, rate limit and strict validation.
9. **No secrets in the repository, logs or chat**; error text and system-log entries redact secrets, tokens, e-mail addresses and phone numbers; the Vault holds mailbox, Google refresh token, channel credentials.
10. **Audit**: every business-table change is recorded with before/after through database triggers into a **hash-chained system log**; sign-in/out, user administration, exports and report changes are logged; "Verify integrity" re-checks the chain.
11. **Multi-organisation isolation** is tested (an organisation cannot read or write another's rows, including through RPCs and attachments).
12. **Operational safety**: the app tolerates a missing optional table; failures to log never break a user action; mail failures never lose a ticket.
13. **Dependency hygiene**: keep Next.js on the current patched 16.x release; monitor advisories. **Type errors fail the production build** (no `ignoreBuildErrors`).
14. **Accepted/parked risks** (owner decisions): plain HTTP on the public address (HTTPS later); the database superuser password rotation is a manual step; one shared mailbox identity for outbound mail.

---

## 19. Operations: environments, jobs, backups, release, observability

### 19.1 Environments
| Environment | Purpose |
|---|---|
| **Developer PC** | Supabase CLI stack in Docker (API 54321, DB 54322, Studio 54323, mail catcher 54324), `next dev` on 3210, local mirror of production *configuration* (services, categories, templates) and, when refreshed, production *data* without passwords/mail settings (local logins share one test password). Mail goes to the **mail sink**, never out. |
| **Isolated test stack** | A second, separate Supabase stack (ports 554xx) used only by automated integration/VAPT tests. A **21-point isolation gate** runs before every suite and **must pass**: no mailbox/WhatsApp settings, every user synthetic (`@example.test`/`@audit.test`), no production tickets, no socket towards any production address, all outward-facing environment variables explicitly blank or local, the egress guard preloaded. The gate is never bypassed. |
| **Production** | §3.3. Changes only after explicit owner approval, one release at a time. |

### 19.2 Scheduled jobs (all call `/api/…` with the cron secret; Windows Task Scheduler runs `run-cron-tick.ps1` → `cron-tick.mjs`)
| Job (task name) | Route | Cadence |
|---|---|---|
| Alerts (`-Cron-Alerts`) | `/api/alerts/run` — due/overdue alerts, daily digest (self-gated 08:00) | 30 min |
| Business rules (`-Cron-BusinessRules`) | `/api/business-rules/run` | 15 min |
| Reply-by-e-mail (`-Cron-EmailReplySync`) | `/api/email/inbound-sync` | 1 min |
| CSAT (`-Cron-Csat`) | `/api/csat/run` — reminders, auto-close of resolved tickets after the window | 30 min |
| System-log archive (`-Cron-SystemLogArchive`) | `/api/system-log/archive` | 6 h |
| Log shipper (`-LogShipper`) | ships service log lines to the log ingest endpoint | 2 min |
| Approval reminders (`-Cron-ApprovalReminders`) | `/api/approvals/reminders` | daily 10:00 |
| Sheet masters [R1] (`-Cron-MastersSync`) | `/api/masters/sync` | **11:00, 15:00, 19:00** daily |
| Visit automation [R4] (`-Cron-Visits`) | `/api/visits/run` | 15 min |
| Intake classify (module off) | `/api/intake/cron/classify` | few minutes |

Every cron route returns a health envelope (`ok, processed, succeeded, failed, failures[]`), uses HTTP 502 on total failure and alerts the operator.

### 19.3 Release procedure (one feature per release)
1. Develop and test locally (type check, lint, unit tests, isolated-stack tests, production build).
2. Owner says "push <feature>". Take a fresh **database backup**; the database owner applies the release's **migration run sheet** (each migration in one transaction, recorded in `auth.schema_migrations`, with a prior-state check) and the PostgREST service is **restarted** so its schema cache sees new tables/columns.
3. Merge the feature branch to `main`, push, **build** (`build-for-deploy.ps1`, stamps a build id; `NEXT_PUBLIC_*` baked in), copy the zip to the app server, stop service, swap folder, keep the previous folder as rollback, copy `.env.local` back, start, verify `/api/health` and `/api/version`.
4. Admin steps for that release (connect Google, paste sheet links, switch category flags, add secrets, install scheduled tasks).
5. **Rollback**: swap folders back; every release migration has a rollback SQL; app rollback never reverses data changes.
Each feature is its own branch (`push/1-…` … `push/6-…`), merges cleanly in any order, and ships with its own run sheet and rollback.

### 19.4 Backups and restore
Nightly `pg_dump -Fc` with `pg_restore --list` integrity check, 30 days kept, log checked after DB changes; attachments on the NAS (snapshots by the NAS). The dump does **not** contain database-level settings or Vault secrets: after a restore re-create the database settings (`search_path`, `app.vault_key`) and re-enter the mailbox password and Google connection. **Refresh of a developer copy** uses a read-only data-only dump of the `public` tables with sensitive tables excluded (no auth/password hashes, no mail settings, no intake contents, no logs) plus a two-column list `id, e-mail` of logins; passwords are replaced by one local test password.

### 19.5 System Log (observability + audit)
`system_log` (append-only; categories `audit` 7 years, `security` 7 years, `error` 180 days, `event` 180 days, then moved to `system_log_archive`, never dropped). Rows record `actor_id`, `actor_role`, `entity_type/id/label`, `before_data/after_data`, `severity`, `outcome`, `error_code`, `stack`, `fingerprint` (groups repeats), `request_id`/`correlation_id`, `path`, `ip`, `from_click/click_target`, `prev_hash`/`row_hash`/`chain_seq` under a locked head row. Database triggers write audit rows for ~45 business tables; the app passes the acting user and request id with every write; client errors arrive through a log-ingest endpoint (secret-protected) and a log shipper reads service logs. If the database is down errors are **spooled to a local file** and retried. Screens: System Log (filters, grouped errors, **Verify integrity**, **Copy for Claude** — a redacted markdown bundle), Audit Log, Event Log. Exports are audited.

### 19.6 Health, versions, alerts
`/api/health` (DB latency), `/api/version` (build id), operator alert webhook (`OPERATOR_ALERT_WEBHOOK_URL`, de-duplicated). Post-reboot checklist: all services running, health OK, scheduled tasks ready with last result 0, an old attachment opens (proves file store access).

---

## 20. Testing strategy

- **Unit tests** (`vitest`, ~1,480): pure logic — SLA, breach, rules evaluation, validation, transitions, secrets, visit code and rules, sheet parsing and matching, mail rendering, access scoping, UI components with Testing Library. Local-only switches (`MAIL_SINK_DIR`, `MASTERS_DEMO_DIR`) are cleared by the test setup so they never change results.
- **Integration / VAPT tests** (`tests/vapt/*`, run **only** on the isolated stack through the gate): confidentiality and integrity exploits, authorisation of ticket actions, approvals separation, project/task/file privacy, permission matrix and rule limits, partial findings, concurrency and idempotency, multi-organisation isolation, onboarding and password enforcement, category-limited fields (Qty), sheet masters (parse, copy, routing per kind, reopen re-mail, failing mail), engineer visits (code, report, store answers, automatic resolution, reminders, parts/PO, access), performance at 500,000 tickets.
- **Release gates**: type check clean; lint 0 errors; all unit tests; the integration files that apply; a production build; for multi-feature work, all release branches merged together in several orders still pass.
- **Mocking rule**: external systems (mail, Google) are replaced by files or fixed rows; no test touches a real mailbox, real Google or any production address.
- **Manual UAT**: a checklist per role (requester, technician, manager, admin) and a walk-through per feature (see §23 acceptance list).

---

## 21. UX and design system

- **Shell**: left sidebar (collapsible) grouped *Analytics / Workspace / Admin*; top bar with global search (⌘K), theme toggle, notifications bell with unread count, profile; mobile bottom navigation with at most four primary items, the rest in a "More" sheet; a "new version available" bar.
- **Visual**: Tailwind 4 + shadcn/ui ("base-nova", neutral base), `lucide-react` icons, rounded cards (`rounded-xl border bg-card`), semantic colour tokens, light and dark themes, status badges with consistent colours, red styling for destructive actions, wrapped (not truncated) labels with tooltips, page max width ~100rem.
- **Patterns**: tables with sticky headers and horizontal scroll inside the card; searchable selects; two-per-row short fields; read-only fields rendered disabled; toast feedback (`sonner`); skeletons/loading states for every route; empty states with the next action; confirmations built into the page (no browser dialogs).
- **Language**: simple sentences, no jargon, same words everywhere ("Update from sheets now", "Hold due to Purchase from HO", "Send an engineer again"). Times in IST, 24-hour. Dates in e-mails include the year.
- **Accessibility**: labelled inputs, keyboard-reachable controls, sufficient contrast, tooltips never the only carrier of meaning.
- **Requester journey**: Home → New request (catalogue) → form → ticket page (conversation, details, history) → notifications → CSAT link. **Technician journey**: Home queue → ticket → Start Working → comment / waiting / hold / send for approval → resolve (note) → survey. **Store journey**: raise AC / genset / fixtures tickets, see AC visits, answer the engineer's report.

---

## 22. Reference configuration (seed data — the shape of what runs today)

**Services (14, all active)** with their technician group: HR (HR GROUP), LEGAL (LEGAL GROUP), ADMIN - AC (ADMIN GROUP), VM (VM GROUP), FINANCE-VENDOR CREATION (FINANCE GROUP), IT (IT Group), PO ADVICE (APPS) (PO APPS GROUP), PO ADVICE (GM) (PO GM GROUP), LP (LP GROUP), ADMIN REPAIR (ADMIN GROUP), L&D (L&D GROUP), BD (BD Group), FINANCE (FINANCE GROUP), ADMIN - REQUIREMENTS (NON TRADING) (ADMIN GROUP). Tagged sub-categories per service (approx.): HR 72, IT 75, VM 44, BD 53, ADMIN REPAIR 112, ADMIN - REQUIREMENTS 183, ADMIN - AC 16, PO GM 13, L&D 15, LEGAL 10, PO APPS 8, FINANCE 5, LP 3, VENDOR CREATION 1.

**Categories of note**: `ADMIN AC ISSUE` (OEM: AC), `GENSET-CUMMINS ISSUE` and `GENSET-MAHINDRA` (OEM: Genset; sub-categories by KVA: 25, 40, 62/62.5, 82/82.5, 125, 160), `FIXTURES`, `FIXTURES-ATTACHMENT`, `HANGERS` (auto CVM approval; Qty field).

**SLA policies** (response / resolution hours; Urgent · High · Medium · Low):

| Policy | Urgent | High | Medium | Low |
|---|---|---|---|---|
| ADMIN AC, ADMIN REPAIR, ADMIN REQUIREMENT | 1/6 | 2/12 | 4/24 | 8/48 |
| HR, L&D, LEGAL, LP, VM | 1/6 | 2/12 | 4/24 | 6/48 |
| IT | 0.5/2 | 2/8 | 4/24 | 6/48 |
| FINANCE | 2/12 | 4/24 | 8/48 | 10/72 |
| VENDOR CREATION | 2/12 | 4/24 | 10/48 | 12/72 |
| PO APPS, PO GM | 2/6 | 3/12 | 6/24 | 10/48 |
| BD | 3/72 | 6/120 | 10/192 | 24/240 |

**Teams (11)** matching the groups above; **people**: ~550 logins (≈480 requesters incl. one login per store, ≈41 technicians, 2 managers, 2 platform owners); locations HEAD OFFICE and STORES; ~230 stores (code, name, address, cluster, region, priority list, opening date…).

**Business rules (38)**: one per technician per (service, category[, sub-category]) with a single `assign` action (direct), e.g. ADMIN REPAIR → five technicians, IT → six, VM → eleven, HR → four, plus single-owner services (Legal, L&D, LP, PO Apps, PO GM, BD, Admin AC, Admin Requirement) and team-level rules for Finance.

**Forms**: each service has its own form template; typical fields — Category, Sub category, Store address (auto), Contact number (10 digits), Subject, Description, Attachments (mandatory), plus service-specific fields (AC Serial Number [R1 dropdown from the AC sheet], Faulty/Repaired item quantity, vendor ticket date/number for repairs, **Qty** for fixtures).

**App settings keys** (examples): `auto_close_days` (3), `csat_enabled`, `csat_reminder_days` (2), `email_from_name`, `email_from_address`.

**Priorities**: low / medium / high / urgent with sort order and SLA multiplier. **Business hours** and **holidays** drive every SLA.

---

## 23. Build plan for a new application

Build in this order; each step is independently testable and shippable.

**Phase 0 — Foundations**: repository, Next.js 16 app shell, Supabase stack, CI of type check / lint / tests, design tokens, `proxy.ts`, supabase clients, secrets module, rate limiter, error sanitizer, logger, mail sink, health/version endpoints.
**Phase 1 — Identity and organisation**: organisations, profiles, roles, teams, org structure, users admin (invite, forced password change, bulk import), RLS helpers, module flags.
**Phase 2 — Catalogue and forms**: categories, sub-categories, services, form templates, field library, Section Builder, `DynamicForm`, validation shared client/server, snapshots.
**Phase 3 — Tickets**: `createRequestCore`, requests list/detail, comments, attachments (validated), collaborators, assignment, status machine (+ DB trigger), reopen, numbering, notifications (in-app), activity log.
**Phase 4 — SLA and rules**: business hours/holidays, SLA policies and field overrides, deadline engine with pause credit, breach logic, Business Rules engine and cron.
**Phase 5 — Approvals**: workflows, ad-hoc approvals, e-mail approve links with one-time codes, delegation, reminders, separation of duties.
**Phase 6 — E-mail**: SMTP settings + Vault, templates, notification rules, push, reply-by-e-mail sync with thread tags, CSAT flow.
**Phase 7 — Stores and master data**: store master + Excel upload; **Sheet Masters**: Google connection, parser, matching, removal brake, health page, AC dropdown, OEM routing + templates + snapshots, reopen re-mail, CVM sheet + automatic approval (Releases 1–3); hold status.
**Phase 8 — Reporting**: Home dashboard, Executive Dashboard, fixed Report Analytics, Report Builder, exports, saved/scheduled reports, AC / Genset master screens (Release 5).
**Phase 9 — Engineer visits**: visit code, public page, store answers, automatic resolution/reminders, parts and PO list (Release 4).
**Phase 10 — Hardening**: system log with hash chain, server-only writes migrations, ownership checks, CSP report-only, VAPT-style tests, load test at 500,000 tickets, backup/restore drill, isolation gate.
**Phase 11 — Optional**: Projects/Tasks, intake channels, WhatsApp (only with a Meta account), DeskTime (disconnected).

### Acceptance checklist (a new build is "done" when…)
1. A store login can raise an AC ticket, pick one of **its own Active ACs**, and an OEM mail (OEM in To, company people in CC, AC serial and details) appears; the ticket is *In Progress* with a public note of what was sent.
2. Reopening that resolved ticket sends a "REOPENED - …" mail to the same OEM.
3. A genset ticket sends one mail listing every genset row of the store; a fixtures ticket with Qty (1–10000) goes *Pending Approval* to the store's CVM and an approval mail is produced; the CVM can approve/reject by e-mail link with a one-time code.
4. The engineer page refuses a wrong code, accepts the right one, records per-AC results with FSR photos; the store's disagreement sends exactly one "send an engineer again" mail; silence resolves a "resolved" report after 48 h; parts needing a PO put the ticket on hold and on the parts list.
5. A sheet with a missing required column is **not applied** and the last good copy keeps working; a mass deletion waits ≥30 minutes; problems appear on the health page.
6. SLA deadlines respect business hours, pause on waiting/hold/approval and extend on resume; breach reports match the two defined formulas.
7. Status changes that the matrix forbids are refused even through a direct API call; a user with `must_reset_password` can do nothing else.
8. No e-mail leaves a dev environment; no secret appears in the repository, logs or screens.
9. Every release has a migration run sheet, a rollback, and its tests pass on the isolated stack with the gate green.

---

## 24. Open decisions and known gaps

| Item | State |
|---|---|
| Public address is plain HTTP | Accepted for now; HTTPS and a domain are planned (also removes the Google redirect restriction). |
| Reopen: should `response_due_at` restart? | Business decision pending; today only the resolution clock restarts. |
| Permission Matrix | Display-only; decide to wire up or remove. |
| `stores_select` role scoping | Business intent unconfirmed. |
| Intake e-mail module | Disabled for the organisation; residual hardening items listed in the audit register apply if enabled. |
| WhatsApp | Coded and tested, never connected (needs Meta assets). |
| DeskTime | Disconnected; tables and reports remain. |
| "Whole numbers only" for Qty | Number fields accept decimals; an `integer` option is proposed. |
| Remaining low-severity audit items | See the audit and remediation registers in `docs/` (e.g. reading-pane race in intake, send-as-mailbox ownership check, export scoping). |
| Postgres superuser password and forced password resets of ~460 accounts | Owner decided to leave open for now. |
| Automatic OEM mail on category change | Deliberately not sent (only on creation and reopen). |

---

## 25. Glossary of codes and terms

`CKSD-000385` ticket number · `IST` Indian Standard Time · `RLS` row-level security · `VAPT` vulnerability assessment and penetration test · `AMC` annual maintenance contract · `OEM` original equipment manufacturer · `CVM` store approver · `FSR` field service report · `PO` purchase order · `NSO` new store opening · `CKDESK number` the AC number inside a store · `Vault` encrypted secret store in the database · `service role` server-only database key that bypasses RLS · `mail sink` local folder that receives mails instead of sending · `isolation gate` the 21-check safety test that must pass before any integration suite runs · `release switch` the per-sheet boolean in `lib/masters/kinds.ts`.

*End of document.*
