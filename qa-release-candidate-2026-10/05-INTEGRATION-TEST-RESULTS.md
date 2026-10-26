# 05 — Integration tests

These tests use the **real database, real data API, real authentication and real storage of the isolated audit stack**, as real signed-in users with row security on; only mail sending is replaced by a stand-in.

| Group | Files | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Project integration tests (`tests/integration`) — final run | 81 | 411 | 393 | 0 | **18** |
| Project remediation tests (`tests/remediation`) — final run | 32 | 181 | 181 | 0 | 0 |
| New QA tests (`qa-release-candidate-2026-10/tests`) — final run | 5 | 41 | 41 | 0 | 0 |

The **18 skipped** tests are the "Stage 7 / 7B production catalog UAT" tests of the WhatsApp channel. They skip themselves because the real IT/HR/Finance/Legal services are not configured in the clean test database (and WhatsApp is out of scope). They are **not counted as passed** anywhere in this QA. List: `node tooling/list-skipped.cjs evidence/11-final-regression-results.json`.

## New QA tests and what they cover

| File | Tests | Covers |
|---|---|---|
| `qa-jobs-automation.test.ts` | job routes need the secret; auto-close overlap; daily reminder once; two sheet copies; interrupted AC PMS run | found QA-D001 |
| `qa-security-new-features.test.ts` (14) | nobody signed in can read or write the new tables; category switches, form templates and groups cannot be changed by manager / requester / technician / vendor; another company's vendor sees nothing; approval history never shows another store | found QA-D002 |
| `qa-vendor-concurrency.test.ts` | two PO approvers at once → one decision, one mail, one PO number; approve vs reject at once; two quotes at once; double Start; double reopen | no defect |
| `qa-perf-workflows.test.ts` | whole workflows at 3k / 100k / 500k tickets (report 09) | found QA-D014, QA-D015 |
| `qa-gap-coverage.test.ts` (8) | time tracking; round robin, load balanced, vendor never taken away; home dashboard counts; **burst of tickets** | found QA-D018 |

Also re-run and passing in the final run: the approval-history tests (`tests/vapt/39`, 5) and AC PMS tests (`tests/vapt/40`, 13) which this QA corrected (a timing-dependent mail assertion and order-dependent assertions were made reliable; no assertion was weakened).

Test hygiene notes (found while running, fixed or recorded):
* `tests/remediation/105-system-log-screen.test.ts` did not put a tampered log row back when its own expectation failed; the restore is now in a `finally` block.
* Some project tests leave synthetic users in the audit database; the final clean run was made after removing leftovers of a run that was stopped half-way.

Verdict: **PASS — 393 + 181 + 41 passed, 0 failed, 18 skipped (out of scope).**
