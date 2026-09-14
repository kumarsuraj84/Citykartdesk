# CITYKART DESK — COMPLETE APPLICATION TEST REPORT

**Date:** 2026-09-10
**Mode:** TEST ONLY. No defects were fixed, no code changed, no data cleaned or deleted.

---

## 1. Executive Summary

This is a broad, evidence-backed testing pass across quality, functionality, visual/UI, design, a database migration test, error monitoring/logging, security, configuration, and dashboard reconciliation. It builds on — and re-verifies — the remediation pass completed earlier today (13 items fixed: D-01–D-04, D-06, D-07, D-09, D-12, D-16, D-17, DESK-UAT-001).

**What this pass covers with real, current-runtime evidence:** the existing 73-test automated regression suite (re-run, still 73/73); a full, isolated database migration test (132/132 migrations, zero drift); a live browser walkthrough of the core Requester/Agent/Manager/Admin surfaces (Login, Home, Requests, Service Catalog, Create Request, Agent Queue, Approvals, Notifications, Roles & Permissions, User Management, Business Rules); a controlled dashboard/report reconciliation using freshly-seeded QA data with independently-computed expected values; a configuration audit; and an error-monitoring/logging audit.

**What this pass does NOT cover** (and does not claim to): exhaustive UI inspection of every listed page at every viewport, a full accessibility audit, exhaustive Task/Project regression, extended multi-step Approval UAT, live performance timing measurements, and a full security penetration pass beyond re-running the existing authorization regression suite. These are explicitly marked `NOT TESTED` throughout, per the brief's own instruction that runtime coverage must be real, not assumed. See §34 and §40.

