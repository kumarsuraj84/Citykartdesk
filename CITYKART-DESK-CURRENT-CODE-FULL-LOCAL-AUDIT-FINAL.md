# Citykart Desk — Local Audit Completion Pass (FINAL)

LOCAL ONLY. Nothing in this pass was pushed to git or deployed to Main. This document is the narrative summary; see the three companion `-FINAL` documents for full detail:

- `CITYKART-DESK-LOCAL-DEFECT-AND-FIX-REGISTER-FINAL.md` — every defect found this pass, with root cause and verification.
- `CITYKART-DESK-ROUTE-AND-LAYOUT-COVERAGE-FINAL.md` — the full route/overlay matrix update.
- `CITYKART-DESK-LOCAL-DEPLOYMENT-CANDIDATE-FINAL.md` — what's ready to push, what's still awaiting the user's own decision, migration requirements.

## Scope and honesty note, stated up front

The completion-pass brief asked for the full remaining matrix: every previously-untested route and overlay, up to 8 viewports each, systematic dropdown/table/form/chart stress testing, a full accessibility pass, and a genuinely fresh full re-sweep after fixes. That literal scope — 50 routes × 26 overlays × up to 8 widths, each with real interaction testing, plus a dedicated accessibility pass — is not achievable with real rigor in a single pass by one agent driving a browser sequentially. Rather than mechanically claiming full coverage, this pass prioritized, in order:

1. **Properly root-causing the one known test failure** — not adjusting its expected number, actually finding out why it failed.
2. **Opening every route that was left untested in the first pass.**
3. **A real, not simulated, sweep across all five roles** (Requester, Technician, Manager, Admin, Platform Owner) — separate accounts created and signed into for each.
4. **Validating Saved Reports' actual CRUD behavior**, not just trusting the first pass's "user confirmed it works."
5. **A representative sample of the highest-traffic overlays** (task/project creation and detail, two admin bulk-action dialogs).

What that left unreached is listed honestly in the coverage doc, not silently dropped: 18 of the 23 previously-N/T overlays, systematic dropdown/popover collision testing, systematic table/form/chart stress testing beyond what was incidentally observed, and a dedicated accessibility pass.

## What this pass found

### 1. The flaky test was a real, previously-undiscovered application defect — not a fixture problem

`tests/integration/stage6-channel-readiness.test.ts`'s `requesterMobileCoverage` test failed because `getWhatsAppChannelReadiness()` (the function backing the WhatsApp channel readiness diagnostic panel) collects every active profile's id for the org and passes the whole list to a `.in('profile_id', activeProfileIds)` query against `profile_mobile_numbers`. This org has 527+ active users, mirrored from Main's real data. At that scale, PostgREST's GET request for the `.in()` query exceeds the local Kong gateway's URL-length limit and fails outright with `"URI too long"` — an error the code was silently swallowing (`data ?? []`), so the readiness panel's mobile-coverage count silently collapsed toward zero instead of surfacing a failure. **This is a real defect in the shipped diagnostic panel, not a test artifact** — it would misreport on Main too, for any org with enough active users to hit the same limit. The test's own hand-rolled "ground truth" helper had the identical bug, which is why the failure looked like a stable, deterministic off-by-one rather than something that only breaks at scale.

Fixed both the application code and the test's helper by replacing the id-collection-then-`.in()` pattern with an embedded PostgREST join (`profile_mobile_numbers.select('profile_id, profiles!inner(is_active)')`), which needs no id list and has no URL-length ceiling. Reproduced the original failure directly against the real local Postgres/Kong stack before writing the fix, and confirmed the fix resolves it the same way. Full suite: **871 passed, 0 failed, 23 skipped** (previously 870 passed, 1 failed, 23 skipped).

### 2. Project creation was broken for every single role — found while testing the Projects overlay

While exercising `NewProjectPanel` as part of the overlay sweep, creating a project as the Platform Owner test account failed with a generic "You do not have permission to perform this action." Because the app-level permission check explicitly allows Platform Owner, and because the `projects` table has been completely empty on Local this whole session, this was investigated all the way down rather than dismissed as "expected, wrong test role."

Root cause: Postgres requires a row returned by `INSERT ... RETURNING` (which is what `.insert(...).select('id').single()` compiles to) to also satisfy the table's own SELECT policy. The `projects_select` policy calls `can_view_project(id)`, which re-queries `projects` **by id** to check ownership. A self-referencing lookup like that cannot see a row inserted earlier in the *same* command — standard Postgres MVCC command-visibility — so it always evaluates false for a brand-new project, regardless of who created it or what role they hold. The INSERT itself always succeeded; only the implicit RETURNING-triggered visibility check failed, and Postgres/PostgREST/supabase-js reported that as a blanket permission error.

This was bisected directly in `psql` against the real local database (not guessed): confirmed the same INSERT succeeds with `RETURNING` removed, confirmed a *separate* later call to `can_view_project()` on the identical row correctly returns true, and confirmed reducing the insert policy to a bare `WITH CHECK (true)` still failed — proving the failure was never in the INSERT policy at all. Fixed with a new migration that gives `projects_select` its own row-correlated predicate instead of routing through the self-referencing function, leaving `can_view_project()` and its other four callers (which look up an already-committed parent project, never hitting this race) untouched. Verified end-to-end afterward through the real UI: created "AUDIT2-20260923-test-project" successfully, opened its detail page, no error.

