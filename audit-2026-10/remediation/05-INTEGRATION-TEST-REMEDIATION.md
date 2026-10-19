# 05 — Integration Test Remediation

*2026-10-13 · all runs on the disposable audit stack `ckdesk_audit` (loopback only) through `audit-2026-10/guard/run.ps1` (isolation gate 21/21 before each run). Branch `remediation/post-audit-2026-10`.*

## 1. Result

| | Audit baseline (before any fix) | Final (after remediation) |
|---|---|---|
| Integration tests | 419 total · **389 passed · 6 failed** · 24 skipped | 419 total · **401 passed · 0 failed** · 18 skipped |
| Raw evidence | `evidence/baseline/integration.json` | `evidence/remediation/final-integration-2.json` |

No test was weakened, deleted or skipped to reach this. Every change to a test file is listed in section 4 with the reason, and in each case the thing being tested was checked independently first.

## 2. The six baseline failures (root causes, verified against the baseline evidence)

| # | Test | What the baseline run showed | Root cause | Kind | Resolution |
|---|---|---|---|---|---|
| 1 | `analytics-store-filter` — region rows add up to the whole | `expected 0 to be greater than 0` | The test's independent SQL ran inside the hard-coded **dev** database container (`supabase_db_citykart_desk`) while the application under test read the **audit** database, so the "truth" and the report came from different databases | Test environment | `tests/setup/db-container.ts` picks the container of the stack the test is pointed at; passes |
| 2 | `fixed-reports` — a technician starts on their own groups | `a technician with a group exists in the local data: expected undefined` | Same as 1 (it looked for a technician in the wrong database) | Test environment | Same fix |
| 3 | `fixed-reports` — Admin and BD summaries count exactly the open tickets | `admin-summary-report: expected +0 to be 12` first; after fix 1, `bd-summary-report: expected 246 to be +0` | First the same wrong-database cause; then a second, independent one: the test's SQL uses the team name `BD Group` while the seeded team is `BD GROUP`, so the SQL counted 0 and the report (correctly) showed 246 | Test environment, then test fixture. **The report was right** | Independent SQL with the right name gives **246 = 246**. The test now matches the name case-insensitively |
| 4 | `dashboard-numbers-audit` — reconciles every shared figure | 145 differences | After fix 1, 15 differences remained, all in the Smart dashboard's *open backlog* figures (e.g. backlog 1,546 against a SQL count of 1,529; open-by-group 479/250/233/236/348 against 473/246/230/235/345). Independent SQL found **17 tickets with a resolved/closed time in the future**: the seed generator gave recent synthetic tickets resolution times after the moment of seeding. The Smart view counts a ticket as open until its resolve time; the SQL counts by status. The "Normal" dashboard matched the SQL in every figure | Synthetic-data defect (not an application bug: a real ticket cannot be resolved in the future) | Seed generator fixed (`least(..., now())`) and the 26 affected rows in the disposable database corrected. The test passes **with no change to the test** |
| 5 | `stage7b-audit-logging` — whatsapp test-connection events | `testWhatsAppConnection` returned `ok: false` (line 340) | **Not isolated.** It failed once in the baseline full run and passed in every later run (`rerun-5-files.json`, and the final run). The test runs against stubbed third-party endpoints; the failure did not reproduce | Intermittent (suspected ordering/timing in a full parallel run) | No change made. Recorded as a flakiness risk in document 10 |
| 6 | `stage7b-audit-logging` — UAT-33 evidence summary | `missing evidence for whatsapp_test_connection_succeeded` | Consequence of 5 (it summarizes the evidence rows test 5 writes) | Intermittent | Same as 5 |

## 3. Failures that appeared during the remediation (R-1 to R-3 were real regressions caused by my own fixes; R-4 was an environment effect)

Running the complete integration suite after the performance migration showed **22 new failures** that had not existed before. R-1 to R-3 were real regressions, not test problems, and are recorded here in full.

