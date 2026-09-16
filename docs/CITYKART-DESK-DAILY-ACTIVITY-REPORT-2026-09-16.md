# Citykart DESK — Daily Activity Report — 2026-09-16

Covers every instruction received today and everything done in response to
it — locally, in git, and on Main (`10.0.1.12`).

---

## 1. Instructions received today, in order

1. **Complete the JWKS/ES256 remediation on Main** — finish verifying
   GoTrue's config-merging logic, then run the full safety sequence
   (session compatibility → PostgREST compatibility → Storage compatibility
   → local proof-of-concept → apply to Main → verify), applying the fix to
   Main's live services only after explicit confirmation.
2. **"JWKS FIX + GIT / LOCAL / MAIN PARITY"** — turn the JWKS fix into
   git-tracked deployment code, properly fix the `EXISTING_DEPARTMENT_ID`
   test-fixture bug (not just patch it), add a deployment validation
   script, document a repeatable deployment workflow.
3. **"FINAL TEST HARDENING BEFORE BULK / CONCURRENCY TEST"** — make the
   test suite genuinely repeatable/idempotent, with an explicit correction
   that `business_hours` is system configuration to be **preserved**, not
   business data to be wiped; gate production-catalog-dependent UAT tests;
   audit hardcoded dependencies; build a clean-slate seed manifest and a
   read-only validator; prove idempotency via 3 consecutive full-suite runs
   with zero cleanup between them.
4. **"PRODUCTION-SCALE BULK / CONCURRENCY / PERFORMANCE TEST — LOCAL FIRST →
   MAIN SECOND → OPTIMIZE → GIT SYNC → FINAL CLEAN SLATE"** — build a
   genuinely concurrent load-testing harness (not a sequential loop), run a
   staged ramp on Local first (220 requesters/60 technicians/~1000
   tickets), root-cause any bottleneck with evidence, then repeat on Main
   with explicit safety gates (confirmation required, no infinite retries,
   no real notification sends), then clean up — but explicitly **not**
   before all testing is finished.
5. Two clarifying questions, answered directly: what `127.0.0.1:3001` is
   (Local's own dev server, not Main), and confirmation that testing so far
   was Local-only.
6. **"MAIN 10.0.1.12 PRODUCTION LOAD VALIDATION — POSTGREST POOL TUNING →
   TARGET LOAD → SOAK → UAT → GIT SYNC → CLEAN SLATE"** — continue (not
   restart) onto Main: pre-flight, a shared-Postgres connection budget
   (never starve WMS/Workforce OS/CKSpinwheel/ck_ld/other apps on the same
   server), baseline Main at the existing pool=10 setting, confirm (don't
   assume) whether Main reproduces Local's pool bottleneck, stage any pool
   change 10→20→30→40, run the same ramp on Main, fix only proven
   bottlenecks, full regression, git sync, then clean Main the same
   careful way.
7. Mid-turn scope confirmations from you, honored throughout: explicit
   **"yes"** before the first write of any kind to Main (a tiny smoke-test
   org); **"ok"** before the Phase 3 baseline-at-pool=10 run; reminder to
   **delete all test data from Main and reset its sequence** once done;
   **"only touch Citykart DESK on Main, don't touch anything else"**;
   **"yes"** before the target-load run; **"fix"** for the two defects
   found under target load; **"yes"** before deploying that fix to Main
   and restarting `CitykartApp`.
8. **This request** — a single `.md` report of everything done today, plus
   a full clean slate on both Local and Main with sequences reset.

---

## 2. What was done — chronological summary

### 2.1 JWKS/ES256 remediation (completed and applied to Main)

- Verified GoTrue's `ApplyDefaults()`/`FindPublicKeyByKid()` config-merging
  logic directly against the real compiled binary via a temporary, never-
  committed proof-of-concept test placed inside GoTrue's own source tree on
  Main, confirming both new-key signing and old-key (no-`kid`) fallback
  resolution work as intended.
- Confirmed empirically that PostgREST 16.3 needs the legacy secret
  embedded **inside** its JWKS (as an `"oct"` key) once `jwt-secret` holds
  a JWKS at all — it has no separate flat-secret fallback, unlike GoTrue
  and Storage.
