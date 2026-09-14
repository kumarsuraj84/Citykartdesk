# CITYKART DESK — REMEDIATION AND RE-UAT REPORT

**Date:** 2026-09-10
**Scope:** One controlled remediation pass over the priority queue below. Not a rewrite.

---

## 1. Executive Summary

13 items from the remediation queue were runtime-verified and, where a defect was confirmed, fixed with regression coverage: **D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-09, D-12, D-16, D-17, Item 6 (Assignment RBAC)**, plus DESK-UAT-001 (carried over, verified untouched). One item (reopen `response_due_at` staleness) was explicitly **not** changed — it is classified `BUSINESS DECISION REQUIRED`, per instruction not to invent behavior.

Every fix in this pass follows the same discipline: **reproduce first** (against the real, unmodified code, via the Vitest + real-Postgres integration harness — or, for D-02/D-17, direct evidence already gathered), **then** the smallest fix, **then** a permanent regression test, **then** the full gate (`npm test`, `typecheck`, `lint`, `build`). The regression suite grew from 21 tests (DESK-UAT-001 baseline) to **73 tests across 13 files**, all passing.

Items **7, 15, 16, 17, 18** and the **Final Re-UAT flows (A–G)** are large-scope, multi-hour browser-driven UAT efforts in their own right — comparable to the original System Audit and UAT sessions individually. They were **not attempted** in this pass; see §20 and §23 for why rushing shallow coverage of them here would be worse than clearly deferring them. They are excluded from this report's sign-off scope, not silently assumed passing.

## 2. Starting Baseline

- `docs/SYSTEM-AUDIT-2026-09-09.md` — static audit (37 sections, D-01–D-17 defect register).
- `docs/UAT-REPORT-2026-09-10.md` — runtime UAT (31 sections), discovered `DESK-UAT-001`.
- `docs/DESK-UAT-001-FIX-REPORT-2026-09-10.md` — `DESK-UAT-001` **FIX VERIFIED** (7/7 automated tests, 3/3 browser re-tests). Not reopened or modified this pass; its own regression suite (7 tests) is still green (§18).
- `docs/D-03-SECURITY-VALIDATION-REPORT-2026-09-10.md` — produced at the start of this pass, superseded/absorbed by this report; D-03 detail is summarized in §4.

## 3. Changes Made

