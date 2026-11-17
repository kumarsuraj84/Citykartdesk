# 06 — Unit and Integration Results

## Plain summary
The project already has a large automated test suite. It was run in full on the isolated audit stack. **Everything passed except 5 old VAPT tests that no longer matched deliberate product changes; those were corrected (they were stale tests, not product bugs).** New tests were added for each defect fixed in this audit.

## Existing suite — baseline run (audit mode, before any fix)
| Layer | Files | Tests | Pass | Fail | Skipped | Notes |
|---|---|---|---|---|---|---|
| Static: `tsc --noEmit` | — | — | exit 0 | — | — | 0 errors |
| Static: `eslint` | — | — | exit 0 | — | — | 0 warnings blocking |
| Unit | 830 | 2,400 | 2,398 | 0 | 2 | skipped = opt-in CKOneAI speed tests |
| Integration (real local database) | 187 | 420 | 402 | 0 | 18 | skipped = WhatsApp production-catalogue tests (need the real catalogue; **BLOCKED**, not run) |
| Remediation | 95 | 181 | 181 | 0 | 0 | |
| VAPT | 222 | 410 | 405 | **5** | 0 | see below |
| **Total** | 1,334 | **3,411** | **3,386** | **5** | **20** | |

Evidence: `evidence/baseline-unit.json`, `baseline-integration.json`, `baseline-remediation.json`, `baseline-vapt.json`, `baseline-static.log`.

## The 5 VAPT failures (all stale tests, fixed locally)
| ID | Test file | Why it failed | Fix |
|---|---|---|---|
| F-001 | `tests/vapt/70-data-api-team-steps-manager.test.ts` | counted a fixed number of API entities; the product now has 20 (added `ac_units`) | count `ENTITIES.length`, assert `ac_units` is included |
| F-002 | `tests/vapt/34-sheet-masters.test.ts` | expected an older sheet behaviour | updated to the current rule |
| F-003 / F-004 | `tests/vapt/72-store-details-tab.test.ts` | since commit 8470d3d a store's place is no longer filled from AC rows; the "problem" line now names at most 20 stores | assertions updated to the deliberate behaviour |
| F-005 | `tests/vapt/36-vendor-module.test.ts` | store for requester A needed a region | the test now creates the store with region R1 |
Re-run of the 4 corrected files: 57 tests, 56 pass; the one left failing (a store-details test that looked for a store name that falls past the 20-store limit of the problem line, F-004) was corrected and file 72 re-run alone: 6/6 pass. Evidence: `retest-vapt-4files.json`, `retest-vapt-72.json`.

## New tests added in this audit (all fail-first where it was a product fix)
| File | Tests | Covers | Failed before the fix? |
|---|---|---|---|
| `tests/unit/report-form-field-keys.test.ts` | 4 | UI-006 duplicate report field keys; shared-field naming; library fields stay single | **yes** (2 of 4 failed) |
| `tests/unit/modal-focus-return.test.tsx` | 2 | UI-010 focus returns to the opener when the pop-up's first box has autofocus (Escape and Close) | **yes** (2 of 2 failed) |
| `tests/unit/accessibility-names.test.ts` (+7 tests, 18 total) | 7 | UI-001..005, UI-008, UI-009 names, landmarks, keyboard-reachable tables, `role=alert`, skip link | the browser regression `ui/ui-a11y-regress.mjs` failed first (1/21 clean → 21/21); these static guards were added after the fix |
Result of the focused re-run: all 24 pass; `tsc` 0 errors; `eslint` clean on changed files.

## Coverage observations
- Existing coverage is strongest on lifecycle (220), notifications (307), sheet masters (323), permissions (155).
- **LOW** (<30 existing tests): Requester Home (4), Knowledge Base (29), CSAT (28), Field Service Reports (7), PMS (13), Zoho (2). Zoho got black-box coverage in this audit (UAT E, 10 checks) but **no new unit/integration tests** — listed in report 16.
- The 18 skipped integration tests and 2 skipped unit tests are opt-in by design and are reported as **NOT RUN**, not as passed.
- The repository's own "verify" command runs unit tests only; all four layers must be run before a release (H-3).

## Final full re-run
Run after the last code change, through the isolation gate (`evidence/final/`):

| Layer | Result |
|---|---|
| `tsc --noEmit` | exit 0 (0 errors) |
| `eslint` | exit 0 |
| Unit + integration (one run, 2,846 tests) | 2,824 pass, 20 skipped, **2 failed first time** |
| Remediation (181) | **4 failed first time**, 181 of 181 after the clean-up below |
| VAPT (410) | 410 of 410 pass |

**The 6 first-time failures were my own doing, not product defects.** They were all "dashboard figure equals the raw ticket count" tests (`dashboard-numbers-audit`, `fixed-reports`, `119-dashboard-drill-parity`, `120-team-dashboard-scope`). The 100,000 synthetic load-test tickets were still in the audit database, which is more than the dashboard's 30,000-ticket cap, so the dashboard could not show every ticket. After removing the synthetic tickets (3,284 left) the 2 integration tests (re-run: 3 of 3 pass) and all 181 remediation tests passed. Lesson for the checklist: **run these suites on the normal-size database only.** Final totals: unit 2,424 pass + 2 skipped; integration 402 pass + 18 skipped (BLOCKED); remediation 181; VAPT 410.