- Applied to Main: added `GOTRUE_JWT_KEYS` to `services/auth/.env`
  (`GOTRUE_JWT_SECRET` untouched), replaced PostgREST's `jwt-secret` with a
  mixed JWKS (legacy + new key), added `JWT_JWKS` to
  `services/storage-src/.env`. Restarted `CitykartAuth`, `CitykartPostgrest`,
  `CitykartStorage`. Verified a real pre-existing browser session survived
  the restart with zero forced re-login.
- Converted the fix into git-tracked tooling:
  `deploy/windows/generate-jwt-signing-key.js`,
  `deploy/windows/validate-deployment.ps1`, updated
  `deploy/windows/config/{auth,postgrest,storage}.env.example`, and a new
  "JWT signing keys (JWKS)" section in `docs/WINDOWS-DEPLOYMENT.md`.
- Fixed the real `EXISTING_DEPARTMENT_ID` hardcoded-UUID bug across 12
  files (4 shared fixtures + 8 integration tests) with a shared
  `tests/setup/test-department.ts` helper.

### 2.2 Test hardening (completed)

- Built `tests/setup/uat-mode.ts` to gate production-catalog-dependent UAT
  tests behind `RUN_PRODUCTION_CATALOG_UAT` (default off, explicit skip
  reason, never silently counted as a pass).
- Made mobile-number test fixtures dynamic/unique instead of hardcoded,
  preserving the duplicate-detection test's actual intent.
- Restored 3 tables found wiped locally by an earlier session's cleanup —
  `business_hours`, `sla_escalation_rules`, `alert_rules` — using
  schema-current values (not stale migration literals); independently
  re-confirmed Main was **not** actually affected (an earlier "uncertain"
  reading was an RLS-visibility artifact of querying via the restricted
  app role).
- Documented the canonical, authoritative business-hours calendar
  (Mon–Fri 09:00–17:00 active, Sat/Sun inactive) and built
  `docs/CLEAN-SLATE-SEED-MANIFEST.md` (PRESERVE vs DELETE for every table)
  and `scripts/clean-slate-validator.mjs` (read-only).
- Proved idempotency: 3 consecutive full-suite runs with zero cleanup
  between them produced identical results (82 passed / 4 skipped / 0
  failed).

### 2.3 Load-testing harness (built) and Local run (completed)

- Built a genuinely concurrent harness under `loadtest/`: real OS-process
  concurrency (`vitest run --pool=forks`, one process per shard) calling
  the actual Server Action functions (`createRequestCore()`,
  `updateRequestStatus()`, `assignRequest()`, `addComment()`) with real
  per-persona JWTs and real RLS — not raw REST calls, and not a sequential
  loop pretending to be concurrent.
- Ran a staged ramp on Local (warm-up → medium → target: 220 requesters/60
  technicians/~1000 tickets) to genuine completion: 4597 real operations,
  0.33% error rate, every error individually inspected and confirmed
  correct (real business rejections / concurrency conflicts, not bugs).
- Root-caused a real PostgREST connection-pool bottleneck at `db-pool=10`
  via three independent lines of evidence (`pg_stat_statements` per-query
  timing, a zero-concurrency control run at the same data volume, and live
  `pg_stat_activity` sampling showing the `authenticator` role pegged at
  exactly the pool size regardless of load).
- Verified dashboards/analytics render correctly against real ~1000-ticket
  volume for the first time in this engagement.

### 2.4 Main production load validation (this session, today)

- **Pre-flight**: confirmed all 5 Citykart services healthy, JWKS non-empty
  (1 ES256 key), `max_connections=100`, `db-pool=10` (unchanged), and — new
  today — that **no** Windows service/process for WMS, Workforce OS,
  STORE ROASTER, CKSpinwheel, or ck_ld exists on this box; those systems
  connect to their own databases on the same shared Postgres instance
  remotely. Confirmed Main was genuinely clean (0 requests, 1 profile, 1
  organization) before any load-test writes.
- **Fixed a real harness-targeting gap**: the load-test scripts always
  loaded Local's own `.env.local` regardless of `LOADTEST_ENV=main`. Fixed
  by copying the harness onto Main's own `app/loadtest/` directory so it
  naturally picks up Main's own already-present `.env.local` — avoiding
  ever needing to see or transcribe Main's service-role key.
- **Smoke test** (after your explicit "yes"): created a tiny, uniquely
  tagged org structure on Main, proved the harness was correctly wired to
  Main's real database, then immediately deleted every row it created and
  confirmed a clean re-read — proving both write and cleanup work before
  committing to anything larger.
