# Citykart Desk — Local vs Main Performance Investigation

**Date:** 2026-09-16
**Scope:** Why the app feels slower on the live server (`10.0.1.12`, called "Main"
below) than on the local dev machine ("Local"), and what was actually fixed.

This report only documents things that were actually measured this session.
Where a phase of investigation wasn't completed, it's marked as such rather
than filled in with a plausible-sounding guess.

---

## 1. Executive Summary

Three real, independent, confirmed root causes were found and fixed. None of
them were application business logic — all three were either connection
configuration or a front-end navigation default fighting the deployment's
resource constraints:

| # | Root cause | Classification | Evidence | Fix | Measured effect |
|---|---|---|---|---|---|
| 1 | `service_role` Postgres role was missing `BYPASSRLS` | RLS / DEPLOYMENT CONFIG | Direct writes via `createAdminClient()` returned HTTP 200 but updated 0 rows; confirmed via `pg_roles.rolbypassrls = false` | `ALTER ROLE service_role BYPASSRLS` (+ made the setup script self-correcting) | Admin writes (bulk import role/department fields) went from silently no-op to actually persisting |
| 2 | GoTrue/PostgREST connection strings used `localhost` with no `sslmode` | NETWORK / DATABASE CONFIGURATION | `Test-NetConnection localhost:5432` = 768ms vs `127.0.0.1:5432` = 14ms (measured, repeatable) | Changed to `127.0.0.1` + `sslmode=disable` in both configs | GoTrue login/create-user: **1.1–1.3s → 550–650ms per call** (measured before/after, 5-6 samples each) |
| 3 | Every persistent nav link (`Sidebar`, `MobileNav`, `AppShell` logo/profile, `NotificationBell`) used a bare `<Link>` with Next.js's default prefetch-on-viewport behavior | APPLICATION CODE / FRONTEND | GoTrue's own access log showed **54** `GET /user` calls for a single page navigation, on a database with zero data rows | `prefetch={false}` on all of them | Same navigation: **54 → 7** GoTrue calls; page TTFB **2479ms → 1692ms** (measured before/after on the same route, same account, same idle-CPU moment) |

**Current state:** genuinely faster than at the start of this investigation —
verified with real before/after numbers, not a feeling. **Not yet as fast as
Local feels.** Local's apparent speed is not a fair baseline (see §2) — it
runs in Next.js dev mode, not a production build, so a literal number-vs-number
comparison between the two as they stand would be misleading. The honest
verdict is below in §11.

---

## 2. Important caveat on the Local vs Main comparison

Local runs `next dev` (Turbopack, unbundled, uncompiled-per-route, extra dev
instrumentation). Main runs a real production build (`next build` +
`node .next/standalone/server.js`). These are not the same execution mode,
and comparing their raw response times head-to-head would be comparing two
different things. Where a number is given for both sides below, that's noted
explicitly; where only Main's number is meaningful, Local is marked N/A-dev.

---

## 3. Phase-by-phase findings

### Phase 1 — Performance baseline

Only one route was actually measured with before/after rigor this session:
`/requests` (list page, empty dataset both sides after cleanup).

| Metric | Main, before fixes | Main, after fixes |
|---|---|---|
| TTFB | 2479ms | 1692ms |
| GoTrue calls for this one navigation | 54 | 7 |

Other routes named in the requested test matrix (Home, Team Queue, Request
Detail, Service Catalog, Tasks, Projects, Approvals, Notifications,
Analytics, Monitoring, Report Builder, User Management, Org Structure,
Business Rules) were **not each individually re-measured with P50/P95/P99**
this session — that would need a proper load-testing pass (e.g. k6 or
autocannon hitting each route N times), which wasn't run. What we do have,
from earlier in this session's bulk-scale testing, is real endpoint-level
timing for the two GoTrue operations every authenticated request depends on:

