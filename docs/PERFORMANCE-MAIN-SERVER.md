# Main (Live) Server Environment — `10.0.1.12`

Companion to [PERFORMANCE-INVESTIGATION-REPORT.md](PERFORMANCE-INVESTIGATION-REPORT.md).
This file is the Main-side environment snapshot referenced from that report.

## Identity

- Host: Windows Server 2022, hostname `CK-SNOOKER-SRV`
- 14 logical CPU cores
- Shared machine: also hosts two unrelated production databases (`wms_db`,
  `workforce_os`) and an unrelated Python/FastAPI app ("STORE ROASTER")
  that periodically consumes significant CPU

## Runtime versions

| Component | Version |
|---|---|
| Node.js | v24.20.0 |
| npm | 11.19.0 |
| PostgreSQL | 18.6, native Windows install (`C:\Program Files\PostgreSQL\18`) |
| Next.js | 16.2.9 (from `origin/main`, commit deployed at time of writing: `e4455ad`) |
| React | 19.2.4 |

## How the app runs here

No Docker, no hosted Supabase. Every service is a native Windows process
registered as an NSSM Windows Service (auto-start, auto-restart):

| Service | Port | Binary/entry point |
|---|---|---|
| `CitykartApp` | 3210 | `node .next/standalone/server.js` (real production build, `NODE_ENV=production`) |
| `CitykartProxy` | 8443 | `deploy/windows/proxy/server.js` — hand-rolled Node `http` reverse proxy unifying Auth/REST/Storage under one URL |
| `CitykartAuth` | 9999 | GoTrue v2.197.0, built from source (`go build .` from repo root — building `./cmd` instead is a known trap, see WINDOWS-DEPLOYMENT.md) |
| `CitykartPostgrest` | 3001 | PostgREST v16.3, official Windows binary |
| `CitykartStorage` | 5000 | Supabase Storage v1.77.0, with a local `fs-xattr` shim (Windows has no `getxattr`/`setxattr` syscall) |

Full architecture and every Windows-specific workaround (the `fs-xattr` shim,
the `supabase_vault` shim, the NSSM `AppParameters`-with-spaces quoting
gotcha, etc.) are documented in
[WINDOWS-DEPLOYMENT.md](WINDOWS-DEPLOYMENT.md) — not repeated here.

## Fixes applied this session (see the investigation report for full detail)

1. `ALTER ROLE service_role BYPASSRLS` — was silently missing, admin writes
   were no-ops.
2. `services/auth/.env` `DATABASE_URL` and `services/postgrest/postgrest.conf`
   `db-uri`: `localhost` → `127.0.0.1`, added `?sslmode=disable`.
   `services/storage-src/.env` updated to match for consistency.
3. `GOTRUE_DB_MAX_POOL_SIZE=10` / `GOTRUE_DB_CONN_MAX_LIFETIME=1h` added
   explicitly (no measured effect on their own, kept for clarity).
4. Deployed the `prefetch={false}` fix (see main report, root cause #3) —
   this is application code, not server config, but it's what actually
   moved Main's measured numbers the most.

All four are committed to `origin/main` (commits `b2e1d65`, `3071b14`,
`e4455ad`) and already live on this box as of this report.

## Current measured state (this session, same conditions used in the main report)

- CPU at time of final measurement: 1.3% (idle — the STORE ROASTER
  contention was not active during these specific measurements)
- `/requests` page TTFB: 1692ms (down from 2479ms before any fix)
- GoTrue `GET /user` calls for one `/requests` navigation: 7 (down from 54)
- `pg_roles.rolbypassrls` for `service_role`: `true` (fixed; was `false`)

## Data state

Clean slate as of this report: 0 rows in `requests`, exactly 1 profile (the
`seed.sql` bootstrap admin, `suraj@citykart.org`), `request_sequences.last_no`
reset to 0 so the next real ticket created will correctly be `CKSD-000001`.
All bulk-test org-structure (departments/teams/categories/services created
for testing) has been deleted. This matches the same state the app will be
in for real go-live use — no test data of any kind remains.

## What was NOT checked here (honest gaps, see main report §12)

- `postgresql.conf` tuning (`shared_buffers`, `work_mem`, etc.) not diffed
  against Local.
- No index-by-index audit against Local's schema.
- No `EXPLAIN ANALYZE` run (table is empty — would be meaningless right now).
- `pg_stat_statements` not queried (not confirmed enabled).
- RLS policy cost for `authenticated`/`anon` roles not audited.
