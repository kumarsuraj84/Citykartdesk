# Citykart Desk — Architecture Reference

> **Purpose of this document.** A single, durable place to load full project context
> from any device (desktop or mobile). It was reconstructed from the source of truth —
> the code in this repo and the Supabase migrations (87 as of `20240101000087`, up from
> 66 at last full reconstruction — see `DATABASE.md`'s header note for what's not yet
> reflected) — plus the project briefing.
> Companion doc:
> - [`DATABASE.md`](./DATABASE.md) — complete schema (tables, enums, RPCs, RLS, indexes).

Last reconstructed: 2026-08-06.

---

## 0. Critical constraints (read first)

These are hard rules for anyone (human or AI) working in this repo:

1. **✋ Ask before any risky change.** Confirm before migrations, RLS changes, or
   anything destructive.
2. **📖 This is not the Next.js you know.** Next.js 16 has breaking changes. **Read
   `node_modules/next/dist/docs/` before writing any Next.js code.** Heed deprecation
   notices. (See `AGENTS.md`.)
3. **⚠️ Edge middleware lives in `proxy.ts`, not `middleware.ts`.** Creating a
   `middleware.ts` will conflict and crash the server.
4. **🔑 Never hardcode the service-role key** in a shell command line or commit.
5. **🛠️ Build with `node node_modules/next/dist/bin/next build`** — not
   `npm run build` / `npx next build` (the `.bin/next` shim is broken on Node v26).

### Backend topology
Citykart Desk is a **standalone, single-tenant, in-house application** running against
a single local Supabase project (Postgres + Auth + REST, run locally via the Supabase
CLI/Docker — no hosted project, no shared database, no other product touches this
instance). There is exactly one organization (`CityKart`) seeded in the database, and
all users belong to it. There is no owner portal, no self-serve signup, and no external
system shares this database.

---

## 1. What Citykart Desk is

Citykart Desk is a **single-tenant, in-house service-desk / ITSM app** (think an
internal Jira Service Management / Freshservice, run entirely on Citykart's own
infrastructure): service catalog, tickets ("requests"), tasks, multi-step approvals,
SLAs with business-hours-aware escalation, knowledge base, CSAT, reporting, and an
org-admin surface. There is exactly one seeded organization (`CityKart`); nobody
self-signs-up, and there is no separate operator/owner portal or external system
sharing the database.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js **16.2.9**, App Router (React Server Components + Server Actions), React 19 |
| Language | TypeScript |
| Database | Supabase (PostgreSQL), run **locally** via the Supabase CLI/Docker |
| Auth | Supabase Auth; session refresh in `proxy.ts` (Edge) |
| Styling | Tailwind CSS 4 + shadcn/ui (`@base-ui/react`), `lucide-react` icons |
| Forms | `react-hook-form` + `zod` |
| Email | Resend (optional, gated by `RESEND_API_KEY` / `EMAIL_ENABLED`) |
| Deployment | Local only — no Vercel/hosted deployment |
| Monitoring | Vercel Speed Insights; `error_reports` table for client-side capture |

Key config files: `next.config.ts` (Turbopack; `ignoreBuildErrors` + `ignoreDuringBuilds`
both **on** by design — types are generated after migrations, lint runs separately),
`.nvmrc` (Node 20), `supabase/config.toml` (local Supabase stack).

---

## 3. High-level architecture

### 3.1 Edge layer — `proxy.ts`
Runs on (almost) every request. Responsibilities:
1. **Session refresh** via `supabase.auth.getClaims()` (falls back to `getUser()` — never
   `getSession()` — per Supabase docs).
2. **Auth redirects**: unauthenticated → `/login?next=…`; authenticated on `/login` or
   `/` → `/home`.

There is no per-module licensing/gating anymore — the single seeded org has every
module enabled, so any authenticated user can reach any route their role allows.
Public/auth routes and static assets bypass the redirect logic. Matcher excludes
`_next/static`, `_next/image`, `favicon.ico`.

### 3.2 Route groups (`app/`)
- **`(auth)`** — `/login`, `/forgot-password`, `/reset-password`. No public signup —
  accounts are created by an admin. Redirects logged-in users to `/home`.