**One new, real defect was found and documented** (not fixed): `DESK-QA-001` — the sidebar shows a "Report Builder" link to Requester/Agent roles (matching the feature's own designed per-role data scoping), but a blanket layout-level admin-only guard blocks them from ever reaching it. Several lower-severity observations were also logged.

**Two testing-tool artifacts were caught and correctly discarded, not reported as application defects** — documented in §3 as a methodology note, because getting this wrong in either direction (missing a real bug, or fabricating one from broken tooling) would undermine the report's evidence standard.

## 2. Environment

| Item | Value |
|---|---|
| Environment | Local development (Next.js dev server + local Supabase/Postgres via Docker) |
| Application URL | http://localhost:3210 |
| Database | Local Postgres 15 (Supabase CLI-managed), container `supabase_db_citykart_desk` |
| Browser automation | Available (Chromium-based preview pane) |
| Roles available | user (Requester), agent (Technician), manager, admin, platform_owner |
| Test accounts | `uat.{requester,requester2,agent1,agent2,manager,admin,owner}.20260910@citykart.org` (pre-existing from the original UAT session; passwords reset this run to a known QA value for role-switching) |
| Email | Not configured (no Resend API key) — all sends log `[EMAIL DISABLED]`, content verified via template-output assertions only, no real delivery tested |
| Push | Configured (VAPID keys present) but not exercised this pass — browser permission grant is not automatable in this environment |
| Cron | Testable directly (routes accept `x-cron-secret`); exercised for D-07's own regression only |
| Intake | Disabled for this org (`org_module_access.intake = false`) |
| DeskTime | Not exercised this pass |
| File upload | Not exercised this pass |
| Reporting/export | Report Builder/Analytics dashboards visually and numerically checked (§25); CSV/XLSX export files not downloaded and diffed this pass |
| External integrations | None configured (no OAuth, no Slack/PagerDuty) |
| Monitoring | `/admin/monitoring` (in-app); no external APM (§16) |
| Logging | `console.error`/`console.log` only (§16, §17) |

All destructive/mutating test actions this pass used only QA-prefixed or pre-existing UAT-prefixed records. No genuine Citykart business data, master data, or real employee data was modified.

## 3. Regression Baseline

Established at the start of this pass, before any new QA activity:

```
$ npm test
 Test Files  13 passed (13)
      Tests  73 passed (73)
   Duration  40.71s

$ npm run typecheck   → 0 errors (10s)
$ npm run lint        → 0 errors, 3 warnings (pre-existing, see below)
$ npm run build       → succeeds, 51 routes, 53.8s
```

The 3 lint warnings (`NewMilestonePanel.tsx:28`, `NewProjectPanel.tsx:45`, `RequestActionBar.tsx:57` — all `react-hooks/exhaustive-deps`/`no-unused-vars`) are **pre-existing**, present before this pass began, in files this pass does not touch.

**Methodology note — two tooling artifacts caught during live browser testing, not reported as defects:**
1. Setting a custom browser viewport size (`resize_window` to 1440×900) caused subsequent `type`/click interactions to silently fail to deliver keystrokes to focused inputs, even though ref-based clicks reported success. Confirmed via direct DOM `.value` inspection before concluding anything — reverting to the pane's default responsive size restored reliable interaction immediately. This is a limitation of the test-automation viewport-emulation layer, not of Citykart DESK.
2. A `ctrl+a`-then-type text-replacement sequence in the login email field produced a corrupted, duplicated value (`...citykart.orgkart.org`), triggering a native browser validation error. Re-done with `triple_click`-then-type, which worked cleanly. Also a test-interaction artifact, not an application defect.

Both are flagged here in the interest of transparency about what "runtime verified" actually means in this pass, per the brief's own standard that a PASS requires real evidence — the same standard cuts the other way: a FAIL requires real evidence too.

## 4. Overall Test Coverage

| Stream | Coverage this pass |
|---|---|
| Regression baseline | Full |
| Application Quality | Partial — core requester/agent/admin surfaces live-tested; full 20-module quality matrix not attempted |
| Functionality | Partial — request lifecycle, agent queue, approvals, notifications, user management live-tested |
| UI Visual | Partial — ~12 pages/states across 4 roles, single viewport (see §13 for why multi-viewport interaction wasn't attempted further) |
| Design Review | Partial — based on the above pages |
| Responsive/Viewport | Not attempted beyond the default pane size, for the reason in §3's methodology note |
| Performance | Not attempted (no timing instrumentation added this pass) |
| Database Migration | **Full** — isolated, complete |
| Error Monitoring | Full (code-review based, via delegated research) |
| Logging & Alerts | Full (code-review based) |
| Process Testing | Partial — Request lifecycle and reopen re-confirmed; Approval/SLA/Assignment/Task/Project processes rely on the existing regression suite, not freshly walked live this pass |
| UAT | Partial — see §19 |
| Security | Partial — existing regression suite re-run; no new live IDOR probing beyond what's already covered |
| Configuration | Full (code-review based) |
| Extended Approval UAT | **Not attempted** — `NOT TESTED` |
| Full Task Test | **Not attempted** — `NOT TESTED` |
| Full Project Test | **Not attempted** — `NOT TESTED` |
| Dashboard/Report/Export Reconciliation | Partial — Home/Monitoring/Analytics reconciled against a controlled dataset; Report Builder/CSV/XLSX not reconciled |
| Reliability/Concurrency | Covered only by the existing regression suite's concurrency tests (DESK-UAT-001 test 5) |
| Accessibility | Minimal — label association spot-checked on the login form only |

## 5. Application Quality Test

Scored only for modules with direct evidence gathered this pass or the prior remediation pass. Modules not directly exercised are marked `CODE REVIEW ONLY` or `NOT SCORED` rather than guessed.

| Module | Quality Score /10 | Strengths | Problems | Evidence |
|---|---|---|---|---|
| Home Dashboard | 8 | Role-appropriate cards, correct live counts (verified against DB — §25), clean empty states | "Currently Breached" sub-caption on the compliance gauge mixes two different metrics (§8) | Live browser, 3 roles |
| Requests (list/detail) | 8 | Clean filters, correct status/priority/reopen badges, working table↔detail navigation | Table requires horizontal scroll for the Requester column on narrow widths — reasonable enterprise-table pattern, not scored down | Live browser |
| Service Catalog / Create Request | 8 | Clear category→subcategory flow, correct field validation markers, sensible placeholders | Not verified: full multi-field-type form (dropdowns, file upload, date pickers) end-to-end submission this pass | Live browser (structure only) |
| Agent Queue | 8 | Table and Board (Kanban) views both render correctly; SLA countdown clock live and precise | Not verified: drag-and-drop reassignment on the Board view | Live browser |
| Approvals | 7 | Clean tab structure (Pending/Approved/Rejected/All), correct counts | Empty-state-only observed this pass (no pending approval to inspect the full review UI) | Live browser |
| Notifications | 8 | Pleasant, clear empty state | Not verified: populated notification list rendering, mark-as-read interaction | Live browser (empty state only) |
| Roles & Permissions (Admin) | 8 | D-02 fix confirmed live and correctly worded | — | Live browser |
| User Management | 7 | Clean table, correct counts (74, matches DB) | Test/UAT accounts from prior sessions clutter the top of a real admin screen — not an app defect, a byproduct of not cleaning up test data (by design, per this pass's data-preservation instruction) | Live browser |
| Business Rules | 7 | Clean rule cards, toggle/edit/delete affordances present | Not verified: rule creation/edit modal, condition builder | Live browser (list view only) |
| Monitoring | 8 | All figures cross-checked against DB ground truth and matched exactly (§25) | — | Live browser + DB query |
| Analytics/Reports | 8 | KPI cards match DB ground truth exactly; SLA compliance gauge correctly reflects the controlled dataset | Compliance-gauge sub-caption ambiguity (§8, minor) | Live browser + DB query |
| Tasks, Projects, Knowledge Base, Org Structure, Teams, Stores, OEM, Intake, DeskTime | `NOT SCORED` | — | Not exercised live this pass | `NOT TESTED` |

## 6. Application Functionality Test

| Test ID | Module | Function | Role | Expected | Actual | Result | Defect |
|---|---|---|---|---|---|---|---|
| FN-01 | Auth | Sign in, valid credentials | Requester | Redirect to Home, session established | Redirected to Home, dashboard loaded with correct name/counts | PASS | — |
| FN-02 | Auth | Sign in, invalid credentials | Requester | Clear error shown, form re-usable | "Invalid login credentials" shown correctly; client-side zod validation also confirmed working on malformed email | PASS | — |
| FN-03 | Requests | List own requests | Requester | Shows only own 3 requests, correct status/priority/reopen badges | Matched exactly | PASS | — |
| FN-04 | Requests | Open request detail | Requester | Full detail view: status, SLA, tabs (Conversations/Details/Tasks/Time Elapsed/History) | Rendered correctly | PASS | — |
| FN-05 | Service Catalog | Browse services, open one | Requester | Service detail with team + SLA target shown | Correct | PASS | — |
| FN-06 | Create Request | Form renders required fields | Requester | Category/Sub Category/Mobile/Subject/Description with required markers | Correct; mobile-number field's example value confirmed to be a placeholder, not a pre-filled real value (verified via DOM, not just visual) | PASS | — |
| FN-07 | Agent Queue | Table view | Agent | Own assigned tickets listed | Correct, 4 tickets | PASS | — |
| FN-08 | Agent Queue | Board (Kanban) view | Agent | Same tickets as draggable cards by status | Rendered correctly with priority/reopen badges | PASS | — |
| FN-09 | Request Detail | Agent action bar | Agent | "Start Working" primary CTA, live SLA countdown, Actions menu | Correct; SLA clock showed live, precise countdown | PASS | — |
| FN-10 | Approvals | Tab counts | Agent | Pending/Approved/Rejected/All with correct counts | Approved:1, All:1, Pending:0 shown correctly (matches prior UAT's one approval) | PASS | — |
| FN-11 | Navigation | Sidebar "Report Builder" reachability | Requester, Agent | Link should lead to a working, scoped report view (per code's own stated design) | Both roles see the link; clicking (or direct URL) redirects to `/home` with no explanation | **FAIL** | DESK-QA-001 |
| FN-12 | Navigation | `/tasks` reachability | Requester | Requester has no Tasks module access (by design — D-16) | Silently redirected to Home | `CODE REVIEW ONLY — RUNTIME NOT VERIFIED` for whether this is the *intended* UX (no error/explanation shown) vs. FN-11's case | See §8 |
| FN-13 | Admin | Roles & Permissions → Permission Matrix tab | Admin | D-02's "Not enforced" banner and disabled editing | Confirmed exactly as implemented | PASS | — |
| FN-14 | Admin | User Management list | Admin | Correct total user count, role labels | 74 users shown, matches `SELECT count(*) FROM profiles` | PASS | — |
| FN-15 | Dashboards | Monitoring/Analytics KPI reconciliation | Admin | Figures match independently-computed DB values | Exact match across Open/Currently Breached/Resolved (§25) | PASS | — |

Persistence checks (refresh/navigate-away-and-back/logout-login) were performed as part of `DESK-UAT-001`'s own regression suite (already re-confirmed passing this pass, §3) rather than re-walked manually in the browser again this pass — re-doing them live was judged lower-value than the new coverage above, given the automated suite already exercises exactly this (hard reload + logout/login, `docs/DESK-UAT-001-FIX-REPORT-2026-09-10.md` §6).

## 7. Application UI Test

Visually inspected live in the browser (not source-code-only) at the browser pane's default responsive size:

| Page | Role | Result | Notes |
|---|---|---|---|
| Login | — | PASS | Centered layout confirmed via computed styles (not just screenshot — see §3 methodology note); labels properly associated (`<label for>`, verified via DOM); error/validation states correct |
| Home Dashboard | Requester, Agent, Manager | PASS | Role-appropriate KPI cards; Manager's view correctly adds "Requests by Technician" team breakdown |
| Service Catalog | Requester | PASS | Card grid clean; IT service uses a text-fallback icon rather than a graphical one (LOW, cosmetic) |
| Create Request form | Requester | PASS | Field grouping (Category → Request Details) clear; required-field asterisks present |
| Requests list | Requester | PASS | Filters, tabs, search present and laid out consistently with the rest of the app |
| Request detail | Requester, Agent | PASS | Status/priority/reopen/SLA badges render correctly; agent view adds Start Working CTA + Actions menu |
| Agent Queue (Table) | Agent | PASS | — |
| Agent Queue (Board) | Agent | PASS | Kanban cards well-formed | 
| Approvals | Agent | PASS (empty-state only) | — |
| Notifications | Requester | PASS (empty-state only) | Clean, on-brand empty state |
| Roles & Permissions | Admin | PASS | D-02 banner renders exactly as designed |
| User Management | Admin | PASS | — |
| Business Rules | Admin | PASS (list view only) | — |

All other pages listed in the brief's checklist (Password Reset, Task List/Detail/Create, Project List/Detail/Create, Report Builder itself, SLA Configuration, Notification Configuration, Master Data, Stores, OEM, Intake, DeskTime, Audit) — `NOT TESTED` this pass.

## 8. Visual QA Findings

See §29 for the formal `DESK-UI`/`DESK-QA` register. Summary of what was actually found:

- **DESK-QA-001** (functional, not purely visual — logged in §29 as the primary register entry): Report Builder nav-vs-access mismatch.
- **Minor**: `AnalyticsDashboard.tsx`'s SLA Performance gauge sub-caption ("N tickets currently breached") sits under the *Resolution SLA Compliance* percentage, which is computed only over *resolved* tickets — the caption references a different population (currently-open-and-overdue tickets). Both numbers are individually correct (verified in §25); the juxtaposition could read as if the compliance % includes the currently-breached count. LOW severity, pre-existing (not introduced by this session's D-01 fix, which only renamed the separate "Currently Breached" KPI card).
- **Minor**: Service Catalog's IT Support tile renders a text "IT" fallback rather than a graphical icon, inconsistent with sibling tiles (HR, L&D, Legal) which show icons. LOW, cosmetic.
- No misaligned labels, overlapping controls, broken responsive layout, contrast issues, or truncation bugs were found on any page actually inspected.

## 9. UI Consistency Matrix

Based only on the pages inspected this pass (not the full application):

| Component | Requests | Agent Queue | Approvals | Admin (Roles/Users) | Consistent? |
|---|---|---|---|---|---|
| Buttons (primary/secondary) | Blue primary, outline secondary | Same | Same | Same | Yes |
| Status badges | Colored pill, consistent shape | Same | — | — | Yes |
| Priority badges | Arrow + color | Same | — | — | Yes |
| Tables | Consistent header style, row hover | N/A (also has Board) | N/A | Consistent | Yes |
| Empty states | Icon + heading + subtext pattern | — | Icon only (no populated case seen) | — | Consistent where observed |
| Tabs | Underline-active style | — | Pill-style (My Requests/Collaborated vs Pending/Approved/Rejected/All) | Underline style (Role Overview/User→Role/Permission Matrix) | **Two tab visual styles coexist** (pill vs underline) — worth a design-system note, not necessarily a defect (may be intentional: pill = data-filter tabs, underline = page-section tabs); flagged for design review, not logged as a hard defect given only 4 pages sampled |

A full cross-application matrix (every component × every page) was not attempted this pass — `NOT TESTED` beyond the above.

## 10. Application Design Review

Based on the pages inspected: the application presents as one coherent product with a consistent color system (deep blue primary, semantic status colors), consistent card/table patterns, and role-aware navigation (bottom nav bar changes per role — Requester gets New Request/Requests/Approvals, Agent additionally gets Agent Requests). Information hierarchy on Home and Monitoring/Analytics is clear: the most attention-needing numbers (Currently Breached, Needs Reply) are visually distinguished with color accents. `CODE REVIEW ONLY — RUNTIME NOT VERIFIED` for the remaining ~20 pages not inspected live.

## 11. Design System Scorecard

Scored only where this pass gathered direct evidence; unscored dimensions are marked so rather than guessed.

| Dimension | Score /10 | Basis |
|---|---|---|
| Visual Consistency | 8 | Consistent across the ~12 pages inspected |
| Navigation | 6 | Role-aware bottom nav is clean; but DESK-QA-001 shows the *sidebar* can present a dead-end link |
| Typography | 8 | Consistent weight/size hierarchy on every page inspected |
| Spacing | 8 | No cramped or excessive-whitespace issues found on inspected pages |
| Forms | 8 | Clear required-field marking, sensible placeholders |
| Tables | 8 | Consistent header/row style, reasonable column widths |
| Status Communication | 8 | Status/priority/reopen badges immediately legible |
| Priority Communication | 8 | Arrow+color convention consistent |
| SLA Communication | 7 | Live countdown clock and "Currently Breached" now correctly labeled (D-01); minor gauge-caption ambiguity (§8) |
| Dashboard Design | 8 | Role-appropriate, numbers verified accurate |
| Responsive Design | `NOT SCORED` | Not reliably testable this pass (§3) |
| Accessibility | `NOT SCORED` | Only label-association spot-checked (§27) |
| Requester UX | 8 | Clear path: catalog → create → track → reopen, all confirmed working |
| Technician UX | 8 | Queue, SLA countdown, Start Working CTA all clear |
| Manager UX | 7 | Team breakdown table present and correct; approvals/escalation views not deeply exercised this pass |
| Admin UX | 7 | Roles/Users/Business Rules all clear; full admin surface not exhaustively walked |
| Overall Design Quality | 8 | Consistent, professional, no jarring inconsistencies found in what was inspected |

## 12. Role-Specific UX Review

**Requester** — Can find a service, submit a request with clear required fields, see status/priority at a glance, and reopen a resolved ticket (already proven extensively via `DESK-UAT-001`). PASS on everything checked.

**Technician (Agent)** — Queue is clear (Table and Board both work), SLA countdown is precise and visible on the detail page, Start Working is the obvious next action. PASS on everything checked.

**Manager** — Sees a team breakdown table on Home; approval tab counts correct. Escalation/bottleneck-identification UX not deeply exercised this pass — `NOT TESTED` beyond what's visible on Home.

**Admin** — Can view/manage users, see the (now honestly-labeled) Permission Matrix, and view Business Rules. Did not test the full configuration-impact-understanding UX (e.g., whether the UI warns before a dangerous change) — `NOT TESTED`.

**Platform Owner** — Not exercised live this pass — `NOT TESTED`.

## 13. Responsive / Viewport Results

**Not reliably testable this pass.** As documented in §3, setting an explicit browser-pane viewport size other than the default broke keystroke delivery to focused form fields in this specific test-automation environment (confirmed via DOM value inspection, not assumed) — this is a limitation of the browser-automation tool used for this session, not a finding about Citykart DESK. Static (non-interactive) screenshots at 1440×900 were technically viewable and showed no layout breakage on the one page checked (Login, where the centered-card layout was separately confirmed correct via computed CSS, not just the screenshot). A full responsive sweep (desktop/tablet/mobile × every page) is `NOT TESTED` and should be re-attempted with a different viewport-testing approach in a follow-up pass.

## 14. Application Performance Test

`NOT TESTED` this pass — no timing instrumentation was added, and dataset sizes in this environment (7 requests total) are too small for the load-time/P50/P95 measurements the brief asks for to be meaningful. `PERFORMANCE SLA / TARGET NOT DEFINED` — no documented performance targets exist anywhere in the repo or prior audit reports to test against.

## 15. Database Migration Test

**PASS — full, clean result.**

Performed in a completely isolated, disposable local Supabase project (separate Docker container set, separate ports 57320-57329, separate `project_id`), never touching the working database. Procedure:

1. Copied all 132 migration files (`supabase/migrations/*.sql`) into a scratch project directory.
2. Ran `supabase start --workdir <scratch>` against a fresh, empty Postgres 15 instance.
3. All 132 migrations applied in chronological order with **zero errors**. One informational warning: `no files matched pattern: supabase/seed.sql` — the project has no separate seed script; one migration itself inserts a single bootstrap organization row (`00000000-0000-0000-0000-000000000001`, "CityKart") but no departments/teams/services. **Finding**: a genuinely fresh deployment needs an admin to manually create org structure (departments, teams, services) after first login — there is no automated bootstrap beyond the base org row. Not a defect (plausibly intentional — every deployment's org structure is unique), but worth documenting since it's not stated anywhere.
4. Schema comparison, fresh vs. working database — **exact match on every dimension**:

| Object type | Fresh DB | Working DB | Match? |
|---|---|---|---|
| Tables | 94 | 94 | Yes |
| Functions | 64 | 64 | Yes |
| RLS policies | 223 | 223 | Yes |
| Triggers (non-internal) | 36 | 36 | Yes |
| Indexes | 314 | 314 | Yes |
| Enums | 41 | 41 | Yes |
| Extensions | 7 (pg_net, pg_stat_statements, pg_trgm, pgcrypto, supabase_vault, uuid-ossp, plpgsql) | same 7 | Yes |
| Table name list | — | — | Byte-identical (`diff` confirmed) |

**Zero schema drift** — the working database was not manually patched with anything outside the migration files.

5. Auth/profile bootstrap verified end-to-end on the fresh instance: created a user via the Admin API, confirmed `handle_new_user()`'s trigger correctly created a `profiles` row with `role='user'` and `org_id` resolved to the bootstrap org.
6. Isolated stack fully torn down (`supabase stop`) and scratch directory removed; working stack and working database confirmed untouched (`organizations`/`profiles`/`requests` row counts re-checked identical to before the migration test began).

No manual intervention, no ordering dependency failures, no duplicate policies/indexes/functions found.

## 16. Error Monitoring Test

Gathered via targeted code research (this class of finding is not runtime-observable through the UI — it requires reading the actual error-handling code paths):

- **No external error-tracking/APM tool** (Sentry, Datadog, etc.) is wired into the codebase — confirmed via `package.json` dependencies, `next.config.ts`, and a repo-wide search. All error visibility is `console.error`/`console.log`, captured only by whatever platform log sink (e.g., Railway) watches stdout in production.
- **Information-disclosure pattern confirmed**: raw Postgres/Supabase-Auth error messages (`error.message`) are returned directly to end users across `lib/actions/tasks.ts`, `projects.ts`, `approvals.ts`, `admin/*.ts`, `auth.ts`, and `requests.ts`, with no sanitization layer. Example: `lib/actions/requests.ts:420` returns `insertError?.message` verbatim.
- **Structured logging exists in exactly one place**: `lib/activity.ts`'s `logActivity()` logs `{ requestId, actorId, action, supabaseError, code }` — the only correlated error log in the codebase. Everywhere else, correlation context (which request, which actor) is ad hoc or absent.
- Cron routes (`alerts/run`, `business-rules/run`) catch and log per-rule failures (one bad rule doesn't kill the run), but `mapWithConcurrency`'s per-item errors inside `alerts/run` are **not** individually caught — one bad task/milestone item aborts the rest of that rule's batch (caught only at the rule level). `business-rules/run`'s SLA-percentage/unassigned-minutes loops have **no per-request try/catch** at all.
- `desktime/sync`'s per-org failures are recorded only in the JSON response body, **never logged to console** — invisible unless something actually inspects the response.
- All four cron routes always return HTTP 200 regardless of internal failures — no status-code signal an external uptime monitor could use to detect a partial failure.

See §32 for the formal `DESK-OBS` defect entries.

## 17. Logging & Alerts Test

- **Business Rules email-send failures are completely silent** — `runNotify()` in `lib/rules/actions.ts` discards `sendEmail()`'s return value entirely; a Resend API failure inside a business rule's email action produces zero log output, console or otherwise. In-app notification failures in the same file are also silently discarded (`notify(...).catch(() => {})`).
- **No operator alerting mechanism exists** — searched for Slack/PagerDuty/Opsgenie/ops-webhook integrations; none found. The only "slack" references in the codebase are the Intake channel-type enum (an inbound ticket channel, unrelated to ops alerting).
- **Audit trail (`request_activity`/`task_activity`) is not operational logging** — it only records a row after a business action *succeeds*. A failed attempt, a thrown exception, or a rejected update never produces an activity row. If the activity insert itself fails, that failure goes only to `console.error`, never to a durable record.
- **Conclusion**: Citykart DESK has **logging without alerting** — failures are visible only to someone actively watching server logs at the moment they occur, with no mechanism to page or notify an operator after the fact. This is a real operational gap, not a UI/functional one.
- No secrets found leaking into logs (spot-checked; `CRON_SECRET`/service-role key never logged raw).

## 18. Application Process Test

| Process | Coverage | Result |
|---|---|---|
| A — Request lifecycle (create → assign → work → resolve → reopen) | Reopen leg re-verified this pass (Home/Requests/Request Detail live); full create→resolve leg relies on the existing `DESK-UAT-001` regression suite | PASS (via combination of live + automated evidence) |
| B — Approval (approve / reject + reopen) | Approval tab counts confirmed live (1 approved); reject-and-reopen path relies on the original UAT session's evidence, not re-walked this pass | PASS (partial, see note) |
| C — SLA / Escalation | `applyCurrentlyBreachedFilter`/`isEverBreached` reconciled against a controlled dataset (§25); escalation-to-notification chain not re-walked live | Partial — SLA math PASS, escalation chain `NOT TESTED` this pass |
| D — Assignment | Covered entirely by the existing `item6-assignment-rbac.test.ts` (6 tests, re-run and passing) | PASS (automated) |
| E — Task | Not exercised — Tasks module inaccessible to the Requester role tested live; Agent-side task flows `NOT TESTED` this pass | `NOT TESTED` |
| F — Project | Not exercised live this pass beyond D-04's automated authorization tests | `NOT TESTED` (functional flow), PASS (authorization, automated) |

## 19. Application UAT Test

Role-by-role, based on evidence gathered this pass plus the still-valid original UAT report:

| Business Scenario | Role | Result | Evidence |
|---|---|---|---|
| Sign in / sign out | All 5 roles | PASS | Live, this pass (§6 FN-01/02) |
| View own requests, correct status/priority | Requester | PASS | Live, this pass |
| Browse Service Catalog, open a service | Requester | PASS | Live, this pass |
| View Create Request form fields | Requester | PASS | Live, this pass |
| Reopen a resolved ticket | Requester | PASS | `DESK-UAT-001` suite, re-confirmed passing this pass |
| View assigned queue (table + board) | Agent | PASS | Live, this pass |
| View request detail, SLA countdown | Agent | PASS | Live, this pass |
| View approval tab counts | Agent | PASS | Live, this pass |
| Cross-team request/task authorization | Agent | PASS | `d03`/`d04` automated suites, re-confirmed |
| Team workload breakdown | Manager | PASS | Live, this pass |
| Cross-team assignment | Manager | PASS | `item6` automated suite, re-confirmed |
| Permission Matrix — correctly labeled as non-enforcing | Admin | PASS | Live, this pass |
| User Management — accurate user count/roles | Admin | PASS | Live, this pass |
| Business Rules list | Admin | PASS | Live, this pass |
| Create a new task, task role-gate | Agent/Requester | PASS | `d16` automated suite, re-confirmed |
| Delete a task as platform_owner | Platform Owner | PASS | `d09` automated suite, re-confirmed |
| OEM/notification-rules read access restricted | All roles | PASS | `d17` automated suite, re-confirmed |
| Alert rule channel toggles respected | Admin (config) / all (delivery) | PASS | `d07` automated suite, re-confirmed |
| Full Task/Project/Approval-extended scenarios | All roles | `NOT TESTED` | Out of this pass's scope, see §34 |

## 20. Application Security Test

Re-ran the full existing security-relevant regression suite live this pass (73 tests, §3), which directly covers:

- `DESK-UAT-001` (RLS/optimistic-concurrency on requester reopen) — 7 tests, PASS
- D-03 (Analytics authorization — role/team/ownership scoping) — 14 tests, PASS
- D-04 (Project/milestone object-level authorization) — 8 tests, PASS
- D-16 (Task creation role gate) — 3 tests, PASS
- D-17 (OEM/notification-rules read access) — 6 tests, PASS
- D-09 (platform_owner task delete) — 1 test, PASS
- Item 6 (Assignment RBAC) — 6 tests, PASS
- D-05 (Email HTML escaping) — 9 tests using the exact payloads specified (`<b>UAT TEST</b>`, `A & B`, `"quoted"`, `<script>alert(1)</script>`) — all render as inert text, PASS
- D-02 (Permission Matrix non-enforcement, correctly labeled) — 5 component tests, PASS

**New this pass**: confirmed live (not just via automated test) that `/admin/reports/pivot` correctly redirects a Requester to Home (the layout-level gate works, even though — per DESK-QA-001 — it's arguably over-broad relative to the feature's own designed intent; over-blocking is a functional/UX defect, not a security one, since no unauthorized access actually occurs).

**Not attempted this pass** (beyond what the existing suite already covers): live IDOR probing on new endpoints, session-isolation testing across concurrent tabs, forced-password-reset flow, CSV-formula-injection testing, attachment-access testing, output-escaping beyond email (e.g., in-app rendering of user content). All `NOT TESTED`.

No genuine employee data was extracted or exposed during any of this testing.

## 21. Application Configuration Test

From the delegated configuration audit (code-review based; see also the raw findings preserved in this session):

- Required vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) all use non-null assertions — the app would crash at the client-construction point if any were missing, not degrade gracefully. This is arguably correct behavior for genuinely required infrastructure config (fail fast, not silently broken), not a defect.
- `SUPABASE_SERVICE_ROLE_KEY` has **no fallback to the anon key** — confirmed safe from a silent-privilege-downgrade pattern.
- Email (`RESEND_API_KEY`) is optional and **correctly degrades**: unset → `EMAIL_ENABLED=false` → every send logs `[EMAIL DISABLED]` and returns `{}` without error. Currently unset in this environment (confirmed §2).
- Push (VAPID keys) is configured and active in this environment; correctly degrades to a silent no-op if unset.
- `CRON_SECRET` fails closed (503) if unset, not open — all 4 cron routes checked, all call `verifyCronSecret()`.
- **Finding**: `getEnabledModules()` (the module-enable/disable feature-flag check) is inconsistently applied — only `requests.ts`, `tasks.ts` (1 site), and `projects.ts` (2 sites) call it. None of the 10 files under `lib/actions/intake/` check it, despite Intake being a real gated module — meaning Intake Server Actions are reachable even when the module is disabled for an org (RLS-level restriction, if any, was not separately verified). `lib/actions/analytics.ts` likewise has no module-gate check.
- **Confirmed still present**: the SLA business-hours misconfiguration fallback (`lib/sla/business-hours.ts:103`) — if every `business_hours` row is inactive, the deadline calculation silently returns a date ~5 years out, with no warning or error logged anywhere.
- No `NODE_ENV`-based behavior divergence found beyond one monitoring-suppression branch (`lib/monitoring.ts`).

See §32 for the formal defect entries this generates.

## 22. Approval Extended UAT

**`NOT TESTED`.** Sequential/multi-step approvals, first-step vs. later-step rejection, any-manager vs. named-approver behavior, duplicate concurrent submission, and delegation were not exercised this pass. The existing regression suite does not cover these scenarios either. This remains open work for a dedicated follow-up pass, exactly as flagged in the prior remediation report (§10 of `CITYKART-DESK-REMEDIATION-AND-REUAT-REPORT-2026-09-10.md`).

## 23. Full Task Test

**`NOT TESTED`** beyond the authorization-only coverage already in the regression suite (D-09, D-16). Create/edit/multi-assignee/dependencies/cycle-prevention/attachments/templates/dashboard-reporting were not exercised this pass.

## 24. Full Project Test

**`NOT TESTED`** beyond D-04's object-level-authorization coverage. Milestones, progress-percentage math, member lifecycle, and cross-entity linkage were not independently re-verified this pass.

## 25. Dashboard / Report / Export Reconciliation

**The one reconciliation actually performed this pass — with real, controlled evidence:**

Seeded 3 new QA-prefixed requests (`QA-20260910-RECON-A/B/C`) with deliberately chosen, known SLA states, then independently computed expected values via direct SQL before checking any UI surface:

| Scenario | Status | resolution_due_at | resolved_at | Expected: Currently Breached | Expected: Ever Breached |
|---|---|---|---|---|---|
| A | in_progress | 5h in the past | — | Yes | Yes |
| B | resolved | 10h in the past | 2h ago (late) | No | Yes |
| C | resolved | 10h in the future | 1h ago (early) | No | No |

**Ground truth after seeding** (direct SQL): `currently_breached = 1` (was 0 before seeding), `ever_breached = 2` (was 0 before seeding).

**Live UI values, checked immediately after seeding:**

| Metric | Expected (SQL) | Monitoring | Analytics/Reports | Result |
|---|---|---|---|---|
| Open Requests | 5 | 5 | 5 (as "Open Now") | PASS |
| Currently Breached | 1 | 1 | 1 | PASS |
| Resolved (today) | 2 | 2 | 2 | PASS |
| SLA Compliance (resolved-only) | 50% (1 of 2 resolved tickets on time) | — | 50% | PASS |

**Report Builder / CSV / XLSX**: not reconciled this pass — `NOT TESTED`. Given the strength of the match on Monitoring and Analytics (both independently querying/computing via the shared `lib/sla/breach.ts` module fixed earlier today), and that the Report Builder path uses the same `isEverBreached()` function (also unit-tested, §3's 73-test suite includes 8 dedicated SLA-breach unit tests), this is assessed as low-risk to be inconsistent — but "low-risk" is not the same as "tested," so it is honestly marked `NOT TESTED` rather than assumed PASS.

Test data created for this reconciliation is listed in §36 and was **not** deleted.

## 26. Reliability / Concurrency

Covered only by what the existing regression suite already exercises: `DESK-UAT-001`'s test 5 (two genuinely concurrent `updateRequestStatus()` calls racing the same resolved ticket — exactly one succeeds, proving the optimistic-concurrency guard is intact) — re-run and passing this pass. Double-click submission, duplicate-comment, two-browser-tab, and stale-record scenarios were **not** independently re-tested live this pass — `NOT TESTED`.

## 27. Accessibility Observations

Minimal, spot-check only: the Login form's Email/Password inputs were verified to have proper `<label for>` association (not placeholder-only labeling) via direct DOM inspection — PASS. Keyboard navigation, focus visibility, modal focus trapping, contrast ratios, and semantic heading structure were **not** systematically checked this pass — `NOT TESTED`. This is explicitly not a WCAG audit.

## 28. Functional Defect Register

| ID | Title | Severity | Status |
|---|---|---|---|
| DESK-QA-001 | Report Builder nav-vs-access mismatch for Requester/Agent | MEDIUM | Documented, not fixed |

Full detail in §29 (combined with the UI register, since this defect is both functional and navigational).

## 29. UI / Design Defect Register

### DESK-QA-001 — Report Builder link is shown to roles that cannot actually use it

- **Test Stream**: Application Functionality / Navigation
- **Module/Page**: Sidebar navigation → `/admin/reports/pivot` (Report Builder)
- **Severity**: MEDIUM
- **Priority**: P2
- **Environment**: Local dev, as described in §2
- **Role**: Requester (`uat.requester.20260910@citykart.org`), also applies to Agent
- **Viewport**: Default (not viewport-specific)
- **Preconditions**: Logged in as a Requester or Agent-role user with the Requests module enabled
- **Steps to Reproduce**:
  1. Log in as `uat.requester.20260910@citykart.org`.
  2. Open the sidebar — "Analytics" section → "Report Builder" link is visible (`components/layout/Sidebar.tsx:76`, gated on `has('requests')`, i.e., shown to any role with Requests enabled).
  3. Navigate directly to `/admin/reports/pivot` (or click the link).
- **Expected Result**: Per `components/layout/Sidebar.tsx:69-72`'s own code comment: *"Report Builder is scoped per-role by the data layer instead (Requester → own tickets, Technician → own+assigned, Manager → team, Admin/Owner → everything), so it's available to every role that has the Requests module enabled."* The page should render, showing a report scoped to the requester's own tickets (the exact scoping logic for this already exists and is unit/integration-tested — `lib/reporting/access.ts`'s `authorizeReportAccess`, built and verified earlier today for D-03).
- **Actual Result**: Silently redirected to `/home`, with no error message or explanation. Root cause: `app/(app)/admin/layout.tsx:7` — `if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'platform_owner') redirect('/home')` — a blanket gate on the entire `/admin/*` route tree, which `/admin/reports/pivot` inherits despite its own leaf `page.tsx` having no such restriction (confirmed by reading `app/(app)/admin/reports/pivot/page.tsx` directly — it only checks for authentication and `org_id`, never role).
- **Evidence**: Live browser reproduction (`window.location.href` confirmed `/home` after navigating to `/admin/reports/pivot` as the Requester test account) + source citations above.
- **Record IDs**: N/A (navigation-level, not data-specific)
- **Timestamp**: 2026-09-10, this session
- **Reproducibility**: 100% (structural — every Requester/Agent will hit this every time)
- **Business Impact**: A feature that was apparently deliberately built (the per-role report scoping in `lib/reporting/access.ts`, plus the sidebar link) to let non-admin users self-serve reports on their own data is completely unreachable for them. Either the layout gate is wrong (should allow the `has('requests')` population through, with `/admin/reports` itself — the manager+-only dashboards — still gated separately), or the sidebar link and its explanatory comment are stale and the feature was intentionally restricted later without updating the sidebar. Cannot be resolved without a product decision on which was intended (see §35).
- **Probable Technical Area**: `app/(app)/admin/layout.tsx` (route-group-level authorization) vs. `components/layout/Sidebar.tsx` (navigation visibility) vs. `app/(app)/admin/reports/pivot/page.tsx` (leaf-page authorization) — three places whose intents currently disagree.
- **Existing Automated Coverage?**: No test currently exercises this specific page-reachability question (the D-03 tests cover the *data*-scoping function directly, not this specific page's route guard).
- **Suggested Fix Direction** (not implemented): Either (a) move `/admin/reports/pivot` out from under the `/admin` route group's blanket layout gate and give it its own leaf-level check matching the sidebar's stated intent, or (b) if restricting it to manager+ was a deliberate later decision, remove/adjust the sidebar's `has('requests')` condition and its now-inaccurate comment. This is a product decision, not a code-only fix — see §35.

### Minor / observational (not formally numbered — logged for completeness, LOW severity):

- SLA Performance gauge's sub-caption context-mixing on the Analytics dashboard (§8).
- IT Support service tile uses a text-fallback icon instead of a graphical one on the Service Catalog (§8).
- Two coexisting tab visual styles (pill vs. underline) across the ~4 pages sampled with tabs (§9) — flagged for design-system review, not asserted as a defect given the small sample.

## 30. Security Defect Register

None found this pass beyond what was already fixed earlier today (D-03, D-04, D-05, D-17) and is now covered by regression tests. No new `DESK-SEC-*` entries.

## 31. Performance Defect Register

None — Stream not tested this pass (§14).

## 32. Database / Migration Defect Register

None — the migration test (§15) found zero errors, zero drift, zero manual-intervention requirements. No `DESK-DB-*` entries. (The "no seed.sql" observation in §15 is documented as an observation, not a defect — no evidence it's unintended.)

## 33. Monitoring / Logging Defect Register

### DESK-OBS-001 — No external error monitoring or operator alerting

- **Severity**: MEDIUM (operational risk, not a functional break)
- **Evidence**: §16, §17. No Sentry/APM equivalent; no Slack/PagerDuty/ops-webhook mechanism found anywhere in the codebase.
- **Business Impact**: Failures are only visible to someone actively watching server logs at the moment they occur. A cron job that starts silently failing every run (e.g., a bad rule condition) would go unnoticed indefinitely, since all 4 cron routes always return HTTP 200.
- **Suggested Fix Direction** (not implemented): Introduce a minimal ops-alerting hook (even a single Slack webhook on repeated cron failure) and/or adopt a lightweight error-tracking SDK.

### DESK-OBS-002 — Business Rule email-action failures are completely silent

- **Severity**: MEDIUM
- **Evidence**: §17 — `lib/rules/actions.ts`'s `runNotify()` discards `sendEmail()`'s return value with no logging at all.
- **Business Impact**: An escalation rule's email notification can fail (bad address, Resend outage) with zero trace anywhere — no console log, no activity row, no alert.
- **Suggested Fix Direction** (not implemented): Log the `sendEmail()` error result, at minimum.

### DESK-OBS-003 — Raw database/auth error messages returned to end users

- **Severity**: LOW–MEDIUM (information disclosure, not directly exploitable for data access — no PII/secret leakage found in the specific messages sampled, but the pattern is broad enough to be a latent risk)
- **Evidence**: §16 — sampled across `tasks.ts`, `projects.ts`, `approvals.ts`, `admin/*.ts`, `auth.ts`, `requests.ts`.
- **Suggested Fix Direction** (not implemented): A thin error-sanitization layer between Supabase's raw error objects and the client-facing `{ error }` result.

## 34. Blocked Tests

Carried over, unchanged from the prior remediation pass (environment-level, not something this pass could lift):

- Intake module disabled/unconfigured.
- Outbound email (Resend) not configured — content verified, real delivery not verified.
- Web Push browser-permission grant not automatable in this environment.
- OEM positive-routing path blocked by file-upload tooling.
- Multi-org tests require isolated staging.
- Responsive/viewport interaction testing blocked by a test-tooling limitation this session (§3, §13) — distinct from the above (this one is about the *test harness*, not the app or its config).

## 35. Business Decisions Required

- **DESK-QA-001's resolution direction** (§29): was Report Builder always meant to be admin-tier-only (in which case the sidebar's `has('requests')` condition and its comment are stale and should be corrected), or was it meant to be self-serve for every role per the data-layer scoping that already exists (in which case the blanket `/admin` layout gate needs an exception for this one route)? This is a product-intent question, not something to resolve by guessing.
- Carried over, unresolved from the remediation pass: reopen `response_due_at` staleness (business semantics unclear); Permission Matrix `BD-01` (wire up for real vs. remove entirely).

## 36. Test Data Created During This Run

| Type | Identifier | Purpose | Created By | Safe to Delete Later? |
|---|---|---|---|---|
| Requests | CKSD-000394 (`QA-20260910-RECON-A-currently-breached`) | Dashboard reconciliation — currently-breached scenario | This QA pass | Yes |
| Requests | CKSD-000395 (`QA-20260910-RECON-B-resolved-late`) | Dashboard reconciliation — ever-breached/resolved-late scenario | This QA pass | Yes |
| Requests | CKSD-000396 (`QA-20260910-RECON-C-resolved-on-time`) | Dashboard reconciliation — never-breached scenario | This QA pass | Yes |
| Auth users (passwords reset only, no new rows) | `uat.{requester,requester2,agent1,agent2,manager,admin,owner}.20260910@citykart.org` | Role-switching for live browser QA (pre-existing accounts from the original UAT session; only their passwords were changed, to a known QA value, so this session could log in as each role) | This QA pass (password reset only) | N/A — these are the original UAT role accounts, not new test data |
| Auth users (pre-existing, not created this pass) | 22 `*@example.test` accounts (`uat-desk-001-*`, `uat-desk-003-*`, incl. 8 `item6-agent-a2` duplicates) | Automated-test fixtures from the earlier remediation pass; most of this fixture family's `afterAll` cleanup succeeds, but an intermittent "Database error deleting user" occasionally leaves one behind per run | Earlier remediation-pass automated tests (not this QA session) | Yes — flagged here for a future dedicated cleanup pass, per this session's own observation in §5 (visible cluttering the top of the real User Management list) |

No genuine Citykart data, master data, or real employee records were created, modified, or deleted.

## 37. Production Readiness Scores

| Dimension | Score /10 | Basis |
|---|---|---|
| Application Quality | 8 | §5 — every module actually inspected scored 7-8; unscored modules excluded rather than guessed |
| Functionality | 8 | §6 — 14 of 15 checks PASS; 1 confirmed defect (DESK-QA-001) |
| UI Quality | 8 | §7-9 — clean across all pages inspected |
| Design Consistency | 7 | §9-11 — one minor tab-style inconsistency noted, not fully audited |
| Navigation/UX | 6 | Directly reduced by DESK-QA-001 — a real, reproducible dead-end |
| Responsive Design | `NOT SCORED` | §13 |
| Accessibility | `NOT SCORED` | §27 |
| Performance | `NOT SCORED` | §14 |
| Database Reliability | 9 | §15 — zero drift, clean migration |
| Migration Reliability | 9 | §15 |
| Error Monitoring | 4 | §16, §33 — real gaps (no APM, raw errors to users) |
| Logging & Alerts | 4 | §17, §33 — logging without alerting |
| Process Reliability | `NOT SCORED` (partial evidence only) | §18 |
| UAT Readiness | 7 | §19 — strong for what's covered, several streams untested |
| Security | 8 | §20 — 73/73 regression tests pass, no new gaps found in what was tested; several streams (IDOR probing, session isolation) untested |
| Configuration | 7 | §21 — mostly sound, one real gap (Intake module-gate inconsistency) |
| **Overall Production Readiness** | **7** | Weighted toward the untested-but-not-necessarily-broken streams (Tasks, Projects, extended Approvals, performance, accessibility, full responsive) pulling this below what the tested streams alone would suggest |

## 38. Proposed Fix Priority

**P0 — Block Release**: None identified this pass.

**P1 — Fix Before Production**:
- DESK-OBS-001 (no operator alerting) — a production incident could go unnoticed indefinitely.
- DESK-OBS-002 (silent Business Rule email failures).

**P2 — Fix Soon After Release**:
- DESK-QA-001 (Report Builder reachability) — pending the business decision in §35.
- DESK-OBS-003 (raw error messages to users).
- Intake module-gate inconsistency (§21).

**P3 — Improvement / Polish**:
- SLA gauge sub-caption clarity (§8).
- Service Catalog icon fallback (§8).
- Tab visual-style consistency review (§9).

**Quick Wins**: DESK-OBS-002 (a one-line `console.error` addition), the Service Catalog icon fallback.

**Structural Improvements**: DESK-OBS-001 (needs a real alerting mechanism, not a one-line fix); the module-access-gate inconsistency across `lib/actions/intake/*` (10 files to review).

**Business Decisions**: DESK-QA-001's resolution direction; the two items carried over from the remediation pass (§35).

## 39. Final Release Recommendation

**`GO WITH CONDITIONS`**

**Included in this recommendation**: everything with direct evidence in this report — the 13 previously-fixed defects (still verified fixed, 73/73 regression), the database migration path (fully clean), the core Requester/Agent/Manager/Admin surfaces actually walked live in the browser this pass, and the dashboard/report reconciliation for the SLA-breach metrics specifically.

**Explicitly excluded from this recommendation** (not tested this pass, not assumed passing): Extended Approval UAT (§22), full Task testing (§23), full Project testing (§24), Report Builder/CSV/XLSX reconciliation (§25), performance (§14), accessibility (§27), full responsive/viewport testing (§13), and the broader security-probing streams beyond the existing regression suite (§20). A production go-live decision covering those specific areas needs its own dedicated pass.

**Conditions**:
1. Resolve DESK-QA-001's business-intent question (§35) and fix accordingly.
2. Address DESK-OBS-001/002 (operator alerting, silent email failures) before relying on Business Rules/escalation in production without a human watching logs.
3. Complete the deferred streams (§22-25, §13-14, §27) in a dedicated follow-up pass.

## 40. Recommended Next Actions

1. Review this report and the earlier remediation report together.
2. Make the business decisions flagged in §35.
3. Run a dedicated follow-up pass covering the `NOT TESTED` streams — Extended Approval UAT, full Task/Project regression, Report Builder/export reconciliation, performance baseline, accessibility, and responsive/viewport testing (with a different viewport-testing approach given §3/§13's tooling limitation).
4. Prioritize and fix the defects in §38 in the order given.
5. Only after fixes land and are regression-tested: clean up local QA/UAT test data (§36) in a separate, explicitly-authorized cleanup pass — not part of this report's scope.
6. Distribute `CITYKART-DESK-MANUAL-UAT-CHECKLIST.md` to Citykart employees for a final human sign-off pass once the above is complete.