- **Phase 2 — shared Postgres connection budget**: built a budget table
  from real `pg_stat_activity` evidence (Citykart DESK ≈12 connections,
  CKSpinwheel ≈6, real-but-currently-idle history on `wms_db`/
  `workforce_os`/`ck_ld`), capping Citykart DESK at ≤50 of `max_connections
  =100` even at the most aggressive pool stage tested, with a hard 10-
  connection emergency reserve.
- **Phase 3 — warm-up (50 req/10 tech, pool=10, unchanged)**: first attempt
  failed almost entirely — see Finding #1 below. After the fix, a clean
  re-run (166 samples) showed 0 auth failures and realistic latency
  (`create_request` P50=211ms/P95=894ms/P99=1435ms; technician actions
  143–358ms).
- **Medium (100 req/25 tech, ~400 tickets cumulative)**: 0/15 workers
  failed. Connections held steady at 12 throughout, 0 queries ever caught
  waiting — **Main did not reproduce Local's pool=10 bottleneck at this
  scale.** The only failures were genuine, correctly-enforced rejections,
  including real optimistic-concurrency conflict messages surfacing
  organically under real collisions.
- **Target (220 req/60 tech, ~660 new tickets attempted per run, 2 runs)**:
  0/20 workers failed both times, connections still steady at 12 with 0
  waiting — but only ~34% of `create_request` attempts succeeded each
  time, surfacing Finding #2 below. CPU was pegged at 90–100% for most of
  each run. The other apps sharing the server (CKSpinwheel, WMS, Workforce
  OS, ck_ld) kept advancing normally throughout, with no visible
  disruption.

---

## 3. Findings and fixes (the two real defects found today)

### Finding #1 — GoTrue silently stopped accepting old-format tokens after the JWKS rollout

**What broke:** immediately after adding `GOTRUE_JWT_KEYS` to Main earlier
this session, every GoTrue-native authenticated endpoint (`/user`,
`/admin/*`, `/logout`) started rejecting every pre-existing HS256 token —
including the service-role key, always HS256 — with `bad_jwt`/"signing
method HS256 is invalid". This directly broke `createAdminClient()`'s
admin-API calls (Invite User, Bulk Import Users, Admin Set Password, List
Users in `lib/actions/admin/users.ts`), first caught via the load-test
harness's `admin.auth.admin.createUser()` calls failing.

