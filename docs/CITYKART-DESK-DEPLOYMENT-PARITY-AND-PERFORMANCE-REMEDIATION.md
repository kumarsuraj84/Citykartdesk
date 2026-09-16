# Citykart Desk — Deployment Parity & Performance Remediation

**Date:** 2026-09-16
**Question answered:** What changed when Citykart Desk was deployed from
Local to Main (`10.0.1.12`), and which of those changes are causing Main to
be slower?

---

## 1. Executive Summary

Local and Main run **the same application code** (verified — same git
commit, `git archive HEAD` deployed byte-identical). The slowness is not in
the app's business logic. It comes from **how the Supabase-equivalent
backend was rebuilt for Main**, since Main can't run the official Supabase
CLI/Docker stack Local uses. Four real, independent causes were found and
three are fixed; the fourth (the biggest one) is diagnosed, proven, and
ready to fix but deliberately **not yet applied**, because it changes how
the live app's authentication tokens are signed and deserves a reviewed,
tested rollout rather than being bundled into this diagnostic pass.

| # | Cause | Status | Measured effect |
|---|---|---|---|
| 1 | `service_role` Postgres role missing `BYPASSRLS` | **Fixed** | Admin writes went from silent no-ops to actually persisting |
| 2 | GoTrue/PostgREST used `localhost` (Windows IPv6-first delay) + no `sslmode` | **Fixed** | GoTrue calls: 1.1–1.3s → 550–650ms |
| 3 | Every persistent nav link used Next.js's default prefetch, multiplying auth checks | **Fixed** | GoTrue calls per page load: 54 → 6-7; TTFB 2479ms → ~1.1-1.7s |
| 4 | **Main's GoTrue serves an empty JWKS (`{"keys":[]}`)** because it only has a symmetric HS256 secret, not asymmetric signing keys — so the app's middleware can *never* verify a session locally on Main, and pays a real network round-trip on **every single request**. Local's Supabase CLI auto-provisions real ES256 keys, so Local's middleware verifies **with zero network calls**. | **Diagnosed, not yet applied** | Local production build TTFB for `/requests`: **~100ms**. Main's, same code, same route: **1.1–1.7s**. This is the dominant remaining gap. |

**This is the direct answer to "what changed during deployment":** the
official Supabase CLI silently gives Local a fast, cost-free session
verification path that the self-hosted GoTrue on Main was never configured
to have. Nothing in the application was rewritten differently for Main —
the backend it talks to is simply missing one piece of standard Supabase
infrastructure.

---

## 2. Local Architecture

```
Browser
  │
  ▼
Next.js (npm run dev, Turbopack — dev mode, not production)
  │
  ▼
@supabase/ssr client (proxy.ts middleware + lib/supabase/server.ts)
  │
  ▼
Supabase CLI gateway — http://127.0.0.1:56321
  │
  ├─→ GoTrue (Auth)      — official Supabase build, Docker container
  ├─→ PostgREST (REST)   — official Supabase build, Docker container
  └─→ Storage            — official Supabase build, Docker container
        │
        ▼
  PostgreSQL 17.6 (Linux), Docker container `supabase_db_citykart_desk`, port 54322
```

**Key fact discovered this session:** the Supabase CLI auto-provisions a
real **ES256 (asymmetric) JWT signing key** for GoTrue by default, even
though `supabase/config.toml`'s `signing_keys_path` is commented out (i.e.
nobody explicitly configured this — it's the CLI's own default). Verified
directly:

```
curl http://127.0.0.1:56321/auth/v1/.well-known/jwks.json
→ {"keys":[{"alg":"ES256","crv":"P-256", ... "kty":"EC", ...}]}
```

## 3. Main (`10.0.1.12`) Architecture

```
Browser
  │
  ▼  http://10.0.1.12:3210
CitykartApp — Next.js standalone production build, NSSM service
  │
  ▼  proxy.ts middleware (identical code to Local)
@supabase/ssr client
  │
  ▼  http://10.0.1.12:8443 (or 127.0.0.1:8443 from the box itself)
CitykartProxy — hand-rolled Node http reverse proxy, NSSM service
  │
  ├─→ CitykartAuth (GoTrue)    — built from source, NSSM service, port 9999
  ├─→ CitykartPostgrest        — official Windows binary, NSSM service, port 3001
  └─→ CitykartStorage          — built from source w/ fs-xattr shim, NSSM service, port 5000
        │
        ▼
  PostgreSQL 18.6 (native Windows), port 5432, same box
```

