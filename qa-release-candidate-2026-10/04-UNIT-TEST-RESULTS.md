# 04 — Unit tests and static checks

Run through the isolation gate with the QA vitest configuration (`tooling/vitest.qa.config.ts`); each file first passes the audit-only guard. Files: `evidence/04-unit-results.json` (first run, before fixes), `evidence/11-final-regression-results.json` (final run, after every fix).

| Run | Files | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| First run (before any QA fix) | 172 | 1,563 | 1,563 | 0 | 0 |
| **Final run (after all fixes)** | **179** | **1,593** | **1,593** | **0** | **0** |

The 30 extra tests are the new guards written during this QA: sign-in forms use POST (4), vendor file-picker label (2), vendor phone menu (2), accessibility names (11), sign-in service outage (4), attachment storage outage (4), System Log integrity in pieces (3) — see report 16.

Static checks: `tsc --noEmit` **0 errors**; eslint **0 errors**, 5 old warnings (unused variable, hook dependency lists) left alone.

Not measured: **code coverage percentage.** The project has no coverage tool installed; installing one would change `node_modules`, which this QA did not do. Coverage was therefore judged by a *feature trace* instead (report 02: 155 features traced to code and to test names).

Skipped tests: none in the unit group. Verdict: **PASS — 1,593 of 1,593.**
