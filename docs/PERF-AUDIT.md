# CognixDesk — Performance Audit (2026-06-21)

Scope: CognixDesk app (`cognix` repo) + its dedicated Supabase project
`jhdzjzrimjjtqwnkrwha`. HRMS untouched/out of scope. Findings below were produced by a
three-track audit (data-fetching, caching/rendering, database) and then **manually
verified** against the code — items that didn't hold up, or whose suggested fix is unsafe
in this multi-tenant/RLS app, are marked accordingly.

**Already-good baseline** (verified, no action): RLS optimization via
`current_user_team_ids()` (migration 045), the `get_home_dashboard` RPC (044), home-page
Suspense streaming, `DeferredSidebar`/`DeferredNotificationBell`, and `React.cache()` on
`getCurrentProfile`/`getEnabledModules`/`getTrialInfo`.

---

## Resolution status (updated 2026-06-21)

All findings below were implemented on branch `claude/exciting-wright-pen1cy` and verified
with a real `next build` (deps installed locally). Migrations are committed but **must be
applied to the CognixDesk Supabase project manually** (they are not auto-run).

| Item | Status |
|---|---|
| H1 — requests list `select('*')` + exact count | ✅ explicit columns (count left; see note) |
| H2 — service catalog over-fetch | ✅ lean `SERVICE_CARD_SELECT` for browse views |
| H3 — minute-by-minute SLA loop + uncached calendar | ✅ O(days) math + `React.cache` |
| H4 — missing `description` trigram indexes | ✅ migration **047** (apply to DB) |
| H5 — missing list-sort composite indexes | ✅ migration **047** (apply to DB) |
| M1 — eager dnd-kit/calendar in tasks bundle | ✅ `next/dynamic` lazy-load |
| M2 — unbounded dropdown profile fetch | ✅ `.limit(500)` |
| M4 — approval_workflow_steps index | ⏭️ skipped (redundant — `UNIQUE(workflow_id, step_order)` already covers it) |
| Bonus — cross-org leaks (monitoring/audit/templates/workflows) | ✅ switched to RLS client |
| Bonus — per-org SLA config | ✅ migration **048** + code (apply to DB) |
| Bonus — `sla_deadline` ghost column (writes/cron/export) | ✅ → `resolution_due_at`; escalation cron also org-scoped |
| Bonus — CSV export cross-org leak + broken approvals export | ✅ org-scoped; approvals export rewritten |

**⚠️ Apply to DB:** migrations `20240101000047` (indexes) and `20240101000048`
(per-org SLA config). Additive, idempotent, CognixDesk-only.

**Remaining low-priority (not yet done):** drop `count:'exact'` on large request lists in
favour of cursoring/estimates; partial index for the notifications "all" view; optional
`types/database.ts` regeneration to clear stale-types `tsc` noise.

---

## P0 — High impact, do first

### H1. Requests list over-fetches everything (`select('*', { count: 'exact' })`)
`lib/queries/requests.ts:207-217`. Every requests-list view selects `*` — which pulls the
three large JSONB columns `form_data`, `form_schema_snapshot`, `form_sections_snapshot`
that the list never renders — for up to 50 rows/page, **and** runs an `{ count: 'exact' }`
which forces a full filtered count under RLS on every page load.
- **Fix (payload):** replace `*` with the columns the list actually uses
  (`id, request_no, title, status, priority, created_at, updated_at, requester_id,
  assigned_to, service_id, team_id, response_due_at, resolution_due_at`) keeping the
  existing narrow relation selects. Cuts page payload by an estimated 100KB–1MB on busy orgs.
- **Fix (count):** for large lists, avoid `count: 'exact'`. Either drop the total (use
  "next/prev" cursoring) or use Postgres planner estimates. Lower urgency than the column fix.

### H2. Service catalog over-fetch (`SERVICE_SELECT` with `*` + nested `*`)
`lib/queries/services.ts` (`SERVICE_SELECT`). `getCategoriesWithSubCategories()` renders
the whole catalog and pulls `services.*` (incl. `form_fields`, `form_sections`,
`sla_config`, `visibility_scope`) **plus** `category:*`, `team:*`, `approval_workflow:*`,
`escalation_policy:*` for every service. On a 100-service catalog that's hundreds of KB of
unused JSON on a hot page.
- **Fix:** add a lean projection for catalog/tree views
  (`id, name, icon, slug, description, sort_order, is_active` + only the relation fields
  shown). Keep the full `SERVICE_SELECT` for the single-service detail/admin-edit path.

### H3. SLA deadline computed by minute-by-minute loop + uncached config re-fetch
`lib/sla/business-hours.ts`. `computeSLADeadline()` (a) re-queries `business_hours` and
`holidays` from the DB on **every** call, and (b) walks the clock **one minute at a time**
up to `MAX_ITERATIONS = 129,600`. A low-priority 72-business-hour SLA spans ~2 weeks of
calendar minutes ≈ 15–20k iterations per request creation/reopen.
- **Fix:** compute mathematically — skip whole non-business days, then add remaining
  minutes within business windows (O(days), not O(minutes)). Cache the
  `business_hours`/`holidays` reads (rarely change) via `React.cache` or a short TTL.
- **Impact:** server CPU on the write path (`createRequest`, reopen); not user-read
  latency, but it scales badly with request volume.