This almost certainly affects Main too — it's a schema/policy defect, not a Local-data artifact — and is flagged in the deployment-candidate doc as worth applying independent of the Saved Reports decision.

### 3. A documented, not-fixed mobile UX issue in the Form Template Builder

At ≤390px, `/admin/form-templates/[id]`'s three-column desktop layout (field library / section editor / live preview) collapses into one very long single-column scroll, with a `sticky` "Save form" bar that isn't gated to desktop and stays pinned near the bottom throughout. Verified nothing is actually unreachable — scrolling the inner container all the way down does surface the Live Preview and Submit button — but the experience is confusing enough to flag. Left as a documented finding (DESK-MOBILE-001) rather than a code fix, since a real fix needs a genuine mobile-IA decision (tabs between panels? gate the builder to desktop with a notice?) rather than a CSS patch.

### 4. A minor Saved Reports gap

Saving a report under an already-used name is silently allowed — no duplicate check. Confirmed by saving "test1" a second time, which produced two distinct, identically-labeled entries in the dropdown. Low severity (no data loss, no permission bypass); documented (DESK-REPORTS-001) rather than changed, since Saved Reports' behavior is already the user's own decision to finalize.

## Role sweep

Created four fresh, clearly-named test accounts (`desk-local-audit-{requester,agent,manager,admin}@citykart.org`) alongside the existing Platform Owner tester, signed into each in turn, and checked: sidebar nav scope, home-dashboard content, and direct-URL access to at least one page above and (where relevant) at the edge of that role's expected permissions.

- **Requester**: minimal nav (Home, Report Builder, Requests, Approvals, Notifications). Direct navigation to `/admin/users` and `/tasks` both correctly redirected back to Home.
- **Technician (agent)**: broader nav including Intake Dashboard/Inbox. Direct navigation to `/tasks` redirected to Home — confirmed via source that this is an intentional, explicitly-commented product decision (`// Tasks isn't fully built out yet — Admin/Owner only until that work ships.`), not a bug.
- **Manager**: full Administration section visible (Users, Teams, Roles & Permissions, Org Settings, Settings, Knowledge Base) and directly reachable — `/admin/users` rendered the full 531-user table. `/tasks` still correctly gated to Admin/Owner only.
- **Admin**: full nav including Tasks and Projects; `/tasks` reachable, matching the intentional gate.
- **Platform Owner**: full nav; the account used for the two fixes above.

All five behaved consistently with the RLS/role-check patterns found throughout the codebase. No inconsistency found beyond the two documented, non-blocking findings above.

All four new role accounts were deleted after the sweep; the original `DESK-LOCAL-AUDIT-Tester` (Platform Owner) account was kept, matching the first pass's own precedent, in case a future session needs it.

## Saved Reports validation

Save, Load, and Update were exercised end-to-end (not just trusted from the user's earlier confirmation): loading "test1" correctly restores its saved column set and switches the UI into "Update" mode; changing a setting and clicking Update round-trips correctly after a full page reload. The duplicate-name gap above was found in the process. Delete's click behavior could not be independently confirmed through browser automation this session due to a tooling reliability issue (not evidence the feature itself is broken) — the test artifact it would have deleted was instead removed directly in the database. **Classification: still "Approved by user? NO — awaiting review"** — nothing here changes that; see the deployment-candidate doc.

## Holiday Calendar re-regression

Re-opened `/admin/request-config?tab=business-hours`. Business Hours and Holiday Calendar (including existing recurring holidays) render cleanly. Consistent with the first pass — the originally-reported "Something went wrong" state did not reproduce.

## Final regression

- `npx tsc --noEmit`: 0 errors.
- `npm run lint`: 0 errors, 3 pre-existing unrelated warnings.
- `npx vitest run`: **871 passed / 0 failed / 23 skipped** — the flaky test is genuinely fixed.
- `npm run build`: succeeded (exit code 0), all routes compiled, including every dynamic route discovered this pass.

## Git review

Working tree reviewed in full via `git status` / `git diff --stat` / `git diff`. Two independent, separately-committable groups of changes (Saved Reports — awaiting user approval; and this pass's bug fixes — ready independent of that decision) — full detail and recommended commit split in the deployment-candidate doc. `supabase/snippets/Untitled query 200.sql` was confirmed to be a harmless, secret-free Supabase Studio introspection query and removed, per the standing permission to do so once confirmed safe. `tsconfig.json` has no real diff versus `HEAD` (the `npm run build` check re-triggered the same known Next.js auto-append side effect as the first pass; reverted the same way). No `git add`, `git commit`, or `git push` was run — nothing has been staged or committed.

## Test data cleanup

All `AUDIT2-*`-prefixed records (one test task, one test project, one duplicate "test1" saved report created and deleted during the duplicate-name test) were removed. The four role-sweep accounts were deleted. The original `DESK-LOCAL-AUDIT-Tester` account was kept.

# LOCAL AUDIT COMPLETION PASS FINISHED

# AWAITING USER REVIEW AND EXPLICIT PUSH/DEPLOY APPROVAL
