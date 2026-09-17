# DESK-ALERTRULE-001 FIX REPORT

**Defect:** Adding an Alert Rule in Admin → Request Config → Alert Rules commits the database INSERT successfully, but the page then crashes to the global admin error boundary ("Something went wrong / We couldn't load the admin panel.") whenever the app is served outside a secure context (e.g. Main's plain-HTTP LAN origin, `http://10.0.1.12:3210`).
**Date:** 2026-09-17
**Scope:** This one defect only. No other behavior was changed.
**Git:** committed as [`b24303f`](https://github.com/kumarsuraj84/Citykartdesk/commit/b24303f) on `main`, pushed to `origin/main`. **Not yet live on the Main deployment** — see §6.

---

## 1. Root Cause

**CONFIRMED — identical mechanism to the already-fixed DESK-HOLIDAY-001.**

`AlertRulesClient.tsx`'s `handleCreate()` built its optimistic list entry client-side:

```ts
async function handleCreate(data: AlertRuleData) {
  const result = await createAlertRule(data)
  if (result.error) throw new Error(result.error)
  setRules((prev) => [
    ...prev,
    { id: crypto.randomUUID(), ...data, threshold_minutes: data.threshold_minutes ?? null, is_active: true },
  ])
  setShowAdd(false)
}
```

`crypto.randomUUID()` only exists in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) — HTTPS, or the `http://localhost`/`http://127.0.0.1` loopback exemption. Main is served over plain HTTP on a LAN IP (`http://10.0.1.12:3210`), which is **not** a secure context, so this line throws `TypeError: crypto.randomUUID is not a function`. React treats a throw inside a `setState` functional updater as a render-phase error, so it propagates to the nearest error boundary (`app/(app)/admin/error.tsx`) — even though `createAlertRule()`'s DB insert, moments earlier, already committed successfully. Local dev (`http://localhost:3210`) never reproduces this, because `localhost` is always a secure context — which is exactly why this shipped unnoticed and matches how DESK-HOLIDAY-001 was originally missed too.

The server action itself, `createAlertRule()` in `lib/actions/admin/config.ts`, only ever returned `{ error?: string }` — it never gave the client a real row to use instead of fabricating one.

## 2. Change Made

**File: [lib/actions/admin/config.ts](../lib/actions/admin/config.ts) — `createAlertRule()`.**
Changed the insert to `.select(...).single()` and return the real persisted row:

```ts
export type AlertRuleRow = {
  id: string
  name: string
  alert_type: string
  entity_type: string
  threshold_minutes: number | null
  notify_roles: string[]
  notify_assignee: boolean
  notify_requester: boolean
  channels: string[]
  is_active: boolean
}

export async function createAlertRule(data: AlertRuleData): Promise<{ data?: AlertRuleRow; error?: string }> {
  ...
  const { data: rule, error } = await admin
    .from('alert_rules')
    .insert({ ... })
    .select('id, name, alert_type, entity_type, threshold_minutes, notify_roles, notify_assignee, notify_requester, channels, is_active')
    .single()

  if (error || !rule) return { error: error?.message ?? 'Failed to create alert rule.' }
  revalidatePath('/admin/request-config')
  return { data: rule }
}
```

**File: [AlertRulesClient.tsx](../app/(app)/admin/request-config/AlertRulesClient.tsx) — `handleCreate()`.**
Uses the server-returned row instead of fabricating one:

```ts
async function handleCreate(data: AlertRuleData) {
  const result = await createAlertRule(data)
  if (result.error || !result.data) throw new Error(result.error ?? 'Failed to create alert rule.')
  setRules((prev) => [...prev, result.data!])
  setShowAdd(false)
}
```

This removes the `crypto.randomUUID()` dependency entirely. No other function in either file, no migration, and no RLS policy was touched.

## 3. Why This Fix Is Safe

- **Scope is exact.** Only `createAlertRule()`'s return value and `handleCreate()`'s consumption of it changed. `updateAlertRule`, `deleteAlertRule`, `toggleAlertRule`, and the edit/delete/toggle UI paths are untouched.
- **No new failure mode introduced.** If the insert's `.select().single()` fails (e.g. RLS denies the read-back), the action now returns an explicit error instead of silently succeeding with a fabricated row — a strictly safer failure than before, matching the DESK-HOLIDAY-001 precedent.
- **Server-truth data is strictly more correct than client-fabricated data.** The returned row reflects the DB's actual trimmed/normalized/defaulted values (e.g. `name.trim()`, `is_active` default), rather than the raw, unnormalized form state the old code echoed back.
- **Same fix pattern already validated in production code** by DESK-HOLIDAY-001 (`createHoliday()` / `HolidayCalendarClient.tsx`), reviewed and merged earlier in this session.

## 4. Automated Tests Added

New file: [tests/integration/desk-alertrule-001-alert-rules.test.ts](../tests/integration/desk-alertrule-001-alert-rules.test.ts), modeled directly on `tests/integration/desk-holiday-001-holiday-calendar.test.ts`. Calls the real, unmodified `createAlertRule()`/`deleteAlertRule()` Server Actions against the local Supabase Postgres + Auth instance — real RLS, not a UI click-through, not a re-implementation of business rules.

| # | Case | Given/When/Then | Result |
|---|------|------------------|--------|
| 1 | Valid create returns real row | create a rule → response has a real `id` (not fabricated), all fields match input, and the DB has exactly one row with that id | **PASS** |
| 2 | Org scoping + null threshold | create with `threshold_minutes: null` → returned row and DB row both have `org_id` = caller's org and `threshold_minutes = null` | **PASS** |
| 3 | Delete | create then delete → row count in DB is 0 afterward | **PASS** |
| 4 | Duplicate names allowed | two rules with the same name → both succeed with distinct ids (no uniqueness constraint) | **PASS** |
| 5 | Unauthorized caller rejected | a plain `user`-role caller attempts create → `{ error: 'Unauthorized.' }`, no row written | **PASS** |

```
$ npx vitest run tests/integration/desk-alertrule-001-alert-rules.test.ts

 ✓ tests/integration/desk-alertrule-001-alert-rules.test.ts (5 tests) 3216ms
   ✓ 1. a valid alert rule is created exactly once, and the action returns the real persisted row (not a client-fabricated id)  414ms
   ✓ 2. the created row is scoped to the caller org, and threshold_minutes null round-trips correctly                          166ms
   ✓ 3. delete removes exactly the targeted row and returns success                                                            355ms
   ✓ 4. a duplicate name is allowed (no uniqueness constraint), and each insert gets a distinct id                             440ms
   ✓ 5. an unauthorized (non admin/manager/platform_owner) caller cannot create or delete alert rules                          920ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

**Regression check** — re-ran the two closest existing suites, both still pass with no changes needed:
```
$ npx vitest run tests/integration/desk-holiday-001-holiday-calendar.test.ts tests/integration/d07-alert-rule-channels.test.ts

 ✓ tests/integration/desk-holiday-001-holiday-calendar.test.ts (5 tests) 3049ms
 ✓ tests/integration/d07-alert-rule-channels.test.ts (2 tests) 2454ms

 Test Files  2 passed (2)
      Tests  7 passed (7)
```

## 5. Build / Typecheck / Lint Results

```
$ npx tsc --noEmit
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
All 3 warnings are pre-existing, in files this change did not touch (confirmed via `git diff` — this commit touched only `lib/actions/admin/config.ts`, `app/(app)/admin/request-config/AlertRulesClient.tsx`, and the new test file). 0 errors.

**Not run this pass:** `npm run build` (production build) and a live browser re-test against a plain-HTTP origin (the actual failure condition). Both were performed for DESK-HOLIDAY-001; this fix is the same pattern applied to a second, previously-unaudited component, and hasn't yet had that same level of runtime confirmation. Recommend a real add-alert-rule click-through on Main after deploy (§6) as the definitive proof, the way DESK-HOLIDAY-001 got a 3-ticket browser re-test.

## 6. Git / Deployment State

```
Committed:  b24303f (parent 1cbda2a, the DESK-HOLIDAY-001 commit)
Pushed:     origin/main updated 1cbda2a..b24303f (plain fast-forward)
```

**Not deployed to Main.** This session runs on the dev machine, not the Main host (`10.0.1.12:3210`) — no `Citykart*` Windows services are present here, and no SSH/WinRM/remote-deploy tooling exists in this repo for reaching that machine. Per this project's established Local→Main workflow, someone with access to the Main host still needs to `git pull` and restart the `CitykartApp` service there before this fix is actually live.

## 7. Final Verdict

**FIX APPLIED, TESTED, COMMITTED, AND PUSHED TO `origin/main`.**

Basis: 5/5 new automated tests pass, both nearest existing regression suites (HOLIDAY-001, D-07) still pass unchanged, TypeScript and ESLint are clean. **Not yet verified live on Main** — that requires the manual pull+restart step on the Main host (§6), and ideally a real browser click-through of "Add Alert Rule" against Main's plain-HTTP origin afterward, mirroring the DESK-HOLIDAY-001 runtime proof.
