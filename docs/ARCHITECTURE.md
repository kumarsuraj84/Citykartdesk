# CognixDesk — Architecture Reference

> **Purpose of this document.** A single, durable place to load full project context
> from any device (desktop or mobile). It was reconstructed from the source of truth —
> the code in this repo, the 47 Supabase migrations, and the companion `cognix-owner`
> repo — plus the project briefing. Companion docs:
> - [`DATABASE.md`](./DATABASE.md) — complete schema (tables, enums, RPCs, RLS, indexes).
> - [`OWNER-PORTAL.md`](./OWNER-PORTAL.md) — the operator control plane (`cognix-owner`).

Last reconstructed: 2026-06-21.

---

## 0. Critical constraints (read first)

These are hard rules for anyone (human or AI) working in this repo:

1. **🚫 HRMS is off-limits.** HRMS is a separate codebase that *shares the same
   Supabase database*. Any schema migration or RLS change must be **scoped only to
   tables CognixDesk owns**. Never touch HRMS tables.
2. **✋ Ask before any risky change.** Confirm before migrations, RLS changes, or
   anything destructive.
3. **📖 This is not the Next.js you know.** Next.js 16 has breaking changes. **Read
   `node_modules/next/dist/docs/` before writing any Next.js code.** Heed deprecation
   notices. (See `AGENTS.md`.)
4. **⚠️ Edge middleware lives in `proxy.ts`, not `middleware.ts`.** Creating a
   `middleware.ts` will conflict and crash the server.
5. **🔑 Never hardcode the service-role key** in a shell command line or commit.
6. **🛠️ Build with `node node_modules/next/dist/bin/next build`** — not
   `npm run build` / `npx next build` (the `.bin/next` shim is broken on Node v26).

### Backend topology (verified 2026-06-21 — code + owner confirmation)
**Two separate Supabase projects** (plus a Railway REST gateway) — this is the single
most important safety fact in the ecosystem:

| Supabase project | Hosts | Used by | Status |
|---|---|---|---|
| **`kxvdlvarjvtqijzvmegk`** | **HRMS + Owner Portal auth** (shared) | owner portal `ownerClient.ts`; HRMS | 🚫 **OFF-LIMITS** — HRMS data lives here |
| **`jhdzjzrimjjtqwnkrwha`** | **CognixDesk** (dedicated) | owner portal `cognixClient.ts`; the CognixDesk app | ✅ Safe — contains the tables in `DATABASE.md`, no HRMS |
| Railway REST `hrmsapi-production-7125.up.railway.app` | HRMS REST gateway (backed by `kxvdlvarjvtqijzvmegk`) | owner portal `ownerApi.ts` | 🚫 HRMS — do not call/modify |

**Implications:**
- ✅ **CognixDesk schema work is inherently HRMS-safe.** CognixDesk is a *physically
  separate* Supabase project (`jhdzjzrimjjtqwnkrwha`); a CognixDesk migration cannot
  reach HRMS tables — they're in a different database. The "shared DB" risk does **not**
  apply to CognixDesk schema changes.
- ⚠️ **The danger surface is the Owner Portal**, because it connects to *both* projects.
  Any operation it performs against `kxvdlvarjvtqijzvmegk` (its `ownerClient`, or the
  Railway HRMS API via `ownerApi`) can affect HRMS. **Treat all owner-portal code paths
  that touch `kxvdlvarjvtqijzvmegk` / `ownerApi` / the Railway URL as off-limits.**
- The CognixDesk app's production `NEXT_PUBLIC_SUPABASE_URL` is set in Vercel (not
  committed; repo shows only local CLI id `Flow_Desk`). It points at
  `jhdzjzrimjjtqwnkrwha`.

---

## 1. What CognixDesk is

CognixDesk is a **multi-tenant service-desk / ITSM SaaS** (think Jira Service
Management / Freshservice): service catalog, tickets ("requests"), tasks, multi-step
approvals, SLAs with business-hours-aware escalation, knowledge base, CSAT, reporting,
and a large org-admin surface.

It is one of three sub-products in the broader ecosystem:

