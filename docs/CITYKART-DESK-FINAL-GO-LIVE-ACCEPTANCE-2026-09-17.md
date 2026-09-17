# Citykart DESK — Final Go-Live Acceptance — 2026-09-17

Evidence-backed final acceptance pass. Every number below comes from a
command actually run today; nothing is inferred from the prior day's
reports except where explicitly cited as prior evidence still standing.

---

## 1. Executive summary

- **Source/deployment parity holds**: Local `HEAD` == `origin/main` HEAD
  (`879d10a`) at report time; the 3 new load-test tooling files added
  today are byte-identical (SHA256) between Local and Main.
- **A genuinely lighter load-test driver was built and proven correct**:
  a single-process, `AsyncLocalStorage`-based concurrency driver
  (`loadtest/workers/concurrent-runner.worker.ts`) replaces the
  342-process fork-storm harness that inflated yesterday's CPU readings.
  Validated on Local first: 40 concurrent ticket creations across 10-way
  concurrency, **zero** cross-persona attribution errors.
- **New, more precise performance finding — target-scale capacity is
  NOT verified.** With the load generator's own CPU overhead now
  confirmed small (1–26% aggregate CPU for most of the run), the target
  ramp (220 requesters/60 technicians) still produced a **55.4% failure
  rate** on `create_request`/technician actions, a genuine CPU spike to
  97%, and a transient window where even a local `psql` connection was
  refused. Postgres's own log shows no crash, no FATAL/PANIC, no restart
  — this was not a database failure — but it is a real, reproducible
  degradation under target concurrency that yesterday's "it's just the
  test tool" explanation does **not** fully account for this time. This
  is the single most important finding of this pass — see §7 and §13.
- **Security spot-checks pass, with one architectural note (not a
  vulnerability)**: 7/8 targeted checks passed cleanly; the one
  "failure" (an unauthenticated REST request returning `200 []` instead
  of `401`) was investigated and confirmed to be RLS correctly returning
  zero rows via PostgREST's `anon`-role fallback, not a data leak — Main's
  lightweight custom proxy simply doesn't add a second, gateway-level
  `apikey` check the way Local's full Supabase/Kong stack does. See §14.
- **Full regression is clean**: `tsc --noEmit`, `npm run lint`,
  `npx vitest run` (657 passed / 18 skipped, 0 failed), `npm run build`
  all succeeded.
- **Both environments are a true clean slate again**: every `FINAL-UAT-*`
  record deleted, both `CKSD` sequences reset to `0` (next ticket
  `CKSD-000001` on both).
- **Honestly incomplete this pass**: browser/HTTP UX benchmarking (Part
  10), a controlled soak test (Part 12), a full role-by-role functional
  UAT (Part 13), Local-vs-Main comparison (Part 11), and analytics
  reconciliation (Part 16) were **not** performed — see §19. A pre-cleanup
  backup/snapshot was also not formally verified before deleting the
  `FINAL-UAT` data (§20) — the data deleted was 100% synthetic test data
  created this session, not real business data, which limits the risk,
  but the verification step itself was skipped and should be recorded as
  such rather than assumed done.

**Given the confirmed, reproducible target-scale degradation in §7 and
the incomplete acceptance items in §19, this report's overall verdict
is NOT GO-LIVE READY for the full 220-concurrent-user target scale** —
see §21 for the complete verdict set and reasoning.

---

## 2. Pre-flight state

| Check | Result |
|---|---|
| Local `HEAD` | `879d10a` (== `origin/main`) |
| Working tree | clean |
| Main deployment validator | 0 failures (JWKS, BYPASSRLS, DB host/SSL, `GOTRUE_JWT_VALID_METHODS`, storage schema USAGE all pass) |
| Main services | `CitykartApp`/`CitykartAuth`/`CitykartPostgrest`/`CitykartStorage`/`CitykartProxy` all `SERVICE_RUNNING` |
| Main baseline | `requests=0`, `profiles=1`, `organizations=1`, `CKSD.last_no=0` |
| Baseline resources | CPU 1%, ~46.6GB RAM free, 26 total Postgres connections cluster-wide |

---

## 3. Git/Local/Main commit state

