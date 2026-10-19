# 01 — Current Architecture & Infrastructure (Citykart Desk / CKDesk)

*Audit date: 2026-10-13 · Repo `D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate` · branch `main` @ `e215ebd` · working tree: `.claude/settings.local.json` modified + scratch/untracked files (listed in `16-DEPLOYMENT-READINESS.md`).*
*Source of truth = the code and local configuration read during this audit. **No production system was contacted.***

Legend — **[C]** confirmed from source code / local config read in this audit · **[D]** documented (docs/CLAUDE.md/runbooks) but **not** verifiable without touching production · **[U]** unknown / cannot be resolved without production access (left unresolved on purpose).

---

## 1. Runtime topology

| Layer | What it is | Status |
|---|---|---|
| Web app | Next.js **16.2.9** App Router (React 19.2.4), `output: 'standalone'`, server components + **52 files of server actions** (`'use server'`) + **21 route handlers** under `app/api/**`; **58 pages**. Request guard in `proxy.ts` (Next 16 "proxy", the successor to `middleware.ts`). | [C] |
| Data access | **The app never opens a Postgres connection.** Every read/write is HTTP through `@supabase/supabase-js` (service-role client `lib/supabase/admin.ts`, per-user SSR client `lib/supabase/server.ts`, browser client `lib/supabase/client.ts`) → PostgREST. Calls go through `lib/supabase/resilient-fetch.ts` (20 s timeout, 2 retries on socket-level errors only). | [C] |
| Auth | Supabase Auth (GoTrue) — email + password; session cookies via `@supabase/ssr`; `proxy.ts` calls `supabase.auth.getClaims()` per request and redirects anonymous users to `/login`. Roles (`user_role` enum): `user, agent, manager, admin, platform_owner`. | [C] |
| Database | PostgreSQL via Supabase stack. **156 migrations** in `supabase/migrations`; 102 tables in `public`, **all with RLS enabled, 221 policies**, 72 functions (31 `SECURITY DEFINER`), 32 triggers, 338 indexes (counts measured on the freshly-migrated audit database). | [C] |
| Files | Supabase Storage, buckets `request-attachments`, `task-attachments`, `intake-attachments` (private) and `icons` (public). Authorized download goes through app routes `/api/storage/attachment/request/[id]` (+`/preview`) and `/api/storage/attachment/intake/[id]`; a public proxy `/api/storage/public/[bucket]/[...path]` exists for the `icons` bucket. Upload rules in `lib/attachments/validate.ts` (25 MB cap, MIME allow-list). | [C] |
| Background work | No queue/worker inside the web app. Scheduled jobs are **HTTP calls to the app** authenticated with `CRON_SECRET` (`lib/cron-auth.ts`, constant-time compare): `/api/alerts/run`, `/api/business-rules/run`, `/api/email/inbound-sync`, `/api/csat/run`, `/api/desktime/sync`, `/api/intake/cron/classify`. Runner: `scripts/cron-tick.mjs`; Windows Task Scheduler installer `scripts/windows/install-cron-tasks.ps1` (jobs: Alerts 30 min, BusinessRules 15 min, EmailReplySync 1 min, Csat 30 min). | [C] (schedules also [D]) |
| Outbound email | `lib/email/*`. Priority: mailbox saved in the DB (`email_smtp_settings`, password encrypted in `vault.secrets`) → `SMTP_*` env → Resend (`RESEND_API_KEY`) → **otherwise disabled; every send is a logged no-op** (`lib/email/config.ts`). | [C] |
| Inbound email | Reply-by-email sync (`lib/email/inbound.ts`, `imapflow` + `mailparser`) driven by `/api/email/inbound-sync`; intake channels for Gmail/Outlook via OAuth + webhooks (`lib/intake/*`, `/api/intake/webhook/gmail|outlook`, `/api/intake/oauth/*`). A separate **`api/`** Express service (`citykart-api`, IMAP poller/classifier, Railway-era) exists in the repo; whether it is deployed in production today is **[U]**. | [C]/[U] |
| WhatsApp | Meta WhatsApp Cloud API: webhook `/api/intake/webhook/whatsapp` (X-Hub-Signature-256 verification, `lib/whatsapp/signature.ts`), outbound via `lib/whatsapp/graph-client.ts` → `graph.facebook.com`. Channel + credentials resolved from DB (`intake_channels`, `vault` via RPC `intake_read_credential`) — **not** from env. | [C] |
| Push / other | Web-push (VAPID; no-op unless both keys set), Desktime time-tracking sync (`lib/desktime`, external API), OEM auto-routing emails (`oems`, sent through the same email sender), CSAT survey links (signed links, `CSAT_LINK_SECRET`). | [C] |
| Edge / proxy / TLS | Not part of this repo's runtime. Production is documented as plain **HTTP** on 3210 behind a router NAT; **no TLS** at the app. | [D] |
| Logging / monitoring | `console.*`; `lib/monitoring.ts` is a facade with a TODO for Sentry (**not wired**); client crash reports to table `error_reports`; `app_event_log` table; admin pages `/admin/monitoring`, `/admin/event-log`, `/admin/audit`. Optional `OPERATOR_ALERT_WEBHOOK_URL` for operator alerts. No central log shipping or alerting in code. | [C] |
| Rate limiting | `lib/rate-limit.ts` — in-process `Map` (resets on restart; per-instance only; its own comment says "replace with Upstash Redis for multiple replicas"). | [C] |
| Build / deploy | `scripts/windows/build-for-deploy.ps1` (stamps `CK_BUILD_ID`, builds to `.next-deploy`, zips the standalone output); manual copy + service swap on the server; rollback = rename folders back. DB migrations are applied **by hand by the user** on the DB server. `/api/version` + `/api/health` for verification. | [C] (+[D] for the server-side steps) |

