# D-03 SECURITY VALIDATION REPORT

**Finding:** `getFilteredRequests()` / `getFilteredTasks()` authorization gap
**Date:** 2026-09-10

## 1. Runtime Reproduction Result

**REPRODUCED — and worse than the static audit description.** The audit described "insufficient role/team validation." Runtime testing against the real, unmodified Server Actions (via the Vitest + real-Supabase integration harness, calling `getFilteredRequests()` directly with real per-role authenticated clients — no browser, no page guard in the loop) showed there was **no scoping at all** beyond the organisation boundary: a plain requester's *default, filter-less* call already returned every request and every task in the org, not just their own. Caller-supplied `teamId`/`assignedTo` filters could be used to target any other team/user's data explicitly, but exploiting them wasn't even necessary.

Pre-fix run, 8 of 11 assertions failed:
```
[D-03 repro 2] Requester A sees requestB? true | total rows: 6
[D-03 repro 5] Agent A sees requestB (Team B)? true | total rows: 6
[D-03 repro 6] Agent A + teamId=teamB sees requestB? true | total rows: 1
[D-03 repro 6b] Agent A + assignedTo=agentB sees requestB? true | total rows: 1
[D-03 repro 7b] Agent A sees taskB (Team B)? true | total rows: 2
[D-03 repro 7c] Agent A + teamId=teamB sees taskB? true | total rows: 1
[D-03 repro 7d] Requester A task query -> rows: 2 error: undefined
```
(full list of 8 failures in the test run log; 3 of 11 assertions — "requester sees own request," "agent sees own team" — passed only because those are a strict subset of "sees everything.")

**Classification:** UNAUTHORIZED BUT ALLOWED — SECURITY DEFECT, for every role tested except admin/platform_owner (for whom org-wide access is correct/intended).

**`D-03 DEFECT REPRODUCED`**

## 2. Exact Root Cause

Both functions in `lib/actions/analytics.ts` queried via `createAdminClient()` — the service-role client, which bypasses Row-Level Security entirely — after checking only:
```ts
const profile = await getCurrentProfile()
if (!profile) return { data: [], error: 'Not authenticated.' }
if (!profile.org_id) return { data: [], error: 'Your account is not linked to an organisation.' }
```
No further check narrowed the query to the caller's own requests, their team's requests, or their assigned tasks. The only `WHERE` clause applied unconditionally was `.eq('org_id', profile.org_id)`; every other clause (`status`, `priority`, `teamId`, `assignedTo`, date ranges) came directly from the caller-supplied `filter` object with no cross-check against the caller's actual role/team/identity. `getFilteredTasks()` (not directly exported, but reachable through `getFilteredRequests({ _module: 'tasks', ... })`) had the identical pattern on the `tasks` table.

## 3. Roles/Data Exposed

