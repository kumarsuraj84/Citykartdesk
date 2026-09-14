# Citykart Desk — Complete Technical & Product Specification

**Purpose of this document**: this is a from-scratch rebuild specification. It documents what Citykart Desk *is*, exactly how it is built (tech stack, architecture, conventions), the complete database schema, the precise business logic of every subsystem, and the history of major fixes/enhancements applied to reach its current state. It is written so that another AI or engineering team, given only this file (plus the live database if available), could reconstruct the application faithfully — including its non-obvious behaviors and the reasons behind them.

Repo root referenced throughout: `Zoho Alternate` (a Next.js + Supabase monorepo, plus a standalone Express worker subproject under `api/`).

---

## Table of Contents

1. [What Citykart Desk Is](#1-what-citykart-desk-is)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Architectural Conventions](#4-architectural-conventions)
5. [Environment Variables](#5-environment-variables)
6. [Database Schema — Full Reference](#6-database-schema--full-reference)
7. [Auth & Authorization](#7-auth--authorization)
8. [Ticketing Core — Request Lifecycle](#8-ticketing-core--request-lifecycle)
9. [SLA System](#9-sla-system)
10. [Business Rules Engine](#10-business-rules-engine)
11. [Approvals](#11-approvals)
12. [Dynamic Form Builder](#12-dynamic-form-builder)
13. [Service Catalog](#13-service-catalog)
14. [Store Master + OEM Routing](#14-store-master--oem-routing)
15. [Notifications](#15-notifications)
16. [Email](#16-email)
17. [Web Push](#17-web-push)
18. [Email Intake (Ticket Creation from Incoming Mail)](#18-email-intake-ticket-creation-from-incoming-mail)
19. [Report Builder (Pivot / Table Reports)](#19-report-builder-pivot--table-reports)
20. [Projects / Tasks / Milestones](#20-projects--tasks--milestones)
21. [Admin Area — Screen by Screen](#21-admin-area--screen-by-screen)
22. [Cron / Scheduled Jobs & Deployment](#22-cron--scheduled-jobs--deployment)
23. [Development History — Fixes & Enhancements Applied](#23-development-history--fixes--enhancements-applied)
24. [Known Gaps / Open Items](#24-known-gaps--open-items)
25. [WhatsApp Conversational Intake Channel](#25-whatsapp-conversational-intake-channel)
26. [Hosting & Deployment Status — Local vs. Hosted](#26-hosting--deployment-status--local-vs-hosted)
25. [Additional Remediation Pass — Observability, Data-Integrity & UI Fixes](#25-additional-remediation-pass--observability-data-integrity--ui-fixes)
26. [Git History — Development Eras](#26-git-history--development-eras)
27. [QA & UAT Ticket History](#27-qa--uat-ticket-history)

---

## 1. What Citykart Desk Is

Citykart Desk is an internal **ITSM / helpdesk platform** for Citykart (a retail chain) — a single-tenant deployment (one seeded organization, "CityKart") built on a **multi-tenant-capable** schema (every business table carries `org_id`, RLS enforces org isolation, but there is no self-serve signup or second org in production use today).

Core capabilities:
- **Ticketing**: employees raise requests against a curated **Service Catalog** (IT Support, HR Support, Finance & Accounts, Vendor Creation, Legal, L&D, BD Support, etc.), each with its own **dynamic, admin-built form** (section/field builder — text, dropdowns, dates, file uploads, and a special auto-filled "store address" field).
- **SLA management**: business-hours-aware response/resolution deadlines, resolved at three possible layers (field-level override → service's SLA policy → none), with pause/resume for waiting-on-user and pending-approval states.
- **Approvals**: single or multi-step, sequential or parallel ad-hoc approval workflows gating a ticket before work proceeds.
- **Business Rules engine**: no-code automation (auto-assign, re-prioritize, re-route, notify) triggered on create/update or on a schedule (SLA % elapsed, unassigned-for-N-minutes).
- **OEM auto-routing**: a *Citykart-specific* feature — a store's ticket can auto-email a mapped external vendor (OEM) the moment it's created, if the service and the requester's store are both configured for it.
- **Email Intake**: a full pipeline that ingests inbound email (Gmail/Outlook via OAuth+push or IMAP polling), classifies it with a rule-engine + optional LLM stage, and lets a human reviewer convert it into a real ticket/task/approval.
- **Projects & Tasks**: a lighter-weight work-tracking module (projects, milestones, tasks with custom fields), separate from but linkable to tickets.
- **Reporting**: an Excel-style drag-and-drop pivot/table report builder across five entities, with dynamic per-service custom-field columns, plus xlsx export.
- **Admin surface**: full org-structure management (departments, locations, cost centers, stores, OEMs), role-based access, SLA/Business-Rules/Notification-Rules configuration, audit logs, data retention policies.

---

## 2. Tech Stack

### Main app (`package.json`, root)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.2.9** | App Router, React Server Components + Server Actions. **This is not the Next.js most training data reflects — see the callout below.** |
| UI runtime | **React 19.2.4** / `react-dom` 19.2.4 | |
| Language | **TypeScript** `^5.9.3` | `next.config.ts` sets `typescript.ignoreBuildErrors: true` deliberately (migrations land before `types/database.ts` regenerates) |
| Styling | **Tailwind CSS 4** (`@tailwindcss/postcss`) + **shadcn/ui** (`components.json`: style `base-nova`, baseColor `neutral`, icons `lucide`) + `tw-animate-css` | |
| UI primitives | `@base-ui/react` (headless primitives) | |
| Icons | `lucide-react` | |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` | |
| Drag & drop | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | Used in the Report Builder for field/column ordering |
| Excel export | `exceljs` (server-side `.xlsx` generation) | Client downloads via base64 → Blob → object URL |
| Toasts | `sonner` | |
| Class utilities | `clsx` + `tailwind-merge` (`cn()` helper) | |
| Push notifications | `web-push` (VAPID) | |
| Supabase | `@supabase/supabase-js ^2.108.1`, `@supabase/ssr ^0.12.0` | Three client wrappers — see §4.1 |
| Testing | `vitest ^3.2.7`, `@testing-library/react`, `jsdom` | `npm run test` |
| Lint/typecheck | `eslint 9` + `eslint-config-next`, `tsc --noEmit` | `npm run lint` / `npm run typecheck` |
| CLI tooling | `supabase` CLI `^2.111.0`, `shadcn` CLI `^4.11.0` | dev dependencies |

**Database**: Supabase (Postgres). `supabase/config.toml`: `[db] major_version = 17` → **Postgres 17**. Local dev runs via Docker (Supabase CLI).

### Next.js 16 — "this is NOT the Next.js you know"

`AGENTS.md` (repo root) and `docs/ARCHITECTURE.md §0` both flag this explicitly, instructing any AI/dev to read `node_modules/next/dist/docs/` before writing Next.js code. Verified concrete differences:

- **`proxy.ts` replaces `middleware.ts`.** Edge middleware is an exported `proxy()` function in `proxy.ts` at the repo root. Creating a `middleware.ts` file will conflict and crash the server. Same `config.matcher` export convention as classic middleware.
- **Top-level `eslint` key removed from `next.config.ts`.** ESLint no longer runs as part of `next build`; linting is a fully separate step (`npm run lint`).
- **The `next` binary's `.bin` shim is broken on the targeted Node version.** Build must invoke `node node_modules/next/dist/bin/next build` directly, not `npm run build`/`npx next build`.
- Standard App Router conventions otherwise apply: Server Components, Server Actions, route groups (`(app)`, `(auth)`), `output: 'standalone'` build output for Docker.

### `next.config.ts` notable settings

- `output: 'standalone'` — self-contained server bundle for the Dockerfile.
- `devIndicators: false` — the dev route-info badge collided with the sidebar's own avatar.
- `turbopack.root` set explicitly.
- `experimental.staleTimes: { dynamic: 30, static: 180 }` — client router cache tuning; mutations bust it via `revalidatePath()` in server actions.
- `experimental.serverComponentsHmrCache: false` — off because it caches `fetch()` responses (including Supabase's internal REST calls) across HMR reloads, producing stale data during local schema/RLS iteration.

### The separate `api/` subproject

A standalone **Express** service (`type: module`, TypeScript via `tsx`/`tsc`), its own `Dockerfile` and `railway.toml` (deployed as a second Railway service, health check at `/health`).

**Why it's separate**: it runs **long-lived, stateful connections and polling loops** that don't fit a serverless/edge Next.js request lifecycle:
- `api/src/intake/imap.ts`, `graph-sync.ts`, `gmail-sync.ts` — IMAP (`imapflow`, `mailparser`) and Gmail/Microsoft Graph mailbox sync for Email Intake.
- `api/src/intake/poller.ts` — an in-process `setInterval` scheduler (`INTAKE_POLL_INTERVAL_MS`, default 5 min) that polls every active email channel, heals unclassified mail, and runs escalation catch-up.
- `api/src/intake/classify/` — LLM-based inbound-message classification (`@anthropic-ai/sdk`).
- `api/src/intake/smtp.ts` / `nodemailer` / `resend` — outbound mail for the intake flow.
- Express route surface (`api/src/intake/routes.ts`) mounted at `/intake`, invoked by the main app's server actions (`INTAKE_WORKER_URL` + `INTAKE_WORKER_SECRET`).

Next.js/Vercel-style hosting isn't well suited to always-on IMAP connections and interval-based polling — `api/` is the dedicated always-on worker for that job, talking to the same Supabase project via its own service-role credentials.

---

## 3. Project Structure

```
app/
  (auth)/                 /login, /forgot-password, /reset-password — no public signup
  (app)/                  authenticated product surface
    admin/                org-admin surface (users, teams, roles, org, departments,
                           locations, master-data, categories, services, request-config,
                           task-config, routing, approvals workflow builder, runbooks,
                           knowledge-base, monitoring, reports, audit, settings, desktime)
    home/, requests/[id]/, tasks/[id]/, approvals/, services/, notifications/,
    profile/, projects/, intake/
    layout.tsx             App shell bootstrap; deferred nav counts/notifications via Suspense
  api/                     Next.js Route Handlers
    admin/                 e.g. admin/audit (paginated activity feed)
    alerts/run             cron: due/overdue tasks, unassigned requests, daily digest
    business-rules/run     cron: SLA warnings/breaches, unassigned-for-N-minutes, etc.
    desktime/sync          DeskTime sync endpoint
    health/                DB connectivity/latency check
    intake/                webhook + OAuth callback + cron/classify endpoints

components/
  admin/, analytics/, forms/, home/, intake/, layout/, projects/, reports/, requests/,
  tasks/, ui/ (shadcn/ui primitives), ErrorBoundary.tsx

lib/
  actions/                 'use server' Server Actions (mutations)
    admin/                 admin-only actions: users, org, teams, roles, categories,
                            services, oems, business-rules, sla-matrix, sla-policies,
                            form-templates, task-config, workflows, desktime, audit,
                            notificationRules, icons, config, orgScopeGuard.ts
    intake/                 intake-module actions
  queries/                  read layer (RLS-scoped by default): admin, analytics,
                             approvals, attachments, desktime, notifications, profiles,
                             projectAnalytics, projects, reporting, requests, services,
                             taskAnalytics, tasks, workload, intake/
  reporting/                field-registry.ts, pivot-engine.ts, access.ts
  forms/                    options.ts, sections.ts, sla-draft.ts
  sla/                      business-hours.ts, breach.ts, matrix.ts, resolve.ts
  rules/                    evaluate.ts, actions.ts, run.ts
  notifications.ts          notify() — the fan-out entry point
  push/                     client.ts, send.ts
  email/                    config.ts, send.ts, notify-email.ts, templates.ts, escape.ts
  export/                   csv.ts, xlsx.ts, reports.ts
  validation/                formFields.ts, canned-responses.ts, notification-rules.ts,
                             request-transitions.ts, requests.ts, roles.ts, status-groups.ts
  constants/                 shared enums/labels/SSoT constants
  settings/                  reopenWindow.ts
  desktime/                  aggregate.ts, api.ts, sync.ts
  intake/                    autofill.ts, gmail-api.ts, graph-api.ts, oauth.ts, validate.ts
  attachments/               validate.ts (magic-byte validation, MIME allowlist)
  whatsapp/                  WhatsApp Cloud API channel
  cron-auth.ts, rate-limit.ts, activity.ts
  supabase/                   server.ts / client.ts / admin.ts — the three Supabase clients
  observability/, monitoring.ts, error-reporting.ts, secure-compare.ts, sources.ts, utils.ts

types/
  database.ts               generated Supabase types
  index.ts                  hand-written domain types

supabase/
  config.toml, migrations/ (137+ sequential SQL files), manual/, snippets/, seed.sql

api/                          standalone Express worker service — see §2

scripts/
  cron-tick.mjs               separate cron-runner process

docs/
  ARCHITECTURE.md, DATABASE.md, RAILWAY-DEPLOYMENT.md, plus point-in-time audit/UAT docs

public/                       icons, logos, sw.js (push service worker)

proxy.ts                      Edge middleware (NOT middleware.ts)
next.config.ts, tsconfig.json, vitest.config.ts, components.json, Dockerfile, railway.toml
AGENTS.md, CLAUDE.md          AI-agent operating instructions for this repo
```

---

## 4. Architectural Conventions

### 4.1 Server Actions pattern

Files under `lib/actions/**` begin with `'use server'` and export async functions called directly from client components or awaited from Server Components.

**Two Supabase clients, deliberately chosen per call:**
- **`createClient()`** (`lib/supabase/server.ts`) — cookie-bound, **RLS-enforced**. For anything that should be constrained by the logged-in user's own row-level-security policies.
- **`createAdminClient()`** (`lib/supabase/admin.ts`) — service-role key, **bypasses RLS entirely**. Reserved for server-only writes that legitimately need to cross RLS boundaries: append-only audit trails (`request_activity`/`task_activity`), `notifications`, approval state transitions, escalation events, admin CRUD, and the intake pipeline. "Never expose this client to the browser."

**Admin-role gating** — every admin action file defines its own local guard function at the top, e.g.:
```ts
async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Admin or manager role required.' }
  return { profile }
}
```
Variants exist per file: `requireAdmin()`, `requireAdminOrManager()`, `requireDeskTimeAdmin()`, etc. Every exported action calls its file's guard first and short-circuits on `.error`.

Module-level gating is centralized separately in `lib/actions/moduleGuard.ts` → `requireModuleEnabled(module)`: hiding a nav link does **not** stop a client from calling a disabled module's Server Action directly — the client bundle ships a callable reference to every `'use server'` export regardless of what the sidebar shows.

**Why `createAdminClient()` needs extra guarding**: bypassing RLS means role checks alone prove *who* the caller is, not that the *data they're pointing at* (a department id, a store id) actually belongs to their own org. That gap is closed by §4.2.

### 4.2 Org-scope guard — `assertRefsInOrg()` (`lib/actions/admin/orgScopeGuard.ts`)

```ts
export async function assertRefsInOrg(
  admin: AnyClient,
  orgId: string,
  refs: { table: string; id: string; label: string }[]
): Promise<string | null>
```

Called before any admin-client write that persists a foreign-key reference (department, location, cost_center, job_function, designation, store) onto a profile or record. For each `{table, id}` pair: `.select('id').eq('id', id).eq('org_id', orgId).maybeSingle()`, returns a human-readable error if the id doesn't resolve inside the caller's own org. Without it, nothing stops a caller (accidentally, via a stale client, or a tampered direct call) from wiring a profile/store to another org's department/location/manager/etc. by id. A related, narrower guard — `assertCanAssignRole()` in `lib/actions/admin/users.ts` — stops a plain `admin` from self-escalating to `platform_owner` (only an existing `platform_owner` may grant `admin`/`platform_owner`).

### 4.3 24-hour time format — enforced app-wide

`lib/utils.ts` is the single source of truth:
```ts
// 24-hour clock, no AM/PM — the standard for every time shown across the app.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
```
Paired with `formatRelativeTime(iso)` ("3h ago", "5d ago", falling back to `toLocaleDateString` past 7 days). Every displayed absolute timestamp routes through `formatDateTime()` — no AM/PM anywhere in the UI. Server-side time math (SLA business hours, cron day/hour gates) resolves against the `TZ` env var (`Asia/Kolkata`).

### 4.4 60-second in-memory settings cache — "cache success, not failure"

Two independent, structurally identical implementations:
- `lib/settings/reopenWindow.ts` → `getResolvedReopenWindowHours()`
- `lib/email/config.ts` → `getEmailFrom()`

Both use a module-level `{ value, expiresAt }` cache, 60,000ms TTL, and **only cache the success path**:
```ts
try {
  // ...DB read...
  cached = { value, expiresAt: Date.now() + CACHE_MS }
  return value
} catch {
  // DB unreachable — fall back to the default rather than failing the caller,
  // but deliberately don't cache it: a transient blip shouldn't silently
  // override a correctly configured value for the full 60s TTL.
  return DEFAULT
}
```
Intent: a bulk fan-out (e.g. one Business Rule emailing every manager) shouldn't hammer the DB per-send, but a transient DB blip must self-heal on the very next call. Treated as a house pattern for any future settings read of this shape.

### 4.5 Comment style convention

Doc comments explain **why**, not what, sitting directly above the non-obvious code they justify. Typical shape: state the rule in one line, explain the historical reason / the bug it prevents, cross-reference the sibling pattern it mirrors or deliberately diverges from. Section-divider comments use `// ── Label ──...` banners to break up long files into named groups.

### 4.6 Attachment / file upload security

`lib/attachments/validate.ts`:
- MIME allowlist explicitly **excludes `image/svg+xml`** — an SVG opened via a direct link can execute its embedded `<script>`, unlike one loaded through an `<img>` tag.
- `MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024` (25MB).
- **Magic-byte validation** — first bytes checked against known signatures per declared MIME type (JPEG `FF D8 FF`, PNG `89 50 4E 47`, GIF `47 49 46 38`, WEBP/RIFF, PDF `%PDF`, ZIP `50 4B 03 04`/`50 4B 05 06`, MP4 `ftyp` box). Office Open XML formats are ZIP-based, validated against the ZIP signature set.
- **Signed URLs with forced download** for intake attachments: `createSignedUrl(path, 300, { download: fileName })` forces `Content-Disposition: attachment` as defense-in-depth on top of upload-time checks, so an inbound attachment can never render inline (and execute, for an HTML/SVG part) even if it slipped through.

### 4.7 Rate limiting

`lib/rate-limit.ts` — a simple **in-process** (per-replica, `Map`-based) limiter, explicitly a stopgap ("replace with Upstash Redis in production with multiple replicas"). `rateLimit(key, limit = 5, windowMs = 60_000)`. Applied per logical scope key:
- `login:${ip}:${email}` — 10/60s
- `forgot:${ip}` — 5/5min
- `admin-invite-user:${profile.id}` — 10/60s (prevents a compromised admin session from being scripted into an email-bombing vector)
- `admin-password-reset:${profile.id}` — 10/60s, same rationale
- `whatsapp:msg:${orgId}:${from}` — 30/60s; `whatsapp:invalid:${orgId}:${from}` — 5/5min (separate tighter limiter for unregistered senders)

### 4.8 Multi-session / concurrency notes

- **Single-tenant, single-org by design today** — one seeded org; no owner portal, no self-serve signup — but the schema and `assertRefsInOrg`/org-scoping code are fully multi-tenant-capable.
- `proxy.ts` forwards a server-verified `x-verified-user-id` header (via `.set()`, not merge, so a client-forged copy is always overwritten) so `getCurrentProfile()` doesn't redo an auth round trip already done at the edge.
- `React.cache()` dedup for `getCurrentProfile()`/`getEnabledModules()` — per-request memoization.
- No optimistic-locking/version-column for concurrent ticket edits found; append-only `request_activity`/`task_activity` serve as the audit trail. Status updates instead use a `.eq('status', currentStatus)` race guard (see §8).

---

## 5. Environment Variables

### Supabase (required)
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project API URL; public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key; RLS-enforced client |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for `createAdminClient()` — server-only, never expose to the browser |
| `SUPABASE_URL` | Server-side-only alias of the URL |

### App (required)
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public base URL; builds absolute links in emails/notifications |
| `TZ` | Server timezone (`Asia/Kolkata`) — governs SLA business-hours math and cron gates |

### Cron / scheduled jobs
| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Shared secret (`lib/cron-auth.ts`) — `Authorization: Bearer <secret>` or `x-cron-secret: <secret>` |
| `CRON_TARGET_URL` | Used by `scripts/cron-tick.mjs` — the web service's base URL to ping |
| `CRON_JOBS` | Comma-separated job names for that `cron-tick` instance |

### Email
| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Gates `EMAIL_ENABLED` — presence enables outbound email via Resend |
| `EMAIL_FROM` | Fallback "From" when not configured in Admin → Platform Settings → Integrations |

### Web Push (referenced in code, not currently in `.env.example` — a gap to fill on rebuild)
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
| `VAPID_SUBJECT` | `mailto:` contact URI, defaults to `mailto:support@citykart.org` |

### Intake: worker & OAuth
| Variable | Purpose |
|---|---|
| `INTAKE_WORKER_URL` | Base URL of the standalone `api/` worker |
| `INTAKE_WORKER_SECRET` | Shared secret for app→worker calls (`x-intake-worker-secret` header) |
| `INTAKE_WEBHOOK_TOKEN` | Public webhook URL token (Gmail Pub/Sub, Outlook `clientState`) — falls back to `INTAKE_WORKER_SECRET`/`CRON_SECRET` if unset (should be rotated to its own value) |
| `INTAKE_POLL_INTERVAL_MS` | Worker's mailbox poll interval (default 300000 = 5 min; 0 disables) |
| `INTAKE_AUTO_ESCALATE` | `'false'` disables automatic escalation catch-up after each poll |
| `INTAKE_CLASSIFY_SINCE_DAYS` | Bounds backlog classification lookback |
| `OAUTH_REDIRECT_BASE_URL`, `OAUTH_STATE_SECRET` | OAuth callback plumbing |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Gmail channel |
| `GOOGLE_PUBSUB_TOPIC` | Gmail push-mode setup |
| `MS_OAUTH_CLIENT_ID` / `MS_OAUTH_CLIENT_SECRET` | Outlook/Graph channel |

### Intake: LLM classification
| Variable | Purpose |
|---|---|
| `INTAKE_LLM_PROVIDER`, `INTAKE_LLM_MODEL`, `INTAKE_LLM_BASE_URL`, `INTAKE_LLM_API_KEY` | Provider/model/endpoint/key |
| `INTAKE_LLM_MAX_RETRIES`, `INTAKE_LLM_MIN_INTERVAL_MS`, `INTAKE_LLM_MAX_BODY_CHARS` | Retry/rate/cost controls |
| `INTAKE_LLM_PRICE_IN_PER_M` / `INTAKE_LLM_PRICE_OUT_PER_M` | Cost accounting |

### Intake: WhatsApp
| Variable | Purpose |
|---|---|
| `META_GRAPH_API_VERSION` | Graph API version for WhatsApp (per-channel tokens live in Supabase Vault, not env) |

### `api/` worker only
| Variable | Purpose |
|---|---|
| `PORT` | Express server port (default 3001) |
| `NODE_ENV` | Standard Node env flag |

---

## 6. Database Schema — Full Reference

Source of truth: `types/database.ts` (Supabase-generated, **96 tables**), cross-checked against `supabase/migrations/*.sql` (140 files).

### 6.1 Multi-Tenancy & RLS Model

**Pattern**: nearly every business table carries `org_id UUID REFERENCES organizations(id)`. RLS is enabled on essentially all tables; policies follow `org_id = current_org_id()` scoping, layered with role/membership checks.

**Core SECURITY DEFINER helper functions** (all `STABLE`, `SET search_path = public`):

| Function | Returns | Logic |
|---|---|---|
| `current_org_id()` | `uuid` | `SELECT org_id FROM profiles WHERE id = auth.uid()` |
| `current_user_role()` | `user_role` | `SELECT role FROM profiles WHERE id = auth.uid()` |
| `current_user_team_ids()` | `uuid[]` | teams the caller belongs to, scoped to `current_org_id()` |
| `is_team_member(p_team_id)` | `boolean` | membership in `team_members`, joined to `teams.org_id = current_org_id()` |
| `is_agent()` | `boolean` | `EXISTS` in `team_members` for caller within org (hardened later to require org match — see §23) |
| `is_owner_org()` | `boolean` | caller is `admin` in an `organizations.is_owner = true` row (the platform's own meta-org) |
| `is_request_approver(p_request_id)` | `boolean` | caller is a `specific_user` step approver on that request's workflow, org-checked |
| `is_request_collaborator(p_request_id)` | `boolean` | caller present in `request_collaborators` |
| `has_module_access(p_module)` | `boolean` | checks `org_module_access` (true if caller has no org, i.e. platform owner) |
| `get_enabled_modules()` | `module_slug[]` | enabled modules for caller's org |
| `generate_request_no()` | `text` | sequence-based ticket numbering via `request_sequences` |

**Typical policy shape** (e.g. `requests`):
```sql
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  org_id = current_org_id()
  AND (requester_id = auth.uid() OR is_team_member(team_id) OR current_user_role() IN ('manager','admin'))
);
```
Admin/config tables follow `<x>_select` (org-scoped read) + `<x>_admin` (org-scoped, `role IN ('admin','manager'[,'platform_owner'])`) pairs. `platform_owner` was added later to several admin policies that had been missed.

**Global (non-org-scoped) tables** — intentionally shared/platform-level, no `org_id`: `app_settings`, `business_hours`, `holidays`, `request_priorities`, `task_priorities`, `task_statuses`, `sla_escalation_rules`, `retention_policies`, `request_sequences` (keyed by `prefix`, not org).

**Storage (Supabase Storage) buckets**, all private except `icons`:
| Bucket | Public | Size limit | Purpose |
|---|---|---|---|
| `request-attachments` | false | 10 MB | Ticket file attachments |
| `task-attachments` | false | 25 MB | Task file attachments |
| `intake-attachments` | false | 25 MB | Email/WhatsApp intake attachments |
| `icons` | true | 5 MB | Service/category custom icon images |

**Ownership/licensing layer**: `organizations.is_owner` marks the platform-operator's own org; `license_keys` + `org_module_access` gate feature modules (`module_slug` enum) per org with seat limits and validity windows; `user_role` includes `platform_owner`, superseding `admin`/`manager` in cross-org/owner-console contexts.

### 6.2 Core Identity / Organization

**`organizations`** — Tenant root. `slug` (unique), `status` (`org_status`), `seat_limit`, `trial_ends_at`, `desktime_connected_at`/`desktime_credential_ref`.

**`profiles`** — Extends `auth.users` 1:1. `role` (`user_role`), `org_id`, `employee_id`, `job_title`, `mobile_number`, `whatsapp_enabled`, `must_reset_password`, `manager_id` (self-FK). FKs: `cost_center_id→cost_centers`, `department_id→departments`, `designation_id→designations`, `function_id→job_functions`, `location_id→locations`, `store_id→stores`, `manager_id→profiles`, `org_id→organizations`.

**`teams`** — `prefix` (used in `request_no` generation), `slug`, `notification_email`. FKs: `department_id→departments`, `org_id→organizations`.

**`team_members`** — join table, `user_id↔team_id`, `is_lead` flag.

**`departments`** — hierarchical (`parent_id` self-FK). FK: `head_user_id→profiles`.

**`locations`** — `city`, `country`, `timezone`.

**`cost_centers`** — finance cost-center master, optional `department_id`.

**`job_functions`** — job function/track master.

**`designations`** — job title master.

**`custom_roles`** — org-defined role overlays on top of `base_role` (`user_role` value).

**`permission_overrides`** — per-org, per-`role_key`/`action_key` boolean permission override.

### 6.3 Retail-specific: Store / OEM

**`stores`** — `code` (unique per org, uppercased), `name`, `address`, `city`, `state`, `pincode`, `oem_id→oems` (nullable, `ON DELETE SET NULL`), `is_active`.

**`oems`** — `name`, `emails[]` (deduped/lowercased/trimmed on write), `email_subject_template`, `email_body_template` (`{{var}}`-style), `is_active`.

`services.auto_oem_routing` (bool) + `stores.oem_id` drive automatic routing (§14).

### 6.4 Ticketing Core

**`requests`** — the ticket entity, central table.
- `request_no` (human-readable, e.g. `TEAMPREFIX-0001`, via `generate_request_no()`/`request_sequences`)
- `status` (`request_status`), `priority` (`request_priority`), `pre_approval_status` (nullable, holds status while pending approval)
- `form_data` **JSONB** — submitted values keyed by form field `id`
- `form_schema_snapshot` **JSONB** — legacy flat `form_fields` snapshot at submission time
- `form_sections_snapshot` **JSONB** — section-based form snapshot at submission time; empty ⇒ fall back to `form_schema_snapshot`
- `source_metadata` **JSONB** — nullable, records origin when not created via the web form
- SLA timestamps: `response_due_at`, `resolution_due_at`, `responded_at`, `resolved_at`, `closed_at`, `waiting_since`, `paused_ms_total`, `reopen_count`, `reopen_deadline_at`
- `parent_request_id` — self-FK (split/sub-requests)
- `cancellation_reason`
- FKs: `assigned_to→profiles`, `category_id→service_categories`, `sub_category_id→service_sub_categories`, `intake_message_id→intake_messages`, `org_id→organizations`, `parent_request_id→requests`, `project_id→projects`, `requester_id→profiles`, `service_id→services`, `team_id→teams`

**`request_comments`** — `is_internal` flag hides from requester. FKs: `author_id→profiles`, `request_id→requests`.

**`request_activity`** — immutable audit trail. `action` (`activity_action` enum), `metadata` **JSONB** (shape varies by action).

**`request_attachments`** — soft-delete via `deleted_at`; `storage_path` (unique) into `request-attachments` bucket; `is_internal` flag; `comment_id` optional link.

**`request_collaborators`** — watchers on a request.

**`request_priorities`** — global lookup for 4 priority levels (display metadata: color/icon/display_order/sla_multiplier).

**`request_sequences`** — ticket-numbering counter, keyed by `prefix`.

**`request_time_entries`** — start/stop time-tracking entries.

**`related_requests`** — free-form linking (`link_type`, e.g. "duplicate", "related").

**`csat_surveys`** — post-resolution CSAT, 1:1 with a request. `rating`, `comment`, `sent_at`, `submitted_at`.

**`notification_rules`** — per-org, per-`event_type` channel toggles (`email`/`in_app`/`push`).

### 6.5 Service Catalog

**`service_categories`** — top-level category. `slug` unique per org.

**`service_sub_categories`** — sub-category under a category; own optional `sla_priority` (`request_priority`).

**`service_sub_category_tags`** — many-to-many: a service tagged to allowed sub-categories. **`UNIQUE (sub_category_id)`** — a sub-category can only be tagged to one service at a time.

**`service_location_tags`** — many-to-many: restrict a service's visibility to specific locations.

**`services`** — the service-catalog item.
- `form_fields` **JSONB** (legacy flat), `form_sections` **JSONB** (current, section-based)
- `visibility` (text) + `visibility_scope` **JSONB** — `{ audience: 'all'|'agents_only'|'specific_teams', team_ids?: string[] }`
- `default_priority` (`request_priority`), `auto_oem_routing` (bool), `keywords[]`, `status` (text: draft/review/published/retired), `version` (text)
- FKs: `approval_workflow_id→approval_workflows`, `backup_owner_id→profiles`, `escalation_policy_id→escalation_policies`, `org_id→organizations`, `owner_id→profiles`, `sla_policy_id→sla_policies`, `team_id→teams`, `template_id→form_templates`

**`form_templates`** — reusable form definition (`form_sections` **JSONB**). **No `form_fields` column.**

**`kb_articles`** / **`kb_article_services`** — knowledge-base article (draft/published/archived) tagged to services.

### 6.6 SLA

**`sla_policies`** — named, reusable SLA table mapped via `services.sla_policy_id`. `config` **JSONB**: `{ low?, medium?, high?, urgent?: { response_hours, resolution_hours } }`.

**`global_sla_config`** — per-org, per-priority fallback (`response_hours`, `resolution_hours`, `escalation_pct`).

**`field_sla_overrides`** — SLA override keyed by `(service_id, field_id, option_value)`. `sla_config` **JSONB** (single-priority tier). Written via RPC `upsert_field_sla_override(...)`.

**`sla_escalation_rules`** — global escalation tier config (`tier`, `trigger_pct`, `notify_roles[]`).

**`sla_escalation_events`** — fired-escalation audit log.

**`escalation_policies`** — org-defined, attachable via `services.escalation_policy_id`. `rules` **JSONB**: `{ after_minutes, action: 'notify_backup_owner'|'notify_manager'|'reassign_team_lead', notify_roles? }[]`.

**`alert_rules`** — threshold-based operational alerting, distinct from SLA escalation (`alert_type`, `entity_type`, `threshold_minutes`, `channels[]`, `notify_roles[]`, `notify_assignee`/`notify_requester`).

*(No separate SLA "pause ledger" table — tracked inline on `requests.paused_ms_total`/`waiting_since`.)*

### 6.7 Business Rules / Approvals

**`business_rules`** — no-code automation.
- `trigger` **text[]** — subset of `created`/`updated`/`schedule`
- `schedule_check`: `'sla_pct_elapsed' | 'unassigned_minutes' | null`, `schedule_threshold`: numeric
- `conditions` **JSONB** — array of `RuleCondition`
- `conditions_logic` — legacy top-level `'AND'|'OR'`
- `actions` **JSONB** — array of `RuleAction`
- `execution_order`, `last_assigned_index` (round-robin state)

**`business_rule_events`** — fired-rule audit log (idempotency guard).

**`assignment_rules`** — standalone auto-assignment rule, independent of `business_rules`.

**`approval_workflows`** — named multi-step chain, attachable via `services.approval_workflow_id`.

**`approval_workflow_steps`** — ordered step (`approver_type`: `specific_user`|`any_manager`, `approver_user_id` nullable).

**`approvals`** — instance of a workflow run against a request. `status` (`approval_status`), `current_step`.

**`approval_decisions`** — per-step decision (`decision`: approved/rejected, `step_order`, `comment`).

### 6.8 Tasks / Projects

**`projects`** — `priority` (P1/P2/P3), `status` (not_started/in_progress/blocked/done/cancelled). FKs: `created_by→profiles`, `functional_owner_id→profiles`, `owner_id→profiles`, `team_id→teams`.

**`milestones`** — same enums as projects, `percent_complete`, `sort_order`.

**`project_members`** — join table, user↔project, text `role`.

**`project_updates`** — status-update log (`update_text`, `blockers`, `percent_snapshot`, `update_date`).

**`project_activity`** — audit log.

**`tasks`** — `task_type` (`personal`|`team`), `status` (open/in_progress/done/cancelled), `priority` (low/medium/high). `source_metadata` **JSONB**. `parent_task_id` self-FK. FKs: `assignee_id→profiles`, `intake_message_id→intake_messages`, `milestone_id→milestones`, `project_id→projects`, `request_id→requests`, `team_id→teams`.

**`task_assignees`** — multi-assignee join.

**`task_comments`**, **`task_attachments`** (bucket `task-attachments`), **`task_activity`** (`task_activity_action` enum).

**`task_dependencies`** — DAG edges between tasks.

**`task_custom_fields`** / **`task_custom_field_values`** — team-scoped custom fields (`field_type`: text/number/date/dropdown/multi_select/checkbox).

**`task_templates`** / **`task_template_items`** — reusable task checklists.

**`task_priorities`** / **`task_statuses`** — global display/config lookups.

### 6.9 Intake (Email/Portal/WhatsApp/Teams/Slack/API → Ticket Pipeline)

**`intake_channels`** — configured inbound channel (`type`: email/portal/whatsapp/teams/slack/api; `status`: active/paused/error). `config` **JSONB**. `credentials_ref` (encrypted secret pointer).

**`intake_messages`** — raw normalized message. `status` (new/normalized/classified/in_review/actioned/rejected/duplicate). `headers`/`normalized` **JSONB**. `dedup_hash`.

**`intake_threads`** — groups related messages by `external_thread_key`. `status`: open/linked/closed.

**`intake_attachments`** — bucket `intake-attachments`, `scan_status`.

**`intake_classifications`** — one row per pipeline `stage` (rule/local_model/premium_ai/manual). `entities`, `evidence` **JSONB**. `suggested_priority`/`suggested_type`, `confidence`, `cost_microcents`, `latency_ms`, `model_version`.

**`intake_reviews`** — human review/triage queue, 1:1 with `intake_messages`. `suggested_*` + `final_*` fields, `state` (pending/in_review/approved/rejected/converted), `was_overridden`, `is_escalated`, `is_starred`. Links `created_request_id`/`created_task_id`/`created_approval_id`.

**`intake_rules`** — deterministic keyword/regex rules (Stage-1 classifier), org-authored.

**`intake_outbound`** — outbound reply log.

**`intake_notes`** — internal reviewer notes.

**`intake_pipeline_config`** — per-org singleton config (1:1 with `organizations`).

**`intake_audit_log`** — generic audit log for intake actions.

**`request_conversations`** — stateful, resumable conversational form-filling session (primarily WhatsApp). `state` (`conversation_state`: identified → awaiting_service → ... → completed/cancelled/expired). `answers` **JSONB**. `version` (optimistic concurrency, bumped via `commit_conversation_transition()` RPC). 1:1 with `requests` on completion.

**`conversation_attachments`** — files staged mid-conversation.

**`conversation_events`** — idempotency/processing ledger for inbound conversational events.

### 6.10 Notifications / Push

**`notifications`** — in-app feed row. `type` (`notification_type`, large enum). `metadata` **JSONB**, `link`, `archived_at`/`read_at`.

**`notification_preferences`** — per-user, per-`event_type` enabled flag.

**`notification_rules`** — per-org, per-`event_type` channel toggles (also §6.4).

**`push_subscriptions`** — Web Push subscription (`endpoint`, `p256dh`, `auth`).

### 6.11 Admin / Audit / Retention / Reporting / Platform

**`admin_audit_log`** — org-admin-scoped audit trail.

**`owner_audit_log`** — platform-owner-scoped, cross-org.

**`org_signup_requests`** — public self-serve signup queue (reviewed by platform owner).

**`org_module_access`** — per-org, per-`module_slug` feature flag (`seat_limit`, `valid_from`/`valid_until`).

**`license_keys`** — issued license key per org (`key_hash`, `modules[]`, `expires_at`, `revoked_at`).

**`app_settings`** — global key/value config store (no org scoping).

**`retention_policies`** — global, per `entity_type` (`retention_days`, `archive_after_days`, `purge_after_days`).

**`scheduled_reports`** — per-org scheduled report subscription.

**`error_reports`** — client/server error telemetry.

**`business_hours`** / **`holidays`** — global working-hours calendar and holiday list — feed SLA calculations.

**`ai_applications`** — per-org named AI application/integration toggles.

**DeskTime tables**: `desktime_app_logs`, `desktime_time_logs`, `desktime_project_map`, `desktime_sync_runs`. Credential storage: `organizations.desktime_credential_ref` + `org_read_desktime_key`/`org_store_desktime_key` RPCs.

### 6.12 Database Functions (RPCs) Summary

| Function | Purpose |
|---|---|
| `can_manage_collaborators(p_request_id)` | Permission check for editing `request_collaborators` |
| `can_view_project(p_project_id)` | Permission check for project visibility |
| `commit_conversation_transition(...)` | Atomic, optimistic-concurrency state transition for `request_conversations` |
| `current_org_id()` / `current_user_role()` / `current_user_team_ids()` | RLS identity helpers |
| `generate_request_no()` | Ticket number generator |
| `get_enabled_modules()` / `has_module_access(p_module)` | Module/licensing gate |
| `get_home_dashboard(...)` | Aggregated dashboard payload for the home screen |
| `intake_read_credential` / `intake_store_credential` | Encrypted credential access for intake channels |
| `is_agent()` / `is_owner_org()` / `is_request_approver()` / `is_request_collaborator()` / `is_team_member()` | RLS predicate helpers |
| `merge_request_form_data(p_request_id, p_patch)` | Partial JSONB merge-update into `requests.form_data` |
| `org_read_desktime_key` / `org_store_desktime_key` | Encrypted DeskTime credential access |
| `owner_delete_org(p_org_id)` | Platform-owner org deletion (cascades) |
| `retag_service_categories` / `retag_service_locations` | Atomic bulk-replace of a service's tags |
| `seed_default_sla_config(p_org_id)` | Seeds `global_sla_config` defaults for a new org |
| `upsert_field_sla_override(...)` | Upserts a `field_sla_overrides` row |

### 6.13 Enums — Exact Value Sets

| Enum | Values |
|---|---|
| `activity_action` | created, assigned, unassigned, status_changed, priority_changed, resolved, closed, reopened, cancelled, approval_requested, approved, rejected, comment_added, attachment_added, collaborator_added, collaborator_removed, reclassified, form_data_updated |
| `approval_decision_type` | approved, rejected |
| `approval_status` | pending, approved, rejected, cancelled |
| `approver_type` | specific_user, any_manager |
| `conversation_attachment_status` | received_reference, persisted, failed, staged, linked |
| `conversation_event_status` | processing, completed, failed |
| `conversation_state` | identified, awaiting_service, awaiting_issue_search, awaiting_subcategory, awaiting_description, collecting_fields, awaiting_file, review, submitting, completed, cancelled, expired |
| `custom_field_type` | text, number, date, dropdown, multi_select, checkbox |
| `intake_channel_status` | active, paused, error |
| `intake_channel_type` | email, portal, whatsapp, teams, slack, api |
| `intake_message_status` | new, normalized, classified, in_review, actioned, rejected, duplicate |
| `intake_pipeline_stage` | rule, local_model, premium_ai, manual |
| `intake_priority` | low, medium, high, urgent |
| `intake_review_state` | pending, in_review, approved, rejected, converted |
| `intake_thread_status` | open, linked, closed |
| `intake_work_type` | request, task, approval, ignore, informational |
| `kb_article_status` | draft, published, archived |
| `module_slug` | requests, tasks, approvals, services, time_tracking, analytics, integrations, intake, projects |
| `notification_type` | request_assigned, comment_added, approval_requested, approval_decided, request_resolved, request_closed, task_assigned, request_reopened, request_created, internal_note_added, request_reassigned, collaborator_added, collaborator_removed, approval_approved, approval_rejected, request_auto_closed, request_cancelled, priority_changed, status_changed, sla_warning, sla_breached, mentioned, request_unassigned, task_completed, milestone_due_soon, milestone_overdue, task_due_soon, task_overdue, daily_digest, business_rule_notification |
| `org_status` | trial, active, suspended, cancelled |
| `project_priority` | P1, P2, P3 |
| `project_status` | not_started, in_progress, blocked, done, cancelled |
| `report_frequency` | daily, weekly, monthly |
| `report_type_enum` | requests, tasks, approvals |
| `request_priority` | low, medium, high, urgent |
| `request_status` | pending_approval, open, assigned, in_progress, waiting_user, resolved, closed, cancelled |
| `task_activity_action` | created, assigned, unassigned, status_changed, comment_added, completed, reopened, cancelled |
| `task_priority` | low, medium, high |
| `task_status` | open, in_progress, done, cancelled |
| `task_type` | personal, team |
| `user_role` | user, manager, admin, agent, platform_owner |

**Evolution note**: `user_role` originally shipped as `('user','manager','admin')` and later gained `agent`/`platform_owner` via `ALTER TYPE ... ADD VALUE`. On a from-scratch rebuild, declare enums directly with the final value sets above — no need to replay the incremental history.

### 6.14 Key JSONB Shape Reference

Defined in `types/index.ts`:

- **`FormField`**: `{ id, type: FormFieldType, label, placeholder?, help_text?, required, order, options?: FormFieldOption[], validation?: {min?,max?,min_length?,max_length?}, requester_can_view?, requester_can_set?, semantic_role?: 'request_title'|'request_description'|null }`. `FormFieldType` = text/textarea/number/date/select/multiselect/checkbox/radio/email/phone/file/toggle/store_address.
- **`FormFieldOption`**: `{ value, label, children?: FormFieldOption[], is_active? }`.
- **`FormSection`**: `{ id, title, description?, order, collapsed_by_default?, fields: FormField[] }`.
- **`SLAConfig`**: `{ low?, medium?, high?, urgent?: SLATier }`, `SLATier = { response_hours: number|null, resolution_hours: number|null }`.
- **`VisibilityScope`**: `{ audience: 'all'|'agents_only'|'specific_teams', team_ids?: string[] }`.
- **`EscalationRule[]`**: `{ after_minutes, action: 'notify_backup_owner'|'notify_manager'|'reassign_team_lead', notify_roles?: string[] }[]`.
- **`RuleCondition[]`** / **`RuleAction[]`**: see §10.
- **`CustomFieldOption[]`**: `{ value, color? }[]`.
- **`ActivityMetadata`**: tagged union — `{from,to}` | `{assigned_to,assigned_to_name}` | `{priority_from,priority_to}` | `{comment}` | `{}`.
- **`requests.form_data`**: `Record<field_id: string, value: unknown>`, keyed by `FormField.id`.

### 6.15 Full Table List (96, alphabetical)

admin_audit_log, ai_applications, alert_rules, app_settings, approval_decisions, approval_workflow_steps, approval_workflows, approvals, assignment_rules, business_hours, business_rule_events, business_rules, conversation_attachments, conversation_events, cost_centers, csat_surveys, custom_roles, departments, designations, desktime_app_logs, desktime_project_map, desktime_sync_runs, desktime_time_logs, error_reports, escalation_policies, field_sla_overrides, form_templates, global_sla_config, holidays, intake_attachments, intake_audit_log, intake_channels, intake_classifications, intake_messages, intake_notes, intake_outbound, intake_pipeline_config, intake_reviews, intake_rules, intake_threads, job_functions, kb_article_services, kb_articles, license_keys, locations, oems, stores, notification_rules, push_subscriptions, milestones, notification_preferences, notifications, org_module_access, org_signup_requests, organizations, owner_audit_log, permission_overrides, profiles, project_activity, project_members, project_updates, projects, related_requests, request_activity, request_attachments, request_collaborators, request_comments, request_conversations, request_priorities, request_sequences, request_time_entries, requests, retention_policies, scheduled_reports, service_categories, service_sub_categories, service_sub_category_tags, service_location_tags, services, sla_escalation_events, sla_escalation_rules, sla_policies, task_activity, task_assignees, task_attachments, task_comments, task_custom_field_values, task_custom_fields, task_dependencies, task_priorities, task_statuses, task_template_items, task_templates, tasks, team_members, teams.

---

## 7. Auth & Authorization

### 7.1 Role hierarchy

Single Postgres enum `user_role`: `'user' | 'manager' | 'admin' | 'agent' | 'platform_owner'` (`profiles.role`, default `'user'`).

| Role | General capabilities | Report scope |
|---|---|---|
| **user** | Submit requests via the service catalog, track own requests, respond to CSAT surveys. No agent-queue/admin access. | `own` (requester_id = self) |
| **agent** | Handles requests assigned to their team; update status, comment (incl. internal notes), manage tasks, trigger SLA actions. | `agent` (assignee-or-requester) |
| **manager** | All agent capabilities + approval authority, full visibility across their teams, analytics, limited admin config. | `team` (all teams they belong to) |
| **admin** | Full access to all configuration — service catalog, SLA policies, routing rules, user management, platform settings, monitoring. | `all` |
| **platform_owner** | Super-admin, unrestricted, including owner-only portal features. | `all` |

Most admin screens gate on `['admin', 'manager', 'platform_owner'].includes(profile.role)`; a stricter subset (Categories, Services, Form Templates, SLA Policies, Projects, Monitoring) gate on `admin`/`platform_owner` only. This gating is duplicated per-page (`redirect('/login')` if no profile, `redirect('/home')` if role check fails) at the top of every `app/(app)/admin/**/page.tsx` — no centralized route-level middleware for role gating.

### 7.2 `profiles` — key columns (see also §6.2)

Team membership is a **separate** many-to-many table (`team_members`) — a profile can belong to multiple teams. `manager_id` (org-chart "who reports to whom") is deliberately distinct from Team membership: `hasSubordinates(userId)` drives whether a "My Team" view appears on `/requests`, independent of `teams`/`team_members` data.

`getCurrentProfile()` (wrapped in React `cache()`): resolves the current user id preferentially from the `x-verified-user-id` header `proxy.ts` already set after verifying the session for this exact request (avoids a second `auth.getUser()` round trip). Falls back to a real `getUser()` call only if that header is entirely absent.

### 7.3 Org-scope guard pattern

See §4.2 (`assertRefsInOrg`).

### 7.4 RLS pattern — Postgres helper functions

See §6.1. The `is_agent()`/`is_request_approver()` hardening: the original `is_agent()` was org-unscoped and used as an unguarded top-level `OR` clause in `approvals_select`/`comments_select` policies, safe only by an *application-level* invariant (approvers/teams are always org-scoped) with no DB constraint enforcing it. A later migration hardened the function itself to also require `org_id = current_org_id()`, closing the gap for every current and future policy that ORs it in — a fix at the shared-helper level rather than patching each call site.

---

## 8. Ticketing Core — Request Lifecycle

### 8.1 Status values (`request_status`)

`open | assigned | in_progress | waiting_user | pending_approval | resolved | closed | cancelled`. `TERMINAL_STATUSES = ['closed', 'cancelled']`.

### 8.2 Transition matrices (`lib/constants/request-transitions.ts`)

Single source of truth, imported by both server (`lib/actions/requests.ts`) and client (`StatusTransitionPanel.tsx`) — no local copies allowed.

```
AGENT_TRANSITIONS = {
  open:             ['cancelled'],
  assigned:         ['cancelled'],
  in_progress:      ['waiting_user', 'resolved', 'cancelled'],
  waiting_user:     ['in_progress', 'resolved'],
  pending_approval: [],
  resolved:         ['open'],
  closed:           [],
  cancelled:        [],
}
REQUESTER_TRANSITIONS = {
  open:             ['cancelled'],
  assigned:         [],
  in_progress:      [],
  waiting_user:     ['open', 'cancelled'],
  pending_approval: [],
  resolved:         ['open'],
  closed:           [],
  cancelled:        [],
}
```

Notes:
- **`open`/`assigned` → `in_progress` is deliberately absent** from both tables — reachable only through `updateRequestStatus()`'s special-cased `isStartWorking` path (the "Start Working" button/modal), forcing the mandatory first-response comment through the same code path so the generic status dropdown can never skip it.
- **`open` → `assigned`** happens only via `assignRequest()` (auto-promotes when an assignee is set), not through this matrix.
- `closed`/`cancelled` have zero outgoing transitions, except the narrow approval-rejection reopen exception (§8.7) handled outside the matrix.

### 8.3 Priority levels

`low | medium | high | urgent`. Default derivation in `createRequestCore()`:
```
priority = priorityOverride ?? subCategoryResolution.slaPriority ?? service.default_priority
```
`priorityOverride` is reserved for channels where a human already reviewed/confirmed the value (e.g. Email Intake post-review). On `updateRequestCategory()` (reclassify within same service), priority is re-derived from the new sub-category's `sla_priority` if present. On `reclassifyRequest()` (move to a different service), priority is left unchanged. On `changePriority()` (manual override), the sub-category is untouched so a later reclassify can still re-derive from it.

### 8.4 `createRequest()` → `createRequestCore()` flow

`createRequest()` (web-specific adapter): authenticates, resolves "book on behalf of" (agent/manager+ only, cross-checked against target's org_id/is_active), parses `form_data`, resolves `org_id` from the **requester's** profile, delegates to `createRequestCore()` (`lib/requests/create-request-core.ts` — shared across web, Email Intake, and future WhatsApp).

`createRequestCore()` steps:
1. **Service lookup** — scoped by `id + org_id + is_active=true`.
2. **Location-scoping check** (web only, `user` role) — if the service has location tags and the acting user's `location_id` isn't among them, treated as not found.
3. **Category/Sub-category resolution** — only `sub_category_id` accepted; `category_id` always derived server-side, validated against the service's tagged sub-categories.
4. **Form resolution** — `resolveServiceFormSections(service)` (template wins if tagged, else the service's own).
5. **Requester's store lookup** — any `store_address` field is force-overwritten with the store's address.
6. **Mandatory-field completion gate** — `validateRequesterFormCompletion()`.
7. **Title derivation** — priority: `text` → `textarea` → `select`/`radio` (with value) → `multiselect` (joined labels) → fallback `service.name`. A trusted `titleOverride` wins verbatim (sanitized ≤120 chars).
8. **Priority + SLA deadline computation** — `resolveSlaDeadlines()` from `now`.
9. **Team routing** — `service.team_id` by default; Email Intake may pass `teamIdOverride`.
10. **Insert into `requests`** with `request_no: ''` (rewritten by trigger), `service_id, category_id, sub_category_id, team_id, requester_id, org_id, title, description, priority, form_data, form_schema_snapshot, form_sections_snapshot, response_due_at, resolution_due_at, project_id, intake_message_id, source_metadata`.
11. **Business Rules `'created'` trigger** fires.
12. **Activity log** (`created`).
13. **OEM auto-routing** (§14).
14. **Notifications** — book-on-behalf-of requester notified; every `team_members` row of the target team notified (excluding acting user and requester).
15. Approvals are **never** auto-created here — only via explicit "Send for Approval"/ad-hoc actions.

### 8.5 `updateRequestStatus()` flow

1. Loads status, priority, requester_id, team_id, assigned_to, responded_at, waiting_since, response_due_at, resolution_due_at, resolved_at, form_data + snapshots, cancellation_reason, reopen_deadline_at, reopen_count, paused_ms_total.
2. Determines `isAgent` (manager/admin/platform_owner, or an agent on the request's team) and `isRequester`.
3. `agentInitiated` = normal AGENT_TRANSITIONS match **or** the `isStartWorking` special case.
4. Three special-case booleans bypassing the static matrix:
   - `isApprovalRejectionReopen`: requester, `cancelled → assigned`, `cancellation_reason === 'approval_rejected'`, `reopen_deadline_at` still future.
   - `isResolvedReopenByRequester`: requester (not agent-initiated), `resolved → open`.
   - `isResolvedReopenByAgent`: agent-initiated, `resolved → open`.
5. `canTransition = agentInitiated || (requester transition allowed) || isApprovalRejectionReopen`.
6. **Mandatory-comment enforcement**: requester-reopen requires the reopen window AND a comment; agent-reopen requires a comment; agent cancelling requires a comment; first entry into `in_progress` without `responded_at` requires a comment; entering `waiting_user` requires a comment; entering `resolved` requires a comment.
7. **Technician-mandatory field gate** (agent-initiated only): every `isTechnicianMandatory(f)` field that's empty must be filled before any transition. `store_address` fields always exempt.
8. Builds `updatePayload`: sets `resolved_at`/`closed_at` appropriately; on `cancelled` sets `cancellation_reason: 'manual'`; on `resolved` sets `reopen_deadline_at = now + reopenWindowHours` (admin-configurable, §8.6); successful reopen clears `cancellation_reason`/`reopen_deadline_at`, increments `reopen_count`; entering `waiting_user` sets `waiting_since = now`; leaving `waiting_user` computes `pausedMs`, extends due-dates, clears `waiting_since`, credits `paused_ms_total += pausedMs`.
9. **Race guard**: `.eq('status', currentStatus)` on the UPDATE (plus `.eq('requester_id', profile.id)` via admin client for the requester-reopen path, working around an RLS gap). Zero rows returned → "changed by someone else" error.
10. **Auto time-tracking**: entering `in_progress` opens a `request_time_entries` row; leaving it closes any open entry.
11. **CSAT survey** auto-created (upsert, dedup on `request_id`) on `resolved`.
12. **Reopen SLA recompute**: on any reopen, re-resolves `resolution_due_at` from **now**, resets `resolved_at/closed_at/waiting_since/paused_ms_total`.
13. Activity log: `status_changed` + a `reopened` entry (reason: `approval_rejected`|`unsatisfied_with_resolution`|`agent_reopened`) for any reopen.
14. Notifications per new status; assignee notified on reopen (deduped against requester notification).
15. Optional public comment insert.
16. Business Rules `'updated'` trigger fires.

### 8.6 Reopen window mechanism (`lib/settings/reopenWindow.ts`)

`getResolvedReopenWindowHours()`: reads `app_settings.auto_close_days` (integer days → hours). Fallback default: **3 days (72 hours)** if absent/invalid/unreachable (DB errors not cached). 60-second cache (see §4.4 pattern). Governs both `updateRequestStatus()`'s requester-reopen deadline check and the Business Rules `set_status` action's resolve path. **Not** used for the approval-rejection reopen window (§8.7).

### 8.7 Approval-triggered reopen (separate, fixed window)

`rejectApproval()`: sets `status: 'cancelled'`, `cancellation_reason: 'approval_rejected'`, `reopen_deadline_at = now + 48 hours` — a **hard-coded**, deliberately un-configurable window (an honest mistake on rejection reads differently from "not satisfied with resolution"). `updateRequestStatus()` recognizes this via `isApprovalRejectionReopen`, letting the requester move `cancelled → assigned` (back to the same technician) within the window.

### 8.8 Collaborators, comments, attachments, CSAT (brief)

- **Collaborators**: `addCollaborator()` — agent/manager+ only, must be on the request's team, target must exist in-org, cannot duplicate the assignee. Notifies collaborator.
- **Comments**: `addComment()`. Internal notes agent-only. First public agent comment sets `responded_at`. Notifies the request audience. Parses `@mentions`. A requester's non-internal reply while `waiting_user` **auto-transitions to `in_progress`** and extends SLA deadlines. `deleteEmptyComment()` lets the author delete their own empty comment.
- **Attachments**: `request_attachments.comment_id`/`request_id`.
- **CSAT**: auto-created on resolve; `submitCsatRating()` scoped to `requester_id = caller`, only once.

### 8.9 OEM auto-routing — `runOemAutoRouting()`

See §14.3 for full detail.

---

## 9. SLA System

### 9.1 Deadline computation — business-hours aware (`lib/sla/business-hours.ts`)

- `computeSLADeadline(startAt, slaDurationMinutes)`: walks the configured `business_hours` (per `day_of_week`) and `holidays` calendar day-by-day, consuming each day's business window until the minute budget is exhausted. Uses **local time** consistently. Safety bound: 366×5 days. Returns **`null`** (not a far-future fallback) if the calendar has no usable window at all — logs an error and alerts an operator.
- `computeElapsedBusinessMinutes(startAt, endAt)`: inverse operation, sums business minutes actually elapsed (used by the "% of SLA elapsed" schedule check so a deadline spanning a weekend doesn't overstate elapsed time).
- Calendar cached per-request via React `cache()`.

### 9.2 SLA layers (`lib/sla/matrix.ts`, `lib/sla/resolve.ts`)

Two layers only (no org-wide default layer in the resolution path — `global_sla_config` exists in schema but the resolution function doesn't fall through to it in the documented flow):

1. **Service's mapped SLA Policy** — `services.sla_policy_id → sla_policies.config`.
2. **Field-level override** (`field_sla_overrides`, most specific) — keyed `(service_id, field_id, option_value)`.

`resolveFieldSlaTier()`: only considers `select`/`multiselect`/`radio` fields; if multiple selected options each carry an override, the **tightest (minimum) hours wins independently** for response and resolution.

`resolveSlaDeadlines({ serviceId, priority, servicePolicyConfig, allFields, formData, from })` — single source of truth used by `createRequestCore`, the REOPEN branch of `updateRequestStatus`, `changePriority`, `reclassifyRequest`, `updateRequestCategory`, and the Business Rules `set_priority`/`set_status` actions:
```
fieldTier = resolveFieldSlaTier(...)
responseHours   = fieldTier?.response_hours   ?? policyTier?.response_hours   ?? null
resolutionHours = fieldTier?.resolution_hours ?? policyTier?.resolution_hours ?? null
```
Hours clamped `>= 0`. Each non-null value passed through `computeSLADeadline`.

`getFieldSlaMatrix()`: flattens the whole catalog to one row per `(service, option-bearing field, leaf option value, priority)` for the admin UI. `getFieldIdsWithSlaOverrides(serviceId)` supports a form-builder warning before deleting a field with matrix overrides.

Sub-categories carry only an `sla_priority` label (feeds the `priority` parameter) — not their own hours; no third SLA layer at the sub-category level.

### 9.3 Breach detection (`lib/sla/breach.ts`)

Two distinct, deliberately separate formulas:

- **`isCurrentlyBreached(row, now)`** — "live ops" view: `resolution_due_at` set, status not in `['resolved','closed','cancelled']`, and `resolution_due_at < now`. Stops counting once resolved/closed.
- **`isEverBreached(row, now)`** — "ever breached / resolved late" / historical-compliance view: if resolved/closed, breached iff that timestamp is **after** `resolution_due_at` — permanent once true. If still open, same live condition.
- **`isEverResponseBreached(row, now)`** — same "ever" shape for the first-response SLA.

The Business Rules engine's own `isSlaBreached()` implements the "ever breached" formula inline.

### 9.4 Pause-credit ledger

`requests.paused_ms_total` (running total ms) plus any currently-active `waiting_since` together form the "pause credit." Any place that **recomputes** SLA deadlines from `created_at` (priority change, category/service reclassify) must apply this credit on top of the fresh baseline, or it silently discards every previously-completed pause. Helper `withPauseCredit(dueAtIso, pausedMsTotal, currentlyWaitingSince)`:
```
creditMs = Number(pausedMsTotal ?? 0) + (currentlyWaitingSince ? now - currentlyWaitingSince : 0)
return dueAtIso ? new Date(new Date(dueAtIso).getTime() + creditMs).toISOString() : null
```
Used by `changePriority()` and `reclassifyRequest()`/`updateRequestCategory()`; identical inline logic replicated in the Business Rules `set_priority` action. On any **reopen**, the ledger resets to 0 — a new SLA clock. `waiting_user` and `pending_approval` (approval holds) both accrue into this same ledger.

---

## 10. Business Rules Engine

### 10.1 Anatomy of a rule (`business_rules` table)

- `trigger`: array — `'created' | 'updated' | 'schedule'` (a rule can fire on multiple).
- `conditions`: `RuleCondition[]`, each `{ field, form_field_id?, operator, value?, logic? }`.
- `conditions_logic`: `'AND' | 'OR'` (legacy/fallback).
- `actions`: `RuleAction[]`.
- Schedule-trigger rules only: `schedule_check`, `schedule_threshold`.
- `last_assigned_index` — round-robin cursor.

**Condition fields**: `priority, status, service_id, category_id, sub_category_id, template_id, team_id, project_id, assigned_to, requester_id, requester_role, requester_department_id, requester_location_id, requester_designation_id, requester_function_id, title, description, source_channel, is_sla_breached, has_attachment, age_days, form_field` (reads `form_data[form_field_id]`).

**Operators**: `equals, not_equals, contains, not_contains, is_empty, is_not_empty, in, gt, gte, lt, lte`. Array-valued raw fields match per-element for `contains`/`equals`/`in`.

**Per-condition logic** (`matchesConditions()`): each condition (after the first) carries its own `logic` connector to the previous one. AND-connected conditions form a group; an OR starts a new group — `[X, Y(AND), A(OR), B(AND)]` evaluates as `(X AND Y) OR (A AND B)` (sum-of-products, left-to-right). No own `logic` falls back to `conditions_logic`. Empty `conditions` array matches every request.

### 10.2 The consolidated engine

**One** table, **one** evaluation+action pipeline covers what used to be separate Routing/Escalation/Alert rule types — differentiated purely by trigger and actions. No separate code path per "rule type."

### 10.3 Action types (`lib/rules/actions.ts`)

- **`assign`** `{ strategy: 'direct'|'round_robin'|'load_balanced', assigneeIds }` → `runAssign()`.
- **`set_priority`** `{ priority }` → `runSetPriority()`.
- **`set_status`** `{ status }` → `runSetStatus()`.
- **`set_team`** `{ teamId }` → `runSetTeam()`.
- **`notify`** `{ roles, notifyAssignee, notifyRequester, channels: ('in_app'|'email')[] }` → `runNotify()`.

`executeActions()` runs every action in order; one action's failure is logged and doesn't stop the rest.

### 10.4 `runAssign()` — exact behavior

```
direct:        chosenId = assigneeIds[0]
round_robin:    reads last_assigned_index, picks assigneeIds[index % length], writes back (index+1) % length
load_balanced:  counts each candidate's current non-terminal assigned request count, picks the lowest
```
Verifies `chosenId` is a member of the request's team — **skips assignment entirely** if not (logs to console, no error surfaced), preventing an orphaned ticket assigned to someone with no RLS visibility.

If proceeding: `UPDATE requests SET assigned_to = chosenId` (admin client, **direct write, bypassing `assignRequest()`**), logs an `assigned` activity (`via: 'business_rule'`), sends in-app notification.

**Confirmed: `runAssign()` touches ONLY `requests.assigned_to`.** Never sets/changes `status` — the `open → assigned` auto-promotion `assignRequest()` performs interactively is **not replicated here**; a rule-assigned ticket keeps its existing status (e.g. stays `open`).

### 10.5 Other actions

- **`runSetPriority()`**: recomputes due-dates via `resolveSlaDeadlines()` under the new priority (mirroring `changePriority()`), applies pause-credit math inline, logs `priority_changed` (`via: 'business_rule'`).
- **`runSetStatus()`**: mirrors nearly all of `updateRequestStatus()`'s bookkeeping for a raw status write — resolved_at/closed_at/cancellation_reason per target; on `resolved` stamps `reopen_deadline_at`; on `open` from resolved/closed clears and, if a genuine reopen, bumps `reopen_count`; extends due-dates + credits pause ledger leaving `waiting_user`; upserts CSAT on resolve; stops open time-entries leaving `in_progress`. Guards against an invalid status string.
- **`runSetTeam()`**: `UPDATE requests SET team_id`; no-ops if falsy; logs `reclassified`.
- **`runNotify()`**: builds recipients from `notifyAssignee`/`notifyRequester`/`roles`, sends in-app and/or email per `channels`; if **all** recipients fail email, escalates via `alertOperator()` (deduped per rule).

### 10.6 Schedule-based triggers (`app/api/business-rules/run/route.ts`)

`GET`, authenticated via `verifyCronSecret()`. For every active rule with `trigger` containing `'schedule'`:

- **`sla_pct_elapsed`**: for every non-terminal request with a `resolution_due_at`, `pctElapsed = computeElapsedBusinessMinutes(createdAt, now) / computeElapsedBusinessMinutes(createdAt, deadlineAt) * 100` (falls back to raw wall-clock ratio if the business-minutes total is 0). Fires when `pctElapsed >= schedule_threshold`.
- **`unassigned_minutes`**: for every non-terminal, unassigned request created before `now - schedule_threshold minutes`, fires the rule.

**Idempotency**: `fireRule()` checks `business_rule_events` (`rule_id, request_id`) before evaluating — never double-fires the same rule against the same request across cron ticks.

Response: `{ ok, fired, processed, succeeded, failed, failures[] }`; a total failure alerts an operator and returns HTTP 502.

---

## 11. Approvals

### 11.1 Tables

- **`approval_workflows`** — named workflow, optionally bound via `services.approval_workflow_id`.
- **`approval_workflow_steps`** — ordered (`step_order`, `approver_type`, `approver_user_id?`).
- **`approvals`** — one row per approval round. No unique constraint on `request_id` (multiple sequential rounds allowed) but only one **pending** at a time (partial unique index as a race backstop).
- **`approval_decisions`** — one row per approver's decision.
- `requests.pre_approval_status` — remembers the ticket's status (`in_progress` or `waiting_user`) before submission, so a full approval resumes there.

### 11.2 Sequential vs. parallel ("ad-hoc")

- **Sequential** (`submitForApproval()`): `current_step` starts at the first step; advances one at a time as each is approved.
- **Parallel/ad-hoc** (`sendAdHocApproval(requestId, approverIds[])`): creates a throwaway `approval_workflows` row (one step per approver, all `specific_user`), sets `current_step = 0` as the sentinel for parallel mode — every approver acts independently; released only once **all** steps have an `approved` decision.
- `submitForApproval()` hard-fails if the workflow has **zero configured steps** — rather than parking the ticket forever with no approver ever notified.
- Both entry points block if status already in `resolved/closed/cancelled/pending_approval`; ad-hoc additionally blocks `open`/`assigned`.

### 11.3 Submission effects

Both entry points: `status = 'pending_approval'`, `pre_approval_status = <status before submission>`, `waiting_since = waiting_since ?? now` (SLA pause). Logs `status_changed` + `approval_requested`. Notifies the resolved first-step approver(s).

### 11.4 Delegation

`delegateApproval(approvalId, newApproverId)`: only the current designated approver may delegate. Validates target is `is_active` and same `org_id`. Rewrites the step's `approver_user_id`/`approver_type = 'specific_user'`, archives outgoing approver's notification, logs `assigned` activity, notifies the new approver.

### 11.5 Approve (`approveApproval`)

Records decision, archives caller's own notification. Determines `isLastStep` (parallel: every step decided; sequential: reached the max `step_order`). If not last: sequential advances `current_step` and notifies the next approver; parallel leaves it unchanged. If last: race-guarded `UPDATE ... WHERE status='pending'`; on success archives remaining notifications, resumes SLA clock (extends due-dates + credits ledger), sets `status = pre_approval_status ?? 'in_progress'`, clears `pre_approval_status`, notifies requester.

### 11.6 Reject (`rejectApproval`)

Records decision, race-guarded update to `status='rejected'`. On success: resumes SLA pause bookkeeping, sets `requests.status = 'cancelled'`, `waiting_since = null`, `cancellation_reason = 'approval_rejected'`, `reopen_deadline_at = now + 48 hours` (fixed, §8.7). Notifies requester with the rejector's comment.

---

## 12. Dynamic Form Builder

### 12.1 Core shapes (`types/index.ts`)

```ts
type FormFieldType =
  | 'text' | 'textarea' | 'number' | 'date'
  | 'select' | 'multiselect' | 'checkbox' | 'radio'
  | 'email' | 'phone' | 'file' | 'toggle'
  | 'store_address'   // system-populated, see §14

type FormFieldOption = { value: string; label: string; children?: FormFieldOption[]; is_active?: boolean }

type FormField = {
  id: string                     // see §12.2 — NOT deterministic/label-derived
  type: FormFieldType
  label: string
  placeholder?: string; help_text?: string
  required: boolean; order: number
  options?: FormFieldOption[]
  validation?: { min?: number; max?: number; min_length?: number; max_length?: number }
  requester_can_view?: boolean   // undefined defaults true
  requester_can_set?: boolean    // undefined defaults true; requires requester_can_view = true
}

type FormSection = { id: string; title: string; description?: string; order: number; collapsed_by_default?: boolean; fields: FormField[] }
```

Storage: `services.form_fields` (legacy flat), `services.form_sections` (current), `form_templates.form_sections` (no `form_fields` column), `requests.form_data` (submitted values), `requests.form_schema_snapshot` (frozen legacy flat), `requests.form_sections_snapshot` (frozen resolved sections at submission time — drives later technician-mandatory enforcement and read-only rendering, never re-resolved live).

### 12.2 Field ID generation

```ts
let _seq = 0
function uid() { return `${Date.now().toString(36)}_${(++_seq).toString(36)}` }
```
Base-36 timestamp + incrementing counter. **Not derived from the label, not deterministic** — the same-labeled field in two different templates gets two different ids. Consequences: cross-service/template analytics keying off field id (Business Rules picker, Report Builder custom columns) treat identically-labeled fields on different services as distinct; renaming a label never changes its id, so `form_data` keys and SLA Matrix overrides keep resolving across edits; duplicating a service without a template reuses the same field ids on the clone (not regenerated).

### 12.3 Field type catalog

| Type | Renders as | Validation |
|---|---|---|
| `text` | `<input type="text">` | `min_length`/`max_length` |
| `textarea` | `<textarea rows={4}>` | `min_length`/`max_length` |
| `number` | `<input type="number">` | `Number.isNaN` check, `min`/`max` |
| `date` | native HTML5 date picker | canonical `YYYY-MM-DD`, real calendar date |
| `select` | SearchableSelect (single) | value must be among all leaf options (archived included) |
| `multiselect` | SearchableSelect (multiple) | every entry valid |
| `checkbox` | pill (legacy-only, not in builder's field library) | boolean-emptiness rule |
| `radio` | pill grid (legacy-only) | same as select |
| `email` | `<input type="email">` | `EMAIL_REGEX` |
| `phone` | `<input type="tel">`, digits filtered, maxLength 10 | `PHONE_REGEX = /^[0-9]{10}$/` — exactly 10 digits, no country code |
| `file` | client-only `File[]` state until request exists | required-ness client-side only |
| `toggle` | builder preview only — no requester-facing render case | boolean-emptiness rule |
| `store_address` | always-inert div, auto-filled address text or "Not applicable" | **always exempt**, unconditionally valid |

`isShortField(type)` = text/number/date/select/email/phone — pair two-per-row; everything else full-width.

### 12.4 Validation engine (`lib/validation/formFields.ts`)

- `isFieldValueEmpty(val, fieldType?)`: for `checkbox`/`toggle`, only `undefined`/`null` count empty (explicit `false` is a real answer); everything else treats `undefined|null|''|false|[]` as empty.
- `isRequiredFor(field, audience)`: `required && (audience==='requester' ? requesterFacing : !requesterFacing)`.
- `validateFieldValue(field, value, audience)` — shared by client (`DynamicForm`) and server (`createRequestCore`) so they never drift.

### 12.5 `store_address` field — system auto-fill

Never requester-editable regardless of `requester_can_set` — always rendered inert. Server-side force-overwrite in `createRequestCore()` from `stores.address` via `profiles.store_id`. Empty string is the correct value for an HO/Warehouse requester with no store. Exempt from requester-required validation AND the technician-mandatory gate (`f.type !== 'store_address'` filter) — without this exemption, a required+technician-only field nobody can ever fill would permanently block every status transition. Section Builder inspector hides the Required/Requester-can-Set toggles for this type.

### 12.6 Option archiving (`lib/forms/options.ts`)

`is_active` (undefined/true=active, false=archived — never deleted). `filterActiveOptions()` for "what can be newly chosen" contexts. `flattenLeafOptions()` — active leaves only. `flattenAllLeafOptions()` — including archived, used by validation so a historically-submitted value keeps validating forever even after its option is retired.

### 12.7 `requester_can_view`/`requester_can_set` semantics (`lib/forms/sections.ts`)

```ts
requesterCanView(field) = field.requester_can_view !== false
requesterCanSet(field)  = field.requester_can_set  !== false
isRequesterMandatory(field) = field.required && requesterCanView(field) && requesterCanSet(field)
isTechnicianMandatory(field) = field.required && !(requesterCanView(field) && requesterCanSet(field))
```
Absence-as-true makes this a zero-migration addition. Four visibility states: fully requester-facing (default); visible-but-read-only (rendered disabled, no `*` marker); hidden entirely (technician-only, filled post-creation). `set=true,view=false` is invalid, rejected client- and server-side. `required`'s audience is derived, not stored — requester-facing required fields gate at submission; hidden/read-only required fields gate only at agent status-change time.

### 12.8 Form Templates vs inline per-service forms

```ts
resolveFormSections(service): FormSection[]   // legacy flat→section migration
resolveServiceFormSections(service): FormSection[]  // template-aware
```
If `service.template` is present, the template's sections are the **live, single source of truth** — the service's own `form_sections`/`form_fields` are never consulted. Editing the template immediately changes every tagged service. Callers must explicitly select `template:form_templates(form_sections)` — **never `form_fields`, which doesn't exist on `form_templates`** (a real bug found and fixed this session — see §23).

Consumers: `DynamicForm`, `createRequestCore()`, `getServiceFormFieldsForOrg()` (feeds Business Rules condition picker + Report Builder custom columns), the service duplicate flow.

### 12.9 SectionBuilder admin UI (`components/admin/SectionBuilder.tsx`)

Three-column layout: field-type library + validation panel; section/field canvas; selected-field inspector + live preview (Requester View / Technician View toggle). `FIELD_LIBRARY` exposes 11 of 14 types (checkbox/radio legacy-only). Option tree editor supports nested groups with archive-not-delete. Client-side pre-save validation mirrors the server's. Deleting a field with SLA Matrix entries prompts a warning (orphans, doesn't destroy, the SLA data).

### 12.10 Persisting sections (`saveFormSections()`)

Admin-only. Server-side re-validation (independent of client): ids/labels required, `select`/`multiselect` need ≥1 option, **field ids must be globally unique across the payload**, rejects the invalid visibility combo. Re-indexes `order` on every save. Writes via admin client. Logs admin-audit, revalidates paths.

### 12.11 DynamicForm — requester-facing renderer

Resolves `filterFieldsForRequester(resolveServiceFormSections(service))` — technician-only fields never reach the requester's form. Renders the Category/Sub-category picker as separate state from custom `values`. `getDefaultValue()`: multiselect/file → `[]`; checkbox/toggle → `undefined` (not `false` — an untouched mandatory checkbox must require a real click). On submit: client validation, strips `file` values (uploaded after the request exists), posts to `createRequest()`, then uploads pending files.

### 12.12 Technician-mandatory enforcement at status-change time

Reads `form_data` + the frozen `form_sections_snapshot`/`form_schema_snapshot` off the request row itself — never a live re-resolution — so a later service/template edit never changes what's mandatory on an already-open ticket.

---

## 13. Service Catalog

### 13.1 `services` table (key columns) — see §6.5 for the full list

A service is **not** nested under a single category — category/sub-category association is a many-to-many tag relationship (`service_sub_category_tags`), and category is a **submission-time field** the requester picks.

Governance fields: `status` (draft/review/published/retired — a plain `user` only ever sees `published`) is separate from `is_active` (a service must be **both** active and status-visible to appear in the requester catalog). `visibility` (all/agents_only/managers_only) is present in the admin UI but not observed to be enforced by any catalog query — actual audience gating is `is_active` + `status` + location tags. `visibility_scope` (Json) is a reserved/unused column. `escalation_policy_id` has a declared FK but **no application code reader/writer found** — effectively dead in the current codebase. `approval_workflow_id` is **not** editable from the Service Catalog admin UI — bound instead via the separate Approval Flows admin page.

### 13.2 Service CRUD (`lib/actions/admin/services.ts`)

`requireAdmin()` guard. `createService()`: unique-slug generation via probing; bulk-inserts `service_sub_category_tags`/`service_location_tags` if provided, translating `23505` conflicts into friendly "already tagged to Y" messages. `updateService()`: retagging is **atomic** via `retag_service_categories`/`retag_service_locations` RPCs (delete-then-insert inside one transaction — a failed insert rolls back the delete too). `archiveService()` only flips `is_active` (reversible). `deleteService()` is a hard delete, blocked if any `requests.service_id` still reference it, or any `field_sla_overrides` rows exist (that FK is CASCADE, so it's checked explicitly to avoid silent SLA-config loss).

### 13.3 Tag Categories picker + search

Renders category→sub-category tree, checkbox per sub-category. **Search box** (recently added, §23): matches category OR sub-category name; if the category itself matches, the full sub-category list stays visible; a sub-category-only match narrows to just matches, parent category row always stays visible.

**One-service-per-category exclusivity**: enforced at the DB level by `UNIQUE (sub_category_id)` on `service_sub_category_tags`. UI mirrors it: a `takenBy` map disables already-tagged sub-categories with a "Used by {serviceName}" hint; a category with every sub-category owned elsewhere shows a 🔒 lock badge. Server-side conflicts on the same race are translated the same way.

### 13.4 Category export feature

`exportCategoriesToCSV()`: one row per (category, sub-category) pair, a category with zero sub-categories still emits one row so it isn't dropped. Columns mirror the bulk-import shape exactly (round-trippable): `category_name, category_description, category_icon, sub_category_name, sub_category_description, sub_category_icon, sla_priority`.

### 13.5 `service_categories`/`service_sub_categories` CRUD

Admin-gated, auto-slugging (category slug globally unique; sub-category slug unique within its category). `sla_priority` on a sub-category auto-applies to a ticket's `priority` when picked — actual response/resolution hours still come from the tagging service's SLA Policy. `deleteCategory()`/`deleteSubCategory()` hard-block if any tag references (any sub-category under) them. `bulkImportCategories()` is per-row-tolerant (`{ imported, errors }`).

---

## 14. Store Master + OEM Routing

### 14.1 `stores` / `oems` — see §6.3

Store `code` uniqueness violations surface as a friendly message. Both `createStore`/`updateStore` re-validate `oem_id` belongs to the caller's own org even though the admin client bypasses RLS (§4.2 pattern) — without it a store could be wired to another org's OEM by id, and every ticket from that store would email the wrong org's OEM with this org's ticket contents.

**No bulk-import function exists for OEMs** — confirmed by full inspection of `lib/actions/admin/oems.ts`: only single-row CRUD. Deleting an OEM doesn't block on referencing stores — `stores.oem_id` is `ON DELETE SET NULL`, so those stores simply fall back to unmapped (no auto-email).

### 14.2 `profiles.store_id`

Links a requester to a physical store, distinct from the coarser `profiles.location_id`. `createRequestCore()` looks this up **by `requesterId`** (not the acting user) so book-on-behalf-of/intake/WhatsApp-resolved requesters get their own store — feeding both `store_address` auto-fill and OEM routing.

### 14.3 OEM auto-routing — `runOemAutoRouting()` (`lib/requests/create-request-core.ts`)

**Trigger condition (exact)**: `service.auto_oem_routing === true && requesterStoreOemId is not null` (i.e. `profiles.store_id → stores.oem_id` resolves). An unmapped store's ticket stays an ordinary manual ticket — confirmed product decision. Additionally requires the OEM to exist, be active, and have ≥1 email.

Steps: renders `email_subject_template`/`email_body_template` against `{{ticket_no, subject, description, requester_name, requester_email, requester_phone, store_address}}` (defaults provided if unconfigured); sends to every address in `oem.emails` (parallel `sendEmail()` calls, each line HTML-escaped before wrapping in `<p>`); inserts a public system comment naming the OEM and its emails; **conditionally** flips status `open → in_progress` only if the ticket is *still* `open` (guards against an earlier Business Rules `'created'`-trigger action already having moved it), logging an activity with `automated: true` **only if the conditional update actually matched a row**.

### 14.4 Bulk import matching rules

| Import | Column | Match key | Behavior on miss |
|---|---|---|---|
| Import Users | `store` | store `code` (trimmed, uppercased) | Row skipped: `Row N: store "X" not found, skipped.` |
| Import Stores | `oem` | OEM `name` (trimmed, lowercased, exact match) | Row skipped: `Row N: OEM "X" not found, skipped.` |
| Import OEMs | — | — | **Does not exist.** OEMs are single-row CRUD only. |

Both real imports are per-row-tolerant — a bad row is recorded and skipped, the batch continues, returns `{ imported, errors }`.

---

## 15. Notifications

### 15.1 Core function: `notify()` (`lib/notifications.ts`)

```ts
type NotifyInput = { recipientId, actorId, type: NotificationType, title, body?, requestId?, taskId?, link?, metadata? }
```

`notify(inputs)` **never throws** — callers fire-and-forget. Flow:

1. Normalize to array, dedupe recipients, bail if empty.
2. **Per-user blanket opt-out** (`notification_preferences`, `enabled=false`) — dropped first (a layer separate from org-level channel rules).
3. Look up each recipient's `org_id`.
4. **Org-level channel gating** (`notification_rules`) — §15.2.
5. **In-app fan-out**: bulk insert into `notifications` (admin client). A failure is structured-logged with recipient count/types (not a bare `console.error`).
6. **Email fan-out**: detached async, only for `email`-enabled recipients, per-recipient try/catch (one bad address never blocks the rest). If **100% of a batch fails**, `alertOperator({ severity: 'critical' })`.
7. **Push fan-out**: same detached, per-recipient-isolated pattern; failures logged as warnings only (best-effort by design).

### 15.2 `notification_rules` — org-level channel gate

`(org_id, event_type)` → `{email, in_app, push}` booleans, PK on the pair.

```ts
const rule = ruleByKey.get(`${orgId}:${type}`)
return { inApp: rule?.in_app ?? true, email: rule?.email ?? true, push: rule?.push ?? true }
```

**Critical rollout rule: a missing row means every channel defaults ON** — matches the pre-existing "always notify" behavior, so introducing this table doesn't silently go quiet on anyone. Rows only need to exist for pairs an admin has explicitly customized.

### 15.3 `NOTIFICATION_RULE_GROUPS` catalog (`lib/constants/notification-rules.ts`)

21 rows across 6 groups:

| Group | Event types |
|---|---|
| Requests | request_created, status_changed, request_resolved, request_closed, request_cancelled, request_reopened, request_auto_closed, priority_changed |
| Assignment | request_assigned, request_reassigned, request_unassigned |
| Conversation | comment_added, internal_note_added, mentioned |
| Collaborators | collaborator_added, collaborator_removed |
| Approvals | approval_requested, approval_approved, approval_rejected |
| Tasks | task_assigned, task_completed |

**Deliberately excluded** (they have their own channel pickers elsewhere, avoiding a confusing double-gate): `sla_warning`/`sla_breached`/`approval_decided` (never actually fired by any code path — a toggle would be a no-op); `task_due_soon/overdue`, `milestone_due_soon/overdue`, `daily_digest` (own picker on Alert Rules); `business_rule_notification` (own picker on the Business Rules "Notify" action).

### 15.4 Other exports

- `getRequestAudience(requestId)` → `{ requesterId, assigneeId, collaboratorIds }`.
- `parseMentions(body)` → de-duplicated, lowercased `@FirstName` tokens.

---

## 16. Email

### 16.1 Sender configuration (`lib/email/config.ts`)

```ts
const DEFAULT_EMAIL_FROM = process.env.EMAIL_FROM ?? 'Citykart Desk <noreply@citykart.org>'
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
export const EMAIL_ENABLED = !!RESEND_API_KEY
```

`getEmailFrom()`: 60s-cached read of `app_settings` rows `email_from_name`/`email_from_address` (Admin → Platform Settings → Integrations, runtime-changeable, no redeploy). Falls back to `DEFAULT_EMAIL_FROM` on error, without caching the failure (§4.4 pattern). Governs **both** user notification emails and OEM auto-routing emails.

### 16.2 The sender (`lib/email/send.ts`)

```ts
export async function sendEmail(p: EmailPayload): Promise<{ error?: string }> {
  if (!EMAIL_ENABLED) { console.log('[EMAIL DISABLED] To:', p.to, ' Subject:', p.subject); return {} }
  // POST https://api.resend.com/emails, Bearer auth
  // returns { error } on non-OK or exception, never throws
}
```

Delivery via the **Resend** HTTP API. When disabled: logs `[EMAIL DISABLED] To: ... Subject: ...`, returns `{}` (success-shaped, no `error` key) — **never throws**, so every call site can treat "email off" identically to "email sent." Callers must inspect the returned `{error?}` themselves; some (like `runNotify()` in the Business Rules engine) discard it entirely — a documented latent risk.

### 16.3 Notification → template dispatch (`lib/email/notify-email.ts`)

`sendNotificationEmail({type, recipientEmail, recipientName, data})` switches on the notification `type` to one of the templates in `lib/email/templates.ts` (request created/status-changed/comment/task/approval-required/approval-decision/sla-breach/assigned templates); unmapped types return without sending. Wrapped in try/catch that swallows all errors.

### 16.4 Every call site of `sendEmail()`

1. `lib/email/notify-email.ts` — the notification-email bridge (from `notify()`'s email fan-out).
2. `lib/requests/create-request-core.ts` — OEM auto-routing, one email per configured OEM address, independent of the notify()/notification_rules pipeline.
3. `lib/rules/actions.ts` (`runNotify()`) — Business Rules' own **separate, direct** email send path — per audit docs, these two paths don't currently double-send only because `notify-email.ts`'s switch has no case for the Business-Rule/Alert-Rule event types — a fragile non-overlap flagged as a latent risk.
4. `app/api/alerts/run/route.ts` — 5 separate call sites, one per alert kind.
5. `lib/actions/admin/reports.ts` — scheduled/report-export emails.
6. `api/src/intake/smtp.ts`/`routes.ts` — a **separate** SMTP-based `sendEmail()` local to the standalone worker (not Resend-based), for outbound Inbox replies.

---

## 17. Web Push

### 17.1 `push_subscriptions` (see §6.10) and VAPID setup

```ts
export const PUSH_ENABLED = !!VAPID_PUBLIC_KEY && !!VAPID_PRIVATE_KEY
if (PUSH_ENABLED) webpush.setVapidDetails(VAPID_SUBJECT ?? 'mailto:support@citykart.org', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
```

### 17.2 `sendPushToUser(userId, payload)` (`lib/push/send.ts`)

No-ops silently if `PUSH_ENABLED` is false. Loads all subscriptions for the user, sends `{title, body, link}` JSON to every subscription in parallel. **Dead subscription cleanup**: on `statusCode === 404 || 410`, deletes the row so it isn't retried on every future event.

### 17.3 Shared client helpers (`lib/push/client.ts`)

- `isPushSupported()` — feature-detects `serviceWorker`/`PushManager`.
- `enablePushOnThisDevice(vapidKey)` — `Notification.requestPermission()` → register `/sw.js` → `pushManager.subscribe()` → server action `subscribeToPush()`. The single subscribe path shared by both the manual Profile toggle and the auto-prompt.
- `disablePushOnThisDevice()` — server action `unsubscribeFromPush()` then browser `subscription.unsubscribe()`.

### 17.4 Server actions (`lib/actions/push.ts`)

`subscribeToPush()` upserts on `onConflict: 'endpoint'` (re-subscribing replaces, no duplicates). `unsubscribeFromPush()` scoped to `endpoint AND user_id = caller`. `hasPushSubscription()` drives the profile toggle's initial state.

### 17.5 Service worker (`public/sw.js`)

Deliberately minimal — no offline caching/PWA behavior, just `install`/`activate`/`push`/`notificationclick`. On `push`: parses JSON (falls back to text, then defaults), `showNotification()`. On click: focuses/navigates to the link, or opens a new window.

### 17.6 Auto-prompt (`components/layout/AutoPushPrompt.tsx`)

Fires once per browser, gated by `localStorage['push-auto-prompted']`. No-ops if VAPID key absent, push unsupported, or `Notification.permission !== 'default'`. Calls `enablePushOnThisDevice()`; **the "already asked" flag is set only after the call resolves to a real decision** — `requestPermission()` can resolve to `'default'` without a dialog ever showing, and a thrown error means the user was never really asked. Setting the flag before knowing the outcome would wrongly burn the one-time prompt on an attempt nobody saw.

---

## 18. Email Intake (Ticket Creation from Incoming Mail)

*(A parallel, conversational intake channel over WhatsApp also exists — same `intake_*` data model, entirely different UX. See §25.)*

### 18.1 High-level flow

```
Admin connects mailbox (OAuth, /intake/channels)
  → intake_channels row (status: paused → active after OAuth)
  → Push registration attempt (Gmail watch / Graph subscription) — falls back to IMAP polling
  → New mail: Gmail Pub/Sub push → webhook/gmail | Graph notif → webhook/outlook | no push → worker's IMAP poller
  → Next.js webhook forwards to worker (fire-and-forget, x-intake-worker-secret)
  → api/src/intake/{gmail-sync,graph-sync,imap+poller}.ts fetch raw message → mailparser → store.ts
      (upsert intake_threads, insert intake_messages idempotently, validate+store intake_attachments)
  → classify/orchestrator.ts runs the pipeline (rule → local_model → [future] premium_ai),
      writes intake_classifications, creates/refreshes intake_reviews
  → Inbox UI: reviewer reads, optionally adjusts classification
  → Reviewer approves → lib/actions/intake/work.ts: approveAndCreate() / convertToWork()
      → createRequestCore() (same core the portal uses) creates the real work item
  → intake_reviews.state = 'converted', linked via created_request_id/created_task_id/created_approval_id
```

### 18.2 OAuth connection (`app/api/intake/oauth/callback/route.ts`)

Requires authenticated profile. Verifies the signed `state` param, then re-checks ownership (session must own that channel scoped to its own org — defense against a replayed state token acting on another org's channel). Exchanges code for a refresh token + connected email. Stores the credential blob via **service-role RPC** `intake_store_credential` (writes to Supabase Vault). Best-effort push registration (Gmail watch via `GOOGLE_PUBSUB_TOPIC`; Microsoft Graph subscription with `clientState` = the webhook secret) — falls back to IMAP polling automatically if unconfigured.

### 18.3 Webhook auth: `INTAKE_WEBHOOK_TOKEN` vs `INTAKE_WORKER_SECRET`/`CRON_SECRET`

```ts
const secret = process.env.INTAKE_WEBHOOK_TOKEN ?? process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
```

**`INTAKE_WEBHOOK_TOKEN`** is for the **public webhook URL** (query string for Gmail Pub/Sub, or Microsoft's echoed `clientState`) — logs/proxies routinely capture query strings and echoed values, so this token must be scoped to "prove this push is legitimate" and nothing more. **`INTAKE_WORKER_SECRET`** grants **full worker-admin access**, sent as `x-intake-worker-secret` on internal service-to-service calls — must never sit in a URL. If `INTAKE_WEBHOOK_TOKEN` isn't set, both webhooks fall back to the worker-admin secret "so existing deployments keep working until rotated" — explicitly flagged as suboptimal until rotation. Constant-time comparison throughout.

**Gmail webhook**: decodes the Pub/Sub envelope, looks up the matching channel, fire-and-forgets a sync call to the worker. **Always returns 200 OK** (Pub/Sub retries on any non-2xx) even for bad/duplicate/unrecognized pushes.

**Outlook/M365 webhook**: `GET` handles the subscription-validation handshake; `POST` verifies `clientState`, looks up the channel by `graph_subscription_id`, fire-and-forgets a sync call. Also always returns 200.

### 18.4 The `api/` worker subproject — endpoints

| Route | Purpose |
|---|---|
| `GET /intake/health` | Public build/config readout |
| `POST /intake/poll` | Manually triggers `pollAllChannels()` |
| `POST /intake/reclassify` | Triggers `classifyBacklog()` |
| `POST /intake/test-classify` | Runs one sample message through Stage-2 without persisting |
| `POST /intake/send` | Sends outbound via the worker's own SMTP-based sender |
| `POST /intake/gmail-sync` | Syncs new mail for one channel given a `historyId` |
| `POST /intake/graph-sync` | Syncs one new message given a `graphMessageId` |
| `POST /intake/test-channel` | Validates IMAP credentials |

All protected by `requireWorkerSecret` except `/health`.

### 18.5 Message storage & idempotency (`api/src/intake/store.ts`)

`storeMessage()`: computes `dedupHash`. **Idempotency guard #1**: existing `external_message_id` for `(org_id, channel_id)` → `{outcome: 'duplicate'}`. Thread upsert via `threadKeyFromSubject()` (strips `Re:`/`Fwd:`/`Fw:` prefixes, repeated, case-insensitive). `detectRecipientType()` (to vs cc, defaults to `to` if unknown — handles aliases). Inserts `intake_messages`. **Idempotency guard #2**: a `23505` unique-constraint violation on insert (concurrent poll raced) is treated as duplicate, not an error. `storeAttachments()`: skips >25MB, **validates via `validateInboundAttachment()`** (§18.6) before storing to bucket `intake-attachments`.

### 18.6 Attachment validation — two parallel validators, hand-synced

- `lib/attachments/validate.ts` (main app) — operates on a browser `File`.
- `api/src/intake/attachmentValidate.ts` (worker) — **Buffer-based counterpart**, since the worker parses mail-derived `Buffer`s and has no import path into `lib/` (separate package.json/tsconfig, no `@/` alias). Same allowlist, same magic-byte signatures, kept in sync **by hand**.

Same allowlist/signature scheme as §4.6.

### 18.7 Classification pipeline (`api/src/intake/classify/orchestrator.ts`)

A **provider-registry pipeline**:
```ts
const REGISTRY = {
  rule_engine: new RuleClassifier(),
  ...(localModelConfigured() ? { local_model: new LocalModelClassifier() } : {}),
  // 'claude': new PremiumAiClassifier('claude'),  // Stage 3, not yet implemented
}
```
- **Stage 1 — rule_engine**: always runs, deterministic, instant. Org-authored `intake_rules` merged **ahead of** code-defined defaults (custom rules "lock" the dimension they match).
- **Stage 2 — local_model**: registered only when an LLM key is configured. Despite the "local" name, `LocalModelClassifier` (`api/src/intake/classify/local-model-classifier.ts`) is a thin OpenAI-compatible chat-completions client, **not a self-hosted model** — provider-agnostic by design (env-configured `INTAKE_LLM_BASE_URL`/`INTAKE_LLM_MODEL`/`INTAKE_LLM_PROVIDER`, works against Groq/Together/Fireworks/OpenRouter/a self-hosted vLLM interchangeably), but its coded defaults point at **Groq's hosted API** (`https://api.groq.com/openai/v1`, model `llama-3.3-70b-versatile`) — the actual provider in use unless explicitly overridden. Does not run inline on the bulk backlog (rate-limited LLM would fall behind thousands of messages); runs as a background "escalation" that upgrades uncertain, actionable mail a small batch at a time. **Does** run inline for live single-message ingestion (no backlog pressure there).
- **Stage 3 — premium AI**: scaffolded, not implemented.

`classifyMessage()` — idempotent, per-message: runs each enabled stage in order, records one `intake_classifications` row per attempt; a stage throwing falls back to the best result so far. Early-stop when confidence ≥90% (auto-accept), or a confident no-work classification ≥80%, or ≥85% (escalate threshold). Keeps the highest-confidence result as winner. Meta-signal priority overrides: CC-only mail capped to `low` unless already `urgent`; an unresolved review already in the same thread bumps priority to at least `high`. Confident no-work mail (`informational`/`ignore` ≥80%) auto-resolves (`reviewed_by: null` to mark it machine-decided, still revisitable by a forced re-classify); `ignore` mail also archives out of the inbox. Service/category resolution via `loadCatalog()` corroborates actionable types, nudging confidence (capped, never auto-accepting alone). Upserts `intake_reviews` on unique `message_id`, **never clobbering a review a human has already started acting on**.

`classifyBacklog(limit, force, unclassifiedOnly)` — bulk/backfill; `force=true` re-runs un-actioned or machine-auto-resolved reviews (never human-touched ones). Runs rules-only inline for full coverage, sorts lowest-confidence-first, resumable.

`escalateCatchUp(batchSize)` — a small restart-safe scheduled tick pushing the lowest-confidence actionable mail (never no-work mail) through the full pipeline.

### 18.8 Review → conversion (`lib/actions/intake/work.ts`)

**`approveAndCreate(reviewId, decision, payload)`**: loads and org-scopes the review, rejects if already converted/rejected. Claims it (`state: 'in_review'`) if pending. **No-work types** (informational/ignore): approves + marks message actioned, no work item. **`request`/`approval`**: verifies target service/team in-org, runs entity autofill from `intake_classifications.entities` layered under the reviewer's own overrides, calls **`createRequestCore()`** — the same core the portal uses — with `source: 'email_intake'`, `intakeMessageId`, `sourceMetadata`, `teamIdOverride`, `priorityOverride`. **Deliberate behavior change documented in code**: routing through the shared core (vs. an earlier direct-insert implementation) means intake-created tickets now correctly get SLA due dates, Business Rules `created`-trigger firing, and the same mandatory-field validation every channel gets. For `approval` type: resolves a workflow, inserts a pending `approvals` row, updates status to `pending_approval` as a follow-up step. **`task`**: inserts a `tasks` row (priority capped to `high`, since `task_priority` has no `urgent`).

**`convertToWork(messageId, payload)`**: get-or-creates a review seeded so it isn't spuriously flagged an override, delegates to `approveAndCreate()`.

**`reclassifyReview()`**: changes classification post-conversion as a record update + audit entry only — doesn't touch the already-created work item.

---

## 19. Report Builder (Pivot / Table Reports)

**Core files**: `lib/reporting/field-registry.ts`, `lib/reporting/access.ts`, `lib/queries/reporting.ts`, `lib/actions/reporting.ts`, `lib/reporting/pivot-engine.ts`, `lib/actions/reportExport.ts`, `components/reports/PivotBuilder.tsx`.

### 19.1 Five entities

`EntityKey = 'requests' | 'tasks' | 'projects' | 'milestones' | 'approvals'`. Each `ReportField`: `{ key, label, type: 'string'|'number'|'date'|'boolean'|'enum', options?, groupable?, isCustomField?, customFieldId? }`.

**requests**: request_no, title, description, status, priority, service_name, category_name, sub_category_name, template_name, team_name, requester_name, assignee_name, project_name, source_channel, approval_status (incl. synthetic `not_sent`), approved_by_name, approval_decided_at, is_reopened, reopen_count, created_at, updated_at, responded_at, resolved_at, closed_at, resolution_due_at, response_due_at, age_days, resolution_days, is_sla_breached, is_response_sla_breached, csat_rating, collaborator_count, attachment_count, comment_count, time_tracked_minutes.

**tasks**: title, status, priority, task_type, assignee_name, created_by_name, team_name, project_name, milestone_name, linked_request_no, tags, start_date, due_date, completed_at, created_at, age_days, is_overdue.

**projects**: name, status, priority, owner_name, functional_owner_name, team_name, created_by_name, start_date, target_date, created_at, age_days, is_overdue.

**milestones**: name, project_name, status, priority, owner_name, functional_owner_name, percent_complete, start_date, end_date, is_overdue.

**approvals**: request_no, workflow_name, status, current_step, decided_by_name, decided_at, decision_comment, created_at, updated_at, age_days.

Plus a synthetic `RECORD_COUNT_FIELD` on every entity. Enum options for request status/priority are derived programmatically from `STATUS_LABELS`/`PRIORITY_LABELS` (so Reports and Business Rules never drift).

`aggregationsForType(type)`: number→sum/avg/min/max/count; date→min/max/count; boolean→countTrue/countFalse/count; string/enum→count/countDistinct.

### 19.2 ReportViewerScope — role-based row scoping

Only the **requests** entity is row-scoped by viewer; all other entities are admin/manager/platform_owner-only, unrestricted once access is granted.

```ts
type ReportViewerScope = {kind:'all'} | {kind:'own', userId} | {kind:'agent', userId} | {kind:'team', teamIds}
```
By role: admin/platform_owner → `all`; manager → `team` (their team_members teams); agent → `agent` (assignee OR requester); user → `own` (requester only). A manager on zero teams gets zero rows (not an unfiltered match).

### 19.3 Dynamic custom fields merged in

**Task custom fields — `custom:<field_id>`**: per-team `task_custom_fields`, mapped by `field_type` (number/date/checkbox/dropdown/multi_select/text) to `ReportField.type`; values from `task_custom_field_values`.

**Request service-form fields — `form:<field_id>`, labeled `"ServiceName: Field Label"`**: every *active* service's resolved form fields via `getServiceFormFieldsForOrg()`, filtered to drop `toggle`/`file` types. Values from `requests.form_data`.

Special case: since the web channel never populates `requests.description` directly, the "Description" report column falls back to the request's service's *first* `textarea`-type field's value from `form_data` (mirrors the same convention `createRequestCore()` uses for title derivation). Email Intake *does* populate `requests.description` directly, and that value wins when both exist. **This was a real fix applied this session — see §23.**

`getReportFieldsForEntity()`/`fetchReportData()` merge dynamic fields per-entity: tasks get `custom:*`, requests get `form:*`.

Requests row-fetch also joins/derives aggregate columns via batched `.in()` queries (`IN_CLAUSE_BATCH_SIZE = 200`, avoiding a 20,000-id URL blowing past proxy limits): collaborator/attachment/comment counts, summed time-tracked minutes, CSAT, and an approval summary. SLA flags use the "ever breached" formulas (deliberately different from "currently breached" live KPIs elsewhere).

`MAX_REPORT_ROWS = 20000` caps every fetch; overflow sets `truncated: true`.

### 19.4 Pivot engine (`lib/reporting/pivot-engine.ts`)

Pure, dependency-free — runs identically server-side (export) and client-side (live re-pivot on drag, no round-trip).

```ts
interface PivotConfig { rowFields: string[]; colFields: string[]; valueFields: {field, agg}[]; filters: FieldFilter[] }
```
Pipeline: filter rows → build a recursive group tree per `rowFields` (each level bucketed by `displayValue()`: booleans→Yes/No, dates truncated to day, enums resolved, blank→`(blank)`, sorted alphabetically) → same tree for `colFields` → flatten to column leaves (or one `__all__` leaf) → for every row node, run an Accumulator (sum/count/min/max/countTrue/countFalse/distinct-set) per value field against each column leaf's matching rows.

`toFlatTable()` — the "Table" mode counterpart, no grouping, filtered rows projected to chosen columns.

### 19.5 UI concept

`@dnd-kit/core` drag-and-drop into four "wells" (Rows/Columns/Values/Filters, table mode uses Columns+Filters only) plus a date-range quick-filter. Entity change re-fetches fields+data in parallel; defaults reset sensibly. Re-pivoting on any well/filter change recomputes client-side against the already-fetched full row set — no server round-trip per interaction. **Field labels wrap onto multiple lines with a hover tooltip** (fixed this session — see §23; previously hard-truncated with no way to see the full name).

### 19.6 Export to xlsx (`lib/actions/reportExport.ts`)

Uses `exceljs`. Re-authorizes and re-fetches server-side (never trusts client-cached rows). **Table mode**: one styled worksheet as a native Excel Table (filter buttons, striped rows, frozen header). **Pivot mode**: a `Pivot` worksheet reproducing the computed pivot as static cells (indented row labels, shaded subtotal/grand-total rows, a running-total column for single-value-field pivots) plus a `Raw Data` worksheet with the full filtered rows as another native Excel Table (since `exceljs` can't emit a real Excel PivotTable object, this gives the user a ready base for Insert→PivotTable in Excel).

---

## 20. Projects / Tasks / Milestones

### 20.1 `projects`

`status` (not_started/in_progress/blocked/done/cancelled), `priority` (P1/P2/P3), `owner_id` (tech owner, NOT NULL), `functional_owner_id` (nullable), `team_id` (nullable). "Overdue" is derived, not stored: `!!target_date && status not in (done,cancelled) && target_date < now`.

The Project detail page is currently gated **admin/platform_owner only** ("Projects isn't fully built out yet," per code comment). Composes tabs: Tasks (reuses the standalone `TasksClient`, scoped to the project), Requests, Milestones, Updates (progress-percent history), Activity.

### 20.2 `tasks`

`status` (open/in_progress/done/cancelled), `priority` (low/medium/high — no `urgent`), `task_type` (personal/team), self-referencing `parent_task_id` (subtasks), `task_dependencies` (separate table for cross-task blocking). "Overdue": `!!due_date && !completed_at && due_date < now`. `request_id` links a ticket to spawned follow-up tasks, surfaced in reports as `linked_request_no`.

**Task custom fields** (per-team, dynamic schema): `task_custom_fields` (field_type: text/number/date/dropdown/multi_select/checkbox) + `task_custom_field_values` (one row per task×field pair, absence = unset).

### 20.3 `milestones`

Reuses the `project_status`/`project_priority` enums (a milestone's vocabulary is identical to a project's). `percent_complete` is the milestone's own number, distinct from the project-level rollup computation used on the Updates tab. Belongs to exactly one project; tasks optionally reference one.

---

## 21. Admin Area — Screen by Screen

Every admin page independently gates on `profile.role` (`redirect('/login')`/`redirect('/home')`) at the top of its own server component — no centralized route-level middleware.

- **Users** (`admin/users`) — org-wide user management: `profiles` + `team_members`/`teams` + Auth records, plus reference pickers for departments/locations/stores/cost-centers/job-functions/designations.
- **Teams** (`admin/teams`) — CRUD for `teams`, managing membership (incl. lead flag), warns on "user already on another team."
- **Roles & Permissions** (`admin/roles`) — read-mostly reference: Role Overview, User→Role, Permission Matrix. Roles themselves are a fixed enum, not user-defined.
- **Org** (`admin/org`) — CRUD for Departments, Locations, Cost Centers, Job Functions, Designations, OEMs, Stores, each often with usage stats.
- **Master Data** (`admin/master-data`) — **Request Priorities** only (with Order/SLA-multiplier editing). Task Statuses/Priorities live on the separate Task Config screen. A "Tags" section was removed (unused feature — §23).
- **Categories** (`admin/categories`) — the service-catalog Category/Sub-Category tree, with a CSV export (§13.4).
- **Services** (`admin/services`) — the Service Catalog: name, category/sub-category tags, team, Form Template, SLA Policy, location visibility, governance fields.
- **Form Templates** (`admin/form-templates`) — design reusable intake forms once, tag any service to a template.
- **SLA Policies** (`admin/sla-policies`) — named response/resolution tables by priority, mappable onto any service. The finer Field SLA Matrix layer lives under Request Config.
- **Business Rules** (`admin/business-rules`) — the condition/action automation engine (§10).
- **Request Config** (`admin/request-config`) — tabbed: Field SLA Matrix, Lifecycle (status transitions per role), Business Hours (+ holidays, feeds SLA pause math), Alert Rules, Notification Rules, General (incl. `auto_close_days` reopen window).
- **Settings** ("Platform Settings", `admin/settings`) — **Retention** (per-entity data retention) and **Integrations** — a single **"Email Sending"** card (identity + Resend delivery status + where the address is used, instant-vs-scheduled breakdown; consolidated this session — see §23).
- **Audit Logs** (`admin/audit`) — paginated, filterable activity log across requests and tasks.
- **Monitoring** (`admin/monitoring`) — live operational stats + recent activity (admin/platform_owner only, stricter than most).
- **DeskTime** (`admin/desktime`) — **disconnected this session** (§23): nav entry removed, credential cleared; page/code and reporting tabs remain intact and show "not connected."

*(Additional screens not detailed here: Approvals workflow builder, Knowledge Base, Runbooks, Task Config.)*

---

## 22. Cron / Scheduled Jobs & Deployment

### 22.1 Cron-able routes

| Route | Purpose | Suggested cadence |
|---|---|---|
| `/api/business-rules/run` | Evaluates schedule-triggered Business Rules (SLA %-elapsed, unassigned-for-N-minutes). Created/edited-triggered rules run inline, not from this cron. | every 15 min |
| `/api/alerts/run` | Fires Task/Milestone due-soon/overdue alerts and the daily digest (self-gates to once/day at hour 8). | every 30 min |
| `/api/desktime/sync` | Pulls the last 3 days of DeskTime data for every org with a connected key. **Currently no org has one connected** (disconnected this session). | once daily |
| `/api/intake/cron/classify` | Reclassifies intake messages missing a final classification. | every few minutes |

**`/api/reports/send` does not exist** — confirmed absent from the whole `app/api` tree. It was a dead Integrations-page reference, **removed from the UI this session** (§23). Do not implement it on rebuild unless a real scheduled-report-email feature is separately specified.

### 22.2 `CRON_SECRET` auth (`lib/cron-auth.ts`)

`verifyCronSecret(req)` accepts either `x-cron-secret: <secret>` or `Authorization: Bearer <secret>`, constant-time comparison. Returns `null` (caller should 503) if `CRON_SECRET` isn't configured.

### 22.3 Production scheduling — Railway, not Vercel/GitHub Actions

No `vercel.json`, no `.github/` workflows. `scripts/cron-tick.mjs` — a dependency-free Node script (built-in `fetch`) — is run by **Railway's native cron scheduler as separate Railway service(s)** in the same project. Env: `CRON_SECRET`, `CRON_TARGET_URL`, `CRON_JOBS` (comma-separated). `JOB_PATHS` maps names → routes. Logs ✓/✗ per job, `process.exit(1)` on any failure so Railway marks the run failed. Documented setup: up to four separate Railway cron services (one per job/cadence), each running `node scripts/cron-tick.mjs` with its own schedule and `CRON_JOBS` value. The web app itself runs as an always-on Railway service (3-stage Alpine Docker build → `node server.js`, health-checked at `/api/health`) against a hosted Supabase project.

---

## 23. Development History — Fixes & Enhancements Applied

This section records the concrete, verified work completed on this codebase (most recent session's work; some items carry forward context from earlier work in the same lineage). Every item below reflects code actually changed and, where applicable, live-verified in a running instance.

### Store Master + OEM Auto-Routing (feature build)
- Built `stores` (physical stores with addresses) and `oems` (vendor contacts with email templates) tables/admin UI.
- Added a `store_address` form-field type: always system-populated from the requester's store, never requester-editable, exempt from required-validation and the technician-mandatory gate everywhere.
- Built `runOemAutoRouting()`: when a service has `auto_oem_routing=true` and the requester's store has a mapped OEM, the system emails the OEM, posts a system comment, and conditionally flips status to `in_progress` — fixed to check the returned row before logging activity (avoiding a false status-change log entry when the conditional update didn't actually match).

### Configurable Sender Email
- Replaced a hardcoded env-var "from" address with a DB-backed (`app_settings`), admin-editable sender identity (`getEmailFrom()`, 60s cache, cache-success-not-failure pattern) — changeable at runtime with no redeploy.

### Full-App Audit & Fix Pass
A structured read-only audit followed by real fixes for confirmed issues, including:
- **SLA pause-credit ledger** — fixed cases where a priority/category change silently discarded previously-completed pause credit instead of only the currently-active pause.
- **Approval-status restore** — fixed the post-approval status resume to correctly honor `pre_approval_status` (resuming to `waiting_user` when that's where it was, not always forcing `in_progress`).
- **Business-rules bookkeeping parity** — brought `runSetStatus()`/`runSetPriority()` up to parity with the interactive `updateRequestStatus()`/`changePriority()` bookkeeping (CSAT creation, time-entry closing, reopen-count/pause-ledger reset).
- **Category multi-tenancy bug** — fixed a cross-org leak in category resolution.
- **File-upload hardening** — added magic-byte validation, excluded `image/svg+xml` from the allowlist, forced `Content-Disposition: attachment` on intake attachment signed URLs.
- **Hydration/race fixes** — including the `.eq('status', currentStatus)` race guard pattern on status updates.
- **Org-scope guard introduced** — `assertRefsInOrg()` added and wired into `createStore`/`updateStore`/`updateUserProfile`/`inviteUser`/`updateUserOrgFields` to close cross-tenant FK-injection gaps in admin-client writes.
- **Rate limiting added** — `admin-invite-user` rate limit matching the sibling password-reset limiter.
- **RLS helper hardening** — `is_agent()`/`is_request_approver()` made org-aware at the function level rather than patching each policy call site.
- **`isHoliday()` local/UTC date mismatch fix** (`lib/sla/business-hours.ts`).
- **SLA matrix query fix** — swapped a stale `resolveFormSections`/plain `form_sections` lookup for `resolveServiceFormSections` + the correct `template:form_templates(form_sections)` join (template-tagged services were being resolved incorrectly for SLA matrix purposes before this).
- **Intake attachment validator parity** — built a Buffer-based validator (`api/src/intake/attachmentValidate.ts`) mirroring the main app's, for the separate `api/` subproject that can't import from `lib/`.
- **`INTAKE_WEBHOOK_TOKEN` introduced** — separated the public-URL webhook token from the worker-admin secret (`INTAKE_WORKER_SECRET`/`CRON_SECRET`), with backward-compatible fallback.
- **Auto-push-prompt fix** — the "already prompted" localStorage flag is now only set after the permission promise resolves to a real decision, not before and not on an ambiguous `'default'` result (previously could permanently burn the one-shot prompt on a failed/dismissed attempt).

### Notification Rules + Web Push Infrastructure (feature build)
- Built `notification_rules` (org × event_type × 3 channels, missing-row-defaults-ON rollout), gating centralized inside `notify()`.
- Curated `NOTIFICATION_RULE_GROUPS` to the 21 event types that map to a real `notify()` call site with no other screen already controlling their channels.
- Built the full Web Push stack: `push_subscriptions` table, VAPID key generation/config, `public/sw.js`, `lib/push/{send,client}.ts`, the manual Profile toggle, and `AutoPushPrompt`.

### Tag Categories Search
- Added a search box to the Tag Categories picker in the Service create/edit modal (category-name-or-sub-category-name match, parent stays visible on a category-name match).

### 24-Hour Time Format — Global Mandate
- Added `formatDateTime()` to `lib/utils.ts` (24-hour, `hour12: false`) and swept it across the entire app: admin screens (Audit Log, Monitoring, DeskTime), request detail page (History tab, Created/Responded/Completed/Response-Due cells, comment bubbles gained a right-aligned absolute-timestamp row, approval event cards restructured to show both relative and absolute time), the mobile "Details" tab's Created field (`"date/time (5h)"` format), report/CSV exports (`fmtDate()` now includes hour/minute), the Notification Rules hint (dynamically injects the live reopen-window value instead of a hardcoded "72h" string that had gone stale once the window became configurable).

### Auto-Close-Days — Wired to Real Behavior
- `lib/settings/reopenWindow.ts` built: reads `app_settings.auto_close_days`, replacing a hardcoded `RESOLVED_REOPEN_WINDOW_HOURS = 72` constant. Consolidated a previously-decorative "General" settings tab into Request Configuration → General, making the UI actually match the underlying behavior for the first time.

### Master Data "Tags" Feature — Removed
- Confirmed via exhaustive grep (zero foreign keys, zero UI consumers anywhere) that the `tags` table was fully orphaned admin bookkeeping with no downstream effect.
- Removed at the user's explicit request: UI (`TagsTab`, `Tab` type, imports), server actions (`createTag`/`updateTag`/`deleteTag`), types, and the DB table itself (migration `DROP TABLE IF EXISTS tags`).

### Report Builder — Three Real Bugs Found and Fixed
1. **Blank "Description" column**: `requests.description` is only ever populated by Email Intake — the web channel's actual description text lives in `form_data` under the service's first `textarea` field. Fixed by falling back to that field's value when `requests.description` is empty.
2. **Custom template fields never appearing in reports (or the Business Rules condition picker)**: `getServiceFormFieldsForOrg()` requested `template:form_templates(form_sections, form_fields)` — but `form_templates` has **no `form_fields` column**, so PostgREST rejected the whole embedded query and silently returned zero fields for every template-tagged service. Fixed by removing `form_fields` from that specific embed (every other call site in the codebase already had the correct shape). This bug affected both the Report Builder's custom-field columns and the Business Rules engine's condition picker, since both share `getServiceFormFieldsForOrg()`.
3. **Field names hard-truncated with no way to see the full label**: the Fields panel used CSS `truncate` (ellipsis) with no tooltip. Fixed by switching to multi-line wrap (safe since it's a vertical scrolling list) plus a hover tooltip as backup.

### Platform Settings → Integrations — Cleaned Up
- Removed the **Report Cron** row — it referenced `/api/reports/send`, a route that doesn't exist anywhere in the codebase; a dead reference removed rather than left misleading.
- Removed **DeskTime** entirely per explicit instruction: disconnected the org's stored API key in the database, deleted the connect/disconnect UI and its now-orphaned server actions (`lib/actions/admin/integrations.ts` deleted), fixed the DeskTime page's now-dead "connect in Settings → Integrations" link, and removed the DeskTime sidebar/mobile-nav entry (with its now-unused `Timer` icon import) since it led to a permanent, unreconnectable dead end.
- **Merged four separate cards into one "Email Sending" card**: sender identity (name/address, editable) + Resend delivery status + a clear split between what sends instantly (notifications, OEM routing — no scheduler needed) and what needs a recurring job (due-soon/overdue alerts, digest, SLA escalation) — reflecting that these were always four facets of one "how does this app send email" question, not four independent integrations.

### Comprehensive Technical Specification (this document)
- Produced via six parallel deep-research passes across the full codebase (database schema, ticketing/SLA/business-rules/approvals, forms/services/store-OEM, notifications/email/push/intake, reports/projects/admin/auth, tech-stack/conventions) to serve as a from-scratch rebuild reference.

---

## 24. Known Gaps / Open Items

Flagged during the audit and fix passes, left open by explicit scope decision (not oversights):

- **Rotating `INTAKE_WEBHOOK_TOKEN` to a genuinely distinct value** in the live Google Pub/Sub / Microsoft Graph subscription configs is an external-system change only an operator with those consoles can make; the code-side fallback chain is in place but the actual rotation hasn't happened.
- **Real SLA-breach cron detection** beyond what the Business Rules `sla_pct_elapsed` schedule check provides is a separate, not-yet-built feature.
- **The Business Rules "double email" fragility** (§16.4 item 3 — `notify()`'s email path and `runNotify()`'s direct path don't currently overlap only because of a switch-statement gap, not a structural guarantee) is documented in code comments but not structurally fixed.
- **VAPID push env vars are not yet in `.env.example`** — they're required (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) but only referenced in code; add them explicitly on rebuild.
- **`RESEND_API_KEY` is not configured in this local dev environment** — outbound email is currently a no-op (logs `[EMAIL DISABLED]`) until a real Resend account + verified domain is set up.
- **DeskTime is fully disconnected** as of this session — the credential is cleared, the nav entry is gone; the underlying tables/queries/reporting UI remain intact and would work again if a key were reconnected directly (no UI path to do so currently exists — would need to be rebuilt or done via direct DB/script action).
- **`services.escalation_policy_id`** and **`services.visibility_scope`** have declared schema/FKs but no application code reader/writer found — effectively reserved/dead columns in the current build.
- **Whether/when to push local-only migrations to a hosted production database** has not been decided — this spec assumes a from-scratch rebuild, not a migration of the exact local dev database state.
- **No optimistic-locking/version column** for concurrent ticket edits beyond the `.eq('status', currentStatus)` race guard on status transitions specifically — other concurrent field edits (e.g. two agents editing form_data simultaneously) are not guarded.
- **196 files of already-completed work sit uncommitted in the local working tree** as of this writing (see §26.3) — including the entire WhatsApp intake channel (§25), Notification Rules + Web Push, Store/OEM routing, the org-scope guard, and every audit fix and Report Builder fix listed in §23. None of it has been pushed to GitHub yet.
- **Nothing is hosted anywhere right now** — see §26 in full. There is no live Railway deployment, no populated hosted Supabase project, and no real Meta/WhatsApp connection. Every "production-readiness" claim in this document describes code that works correctly *locally*, not a running public service.

---

## 25. WhatsApp Conversational Intake Channel

A second, fully-built Intake channel alongside Email Intake (§18) — same underlying `intake_*` data model and human-review pipeline, but the intake surface is a live back-and-forth WhatsApp conversation instead of a parsed inbound email. This subsystem has its own extensive staged build/validation history (`STAGE_1_REPORT.md` through `STAGE_8_3_REMAINING_ACTIONS.md`, plus `WHATSAPP_PILOT_RUNBOOK.md`, `WHATSAPP_PILOT_USER_GUIDE.md`, `META_OPERATOR_HANDOFF.md`, `PRE_PILOT_CONFIGURATION_DECISIONS.md`, `PILOT_MONITORING_SCORECARD.md`, `CITYKART_DESK_WHATSAPP_TECHNICAL_DISCOVERY.md` — treat those as the authoritative deep-dive; this section is an orientation summary) — **but it has never been connected to a real Meta account or a live deployment** (§26.2 confirms this explicitly from the codebase's own Stage 8 validation reports).

### 25.1 Data model

- **`intake_channels`** row with `type = 'whatsapp'` — config holds the Phone Number ID and WABA ID; the Access Token, App Secret, and Webhook Verify Token are stored **encrypted in Supabase Vault**, never in plaintext, never in an environment variable, and never shown again in the UI after saving (`lib/actions/intake/whatsapp-channel.ts`).
- **`request_conversations`** — the stateful, resumable session that walks a sender through the intake flow. `state` (`conversation_state` enum): `identified → awaiting_service → awaiting_issue_search → awaiting_subcategory → awaiting_description → collecting_fields → awaiting_file → review → submitting → completed | cancelled | expired`. `answers` (JSONB) accumulates collected field values. `version` is an optimistic-concurrency counter bumped atomically by the `commit_conversation_transition(...)` RPC — critical because WhatsApp messages from the same sender can arrive in quick succession and must be processed as a strict sequence, never two at once against a stale state.
- **`conversation_attachments`** — files a sender sends mid-conversation, staged (`received_reference → staged → persisted/linked`, or `failed`) before being converted into real `request_attachments` once the ticket exists.
- **`conversation_events`** — an idempotency/processing ledger (`external_message_id`, `status`: processing/completed/failed, `result` JSONB) so a duplicate webhook delivery (Meta's webhook can and does redeliver) never re-processes the same inbound message twice.

### 25.2 Identity resolution

A WhatsApp sender is matched to an existing Citykart Desk user via `profiles.mobile_number` (10-digit, no country code, no `+91`) **and** `profiles.whatsapp_enabled = true` — both fields must be set by an admin in User Master (Admin → Users) before that person's WhatsApp messages are recognized at all. There is no self-registration; an unrecognized number gets a safe, generic response rather than a way to inject rules.

### 25.3 Webhook & auth (`app/api/intake/webhook/whatsapp/route.ts`, `lib/whatsapp/`)

Meta calls this endpoint for two purposes: a `GET` handshake (echoes back Meta's `hub.challenge` after verifying `hub.verify_token` against the channel's stored Webhook Verify Token) and `POST` delivery of actual message events (subscribed to the **`messages`** field only — no other webhook field is used). Meta signs every POST with `X-Hub-Signature-256`; the handler verifies this against the channel's App Secret before trusting the payload.

**A specific, previously-shipped bug worth calling out** (fixed in Stage 8.1, re-verified in every later stage report): this route must be reachable **without a session** — a request from Meta's servers obviously carries no Citykart Desk login cookie, so it must be explicitly exempted in `proxy.ts`'s auth-redirect logic. The regression signature to watch for on any future `proxy.ts` change: `curl -i https://<host>/api/intake/webhook/whatsapp` must return `403 Forbidden` (bad/missing signature) or a real response — **never** a redirect to `/login`. A `/login` redirect here means Meta's webhook calls are silently failing.

### 25.4 Conversation flow

"Hi" (or any first message) from a recognized, WhatsApp-enabled number starts a new `request_conversations` row and replies with a welcome message plus a list of active Services. From there the state machine walks the sender through picking a service, optionally searching existing knowledge-base issues, picking a sub-category, providing a description, answering the service's dynamic form fields one at a time (§12's `FormField`/`FormSection` model — the same forms Email Intake and the web portal use), optionally attaching a file, and a final review/confirm step before `submitting` creates the real ticket via the same shared `createRequestCore()` every other channel uses (source: whatsapp equivalent of `email_intake`).

### 25.5 Rate limiting

Two separate, deliberately different limiters (`lib/rate-limit.ts`, §4.7): `whatsapp:msg:${orgId}:${from}` at 30/60s for normal traffic, and a **much tighter** `whatsapp:invalid:${orgId}:${from}` at 5/5min specifically for messages from unregistered/not-yet-WhatsApp-enabled senders — kept separate so a legitimate employee who hasn't been enabled yet and retries a few times isn't penalized as harshly as a genuine abuse pattern would be.

### 25.6 What "fully built but not connected" means in practice

Every piece of the above exists in code and passes local testing (webhook signature verification, state machine transitions, the User Master identity match, rate limiting). What has **never happened**, per the codebase's own Stage 8 series of reports (§26.2): a real Meta Business Manager account, WhatsApp Business Account, or phone number has never been registered against this app; no real access token/app secret/verify token has ever been generated or stored; and since there is no public HTTPS deployment at all (§26), Meta has no URL to even call. `META_OPERATOR_HANDOFF.md` is the exact, unexecuted checklist for a human operator with real Meta access to complete this — it requires actions (creating a Meta Business Account, a WABA, a System User, generating tokens) that only a human with that access can perform; no amount of further coding closes this gap.

---

## 26. Hosting & Deployment Status — Local vs. Hosted

**Bottom line, stated plainly: as of this writing, Citykart Desk exists only as a local development environment. There is no live, publicly-reachable deployment anywhere — no hosted web app, no hosted database in active use, no real third-party integration connected.** Every feature described in this document (including everything marked "confirmed working" or "verified live") was verified against `http://localhost:3210` and a local Docker-based Supabase instance, not a production system. This section exists specifically so that going from "fully built locally" to "actually live" is a known, bounded list of external actions rather than a guess.

### 26.1 Source control

- **Repository**: `https://github.com/kumarsuraj84/Citykartdesk` (GitHub), remote name `origin`.
- **Branch model observed**: work happens directly on `main` — there is no feature-branch/PR workflow in use in this environment. Local `main` and `origin/main` are currently in sync at commit `ab36139` ("Implement audit fixes: SLA pause-credit ledger, approval-status restore, business-rules bookkeeping parity, category multi-tenancy bug, file-upload hardening, hydration/race fixes").
- **Everything documented in §23 of this spec, and the entire WhatsApp channel in §25, was built *after* that last commit and has not yet been committed or pushed.** A `git status` at time of writing shows **196 modified/untracked files** — including entire new subsystems (`lib/whatsapp/`, `lib/conversations/`, `lib/push/`, `lib/settings/`, `lib/requests/`, `lib/actions/admin/orgScopeGuard.ts`, `lib/actions/admin/oems.ts`, dozens of new migrations from `20240101000127` through `20240101000137`) and ~25 planning/report markdown files at the repo root (`STAGE_1_REPORT.md` … `STAGE_8_3_REMAINING_ACTIONS.md`, `META_OPERATOR_HANDOFF.md`, `UAT_DEPLOYMENT_HANDOFF.md`, `WHATSAPP_PILOT_RUNBOOK.md`, etc.) and under `docs/` (several 2026-09-10-dated audit/UAT/test-report files).
- **Before pushing "all" to `main`**: since this pushes directly to the shared branch with no review step in front of it, worth a deliberate pass to (a) confirm none of the untracked report/handoff markdown files contain anything sensitive, and (b) decide whether the ~25 root-level `STAGE_*`/pilot-planning markdown files belong in version control at all or should move under `docs/` — they're internal working documents, not user-facing docs, and cluttering the repo root with them is a separate small cleanup worth doing in the same pass. This spec does not perform that commit/push itself; it was not asked to, and pushing to a shared remote is exactly the kind of action to confirm explicitly before doing.

### 26.2 Application hosting (Railway) — configured, not deployed

- **Deployment target**: Railway (per `README.md`, `docs/RAILWAY-DEPLOYMENT.md`), as two independent services from the same repo:
  - The main Next.js app — `railway.toml` at repo root: Dockerfile build, health check `/api/health`, restart-on-failure (3 retries).
  - The standalone Express intake worker (`api/`) — `api/railway.toml`: its own Dockerfile build, health check `/health`.
  - Plus, per `docs/RAILWAY-DEPLOYMENT.md`, up to **four separate Railway cron services** (each just running `node scripts/cron-tick.mjs` on its own schedule — see §22.3) for `/api/business-rules/run`, `/api/alerts/run`, `/api/desktime/sync`, `/api/intake/cron/classify`.
- **Current state: none of these Railway services have ever been created.** Confirmed directly from this codebase's own validation reports (`STAGE_8_2_REAL_META_ACTIVATION_REPORT.md`, `STAGE_8_3_REAL_VALIDATION_REPORT.md`): *"No deployment occurred… no Railway service exists… `NEXT_PUBLIC_APP_URL` is still `http://localhost:3210`."* `UAT_DEPLOYMENT_HANDOFF.md` documents the exact steps to create the first one (Railway project → link this GitHub repo → set env vars → deploy), using a literal `<your-uat-app>` placeholder throughout because no real hostname has ever been assigned.
- **No custom domain exists.** There is nothing to point DNS at yet.

### 26.3 Database hosting (Supabase) — locally active; a hosted project reference exists but is unpopulated

- **Local (what actually runs today)**: a Supabase stack in Docker (`supabase/config.toml`: `project_id = "citykart_desk"`, Postgres 17, API on port `56321` in this environment's `.env.local`, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321`). Every table, RLS policy, and the full 137+ migration history described in §6 lives here and only here.
- **A hosted Supabase project has been `supabase link`-ed at some point**: `supabase/.temp/project-ref` resolves to project ref `thijgmpprwsskuomtxwq` (hosted URL would be `https://thijgmpprwsskuomtxwq.supabase.co`), but **this project has never actually received the migration set** — confirmed by the same Stage 8 reports: *"No hosted UAT project exists… `intake_channels` still has 0 rows in the local instance, confirming no channel work has occurred either."* Treat this linked ref as, at most, a placeholder/previously-created empty project, not a source of truth for anything. Before using it, `npx supabase db push` would need to be run against it, followed by seeding the same reference data (default org, request/task priorities, etc.) the local instance has.
- **Practical implication for "pushing to production"**: standing up a real hosted environment means either (a) pushing the full local migration history to that already-linked (but empty) project, or (b) creating a fresh Supabase project and linking to that instead — either way, this has not happened yet, so there is currently no tenant data, no seeded org, and no real users anywhere outside the local Docker instance.

### 26.4 Third-party integrations — all coded, none connected

| Integration | Code status | Live/connected status |
|---|---|---|
| **Resend (email)** | Fully implemented (§16) | `RESEND_API_KEY` unset locally — every send is a `[EMAIL DISABLED]` no-op. No production key exists. |
| **Web Push (VAPID)** | Fully implemented (§17) | No VAPID keys generated/configured anywhere (also missing from `.env.example` — a documented gap in §24). |
| **WhatsApp / Meta Cloud API** | Fully implemented (§25) | Zero real Meta assets exist — no Business Manager, WABA, phone number, System User, or token has ever been created. `META_OPERATOR_HANDOFF.md` is the unexecuted checklist. |
| **DeskTime** | Implemented, but **disconnected this session** (§23) | Was connected once (Aug 2026, per the DB record cleared this session) to some DeskTime account; no longer connected to anything. No UI path currently exists to reconnect (§24). |
| **Gmail / Outlook OAuth (Email Intake)** | Fully implemented (§18) | No real Google/Microsoft OAuth app credentials configured; no mailbox has ever been connected. |

### 26.5 What "going live" actually requires — an ordered checklist

None of the following has been done. This is the real, external-action list — no further coding closes any of these gaps:

1. **Commit and push the current 196-file backlog to `origin/main`** (§26.1) — after the sensitivity/cleanup pass noted there.
2. **Create a real hosted Supabase project** (or finish populating the already-linked empty one), run `npx supabase db push`, seed reference data.
3. **Create the Railway project**, link this GitHub repo, create the main web service (env vars from `docs/RAILWAY-DEPLOYMENT.md` pointed at the real hosted Supabase project from step 2), and separately the `api/` worker service if Email/WhatsApp Intake will be used.
4. **Create the Railway cron services** (§22.3) if Business Rules schedules, Alert Rules, or DeskTime sync need to run automatically.
5. **Point `NEXT_PUBLIC_APP_URL` at the real Railway hostname** (or a custom domain once DNS is configured).
6. **Get a Resend account + verified sending domain**, set `RESEND_API_KEY` and the sender address (Admin → Platform Settings → Integrations) — see the earlier in-app guidance already built for this.
7. **Generate real VAPID keys** if Web Push notifications are wanted.
8. **If WhatsApp intake is wanted**: work through `META_OPERATOR_HANDOFF.md` end-to-end with someone who has real Meta Business Manager access, then register the real webhook URL (`https://<the-real-host>/api/intake/webhook/whatsapp`) from step 5.
9. **If Email Intake is wanted**: register real Google/Microsoft OAuth app credentials, then connect a real mailbox from Admin → Intake → Channels.
10. Only after 2–5 are done does the application have any live users, tenant data, or externally-reachable URL at all — everything before that point is local-only, regardless of how "production-ready" the code itself is.

---

## 25. Additional Remediation Pass — Observability, Data-Integrity & UI Fixes

A separate remediation lineage (AI-assisted, prior to and independent of §23's authorship) landed the items below. All files referenced are present and current as of this writing; `npm run typecheck` is clean (0 errors). Not yet folded into §23's narrative, so recorded here for completeness — a rebuild should treat this as equally authoritative.

### Structured observability layer (new infrastructure)
- **`lib/observability/logger.ts`** — structured JSON logger (`logger.debug/info/warn/error`) with automatic secret-key redaction, replacing ad-hoc `console.error` calls across server actions/cron routes/rules engine/notifications.
- **`lib/observability/alert.ts`** — `alertOperator(alert, opts)`: env-gated via `OPERATOR_ALERT_WEBHOOK_URL`, in-memory dedup window so the same failure doesn't page repeatedly. Called from `notify()`'s email fan-out (100%-of-batch failure) and `runNotify()` (Business Rules) on the same condition — both already described as existing behavior in §10.5/§15.1, this is the underlying implementation.
- **`lib/observability/sanitize-error.ts`** — `sanitizeError(err, opts)`: maps raw Postgres `SQLSTATE` codes (23505 unique-violation, 23503 FK-violation, 23502 not-null, 23514 check-constraint, 22P02 invalid-input, 42501 insufficient-privilege, 40001 serialization-failure, 55P03 lock-not-available) plus a `SAFE_AUTH_MESSAGES` set to friendly, non-leaking client-facing strings — applied at ~18 sites in `lib/actions/requests.ts` and comprehensively across `lib/actions/{tasks,projects,approvals,admin/org,auth}.ts`. On rebuild, every server action that surfaces a raw DB error to the client should route through this instead of forwarding `error.message` verbatim (which can leak column/constraint names).

### Module-gating extended to Email Intake's server actions
- `requireModuleEnabled('intake')` (§4.1's pattern) was added to all 33 exported functions across `lib/actions/intake/{channels,communication,flags,reviews,rules,work,brief,detail,pipeline}.ts` — previously the module was only hidden from the sidebar, leaving every Server Action directly callable by a client that knew the export name even when Intake was disabled for the org.

### SLA business-hours misconfiguration
- `lib/sla/business-hours.ts` had a case where an unconfigured/misread business-hours setting silently produced deadlines computed ~5 years in the future instead of failing loudly or falling back sanely — fixed with an explicit guard; `computeSLADeadline()` now returns `Date | null` and callers (`lib/sla/resolve.ts`) handle the null case instead of assuming a valid date.

### Analytics dashboard: negative TAT values
- Root-caused to a small number of anomalous QA fixture rows (bad `responded_at`/`resolved_at` ordering) producing negative turnaround-time hours in the SLA/Analytics dashboards. Fixed via a new `computeTatHours()` (`lib/queries/analytics.ts`, exported) with clamping, plus a `dataAnomalies` count surfaced in the Analytics KPI strip so future bad rows are visible instead of silently skewing averages. `lib/utils/fmt.ts`'s `fmtHours()` also hardened against negative/non-finite input.

### Project Avg Progress showing 0%
- Three independent call sites computed project progress inconsistently (one always returned 0 for non-`done` projects). Unified behind one canonical, dependency-free function: `lib/projects/progress.ts` → `computeProjectProgressPct(status, {done, total})` (100 for done, 0 for cancelled, otherwise `done/total`), used everywhere a project progress percentage is rendered.

### Report Builder route/access-gate fix
- The Report Builder lived under `/admin/reports/pivot`, gated admin-only, even though §19.2 (`ReportViewerScope`) always intended broader per-role access to the `requests` entity. Moved to `app/(app)/reports/pivot/page.tsx` with the correct role-based gate matching `ReportViewerScope`; `components/layout/Sidebar.tsx` href updated to match.

### Mobile navigation overflow (DESK-UI-004)
- `components/layout/MobileNav.tsx`'s bottom tab bar rendered every visible item (up to 8) in a zero-affordance horizontal scroll — effectively invisible past what fit on a narrow screen. Fixed with `MAX_PRIMARY = 4` (provably fits at 320px), folding the remainder into the existing "More" sheet (nothing removed, just relocated); role-specific item ordering preserved.

### Chart X-axis label crowding
- `components/analytics/Charts.tsx` extracted/exported `selectXAxisLabelIndices(length)` — thins X-axis tick labels on narrow charts instead of rendering every label crowded/overlapping. `HorizBar` also gained a `valueLabel` prop, used by `SLADashboard.tsx` to fix a wrong-denominator bug (was dividing by `p.count` instead of `p.resolved`) and reword its breached-count caption.

### Destructive-action visual affordance
- Delete/remove/revoke-style buttons across 7 admin client components (`OrgStructureClient`, `BusinessRulesClient`, `MasterDataClient`, `WorkflowBuilderClient`, `CategoriesAdminClient`, `FormTemplatesAdminClient`, `ServicesAdminClient`) restyled to red, consistent with a DESK-UI-consistency finding that destructive actions were visually indistinguishable from neutral ones.

### Other DESK-UI / small fixes
- `components/requests/SLACountdownClocks.tsx` — countdown labels made directional ("X remaining" vs "X overdue by Y") instead of an ambiguous single duration.
- `app/(app)/admin/audit/AuditLogClient.tsx` — `metadataSummary()` rewritten (now exported/testable) to render a human-readable summary instead of raw JSON; added an `AuditDetailsCell` component.
- `app/(app)/admin/approvals/WorkflowBuilderClient.tsx` — "Configuration incomplete" warning badge for workflows with zero steps.
- `app/(app)/admin/request-config/page.tsx` — "System-managed" badge on the `pending_approval` status row (it's system-set, not admin-editable).
- Six admin `page.tsx` files (`org`, `categories`, `services`, `teams`, `sla-policies`, `form-templates`) had a stray unused `breadcrumbs` prop removed.
- `app/globals.css` — `.page` utility `max-width` widened 88rem → 100rem (confirmed live after resolving a stale dev-server process that was masking the CSS change).

### Full visual/design QA pass
- A dedicated 22-page-type × 6-viewport visual QA sweep was run (see the design-testing and UI-QA reports produced during that pass, if retained alongside this file) producing DESK-UI-### tickets; 11 of 12 identified defects were fixed and regression-tested as part of this remediation lineage (mobile nav overflow and chart label crowding above are two of them).

### Left incomplete, by explicit user instruction ("hold the fixes for now")
- **Approval workflow zero-step safety** (a guard in `submitForApproval()` against submitting into a workflow with zero configured steps, plus the "Configuration incomplete" admin badge above) was mid-edit when work was paused so the user could make their own changes. `npm run typecheck` is clean as of this writing, meaning either that edit was completed correctly or was superseded by subsequent changes — not independently re-verified line-by-line against the original intent.

### Test suite
- This remediation lineage grew the unit suite from 73→198 tests (13→26 files) with coverage for: analytics TAT clamping, project progress, observability alert dedup, business-rules notify-failure logging, cron health envelopes, error sanitization, Intake module-guard enforcement, SLA business-hours, Report Builder access scoping, task priority labels, mobile nav overflow, chart X-axis label selection, audit log summaries. The repository's current full suite (unit + integration) is substantially larger than this — treat `npm test` at rebuild-verification time as the source of truth for present coverage, not the count above.

---

## 26. Git History — Development Eras

Source of truth: `git log` (39 commits on `main`, oldest first). This is the real build order — useful on a rebuild for sequencing (e.g. Business Rules genuinely came *after* three separate legacy rule systems existed and were consolidated, not from a blank slate) and for understanding why some schema/code shapes look historical rather than optimal-from-scratch.

| Era | Commits (oldest→newest) | What happened |
|---|---|---|
| **1. Foundation checkpoint** | `356f6af` | A single squashed baseline commit — "Initial checkpoint before CityKart Desk rebrand and single-tenant conversion." Prior history isn't in this repo; the app began life as a more generic multi-tenant SaaS scaffold. |
| **2. Rebrand & single-tenant conversion** | `43f9aaf`…`959a402` | Multi-tenant SaaS scaffolding stripped, rebranded as "CityKart Desk"; **Projects module + DeskTime integration added**; RBAC hardening; Railway deployment infrastructure introduced; a Docker build-arg fix for `NEXT_PUBLIC_*` env vars. |
| **3. Stabilization & polish** | `b3c9147`…`2822e83` | Signup `org_id` bug fix, Projects-dashboard crash fix (milestones with no end date), missing loading skeletons, first cut of the **Report Builder** + mobile nav fixes, logo/branding passes, Projects added to global search, at-risk-project-count cap bug. |
| **4. Service Catalog & SLA maturation** | `1b20112`…`8370d2e` | Service Catalog delete/audit + admin form-builder improvements; **field-level SLA matrix** introduced; inline conversation attachments; a redesign that removed the older "SLA Targets" concept and unified SLA deadline resolution into one path. |
| **5. Business Rules Engine (major consolidation)** | `466c0d0`…`449f251` | The single biggest architectural change: **Business Rules engine built to consolidate three previously-separate systems** (Routing rules, SLA Escalation rules, unassigned-ticket Alert rules) into one trigger→conditions→actions model (§10). Followed immediately by staleness/stale-snapshot/ghost-comment bug fixes against the new engine, retirement of the old escalation cron route, then AND/OR multi-trigger conditions, an auto work-timer, request reclassification, and an Excel-style requests table. |
| **6. Security/RLS hardening & Requests UX split** | `1e3fbf0`…`8f1e4f6` | Agent role model hardened; RLS visibility leaks fixed in Projects/Intake/Tasks; a real, sev-1-class bug where **ad-hoc approval workflows were missing `org_id`, breaking every approve/reject**; Requests split into separate requester-facing and agent-facing pages; inline edit of submitted form fields; an atomic `form_data` merge to close a concurrent-edit race; per-recipient email sends parallelized in `notify()`/Business Rules. |
| **7. Forms & Service Catalog refinement** | `babd7f1`…`9120e87` | **Form Templates** introduced (design once, tag many services); Service Catalog creation flow simplified (create-from-category, form-building dropped from that flow); dead-end empty states fixed. |
| **8. Approvals & reopen workflow** | `bc29dca`…`b100177` | Approvals overhaul (preview/approve everywhere, SLA pause during approval, an RLS access fix); the **ticket reopen workflow** built (both approval-rejection and resolved-dissatisfaction paths — §8.6/§8.7); approver/manager visibility fixes, SLA countdown clocks, bulk import, forced password reset. |
| **9. Data import & catalog integrity** | `1795e70`…`2c9a8f9` | CSV import Windows-1252-vs-UTF-8 mangling fixed (non-ASCII names in bulk imports); one-service-per-category exclusivity enforced + category CSV export (§13.3–13.4); category description added to the Tag Categories picker as a disambiguator. |
| **10. Structured audit & fix pass** | `ab36139` (current `HEAD`) | The first fully structured, audit-driven remediation commit: SLA pause-credit ledger fix, approval-status restore fix, Business Rules bookkeeping parity, a category cross-org multi-tenancy bug, file-upload hardening, hydration/race fixes (all individually detailed in §23). |

**Beyond `HEAD`**: the working tree carries a large set of uncommitted modifications (`git status`, dozens of `M` files across `app/(app)/admin/**`, `lib/actions/**`, `api/src/intake/store.ts`, etc.) plus this document itself as an untracked file — representing at least two further, not-yet-committed rounds of work: (a) the §23 "Development History" items narrated earlier in this spec, and (b) the §25 observability/data-integrity/UI remediation lineage. Neither is captured as a discrete commit as of this writing — a rebuild reconstructing from git alone would stop at Era 10 and miss both.

---

## 27. QA & UAT Ticket History

Consolidated from nine QA/audit passes conducted 2026-09-09 through 2026-09-10: the original static audit, a runtime UAT pass, three defect-specific fix/validation reports, a remediation-and-re-UAT pass, and three independent test-only passes (functional, design, visual UI). Status below reflects the **latest** document that mentions each ID — a later `NOT TESTED`/`OPEN` finding overrides an earlier "fixed" claim only where the later doc says so; conversely, items confirmed fixed in the remediation pass and re-confirmed passing in the 13:23 Complete Test Report are treated as closed. Source docs are abbreviated: AUDIT = `SYSTEM-AUDIT-2026-09-09.md`, UAT = `UAT-REPORT-2026-09-10.md`, FIX-001 = `DESK-UAT-001-FIX-REPORT-2026-09-10.md`, SEC-D03 = `D-03-SECURITY-VALIDATION-REPORT-2026-09-10.md`, REMEDIATION = `CITYKART-DESK-REMEDIATION-AND-REUAT-REPORT-2026-09-10.md`, COMPLETE = `CITYKART-DESK-COMPLETE-TEST-REPORT-2026-09-10.md`, DESIGN = `CITYKART-DESK-DESIGN-TESTING-REPORT-2026-09-10.md`, UI-QA = `CITYKART-DESK-UI-QA-REPORT-2026-09-10.md`, CHECKLIST = `CITYKART-DESK-MANUAL-UAT-CHECKLIST.md`.

> **Reconciliation with §25 (read this before trusting "Open" below on the DESK-UI-* items):** the UI-QA-REPORT and DESIGN-TESTING-REPORT were both explicitly **test-only** passes ("do NOT redesign or modify UI during this testing pass") — by construction, every finding in them shows as unfixed. A *separate*, later remediation pass (§25 of this spec, same lineage as the observability work) went back and fixed a subset of the DESK-UI tickets these two reports raised, but never produced a written report of its own documenting which — so the QA agent that compiled this section, working only from the `docs/` folder, correctly shows them as open per their source documents even though the code has since moved on. Cross-checked directly against §25's content, the following are **fixed in code, superseding the "Open" status below**: **DESK-UI-001** (destructive-action styling — §25 "Destructive-action visual affordance," the same 7 screens named in DESK-UI-001), **DESK-UI-004** (mobile nav overflow — §25 names it explicitly), **DESK-UI-005** (chart X-axis label collision — §25 "Chart X-axis label crowding"), **DESK-UI-007** (SLA timer missing directional qualifier — §25 "SLACountdownClocks.tsx... directional labels"), and **DESK-UI-012** (Audit Log raw-JSON details — §25 "AuditLogClient.tsx... metadataSummary() rewritten"). The remaining DESK-UI items (002, 003, 006, 008/DESIGN §4.1, 009, 010, 011) and the DESIGN-section-only findings have **no corroborating fix in §25's text** — treat them as genuinely open per the table below rather than assuming the same blanket "11 of 12 fixed" recollection covers them; re-verify directly against current code before relying on either count.

### Authorization & Access Control

- **D-02** — `permission_overrides`/`custom_roles` admin screen ("Permission Matrix") was fully editable UI over rows nothing downstream reads; edits had zero real effect (AUDIT §6.3/§23; UAT reproduced end-to-end). **Mitigated & verified** — editing disabled, "Not enforced — Coming soon" banner added, misleading "enforced via RLS" copy removed in `app/(app)/admin/roles/PermissionMatrixClient.tsx`; 5 component tests pin the non-editable state (REMEDIATION §7). Underlying product question (`BD-01` — wire up for real vs. remove) remains **open**.
- **D-03** — `getFilteredRequests`/`getFilteredTasks` (`lib/actions/analytics.ts`) had no role/team check, used the RLS-bypassing admin client, and trusted caller-supplied filters — any signed-in user could read org-wide requests/tasks by calling the Server Action directly (AUDIT HIGH; also §26 finding #1). **Fixed & verified** — both now scope by caller role/team/ownership via `lib/reporting/access.ts`'s resolver plus a new tasks equivalent; 14 tests, all role/entity combinations (SEC-D03; REMEDIATION §4; re-confirmed COMPLETE §20).
- **D-04** — `addProjectMember`/`removeProjectMember`/`createMilestone`/`updateMilestone`/`deleteMilestone` were role-only, not project-scoped — any agent+ could add themselves as owner of, or edit, any project org-wide (AUDIT MEDIUM–HIGH). **Fixed & verified** — new `canAccessProject()` (reuses `can_view_project()` RPC) gates all four mutations; 8 tests, reproduced failing pre-fix (REMEDIATION §6; COMPLETE §20).
- **D-17** — `oems_select`/`notification_rules_select` RLS had no role gate — any authenticated org member (incl. plain requester) could read the full OEM vendor list and org escalation config (AUDIT MEDIUM; business-intent unconfirmed). **Fixed & verified**, narrowly — both now admin/manager/platform_owner-only via migration `20240101000132`; `stores_select` deliberately left **unchanged** (its own business-intent question is still open). 6 regression tests (REMEDIATION §14; COMPLETE §20).
- **DESK-UAT-001** — Resolved-ticket reopen failed 100% of the time for the requester role with a false "changed by someone else" concurrency error. Root cause: `requests_update` RLS policy has no `requester_id = auth.uid()` clause, so the requester's own RLS-scoped write was silently filtered to zero rows regardless of any real conflict (FIX-001 §1). **Fixed & verified** — the reopen-by-requester write path re-scoped to the service-role client for that one transition only; 7/7 automated + 3/3 live browser re-tests (FIX-001); re-confirmed untouched and still green through REMEDIATION (§2, §18) and COMPLETE (§19, §26 — P0 smoke item going forward).
- **D-08** — `createKbArticle()` resolves `org_id` via an unscoped `organizations.select('id').limit(1)` instead of `profile.org_id` (AUDIT MEDIUM, dormant under single-org). **Open — not investigated in remediation scope** (REMEDIATION §22 explicitly: "should not be assumed resolved").
- **D-10** — `migrateLegacyRulesToBusinessRules()`'s `sla_escalation_rules` read has no `org_id` filter, unlike sibling reads in the same function (AUDIT MEDIUM, dormant). **Open — not investigated** (REMEDIATION §22).
- **D-11** — `deleteCustomRole()` has no explicit `org_id` filter, relies on RLS alone (AUDIT LOW, defense-in-depth only). **Open — not investigated** (REMEDIATION §22).
- **D-15** — `sendFromMessage` (outbound org email, Intake) is role-gated but has no ownership/assignment check — any agent+ can send-as-org-mailbox against any message (AUDIT MEDIUM, reduced from a prior Critical). **Open — not investigated**; Intake is disabled for this org, reducing live exposure (REMEDIATION §22).
- **L-01** (residual of prior H-6) — `exportTasks`/`exportProjects` role check was replaced with team-scoping; any team member can bulk-export up to 10,000 rows per team via direct RPC (AUDIT MEDIUM). **Open, not in remediation scope.**
- **L-02** (residual of prior H-1) — `admin/config.ts`/`admin/task-config.ts` admin-client calls have no org filter; confirmed table-level global-by-design (no `org_id` column exists), a latent multi-tenancy gap (AUDIT MEDIUM, dormant). **Open, not in remediation scope.**
- Historical Critical findings (cross-tenant RLS regressions migrations 033/042, `submitForApproval` TOCTOU race, task-custom-field admin-client bypass, cron/webhook secret-check gap, timing-unsafe secret comparison, `upsert_field_sla_override()` SECURITY DEFINER gap) — all **CONFIRMED FIXED** pre-dating this audit cycle (AUDIT §26, items 14–19); re-listed only for completeness, not re-tested this cycle.

### SLA / Reporting / Analytics Data Integrity

- **D-01** — "SLA Breached" was computed 3 incompatible ways (currently-open-only vs. ever-including-late-closes in the Report Builder/XLSX path), with no UI text explaining the discrepancy (AUDIT HIGH). **Fixed & verified** — new `lib/sla/breach.ts` (`isCurrentlyBreached`/`isEverBreached`/`isEverResponseBreached`/`applyCurrentlyBreachedFilter`) is now the single shared implementation, used by `lib/queries/admin.ts`, `analytics.ts`, `reporting.ts`; UI labels changed to "Currently Breached" to disambiguate. 8 unit tests + 3 boundary cases (REMEDIATION §5); reconciled against controlled seed data and matched exactly in COMPLETE §25.
- **DESK-UI-008 / DESIGN §4.1** — Analytics dashboard shows an identical negative average-resolution-time (`-90m`/`-1.5h`) across 5 independent widgets (KPI tile, Avg/Median Resolution Time, Priority Breakdown, Team Performance, Agent Leaderboard) — a calculation bug (reversed subtraction or timezone offset), not a display artifact (UI-QA, DESIGN). **Open — not fixed**, TEST-ONLY passes only; UI-QA rates severity High, flags as needing a backend fix plus a UI-layer clamp against negative durations. *(Note: §25's separate "Analytics dashboard: negative TAT values" fix addresses a related-sounding but distinct root cause — anomalous QA fixture row ordering, via `computeTatHours()` clamping — found and fixed independently in the other remediation lineage; whether it also resolves this specific 5-widget symptom has not been cross-verified.)*
- **DESIGN §4.2** — "Avg Progress" on Projects analytics always shows 0%, even for owners with multiple "Done" projects, inconsistent with the page's own Status Mix (7 Done overall) — unticketed data-integrity defect, real production data. **Fixed in code per §25** ("Project Avg Progress showing 0%" — `computeProjectProgressPct()` unified across all three prior call sites), though DESIGN itself (the only doc that raised this) never re-tested it.
- **DESK-UI-009 / DESIGN §4.8** — "SLA Compliance by Priority" figure missing its `%` suffix, inconsistent with adjacent compliance metrics on the same page. **Open — not fixed**, Low severity (UI-QA).
- Reopen `response_due_at` staleness — never recomputed on ticket reopen, in both status-machine implementations (AUDIT §10.6). **BUSINESS DECISION REQUIRED, code unchanged** — explicitly deferred through UAT, FIX-001, and REMEDIATION §8/§21 (four framed unresolved questions on intended semantics); still open in COMPLETE §35.

### Notifications & Email

- **D-05** — No HTML/email escaping anywhere; user-controlled titles/comments/names interpolated directly into outbound HTML across 7 templates, Business Rules email action, OEM auto-routing, alert emails, and scheduled-report email (AUDIT HIGH; also §26 finding #2). **Fixed & verified** — new `lib/email/escape.ts` (`escapeHtml`/`escapeEmailFields`) applied at every site; 9 unit tests using the exact specified XSS/HTML payloads, all render as inert text (REMEDIATION §15; re-confirmed COMPLETE §20). **Residual, deliberately unfixed**: Intake's own SMTP reply-compose path forwards user-authored HTML verbatim by design and needs a real sanitizer, not blanket escaping — flagged as open if Intake is ever enabled.
- **D-06** — Duplicate `request_reopened` notification when requester=assignee and a third party reopens (2 rows for 1 event) (AUDIT LOW). **Fixed & verified** — per-call `notifiedUserIds` dedup set; 1 regression test (REMEDIATION §11).
- **D-07** — Alert Rules' "In-App" channel checkbox had no real effect; Push had no admin control surface for 6 event types (AUDIT MEDIUM). **Fixed & verified**, with a correctness correction made mid-fix: `notify()` is always called (preserving cron dedup) and the row is archived immediately after if `in_app` isn't selected, avoiding a naive fix that would have caused email-only rules to resend every cron tick. 2 regression tests including a second-tick no-resend check (REMEDIATION §11).
- **DESK-OBS-002** — Business Rule email-action failures are completely silent: `runNotify()` in `lib/rules/actions.ts` discards `sendEmail()`'s return value with zero logging. **Open — not fixed**, MEDIUM severity, flagged P1 "fix before production" (COMPLETE §33/§38).

### Tasks & Projects

- **D-09** — `deleteTask()` omitted `platform_owner` from its permitted-deleter check — a false "not authorized" error (AUDIT LOW). **Fixed & verified** — now includes `platform_owner`; 1 regression test, reproduced failing pre-fix (REMEDIATION §12).
- **D-16** — `createTask()` had no role check at all, contradicting the (non-enforced) Permission Matrix's own displayed claim (AUDIT LOW–MEDIUM). **Fixed & verified** — now requires agent-tier+; 3 regression tests (REMEDIATION §12).
- Item 6 / Assignment RBAC — audited as a possible gap; **NOT REPRODUCED**, code was already correct (role check, team-membership defense-in-depth, concurrency guard all present). 6 new regression tests added to pin the already-correct behavior (REMEDIATION §9).
- **DESK-UI-003** — Task priority displayed as "Medium" in the list view but "Normal" in the Task Detail modal for the identical record — two different label sets (request-priority vs. task-priority enums) never reconciled. **Open — not fixed**, High severity (data trust) (UI-QA). *(§25's `TASK_PRIORITY_LABELS` canonicalization work targets label-mismatch bugs of exactly this shape — plausibly the same fix, but not confirmed against this specific list-vs-modal pairing.)*
- **DESIGN §4.9** — Every row in Service Catalog/Service Management shows "Unassigned" ownership — likely a data-completeness gap, not a UI bug. **Open, unticketed observation.**

### Intake (module currently disabled for this org)

- **D-13** — Reading-pane race condition: rapid message switching has no request-id guard before committing state, can show the wrong message's content (AUDIT MEDIUM, confirmed still present). **Open — not investigated in remediation scope** (REMEDIATION §22).
- **D-14** — `intake_messages` likely missing base `GRANT UPDATE ... TO authenticated` at the Postgres privilege level despite the RLS UPDATE policy existing (AUDIT HIGH if live). **Open — static-analysis only, never confirmed against the live DB**, not investigated in remediation scope.

### Org / OEM / Admin Bookkeeping

- **D-12** — `createOem()`/`updateOem()` called `revalidatePath('/admin/oems')`, a route that doesn't exist (real route is a tab inside `/admin/org`); only `deleteOem()` revalidated correctly (AUDIT LOW). **Fixed & verified** — all three now call `revalidatePath('/admin/org')`; 3 regression tests (REMEDIATION §3, §17).

### Monitoring & Observability

- **DESK-OBS-001** — No external error monitoring (no Sentry/APM equivalent) and no operator alerting mechanism (no Slack/PagerDuty/webhook) anywhere in the codebase; all 4 cron routes always return HTTP 200 even on internal failure. **Superseded by §25's observability layer** — `lib/observability/alert.ts`'s `alertOperator()` (env-gated via `OPERATOR_ALERT_WEBHOOK_URL`, deduped) and the cron-route "health envelope" tests (§25's test list) directly address the alerting gap this ticket raised; whether it's wired to every one of the 4 cron routes specifically has not been re-verified line-by-line against this ticket's exact wording. Originally flagged P1 "fix before production" (COMPLETE §33/§38).
- **DESK-OBS-003** — Raw database/auth error messages returned to end users, sampled across `tasks.ts`, `projects.ts`, `approvals.ts`, `admin/*.ts`, `auth.ts`, `requests.ts` — no PII/secret leakage found in sampled messages but the pattern is broad. **Fixed in code per §25** — `lib/observability/sanitize-error.ts`'s `sanitizeError()` applied at all the exact files this ticket names (`requests.ts` ~18 sites, plus `tasks/projects/approvals/admin/org/auth`), which is precisely this ticket's ask; treated as closed even though no doc in `docs/` re-tested it against this specific ticket ID.
- Config audit finding: `getEnabledModules()` module-disable gate is inconsistently applied — none of the 10 files under `lib/actions/intake/` nor `lib/actions/analytics.ts` check it, meaning Server Actions for a disabled module may still be reachable. **Partially fixed per §25** — all 33 functions across the 9 `lib/actions/intake/*.ts` files now call `requireModuleEnabled('intake')`; `lib/actions/analytics.ts` was **not** mentioned in §25 and should be treated as still open until checked directly. Originally flagged P2 (COMPLETE §21/§38).
- SLA business-hours misconfiguration fallback (`lib/sla/business-hours.ts:103`) — if every `business_hours` row is inactive, deadline calculation silently returns a date ~5 years out with no warning. **Fixed in code per §25** — `computeSLADeadline()` now returns `Date | null` instead of a far-future fallback, with `lib/sla/resolve.ts` handling the null case; matches this finding's exact file/line-area.

### Navigation / UX

- **DESK-QA-001** — Sidebar shows a "Report Builder" link to Requester/Agent roles (matching the feature's own per-role data-scoping design in `lib/reporting/access.ts`), but a blanket layout-level gate in `app/(app)/admin/layout.tsx` silently redirects them to `/home` with no explanation. Reproducible 100% of the time. **Open — BUSINESS DECISION REQUIRED**: either the layout gate is wrong, or the sidebar link/its code comment are stale; not resolvable without product intent (COMPLETE §29/§35, latest and only mention). *(§25's Report Builder route move — off `/admin/reports/pivot` onto `app/(app)/reports/pivot/page.tsx` with a role-based gate — looks like it directly targets this exact ticket; likely fixed, but not independently re-verified against this ticket's specific repro steps.)*
- **DESK-UI-006** — Breadcrumbs present on 6 of 18 admin pages, absent on the other 12, no discernible pattern. **Open — not fixed**; §25's breadcrumbs change (6 `page.tsx` files had a stray *unused prop* removed) is a different, unrelated cleanup — not a fix for this consistency issue. Medium severity (UI-QA).
- **DESK-UI-010** — Sidebar label "Task Templates" links to the broader "Task Configuration" page; sidebar label "Jobs" links to a documentation browser (`/admin/runbooks`), not a job/cron status page. **Open — not fixed**, Low severity (UI-QA, DESIGN §4.6 — same finding, both open).
- **DESIGN §4.3** — "Manager Approval" workflow has zero configured steps yet is bound to all 7 live services; every other workflow has ≥1 step. **Open — BUSINESS DECISION REQUIRED**: confirm whether this is an in-progress placeholder or a live approval gap (DESIGN, latest and only mention). *(§25's paused "Approval workflow zero-step safety" item — a `submitForApproval()` guard plus a "Configuration incomplete" admin badge — is a defensive code fix for this exact scenario, but was left mid-edit per explicit user instruction; the underlying product question is still unanswered either way.)*
- **DESIGN §4.4** — "Pending Approval" request status is labeled "Terminal" in the Lifecycle matrix, the same tag used for true end states (Closed/Cancelled), even though it transitions via the approval-decision path — cosmetic/confusing, not functional. **Open, unticketed observation.**
- **DESIGN §4.5** — "Auto-close after resolution (days)" is independently editable in two separate admin screens (Platform Settings → General and Request Configuration → General), risking drift. **Open, unticketed observation.**

### UI / Visual Design (all from the 14:04 UI-QA pass — TEST-ONLY at the time; see the reconciliation note above for which have since been fixed)

- **DESK-UI-001** — Destructive "Delete" actions use identical color/weight to non-destructive "Edit" actions app-wide (Org Structure, Business Rules, Approval Flows, Master Data, Categories, Form Templates, Service Catalog). High severity. **Fixed per §25** (see reconciliation note).
- **DESK-UI-002** — Agent Requests/Team Queue and Projects tables use a fixed ~1350–1400px width that underfills ultra-wide screens (leaves ~65% blank at 1920×1080) while still requiring horizontal scroll, and overflows at 1366×768/1024×768. **Open — not fixed**, Medium severity.
- **DESK-UI-004** — Bottom nav bar overflows/clips at 390px mobile width (vs. correct behavior at 375px): "Tasks" label clips to "Ta", "Approvals" pushed fully off-screen while "More" stays visible — inconsistent breakpoint logic. High severity. **Fixed per §25** (see reconciliation note).
- **DESK-UI-005** — Volume Trend chart X-axis date labels collide/overlap at 768px tablet width (no responsive label-thinning). Medium severity. **Fixed per §25** (see reconciliation note).
- **DESK-UI-007** — "Resolution" SLA timer lacks a directional qualifier (e.g., "to spare") unlike the adjacent "Response" timer on the same status bar. Low–Medium severity. **Fixed per §25** (see reconciliation note).
- **DESK-UI-011** — Service Catalog and other low-record admin pages leave ~70% blank vertical space at 1440×900/1920×1080. **Open — not fixed**, Low severity, cosmetic.
- **DESK-UI-012 / DESIGN §4.10** — Audit Log "Details" column shows raw JSON instead of a human-readable action summary. **Fixed per §25** (see reconciliation note); both docs agree it was open as of their own testing.

### Open / Not Yet Verified

Everything below has no confirmed-fixed status in the latest available document, and no corroborating fix found in §25's text either — listed conservatively per instruction (ambiguous ⇒ open):

- **D-08, D-10, D-11, D-13, D-14, D-15** — all six explicitly excluded from the remediation pass's scope; REMEDIATION §22 states they "should not be assumed resolved."
- **L-01, L-02** — residual/latent authorization and multi-tenancy gaps from the original audit, never revisited.
- **DESK-OBS-002** — silent Business Rule email-action failures (`runNotify()` discards `sendEmail()`'s return); no corresponding fix identified in §25.
- **DESK-UI-002, 003 (plausible but unconfirmed), 006, 009, 010, 011** and **DESIGN §4.1 (=DESK-UI-008), §4.3 (defensive fix attempted, product question still open), §4.4, §4.5, §4.9** — see each item above for specifics; several have a plausible-but-unconfirmed §25 fix flagged inline, treat those as "likely fixed, re-verify before relying on it" rather than definitively open or closed.
- **BD-01** (Permission Matrix: wire up for real vs. remove) and **`stores_select` role scoping** (business-intent unconfirmed) — open product/business decisions carried across every pass since the original audit.
- **Reopen `response_due_at` staleness** — explicitly unresolved business decision, code unchanged through every pass.
- **Item 7 (Approval extended UAT), Item 15 (full Task regression), Item 16 (full Project regression), Item 17 (dashboard/export KPI reconciliation beyond SLA-breach), Item 18 (remaining safe-UAT gaps), and the Final Re-UAT flows A–G** — never attempted in any pass; explicitly excluded from every "GO WITH CONDITIONS" release recommendation issued (UAT §31, REMEDIATION §23, COMPLETE §39).
- `lib/actions/analytics.ts`'s module-disable gate (distinct from the Intake module-guard fix, which is confirmed) — not confirmed either way.