## 2. Production topology (documentation only — NOT touched)

From `CLAUDE.md` and `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` (status 2026-10-07) **[D]**: app server **10.0.1.98** (Windows services `CkDeskApp`, `CkDeskProxy`, `CkDeskAuth`, `CkDeskPostgrest`, `CkDeskStorage` via NSSM; Task Scheduler cron jobs), PostgreSQL 18 on **10.0.0.205** (database `ckdesk`, shared server), files on Synology NAS **10.0.0.25** (`CKAPPLICATIONS_DATA\CKDESK_DATA`, via SMB as `ckappuser`), public URL `http://182.72.84.10:3210`, nightly `pg_dump` 02:30 with 30-day retention, no off-server second copy yet. The old server 10.0.1.12 is **retired** and must not be used.
Everything in this section is **[D]**: it was deliberately *not* verified against the machines. Unresolved **[U]** items (would need production access, therefore left open): actual service status, firewall exposure of 3210/8443/5432, DB role grants on 205, NAS share permissions, backup success history, whether `api/` (Express intake worker) runs anywhere, TLS/HTTPS plans.

## 3. Local development topology (confirmed)

* Dev PC `10.0.0.47`. Dev stack = Supabase CLI project **`citykart_desk`** (containers `supabase_*_citykart_desk`; API :54321, DB :54322, Mail trap :54324, app :3210). Its database is a **copy of production-derived data** (≈1,012 profiles, ≈694 tickets, 214 stores; real store/staff mailbox domains) — see `02-LOCAL-ISOLATION-CERTIFICATION.md` §5. It was **not used** by this audit.
* `.env.local` (dev) points at `127.0.0.1:54321` / `localhost:3210`; no SMTP/Resend/OAuth/LLM values; no production address anywhere in effective configuration.
* GoTrue in the dev stack sends mail to the local mail trap (`GOTRUE_SMTP_HOST=supabase_inbucket_citykart_desk`); Storage = file backend on a Docker volume.
* Other, unrelated Docker projects run on the same PC (`ckam-build-*`, `ckgv_*`); they are out of scope and untouched.
* **Audit environment (new, disposable):** Supabase CLI project **`ckdesk_audit`** — API :55421, DB :55422, mail trap :55424, app :3310 — created from the repo's 156 migrations + `seed.sql`, with the egress guard. See report 02.

## 4. Application structure (confirmed)

