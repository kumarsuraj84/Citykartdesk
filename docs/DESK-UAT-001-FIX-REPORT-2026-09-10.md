# DESK-UAT-001 FIX REPORT

**Defect:** Resolved-ticket reopen fails 100% of the time for the requester role, with a false "This request was just changed by someone else — please refresh and try again" optimistic-concurrency error.
**Date:** 2026-09-10
**Scope:** This one defect only. No other behavior was changed.

---

## 1. Root Cause

**CONFIRMED — not a timestamp-precision issue.**

`updateRequestStatus()` in [lib/actions/requests.ts](../lib/actions/requests.ts) uses `const supabase = await createClient()` — the RLS-respecting (`anon`/`authenticated`-role) Supabase client — for the primary status-change write, for every caller (requester and agent alike):

```ts
const { data: updatedRow, error: updateError } = await supabase
  .from('requests')
  .update(updatePayload)
  .eq('id', requestId)
  .eq('status', currentStatus)
  .select('id')
  .maybeSingle()

if (!updatedRow) {
  return { error: 'This request was just changed by someone else — please refresh and try again.' }
}
```

The only guard on this write is `.eq('status', currentStatus)` — there is no `.eq('updated_at', ...)` or any other timestamp-equality condition anywhere in `updateRequestStatus()`. Both `isResolvedReopenByRequester` and `isResolvedReopenByAgent` flow through this exact same statement with no branch-specific logic. This rules out the timestamp-precision hypothesis at the application-code level (see §2).

The actual cause is in the database, not the application. The live `requests_update` Row-Level Security policy (defined in [supabase/migrations/20240101000080_rls_hardening_cross_tenant.sql:374-387](../supabase/migrations/20240101000080_rls_hardening_cross_tenant.sql)) was confirmed via direct introspection of the running Postgres instance:

```sql
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy WHERE polrelid = 'public.requests'::regclass AND polname = 'requests_update';
```

```
USING:      (org_id = current_org_id()) AND
            ((team_id = ANY (current_user_team_ids()))
             OR (current_user_role() = ANY (ARRAY['manager','admin','platform_owner'])))
WITH CHECK: org_id/requester_id/service_id/team_id immutable, same team/manager clause
```

**Neither clause contains any `requester_id = auth.uid()` condition.** A plain `user`-role requester who is not a team member can never satisfy this policy — meaning the RLS-scoped client can never successfully `UPDATE` their own `requests` row, under any status transition, for any reason.

By contrast, `requests_select` (same table) *does* include `requester_id = auth.uid()`, which is why the requester can always read their own ticket (the initial `SELECT` at line ~515 never fails) but can never write to it.

**The mechanism of the false error:** when a requester attempts to reopen their own resolved ticket, the `UPDATE ... WHERE status = 'resolved'` is silently filtered by RLS to zero visible rows *before* the `status = 'resolved'` predicate is even relevant — Postgres reports zero rows matched, `.maybeSingle()` returns `null`, and the code (correctly, for the *actual* race-condition case it was written for) reports this as "someone else changed it." In reality, no concurrent write ever occurred — the requester was simply never authorized to write to their own row via this client, on **any** attempt, which matches the UAT finding of a 100%-reproducible failure with zero real concurrent modifications.

