# 15 — Master defect register

Severity: **P0** stops release / data loss / security breach · **P1** serious, wrong results or privilege problem · **P2** real defect with a workaround · **P3** small / cosmetic / accessibility · **P4** observation.
"Fixed" means: failing test (or live proof) first → code fix → test passes → full regression run. Fixes are in the local working tree of branch `qa/release-candidate-2026-10`; **nothing is on `main` or live**.

## Summary

| | P0 | P1 | P2 | P3 | P4 | Total |
|---|---|---|---|---|---|---|
| Found | 0 | 1 | 9 | 9 | 0 | 19 |
| Fixed and retested | 0 | 1 | 8 | 6 | 0 | 15 |
| Open — needs a decision | 0 | 0 | 1 | 3 | 0 | 4 (D005, D013, D014, D015) |
| Blocked | 0 | 0 | 0 | 0 | 0 | 0 |
| Reopened (an earlier fix failed again) | 0 | 0 | 0 | 0 | 0 | 0 |
| Regressions caused by the fixes | 0 | 0 | 0 | 0 | 0 | 0 (see report 07) |

## The list

| ID | Sev | Area | What was wrong (simple words) | Found by | Status | Fix and proof |
|---|---|---|---|---|---|---|
| QA-D001 | P2 | Sheet Masters | Two "update from sheets" runs at the same moment (the 11:00 job and an admin pressing *Update now*) could both write the same sheet copy. | new concurrency test (qa-jobs-automation) | **FIXED** | `lib/masters/sync.ts`: a short-lived claim per sheet; the second run is skipped with a clear message. Test: "two overlapping copies never duplicate units, CVMs or PMS dates". |
| QA-D002 | P1 | Security / admin | A **manager** could change categories (the switches *AC PMS*, *auto CVM approval*, *approval history*), form templates and technician groups straight through the data API; only admin/owner should. | new security test (qa-security-new-features) | **FIXED locally — migration 185 must be applied to dev and live at release** | `supabase/migrations/20240101000185_config_tables_admin_only.sql` (+ rollback `supabase/rollback/185_…`). Applied to the audit DB only. Tests: category switches and templates/groups cannot be changed by manager, requester, technician or vendor. |
| QA-D003 | P2 | Security | Sign-in, forgot-password and reset-password forms had no `method="post"`: if sent before the page finished loading, the e-mail and **password went into the web address** (history, logs, Referer). | browser test on the QA app | **FIXED** | `app/(auth)/login|forgot-password|reset-password/page.tsx` now `method="post"`. Test `tests/unit/auth-forms-post.test.ts` (4). |
| QA-D004 | P2 | AC PMS | A scheduled AC PMS ticket was created before its AC facts were saved, so the Business Rule that sends AC tickets to the vendor technician could not match; and a store with no active AC in the sheet got no hint. | new PMS routing test | **FIXED** | `lib/requests/create-request-core.ts` saves the AC snapshot before rules run; `lib/pms/tickets.ts` adds an internal note when the sheet lists no active AC. Tests in `tests/vapt/40-ac-pms.test.ts`; verified in the app (PMS ticket reached the Voltas technician). |
| QA-D005 | P2 | Dependencies | `npm audit`: 14 findings (3 critical, 6 high). **Next.js 16.3.8** is in the vulnerable range (unauthenticated RCE via the image optimiser with SVG; DoS through Server Actions) — fixed in **16.4.3 (not a major change)**. vitest/tinypool (critical) is test-only. | npm audit | **OPEN — needs your approval** | Not changed (changes `package-lock`, needs a rebuild and a re-test of the whole app). Recommendation: upgrade Next to 16.4.3 before any release, then re-run this regression. The image optimiser is reachable without sign-in (`/_next/image` answers 400 to a bad request). |
| QA-D006 | P3 | Operations | The Windows install script still created the scheduled task *CitykartDesk-Cron-Visits* for the engineer-visit module that was dropped. | code reading | **FIXED** | `scripts/windows/install-cron-tasks.ps1`: task no longer installed; comment tells how to remove an old one. |
| QA-D007 | P3 | Approval history | "Last 12 months" was really 12 × 31 = 372 days, and the query had no row limit. | new test | **FIXED** | `lib/approvals/history.ts`: exact 12 calendar months, limit 1000. Test: 11-month-old shown, 13-month-old not (`tests/vapt/39`). |
| QA-D008 | P3 | Vendor screen | The PMS report picker showed two red stars ("PMS report \* \*"). | browser | **FIXED** | `components/vendor/VendorTicketActions.tsx`; test `tests/unit/vendor-filepick-label.test.ts`. |
| QA-D009 | P3 | Vendor on phone | On a phone the bottom bar of a vendor login offered Home / New Request / Requests / Approvals; each bounced back to /vendor, and *My tickets* was hidden in "More". | browser at 375 px | **FIXED** | `components/layout/MobileNav.tsx` shows My tickets / My POs / Notifications for vendors. Test `tests/unit/mobile-nav-vendor.test.tsx` (failed before, passes now). |
| QA-D010 | P2 | Accessibility | Controls with no name a screen reader can speak: 22 rule switches (Business Rules), 10 selects (Vendors), the add-collaborator button on a ticket. | axe-core on 17 pages | **FIXED** | `aria-label`s added; axe re-run on the live pages = 0 violations for these. Test `tests/unit/accessibility-names.test.ts`. |
| QA-D011 | P3 | Accessibility | Sideways-scrolling tables (vendor list, PO register, report tables, drill-down list) could not be scrolled with the keyboard; small hint text on vendor tiles and the time of a ticket message were too pale (2.8–4.3 : 1). | axe-core | **FIXED** | focusable `role="region"` wrappers; text no longer faded. Same test file. |
| QA-D012 | P2 | Accessibility | Report Builder: 80+ unnamed menu buttons, unlabeled date boxes and selects; ticket calendar marked as a grid without rows; the mail template editor and the group expander had no name. | axe-core | **FIXED** | `components/reports/PivotBuilder.tsx`, `TicketCalendarSection.tsx`, `RichEmailEditor.tsx`, `TeamManagementClient.tsx`. Axe: 0 violations on /reports/pivot, /dashboards/executive, /admin/masters. |
| QA-D013 | P3 | Accessibility | Colour token `--muted-foreground` (#637080) on `--muted` (#eef1f5) is 4.45 : 1 — just under the 4.5 : 1 rule. Shows on small grey pills (Public badge, "N members", service chips, 60d/90d tabs, category cards). | axe-core | **OPEN — design owner** | One-line token change would fix every place; not made because it changes the look of the whole app. Remaining axe findings after all fixes are only this one. |
| QA-D014 | P3 | Approvals | The same approval decided twice at the same moment is accepted twice and stores **two decision rows** (the result is applied once; the status change is guarded). Audit trail shows two decisions by one person. | performance/concurrency test | **OPEN — needs a migration (unique rule + clean-up of live data)** | Recommendation: unique index on (approval, step, decider) after removing duplicates; treat a clash as "already decided". |
| QA-D015 | P3 | Performance | Manager queue first page: 40 ms (3k tickets) → 540 ms (100k) → 2.5 s (500k); executive dashboard load ≈ 4.1 s from 100k tickets. Fine for today's size, slow beyond ~100k tickets. | scale test | **OPEN — tuning needs your approval** | Needs an index / server-side paging review. |
| QA-D016 | P2 | Sign-in | When the sign-in service was down the person waited ≈30 s and was told "Invalid login credentials" (and each try counted toward the 10-wrong-tries limit). | fault injection (Auth stopped) | **FIXED** | `lib/actions/auth.ts`: "Sign-in is temporarily unavailable. Please try again in a few minutes.", audit event, not counted. Test `tests/unit/auth-outage.test.ts` (failed 3/4 before). Live: message after 6 s. |
| QA-D017 | P3 | Files | When file storage was down an attachment answered **404 "not found"** after 20 s (the file is not missing). | fault injection (Storage stopped) | **FIXED** | `app/api/storage/attachment/request/[id]/route.ts`: 503 + Retry-After; real missing file stays 404. Test `tests/unit/attachment-storage-outage.test.ts` (failed 2/4 before). |
| QA-D018 | P2 | Assignment | **Round robin gave a burst of tickets to one technician.** Eight tickets created at the same moment all went to the same person (8 : 0) because each read the "last used" position before the other wrote it. Matters for bursts (the 09:00 AC PMS run, bulk loads). | new test (reproduced 8 : 0) | **FIXED** | `lib/rules/actions.ts`: the position is taken with a compare-and-set and retried. Test `qa-gap-coverage` "eight tickets created at the very same moment are spread" now passes; assign / rules tests (26) pass. |
| QA-D019 | P2 | System Log | **The integrity check stopped at 500,000 rows but reported every row as checked.** After a big scale test the log held 568,670 chained rows; a changed record among the newest 68,000 was reported as "intact". An audit trail check that cannot see new tampering is worse than none. | final regression (test 105 "finds a record changed behind the back") | **FIXED** | `lib/actions/admin/system-log.ts`: the whole chain is walked in pieces of 250,000 rows, each starting on the last row of the one before. Test `tests/unit/system-log-integrity-chunks.test.ts` (failed 2 of 3 before). |

## Items that are decisions, not defects (kept visible)

* Migration 185 must also be applied to the developer database and to live (with `CkDeskPostgrest` restarted afterwards) — it is not applied there.
* Content-Security-Policy is still *report-only* (known from the earlier security assessment).
* Supabase ports are bound to all network cards on this PC (0.0.0.0) — a developer-machine matter, not an app defect.
* The default PO approver is a configured value; check it is set before release (the vendor PO flow needs one).
* OEM-number history and "vendor work per category" designs are still waiting for your earlier answers.

## How the counts were made

P1: D002. P2: D001, D003, D004, D005, D010, D012, D016, D018, D019 (9). P3: D006, D007, D008, D009, D011, D013, D014, D015, D017 (9). Total 19. Fixed: D001–D004, D006–D012, D016–D019 (15). Open: D005, D013, D014, D015 (4).
