# 07 — Regression

Question: after all the fixes, does everything that worked before still work?

## Final regression (the one that counts)

One run of **every** test in the project plus the new QA tests, through the isolation gate (21/21 passed), configuration `tooling/vitest.qa.config.ts`, started after the last code change (QA-D019). Result file: `evidence/11-final-regression-results.json`, log `evidence/11-final-regression.log`.

| Group | Files | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Unit | 179 | 1,593 | 1,593 | 0 | 0 |
| Integration | 81 | 411 | 393 | 0 | 18 |
| Security (VAPT) `tests/vapt` | 23 | 205 | 205 | 0 | 0 |
| Remediation `tests/remediation` | 32 | 181 | 181 | 0 | 0 |
| New QA tests | 5 | 41 | 41 | 0 | 0 |
| **Total** | **320** | **2,431** | **2,413** | **0** | **18** |

Skipped: the 18 WhatsApp production-catalog tests (out of scope, not counted as passed). Run time about 12 minutes.

## History of the regression runs (nothing hidden)

| Run | What happened |
|---|---|
| 1 — before QA fixes | unit 1,563/1,563; integration 393 passed + 18 skipped; security + remediation 382/383 (one timing-dependent approval-history mail assertion, a test problem, corrected without weakening it) |
| 2 — after the first fixes | new QA tests: 33/35 → defects D001, D002, D004 found and fixed → all pass |
| 3 — "final" attempt (16:33) | I **stopped it myself** when a later fix (QA-D019) made it out of date; the stopped run left a test-database record and some synthetic users behind |
| 4 — after QA-D019 | 2 failures: test 105 (a log record left changed by the stopped run → the *fixed* integrity check correctly reported the broken chain) and test 119 (leftover synthetic technician with the same name counted twice). Both were pollution from run 3, not product failures. The record was restored (chain verified intact), leftovers removed, the test given a `finally` restore. |
| 5 — clean final run | **0 failed** (table above) |

Regressions caused by the fixes: **none found** (run 5 passes every earlier test; performance numbers equal the security team's earlier ones, report 09; axe clean on the changed pages, report 12).

## Targeted regressions after specific fixes

* Round robin (QA-D018): assignment, rules and permission tests (26) pass, including "Start Working does not mail the requester a second 'assigned' message".
* Sign-in change (QA-D016): throttling tests (VAPT-032 / 041) still pass — a wrong password still counts, an outage does not.
* Attachment route (QA-D017): attachment-serving tests still pass (type table, path check).
* Mobile menu (QA-D009): the older overflow tests (cap of 4 primary items) still pass.
* Migration 185: security tests on categories / templates / groups pass with 185 applied; **not applied** anywhere else.

Verdict: **PASS.**