- **`(app)`** — the authenticated product. Layout bootstraps the shell (see §4).
  Core: `/home`, `/requests` + `/requests/[id]`, `/tasks` + `/tasks/[id]`,
  `/approvals`, `/services` (+ category/subcategory routes), `/notifications`,
  `/profile`.
- **`(app)/admin`** — large org-admin surface: `users`, `teams`, `roles`, `org`,
  `departments`, `locations`, `master-data`, `categories`, `services`,
  `request-config` (SLA, business hours, holidays, alert/escalation rules),
  `task-config`, `routing`, `approvals` (workflow builder), `runbooks`,
  `knowledge-base`, `monitoring`, `reports`, `audit`, `settings`.
- **`api`** — `auth/callback` (OAuth/recovery code exchange), `api/health`,
  `api/alerts/run`, `api/escalation/run`, `api/admin/audit`.

### 3.3 Supabase clients (`lib/supabase/`)
- `server.ts` — server components / actions; **respects RLS**; cookies via `next/headers`.
- `client.ts` — browser client; respects RLS via user session.
- `admin.ts` — **service-role**, server-only, **bypasses RLS**. Used only for internal
  writes: `request_activity` / `task_activity` (append-only audit), `notifications`,
  approval state transitions, escalation events, and the `proxy.ts` module check.

---

## 4. Performance architecture (the "5-day sprint")

The app is tuned for the cross-region round-trip cost between the Edge and Supabase
Mumbai. Patterns to preserve:

- **Deferred layout bootstrap** (`app/(app)/layout.tsx`) — blocks render on only **2**
  queries (`getEnabledModules()` + `getTrialInfo()`). It kicks off `navCountsPromise`
  and `notificationsPromise` **without awaiting**, and passes the *promises* to
  `AppShell`, which wraps them in `<Suspense>` via `DeferredSidebar` /
  `DeferredNotificationBell`. Result: the shell paints before nav badges resolve.
- **`React.cache()` dedup** — `getCurrentProfile()` and `getEnabledModules()` are
  `React.cache()`-wrapped. The layout calls them first; when a page calls them again
  they return from cache with no second DB round trip.
- **Home page streaming** (`app/(app)/home/page.tsx`) — the greeting header renders
  immediately (just `profile.full_name` + `new Date()`). The `get_home_dashboard` RPC
  is started **without await**; `<DashboardBody>` awaits the promise inside a
  `<Suspense fallback={<DashboardSkeleton/>}>`.
- **Request detail two-phase fetch** (`app/(app)/requests/[id]/page.tsx`) — collapsed
  from 3 sequential round trips to **2**:
  - **Phase 1** (need only `id`, all parallel): `request`, `activity`, `comments`,
    `attachments`, `collaborators`, `approvals`, `linkedTasks`, `activeTimer`,
    `relatedRequests`.
  - **Phase 2** (need Phase 1 results): `teamMembers` (from `request.team_id`),
    `csatSurvey` (from requester check).
- **`get_home_dashboard` RPC** — a single SECURITY DEFINER function returning all home
  KPI counts + row data (my requests, my queue, task buckets), replacing ~6–20 queries.
  Signature in `DATABASE.md`.
- **Route-level `loading.tsx` skeletons** added across routes so navigations show
  instant feedback.

Sprint log: Day 1 nav-count fix + skeletons · Day 2 region pin · Day 3 deferred
nav/notifications via Suspense · Day 4 request-detail 3→2 round trips · Day 5 home
greeting-immediate + dashboard streaming.

---

## 5. Domain model & request lifecycle

Full schema in [`DATABASE.md`](./DATABASE.md). Roles enum (authoritative, from schema):
`user`, `agent`, `manager`, `admin`, `platform_owner`.

### Request lifecycle
1. **Create** (`lib/actions/requests.ts → createRequest`): validate form against the
   service's schema snapshot → auto-assign via `lib/routing/assign.ts`
   (`resolveAssignee`: direct / round-robin / load-balanced) → compute SLA deadline via
   `lib/sla/business-hours.ts` (`computeSLADeadline`, business-hours + holiday aware) →
   insert → log activity → notify requester / assignee / team.
