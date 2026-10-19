# Citykart Desk — Post-Audit Remediation: Executive Summary

*2026-10-13 · branch `remediation/post-audit-2026-10` · all work local · nothing pushed, merged or deployed.*

## In one paragraph

All four Critical findings and 22 of 27 High findings from the audit are fixed and verified on an isolated local copy; the ticket-list performance problem (28 seconds for a manager's list at 500,000 tickets) is now 1.3 milliseconds with the same visibility rules; and the full automated suite is green (1,574 passed, 0 failed, 18 intentionally blocked). Along the way two new defects were found and fixed (ticket numbers repeating after 999,999; attachment delete always failing) and two regressions I introduced were caught and repaired. What is **not** done: three High findings that need your decision or a production change (D-005, D-011, D-018), two dashboard-caching items (D-040, D-041), 20 Medium findings (plus 4 only partly done), and the unified audit-trail / error-capture build. Nothing here is deployed; deployment needs your separate authorization.

## 1. Fixed and remaining

| Severity | Total | Fixed | Fixed (partial) | Remaining |
|---|---|---|---|---|
| **Critical** | 4 | **4** — D-001, D-002, D-003, D-051 | — | **0** |
| **High** | 27 | **22** | — | **5** — D-005, D-011 (need your approval); D-018 (production HTTPS decision); D-040, D-041 (caching design) |
| **Medium** | 38 | **14** | 4 (D-033, D-046, D-061, D-067) | **20** |
| Low / Info | ≈ 45 | not itemized | | not addressed |

Two caveats worth knowing: **D-001** (the forged trusted header) was proven by code review and a proxy-level unit test, **not** by a live attack (the safety classifier stopped a live script), and **D-051** (public file route) was confirmed only at component level (the storage library does not protect the path), so it was fixed defensively and is not labelled "exploited". Details: documents 02, 03 and 10.

## 2. Tests

| Suite | Baseline | Final |
|---|---|---|
| Type check | 0 errors | **0 errors** |
| Lint | 6 problems (all pre-existing) | **6 problems (identical)** |
| Unit | 961 passed · 0 failed | **1,090 passed · 0 failed · 0 skipped** |
| Integration | 389 passed · **6 failed** · 24 skipped | **401 passed · 0 failed · 18 skipped** |
| Remediation (new: security regression, RLS equivalence, cross-tenant, UAT lifecycle, reliability) | — | **83 passed · 0 failed** |
| Production build | — | **succeeds** |
| **Total automated** | | **1,592 tests · 1,574 passed · 0 failed · 18 skipped** |

The 18 skipped tests need the production catalog and are **blocked** by the no-production rule. No test was weakened, deleted or edited to go green (document 05 lists every test-file change and why).

## 3. UAT status

Five roles (requester, technician, manager, administrator, platform owner) exercised: **38 routes × 5 roles → 0 errors**, role redirects correct; sign-in (wrong password refused; deep-link return fixed), forms and validation, ticket creation with hostile text, technician flow, SLA policy created in the admin screen and applied to a new ticket, the whole lifecycle (including the Hold-due-to-Purchase rules) through the real server actions for all five roles, unauthorized and invalid inputs, concurrency. Not clicked in the browser: attaching a file through the file chooser (tool limit; exercised through the action instead), and creating categories / templates through the screens (pages load; behaviour covered by integration tests). Real e-mail, WhatsApp, Gmail/Graph and DeskTime calls cannot be made in isolation. Document 06.

## 4. Database and row-security verification

* Migrations 156, 157, 158 and 159 (all with rollbacks; the rollbacks were executed successfully on the disposable database).
* **Ticket visibility is unchanged** by the performance migration: for nine kinds of user the API result is compared with an independent SQL calculation of the written rules (every ticket id on 3,000 tickets; exact count plus first and last 1,000 on 500,000); the collaborator, approver and reports-to rules are each proven to be exercised.
* **Cross-tenant:** with a real second organization, neither side can see, count, search, change, delete or move the other's tickets (6 tests, at 500,000 tickets).
* Row security was never disabled; every measurement is a real signed-in user.

## 5. Performance (disposable local stack — not a production claim)

| | Before | After |
|---|---|---|
| Manager's latest-25 list, 500,000 tickets | 27,885 ms | **1.3 ms** |
| Manager's exact count, 500,000 | 28,180 ms | **80 ms** |
| Technician's exact count, 500,000 | 4,074 ms | **25 ms** |
| 200 simulated users, 500,000 tickets: error rate / P50 / P95 / P99 | 27 % / 6,496 ms / 12,083 ms / 15,338 ms | **0 % / 5 ms / 145 ms / 173 ms** |
| 200 simulated users, 100,000 tickets: P95 | 5,792 ms | **139 ms** |
| Burst of 200 simultaneous requests, 500,000 tickets | 15,296 ms wall, 4 % errors | **218–362 ms wall, 0 % errors** |

At 500 simulated users about 5 % of requests fail in the local test rig; these are connection errors from its gateway (a limit of the test rig), not database timeouts. Document 04.

## 6. Isolation certification

The 21-check isolation gate ran before every test, load run and app start (21 / 21 every time it was allowed to run; once it **refused** to run (20 / 21) because my own interrupted tests had left four test channels in the audit database, and it was not touched — the leftovers were removed). The built-in browser was used only for `localhost:3310`. Only audit-stack containers were ever stopped (and restarted). The user's own development server (port 3210, development database) was never touched. The seeded bootstrap platform-owner account was not used.

**NO PRODUCTION TICKETS CREATED**
**NO PRODUCTION DATA CREATED, MODIFIED OR DELETED**
**NO PRODUCTION APP SERVER ACCESSED**
**NO PRODUCTION DATABASE ACCESSED**
**NO PRODUCTION NAS ACCESSED**
**NO PRODUCTION NOTIFICATIONS SENT**
**NO GIT PUSH**
**NO MAIN DEPLOYMENT**
**ALL DYNAMIC TESTING PERFORMED ON ISOLATED LOCAL INFRASTRUCTURE**

## 7. Git changes

Branch `remediation/post-audit-2026-10`, 27 commits, 120 files (+3,839 / −225): 75 source files, 37 test files, 8 database files (4 migrations, 4 rollbacks). Not pushed; `main` untouched. Your unrelated uncommitted work was left as it was. Document 11 has the deployment order, configuration notes and rollback.

## 8. Remaining risks and decisions for you

| # | Item | Why it matters |
|---|---|---|
| 1 | **D-005** — no confidential tier for HR/Finance-style teams (any manager+ sees every team's tickets) | Needs a policy decision before it can be built |
| 2 | **D-011** — bulk-import default password `Welcome@123`; forced reset only enforced by the screen | Changes how new users first sign in |
| 3 | **D-018** — the site runs over plain HTTP; cookies are not `Secure` | Needs TLS in front of the app first; also blocks adding HSTS |
| 4 | **REL-1** — with the API layer down a page hangs ~165 s before the error screen | A retry/timeout policy choice (document 08) |
| 5 | 20 Medium findings and ~45 Low/Info items untouched; D-040/D-041 dashboard caching deferred | Listed in document 10 |
| 6 | **Behaviour change:** managers can no longer schedule reports (D-012) | Confirm that is what you want |
| 7 | `TRUSTED_PROXY_HOPS` must be decided for the production network; `OAUTH_STATE_SECRET` / `CRON_SECRET` must be at least 16 characters for the mailbox-connect flow | Deployment configuration |
| 8 | The unified audit-trail and error-capture build you asked for is **not done** | Queued behind this remediation; needs its own design review |
| 9 | Blocked: real WhatsApp / Gmail / SMTP / DeskTime / OEM calls; 18 production-catalog tests; HTTPS | Cannot be proven in isolation |
| 10 | One intermittent WhatsApp audit-logging test failure at baseline was never reproduced | Flakiness risk, not a known defect |

## 9. Recommended next step

Review documents 02, 03, 10 and 11, decide D-005, D-011, the report-scheduling change and `TRUSTED_PROXY_HOPS`, and then — only when you choose — authorize a production release by a separate instruction (the plan in document 11: new build first, then migrations 156–159 run by you on the database server, then restart `CkDeskPostgrest`, then the smoke test). The audit-trail / error-capture build can follow as its own piece of work.

## Deliverables (all in `audit-2026-10/remediation/`)

01-BASELINE-AND-ISOLATION · 02-CRITICAL-SECURITY-FIXES · 03-HIGH-SECURITY-FIXES · 04-DATABASE-RLS-PERFORMANCE · 05-INTEGRATION-TEST-REMEDIATION · 06-FUNCTIONAL-UAT · 07-UI-UX-ACCESSIBILITY · 08-STORAGE-RELIABILITY · 09-REGRESSION-RESULTS · 10-UPDATED-DEFECT-REGISTER · 11-CHANGE-AND-ROLLBACK-PLAN · this summary. Raw evidence: `audit-2026-10/evidence/remediation/`.

---

**LOCAL REMEDIATION VERIFIED WITH CONDITIONS — USER REVIEW REQUIRED**

*Conditions: five High findings and 20 Medium findings are open (three High need your decision or a production change); the audit-trail build is not done; some integrations can only be proven against real providers. Production deployment requires your separate explicit authorization. Stopping here.*