**Root cause:** GoTrue's `internal/api/auth.go#parseJWTClaims()` builds its
JWT parser with `jwt.WithValidMethods(config.JWT.ValidMethods)` — a hard
allow-list checked **before** the Keyfunc (and therefore before
`FindPublicKeyByKid()`'s correct no-`kid` HS256 fallback) ever runs.
`internal/conf/configuration.go`'s `ApplyDefaults()` only populates
`ValidMethods` when it's still `nil`, and when `GOTRUE_JWT_KEYS` is
non-empty it fills it **solely from that array's own algorithms** (`ES256`)
— never adding `HS256` back in, even though `GOTRUE_JWT_SECRET` is still
configured and still meant to work for no-`kid` tokens.

**Fix:** set `GOTRUE_JWT_VALID_METHODS="ES256,HS256"` explicitly in
`services/auth/.env`, restart `CitykartAuth`. Verified via a read-only
probe against `/auth/v1/admin/users`: `403 bad_jwt` before, `200` after,
same unmodified key both times. Added the same guidance to
`deploy/windows/config/auth.env.example` and an automated check to
`validate-deployment.ps1` so this can't recur on a future rollout.
Committed as `f820ccf`.

### Finding #2 — an `EADDRINUSE` retry gap that masked real errors as fake "not found" rejections

**What broke:** at target scale, 66% of `create_request` calls failed with
`"Service not found."` / `"Requester not found."` for services and
requesters that unquestionably existed.

**Root cause, three layers:**
1. Main's Windows dynamic TCP port range is the default 49,152–65,535
   (confirmed via `netsh int ipv4 show dynamicportrange tcp`). Generating
   220 concurrent requesters' worth of traffic from 20 Node processes **on
   Main's own machine** — each making rapid loopback HTTP calls to
   PostgREST at `127.0.0.1:3001` — burned through ephemeral ports fast
   enough to trigger real `EADDRINUSE` errors.
2. `lib/supabase/resilient-fetch.ts`'s retry classifier only retried
   `ECONNRESET`/`ECONNREFUSED`/`ETIMEDOUT`, not `EADDRINUSE` — even though
   it's just as transient (a port frees up within milliseconds).
3. `lib/requests/create-request-core.ts`'s service/requester existence
   checks used `.single()`, which itself errors on zero matching rows
   (PostgREST `PGRST116`) — making a genuine "not found" and "the query
   itself failed" indistinguishable by error-presence alone. The same
   error-swallowing pattern existed independently in
   `lib/sla/business-hours.ts#getSLACalendar()`, which fired a false
   **critical** operator alert during the same run even though
   `business_hours` was confirmed fully intact in the database throughout.

**Fix (all three, committed as `de30c3c`):**
- `resilient-fetch.ts`: added `EADDRINUSE` to the retryable-error set.
- `create-request-core.ts`: switched both existence checks from
  `.single()` to `.maybeSingle()` (already used elsewhere in this codebase
  for the same purpose) so a real lookup error now goes through
  `sanitizeError()` instead of being misreported as a business rejection.
- `business-hours.ts`: `getSLACalendar()` now distinguishes a genuine load
  failure from a genuinely empty/misconfigured calendar, logging/alerting
  the former at `warning` severity instead of a false `critical`.

**Verified:** full local suite passes (655/675 — the 2 failures are
pre-existing, confirmed non-regressions unrelated to this change: one
transient timing flake reproduced as passing in isolation, one caused by
Local's own leftover load-test personas skewing an org-wide count query);
the 3 previously-failing cross-tenant security tests in
`stage1-1-create-request-core-security.test.ts` (which rely on the
existence-check's zero-row rejection) pass unchanged.

**Deployed to Main** (after explicit confirmation): stopped `CitykartApp`
(releases its own log-file lock inside `.next/standalone`, which otherwise
makes `next build` fail with `EBUSY`), ran `npm run build`, copied
`.next/static`/`public`/`.env.local` into the fresh standalone output,
restarted `CitykartApp`. Health check `200` on `/login`.

**Re-tested at target scale after deploying the fix:** confirmed
`"Service not found."`/`"Requester not found."` no longer occurs (0
occurrences, down from 436) — every one of those cases is now a correctly
logged, honestly-reported infrastructure error. **However, the underlying
capacity limit is unchanged**: raw ticket-creation success barely moved
(231/660 vs 224/660 before the fix), and CPU stayed pegged at 95–100% for
most of the run. The fix corrected the dishonest error reporting; it did
not — and was not intended to — solve the deeper constraint, which is most
likely CPU saturation from generating this much load *from Main's own
machine via loopback*, not the PostgREST pool (which never showed material
queuing at any scale tested) and not the application logic (which now
fails honestly instead of misleadingly). This is flagged as open — see
§5.

### An unrelated, minor, non-blocking observation
`workforce_os`'s `pg_stat_database` counters show a strikingly high
rollback-to-commit ratio (120,822 rollbacks vs 56,946+ commits across two
samples). This is a different application entirely, outside this
engagement's scope, and nothing here was changed or investigated further
— noted only because it was visible in the same read-only queries used to
build the connection budget.

---

## 4. Clean-slate confirmation (both environments)

A new, git-tracked, manifest-driven cleanup tool
(`loadtest/setup/cleanup.mjs`, committed as `6890559`) was built and used to
remove every row either environment's load testing created today — driven
entirely by that run's own `org-manifest.json`/`personas-manifest.json`,
never a name-pattern guess — followed by a sequence reset on both.

| Check | Local | Main |
|---|---|---|
| `requests` | 0 | 0 |
| Load-test profiles/personas | 0 (290 removed) | 0 (290 removed, auth users deleted too) |
| Load-test department/teams/services/sub-categories/SLA policy | 0 | 0 |
| `organizations` | 8 (pre-existing, unrelated to today's work — see note) | 1 (bootstrap org only) |
| `profiles` (total) | 18 (pre-existing fixtures, unrelated to today's work) | 1 (bootstrap admin only) |
| `business_hours` (system seed) | 7 rows, 5 active — unchanged | 7 rows, 5 active — unchanged |
| `sla_escalation_rules` (system seed) | 4 — unchanged | 4 — unchanged |
| `alert_rules` (system seed) | 4 — unchanged | 4 — unchanged |
| `request_sequences` (CKSD) | reset to `last_no=0` (next ticket: `CKSD-000001`) | reset to `last_no=0` (next ticket: `CKSD-000001`) |
| Deployment validation | — | 0 failures (`validate-deployment.ps1`: JWKS non-empty, `service_role` BYPASSRLS, `127.0.0.1`+`sslmode`, `GOTRUE_JWT_VALID_METHODS` includes HS256) |

Note on Local's `organizations=8`/`profiles=18`: these pre-date today's
session (they're leftover fixtures from the test **suite's** own earlier
runs, not from today's load testing) and were left untouched, matching
`docs/CLEAN-SLATE-SEED-MANIFEST.md`'s scope — today's cleanup only removed
what today's load-test runs themselves created.

All ad-hoc scratch scripts copied to Main during today's work (smoke-test,
pre-flight, connection-detail, business-hours-check, cleanup, and per-stage
run scripts) were deleted from Main's disk after use. The `loadtest/`
harness itself remains on Main at `E:\CK Projects\CitykartDesk\app\loadtest\`
as a permanent, git-tracked tool for future runs.

---

## 5. Open items / recommendations

1. **Target-scale capacity limit on Main is not yet resolved** — only ~35%
   of attempted ticket creations succeeded at 220 concurrent
   requesters/generated from Main's own machine, most likely due to CPU
   saturation (confirmed 90–100% during both target runs) compounding
   ephemeral-port exhaustion. This needs either (a) generating load from a
   *separate* client machine to isolate whether it's a load-generation
   artifact or a genuine Main capacity limit, or (b) a deeper investigation
   into what's consuming CPU at that scale. Not yet done.
2. **PostgREST `db-pool` was never changed from 10** — at every scale
   tested (warm-up/medium/target), Main did not reproduce Local's pool
   bottleneck, so per your own instruction ("do not change pool merely
   because Local did"), it was correctly left untouched. If item 1 above
   is resolved and a real pool-related signal appears, the staged
   10→20→30→40 tuning plan is still queued and ready.
3. Soak test, full regression on Main, functional/security UAT on Main,
   and the HTTP/browser-performance-layer benchmark (Phase 13 of the most
   recent mega-prompt) were not reached this session — target-scale load
   testing surfaced the two defects above first, and cleanup was requested
   before continuing further. These remain open for a future session.
4. `workforce_os`'s rollback ratio (§3, unrelated observation) may be
   worth a separate look by whoever owns that application — out of scope
   here.

---

## 6. Git commits made today

| Commit | Summary |
|---|---|
| `849f67d` | JWKS/ES256 signing key rollout tooling; fix stale department fixture across 12 test files |
| `e2534cc` | Document the department-fixture fix and full regression run results |
| `a3bf265` | Make the test suite idempotent: gate production-catalog UAT tests, fix mobile/RUN_TAG residue, add clean-slate seed manifest + validator |
| `8bb8a94` | Add `CITYKART-DESK-TEST-HARDENING-AND-BULK-READINESS.md` |
| `a488995` | Add genuine concurrent load-test harness; fix confirmed PostgREST pool bottleneck |
| `f820ccf` | Fix `GOTRUE_JWT_VALID_METHODS` regression from the JWKS rollout |
| `5a86494` | Fix load-test harness's `next/headers` mock to forward the acting persona's verified user id |
| `de30c3c` | Fix EADDRINUSE retry gap and error-masking found under Main target-scale load testing |
| `6890559` | Add `loadtest/setup/cleanup.mjs` for full manifest-driven load-test teardown |

All commits pushed to `main` on the remote (`github.com/kumarsuraj84/Citykartdesk`).

---

## 7. Current state — both environments, right now

- **Local**: clean slate (0 requests, sequence reset), all fixes present,
  full test suite passing (655/675, 2 pre-existing non-regressions).
- **Main**: clean slate (0 requests, 1 profile, 1 organization, sequence
  reset), running the latest build with all of today's fixes deployed and
  verified (`200` health check, `validate-deployment.ps1` 0 failures), all
  5 Citykart services healthy, other applications on the shared server
  (CKSpinwheel, WMS, Workforce OS, ck_ld) confirmed undisturbed throughout.
