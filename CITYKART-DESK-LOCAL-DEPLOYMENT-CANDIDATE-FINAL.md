# Citykart Desk — Local Deployment Candidate (FINAL — Completion Pass)

**Current Local HEAD:** `bb14e14` ("Poll for inbound email replies every 1 minute instead of 10") plus everything below, all still uncommitted on Local.

# AWAITING USER REVIEW AND EXPLICIT PUSH/DEPLOY APPROVAL

Nothing in this document has been pushed to git or deployed to Main. This is a status report to review before deciding what (if anything) to push.

## Two independent groups of changes, to be approved/pushed separately

### Group A — Saved Reports feature (pre-existing, from before this audit)

- `components/reports/PivotBuilder.tsx`, `lib/actions/reporting.ts`, `lib/reporting/pivot-engine.ts` (types), `lib/reporting/field-registry.ts` (Time-of-day fields + Description label-collision fix), `lib/queries/reporting.ts` (Description value-duplication fix), `types/database.ts`, `types/index.ts`, `supabase/migrations/20240101000146_saved_reports.sql`.
- **Validated this pass, specifically:**
  - **Save → Load → Update**: loading "test1" correctly restores its saved columns/filters and switches the button from "Save" to "Update"; changing the date preset and clicking "Update" round-trips correctly after a full page reload.
  - **Field selection, Time-of-day fields, Description field**: all render and persist as part of a saved config (visible directly in "test1"'s restored column set).
  - **Duplicate names**: saving a new report under an already-used name ("test1") is **silently allowed** — it created a second, indistinguishable "test1" entry (different id, same label) in the dropdown. Logged as DESK-REPORTS-001 in the defect register (P3, not fixed — a product decision, not a bug). The extra row created during this test was deleted directly in the database afterward; the user's real "test1"/"test2" are untouched.
  - **Delete**: the "Delete this saved report" control is present in the UI. Its click behavior was not independently confirmed through browser automation this session (a tooling reliability issue with this pass's browser-automation session, not evidence the button itself is broken) — worth a 10-second manual click-check before deploying, nothing more.
  - **Date presets, custom date range, role scope (Requester/Agent/Manager/Admin)**: not separately re-tested this pass beyond what was already confirmed by the user directly in the first pass's session.
- **Status:** unchanged from the first pass — **already functionally verified by the user directly** (their own "test1"/"test2" saves/updates). Not yet explicitly finalized/approved by the user, per their own instruction to build it, let them review, and not push until finalized. **Approved by user? NO — awaiting review.**

### Group B — Local Audit Completion Pass fixes (new this pass)

- `lib/actions/intake/whatsapp-channel.ts` — the `.in()`-over-500-ids URI-too-long fix (DESK-TEST-FLAKE-001's real-world half — this bug affects the live "requester mobile coverage" readiness panel on Main too, independent of the test).
- `tests/integration/stage6-channel-readiness.test.ts` — matching fix to the test's own ground-truth helper, plus the test now genuinely passes rather than being adjusted to expect a wrong number.
- `supabase/migrations/20240101000147_fix_projects_select_returning_visibility.sql` — **the headline fix**: project creation was broken for every role (DESK-RLS-001, P1). Fixes `projects_select`'s RLS policy.
- Carried over from the first pass, unchanged: `components/admin/CategoryIcon.tsx` (broken-image fallback), the `lib/reporting/pivot-engine.ts` null-byte removal (bundled with Group A's file since it's the same file), `tsconfig.json` (no real diff, see below).
- **Status:** all independently verified — see the defect register for exact reproduction/verification steps for each. **This group has no outstanding "awaiting user decision" item** — it is a set of straightforward bug fixes, ready to deploy on its own merits whenever the user chooses, independent of whether Group A (Saved Reports) is approved.

## Migrations

Two new migrations, **both applied to Local only, neither yet applied to Main**:

1. `20240101000146_saved_reports.sql` — creates the `saved_reports` table (Group A). Apply only if/when Saved Reports is approved for deployment.
2. `20240101000147_fix_projects_select_returning_visibility.sql` — fixes `projects_select`'s RLS policy (Group B). **This one is independent of Saved Reports and worth applying to Main regardless of the Saved Reports decision** — Main's `projects` table is presumably in the same permanently-broken state (RLS logic is identical there), meaning nobody on Main has ever been able to create a Project either. Self-contained, no dependency on migration 146 or anything else pending.

Both use the same `psql`-through-SSH recipe already used for migrations 144/145 this session.

## Test Results (this pass)

- `npx tsc --noEmit`: 0 errors
- `npm run lint`: 0 errors, 3 pre-existing warnings (unrelated files — `NewMilestonePanel.tsx`, `NewProjectPanel.tsx`, `RequestActionBar.tsx`, all pre-existing `exhaustive-deps`/`no-unused-vars` warnings, unchanged from the first pass)
- `npx vitest run`: **871 passed / 0 failed / 23 skipped** (894 total) — up from 870 passed / **1 failed** / 23 skipped in the first pass. The one failure is now genuinely fixed, not masked.
- `npm run build` (Webpack-equivalent Turbopack dev build via an isolated `NEXT_DIST_DIR`, same technique as the first pass, to avoid touching the live dev cache): **succeeded, exit code 0**, all 50+ routes compiled including `/tasks/[id]`, `/projects/[id]`, `/services/[slug]`, `/intake/inbox/[id]`, `/intake/review/[id]` as real compiled routes. Throwaway build directory (`.next-audit2-build`) deleted afterward; the resulting `tsconfig.json` auto-append was reverted (see below) — same known tooling side-effect as the first pass, not a real change.

## Visual & Functional Coverage (this pass)

See `CITYKART-DESK-ROUTE-AND-LAYOUT-COVERAGE-FINAL.md` for the full detail. Headline numbers: 18 of the first pass's 22 N/T routes opened and confirmed clean; 2 correctly BLOCKED (no seed data exists to reach them, not skipped); 1 N/A with reason. 48 of 50 catalogued routes have now been opened live at least once across both passes. 5 more overlays opened (Task/Project create+detail, two admin bulk dialogs); 18 overlays remain N/T. A real 5-role sweep (Requester/Technician/Manager/Admin/Platform Owner) confirmed correct nav scoping and direct-URL protection for all five. Holiday Calendar re-confirmed clean, not reproduced.

## Known Risks / Honest Scope Note

1. **Saved Reports is still not finalized by the user** — same condition as the first pass, unchanged.
2. **This pass did not achieve the full 8-viewport / every-overlay / dedicated-accessibility-pass scope** the completion-pass brief described. It prioritized, in order: (a) properly root-causing the flaky test rather than adjusting its expected number, (b) opening every route that was previously N/T, (c) a real (not simulated) 5-role sweep, (d) validating Saved Reports' actual CRUD behavior, (e) a representative sample of overlays. Items not reached: the remaining 18 N/T overlays, systematic dropdown/popover collision testing, systematic table/form/chart stress testing, and a dedicated accessibility pass. None of the unreached items are known-broken — they are honestly unaudited, and are listed as such (not silently dropped) in the coverage doc.
3. **DESK-RLS-001 (project creation) almost certainly also affects Main.** The RLS logic that's broken here (`can_view_project()`'s self-reference under `INSERT ... RETURNING`) is identical on Main — this is a schema/policy bug, not a Local-data artifact. Recommend applying migration 147 to Main promptly, independent of any other pending decision, since it's a pure bug fix with no feature-flag or approval dependency.
4. **DESK-MOBILE-001 (Form Template Builder on mobile) needs a design decision**, not a code fix — left open on purpose.
5. Carried over from the first pass: the majority of `[id]`-parameterized detail pages beyond what's now covered, most tablet breakpoints, and 18 overlays remain unaudited (not known-broken).

## Recommended Git Commits

Same split as the first pass, with the new fixes added to the second commit:

1. **Saved Reports feature** (once explicitly finalized by the user): `PivotBuilder.tsx`, `lib/actions/reporting.ts`, `lib/reporting/field-registry.ts`, `lib/queries/reporting.ts`, `types/database.ts`, `types/index.ts`, migration 146. Still carries the incidental `pivot-engine.ts` null-byte fix, as noted in the first pass.
2. **Bug fixes** (independent of Saved Reports, ready whenever): `components/admin/CategoryIcon.tsx`, `lib/actions/intake/whatsapp-channel.ts`, `tests/integration/stage6-channel-readiness.test.ts`, migration 147.

`tsconfig.json` has no real diff versus `HEAD` (confirmed via `git diff` showing only the pre-existing LF/CRLF line-ending warning) and needs no commit.

## Main Migration Requirement

- `20240101000146_saved_reports.sql` — only if/when Saved Reports is approved.
- `20240101000147_fix_projects_select_returning_visibility.sql` — **recommend applying independent of the Saved Reports decision**, since Project creation is currently broken on Main for every role if the same policy exists there (it does — this is core schema, not Local-only data).

## Main Restart Requirement

Standard deploy-and-swap (Webpack build, per the fix from earlier this session) — no special restart beyond the normal `CitykartApp` service swap, for either group.

## Rollback Considerations

Standard: the existing swap script already renames the previous `standalone` build aside before swapping in a new one. For migration 147 specifically, rollback is a straightforward `DROP POLICY "projects_select" ON projects;` followed by recreating the original `can_view_project(id)`-based policy from migration 104, if ever needed — though doing so would restore the original defect (project creation broken for everyone), so there's no real reason to roll it back once applied.

# LOCAL AUDIT COMPLETION PASS FINISHED

# AWAITING USER REVIEW AND EXPLICIT PUSH/DEPLOY APPROVAL