| Endpoint | Before | After |
|---|---|---|
| `POST /token` (login) | ~950–1090ms | ~550–650ms |
| `POST /admin/users` (bulk create, 60 rows) | 1180ms/row avg | 506ms/row avg |
| `GET /user` (session check) | up to 3.2–4.7s (seen in a pre-existing access log before any fix) | ~600–720ms |
| `GET /health` (no DB, no bcrypt) | ~20ms | ~20ms (unchanged, confirms the above weren't CPU/bcrypt-bound) |

### Phase 2 — Environment comparison

| Item | Local | Main | Same? | Risk |
|---|---|---|---|---|
| Node.js | v20.20.2 | v24.20.0 | No | Low — no known incompatibility hit; worth pinning eventually |
| npm | 10.8.2 | 11.19.0 | No | Low |
| Next.js | 16.2.9 (package.json) | 16.2.9 (same source tree, `git archive HEAD`) | Yes | — |
| React | 19.2.4 | same | Yes | — |
| Execution mode | `next dev` (Turbopack) | `next build` + standalone `server.js` | **No — expected and correct** | Not a bug; see §2 |
| NODE_ENV | dev implicit | `production` (explicit, verified) | — | — |
| Deployment source | working tree | `git archive HEAD`, byte-identical to a specific commit | — | — |

`package-lock.json` itself was not independently diffed against Main's
installed `node_modules` tree this session (Main was provisioned via
`npm install` from the same `package-lock.json` at deploy time, not
re-verified today). No dependency-drift symptoms were observed in testing.

### Phase 3 — Build comparison

Confirmed Main is running a real production build, not dev mode:
- `.next/standalone/server.js`, launched via NSSM as a Windows Service.
- `npm run build` output showed the full static/dynamic route table (53
  routes) with no errors on every rebuild this session.
- Git commit deployed: matches `origin/main` HEAD at time of each deploy
  (`e4455ad` as of this report — the prefetch fix is what's currently live).

### Phase 4 — Environment variables

Checked presence/purpose only, no values reproduced here:

| Variable | Local | Main | Note |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | points at local Supabase CLI stack (`127.0.0.1:56321`) | points at Main's own reverse proxy (`10.0.1.12:8443`) | Both correctly self-referential, not cross-pointing at each other |
| `SUPABASE_SERVICE_ROLE_KEY` | present | present | Different keys, as expected (different JWT secret per environment) |
| `NODE_ENV` | unset (dev default) | `production` | Correct |
| Postgres host | Docker container, same machine | native Windows Postgres 18, same machine as the app | Both are same-box, not cross-network (see Phase 5) |
| `CRON_SECRET` | not checked this session | present (set during original deployment) | — |

No sign of Main accidentally pointing at a remote/wrong service — both
environments' Supabase URL points at their own local stack.

### Phase 5 — Network topology

**App and Postgres are on the same physical machine on both Local and Main.**
This was the single most important thing to rule out per the request's own
framing, and it's ruled out: there is no cross-machine network hop for
database traffic in either environment.

- Local: Next.js dev process → Docker-networked Supabase Postgres, both on
  this dev machine.
- Main: Next.js standalone process → native Windows PostgreSQL 18, both on
  `10.0.1.12`. Confirmed via `Test-NetConnection` and direct `psql` timing —
  see root cause #2 above. The *within-box* connection string was still slow
  (768ms for a `localhost`-resolved connection) purely from Windows' IPv6-
  before-IPv4 DNS fallback — not a real network hop, a resolution artifact.

### Phase 6 — PostgreSQL version/configuration

| Item | Local | Main |
|---|---|---|
| Version | PostgreSQL 17.6 (Linux, Docker) | PostgreSQL 18.6 (native Windows) |
| `sslmode` in app's connection strings (before fix) | not applicable (Supabase CLI stack handles this) | unset → driver default negotiation attempted |

Deeper config (`shared_buffers`, `work_mem`, `effective_cache_size`,
`max_parallel_workers`, WAL/checkpoint settings, `statement_timeout`, etc.)
was **not compared this session** — Main's `postgresql.conf` was not pulled
and diffed against Local's. This is a real gap in the investigation; flagged
in §12 as follow-up, not fabricated here.

### Phase 7 — Schema/migration parity

Already established earlier in this engagement (not re-verified again this
turn): both environments are on the same 141-migration set, applied from the
same `supabase/migrations/` tree, with the same resulting schema (Local was
confirmed migration-by-migration; Main was rebuilt from a clean slate using
the identical migration files). No schema drift is known between them.

A full **index-by-index diff** was **not performed this session** — flagged
in §12.

### Phase 8 — Data volume

Both environments are currently near-empty by design — this session's own
bulk-test data (1000 requests, 60 users, org-structure) was created and then
fully deleted from both Local and Main as part of the testing/cleanup
workflow the user required. At the time of the TTFB measurements in §1,
**both** environments had 0 rows in `requests`. This means the ~1.7s
remaining TTFB on Main is **not** explained by Main having more data than
Local — it reproduces on an empty table. Whatever remains (see §11) is
latency-per-round-trip, not query cost against a larger dataset.

### Phase 9 — EXPLAIN ANALYZE

**Not performed this session.** With `requests` empty on both sides right
now, there's no realistic query plan to analyze — this needs to be done
after real production data accumulates, not against an empty table. Flagged
as follow-up.

### Phase 10 — Database statistics (vacuum/analyze staleness)

**Not checked this session.** Given both tables are freshly emptied, stale
statistics are unlikely to be a current factor, but this wasn't verified via
`pg_stat_user_tables`.

### Phase 11 — Connection pooling

Checked and tuned on Main's GoTrue: added explicit `GOTRUE_DB_MAX_POOL_SIZE=10`
and `GOTRUE_DB_CONN_MAX_LIFETIME=1h` (matching PostgREST's existing
`db-pool = 10`). **Measured no change** from this alone — pool sizing was not
the bottleneck, the per-request connection cost (root cause #2) was. Kept
the explicit settings anyway since they're harmless and remove ambiguity for
future tuning.

`pg_stat_activity` was polled at 100ms resolution during a live GoTrue
request and **never once caught an active query from GoTrue's role** during
a ~800ms call — consistent with the cost being connection/round-trip
overhead rather than query execution time inside Postgres itself.

### Phase 12 — Slow query identification (`pg_stat_statements`)

**Not available/not queried this session** — would need the extension
confirmed installed and enabled on Main, which wasn't checked. Follow-up.

### Phase 13 — N+1 / sequential query analysis

This is where the biggest, most concrete finding of the session lives (root
cause #3): not a classic N+1 over *data rows*, but an N+1-shaped problem over
*navigation links* — every render of the persistent sidebar (~25 items)
caused Next.js to prefetch that many routes in the background, each running
a real server-side auth check. Confirmed via GoTrue's own access log
(54 calls → 7 after the fix, same route, same account).

`getCurrentProfile()` itself was already correctly deduplicated per-request
via React's `cache()`, with a fast path (`x-verified-user-id` header from
middleware) specifically designed to avoid a second `auth.getUser()` network
round-trip. That mechanism was not the bug — the bug was upstream of it,
in how many *separate* requests were being generated in the first place.

### Phase 14 — RLS performance

Root cause #1 (`service_role` missing `BYPASSRLS`) is the RLS finding for
this session. Once fixed, admin-role queries correctly bypass RLS entirely,
which is both correctness-critical (writes were silently failing before) and
a performance improvement (no RLS predicate evaluation for service-role
queries, which was never actually happening at scale before since the
writes were mostly failing to update the target rows).

A row-by-row audit of `authenticated`/`anon`-role RLS policies for expensive
subqueries or unindexed predicates was **not performed this session**.

### Phase 15 — Index audit

**Not performed against evidence this session** (no slow query log/EXPLAIN
output exists yet to justify any specific index — see Phase 9). Not
speculatively adding indexes, per the instruction not to guess.

### Phase 16 — Server resource analysis

Main is a Windows Server 2022 box, 14 logical cores, shared with two other
production databases (`wms_db`, `workforce_os`) and — discovered earlier in
this engagement — an unrelated Python/FastAPI app ("STORE ROASTER") that
periodically consumes significant CPU. At the moment of this session's final
measurements, CPU was idle (1.3%), meaning the ~1.7s TTFB currently
reproduces **without** that contention — it is not solely an artifact of a
noisy neighbor. Earlier in this engagement, under contention, bulk operations
ran roughly 5x slower (1.2s/row vs ~230ms/row on an unloaded machine) — that
effect is real, separate, and larger than anything fixed today, but it comes
and goes with the other app's load rather than being constant.

### Phase 17 — Docker/container configuration

Not applicable to Main (native Windows Services, no containers). Local's
Supabase stack is Docker-based (Supabase CLI) — not relevant to Main's
performance.

### Phase 18 — Caching

Not audited this session for `fetch` cache directives / `revalidatePath`
usage across the app's data-fetching code. Flagged as follow-up.

### Phase 19 — Reverse proxy

Main's reverse proxy (`deploy/windows/proxy/server.js`, a small custom Node
`http` proxy fronting Auth/PostgREST/Storage) was already fixed earlier in
this engagement for a related issue (disabled keep-alive reuse to avoid
stale-connection resets). It was not the source of today's findings —
`profileUpdate` calls through the same proxy to PostgREST were consistently
fast (6–10ms) throughout, which is what first indicated the problem was
specific to GoTrue, not the proxy layer.

### Phase 20 — Static asset delivery

Not audited this session.

### Phase 21 — Frontend render performance

Not audited this session, and per the instruction, deliberately not
guessed at ahead of proving server/network time is not still the dominant
factor — it currently still is (§11).

### Phase 22 — Library/dependency differences

See Phase 2. `npm ls` diff between environments and native-module
architecture checks were not performed this session.

### Phase 23 — Logging overhead

Not audited for excessive `console.log` volume in request-path code this
session.

### Phase 24 — Auth/session overhead

This is root cause #3, covered in Phase 13 above in full.

---

## 11. Final performance verdict

**PERFORMANCE IMPROVED — FURTHER WORK REQUIRED**

Three real, confirmed, fixed root causes; both TTFB and GoTrue call volume
measurably improved on the same route/account/idle-CPU conditions. The
gap to "feels as fast as Local" is not fully closed, and per §2, Local's dev
mode makes that specific comparison unfair anyway — the more honest target
is "Main should feel fast in absolute terms," and at ~1.7s TTFB for a list
page, it is better but not yet fully there.

Most likely remaining contributors, in rough order of suspicion, **none
independently proven** this session:
1. The 7 remaining GoTrue calls per page are still real, and each still
   costs ~550–650ms if not parallelized — worth tracing exactly which 7 and
   whether any can be eliminated or made concurrent.
2. Windows loopback TCP round-trip cost, compounding across whatever
   sequential DB calls the page's own data-fetching does (separate from
   GoTrue) — plausible, not packet-traced.
3. Unaudited RLS policy cost on `authenticated`-role queries (Phase 14).
4. Frontend render cost (Phase 21) — not yet separated from server/network
   time, so not yet worth optimizing per the instruction's own guidance.

## 12. Recommended next steps, in priority order

1. Identify the remaining 7 GoTrue calls per page load (repeat the access-log
   trace from Phase 13, this time capturing the calling stack/referer) and
   determine if any are avoidable.
2. Pull Main's `postgresql.conf` and diff key settings against Local's
   Supabase-managed Postgres (Phase 6) — currently unverified.
3. Once real usage produces data volume, run `EXPLAIN (ANALYZE, BUFFERS)` on
   the actual slow list/dashboard queries (Phase 9) — meaningless against an
   empty table today.
4. Enable and query `pg_stat_statements` if not already available (Phase 12).
5. Audit `authenticated`/`anon` RLS policies on `requests`, `tasks`,
   `notifications` for unindexed predicates or expensive helper functions
   (Phase 14/15) — do this with query evidence from step 3, not speculatively.