| Product | Repo / location | Stack | Role |
|---|---|---|---|
| **CognixDesk** | `suraj2build/cognix` (this repo) | Next.js 16 App Router | The service-desk app — end users + org admins |
| **Owner Portal** | `suraj2build/cognix-owner` | Vite + React SPA | SaaS operator control plane (manage orgs, modules, licensing, signups) |
| **HRMS** | *separate repo* | *separate* | HR management system. **Do not touch.** Shares Supabase (boundary to-confirm). |

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js **16.2.9**, App Router (React Server Components + Server Actions), React 19 |
| Language | TypeScript |
| Database | Supabase (PostgreSQL), region **ap-south-1** (Mumbai) |
| Auth | Supabase Auth; session refresh in `proxy.ts` (Edge) |
| Styling | Tailwind CSS 4 + shadcn/ui (`@base-ui/react`), `lucide-react` icons |
| Forms | `react-hook-form` + `zod` |
| Email | Resend (gated by `RESEND_API_KEY` / `EMAIL_ENABLED`) |
| Deployment | Vercel, pinned to **`bom1`** (Mumbai) via `vercel.json` to match Supabase region |
| Monitoring | Vercel Speed Insights; `error_reports` table for client-side capture |

Key config files: `next.config.ts` (Turbopack; `ignoreBuildErrors` + `ignoreDuringBuilds`
both **on** by design — types are generated after migrations, lint runs separately),
`vercel.json` (`{ "regions": ["bom1"] }`), `.nvmrc` (Node 20).

---

## 3. High-level architecture

### 3.1 Edge layer — `proxy.ts`
Runs on (almost) every request. Responsibilities:
1. **Session refresh** via `supabase.auth.getUser()` (never `getSession()` — per Supabase docs).
2. **Auth redirects**: unauthenticated → `/login?next=…`; authenticated on `/login`,
   `/`, or `/signup*` → `/home`.
3. **Module gating**: for `/requests`, `/services`, `/tasks`, `/approvals` it looks up
   the user's `org_id`, then uses a service-role client to check
   `org_module_access.enabled` + `valid_until`. Disabled/expired → redirect to `/home`
   (and `/trial-expired` exists for ended trials).

Public/auth routes and static assets bypass the gating. Matcher excludes
`_next/static`, `_next/image`, `favicon.ico`.

### 3.2 Route groups (`app/`)
- **`(marketing)`** — public landing + `/legal/{privacy,terms}`.
- **`(auth)`** — `/login`, `/signup`, `/forgot-password`, `/reset-password`,
  `/request-access`. Redirects logged-in users to `/home`.
- **`(app)`** — the authenticated product. Layout bootstraps the shell (see §4).
  Core: `/home`, `/requests` + `/requests/[id]`, `/tasks` + `/tasks/[id]`,
  `/approvals`, `/services` (+ category/subcategory routes), `/notifications`,
  `/profile`, `/trial-expired`.
- **`(app)/admin`** — large org-admin surface: `users`, `teams`, `roles`, `org`,
  `departments`, `locations`, `master-data`, `categories`, `services`,
  `request-config` (SLA, business hours, holidays, alert/escalation rules),
  `task-config`, `routing`, `approvals` (workflow builder), `runbooks`,
  `knowledge-base`, `monitoring`, `reports`, `audit`, `settings`.
- **`demo`** — standalone demo mode (no auth), seeded data, demo banner.
- **`api`** — `auth/callback` (OTP/OAuth code exchange), `api/health`,
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

- **Region pinning** — Vercel `bom1` matches Supabase `ap-south-1` (Day 2), eliminating
  cross-region latency.
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
proxy.ts                     Edge: session refresh + auth redirects + module gating
app/(app)/layout.tsx         App shell bootstrap, deferred nav counts/notifications
app/(app)/home/page.tsx      Home dashboard (Suspense streaming, get_home_dashboard RPC)
app/(app)/requests/[id]/     Request detail (2-phase parallel fetch)
app/(app)/admin/**           Org-admin surface
app/api/{alerts,escalation}/run   Cron endpoints (x-cron-secret)
lib/actions/**               Server actions (requests, tasks, approvals, signup, auth, admin/*, owner/*)
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
supabase/migrations/**       47 migrations (see DATABASE.md §evolution)
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
