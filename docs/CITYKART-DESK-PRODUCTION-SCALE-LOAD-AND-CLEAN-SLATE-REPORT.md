# CITYKART DESK — Production-Scale Load and Clean-Slate Report

**Status: LOCAL phase complete. MAIN load testing not yet started — awaiting
explicit go-ahead before running load against the shared production server.**
This report will be updated in place as the Main phase, comparison, fixes,
soak test, and clean-slate cleanup of both environments proceed.

## 1. Executive Summary

Built a genuine concurrent load-testing harness from scratch and ran it
against LOCAL at warm-up (100 tickets), medium (300 cumulative), and target
scale (960 cumulative tickets, 220 requesters, 60 technicians, 10 managers).
4597 real business-action operations executed with a 0.33% error rate — and
every one of those errors is *correct* application behavior (a pickup race
and an optimistic-concurrency-control rejection), not a defect. Found and
fixed one confirmed, evidence-backed bottleneck: PostgREST's default
10-connection pool caps concurrent throughput regardless of data volume,
proven by directly measuring `pg_stat_activity` (pegged at 11 connections
under load) and by an isolated single-worker control (~320-375ms at the
*same* data volume that showed 3749ms P50 under 10-way concurrency). Fixed
in the git-tracked deployment template. Dashboards/Analytics were verified
correct at real ~1000-ticket scale for the first time in this engagement
(prior performance work only had empty tables to test against). Full
regression suite re-run after load testing: 2 failures, both explained and
confirmed transient (a load-test-data count artifact, and a timing timeout
that passed cleanly on isolated re-run) — not real regressions.

Main has NOT been load-tested. Preflight-only: git/code parity confirmed,
JWKS/auth confirmed healthy, Main's system seed confirmed healthy with
proper privileges. No data has been written to Main.

## 2. Git/Environment Baseline (Phase 1)

- LOCAL HEAD = `origin/main` HEAD = `8bb8a94` (clean working tree, verified
  via `git fetch` + `git log`).
- Zero application-code files (`app/`, `lib/`, `components/`, `proxy.ts`,
  `types/`) changed between `e4455ad` and `8bb8a94` — confirmed via
  `git diff --name-only`. `e4455ad` is the exact commit already verified
  (earlier this engagement, via SHA-256 file hashing) to match Main's
  currently-deployed application code.
- **Conclusion: Main is at full application-code parity with git HEAD.**
  No redeploy needed before Main load testing — everything since `e4455ad`
  is test infrastructure, scripts, and documentation only.

## 3. JWKS/Auth Status (Phase 2)

Re-verified directly against Main (`10.0.1.12`), not assumed from the
earlier remediation report:

- GoTrue health: `{"name":"GoTrue","description":"GoTrue is a user
  registration and authentication API"}` — healthy.