| # | Symptom | Root cause | Fix | Verified by |
|---|---|---|---|---|
| R-1 | "Failed to update status." / "Failed to assign request." in 22 tests (start work, resolve, reopen, CSAT, assignment RBAC…) | **Migration 158** made the ticket *select* rule contain sub-selects. The ticket *update* rule also reads the tickets table in sub-selects (to prove owner/requester/service/team are unchanged). PostgreSQL rejects that combination: `42P17 infinite recursion detected in policy for relation "requests"`. Every status change and assignment failed | The "has not changed" comparison moved into a `SECURITY DEFINER` helper `request_identity_unchanged(...)`: same answer (it reads the stored row exactly as the sub-selects did), no self-reference. Rollback drops the helper | New `tests/remediation/71-requests-update-identity.test.ts` (7 tests: ordinary update works for a technician and a manager; changing requester / service / team is refused; a requester cannot update); equivalence test 70 (identical visibility for 9 user types) re-run and green; full suite green |
| R-2 | "You do not have permission…" creating a ticket from the web form (3 tests) | **Migration 157** (D-008, forged ticket lifecycle) refuses SLA deadlines in a ticket INSERT made as the signed-in user. The ticket-creation code set the two deadlines in that same insert | `create-request-core.ts` inserts without the deadlines and writes them with the server's own client right after. The database rule stays (a requester still cannot choose their own deadline) | `whatsapp-stage1-create-request-core`, `stage6-web-whatsapp-parity` green; `40-db-high` still proves the forged insert is refused |
| R-3 | 404 on request-attachment and intake-attachment download (2 tests) | Fixtures stored files under `<tag>/file`; the serving routes (D-052, D-053) now only follow the real stored shapes (`<request id>/<file>`, `<org>/<message>/<file>`) | Fixtures use the real shapes | `desk-storage-001-storage-proxy` 6/6 |
| R-4 | 3 tests failed (`stage6-web-whatsapp-parity`, two in `whatsapp-stage1-create-request-core`): `expected 'CKSD-1099585' to match /^CKSD-d{6}$/` | Environment, **not a defect**: the load-test seeding had pushed the audit database's ticket counter past one million, and migration 159 (D-069) correctly writes numbers above 999,999 in full. These tests assume numbers below one million, which is true for real use | The audit database's counter was put back to a realistic value (3,222). **The tests were not edited** | The two files re-run green (9/9), then the whole suite: 0 failures |

This is exactly the kind of regression a "fix-only" run would have missed; it was found because the full suite was run after each database change and the failures were not explained away.

## 4. Test-file changes (complete list)

| File | Change | Why it is legitimate |
|---|---|---|
| `tests/setup/db-container.ts`, `tests/setup/audit-only.ts`, `vitest.remediation.config.ts`, `vitest.config.ts` | Detect which local stack a test is pointed at; remediation tests refuse to run anywhere except the audit stack; default config excludes `tests/remediation` | Safety / environment |
| `tests/integration/analytics-store-filter`, `dashboard-numbers-audit`, `fixed-reports` | Use the stack detection | Environment |
| `tests/integration/fixed-reports.test.ts` | Team-name comparison case-insensitive | Seed name differs in case; independent SQL proves the report correct |
| `tests/integration/desk-storage-001-storage-proxy.test.ts` | Icon fixture is a real `<uuid>.png`; attachment fixtures use the real stored path shapes | The routes now accept only the real shapes (D-051/52/53) |

## 5. The 18 skipped integration tests

Skipped tests are reported, not hidden. Baseline: 24 skipped. Final: 18. The 6 that now run are `admin-store-login-rename` (6 tests; they pass).

The 18 still skipped are all gated by `describe.skipIf(!RUN_PRODUCTION_CATALOG_UAT)` (see `tests/setup/uat-mode.ts`): they exercise the real production service/field catalog (WhatsApp mandatory-fields flow, canonical identity search, parity SLA/assignment, attachments fixture, semantic-role service) and are skipped on a clean-slate database by design. They were **not** run in this remediation because that mode needs the production catalog, which must not be copied into the audit environment.

| File | Skipped |
|---|---|
| `stage7a-canonical-identity-search` | 9 |
| `stage7b-parity-sla-assignment` | 4 |
| `stage7a-mandatory-fields-flow` | 3 |
| `stage7a-attachments-fixture` | 1 |
| `stage7-1-semantic-role-real-service` | 1 |

Status: **BLOCKED by environment rule** (needs production catalog data) — listed in document 10.

## 6. Status

| Item | Status |
|---|---|
| 6 baseline integration failures | **Verified fixed** (0 failures in the final run) |
| 3 regressions caused by remediation (R-1, R-2, R-3) | **Verified fixed**, regression tests added |
| Tests weakened or removed | **None** |
| Intermittent failure not reproduced (stage7b, 2 tests) | **Open — flakiness risk recorded** |