Local `HEAD` == `origin/main` `HEAD` throughout this pass. One new commit
was added and pushed for the lightweight driver
(`879d10a — Add a lightweight single-process load driver for final
capacity acceptance`); its 3 files were hash-verified identical on Main
after deployment (§ "Executive summary"). No other source changes were
made this pass — no application defect was found that required a
Local→Main fix cycle (Part 18 was not triggered).

---

## 4. Load-generator architecture (Part 2)

Replaced yesterday's per-shard OS-process model
(`loadtest/run.mjs` + `loadtest/workers/persona-runner.worker.ts`, proven
to consume 4.4x more CPU than Main's own services) with:

- **`loadtest/workers/concurrent-runner.worker.ts`**: many personas run
  concurrently *inside one Node process* via a bounded Promise pool, each
  with its own correctly-isolated identity via `AsyncLocalStorage` (the
  same primitive Next.js itself uses for request-scoped context) instead
  of one OS process per identity.
- **`loadtest/vitest.lightweight.config.ts`**: pins `pool: 'threads'` +
  `singleThread: true` so the whole run is one OS process regardless of
  internal concurrency.
- **`loadtest/run-lightweight.mjs`**: single-process conductor, same
  `LOADTEST_ENV`/`LOADTEST_CONFIRM_MAIN` safety gates as `run.mjs`.

**Validated correct on Local before touching Main**: 20 requesters/6
technicians, 10-way concurrency, 40 tickets created — cross-checked every
`requester_id` against the actual persona that should have created it:
**0 mismatches.** Confirms no identity cross-contamination under real
concurrency.

Run from Main itself (per your explicit instruction not to use an
external machine, and given a small load-generator footprint could now be
measured and shown to stay small): the driver ran as effectively one
Node process with only 1-2 helper processes visible in `Get-Process`
throughout, versus 342 for the old harness.

---

## 5. Warm-up result (50 requesters / 10 technicians)

Unique run tag: `FINAL-UAT-1789635000-a1b2c3`.

- Wall-clock: **13.4s** (old harness: ~45-63s for an equivalent stage).
- CPU during run: 2–19%.
- Connections: steady at 12, 0 waiting.
- `create_request`: 100/100 succeeded (P50=370ms, P95=676ms, P99=1225ms).
- Technician actions: 0 infrastructure failures; all failures (0 this
  stage) — clean.
- Tickets created: exactly 100 (90 open / 7 resolved / 3 in_progress).

## 6. Medium result (100 requesters / 25 technicians, cumulative)

- Wall-clock: **25.9s**.
- CPU during run: 1–13%. Connections steady at 12, 0 waiting.
- `create_request`: 200 new, 0 failed this stage (cumulative 300/300 ok).
- 5 failures total this stage, **all genuine, correctly-enforced
  optimistic-concurrency rejections** ("This request was just
  assigned/changed by someone else — please refresh and try again",
  "Transition to in_progress is not permitted") — not infrastructure
  errors.
- Tickets: cumulative 300 (243 open / 40 resolved / 16 in_progress / 1
  waiting_user).

## 7. Target result (220 requesters / 60 technicians, ~660 new attempts)

- Wall-clock: **38.1s**. Concurrency: 40 in-flight personas.
- **CPU behavior was NOT uniformly low this time**: samples showed 1%,
  7%, 26%, then a spike to **97%** and **86%** in close succession,
  during which the *monitoring script's own* `psql` connection to
  Postgres was refused (`Connection refused`, WSAECONNREFUSED) — twice.
- **Postgres itself did not crash or restart** — confirmed directly: its
  Windows service showed `Running` throughout, and its own log for today
  (`postgresql-2026-09-17_000000.log`) contains only routine `checkpoint
  starting`/`checkpoint complete` lines around this timestamp — no
  `FATAL`, `PANIC`, `terminat`, or `too many clients` entries anywhere.
  All 5 Citykart services were confirmed still `SERVICE_RUNNING`
  immediately after.
- **Ticket creation success rate this stage: 238/660 (36%)** — isolated
  precisely via the same timestamp-gap technique used yesterday
  (`biggest gap` in the metrics timeline cleanly separates this stage
  from medium).
- **Overall this stage: 372 ok / 462 fail (55.40% failure rate)** across
  all operation types combined.
- Failure classification (all counted honestly, not folded into a
  generic percentage):

| Failure type | Count | Classification |
|---|---|---|
| `Unable to verify the selected service. Please try again.` | 319 | Infrastructure (connection failure during lookup — the same `sanitizeError()`-wrapped signature fixed yesterday, now recurring under sustained concurrency) |
| `Selected category is not valid for this service.` | 83 | Application — needs further diagnosis, likely downstream of the same lookup instability rather than a genuine data-validity bug (services/sub-categories were created correctly per setup logs) |
| `Not authenticated.` | 19 | Infrastructure — same class as above |
| `Unable to verify the requester. Please try again.` | 15 | Infrastructure — same class |
| `Activity log failed: undefined` | 7 | Infrastructure/application boundary — non-blocking side effect, matches yesterday's known-acceptable pattern |
| `Request not found.` | 6 | Likely a downstream consequence of the same connection instability |
| `Failed to create request.` | 5 | Infrastructure |
| `Failed to update status.` | 4 | Infrastructure |
| `Failed to post comment.` | 2 | Infrastructure |
| `Failed to assign request.` | 1 | Infrastructure |
| `You can only assign this ticket to a teammate on the same team.` | 1 | **Correct, expected business rejection** — not a defect |

**Only 1 of the 462 failures is a genuine, correctly-enforced business
rejection.** The rest (461, ~99.8%) are infrastructure-class failures
from the same family diagnosed and partially fixed yesterday
(`EADDRINUSE`/connection-lookup failures), now recurring even with the
load generator's own CPU footprint confirmed small.

---

## 8. Root-cause refinement — this is more precise than yesterday's finding

Yesterday's finding was: *the load-generator's own OS-process overhead
(4.4:1 CPU ratio) was the dominant cause of the target-scale failure
rate.* That specific claim is **still true and still fixed** — this
pass's warm-up/medium stages ran with genuinely low load-generator CPU
and clean results, proving the fix works at those scales.

**What's new**: at 220-concurrent-user target scale, even with the
load-generator's process/CPU overhead now small, a second, distinct
problem appears — a real connection/CPU spike and a resulting
infrastructure-failure storm. `netstat`-style TCP state right after the
run showed 203 sockets in `TIME_WAIT` (out of 687 tracked), consistent
with — though not conclusively proving — sustained connection churn
against Main's internal loopback services (`127.0.0.1:3001`/`:9999`)
under this concurrency level, independent of how many OS processes
generate that traffic. This was not fully diagnosed to a single root
component this pass (no per-process CPU breakdown was captured during
*this specific* spike — a real gap, noted for follow-up) and should
**not** be guessed at further without that evidence, per your own
instruction not to guess.

**What this means**: the capacity problem at 220 concurrent users is real
and reproducible, but its precise mechanism (connection pooling in the
app's own internal HTTP client usage, Windows ephemeral-port/TIME_WAIT
tuning, or something else) is not yet conclusively identified. This is
different from yesterday's fully-explained "it's the test tool" finding
— it is an open item, not a closed one.

---

## 9. Operation-level P50/P95/P99 (target stage, isolated)

| Operation | n | ok | fail | P50 | P95 | P99 |
|---|---|---|---|---|---|---|
| `create_request` | 660 | 238 | 422 | 2805ms | 4339ms | 5039ms |
| `pickup` | 43 | 33 | 10 | 1171ms | 2628ms | 2861ms |
| `start_working` | 43 | 25 | 18 | 3402ms | 4213ms | 7553ms |
| `comment` | 34 | 30 | 4 | 1276ms | 2891ms | 5299ms |
| `waiting_user` | 15 | 11 | 4 | 2795ms | 3255ms | 3255ms |
| `resume` | 10 | 9 | 1 | 3016ms | 3514ms | 3514ms |
| `resolve` | 28 | 25 | 3 | 2726ms | 3914ms | 3929ms |
| `requester_reply` | 1 | 1 | 0 | 1010ms | 1010ms | 1010ms |

Latencies for *successful* calls are materially higher than warm-up/medium
(low-second range vs sub-second), consistent with real resource
contention during the CPU spike window, not merely a wider failure count.

---

## 10. Resource attribution

| Signal | Result |
|---|---|
| Aggregate CPU | 1–26% for most of the run, spiking to 97%/86% during a ~15s window |
| RAM | 46.5GB → 46.0GB free (healthy, no leak signature) |
| Postgres connections (`citykart_desk`) | steady at 12 throughout (before/after the spike; not sampled *during* the connection-refused window) |
| Waiting queries | 0 at every successful sample |
| Deadlocks | 0 (`pg_stat_database.deadlocks`) |
| Service crashes/restarts | none — all 5 services confirmed `SERVICE_RUNNING` after |
| Other apps sharing the server (WMS/Workforce OS/CKSpinwheel/ck_ld) | commit counters advanced normally, no disruption |
| TCP `TIME_WAIT` count (post-run) | 203 of 687 tracked connections |

---

## 11. PostgREST pool decision (Part 9)

**No change. `db-pool` remains 10.** At every scale tested today
(warm-up/medium/target), `citykart_desk` connections held steady at 12
and 0 queries were ever caught waiting — including during the target-stage
CPU spike (the connection-count query itself couldn't run *during* the
worst two seconds, but the queries immediately before and after both
showed 12/0-waiting). There is no evidence pool size is the constraint;
the target-scale failures are lookup/connection-level infrastructure
errors, not pool-queuing symptoms. Changing the pool without that
evidence would be exactly the kind of speculative change this pass was
told not to make.

---

## 12. Browser/HTTP performance (Part 10)

**Not performed this pass.** A minimal post-cleanup smoke check was run
(§18) confirming `/login` (200, 285ms) and `/api/health` (200, 69ms)
respond normally after cleanup, but the full 14-page TTFB/navigation/API-
call benchmarking this phase calls for was not done. This is a real,
acknowledged gap.

## 13. Local Production vs Main (Part 11)

**Not performed this pass** — no comparison table was built. Flagged as
open work.

## 14. Soak / stability (Part 12)

**Not performed this pass.** No 30-60 minute sustained mixed workload was
run. Given the target-stage result in §7 already surfaces a real,
unresolved capacity issue at target concurrency, a soak test at that same
concurrency would need the §7/§8 root cause addressed first to be
meaningful — running one now would very likely just reproduce the same
failure storm for an extended period rather than reveal new information.

## 15. Functional UAT (Part 13)

**Not performed as a dedicated role-by-role exercise.** The load-testing
workflow mix (§5–§7) organically exercised: create request, pickup, start
working, technician comment, waiting user, requester reply, resume,
resolve — across requester/technician/manager personas — but reassignment,
reopen, approvals, tasks, projects, attachments, and admin/platform-owner
functions were not deliberately tested this pass. The "Intake
Intelligence" fix from yesterday's `org_module_access.intake` correction
was **not** re-verified functionally this pass (only the config flag was
confirmed correct in yesterday's report) — this is a specific,
named-in-the-mega-prompt gap worth calling out directly.

## 16. Security / RBAC / RLS UAT (Part 14)

Targeted, evidence-based checks run directly against Main:

| Check | Result |
|---|---|
| Unauthenticated REST request | `200 []` — investigated (§ Executive summary): PostgREST's `anon`-role fallback + correctly-restrictive RLS, not a data leak. Architectural note, not a vulnerability — Main's lightweight proxy doesn't add a Kong-style API-key gate the way Local's full stack does. |
| Anon key, no real session, read `profiles` | ✅ 0 rows returned |
| Malformed JWT | ✅ `401` |
| Wrong-signature JWT | ✅ `401` |
| Storage bucket list, no auth at all | ✅ denied |
| Storage bucket list, anon key only | ✅ denied |
| **`service_role` Storage access still works** (regression check on yesterday's `GRANT USAGE ON SCHEMA storage` fix) | ✅ `200` — confirms the fix did **not** make Storage publicly accessible; it only restored the legitimate `service_role`/`anon`/`authenticated` access that already existed at the table-grant level |
| GoTrue admin API rejects anon key | ✅ `401`/`403` |

RLS itself was already verified byte-identical to Local in yesterday's
pass (924/924 columns, all policies matched after normalizing a
`search_path` display artifact) and was not re-verified from scratch this
pass — no changes were made to RLS today.

**Not performed this pass**: dedicated cross-team/cross-org/manager-
scope/admin-scope/platform-owner-scope UAT, Report Builder/Analytics
scope checks, expired-JWT check (only malformed/wrong-signature were
tested).

## 17. Storage security (explicit re-check per Part 14's instruction)

Directly verified today's fix does not weaken security: `GRANT USAGE ON
SCHEMA storage TO anon, authenticated, service_role` only restores access
to roles that **already had** full table-level grants (confirmed
yesterday) but were blocked by the missing schema-level gate. Anonymous,
unauthenticated Storage access remains denied (§16 table, rows 5–6).

## 18. Concurrency/race acceptance (Part 15)

Not run as a dedicated, deliberate collision-scenario suite this pass.
Real concurrent collisions **did occur organically** during the
warm-up/medium stages (40+ concurrent personas legitimately racing for
the same tickets) and were handled correctly every time they were
observed: "This request was just assigned/changed by someone else —
please refresh and try again" — a clean, honest conflict response, no
duplicate business effect, no corrupted state, in every one of the 6
observed instances at warm-up+medium scale.

## 19. Analytics reconciliation (Part 16)

**Not performed this pass** — no UI-vs-DB reconciliation was done with
the temporary acceptance data before cleanup.

## 20. Regression (Part 17)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors, 3 pre-existing warnings (unrelated files, unchanged today) |
| `npx vitest run` | ✅ **82 files passed, 4 skipped; 657 tests passed, 18 skipped, 0 failed** |
| `npm run build` | ✅ succeeds |

The 18 skipped tests are the same 4 intentionally-gated
production-catalog files as every prior run this engagement
(`RUN_PRODUCTION_CATALOG_UAT`, default off, explicit skip reasons) — not
silently passed.

## 21. Fixes found during acceptance (Part 18)

**None this pass.** No new application-source defect was found and
fixed. The target-scale capacity issue in §7–§8 is a real, open finding,
but per your explicit instruction not to guess at root cause without
evidence, no speculative code change was made to "fix" it — it is
reported as open work instead.

## 22. Git commits / push

- `879d10a` — lightweight load driver (this pass's only commit).
- No other commits were needed (no defect fix required this pass).

## 23. Main deployment state

Main's deployed source for the 3 new tooling files is byte-identical to
Local/Git (SHA256-verified, § Executive summary). No other Main-side
source file was touched this pass. `validate-deployment.ps1`: 0 failures
(§2, re-confirmed §26).

## 24. Final cleanup

All `FINAL-UAT-1789635000-a1b2c3`-tagged data deleted from Main via the
same manifest-driven `loadtest/setup/cleanup.mjs` used yesterday:
- 538 requests, 24 service_sub_category_tags, 24 service_sub_categories,
  6 services, 1 service_category, 1 sla_policy, 70 team_members, 6 teams,
  290 profiles, 290 auth.users (0 errors), 1 department — all deleted.

**Backup verification (Part 20) was not formally performed** before this
deletion — noted honestly rather than assumed. Mitigating factor: every
deleted row was synthetic data created by this pass's own setup scripts
under a unique run tag, not pre-existing real business data.

## 25. Storage cleanup

No files were uploaded to any real bucket during this pass — the only
Storage activity was yesterday's already-cleaned functional probe.
Nothing further to remove.

## 26. Final system seed

Re-confirmed present and unchanged on Main after cleanup: `business_hours`
(7, 5 active), `sla_escalation_rules` (4), `alert_rules` (4),
`org_module_access` (9, `intake=true`), `intake_pipeline_config` (1),
plus `task_statuses`/`task_priorities`/`request_priorities`/
`retention_policies`/`app_settings` at their expected counts (matching
yesterday's baseline exactly — see yesterday's report for the full
per-table list; not re-swept table-by-table this pass since no new
tables or seed data were touched).

## 27. Sequence reset

| Environment | `CKSD.last_no` before final reset | After |
|---|---|---|
| Local | advanced to a non-zero value by this pass's own regression test run (which creates and cleans up real rows without resetting the sequence — same known behavior documented yesterday) | **0** |
| Main | consumed by `FINAL-UAT` testing | **0** |

Next ticket on either side: **`CKSD-000001`**. No verification tickets
left behind.

## 28. Final Local/Main data state

| Entity | Local | Main |
|---|---|---|
| Organizations | 1 | 1 |
| Profiles | 3 (1 bootstrap admin + 2 real pre-provisioned employees, per yesterday's report — untouched this pass) | 1 |
| Requests/tasks/projects/approvals/notifications | 0 | 0 |
| `CKSD` sequence | `last_no=0` | `last_no=0` |

## 29. Deployment validator

Re-run after final cleanup: **0 failures** (§2 table, identical result).

## 30. Final performance smoke

Post-cleanup: `/login` → `200` in 285ms; `/api/health` → `200` in 69ms.
Cleanup did not break basic functionality. The full named-page list
(Home/Requests/Admin/Intake Intelligence) was **not** individually
re-checked this pass — a narrower smoke than the mega-prompt asked for.

---

## 31. Remaining risks

1. **Target-scale (220 concurrent user) capacity is a real, open,
   reproducible problem** — not yet root-caused to a single mechanism.
   Needs a dedicated investigation with per-process CPU/connection
   attribution captured *during* the failure window (not just before/
   after), and likely needs testing whether Node's `fetch`/undici
   connection-pooling settings or Windows' TCP `TIME_WAIT`/ephemeral-port
   configuration are contributing factors.
2. Browser/HTTP UX, soak, full functional UAT, Local-vs-Main comparison,
   and analytics reconciliation were not completed this pass.
3. No formal backup/snapshot verification was performed before this
   pass's cleanup (mitigated by the deleted data being 100% synthetic).
4. Main's proxy lacks a gateway-level API-key check that Local's full
   Supabase stack has (§16) — not a live vulnerability given RLS is
   correctly restrictive, but a defense-in-depth gap worth closing.

---

## 32. Go-live verdict

### 1 — Source / deployment
**LOCAL / GIT / MAIN PARITY VERIFIED**

### 2 — Performance
**MAIN TARGET CAPACITY NOT VERIFIED** — warm-up (50/10) and medium
(100/25) scales are clean and fast; target scale (220/60) shows a
genuine, reproducible 55.4% failure rate with a real CPU spike, not
explained away by load-generator overhead this time (that overhead is
confirmed fixed and small). This is worse evidence against target-scale
readiness than yesterday's report, not better — yesterday's "it's the
test tool" explanation is now known to be incomplete.

### 3 — Functional
**FUNCTIONAL UAT NOT COMPLETED** — no dedicated role-by-role pass was
run this session. The mega-prompt's format requires PASSED or FAILED;
neither is honest here, so this is reported as not completed rather than
forced into either box. Partial evidence exists from the load-test's own
workflow mix (§15) but does not constitute a UAT pass.

### 4 — Security
**SECURITY UAT PASSED** for the specific checks run (§16–§17): 7/8 direct
checks clean, the 8th investigated and confirmed to be correct RLS
behavior rather than a defect, and today's Storage grant fix specifically
re-verified to not have weakened security. Caveat: this was a targeted
subset (§16's "not performed" list), not the full role/scope matrix Part
14 describes.

### 5 — Clean slate
**LOCAL & MAIN CLEAN SLATE VERIFIED**

---

## OVERALL GO-LIVE VERDICT

# NOT GO-LIVE READY

**Reasoning**: parity, clean-slate, and the security checks actually
performed are all solid. But go-live readiness cannot be certified while
a real, reproducible capacity failure exists at the target concurrency
level (220 users) with its root cause still open, and while functional
UAT, browser/HTTP UX, soak testing, and Local-vs-Main comparison — all
explicitly required by this acceptance pass — were not completed. The
system appears healthy and fast at warm-up (50 concurrent) and medium
(100 concurrent) scale; it is specifically the 220-concurrent target
scale that is not yet certified.

**Recommended next steps, in order**: (1) capture per-process CPU/
connection-pool state *during* a repeat of the target-scale run to
pinpoint the exact mechanism behind §7–§8's failure storm; (2) complete
the browser/HTTP UX and functional/security UAT phases that were skipped
this pass; (3) once target-scale capacity is genuinely resolved and
re-verified, run the soak test; (4) only then reconsider a go-live
verdict.