- **Affected:** `user` (requester), `agent` — both could retrieve **every** request and **every** task in the organisation, across all teams and all other users, via this one Server Action.
- **Not affected (correctly broad by design):** `manager`, `admin`, `platform_owner` — these roles are intended to see broad/org-wide data through this reporting surface; their access was not a defect.
- **Entities:** both `requests` and `tasks` (routed through the same function via `_module`).
- **Max rows per call:** 50 (the query's `.limit(50)`), but unlimited in aggregate — an attacker could page through the entire org's requests/tasks 50 at a time by varying `status`/date-range filters, none of which were validated.
- **Widening filters confirmed exploitable pre-fix:** `teamId`, `assignedTo` (directly named in the audit); `status`/date-range filters don't widen scope by themselves but do let an attacker partition a full-org dump into retrievable pages.
- **No real employee data was accessed at any point** — all reproduction used isolated UAT fixtures (`tests/setup/fixtures-d03.ts`), never the live org's actual requests/tasks/users.

## 4. Files Changed

- **`lib/actions/analytics.ts`** — the only production file changed. `getFilteredRequests()` now calls `authorizeReportAccess('requests')` (existing helper, unmodified) instead of a bare `getCurrentProfile()`/`org_id` check, and applies the resolved scope to the query. `getFilteredTasks()` now takes the caller's `profile` (not just `orgId`) and applies a new small local scope resolver, `resolveTaskAccess()`, modeled directly on the live `tasks_select` RLS policy.
- No other file, no RLS policy, no migration, no schema change.

New test infrastructure (additive only):
- `tests/setup/fixtures-d03.ts`
- `tests/integration/d03-authorization.test.ts`

## 5. Authorization Model After Fix

**Requests** — reuses `lib/reporting/access.ts`'s `authorizeReportAccess('requests')`, the same scope resolver already used by the report builder (`lib/queries/reporting.ts`) for this exact entity, so "who can see which requests" is defined in exactly one place:
| Role | Scope |
|---|---|
| `user` | own (`requester_id = self`) |
| `agent` | assigned to or requested by self (`assigned_to = self OR requester_id = self`) |
| `manager` | their own team(s) only (`team_id IN <profile.team_members' teams>`) |
| `admin` / `platform_owner` | all (org-wide) |

**Tasks** — no existing shared helper covered tasks at this granularity (`lib/reporting/access.ts` treats every non-`requests` entity as admin/manager/platform_owner-only, which would incorrectly block agents from this feature entirely). Instead, a new local resolver (`resolveTaskAccess()`, in the same file, not exported elsewhere) mirrors the actual `tasks_select` RLS policy already enforced at the database level for every other task read in the app:
| Role | Scope |
|---|---|
| `user` | none — tasks are an agent-tier-and-above concept in this app (`isAgentOrAboveRole()` in `lib/actions/tasks.ts`; `tasks_select` RLS has no clause for a plain user at all) |
| `agent` | assigned to or created by self, OR any `task_type='team'` task on a team they belong to |
| `manager` / `admin` / `platform_owner` | all (org-wide) — this matches `tasks_select`'s unconditional role clause, which (unlike the reporting convention for requests) does **not** restrict managers to their own team for tasks |

In both cases, caller-supplied filters (`teamId`, `assignedTo`, ...) are still applied — they narrow further via SQL `AND`, but can never widen past the resolved scope, since the scope clause and the caller's filter are ANDed together in the same query.

Authorization is enforced entirely inside the Server Action, using the caller's real identity (`getCurrentProfile()`, itself derived from the verified session) — no page-level route guard is relied on anywhere in this fix.

## 6. Tests Added

`tests/integration/d03-authorization.test.ts` — 14 cases, calling the real, unmodified `getFilteredRequests()` action with real per-role authenticated clients against the real local Postgres instance:

**Requests:** requester own access; requester cross-user denial (unfiltered + filter-widening attempt); requester cross-team denial; agent allowed-team access; agent cross-team denial (both `teamId` and `assignedTo` widening attempts); manager expected access (own team only, confirmed team-boundary); admin expected access (both teams); platform_owner expected access (both teams).

**Tasks:** requester denied entirely (no task scope); agent allowed-team access; agent cross-team denial; manager expected access (both teams — the tasks/requests manager-scope asymmetry is asserted explicitly and explained in a code comment); admin expected access; platform_owner expected access.

`tests/setup/fixtures-d03.ts` builds fully isolated fixtures per run — two teams, two services, two requesters, two agents (one per team), one manager (team-A-scoped), one admin, one platform_owner, one request and one team-type task per team — torn down in `afterAll`. Independent of, and does not modify, the DESK-UAT-001 fixtures/tests.

## 7. Test Results

```
$ npx vitest run tests/integration/d03-authorization.test.ts
 ✓ tests/integration/d03-authorization.test.ts (14 tests) 3410ms
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

Full suite, including DESK-UAT-001 (untouched, still green):
```
$ npm test
 ✓ tests/integration/d03-authorization.test.ts (14 tests) 3624ms
 ✓ tests/integration/desk-uat-001-reopen.test.ts (7 tests) 2498ms
 Test Files  2 passed (2)
      Tests  21 passed (21)
```

## 8. Typecheck / Lint / Build Results

```
$ npm run typecheck
(no output — 0 errors)
```
```
$ npm run lint
✖ 3 problems (0 errors, 3 warnings)
```
All 3 warnings are **pre-existing**, in files this fix did not touch (`components/projects/NewMilestonePanel.tsx`, `components/projects/NewProjectPanel.tsx`, `components/requests/RequestActionBar.tsx` — confirmed via `git status`; this change touched only `lib/actions/analytics.ts` and the new `tests/` files). 0 errors.
```
$ npm run build
✓ Compiled successfully in 22.4s
✓ Generating static pages using 11 workers (51/51) in 1557ms
```
Production build succeeds; all 51 routes generated with no errors.

## 9. Remaining Risks

- **UI reachability is unchanged, and that's fine.** The one caller of `getFilteredRequests()` (`components/analytics/DetailDrawer.tsx`) is only ever rendered from dashboards under `/admin/reports`, itself gated to `admin`/`manager`/`platform_owner` at the page level. This fix does not change or rely on that page guard — the Server Action now independently enforces the correct scope for every role, so even if that page guard were ever removed or a new caller added for agents/requesters, the action itself would still return only the caller's authorized data.
- **Manager scope asymmetry (requests: own-team-only vs. tasks: org-wide) is intentional and source-grounded** (documented in code comments and §5 above), not an inconsistency introduced by this fix — it reflects two different, already-existing, independently-correct conventions (`lib/reporting/access.ts` for requests reporting; the live `tasks_select` RLS policy for tasks). Worth flagging to product/eng as a candidate for future reconciliation, but out of scope to change here (would be a business-rule change, not an authorization-gap fix).
- **No other Server Action was audited in this pass.** This fix is scoped exactly to `getFilteredRequests`/`getFilteredTasks`, per the assigned task. Any other admin-client-based action should be assumed unverified until separately tested.

## 10. Final Verdict

**D-03 FIX VERIFIED**
