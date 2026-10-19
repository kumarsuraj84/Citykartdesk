# 09 — Regression Results

*Final regression on branch `remediation/post-audit-2026-10` (head `55711fd`), 2026-10-13, on the isolated audit stack, each run started through the isolation gate (21 / 21). Nothing was hidden, skipped to go green, or edited to pass; every test-file change is listed in document 05.*

## 1. Exact counts

| Check | Baseline (before any fix) | Final | Evidence |
|---|---|---|---|
| **Type check** (`tsc --noEmit`) | 0 errors | **0 errors** | `final-typecheck.txt` |
| **Lint** (`npm run lint`) | 6 problems (1 error, 5 warnings) | **6 problems (1 error, 5 warnings) — identical, all pre-existing** (the error is a React hooks rule in `AnalyticsDashboard.tsx`; three new warnings I introduced were removed) | `final-lint.txt` |
| **Unit tests** | 961 tests · 961 passed · 0 failed | **1,090 tests in 108 files · 1,090 passed · 0 failed · 0 skipped** (+129 new) | `final-unit.json` |
| **Integration tests** (real database, real sessions, row security on) | 419 tests · 389 passed · **6 failed** · 24 skipped | **419 tests in 83 files · 401 passed · 0 failed · 18 skipped** | `final-integration-2.json` |
| **Remediation tests** (security regression, RLS equivalence, cross-tenant, UAT lifecycle, reliability) | — (new) | **83 tests in 13 files · 83 passed · 0 failed · 0 skipped** | `final-remediation-2.json` |
| **Production build** (`next build`, separate output folder, through the gate) | not run | **Succeeds**; standalone output produced (the generated folder was removed afterwards) | run log |
| **Browser UAT** (the built-in browser, five roles) | — | Section 4 and document 06 | document 06 |
| **Performance** (load and plans at 100k and 500k tickets) | — | Document 04 | `perf-r*.json`, `explain-*.txt` |
| **Isolation gate** | 21 / 21 | **21 / 21**, re-run before every run and once more at the end | gate output in every log |

**Totals of the three automated suites:** 1,592 tests · **1,574 passed · 0 failed · 18 skipped.**

## 2. The 18 skipped tests

Unchanged in nature from baseline (24 skipped then, 6 of which now run). All 18 are gated by `describe.skipIf(!RUN_PRODUCTION_CATALOG_UAT)`: they exercise the real production service/field catalog and are skipped on a clean-slate database by design. They are **Blocked** here because that mode needs the production catalog, which must not be copied into the audit environment. Listed in document 05 §5.

## 3. Failures along the way (all resolved, none dismissed)

| When | What | Cause | Resolution |
|---|---|---|---|
| Baseline | 6 integration failures | Tests read the wrong database / a mis-cased team name / synthetic seed with future-dated resolutions; one intermittent pair | Document 05 §2 |
| After migration 158 | 22 integration failures ("Failed to update status", "Failed to assign request") | **Real regression I introduced:** the ticket update rule's self-reading sub-selects collided with the faster select rule (PostgreSQL "infinite recursion detected in policy") | Fixed with a `SECURITY DEFINER` helper; regression test; document 04 §3 and 05 §3 |
| Same run | 3 tests creating tickets from the web form | **Real regression:** the migration-157 guard refuses SLA deadlines in a client insert; the creation code set them there | The deadlines are written with the server client afterwards; re-verified live in the browser |
| Same run | 2 storage-proxy tests | Fixtures used path shapes the stricter routes no longer serve | Fixtures updated to the real stored shapes |
| After 500k seeding | 3 tests expecting six-digit ticket numbers | The audit database's counter had been pushed past one million; migration 159 writes larger numbers in full (correct) | Counter reset to a realistic value; tests not edited; document 05 R-4 |
| Mid-run | A killed background chain left two test processes running against one database, a stopped API container, 11 test users and 4 test intake channels | My own process error | Processes stopped, container restarted, leftovers removed; **the isolation gate refused to run (20/21) until the 4 leftover channels were removed** — it worked as designed and was not touched |

## 4. Browser UAT summary (detail in document 06)

* The repository has **no automated browser end-to-end suite** (no Playwright or Cypress); the browser checks were performed by hand-driven sessions in the built-in browser.
* Five roles signed in; 38 routes requested as each: **0 errors**; role redirects correct.
* Forms, validation, ticket creation, hostile text, technician flow, SLA policy creation and application, deep-link sign-in, wrong-password refusal, session survival across restarts: verified.
* Live security checks: five hostile `next=` values all redirect to `/home`; the four new response headers are present.

## 5. Reproduce

```
powershell -NoProfile -ExecutionPolicy Bypass -File audit-2026-10\guard\run.ps1 npx vitest run tests/unit
powershell -NoProfile -ExecutionPolicy Bypass -File audit-2026-10\guard\run.ps1 npx vitest run tests/integration
powershell -NoProfile -ExecutionPolicy Bypass -File audit-2026-10\guard\run.ps1 npx vitest run --config vitest.remediation.config.ts
```

(Each starts with the isolation gate; the remediation config refuses to run anywhere but the audit stack. The audit stack must be running: `npx supabase start --workdir audit-2026-10/env -x studio,imgproxy,edge-runtime,logflare,vector,postgres-meta`.)