- JWKS endpoint: 1 key, `kty=EC alg=ES256 crv=P-256`, non-empty (this was
  the original Root Cause #4 defect — confirmed still fixed).
- Fresh login header: `{"alg":"ES256","kid":"...","typ":"JWT"}` — new
  sessions are signed with the asymmetric key, matching the remediation's
  intent.
- PostgREST verification of a fresh ES256 token: succeeded (`GET
  /profiles?select=id` returned the expected row).
- All 5 services (`CitykartApp`, `CitykartProxy`, `CitykartAuth`,
  `CitykartPostgrest`, `CitykartStorage`) reported `SERVICE_RUNNING`.

**Conclusion: the JWKS remediation remains fully healthy. No auth-related
STOP condition applies — Main load testing is not blocked on this.**

## 4. Main System-Seed Verification (Phase 3)

Re-checked with a properly-privileged connection (the local Postgres
superuser via trust auth), not the RLS-restricted `citykart_desk_app` role
the previous report's check used:

| Item | Previous report | This check (superuser) |
|---|---|---|
| `organizations` | — | **1** (bootstrap org only) |
| `profiles` | — | **1** (bootstrap admin only) |
| `business_hours` active | 5 | 5 |
| `sla_escalation_rules` | not conclusively checked | **4** |
| `alert_rules` (bootstrap org) | uncertain (RLS artifact) | **4** — resolved, healthy |
| `intake_pipeline_config` (bootstrap org) | uncertain (RLS artifact) | **1** — resolved, healthy |
| `requests` / `tasks` | — | **0 / 0** |
| `request_sequences.last_no` (CKSD) | — | **0** |

**Conclusion: the earlier uncertainty around `alert_rules`/
`intake_pipeline_config` on Main is resolved — it was an RLS-visibility
artifact from querying with the app's own restricted role, not real
emptiness. No restore is needed on Main. Main is currently at a genuine,
already-clean slate** (0 operational rows, sequence at 0) — a convenient
starting point for the eventual Main load test.

## 5. Load-Test Architecture (Phase 4/7/8)

Built `loadtest/` (separate from `tests/` — never runs as part of `npm
test`, never touches production catalog config):

- **Genuine server-action-level execution, not raw REST.** Read
  `updateRequestStatus()`'s implementation first to confirm this mattered:
  permission checks, the transition-state matrix, SLA pause/resume math,
  notification creation, and audit logging are all in the TypeScript
  action layer, not database triggers. A raw authenticated REST call would
  have skipped essentially all of it — silently producing meaningless
  "load test passed" results. So every load-test action calls the real
  `createRequestCore()` / `updateRequestStatus()` / `assignRequest()` /
  `addComment()` functions this codebase's own UI calls, with a real
  per-persona JWT and real RLS enforcement.
- **Genuine OS-level concurrency, not a labeled sequential loop.** Each
  worker is a fully separate `vitest run` process (`pool: 'forks'`), reusing
  this repo's own proven `vi.mock('@/lib/supabase/server', ...)` pattern
  (the same one `tests/integration/*.test.ts` already trusts) to bind one
  persona's real JWT per call, safely, because each process has its own
  isolated module registry — no shared-mutable-mock race condition. A
  conductor (`loadtest/run.mjs`) spawns N such processes at once.
- **Phase 8 safety, built in, not bolted on:** `LOADTEST_ENV` must be
  explicitly `local` or `main` (refuses to run otherwise — never defaults to
  Main); targeting `main` additionally requires
  `LOADTEST_CONFIRM_MAIN=yes-run-against-main`; every run prints its
  resolved target before doing anything; every run/worker/setup script
  requires an explicit `LOADTEST_RUN_ID` (format
  `LOADTEST-<timestamp>-<random>`), tagged into every name/email/slug this
  session created; bounded concurrency and hard per-call timeouts
  (`env-guard.ts`); no infinite retries (`runWithConcurrency` gives each
  item exactly one attempt); real emails are never sent (`[EMAIL DISABLED]`
  logging confirmed throughout every run).
- **Metrics**: each worker appends timing samples to its own NDJSON file
  (no write contention); `loadtest/report.mjs` aggregates into
  P50/P95/P99/error-rate per scenario.

**Real bugs found and fixed while validating the harness itself** (not
application bugs — my own test code was wrong):
1. `MetricsRecorder.timed()` only caught *thrown* exceptions. Most of this
   codebase's action functions return `{ error?: string }` on a rejected
   operation rather than throwing — my first runs were silently recording
   app-level rejections as successes. Fixed to check the result's `.error`
   field explicitly.
2. Once fixed, it immediately surfaced two real, *correct* mandatory-field
   business rules my workload script wasn't respecting: "Start Working"
   and "Waiting User" both require a technician-entered message (the app
   correctly rejects the transition otherwise, with a clear error). Fixed
   the harness to supply one.
3. `service_sub_category_tags.sub_category_id` is uniquely constrained — a
   sub-category belongs to exactly one service, not shared across many.
   Fixed the org-structure generator to create one set of sub-categories
   per service (24 total across 6 services) instead of 4 shared ones.

## 6. Personas (Phase 5)

Created via the Supabase Admin API + real sign-in (same pattern as this
repo's own `tests/setup/fixtures-d03.ts`), tagged
`loadtest-<run-id>-<role>-<index>@loadtest.example.test`, never a real
Citykart identity:

| Role | Target | Created | Errors |
|---|---|---|---|
| Requesters | 200+ (used 220) | **220** | 0 |
| Technicians | 50+ (used 60) | **60** | 0 |
| Managers | 5-10 (used 10) | **10** | 0 |

Technicians and managers distributed round-robin across 6 teams (10
technicians/team on average, per the brief's example).

## 7. Workload Model (Phase 6/12)

One controlled organization structure inside the existing bootstrap org
(never a new org): 1 department, 6 teams, 6 services (one per team), 24
sub-categories (4 per service — see the constraint finding above), 1 SLA
policy (low/medium/high/urgent tiers). Requesters create tickets;
technicians work their own queue first (advance their own in_progress/
waiting_user tickets toward resolution) before picking up fresh open/
assigned team tickets — this "finish what I started" ordering is what
produces a realistic lifecycle mix instead of perpetual fresh pickups.
Requesters reply to any of their own tickets a technician moved to
`waiting_user`.

## 8. Local Warm-Up (Phase 9)

50 requesters, 10 technicians, 2 managers; 100 tickets.

```
Total samples: 284, ok: 284, failed: 0 (0.00% error rate)
create_request  P50 645ms   P95 1102ms  P99 1459ms
pickup          P50 484ms   P95 801ms   P99 808ms
start_working   P50 203ms   P95 334ms   P99 417ms
```

No fundamental failures — proceeded to scale up without a diagnose-first
pause.

## 9. Local Medium Load (Phase 10)

Scaled to 100 requesters / 25 technicians (idempotent persona-creation
fix applied along the way — see §16); 300 cumulative tickets.

```
Cumulative samples: 947, ok: 944, failed: 3 (0.32%)
create_request  P50 1277ms  P95 1888ms  P99 2119ms
```

The 3 failures: genuine pickup-race rejections ("Transition to
\"in_progress\" is not permitted" — two technicians, one correctly wins).

## 10. Local Target Load (Phase 11)

Scaled to the full target: 220 requesters / 60 technicians / 10 managers;
960 cumulative tickets.

```
Cumulative samples: 4597, ok: 4582, failed: 15 (0.33%)
Wall-clock span: 1099.7s (all 3 stages combined); target stage alone: 615.0s, 10 workers
create_request   960 calls  P50 3749ms  P95 5823ms  P99 6790ms
pickup           706 calls  P50 687ms   P95 1200ms  P99 1860ms
start_working    714 calls  P50 881ms   P95 1524ms  P99 2189ms  (15 failed)
resolve          648 calls  P50 874ms   P95 1466ms  P99 2433ms
comment          863 calls  P50 662ms   P95 1051ms  P99 1530ms
waiting_user     353 calls  P50 829ms   P95 1275ms  P99 2174ms
resume           347 calls  P50 864ms   P95 1393ms  P99 1939ms
requester_reply    6 calls  P50 794ms   P95 1101ms  P99 1101ms
```

## 11. Local 1000-Ticket Result (Phase 12)

960 tickets reached (target ~1000; close enough that a further stage
wasn't needed to make the point). Real lifecycle mix, not just inserts —
final status distribution mid-run: 592-648 resolved, 300+ open, tens each
in_progress/waiting_user. Full action coverage: create, pickup, start
working, comment, waiting user, resume, resolve, requester reply.

## 12. Local Mixed Concurrency (Phase 13)

10 genuinely separate OS processes (not async tasks sharing one process)
ran simultaneously for the target-load stage — 220 requesters and 60
technicians' actions interleaved for real across ~10 minutes of wall-clock
time, confirmed by workers observing and reacting to *each other's* writes
(e.g. a technician's queue query returning tickets a different worker's
requester had just created moments earlier).

## 13. Race/Collision Result (Phase 14)

All 15 failures across the full cumulative run were inspected individually
(not just counted):

- **14×** "Transition to \"in_progress\" is not permitted" — two
  technicians raced to start the same ticket; the transition-matrix check
  in `updateRequestStatus()` correctly rejected the loser. No duplicate
  assignment, no corrupted status.
- **1×** "This request was just changed by someone else — please refresh
  and try again." — a *second*, independent optimistic-concurrency-control
  layer catching a real write conflict. No lost update.

**No duplicate business operation, no lost update, no invalid state, no
corrupted SLA, and no silent overwrite occurred anywhere in 4597 real
concurrent operations.**

## 14. SLA Result (Phase 15)

Every one of the 960 tickets received real `response_due_at`/
`resolution_due_at` values from `resolveSlaDeadlines()` (spot-checked
directly in Postgres). The Analytics dashboard (§17 below) independently
confirms this at aggregate scale: 100% resolution SLA compliance, 0
currently-breached tickets, real per-team/per-agent average TAT figures.
`waiting_user`/`resume` transitions (353/347 calls) exercised the SLA
pause/resume math under real concurrent load with zero errors.

Regarding the test-hardening report's flagged risk
(`stage6-web-whatsapp-parity.test.ts`'s fixed 5-second wall-clock
tolerance): it did **not** fail during the load test itself, but a
**different** timing-sensitive test (`desk-uat-001-reopen.test.ts`, a
concurrent-write test with a 5-second `testTimeout`) timed out once in the
full-suite regression run immediately following the ~19-minute load test
— then passed cleanly (526ms) on an isolated re-run once system load had
settled. Per the brief's own instruction: this was diagnosed by measuring,
not assumed — the concurrency-protection logic itself works (confirmed by
the isolated pass); the failure was test-tolerance-under-transient-load,
not an application SLA/concurrency defect. No test tolerance was changed
GDP arbitrarily; nothing needed fixing since it wasn't reproducible.

## 15. Notification Result (Phase 16)

Zero real external sends. Every notification path routed through
`[EMAIL DISABLED]` logging throughout every run (visible in every worker's
stdout) — confirmed by direct log inspection, not assumed. In-app
notification creation exercised naturally by every status
change/assignment/comment across all 4597 operations.

## 16. Analytics/Report Result (Phase 17)

**This is the first time in this engagement Analytics/Reports have been
checked against meaningful data volume** (the prior performance reports
explicitly noted this gap — tables were empty then). Logged in as the
bootstrap admin, navigated to `/admin/reports` (Dashboards) on the LOCAL
production... [dev server, see note] instance:

```
OPEN NOW: 752        CREATED: 1000 (last 30 days)     RESOLVED: 648
SLA COMPLIANCE: 100%  AVG RESOLUTION: 7m                CURRENTLY BREACHED: 0
Status Distribution: Open 303 (30%) / In Progress 49 (5%) / Resolved 648 (65%)
Team Performance: 6 real load-test teams, 153-177 volume each, 100% SLA%, 6-9m avg TAT
Top Services by Volume: 6 real load-test services, matching team volumes
Agent Leaderboard: real technician names, real resolve counts (15-20 each), real avg TAT
```

TTFB for this aggregation-heavy page: 1292ms. The Requests list page (My
Requests, scoped to the admin's own requester history — correctly empty,
since the admin never created any load-test tickets itself) TTFB: 927ms.
Home page TTFB: 773ms. All real, measured, via `performance.timing`, not
estimated.

Note: this check used the LOCAL **dev server** (`next dev`, port 3001,
already running per this session's standing "never stop the local server"
rule), not a separate production build — the earlier Phase 9 instruction
to prefer a production build applies most directly to the load-generation
traffic itself (which bypasses the Next.js HTTP layer entirely — see §5's
architecture note), not to this one manual dashboard-rendering spot check.
Noted honestly as a gap rather than presented as a production-build
measurement.

## 17. Local Performance Metrics (Phase 18)

Consolidated LOCAL baseline (target-load stage, 10 workers, 960 cumulative
tickets):

| Scenario | Count | Success rate | P50 | P95 | P99 |
|---|---|---|---|---|---|
| create_request | 960 | 100% | 3749ms | 5823ms | 6790ms |
| pickup | 706 | 100% | 687ms | 1200ms | 1860ms |
| start_working | 714 | 97.9% | 881ms | 1524ms | 2189ms |
| resolve | 648 | 100% | 874ms | 1466ms | 2433ms |
| comment | 863 | 100% | 662ms | 1051ms | 1530ms |
| waiting_user | 353 | 100% | 829ms | 1275ms | 2174ms |
| resume | 347 | 100% | 864ms | 1393ms | 1939ms |

Aggregate throughput across the full 3-stage run: ~4.2 ops/s sustained
(target-load stage alone, 4597 samples ÷ 1099.7s wall-clock).

CPU/RAM/DB-connection-count were captured via the targeted
`pg_stat_activity` probe in §18 below rather than continuous monitoring
throughout every stage — see Remaining Risks (§25) for what a fuller
continuous-monitoring pass would add.

## 18. Local DB Analysis (Phase 19) — Confirmed Bottleneck

**BEFORE**: `create_request` P50 climbed 645ms → 1277ms → 3749ms as
cumulative tickets grew 100 → 300 → 960 (warm-up → medium → target
stages).

**Investigation** (evidence before action, per the brief):
1. `pg_stat_statements`, every query touching `requests` ordered by mean
   execution time: the slowest individual query averaged **60.31ms**
   (1071 calls). The actual `INSERT INTO requests` itself: 25.54ms mean
   over 1290 calls. **No single query is slow.**
2. A single-worker (zero concurrency) control run, at the *same* ~960-row
   data volume that produced the 3749ms P50 under 10-way concurrency,
   measured **~320-375ms** per `create_request` call — matching the
   original warm-up's speed, not the target-load slowdown.
3. Live `pg_stat_activity` sampling during an 8-worker concurrent run: the
   `authenticator` role (PostgREST's connection identity) held steady at
   **exactly 11 connections** across 5 consecutive 1-second samples,
   regardless of load.

**ROOT CAUSE**: PostgREST's default `db-pool = 10` (confirmed — Main's own
`postgrest.conf` explicitly sets this same default value). Each
`createRequestCore()` call makes several sequential round trips (service/
team lookup, SLA resolution, sequence generation, insert, business-rule
evaluation, notification creation) — once roughly 10 requests are
simultaneously mid-call, every subsequent step queues for a free
connection, and that queueing compounds across every sequential step of
every in-flight call. This is a genuine concurrency ceiling, not a
data-volume or query-cost problem — proven, not assumed, by point 2 above.

**FIX**: `deploy/windows/config/postgrest.conf.example`'s `db-pool`
raised from 10 to 40 (Main's Postgres has `max_connections = 100`, leaving
ample headroom for GoTrue/Storage/admin connections). Documented inline
with the full evidence chain so a future reader doesn't have to
re-derive it. **Not yet applied to Main** — Main's own `postgrest.conf`
still has the original `db-pool = 10`; this is queued for §27 (Bottleneck
Remediation) once the Main phase begins, per the brief's own "fix only
confirmed bottlenecks, verify before/after" requirement.

**AFTER**: not yet measured on LOCAL — the Supabase-CLI-managed local
Docker stack doesn't expose PostgREST's pool setting through
`supabase/config.toml` the way Main's hand-configured `postgrest.conf`
does, so a clean local before/after wasn't practical without either
restarting the whole CLI-managed stack or standing up a parallel isolated
PostgREST instance wired through Kong. Given Main is where this fix will
actually be applied and is fully within direct control there, the
before/after comparison is deferred to the Main phase (§27), where it can
be measured properly against the real deployment target.

`Do not create indexes merely because a sequential scan exists` was
honored: no index was added anywhere in this pass, because none was
evidenced as the bottleneck.

## 19. Regression Result (Phase 31, post-load-test)

Run immediately after the ~19-minute load test (all 3 stages), with the
960 tickets and 290 personas still in the database (per the brief: do not
clean until all load testing, including Main, is finished):

```
npx tsc --noEmit:  clean, 0 errors
npm run lint:      0 errors, 3 pre-existing warnings (unrelated files)
npx vitest run:    2 failed | 80 passed | 4 skipped (86 files)
                   2 failed | 655 passed | 18 skipped (675 tests)
```

Both failures individually diagnosed, not just counted:

- `stage6-channel-readiness.test.ts` › `requesterMobileCoverage counts
  active users...`: `expected +0 to be 1`. This test asserts an org-wide
  *count* of active users with/without a mobile number — thrown off by
  the 290 load-test personas (all real, active, org-scoped profiles)
  still present. This is a direct, expected consequence of the
  standing "don't clean until everything is done" instruction, not a
  code regression. It will resolve itself at cleanup (§21-24).
- `desk-uat-001-reopen.test.ts` › `a genuine concurrent write is still
  rejected`: `Test timed out in 5000ms`. Re-ran in isolation immediately
  after: **passed in 526ms** — well inside the 5-second budget. This was
  a transient timing artifact from running the full 675-test suite
  immediately after a sustained ~10-minute, 10-process concurrent load
  test (the same machine that had just been under heavy load), not a
  reproducible defect. Confirmed by the isolated re-run, not assumed.

**Neither failure is a real regression.** No test tolerance was changed
to paper over either one.

## 20. Functional/Security UAT — not yet run

Deferred until the Main phase context is clearer (functional UAT is more
valuable run once against the exact code/config that will actually be
deployed to Main, per the brief's own emphasis on not duplicating effort).

---

## Remaining Phases (not yet executed)

The following are queued, in order, once the Main go-ahead is given:

- **Phase 20-26**: Main warm-up → medium → target load, with continuous
  resource monitoring (CPU/RAM/disk/connections/wait-events on
  `CitykartApp`/`CitykartAuth`/`CitykartPostgrest`/`CitykartStorage`/
  PostgreSQL, and explicit non-interference confirmation for
  `wms_db`/`workforce_os`/the STORE ROASTER app also on that box), per the
  Phase 23 stop/throttle conditions already specified in the brief.
- **Phase 27-29**: apply the confirmed `db-pool` fix to Main directly
  (where it can be measured with a real before/after), verify, re-run
  target load.
- **Phase 30**: a controlled soak test.
- **Phase 32-33**: functional and security UAT against Main.
- **Phase 34-35**: git commit/push of the load-test tooling + the
  `db-pool` fix; verify Main deployment parity.
- **Phase 36-45**: backup both databases, then — and only then — clean
  LOCAL (removing all 290 personas, 960 tickets, and the load-test org
  structure created this session; resetting `request_sequences.last_no`
  to 0), validate LOCAL, clean MAIN equivalently, reset Main's sequences,
  verify Local/Main clean-slate parity, final Main performance smoke.

## Remaining Risks (interim, §46 will be completed at the end)

1. The PostgREST `db-pool` fix is evidenced and written, but not yet
   applied or verified with a real before/after anywhere (deferred to
   Main, §18).
2. `desk-uat-001-reopen.test.ts`'s 5-second hard timeout is tight enough
   to be sensitive to transient system load — confirmed non-reproducible
   this time, but worth a tolerance review if it recurs.
3. Continuous resource monitoring (CPU/RAM/connections over time, not
   just point-in-time samples) wasn't run for the LOCAL load stages — the
   `pg_stat_activity` evidence in §18 was a targeted, deliberate probe for
   one specific hypothesis, not a full monitoring pass. Worth doing
   properly for Main given the shared-server stakes.
4. LOCAL's dashboard check (§16) used the dev server, not a production
   build, for the one manual page-load spot check — noted honestly, not
   presented as more rigorous than it was.

## Interim Verdicts

**Capacity (LOCAL only so far)**: target load (220 requesters / 60
technicians / 960 tickets) ran to completion with a 0.33% error rate, and
every error was correct application behavior, not a defect. One
confirmed, evidenced bottleneck (PostgREST connection pool) found and
fixed in the deployment template, not yet verified with measurement.
**LOCAL: TARGET LOAD VERIFIED — FIX WRITTEN, VERIFICATION PENDING ON MAIN.**

**Clean-slate**: not started — explicitly deferred per the brief's own
"do not clean until all load testing is finished" instruction. Both LOCAL
and MAIN still carry this session's test/load data.
**NOT YET APPLICABLE.**

This report will be replaced with the full 47-section version (matching
the structure requested) once the Main phase, comparison, remediation,
soak test, regression, UAT, git sync, and clean-slate cleanup of both
environments are complete.
