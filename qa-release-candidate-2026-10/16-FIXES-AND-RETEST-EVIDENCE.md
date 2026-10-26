# 16 — Fixes and retest evidence

Rule followed: a failing test (or a live reproduction) first, then the fix, then the test passes, then the whole regression runs again (report 07). All changes are in the local working tree of `qa/release-candidate-2026-10`; **nothing is pushed, merged or deployed**. No business rule was changed and no security control was weakened to make a test pass.

| Defect | Files changed | Failing-first proof | Test that now guards it | Retest result |
|---|---|---|---|---|
| QA-D001 two sheet updates at once | `lib/masters/sync.ts` (claim per sheet) | overlap test produced duplicates / second run not refused | `qa-release-candidate-2026-10/tests/qa-jobs-automation.test.ts` "two overlapping copies of the same sheet never duplicate…" | PASS |
| QA-D002 manager could change category switches, form templates, technician groups | `supabase/migrations/20240101000185_config_tables_admin_only.sql`, `supabase/rollback/185_…sql` | `qa-security-new-features` failed: "admin changed the fixtures category" (manager) | same file, 14 tests | PASS on the audit DB with 185 applied. **Must be applied to dev and live.** |
| QA-D003 password in the web address | `app/(auth)/login/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx` | seen live: submit before the page loaded put e-mail and password in the URL | `tests/unit/auth-forms-post.test.ts` (4) | PASS; verified in the browser |
| QA-D004 PMS ticket not routed to the vendor | `lib/requests/create-request-core.ts`, `lib/pms/tickets.ts`, `app/(app)/vendor/tickets/[id]/page.tsx` | routing test failed (no vendor assignee) | `tests/vapt/40-ac-pms.test.ts` | PASS; verified in the app |
| QA-D006 obsolete scheduled task | `scripts/windows/install-cron-tasks.ps1` | code reading | (script; no unit test) | n/a — check on the server that no old "Visits" task remains |
| QA-D007 history window | `lib/approvals/history.ts` | 11-month vs 13-month test | `tests/vapt/39-approval-history.test.ts` | PASS |
| QA-D008 double star | `components/vendor/VendorTicketActions.tsx` | seen in the browser | `tests/unit/vendor-filepick-label.test.ts` | PASS |
| QA-D009 vendor phone menu | `components/layout/MobileNav.tsx` | `mobile-nav-vendor.test.tsx` failed (staff labels) | `tests/unit/mobile-nav-vendor.test.tsx` (+ old `mobile-nav-overflow` still passes) | PASS |
| QA-D010–D012 accessibility | `BusinessRulesClient.tsx`, `VendorsClient.tsx`, `RequestSidebarPanel.tsx`, `PivotBuilder.tsx`, `FlatTableView.tsx`, `PivotTableView.tsx`, `ExplorerSection.tsx`, `TicketCalendarSection.tsx`, `RichEmailEditor.tsx`, `TeamManagementClient.tsx`, `vendor/page.tsx`, `PoRegisterView.tsx`, `requests/[id]/page.tsx` | axe-core on the running pages (critical/serious findings) | `tests/unit/accessibility-names.test.ts` (11) | axe re-run on the pages: 0 violations except the grey token (D013, open) |
| QA-D016 sign-in outage message | `lib/actions/auth.ts` | `auth-outage.test.ts` 3 of 4 failed; live: 30 s then wrong message | `tests/unit/auth-outage.test.ts` (4) | PASS; live: message after 6 s, recovered after restart |
| QA-D017 storage outage → 404 | `app/api/storage/attachment/request/[id]/route.ts` | `attachment-storage-outage.test.ts` 2 of 4 failed; live 404 after 20 s | `tests/unit/attachment-storage-outage.test.ts` (4) | PASS |
| QA-D018 round robin burst | `lib/rules/actions.ts` | `qa-gap-coverage` "eight tickets at the same moment": all 8 to one person | `qa-release-candidate-2026-10/tests/qa-gap-coverage.test.ts` | PASS (spread); assignment tests 26 pass |
| QA-D019 integrity check stops at 500,000 rows | `lib/actions/admin/system-log.ts` | `system-log-integrity-chunks.test.ts` 2 of 3 failed; the regression test 105 failed on a 568,670-row log | `tests/unit/system-log-integrity-chunks.test.ts` (3) + `tests/remediation/105-system-log-screen.test.ts` | PASS |

Open items (no code change made, by design): D005 dependencies, D013 grey token, D014 duplicate decision rows, D015 scale tuning — see report 15.

## What a fix may have broken — how that was checked

After the last fix the **complete** suite was run again from the start (unit, integration, vapt, remediation and the new QA tests in one run, with the isolation gate): see report 07. The type check (`tsc --noEmit`) had 0 errors and eslint 0 errors before that run.

## Files added or changed by this QA (for the commit)

New: `qa-release-candidate-2026-10/` (reports, tooling, tests, evidence), `tests/unit/{auth-forms-post,vendor-filepick-label,mobile-nav-vendor,accessibility-names,auth-outage,attachment-storage-outage,system-log-integrity-chunks}.test.ts`, migration 185 + rollback.
Changed: the source files in the table above, `tests/vapt/39-approval-history.test.ts`, `tests/vapt/40-ac-pms.test.ts`, `.claude/launch.json` (QA app entry).
