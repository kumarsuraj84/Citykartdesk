# 19 — Final QA release decision

## Status: **B — LOCAL QA CONDITIONAL**

(A = passed · **B = conditional** · C = failed · D = incomplete)

Meaning in simple words: *the application is in good shape locally and everything that was run now passes, but it should not go to live until the conditions below are met.* Nothing was pushed, merged or deployed; `main` and live were not touched.

## Why not A

* **Next.js 16.3.8 has critical advisories** (report 15, QA-D005). The fix is a small version step (16.4.3) but it was not made without your approval and has not been tested.
* **Migration 185** (managers must not change categories, form templates and technician groups) exists only on the test database. Without it on live, QA-D002 is still open there.
* **Real business acceptance (UAT sign-off) has not happened.** The pack is ready (report 08) but blank.
* **Edge, Firefox, Safari and real phones were not tested**, and some behaviours were not exercised (report 18).

## Why not C or D

* Every executed category ended with **0 failing tests**: 2,431 tests run, 2,413 passed, 0 failed, 18 skipped (WhatsApp, out of scope). All eight journeys were completed.
* **19 defects found, 15 fixed and re-tested** (1 × P1, 8 × P2, 6 × P3), 4 left for your decision, **0 P0**, **0 blocked**, **0 reopened**, **0 regressions** caused by the fixes.
* Isolation was proved before every run; production was never touched.

## Conditions to move to A (in this order)

1. **You approve the Next.js upgrade to 16.4.3** (or tell me to leave it). If approved: upgrade locally → run the full regression again (about 12 minutes) → axe on 3 pages → report.
2. **Apply migration 185** to the development database (to test) and, at release, to live; restart `CkDeskPostgrest` on 10.0.1.98 afterwards (your own deployment note). Rollback file is ready.
3. **Stakeholder UAT sign-off** with the pack in report 08 (about half a day with a store user, technician, vendor, CVM, PO approver and admin).
4. **15-minute real-device check**: one phone (Android), one iPhone, Edge and Firefox on Home, a ticket, the new-request form, the vendor page; one OEM mail and one approval mail from a *test* ticket to a real Gmail and Outlook.
5. **Your decisions** on the open items: grey colour token (D013), duplicate decision rows (D014 — needs a small migration and clean-up of live data), slow queue beyond 100k tickets (D015 — not needed now), and the older open design questions (OEM-number history, vendor work per category, several PMS categories).
6. After the release, check on the server that **no old "CitykartDesk-Cron-Visits" scheduled task** is still running.

## Push decision

You said: *"once all fixes done for bugs then we will decide to push on main."* The fixes are done locally and committed on the local branch only. When you say so, the safe order is: (a) condition 1 (upgrade) and a re-run, (b) squash or split the branch into the release branches as you did before, (c) deploy to 10.0.1.98 with the usual recipe, (d) apply migration 185 *before* the app. I will not push or deploy until you say it.

## Where everything is

Branch `qa/release-candidate-2026-10` (local). Reports `qa-release-candidate-2026-10/00…19`. Evidence `qa-release-candidate-2026-10/evidence/` (test result files, perf runs, journey log, mail sink). New tests: `qa-release-candidate-2026-10/tests/` and `tests/unit/`.