### H4. Search has no trigram index on `description`
`lib/actions/search.ts` runs `.ilike('description', …)` on `requests` and `tasks`, but only
`title` has a `gin_trgm` index (`idx_requests_title_trgm`, `idx_tasks_title_trgm`). The
description match falls back to a sequential scan.
- **Fix (migration, CognixDesk tables only):**
  ```sql
  CREATE INDEX IF NOT EXISTS idx_requests_description_trgm
    ON requests USING gin (description gin_trgm_ops) WHERE description IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_description_trgm
    ON tasks USING gin (description gin_trgm_ops) WHERE description IS NOT NULL;
  ```

### H5. Missing composite indexes for the actual list sorts
The list views in `getRequests` sort by columns not covered by a matching composite index:
- `view='mine'` → `eq(requester_id) order(updated_at desc)` — existing index is
  `(requester_id, status)`, not `(requester_id, updated_at)`.
- `view='assigned_me'` → `eq(assigned_to) … order(resolution_due_at)`.
- Tasks agent views sort `created_at` with only `(assignee_id, status)` present.
- **Fix (migration):**
  ```sql
  CREATE INDEX IF NOT EXISTS idx_requests_requester_updated
    ON requests (requester_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_assignee_created
    ON tasks (assignee_id, created_at DESC) WHERE status NOT IN ('done','cancelled');
  ```
  (`assigned_me`/`unassigned` already benefit from `idx_requests_resolution_due`; confirm
  with `EXPLAIN` before adding more.)

---

## P1 — Medium impact

### M1. Lazy-load heavy client views (dnd-kit, calendar)
`app/(app)/tasks/TasksClient.tsx` + `components/tasks/TaskBoardView.tsx` eagerly import
`@dnd-kit/*` (~25KB gz) and the calendar view even though the default is the table view.
- **Fix:** `next/dynamic(() => import(...), { ssr: false })` for `TaskBoardView` and
  `TaskCalendarView`, loaded only when that view is selected. Removes ~50KB from the tasks
  route's initial client bundle.

### M2. Unbounded lookup fetches for dropdowns
`lib/queries/tasks.ts` `getAllProfiles()` (assignment dropdown) and the admin user page
(`admin.auth.admin.listUsers({ perPage: 1000 })` + unbounded `profiles` select) fetch
every active profile. Fine at pilot scale, linear blowup at 500+ users.
- **Fix:** `.limit(250)` + switch the dropdown to a typeahead that queries on input
  (there's already `searchUsersForDelegation`-style search to reuse).

### M3. `React.cache()` only where a query is called 2+ times per render
The caching audit suggested wrapping many queries. Verified caveat: `React.cache` only
helps when the same function runs **multiple times in one request**. Worth doing for
`getAllowedStatuses()` in `lib/queries/services.ts` (called by several catalog queries that
each re-read the profile) and any shared admin lookup (`teams`, `profiles`) used by
sibling components. Not worth it for one-shot page queries like `getRequestById`.

### M4. Approval list fetches all steps/decisions, filters in JS
`lib/queries/approvals.ts:73-106` fetches all workflow steps via `.in('workflow_id', …)`
then filters client-side, and `approval_workflow_steps` has no `(workflow_id, step_order)`
index.
- **Fix:** add the index; the in-memory filter is acceptable for small result sets.
  ```sql
  CREATE INDEX IF NOT EXISTS idx_approval_workflow_steps_workflow
    ON approval_workflow_steps (workflow_id, step_order);
  ```

---

## P2 — Low impact / cleanup

- **L1. Redundant `force-dynamic` on 5 admin pages** (`admin/{teams,locations,org,
  knowledge-base,departments}/page.tsx`). These pages already render dynamically because
  they read cookies, so the directive is a no-op. **Remove it as cleanup.**
  ⚠️ **Do NOT** follow the suggestion to add `export const revalidate` / ISR here — these
  pages are per-user, per-org, RLS-scoped; caching their rendered output across requests
  would risk **cross-org data leakage**. Keep them dynamic.
- **L2. `collaborated` view 2-step fetch** (`requests.ts:223-233`) — extra round trip for a
  minor view; acceptable, optionally fold into a single query with an `in` subselect.
- **L3. Duplicate `idx_task_activity_task`** — migration 006 (single-col) shadowed by
  migration 028 (composite). Harmless; drop the old definition in a future cleanup.
- **L4. Add `loading.tsx`** to the slower admin routes for streaming feedback (nice-to-have).

---

## Bonus — correctness bugs found during the audit (verify & fix)

> Not performance, but high-value and cheap to fix. **Confirm before changing.**

- **`lib/queries/admin.ts:154`** queries table **`approval_requests`** — no such table
  (schema has **`approvals`**). The count silently fails → `pending_approvals` is always 0.
- **`lib/queries/admin.ts:156`** filters **`requests.sla_deadline`** — no such column
  (schema has **`resolution_due_at`** / `response_due_at`). `sla_breached` is always 0.
- **Tenant isolation:** this whole block uses the **service-role `admin` client with no
  `org_id` filter**, so the counts span **all organizations**, not the caller's org.
  Verify who calls this (platform-owner-only monitoring vs per-org admin) — if it's shown
  to org admins, it leaks cross-tenant aggregate numbers.

---

## Suggested execution order
1. **H1 + H2** column projections (pure win, no schema change, no risk).
2. **H4 + H5 + M4** index migration (one file, CognixDesk tables only — needs your OK).
3. **H3** SLA rewrite + config caching.
4. **M1** lazy-load task views; **M2** bound the dropdowns.
5. **Bonus bugs** in `admin.ts` (confirm intended scope first).
6. **P2** cleanups.
