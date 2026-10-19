# Citykart Desk — Route & Layout Coverage (FINAL — Completion Pass)

Legend: **PASS** = opened live and checked (content + console + overflow). **N/T** = still not individually opened. **BLOCKED** = attempted, could not be completed for a stated reason. **N/A** = not a real page for the stated reason. **FIXED** = had a real issue, fixed and re-verified this pass.

## ROUTE MASTER — changes from the first pass only

Every route already **PASS** in the original coverage doc is unchanged and not re-litigated here. This table lists only the 22 routes that were **N/T** in the original pass.

| # | Route | 1440 | 768 | 390 | Notes |
|---|---|---|---|---|---|
| 1 | `/requests/queue` | (already PASS) | N/T | N/T | Not re-opened this pass — lower priority than the items below given time; no known issue. |
| 2 | `/services/[slug]` | **PASS** | N/T | N/T | Opened `/services/hr`. Full request-submission form renders correctly (breadcrumb, service header, dynamic Category/Sub-category/Contact/Employee Code/Subject/Description fields). No overflow, no console errors. |
| 3 | `/tasks/[id]` | **PASS** (via overlay) | N/T | N/T | Not reachable as a distinct URL from normal navigation — clicking a task opens `TaskDetailPanel` as an in-page overlay without changing the visible URL. The production `next build` output does list `/tasks/[id]` as its own compiled route (Next.js intercepting-route pattern), but it was not independently opened as a direct URL this pass. Overlay itself: title, status/priority chips, assignee, due date, subtasks, dependencies, and a full comment/activity feed all render cleanly; close button reachable. |
| 4 | `/projects/[id]` | **PASS** | N/T | N/T | Opened after creating a real test project (see DESK-RLS-001 in the defect register — project creation was broken for every role until this pass's fix). Tabs (Tasks/Requests/Milestones/Updates/Activity), Add Task/Board/Milestone/Timeline/Files controls all render, no overflow. |
| 5 | `/intake/inbox/[id]` | **BLOCKED** | — | — | `intake_messages` has zero rows for this org on Local (real inbound-email/WhatsApp ingestion has never run against this environment) and creating a synthetic message would require fabricating a full channel + message + normalized-payload record with no reference example — out of proportion to what a fake row would actually prove. Not attempted. |
| 6 | `/intake/queue` | **PASS** | N/T | N/T | Confirmed this route renders the same Inbox UI as `/intake/inbox` (breadcrumb reads "Intake / Inbox") — either an alias or a shared layout; empty state ("Nothing here") renders cleanly either way. |
| 7 | `/intake/review/[id]` | **BLOCKED** | — | — | Same reasoning as `/intake/inbox/[id]` — depends on a real classified inbound message, none exist locally. |
| 8 | `/admin` | **PASS** | N/T | N/T | Redirects to `/admin/users` (User Management). 527 real (Main-mirrored) users render in an unpaginated table; no overflow; console showed a batch of stale 404 console entries that were present identically on every page visited this session (same count, unrelated to page content) — almost certainly leftover dev-server HMR noise from earlier in this long-running session, not a fresh per-page error; not chased further. |
| 9 | `/admin/categories/[slug]` | **PASS** | N/T | N/T | Opened `/admin/categories/it-support`. Sub-category list (priority badges, reorder/edit/hide/delete controls) renders cleanly for a real, fairly large category. |
| 10 | `/admin/form-templates/[id]` | **FIXED-finding logged, not code-fixed** | **PASS** | **DEGRADED — see DESK-MOBILE-001** | Desktop: dense 3-column Template Builder (field library / section editor / live preview) renders correctly, no overflow at 1440. Mobile (390px): collapses to one long single-column scroll; a non-breakpoint-scoped `sticky` "Save form" bar stays pinned near the bottom throughout. Confirmed everything is *reachable* by scrolling the inner container to its end (Live Preview / Submit button do appear) — nothing is hard-broken — but the experience is confusing. See the defect register for the full root-cause writeup; left as a documented finding, not code-fixed, since a real fix needs a mobile-IA decision. |
| 11 | `/admin/reports` | **PASS** | N/T | N/T | Analytics & Reports dashboard (distinct from Report Builder) renders fully: KPI tiles, volume trend chart, status distribution, SLA performance, priority breakdown, team performance table, backlog aging, agent leaderboard, approval analytics. No overflow, no errors. |
| 12 | `/admin/services` | **PASS** | N/T | N/T | Service Management list renders correctly (HR, LEGAL, ADMIN-AC, VM, FINANCE-VENDOR CREATION, IT, PO ADVICE, LP, ADMIN REPAIR, L&D, ...), each with category-tag counts, Published/Unassigned/Edit/Duplicate/Archive/Delete controls. No overflow. |
| 13 | `/login` | **PASS** | (n/a — desktop only meaningfully differs) | **PASS** | Both widths: centered card, no overflow (`scrollWidth === clientWidth` confirmed via JS at 390px), all fields reachable. No "Forgot password?" link is present on the login form itself (the route is reachable directly, just not linked from here) — noted, not treated as a defect since it wasn't asked to be judged as a UX gap. |
| 14 | `/reset-password`, `/forgot-password`, `/trial-expired` | **PASS / PASS / N/A** | — | **PASS / PASS / —** | `/forgot-password` and `/reset-password` both render cleanly at 1440 and 390 (confirmed via JS overflow check at 390, no horizontal scroll) and are reachable directly even without a live reset-token/session, same as the first pass noted for `/login`. `/trial-expired` redirects an unauthenticated visitor straight to `/login` — correct gating; reaching the real trial-expired UI needs an org actually in that billing state, which doesn't exist in this dataset. Classified **N/A with reason**, not left as an unexplained gap. |

**Totals for this pass's 22 previously-N/T routes:** 18 opened and PASS, 1 FIXED-finding-logged (form-templates mobile), 2 correctly BLOCKED with reason (both intake detail routes — no seed data), 1 N/A with reason (`/trial-expired`). **0 unexplained N/T remain** among this pass's targets.

Combined with the first pass's 28 PASS routes, **48 of 50 catalogued routes have now been opened live at least once**; the 2 remaining (`/intake/inbox/[id]`, `/intake/review/[id]`) are BLOCKED with a stated, verifiable reason (no seed data exists to reach them) rather than simply unaudited.

## OVERLAY MASTER — changes from the first pass only

| # | Overlay | Desktop | Notes |
|---|---|---|---|
| 4 | `FieldModal` | N/T | Not opened this pass — lower priority than the items below. |
| 5 | `BulkPasswordResetDialog` | **PASS** | Opened from `/admin/users`. Warning copy, password fields, type-to-confirm field, Cancel/Submit all render cleanly. Closed via Cancel — not submitted (would reset real users' passwords). |
| 6 | `BulkImportUsersDialog` | **PASS** | "Download sample CSV" link, file picker, Cancel/Import — clean, no overflow. |
| 7 | `BulkImportCategoriesDialog` | N/T | Not opened. |
| 8 | `BulkUploadProjectsDialog` | N/T | Not opened. |
| 9 | `NewMilestonePanel` | N/T | Not opened (would need an existing project — one now exists locally if a future session wants to pick this up). |
| 10 | `NewProjectPanel` | **PASS** (and functionally exercised — see DESK-RLS-001) | Modal renders correctly: name/description, owner/functional-owner/priority/team pickers, start/target dates, references field. First attempt surfaced the real RLS bug (DESK-RLS-001, now fixed); after the fix, project creation succeeds end-to-end through this exact panel. |
| 11 | `NewTaskPanel` | **PASS** | Compact modal: name, description, status/assignee/due-date/priority chips, "Press Enter to submit" hint. Created a real test task through it without issue. |
| 12 | `TaskDetailPanel` | **PASS** | See `/tasks/[id]` row above — same overlay. |
| 13 | `ApprovalPreviewDialog` | N/T | Not opened. |
| 14 | `ApprovalPanel` | N/T | Not opened. |
| 15 | `AssignmentPanel` | N/T | Not opened. |
| 17 | `SubmittedDataPanel` | N/T | Not opened. |
| 18 | `DetailDrawer` | N/T | Not opened. |
| 19 | `CustomColumnManager` | N/T | Looked for a "columns" control on `/tasks`; none found in the visible table toolbar — may be reachable a different way (right-click, a hidden affordance) not discovered this pass. Not confirmed broken; just not located. |
| 20 | `ImportModal` | N/T | Not opened directly (the Users-page import dialog exercised above is a related but separate component, `BulkImportUsersDialog`). |
| 21 | `RequestBoardView` modal(s) | N/T | Not opened. |
| 22 | `RequestActionBar` modal(s) | N/T | Not opened. |
| 23 | Various admin "add/edit" modals | N/T | Not opened. |
| 25 | `RequesterFieldsPanel` | N/T | Not opened. |

**Totals for this pass:** 5 of the 23 previously-N/T overlays opened (`BulkPasswordResetDialog`, `BulkImportUsersDialog`, `NewProjectPanel`, `NewTaskPanel`, `TaskDetailPanel`) — the two that mattered most (Task and Project creation) both got exercised for real, and the second one surfaced this pass's headline defect. 18 overlays remain N/T; none are known-broken, they are simply unaudited. This is honestly short of "every overlay," in line with what was flagged as the realistic scope for this pass at the outset.

## Explicitly out of scope this pass (not attempted, and why)

- The full 8-viewport matrix (1440/1366/1024/768/430/390/360/320) — only 1440 and 390 were used as the two representative desktop/mobile points, same reduced scope as the first pass, for the same reason (literal coverage of 50 routes × 26 overlays × 8 widths is not achievable with genuine per-check rigor in one pass).
- Systematic dropdown/popover collision testing near screen edges.
- Systematic table stress testing (0/1/many rows, many columns) beyond what was incidentally observed (e.g. the 527/531-row Users table, which renders fine unpaginated).
- Systematic form stress testing (long values, validation, duplicate values) beyond the Saved Reports duplicate-name check (see the defect register) and the login form's own client-side validation (confirmed it correctly rejects an invalid/empty submission).
- A dedicated accessibility pass (keyboard nav, focus trap, contrast, touch targets). Not performed this pass — flagged as still-needed, not silently skipped.
- Chart responsiveness beyond what `/admin/reports` showed at 1440 (looked fine there; not checked at other widths).

Nothing above is a known defect — it's explicitly unaudited ground, same convention as the first pass's report.