`app/(auth)` login / forgot / reset · `app/(app)` shell with: `home`, `requests` (+`/[id]`, `/queue`), `services` (+`/[slug]`), `approvals`, `tasks`, `projects`, `intake/*`, `notifications`, `profile`, `dashboards` (+`/executive` Smart Dashboard), `reports/analytics` (Predefined Reports) and `reports/pivot` (Report Builder), `admin/*` (23 admin pages: users, teams, roles, services, categories, SLA, business rules, approvals, request config, master data/stores/OEMs, field library, form templates, KB, org, monitoring, event log, audit, reports, desktime, task config, runbooks, settings) · public-by-design routes: `approve/[token]`, `csat/[token]`, `/api/health`, `/api/version`, the cron endpoints and webhooks (self-authenticated: cron secret / worker secret / webhook token / HMAC). `proxy.ts` keeps an **exact-match allow-list** of 11 unauthenticated API routes.

Library layout: `lib/actions` (mutations), `lib/queries` (reads), `lib/reporting` (analytics/executive engines), `lib/sla`, `lib/rules` (business rules), `lib/approvals`, `lib/notifications`, `lib/email`, `lib/whatsapp`, `lib/intake`, `lib/conversations`, `lib/csat`, `lib/oems`, `lib/stores`, `lib/export`, `lib/import`, `lib/forms`, `lib/validation`, `lib/utils`.

## 5. Tests that exist today

`tests/unit` (92 files) · `tests/integration` (83 files; real local Postgres/Auth, file-serial) · `loadtest/` (persona-based load harness with an env guard) · earlier audits and reports (`docs/SYSTEM-AUDIT-2026-09-09.md`, `CITYKART-DESK-*-AUDIT/REGISTER*.md`, `STAGE_*_REPORT.md`) — treated as *claims to re-verify*, not as evidence.

## 6. Confirmed vs documented vs unknown — summary

| Question (from the brief) | Answer |
|---|---|
| 1 Hosting/runtime | [C] Next 16 standalone Node server; [D] NSSM Windows service on 10.0.1.98 |
| 2 App→DB | [C] HTTP via supabase-js → PostgREST/GoTrue/Storage; never direct SQL (except tests/psql tools) |
| 3 Auth/session | [C] Supabase Auth, cookies via `@supabase/ssr`, `getClaims()` in `proxy.ts` |
| 4 DB/schema/migrations | [C] Postgres, 156 migrations, RLS on all 102 tables; [D] prod migrations applied by hand, history in `auth.schema_migrations` |
| 5 File upload / NAS | [C] Supabase Storage API (file backend); [D] backend path is the NAS UNC share in prod; app code is storage-agnostic |
| 6 Email delivery/intake | [C] SMTP-from-DB / env / Resend, IMAP reply sync, Gmail/Graph intake; [U] which mailboxes are live |
| 7 WhatsApp | [C] Cloud API integration present; [D] channel state in prod DB; [U] whether live |
| 8 Scheduled jobs | [C] cron endpoints + runner; [D] Task Scheduler on 98 |
| 9 Notifications | [C] in-app (`notifications` table + `/api/events`/`/api/notifications/new`), email, optional web-push |
| 10 Proxy/HTTPS | [D] HTTP only, router NAT, node reverse proxy for Supabase paths; [U] anything beyond |
| 11 Logging/monitoring | [C] console + DB tables; no APM/Sentry; [U] log retention on server |
| 12 Backup/restore | [D] nightly `pg_dump`, 30 days, no off-server copy; vault key/secret caveat documented; [U] actual success history |
| 13 Deploy/rollback | [C] build script; [D] manual swap/rename rollback, no automated pipeline |

## 7. Architecture observations to feed later phases (not yet findings)

1. The service-role key is used for most server work (`createAdminClient`) — authorization therefore lives in app code for those paths; RLS only protects the per-user client paths. → verify every server action authorizes before using the admin client (report 04).
2. Self-authenticating public routes (webhooks/cron) bypass session gating by design → verify secret checks, replay and idempotency (04/06).
3. Rate limiter is per-process memory; login brute-force protection depends on it and on GoTrue (04).
4. No TLS at the app layer in production (documented); session cookies / bearer tokens travel over HTTP on the LAN/Internet path (04, 16).
5. Observability gap (no error aggregation/alerts); single app instance; single DB; backups only on the DB host (10, 16).
6. The Supabase dev stack on the user's PC publishes DB/API ports on `0.0.0.0` (LAN-reachable) — applies equally to the audit stack (see 02).