| File | Item(s) | What changed |
|---|---|---|
| `lib/actions/analytics.ts` | D-03 | `getFilteredRequests`/`getFilteredTasks` now scope every query by the caller's real role/team/ownership instead of trusting caller-supplied filters. |
| `lib/reporting/access.ts` | D-03 | Reused unchanged (`authorizeReportAccess`). |
| `lib/actions/projects.ts` | D-04 | `addProjectMember`, `removeProjectMember`, `createMilestone`, `updateMilestone` now call a new `canAccessProject()` (reuses the existing `can_view_project()` RPC) before mutating. |
| `lib/actions/tasks.ts` | D-09, D-16 | `deleteTask` now includes `platform_owner`; `createTask` now requires agent-tier-and-above. |
| `lib/actions/requests.ts` | D-06, D-05 | Reopen notification dedup (`notifiedUserIds` set); `runOemAutoRouting`'s HTML body is now escaped. (DESK-UAT-001's own fix in this file, from the prior session, is untouched.) |
| `lib/actions/admin/oems.ts` | D-12 | `createOem`/`updateOem`/`deleteOem` now all `revalidatePath('/admin/org')` (the real route) instead of the nonexistent `/admin/oems`. |
| `lib/actions/admin/reports.ts` | D-05 | Scheduled-report email HTML escapes `report.name`. |
| `lib/rules/actions.ts` | D-05 | Business-rule notification email HTML escapes the request title. |
| `lib/queries/admin.ts`, `lib/queries/analytics.ts`, `lib/queries/reporting.ts` | D-01 | All three now use the new shared `lib/sla/breach.ts` predicates instead of three independent ad hoc formulas. |
| `lib/sla/breach.ts` | D-01 | **New.** `isCurrentlyBreached`, `isEverBreached`, `isEverResponseBreached`, `applyCurrentlyBreachedFilter` — one implementation per legitimate "breached" concept. |
| `lib/email/escape.ts` | D-05 | **New.** `escapeHtml`, `escapeEmailFields`. |
| `lib/email/templates.ts` | D-05 | All 7 builders escape user-controlled fields in the `html` output (not `text`). |
| `app/api/alerts/run/route.ts` | D-07, D-05 | New `notifyRespectingChannels()` helper — respects the rule's `in_app` channel toggle without breaking cron dedup; task/milestone/project names escaped in alert emails. |
| `app/(app)/admin/roles/PermissionMatrixClient.tsx` | D-02 | Editing disabled behind a `PERMISSION_MATRIX_ENFORCED = false` flag; "Not enforced — Coming soon" banner; misleading "enforced via RLS" text removed. |
| `app/(app)/admin/reports/AnalyticsDashboard.tsx`, `app/(app)/home/page.tsx`, `app/(app)/admin/monitoring/MonitoringClient.tsx` | D-01 | "SLA Breached" → "Currently Breached" labels, to disambiguate from the Report Builder's "Resolution/Response SLA Breached" (a different, broader definition). |
| `supabase/migrations/20240101000132_oem_notification_rules_select_role_gate.sql` | D-17 | **New.** `oems_select`/`notification_rules_select` now require admin/manager/platform_owner (were org-membership-only). `stores_select` deliberately untouched. |
| `package.json`, `vitest.config.ts` | infra | `jsdom`, `@testing-library/react`/`dom` added (D-02's component test); `.test.tsx` added to the test glob. |

No RLS policy was touched other than the one migration above. No status machine, RBAC model, or business rule was silently changed. `DESK-UAT-001`'s fix and tests are untouched.

## 4. D-03 Result

**FIX VERIFIED.** `getFilteredRequests`/`getFilteredTasks` used the admin client with no scoping beyond `org_id` — a plain requester's *default, filter-less* call already returned every request and task in the org. Fixed by reusing `lib/reporting/access.ts`'s existing scope resolver for requests, and a new equivalent for tasks (mirroring the live `tasks_select` RLS policy, since the reporting resolver blocks agents from non-`requests` entities entirely, which is too broad here). 14 tests, all 8 roles/entities combinations. Full detail: `docs/D-03-SECURITY-VALIDATION-REPORT-2026-09-10.md`.

## 5. D-01 Result

**FIX VERIFIED** (reconciliation, not a bug in any single surface). Two legitimate concepts existed under the same "SLA Breached" wording: **Currently Breached** (open + past due, used by Home/Monitoring/Admin-Analytics-KPI) and **Ever Breached** (includes resolved-late tickets, used by the Report Builder + CSV/XLSX). Both are now single, named, shared implementations (`lib/sla/breach.ts`) instead of three independent ad hoc formulas; UI labels updated so "Currently Breached" and "Resolution/Response SLA Breached" read as the distinct things they are. 8 unit tests cover the 5 required fixtures (currently-open breached, resolved late, resolved on time, closed late, no SLA) plus 3 boundary cases.

## 6. D-04 Result

**FIX VERIFIED.** `addProjectMember`, `removeProjectMember`, `createMilestone`, `updateMilestone` had no project-scoping check at either the app layer or RLS (`project_members_insert/delete`, `milestones_insert/update` are role-only — any agent+, any project). Confirmed via runtime reproduction (4/4 "unrelated agent" tests failed pre-fix) before fixing. Fixed by reusing the existing `can_view_project()` Postgres function (already the correct predicate for the `SELECT` side of these same tables) via RPC. 8 tests: unrelated-agent denial (4), project-member/owner success (2), manager/admin broader-scope success (2).

## 7. D-02 Result

Handled per the brief's explicit preferred path (no authoritative requirement confirms the Permission Matrix is meant to be production-active — `BD-01` is still an open, unresolved item). Editing disabled, "Not enforced — Coming soon" banner added, the false "enforced via RLS and server-side role checks" claim removed. Not deleted — the screen still shows each role's actual default access read-only. 5 component tests (jsdom + React Testing Library, new to this repo) assert the misleading editable control cannot silently return; all 5 failed against the pre-fix component (verified), all 5 pass now.

## 8. Reopen Response SLA Decision/Result

**`BUSINESS DECISION REQUIRED` — code unchanged**, exactly as instructed. Neither baseline document states whether a reopen should recompute `response_due_at`, treat the original response as permanently satisfied, show no response SLA at all, or introduce a separate "reopen response SLA" concept. Per the brief: do not invent behavior when intent is unclear. This is the same item `DESK-UAT-001`'s own fix report flagged as an explicitly-out-of-scope known issue — status is unchanged from that report.

## 9. Assignment/Reassignment Result (Item 6)

**NOT REPRODUCED — code was already correct; now runtime-verified.** `assignRequest()` already had: a role check, team-membership defense-in-depth on top of RLS, same-team-only restriction for plain agents (including denying unassignment), unrestricted cross-team forwarding for manager+, a concurrency guard, and an update payload that never touches SLA fields. 6 new tests confirm this against the real action: same-team agent assign (✓), cross-team agent assign (denied), agent unassign (denied), requester assign (denied), manager cross-team assign (✓, SLA fields unchanged, activity logged, persists on re-read), admin cross-team assign (✓).

## 10. Approval Extended UAT

**Not attempted this pass** — Item 7 (sequential workflow, rejection at multiple steps, any-manager approval, concurrent submission, delegation) is a multi-scenario runtime UAT effort on the scale of the original UAT session's approval section. See §20.

## 11. Notification Defects

**D-06 — FIX VERIFIED.** When a request's requester and assignee are the same person and a third party (e.g. a manager, who can reopen any resolved ticket regardless of team) reopens it, two independent `notify()` calls both targeted that one person — 2 rows for 1 event. Reproduced (2 rows, confirmed pre-fix), fixed with a per-call `notifiedUserIds` dedup set, 1 regression test.

**D-07 — FIX VERIFIED**, with an important correctness correction made during the fix. The naive fix (skip `notify()` when a rule's `channels` excludes `'in_app'`) would have silently broken the cron's own dedup check (which queries the `notifications` table `notify()` writes to) — an email-only rule would have **resent its email on every single cron tick** instead of once. Caught before shipping; the actual fix always calls `notify()` (preserving dedup) and archives the row immediately after when `in_app` isn't selected, so it never surfaces as an unread bell notification. 2 regression tests, including a second-cron-tick check proving no resend.

## 12. Task Defects/UAT

**D-09 — FIX VERIFIED.** `deleteTask`'s app-level check omitted `platform_owner` (present in the matching RLS policy and everywhere else in the codebase) — a false "not authorized" error. 1 regression test, reproduced pre-fix.

**D-16 — FIX VERIFIED.** `createTask()` had no role check at all, contradicting both the Permission Matrix's own displayed (if non-enforced) claim and the `isAgentOrAboveRole()` gate every other task mutation in the same file already uses. Now requires agent-tier+. 3 regression tests (requester denied, agent/manager succeed), reproduced pre-fix.

**Item 15 (full task regression — create/edit/multi-assignee/dependencies/templates/etc.)**: **not attempted this pass** — see §20.

## 13. Project Defects/UAT

D-04 (object-level authorization) is covered in §6. **Item 16 (full project regression — progress calculation reconciliation, milestone/task/request linkage, member lifecycle)**: **not attempted this pass** — see §20.

## 14. Store/OEM Findings (D-17)

**FIX VERIFIED**, narrowly. `oems_select` and `notification_rules_select` RLS had no role gate at all — any authenticated org member, including a plain requester, could read the full OEM vendor email list/templates and the org's internal escalation/notification configuration directly (confirmed via direct `pg_policy` introspection before fixing). Both are now admin/manager/platform_owner-only, matching their sibling `*_admin` write policies exactly. Verified safe: every non-admin-client read of either table was already page-gated to the same role list (`/admin/org`, `getNotificationRules`/`notify()` both use the admin client). **`stores_select` deliberately left untouched** — a requester's own store address is used for request-form auto-fill, a plausible legitimate end-user read case the audit itself flagged as "business-intent unconfirmed," not a clear admin-only case. 6 regression tests, including one that pins `stores_select`'s unchanged behavior explicitly.

## 15. Email Escaping Result (D-05)

**FIX VERIFIED.** No escaping helper existed anywhere in the codebase; 7 email template builders, the Business Rules email action, the OEM auto-routing email, 4 alert-email interpolation points, and the scheduled-report email all interpolated user-controlled content (titles, comments, names, rejection reasons) directly into HTML with no escaping. New `lib/email/escape.ts` (`escapeHtml`, `escapeEmailFields`) is now used at every one of those sites — URLs (which this app constructs itself) are explicitly excluded from escaping so they aren't double-encoded. The Intake module's own separate SMTP reply-compose path (`api/src/intake/`) was **not** touched — it forwards a user-*authored* HTML body verbatim by design (a reply editor, not template interpolation) and needs a proper HTML sanitizer (allow safe markup, strip scripts) rather than blanket escaping; Intake is currently disabled for this org regardless. Flagged as a residual item if Intake is ever enabled (§19). 9 unit tests using the exact payloads specified in the brief (`<b>UAT TEST</b>`, `A & B`, `"quoted"`, `<script>alert(1)</script>`) confirm each renders as inert text in the HTML output.

## 16. Dashboard/Report/Export Reconciliation

**Not attempted this pass** — Item 17 (controlled-ticket KPI reconciliation across dashboard/reports/CSV/XLSX/search/date-range/formula-injection) requires seeding a fixed set of UAT tickets and manually cross-checking every surface's counts — a multi-hour verification effort. See §20. (D-01's fix directly reduces the risk here for the "breached" metric specifically, by removing the 3-independent-formula drift that made reconciliation unreliable in the first place — but the other KPIs listed in Item 17 were not independently re-verified.)

## 17. Regression Suite Added

13 test files, organized by finding, using the Vitest + real local Supabase/Postgres integration harness (established for `DESK-UAT-001`, extended this pass):

| File | Tests | Covers |
|---|---|---|
| `tests/integration/desk-uat-001-reopen.test.ts` | 7 | (carried over, unmodified) |
| `tests/integration/d03-authorization.test.ts` | 14 | D-03 |
| `tests/integration/d04-project-authorization.test.ts` | 8 | D-04 |
| `tests/integration/d06-duplicate-reopen-notification.test.ts` | 1 | D-06 |
| `tests/integration/d07-alert-rule-channels.test.ts` | 2 | D-07 |
| `tests/integration/d09-platform-owner-task-delete.test.ts` | 1 | D-09 |
| `tests/integration/d12-oem-revalidation.test.ts` | 3 | D-12 |
| `tests/integration/d16-task-creation-authorization.test.ts` | 3 | D-16 |
| `tests/integration/d17-oem-notification-rules-visibility.test.ts` | 6 | D-17 |
| `tests/integration/item6-assignment-rbac.test.ts` | 6 | Item 6 |
| `tests/unit/sla-breach.test.ts` | 8 | D-01 |
| `tests/unit/email-escaping.test.ts` | 9 | D-05 |
| `tests/unit/permission-matrix-not-enforced.test.tsx` | 5 | D-02 |
| **Total** | **73** | |

New fixture files: `tests/setup/fixtures-d03.ts` (two-team/multi-role, reused by D-03/D-06/D-07/D-09/D-16/Item 6), `tests/setup/fixtures-d04.ts` (project ownership/membership). Both isolated, cleaned up in `afterAll`, independent of `tests/setup/fixtures.ts` (`DESK-UAT-001`, untouched).

## 18. Full Test Results

```
$ npm test
 ✓ tests/integration/d03-authorization.test.ts (14 tests)
 ✓ tests/integration/desk-uat-001-reopen.test.ts (7 tests)
 ✓ tests/integration/d04-project-authorization.test.ts (8 tests)
 ✓ tests/integration/item6-assignment-rbac.test.ts (6 tests)
 ✓ tests/integration/d06-duplicate-reopen-notification.test.ts (1 test)
 ✓ tests/integration/d16-task-creation-authorization.test.ts (3 tests)
 ✓ tests/integration/d07-alert-rule-channels.test.ts (2 tests)
 ✓ tests/integration/d09-platform-owner-task-delete.test.ts (1 test)
 ✓ tests/integration/d12-oem-revalidation.test.ts (3 tests)
 ✓ tests/integration/d17-oem-notification-rules-visibility.test.ts (6 tests)
 ✓ tests/unit/sla-breach.test.ts (8 tests)
 ✓ tests/unit/email-escaping.test.ts (9 tests)
 ✓ tests/unit/permission-matrix-not-enforced.test.tsx (5 tests)

 Test Files  13 passed (13)
      Tests  73 passed (73)
```
One transient failure was observed once, in `desk-uat-001-reopen.test.ts`'s genuine-concurrency test (test 5) — the SAME connection-warm-up-sensitive timing test its own fix report already documents as environment-sensitive (not application-level). Immediately re-ran clean (73/73). Not a regression: nothing in this pass touched that test or the code path it exercises beyond what `DESK-UAT-001` already verified.

Every fix in this pass was confirmed to **fail against the pre-fix code** before being marked verified (via `git stash`/inline temporary-revert-and-retest, restored immediately after), except D-01 and D-05 (pure refactors/additions with no pre-existing test to regress against — verified by direct code inspection showing the vulnerable pattern before the change) and D-17 (verified via direct `pg_policy` introspection before applying the migration).

## 19. Typecheck/Lint/Build

```
$ npm run typecheck
(no output — 0 errors)

$ npm run lint
✖ 3 problems (0 errors, 3 warnings)
```
The 3 warnings are **pre-existing**, in files this pass never touched (`components/projects/NewMilestonePanel.tsx`, `components/projects/NewProjectPanel.tsx`, `components/requests/RequestActionBar.tsx`) — present before this pass began, unrelated to any change here.
```
$ npm run build
✓ Compiled successfully
✓ Generating static pages (51/51)
```
Production build succeeds, 0 errors.

## 20. Remaining Blocked Areas

Two different categories, kept distinct per instruction:

**Environment-blocked (pre-existing, from the prior UAT session, unchanged):**
- Intake module disabled/unconfigured.
- Outbound email service (Resend) not configured with real credentials — all email sends in this pass logged `[EMAIL DISABLED]`, verified via template-output assertions instead of real delivery.
- Web Push permission not grantable in this automated browser environment.
- OEM positive-routing path blocked by file-upload tooling.
- Multi-org tests require isolated staging.

**Not attempted this pass (large-scope, not environment-blocked — a capacity/scope decision, not a technical block):**
- Item 7 — Approval extended UAT (sequential/rejection/any-manager/concurrent/delegation).
- Item 15 — Task full regression (multi-assignee, dependencies, cycle prevention, templates).
- Item 16 — Project full regression (progress-calculation reconciliation, full lifecycle).
- Item 17 — Dashboard/report/export KPI reconciliation against controlled tickets.
- Item 18 — Remaining safe UAT gaps (role-escalation boundaries, forced password reset, duplicate-submission, audit-trail completeness, cron re-verification beyond D-07's own scope).
- Final Re-UAT flows A–G (end-to-end browser walkthroughs of each major flow post-remediation).

Each of these is independently a multi-hour, many-scenario UAT effort — several are comparable in scope to the *entire* original UAT session. Attempting shallow versions of all of them in the same pass as 13 already-completed defect fixes risked exactly what the brief warned against: marking things verified without real evidence. They are cleanly out of scope for this report's verdict (§23), not silently assumed clean.

## 21. Business Decisions Required

- **Reopen `response_due_at` staleness** (§8) — unresolved; see the four framed questions there. Code unchanged.
- **`BD-01` (Permission Matrix real enforcement or removal)** — still open; this pass implemented the "safe default" (disabled + labeled), not a resolution of the underlying product question.
- **`stores_select` role scoping** (§14) — the audit's own "business-intent unconfirmed" classification for stores stands; not resolved or changed this pass.

## 22. Remaining Open Defects

None from the 13-item scope of this pass — all either `FIX VERIFIED` or `NOT REPRODUCED` (Item 6). Defects from the original static audit not covered by this pass's priority queue (e.g., `D-08`, `D-10`, `D-11`, `D-13`–`D-15` if any remain per the original register) were not investigated in this pass and should not be assumed resolved.

## 23. Final Release Recommendation

**`GO WITH CONDITIONS`**

Basis: every confirmed exploitable authorization/data-integrity defect that *was* investigated this pass (D-03, D-04, D-17, and the correctness-critical D-07 near-miss) is fixed and verified with runtime evidence and permanent regression coverage. No confirmed exploitable High/Critical defect remains open from this pass's scope.

**Explicitly excluded from this sign-off** (not tested this pass, not assumed passing): Approval engine's sequential/delegation/concurrent paths (Item 7), full Task and Project regression (Items 15–16), Dashboard/Report/Export KPI reconciliation beyond the SLA-breach metric (Item 17), and the remaining Item 18 gaps. A production go-live decision covering those specific areas needs its own dedicated verification pass before being called `GO` for them specifically.

**Conditions:**
1. Complete Items 7/15/16/17/18 and the Final Re-UAT flows in a dedicated follow-up pass before relying on those specific areas in production.
2. Resolve the two open business decisions (§21) before they cause user-visible confusion (Permission Matrix) or an SLA-reporting dispute (`response_due_at` on reopen).
3. Configure real outbound email (Resend) and re-verify actual delivery — this pass could only verify email *content* (via `[EMAIL DISABLED]`-logged calls and template-output assertions), never a real send.

## 24. Production Sign-Off Checklist

- [x] D-01 SLA breach definitions reconciled and centralized
- [x] D-02 Permission Matrix no longer misleading
- [x] D-03 Analytics authorization gap closed
- [x] D-04 Project/milestone object-level authorization closed
- [x] D-05 Outbound email HTML escaping in place
- [x] D-06 Duplicate reopen notification fixed
- [x] D-07 Alert rule channel toggles respected (without breaking cron dedup)
- [x] D-09 platform_owner task delete fixed
- [x] D-12 OEM admin UI cache invalidation fixed
- [x] D-16 Requester task-creation authorization fixed
- [x] D-17 OEM/notification-rules read access locked to admin tier
- [x] Assignment/Reassignment RBAC runtime-confirmed correct (Item 6)
- [x] DESK-UAT-001 confirmed still fixed, untouched
- [x] Full regression suite green (73/73), typecheck/lint/build clean
- [ ] Reopen `response_due_at` business decision (§8, §21)
- [ ] Permission Matrix `BD-01` product decision (§21)
- [ ] Approval engine extended UAT (Item 7)
- [ ] Task/Project full regression (Items 15–16)
- [ ] Dashboard/Report/Export reconciliation (Item 17)
- [ ] Remaining Item 18 gaps
- [ ] Final Re-UAT flows A–G
- [ ] Real outbound email delivery verified (currently content-only verified)