This is a **database-layer authorization gap**, not a timestamp/staleness bug, and not a bug in the concurrency-guard mechanism itself (which works correctly — see §7's genuine-concurrency test).

## 2. Change Made

File: [lib/actions/requests.ts](../lib/actions/requests.ts) — `updateRequestStatus()`. No migration, no RLS policy change, no schema change.

Two writes were re-scoped to use the service-role admin client, **only** for the specific `isResolvedReopenByRequester` transition — every other transition (agent reopen, approval-rejection reopen, all normal status changes) is untouched and still goes through the original RLS client, byte-for-byte identical to before:

1. **The primary status-change write** (the one that was actually throwing the error):
   ```ts
   const statusUpdateClient = isResolvedReopenByRequester ? createAdminClient() : supabase
   let statusUpdateQuery = statusUpdateClient
     .from('requests')
     .update(updatePayload)
     .eq('id', requestId)
     .eq('status', currentStatus)
   if (isResolvedReopenByRequester) {
     statusUpdateQuery = statusUpdateQuery.eq('requester_id', profile.id)
   }
   const { data: updatedRow, error: updateError } = await statusUpdateQuery.select('id').maybeSingle()
   ```
   The `.eq('status', currentStatus)` optimistic-concurrency guard is **unchanged** — it still runs on every code path, using whichever client is active. Only the *client* differs; the *query shape and its race protection* do not.

2. **The follow-up SLA-recompute write**, which fires immediately after the primary write for any resolved→open reopen (requester or agent) or approval-rejection reopen. By the time this second write runs, the row's status is already `'open'`, not `'resolved'` — so it hits the exact same RLS gap for the requester case. It now reuses the same `statusUpdateClient` computed above:
   ```ts
   await statusUpdateClient.from('requests').update({ resolution_due_at: ..., resolved_at: null, ... }).eq('id', requestId)
   ```

An explicit `.eq('requester_id', profile.id)` ownership scope was added to the admin-client branch of the primary write, mirroring the existing precedent in the same file (`addComment()`'s waiting-user auto-transition, which already routes a requester-triggered status change through the admin client scoped by `.eq('requester_id', profile.id)` for the identical reason — RLS doesn't grant requesters `UPDATE` on their own request).

No other line in `updateRequestStatus()`, no other function, and no RLS policy was modified.

## 3. Why This Fix Is Safe

- **Scope is exact.** The client swap is gated on `isResolvedReopenByRequester` alone — a boolean already computed and already used to gate the 72h-deadline and mandatory-remark checks earlier in the same function. It cannot accidentally fire for agent reopens, approval-rejection reopens, or any other transition.
- **Authorization is not weakened, it's relocated.** Every check that gated reaching this line (`isRequester`, `currentStatus === 'resolved'`, the 72h deadline, the mandatory remark) still runs first, at the application layer, before either client is touched. The admin client only ever executes a write that the application has already fully authorized — it isn't used to bypass a check, it's used to execute a check that already passed but that RLS (a second, redundant enforcement layer for this one narrow case) doesn't yet recognize. The added `.eq('requester_id', profile.id)` is defense-in-depth on top of that, not a replacement for it.
- **Concurrency protection is untouched.** `.eq('status', currentStatus)` is present, unmodified, on every code path, regardless of which client executes it — see §7 for a runtime proof that a genuine concurrent write is still correctly rejected.
- **No RLS policy changed.** The fix has zero blast radius on any other table, any other role, or any other caller of `requests_update` — that policy is completely unmodified, so this change carries none of the risk a broadened database-level grant would (e.g., no risk of accidentally granting write access to a requester's row from some *other*, unrelated code path that also uses the RLS client).
- **Manually-cancelled tickets remain unreopenable.** That denial happens before any client is selected (the `canTransition`/`cancellation_reason` check higher in the function) — see §8, test 7.
- **Approval-rejection reopen is untouched.** It's a structurally separate flag (`isApprovalRejectionReopen`) that was never routed through the new branch — its current behavior (whatever it was before this change) is preserved exactly.

## 4. Automated Tests Added

No test framework existed in this repository before this change (`package.json` had no test runner). Added **Vitest** (`npm install -D vitest`) plus a real test client for a local WebSocket polyfill needed under Node 20 (`ws`), consistent with "prefer a server/integration test around the status action/business logic rather than a shallow UI test."

New files:
- [vitest.config.ts](../vitest.config.ts)
- [tests/setup/env.ts](../tests/setup/env.ts) — loads `.env.local`, polyfills `WebSocket`
- [tests/setup/fixtures.ts](../tests/setup/fixtures.ts) — creates a throwaway team/service/3 users against the local Supabase instance per run, torn down in `afterAll`
- [tests/integration/desk-uat-001-reopen.test.ts](../tests/integration/desk-uat-001-reopen.test.ts) — the 7 required cases

**Design:** these tests call the real, unmodified `updateRequestStatus()` Server Action against the real local Supabase Postgres + Auth instance — real RLS, real triggers, not a re-implementation of the business rules and not a UI click-through. Only the Next.js framework seams that don't exist outside an actual request (`next/headers`, `next/cache`, and the cookie-based server client) are stubbed; `@/lib/supabase/server`'s `createClient` is replaced with a real, per-user token-authenticated `supabase-js` client carrying the same RLS-relevant JWT a browser session would. `AsyncLocalStorage` is used to propagate test-user identity so two genuinely concurrent invocations (test 5) each keep their own identity across the whole async call chain, regardless of real network interleaving.

| # | Case | Given/When/Then | Result |
|---|------|------------------|--------|
| 1 | Valid requester reopen | resolved ticket, own requester, valid remark → reopen | succeeds; `status=open`, `reopen_count=1`, `resolved_at/closed_at/reopen_deadline_at/cancellation_reason` cleared, exactly one `status_changed` + one `reopened` activity row, comment posted, assignee notified | **PASS** |
| 2 | Expired deadline | resolved 73h ago (past 72h window) → reopen | denied: `'The reopen window for this request has expired.'`; row unchanged | **PASS** |
| 3 | Wrong requester | a different user attempts to reopen someone else's resolved ticket | denied; row unchanged | **PASS** |
| 4 | No remark | resolved ticket, own requester, no comment → reopen | denied: `'Please explain why you are reopening this request.'`; row unchanged | **PASS** |
| 5 | Genuine concurrent write still rejected | two real concurrent `updateRequestStatus()` calls (requester + agent) race the same resolved ticket | exactly one succeeds, the other gets `'This request was just changed by someone else — please refresh and try again.'`; `reopen_count` ends at exactly 1 (not 2) — proves the race guard was **not** deleted | **PASS** |
| 6 | Agent reopen (regression) | agent reopens their own resolved ticket | succeeds via the original, unmodified RLS-client path; unaffected by this change | **PASS** |
| 7 | Manually-cancelled ticket | `status=cancelled`, `cancellation_reason='manual'` → attempted reopen | denied: `'This request cannot be reopened.'`; row unchanged | **PASS** |

```
$ npm test

 ✓ tests/integration/desk-uat-001-reopen.test.ts (7 tests) 1858ms
   ✓ 1. valid requester reopen succeeds and updates every expected field       348ms
   ✓ 2. reopen after the 72h deadline is denied and leaves the row untouched    93ms
   ✓ 3. a different user cannot reopen someone else's resolved ticket         113ms
   ✓ 4. reopen without a remark is denied                                     136ms
   ✓ 5. a genuine concurrent write is still rejected                          ~400ms
   ✓ 6. agent reopen of their own resolved ticket is unaffected (regression)  292ms
   ✓ 7. a manually-cancelled ticket still cannot be reopened                  101ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```
Re-ran 4 consecutive times to confirm no flakiness (test 5 required a connection-warm-up fix during development — documented in the test file's comments — to eliminate a transport-level, not application-level, timing artifact).

## 5. Build / Typecheck / Lint Results

All three run clean against the actual current working tree (including the new test files), no output hidden or filtered:

```
$ npm run typecheck
> node node_modules/typescript/lib/tsc.js --noEmit
(no output — 0 errors)
```

```
$ npm run lint
> node node_modules/eslint/bin/eslint.js app lib components types proxy.ts

components/projects/NewMilestonePanel.tsx
  28:6  warning  React Hook useEffect has a missing dependency: 'handleClose' ...
components/projects/NewProjectPanel.tsx
  45:6  warning  React Hook useEffect has a missing dependency: 'reset' ...
components/requests/RequestActionBar.tsx
  57:10  warning  'activeTimer' is assigned a value but never used ...

✖ 3 problems (0 errors, 3 warnings)
```
These 3 warnings are **pre-existing**, in files this fix did not touch (confirmed via `git status`/`git diff` — this change touched only `lib/actions/requests.ts`, `package.json`, `package-lock.json`, and the new `tests/`/`vitest.config.ts` files). 0 errors.

```
$ npm run build
▲ Next.js 16.2.9 (Turbopack)
✓ Compiled successfully in 17.5s
✓ Generating static pages using 11 workers (51/51) in 1247ms
  Finalizing page optimization ...
```
Production build succeeds; all 51 routes generated with no errors.

## 6. Runtime Re-Test (Browser, Real Local Environment)

Re-ran the exact UAT-001 reproduction sequence end-to-end in the actual running app (not code inspection), logged in as `uat.requester.20260910@citykart.org` (the same pre-existing UAT requester account, role `user`, not a team member of HR Support).

Three fresh resolved tickets were seeded (service: HR Support, agent: UAT Agent One, resolved just now — well inside the 72h window):

| Ticket | ID | Steps performed |
|---|---|---|
| 1 | **CKSD-000087** | Logged in as requester → opened ticket → Status dropdown → "Open" → entered remark → **Reopen** → succeeded, `status: Open`, badge `Reopened` → **hard `window.location.reload()`** → state persisted identically → **cleared cookies, logged out, logged back in fresh** → re-opened same ticket → state still persisted identically |
| 2 | **CKSD-000088** | Same sequence (already-logged-in session) → succeeded on first attempt |
| 3 | **CKSD-000089** | Same sequence → succeeded on first attempt |

**Result: 3/3 successful requester reopens**, all via the real browser UI, all on the first attempt, with no error message, no retry needed. No `updateError`, no "changed by someone else" message, on any of the 3.

## 7. Database Verification (Before / After)

**Before** (identical starting state for all 3, per seed): `status='resolved'`, `reopen_count=0`, `resolved_at`=seed time, `reopen_deadline_at`=seed time + 72h, `cancellation_reason=null`.

**After** (queried directly from Postgres post-reopen):

```
 request_no  | status | reopen_count | resolved_at | closed_at | reopen_deadline_at |   resolution_due_at    | cancellation_reason | paused_ms_total
-------------+--------+--------------+-------------+-----------+---------------------+------------------------+----------------------+-----------------
 CKSD-000087 | open   |            1 |    (null)   |  (null)   |        (null)       | 2026-09-15 05:37:00+00 |        (null)        |        0
 CKSD-000088 | open   |            1 |    (null)   |  (null)   |        (null)       | 2026-09-15 05:38:00+00 |        (null)        |        0
 CKSD-000089 | open   |            1 |    (null)   |  (null)   |        (null)       | 2026-09-15 05:38:00+00 |        (null)        |        0
```

`resolution_due_at` was recomputed against HR Support's real SLA policy (proving the SLA-recompute follow-up write — the second call-site changed in §2 — also succeeded end-to-end, not just the primary status flip).

**Activity trail** — exactly one `status_changed` (`from: resolved, to: open`) and one `reopened` row per ticket, no duplicates:
```
 request_no  |     action     |  metadata
-------------+----------------+-------------------------------------
 CKSD-000087 | status_changed | {"to": "open", "from": "resolved"}
 CKSD-000087 | reopened       | {"reason": "unsatisfied_with_resolution", "remark": "..."}
 CKSD-000088 | status_changed | {"to": "open", "from": "resolved"}
 CKSD-000088 | reopened       | {"reason": "unsatisfied_with_resolution", "remark": "..."}
 CKSD-000089 | status_changed | {"to": "open", "from": "resolved"}
 CKSD-000089 | reopened       | {"reason": "unsatisfied_with_resolution", "remark": "..."}
```

**Notifications** — exactly one `request_reopened` notification per ticket, correctly sent to the assignee (UAT Agent One), not self-sent to the requester (per existing business rule: no self-notification):
```
 request_no  |       type       | is_agent
-------------+------------------+----------
 CKSD-000087 | request_reopened |    t
 CKSD-000088 | request_reopened |    t
 CKSD-000089 | request_reopened |    t
```

**No duplicate rows of any kind** on any of the 3 tickets, across activity, notifications, or comments.

## 8. Regression Check

| Area | Status | Evidence |
|---|---|---|
| Requester reopen succeeds when no real conflict | ✅ Pass | Test 1 (automated) + 3/3 browser reopens (§6) |
| Genuine conflicts still detected | ✅ Pass | Test 5 (automated) — exactly 1 of 2 concurrent calls succeeds |
| Requester authorization stays enforced | ✅ Pass | Test 3 (wrong requester denied) |
| 72h reopen window stays enforced | ✅ Pass | Test 2 (expired deadline denied) |
| Mandatory reopen remark stays enforced | ✅ Pass | Test 4 (no remark denied) |
| Agent reopen stays unchanged | ✅ Pass | Test 6 — agent path never touches the new branch; still uses the original RLS client |
| Manually-cancelled tickets still can't reopen | ✅ Pass | Test 7 |
| Approval-rejection reopen path stays unchanged | ✅ Not modified | `isApprovalRejectionReopen` was never routed through the new admin-client branch — code path is byte-identical to before this change (verified via diff); not separately re-tested, as that would be outside this defect's scope per the brief |

7 of 7 in-scope regression areas pass. The 8th (approval-rejection reopen) is confirmed unmodified by inspection, consistent with the instruction not to expand scope beyond this one defect.

## 9. Remaining Known Issue (NOT Fixed By This Change)

**EXISTING KNOWN DEFECT / BUSINESS RULE ISSUE** — `response_due_at` staleness on reopen.

The REOPEN SLA-recompute block (`lib/actions/requests.ts`, the block touched in §2.2) recomputes `resolution_due_at` on reopen but **never touches `response_due_at`**:
```ts
await statusUpdateClient.from('requests').update({
  resolution_due_at: resolutionDueAt,
  resolved_at: null,
  closed_at: null,
  waiting_since: null,
  paused_ms_total: 0,
}).eq('id', requestId)
```
`response_due_at` is left exactly as it was before the reopen — which, for a ticket that was already responded to and resolved once, may be a stale timestamp from the original first-response SLA clock, no longer meaningful once the ticket is reopened and effectively needs a fresh response cycle. This was already identified in the original UAT and is **explicitly not addressed by this change** — per the brief's instruction to make one behavioral change per controlled fix, this file was touched only to route the two writes through the correct client; the `response_due_at` field list in that block was left completely unmodified. This should be tracked and fixed as its own separate, independently-reviewed change.

## 10. Final Verdict

**FIX VERIFIED**

Basis: both automated tests (7/7, including a genuine-concurrency test proving the race guard was not deleted) **and** runtime browser re-tests (3/3 independent tickets, first-attempt success, surviving hard refresh and logout/login) passed. Typecheck, lint, and production build are all clean. No other file's behavior was changed; the approval-rejection reopen path and every non-reopen transition are provably byte-identical to before this change.