GoTrue here was configured with only `GOTRUE_JWT_SECRET` (a plain shared
HS256 secret) — no signing-key JWK setup was done during the original
deployment, because a minimal working config was the goal at the time and
this specific consequence wasn't yet known. Verified:

```
curl http://127.0.0.1:9999/.well-known/jwks.json
→ 200 {"keys":[]}
```

An empty-but-200 response, not an error — which is exactly why this wasn't
obvious from error logs. It silently degrades every session check to a full
network round-trip instead of failing loudly.

## 4. Deployment Change Register

| Local behavior | Main change | Why changed | Performance risk | Still required? |
|---|---|---|---|---|
| Supabase CLI/Docker (official images) | Native Windows binaries + hand-built GoTrue, custom Node reverse proxy | Docker wasn't available/chosen for Main; box already runs `wms_db`/`workforce_os` on native Postgres | Multiple — see rows below | Yes — no Docker on this box |
| GoTrue: official build, JWKS auto-configured | GoTrue: built from Go source (`go build .`, not `./cmd` — a real trap, documented in WINDOWS-DEPLOYMENT.md), HS256-only, empty JWKS | Fastest path to a working self-hosted Auth; asymmetric key setup wasn't done | **High — root cause #4** | No — this can and should be fixed |
| Postgres: Docker, Linux, `127.0.0.1`-equivalent networking by default | Postgres: native Windows 18, connection strings originally used `localhost` | Copy-pasted a plausible-looking connection string without accounting for Windows' `localhost` IPv6-first resolution | High — root cause #2 (fixed) | No — fixed |
| No `sslmode` needed (Supabase CLI Postgres has no SSL to negotiate) | No `sslmode` set, but a real Postgres 18 install does have SSL infra present | Same connection-string copy-paste | Moderate — root cause #2 (fixed) | No — fixed |
| `service_role` Postgres role: Supabase CLI creates it correctly with `BYPASSRLS` | `service_role` on the shared cluster already existed (cluster-wide, not per-database) without `BYPASSRLS`, and the setup script's `CREATE ROLE IF NOT EXISTS` guard silently skipped fixing it | Roles are cluster-wide on a shared Postgres instance already hosting other apps | Severe (correctness, not just speed) — root cause #1 (fixed) | No — fixed |
| Next.js code: identical | Next.js code: identical | N/A — root cause #3 was in shared app code, not deployment-specific, but its *cost* is deployment-specific | High — root cause #3 (fixed) | Fix already applies to both environments |
| `fs-xattr` (Storage's file backend) — works natively on Linux | Replaced with a local sidecar-JSON shim | Windows has no `getxattr`/`setxattr` syscall at all — not fixable, not a config gap | None known | Yes — permanent, documented in WINDOWS-DEPLOYMENT.md |
| `supabase_vault` extension — ships in Supabase's Docker image | Replaced with a local pgcrypto-backed shim extension | Proprietary extension, not available outside Supabase's own image | None known | Yes — permanent, documented in WINDOWS-DEPLOYMENT.md |

## 5. Component Parity Matrix

| Component | Local | Main | Same? | Risk |
|---|---|---|---|---|
| OS | Windows 11 (dev machine) | Windows Server 2022 | Different, but both Windows | Low |
| Node.js | v20.20.2 | v24.20.0 | No | Low (no incompatibility observed) |
| npm | 10.8.2 | 11.19.0 | No | Low |
| Next.js | 16.2.9 | 16.2.9 | **Yes** | — |
| React | 19.2.4 | 19.2.4 | **Yes** | — |
| PostgreSQL | 17.6, Linux, Docker | 18.6, native Windows | No | See §9/§13 |
| Auth (GoTrue) | Official build, Docker | Built from source | No | **High — root cause #4** |
| GoTrue JWKS | Real ES256 key served | Empty (`{"keys":[]}`) | **No — this is the finding** | **High** |
| PostgREST | Official build, Docker | Official Windows binary | Version parity not diffed | Low |
| Storage | Official build, Docker | Built from source + `fs-xattr` shim | Functionally equivalent | None known |
| Reverse proxy | Supabase CLI's own Kong-equivalent | Hand-rolled Node `http` proxy | Different implementation | Low — already profiled, not the bottleneck (see §11) |
| Connection pool (GoTrue) | Docker default | `GOTRUE_DB_MAX_POOL_SIZE=10` explicit | Tuned, no measured effect either way | None |
| `service_role` BYPASSRLS | `true` (CLI default) | `true` (fixed this session; was `false`) | **Yes, now** | Fixed |
| DB connection string host | Docker-internal networking | `127.0.0.1` (fixed; was `localhost`) | **Yes, now** | Fixed |
| `sslmode` | N/A | `disable` (fixed; was unset) | — | Fixed |
| Build mode | `next dev` (Turbopack) | `next build` + standalone `server.js`, `NODE_ENV=production` | Different — expected, not a bug | See §9 |
| Process manager | none (foreground dev process) | NSSM (Windows Service, auto-restart) | Different, appropriate for each context | None |
| Data volume | 0 rows in `requests` (post-cleanup) | 0 rows in `requests` (post-cleanup) | **Yes** | — |

## 6. Code Parity

**SAME.** Main is deployed via `git archive HEAD | gzip`, extracted directly
over the app directory — a byte-identical snapshot of a specific commit, not
a hand-edited copy. No undocumented manual application-code edits exist on
Main; every change made to get Main working is either (a) a config file
change documented in `deploy/windows/config/*.example` and
`docs/WINDOWS-DEPLOYMENT.md`, or (b) an application code change that was
committed to git and applies identically to Local (e.g. the `prefetch=false`
fix). Current deployed commit: `e4455ad` (verify with `git log -1` — this
report doesn't hardcode a commit that will go stale, check the repo).

## 7. Dependency Parity

Main's `node_modules` was installed via `npm install` against the same
`package-lock.json` shipped in the `git archive` snapshot — not `npm ci`.
This wasn't re-verified as bit-for-bit identical to Local's tree this
session (no `npm ls` diff was run on both sides). No dependency-drift
symptom has been observed in any testing done this session or in the
earlier deployment/bulk-testing work — everything that should work, works
(auth, tickets, dashboards, bulk import). This is a real, if low-confidence,
verification gap: recommend running `npm ci` on the next Main rebuild
instead of `npm install`, to remove any doubt for future deploys.

## 8. Environment/Configuration Parity

See §5 for the config-relevant rows. Both `NEXT_PUBLIC_SUPABASE_URL` values
correctly point at each environment's own local stack — no cross-pointing,
no accidental external-service dependency. `NODE_ENV=production` confirmed
set on Main; Local's dev server has no such variable (expected for `next
dev`).

## 9. Local Production Benchmark (mandatory control, per investigation requirements)

`npm run build` was run locally against the exact same code as deployed to
Main, then the resulting `.next/standalone/server.js` was run directly
(`PORT=3555 NODE_ENV=production node server.js`) — a true apples-to-apples
production-vs-production comparison, not dev-vs-production.

| Route | Local (dev, `next dev`) | Local (**production build**, same commit) | Main (production, same commit) |
|---|---|---|---|
| `/requests` TTFB | not directly comparable (dev mode) | **102ms** | 1081–1692ms (varied across runs) |
| `/tasks` TTFB | not directly comparable (dev mode) | **94ms** | not separately re-measured this pass |

This is the cleanest, most important number in this whole report: **same
commit, same production build mode, ~10-16x difference**, entirely
attributable to backend infrastructure (see §12).

## 10. Main Baseline

Recap from the prior investigation report (not re-derived here):

| Endpoint | Before any fix | After fixes #1–#3 |
|---|---|---|
| `POST /token` (login) | ~950–1090ms | ~550–650ms |
| `GET /user` (session check, isolated) | up to 3.2–4.7s | ~600–720ms |
| `GET /health` (no DB/bcrypt) | ~20ms | ~20ms (unchanged — confirms CPU/bcrypt were never the issue) |

## 11. End-to-End Request Timing — `/requests`, after fixes #1–#3, before #4

```
Browser navigates to /requests
  │
  ▼ TTFB ≈ 1.1–1.7s (varies run to run — see below)
Main / CitykartApp (Next.js)
  │
  ├─ proxy.ts middleware: 1 call → getClaims() → falls back to real GoTrue /user
  │    (no JWKS available on Main — root cause #4)
  │
  ├─ Page/layout render: 5-6 MORE independent GoTrue /user calls fired,
  │    each ~1.05–1.25s under this concurrent load (slower than the
  │    ~600–720ms measured for a single isolated call — real contention
  │    under concurrency, not yet root-caused further this session)
  │
  └─ PostgREST/data queries: fast throughout every measurement this
       session (6–10ms), never implicated
```

CitykartProxy (the custom reverse proxy) was directly ruled out as a source
of this cost earlier in the investigation: PostgREST calls through the exact
same proxy, same code path, were consistently 6–10ms. If the proxy itself
added meaningful overhead, that would show up there too. It doesn't.

## 12. Auth / GoTrue Analysis (the core finding)

**Why does Main's `/user` call cost ~600-1250ms when Local's costs
~280-420ms for the identical operation, and why does Main make 6-7 such
calls per page when the count should be closer to 1?**

Two separate, now-answered questions:

**(a) Why is each individual call slower on Main?** Windows-native
GoTrue+Postgres is measurably slower per-round-trip than the Linux/Docker
equivalent, even after eliminating the localhost-DNS and SSL-negotiation
overhead (root cause #2). This is a real, quantified, ~1.5-2x platform
difference that weekly wasn't independently packet-traced to a single named
cause — the leading theory remains Windows loopback TCP characteristics,
not disproven, not further isolated this session.

**(b) Why does Main make 6-7 calls when Local's production build needs so
few that it responds in ~100ms total?** This is root cause #4:
`getClaims()` (used in `proxy.ts`, called on nearly every request via its
matcher) is specifically designed to verify a JWT **locally, with zero
network calls**, by fetching the signing key from `/.well-known/jwks.json`
once and caching it — but only when the keys it needs are actually being
served. Main's GoTrue returns `{"keys":[]}` (empty, valid JSON, HTTP 200 —
not an error), so `getClaims()` can never succeed locally on Main and always
falls through to a real, network-based `getUser()`. Local's official GoTrue
build auto-provisions a real ES256 key and serves it correctly, so
`getClaims()` succeeds locally there on (effectively) every request,
explaining why Local's *production* build needs no meaningful auth-network
time at all.

This composes multiplicatively with (a): Main pays a slower per-call cost,
**and** pays it far more often than it needs to.

**Recommended fix (not yet applied — see §23 for why):** configure GoTrue
with a real asymmetric (ES256) signing key so `/.well-known/jwks.json`
serves actual keys, matching what Local's Supabase CLI already does by
default. GoTrue's source confirms real support for this
(`internal/conf/jwk.go`). This is expected to be the single highest-impact
fix available — potentially closing most of the ~10x gap seen in §9, since
it would let Main's middleware verify sessions the same zero-network-call
way Local's does.

## 13. PostgREST Analysis

Not implicated. Every measurement of PostgREST calls through this
investigation, this session and the prior one, has been consistently fast
(6–10ms), including under the same conditions where GoTrue calls took over
a second. No further action recommended here.

## 14. Proxy Analysis

`deploy/windows/proxy/server.js` — audited by inspection (it's a ~70-line
hand-rolled Node `http` proxy, already fixed once earlier in this
engagement for a stale-keep-alive-connection bug):
- `agent: false` on every proxied request — deliberately disables
  connection reuse, trading a small per-request TCP-handshake cost for
  immunity to the stale-connection class of bug that was previously found
  and fixed. Given PostgREST calls through this same code path are
  consistently fast, this tradeoff is not currently a measurable cost.
- No response buffering — uses `pipe()` directly, streaming.
- No retries, no synchronous logging in the hot path (error logging only
  fires on actual connection errors).
- No request serialization/queueing — each request gets its own upstream
  connection immediately.

**Conclusion: the proxy is not a contributor to the current gap.** Removing
it isn't indicated by any evidence gathered.

## 15. PostgreSQL Analysis

| Item | Local | Main |
|---|---|---|
| Version | 17.6 (Linux) | 18.6 (Windows) |
| Location | Same box (Docker) | Same box (native) |
| `service_role.rolbypassrls` | `true` | `true` (fixed this session) |

Deep config comparison (`shared_buffers`, `work_mem`,
`effective_cache_size`, parallel-worker settings, autovacuum, WAL/checkpoint
tuning, `random_page_cost`, etc.) was **not performed this session** — flagged
as a real, honest gap, not filled with a guess. Given every measurement this
session traces the cost to GoTrue's own request path rather than to
Postgres query time (PostgREST/direct-query timings were consistently fast
throughout), this is lower-priority than §12's finding, but still an open
item — see §23.

## 16. Index/RLS Analysis

Not performed against query evidence this session — both `requests` tables
are currently empty (post-cleanup), so `EXPLAIN ANALYZE` against them would
be meaningless, and no slow-query log exists yet to justify auditing any
specific index. RLS itself is correctly enforced on both sides (verified:
`service_role` bypasses it as designed after the fix in root cause #1;
`authenticated`/`anon` policies were not independently re-audited for cost
this session, since no evidence yet points at them as a factor — GoTrue's
own request path, not Postgres query execution, is where all measured time
goes).

## 17. Windows-Specific Analysis

Three concrete Windows-specific effects were found and are all either fixed
or fully explained:
1. `localhost` DNS resolving IPv6-first with a slow fallback to IPv4 —
   **fixed** (root cause #2).
2. GoTrue+Postgres round-trip cost being ~1.5-2x Local's Linux/Docker
   equivalent even after (1) is fixed — **quantified, not further
   root-caused** (leading theory: Windows loopback TCP characteristics).
3. `fs-xattr`/`supabase_vault` — Windows syscall/library gaps requiring
   permanent shims, unrelated to today's performance findings, already
   documented in WINDOWS-DEPLOYMENT.md.

No evidence of Defender/antivirus interference was found this session
specifically (a prior session confirmed no AV product exists on this
server at all, during the original deployment's build-corruption
investigation) — not re-checked today, but no new symptom pointed at it.

## 18. Server Resource Analysis

At the time of this session's final measurements, Main's CPU was at 1.3%
(idle) — meaning the ~1.1-1.7s TTFB reproduces **without** contention from
the other apps on this shared box. Earlier in this overall engagement,
under contention from an unrelated Python/FastAPI app ("STORE ROASTER"),
bulk operations ran roughly 5x slower than on an unloaded machine. That
effect is real, separate from today's findings, and intermittent — it
doesn't explain today's baseline gap.

## 19. Confirmed Root Causes (classification)

| Cause | Classification |
|---|---|
| #1 `service_role` missing `BYPASSRLS` | RLS, DEPLOYMENT CONFIG |
| #2 `localhost` + missing `sslmode` | NETWORK, DATABASE CONFIGURATION, DEPLOYMENT CONFIG |
| #3 Nav-link prefetch amplification | APPLICATION CODE |
| #4 Empty GoTrue JWKS forcing network-based session checks | DEPLOYMENT CONFIG, AUTH — **the dominant cause of the remaining gap** |

## 20. Fixes Implemented

1. `ALTER ROLE service_role BYPASSRLS` (live + `bootstrap-roles.sql` made
   self-correcting in git, commit `b2e1d65`).
2. `localhost` → `127.0.0.1` + `sslmode=disable` in GoTrue/PostgREST/Storage
   configs (live + `deploy/windows/config/*.example` updated, commit
   `3071b14`).
3. `prefetch={false}` on `Sidebar`, `MobileNav`, `AppShell`,
   `NotificationBell` (live + committed, commit `e4455ad`).

**Not implemented this session:** root cause #4's fix (asymmetric GoTrue
signing keys). See §23 for why, and the exact steps needed.

## 21. Before/After Performance

| Metric | Before any fix | After #1–#3 |
|---|---|---|
| `/requests` TTFB (Main) | 2479ms | 1081–1692ms |
| GoTrue calls per `/requests` load | 54 | 6–7 |
| Bulk user creation | 1180ms/row | 506ms/row |
| `service_role.rolbypassrls` | `false` | `true` |

## 22. Regression Result

Run this session, on the exact code deployed (including the `prefetch`
changes):

- `npx tsc --noEmit`: **clean, 0 errors.**
- `npm run lint`: **0 errors, 3 pre-existing warnings** (unrelated files,
  not touched this session — `NewMilestonePanel.tsx`,
  `NewProjectPanel.tsx`, `RequestActionBar.tsx`).
- `npm run build`: **succeeds**, all 53 routes compile, both locally and
  on Main.
- `npm test`: **48 test files fail, 463 tests pass, 162 skipped.** Every
  failure traces to the same root cause: `tests/setup/conversation-
  fixtures.ts` references a hardcoded `EXISTING_DEPARTMENT_ID` that no
  longer matches any row in the local database, following this
  engagement's own data-cleanup work (the local DB was deliberately reset
  to a clean slate at the user's explicit request earlier in this
  engagement). **This is unrelated to any change made this session** — none
  of today's three fixes touch departments, teams, or test fixtures. This
  is a pre-existing test-infrastructure staleness issue, not a regression,
  and is flagged here for separate follow-up rather than fixed as part of
  a performance investigation.
- Runtime smoke test (manual, via browser): login, home dashboard,
  requests list, request detail, ticket create→pickup→resolve lifecycle,
  admin user management, bulk import, dashboard analytics — all confirmed
  working correctly earlier in this engagement's bulk-scale testing pass,
  re-confirmed navigable this session after the prefetch fix.

## 23. Remaining Differences / Why root cause #4 wasn't fixed today

Implementing asymmetric GoTrue signing keys means:
1. Generating a real EC (P-256/ES256) key pair in JWK format.
2. Configuring GoTrue to sign new sessions with it (`internal/conf/jwk.go`
   confirms the config surface exists; the exact env var/file format needs
   to be worked out against this specific GoTrue version, not assumed).
3. Verifying existing/future user sessions still work correctly through
   the transition — a botched rollout risks locking out every real user
   session on Main.
4. The app's `anon`/`service_role` API keys (used for PostgREST/Storage
   role-switching, minted via `mint-keys.js`) are a **separate** mechanism
   from user session JWTs and are not expected to need any change — but
   this should be explicitly verified, not assumed, before rollout.

This is exactly the kind of change that deserves its own reviewed,
tested-first rollout — not something to bundle into an already-large
diagnostic session touching live authentication. It's documented here in
full, with the exact evidence proving its value, so it can be planned and
executed deliberately.

## 24. Current Windows Architecture Assessment

**Keep it**, with the JWKS fix applied. Nothing found this session indicates
the native Windows stack is fundamentally unable to perform acceptably —
root causes #1–#3 were configuration/application issues, not architecture
issues, and were fixed without touching the architecture at all. Root cause
#4 is also a configuration gap (GoTrue's signing-key setup), not an
architectural limitation of running GoTrue/PostgREST/Storage natively on
Windows. The one genuine, unavoidable Windows-vs-Linux difference found —
GoTrue+Postgres being ~1.5-2x slower per round-trip on Windows even after
every reasonable fix — is real but modest, and becomes far less consequential
once root cause #4 eliminates most of the round-trips that pay that cost in
the first place.

## 25. Docker/Linux Architecture Assessment

Not recommended as a response to this investigation's findings. Every
problem found had a scoped, low-risk fix that doesn't require replacing the
deployment architecture. A move to Docker/Linux would trade a known,
mostly-fixed set of issues for a substantial, high-risk migration effort on
a server that's also hosting two other live production databases — not
justified by the evidence gathered here.

## 26. Recommended Long-Term Deployment Architecture

Keep the current native-Windows-Services architecture. Priority follow-ups,
in order:
1. Implement asymmetric GoTrue signing keys (root cause #4) — highest
   expected impact, needs a dedicated reviewed rollout (see §23).
2. Diff Main's `postgresql.conf` against Local's Docker-managed defaults
   (§15) — not yet done.
3. Re-run `npm ci` (not `npm install`) on Main's next rebuild to remove any
   doubt about dependency-tree parity (§7).
4. Once real production data accumulates, revisit `EXPLAIN ANALYZE` and
   `pg_stat_statements` (§16) — meaningless against today's empty tables.
5. Separately: fix the stale `EXISTING_DEPARTMENT_ID` test fixture (§22) —
   not a performance item, but a real gap in this session's ability to
   fully verify regression safety via the automated suite.

## 27. Rollback Information

All three applied fixes are safe to revert independently if ever needed:

- **Root cause #1:** `ALTER ROLE service_role NOBYPASSRLS;` — reverts to
  the original (broken) state. Not recommended; this was a correctness bug,
  not a style choice.
- **Root cause #2:** revert `127.0.0.1?sslmode=disable` back to `localhost`
  in `services/auth/.env` and `services/postgrest/postgrest.conf`, restart
  both NSSM services. Not recommended; measured as a pure improvement with
  no downside.
- **Root cause #3:** remove `prefetch={false}` from the four touched
  files (`git revert e4455ad`), rebuild, redeploy. Would restore the
  54-calls-per-page behavior; not recommended.

No database schema, data, or RLS policy was altered by any of today's
fixes — every change is either a Postgres role attribute, a connection
string, or four `<Link>` props in application code.

## 28. Final Performance Verdict

# PERFORMANCE IMPROVED — FURTHER OPTIMIZATION REQUIRED

Three real, independent, confirmed root causes were fixed today with
measured before/after evidence (not estimates). A fourth, more impactful
root cause was found, proven with a clean apples-to-apples benchmark
(~100ms Local-production vs ~1.1-1.7s Main-production, same commit, same
route), and documented in full — but deliberately not implemented today
because it changes how live user sessions are cryptographically verified,
and that class of change needs its own reviewed rollout, not to be bundled
into a diagnostic session. Main is measurably faster than it was at the
start of this investigation and is not yet as fast as Local's own
production build, for a specific, understood, fixable reason.
