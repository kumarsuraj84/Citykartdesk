# 04 — Test Strategy and Coverage Matrix

## Plain summary
About **4,400 checks were planned and 4,379 were run**. **4,370 passed, 9 failed, 19 were blocked and 22 were not run** (each reason is given below). Nothing marked NOT RUN or BLOCKED has been counted as a pass. The 9 failures are real findings (5 slow load runs at 30 to 150 times today's ticket count, 1 library-advisory check, 3 security-log gaps); none is a P0.

Status words used everywhere: **PASS, FAIL, BLOCKED** (could not run because something outside the audit was needed), **NOT RUN** (planned, not executed — reason given), **NOT APPLICABLE**.

## Strategy in one page
| Principle | How it was applied |
|---|---|
| Local only | Isolated Docker stack on this PC, disposable database, a gate of 21 checks before every run, outbound network blocked and logged (31 refused attempts recorded). No live system, live mail or WhatsApp was touched. |
| Layered | static checks → unit → integration (real local database) → system/smoke → regression → business UAT → UI/UX/accessibility → security → performance → workflow engine → failure recovery → SOC readiness → compatibility |
| Fail-first for fixes | Where a product fix was made, a regression test was written first and shown to fail on the old code (UI-006, UI-009, UI-010, UX-001, UX-002). |
| Honest status | Anything that needs the outside world (real mail, WhatsApp, Google/Microsoft mailboxes, DeskTime, Google Sheet API, Web Push, the real CKOneAI machine, live hardware, other browsers, real phones) is shown as BLOCKED or NOT RUN. |
| Business acceptance | **Pending owner/business sign-off** for every business scenario. The audit proves the software does what the rules say; it cannot decide that the rules are right. |

## Coverage by category
| # | Category | Planned | Run | PASS | FAIL | BLOCKED | NOT RUN | N/A | Skipped/blocked/not-run reason | Defects found (open after fixes) | Fixed locally | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Design / UX / accessibility | 810 | 804 | 804 | 0 | 0 | 6 | 0 | 6 keyboard-pack cases (K06/K07 and related) could not run because no pop-up opener was found on the audited pages (see report 05) | 16 (5 open, P3/P4) | 11 | `evidence/ui/` |
| 2 | Unit | 2,426 | 2,424 | 2,424 | 0 | 0 | 2 | 0 | 2 opt-in CKOneAI speed tests | — | 26 new tests added | `evidence/final/main.json` |
| 3 | Integration (real local DB) | 420 | 402 | 402 | 0 | 18 | 0 | 0 | 18 WhatsApp "production catalogue" tests need the real catalogue | — | — | `evidence/final/main.json` |
| 4 | System / smoke | 15 | 15 | 15 | 0 | 0 | 0 | 0 | 13 smoke journeys + production build starts + health/version routes | 0 | — | `evidence/smoke/` |
| 5 | Regression | 181 | 181 | 181 | 0 | 0 | 0 | 0 | existing remediation suite, re-run after the last code change | 0 | — | `evidence/final/remediation2.json` |
| 6 | Business UAT (personas) | 77 | 74 | 74 | 0 | 1 | 2 | 0 | G full WhatsApp conversation BLOCKED; real CKOneAI machine and real sheet sync NOT RUN | 0 | — | `evidence/uat/` |
| 7 | Performance / load / stress / soak | 23 | 18 | 13 | 5 | 0 | 5 | 0 | live hardware, slow-PC rendering, soak over an hour, NAS throughput, real integrations under load | 5 (all open, P2/P3) | — | `evidence/perf/` |
| 8 | Security / VAPT | 435 | 433 | 432 | 1 | 0 | 2 | 0 | commercial authenticated scanner (none available), live TLS/proxy/NAS permissions | 12 (all open; 1 P1) | 0 product | `evidence/security/`, `evidence/final/vapt.json` |
| 9 | Compatibility | 8 | 4 | 4 | 0 | 0 | 4 | 0 | Firefox, Safari/iOS, real Android: not available; production-mode console check only partly done | — | — | report 13 |
| 10 | Workflow engine | 5 | 5 | 5 | 0 | 0 | 0 | 0 | | 3 (open P2/P3) | — | `evidence/wf/` |
| 11 | Failure recovery | 7 | 7 | 7 | 0 | 0 | 0 | 0 | FR05 passes as designed (a hang is waited out) | 3 (open P3/P4) | — | `evidence/recovery/` |
| 12 | SOC readiness | 13 | 12 | 9 | 3 | 0 | 1 | 0 | SOC13 alert delivery: nothing may leave this PC | 7 (open) | — | `evidence/soc/` |
| | **TOTAL** | **4,420** | **4,379** | **4,370** | **9** | **19** | **22** | **0** | | **0 P0, 1 P1, 10 P2, ~21 P3/P4 open** | **17 items** | |

Check of the arithmetic: 4,370 + 9 + 19 + 22 = 4,420 planned; 4,370 + 9 = 4,379 run.

How the rows were counted
- **Row 8:** 410 repository security tests (all pass), 21 black-box probes (18 PASS and 3 NOTE counted as pass), 1 source/data-boundary review pack (pass); the only FAIL is the dependency-advisory check (26 advisories, 3 critical). The five stale security tests found at the start were corrected and re-run: 410 of 410 now pass.
- **Row 7:** 15 load runs (3 data sizes x 5 user counts: 10 PASS, 5 FAIL by my proposed rule "0 errors and P95 ≤ 3 s"), 1 soak and 2 stress runs (counted PASS because they had 0 errors and no crash; the soak P95 of 3.3 s is slightly over the rule, see report 09).
- **Row 12:** the SOC report (14) calls the three gaps "NOTE"; they are counted here as FAIL so that the readiness count is not flattering.
- **Row 9:** one "partial" (production-mode browser console) is counted as NOT RUN.
- **Rows 2 and 3 (the final run):** 2,846 tests in the combined unit + integration run: 2,824 passed first time, 20 skipped as above, and 2 dashboard-figure tests failed because **my 100,000 synthetic load-test tickets were still in the audit database** (more than the dashboard's 30,000-ticket cap). After removing them the 2 tests (and the 4 remediation tests with the same cause) passed. See 17.

## Defects by area (details in 15)
| Area | P0 | P1 | P2 | P3/P4 | Fixed locally |
|---|---|---|---|---|---|
| Design / UX / accessibility | 0 | 0 | 3 (all fixed) | 13 (8 fixed, 5 open) | 11 |
| Security / dependencies | 0 | 1 (V-001) | V-002, V-003, V-006, V-008, V-010 | V-004, V-005, V-007, V-009, V-011, V-012 | test/data items F-001…F-006 |
| Performance / scale | 0 | 0 | PERF-001, PERF-002, PERF-004 | PERF-003, PERF-005 | 0 |
| Security log (SOC) | 0 | 0 | SOC-G1, SOC-G2 (SOC-G3 = V-010) | SOC-G4…G7 | 0 |
| Failure recovery / engine | 0 | 0 | 0 | REL-001, REL-002, REL-003, D-02 | 0 |

## Coverage of the 30 feature areas
Every module in the inventory (report 03) has at least one executed check; the weakest coverage ("LOW": under 30 existing automated tests) is Requester Home, Knowledge Base, CSAT, Field Service Reports, PMS and Zoho (Zoho got 10 black-box UAT checks but no new unit tests). Modules that depend on the outside world (mail, WhatsApp, mailbox sync, DeskTime, Google Sheet API, Web Push, CKOneAI machine) were tested up to the boundary with a stand-in and are marked accordingly.

## What this audit did not cover
Real-world mail/WhatsApp/mailbox behaviour; the live servers (no production access, by instruction); other browsers and real phones; backup restore drill; accessibility with a real screen reader (automated rules and keyboard checks only); load on live hardware; business correctness of the rules themselves.