2. **Status transitions** — gated by `lib/constants/request-transitions.ts`
   (`AGENT_TRANSITIONS` vs `REQUESTER_TRANSITIONS`; single source of truth shared by
   server actions and client UI). Note: `open → assigned` is **not** a manual
   transition — `assigned` is reached only via `assignRequest()`.
3. **Approvals** (`lib/actions/approvals.ts`) — ad-hoc or workflow-based; request goes
   `pending_approval`; approvers notified; on full approval the hold releases, on reject
   it returns to `open`. Schema supports multiple approvals per request (the old UNIQUE
   was dropped in migration 031).
4. **Tasks** (`lib/actions/tasks.ts`) — work items linked to a request (or personal/
   team), with subtasks, comments, activity, custom fields.
5. **SLA & escalation** — `api/escalation/run` fires `sla_escalation_events` and
   `sla_warning` / `sla_breached` notifications by % elapsed; `api/alerts/run` handles
   `due_soon` / `overdue` / `unassigned` / `daily_digest`.
6. **Resolution → closure → CSAT** — `resolved` → `closed`; `csat_surveys` captures a
   1–5 rating.

### Notification pipeline
`server action → logActivity() (admin client → *_activity) → notify() (checks
notification_preferences → notifications table) → [async] Resend email`.
Helpers: `lib/notifications.ts`, `lib/activity.ts`, `lib/email/*`.

---

## 6. Code map

```
proxy.ts                     Edge: session refresh + auth redirects
app/(app)/layout.tsx         App shell bootstrap, deferred nav counts/notifications
app/(app)/home/page.tsx      Home dashboard (Suspense streaming, get_home_dashboard RPC)
app/(app)/requests/[id]/     Request detail (2-phase parallel fetch)
app/(app)/admin/**           Org-admin surface
app/api/{alerts,escalation}/run   Cron endpoints (x-cron-secret)
lib/actions/**               Server actions (requests, tasks, approvals, auth, admin/*)
lib/queries/**               Read layer (profiles, requests, tasks, approvals, services, analytics, …)
lib/sla/business-hours.ts    SLA deadline computation
lib/routing/assign.ts        Auto-assignment strategies
lib/notifications.ts         notify() + preference filtering
lib/activity.ts              Append-only activity logging (admin client)
lib/email/**                 Resend integration + templates
lib/constants/**             request-transitions (SSoT), styles/labels, canned responses
lib/supabase/{server,client,admin}.ts   Supabase clients
components/{layout,requests,tasks,forms,admin,analytics,ui}/   UI
types/{index,database}.ts    Domain types + generated Supabase types
supabase/migrations/**       87 migrations (see DATABASE.md §evolution)
```

---

## 7. Background jobs & ops

- **`GET /api/escalation/run`** (header `x-cron-secret`) — SLA warnings/breaches.
- **`GET /api/alerts/run`** (header `x-cron-secret`) — task due/overdue, unassigned
  requests, daily digest.
- **`GET /api/health`** — DB connectivity + latency (for uptime checks).
- **`GET /api/admin/audit`** — paginated `request_activity` + `task_activity`, gated to
  admin/manager/platform_owner.
- **Rate limiting** — `lib/rate-limit.ts` is **in-process** (per-replica). For
  multi-replica scale, move to Redis/Upstash. Used on login (10/60s) and forgot-password
  (5/5min).

Required env (not in repo): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` (optional), cron secret.

---

## 8. Pending / planned work

**Ticket Collaborators feature** — saved plan at
`.claude/plans/resilient-stargazing-lagoon.md`. Summary:
- Agents can add other team members to a ticket **without** changing the primary assignee.
- Collaborators can **read + comment** but **cannot** reassign / change status / change
  priority.
- Needs: `request_collaborators` table migration (**already exists** in schema — see
  `DATABASE.md`), RLS policies (helper `is_request_collaborator()` already present),
  `addCollaborator` / `removeCollaborator` server actions (**present** in
  `lib/actions/requests.ts`), and a `CollaboratorsPanel` client component in the request
  detail sidebar.
- The `getRequestCollaborators(id)` query is **already in the Phase-1 parallel fetch** on
  the request detail page — the data is fetched; the **UI just needs to be built/finished**.

> When picking this up: verify what already exists vs. the plan before writing new code,
> and follow the constraints in §0 (read Next 16 docs, ask before risky changes).
