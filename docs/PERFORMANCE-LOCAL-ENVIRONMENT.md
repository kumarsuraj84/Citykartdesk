# Local Development Environment

Companion to [PERFORMANCE-INVESTIGATION-REPORT.md](PERFORMANCE-INVESTIGATION-REPORT.md).
This file is the Local-side environment snapshot referenced from that report.

## Identity

- This dev machine (Windows 11), running the project directly from the
  working directory — no deployment step, this *is* the source tree.

## Runtime versions

| Component | Version |
|---|---|
| Node.js | v20.20.2 |
| npm | 10.8.2 |
| PostgreSQL | 17.6, Linux, inside the Supabase CLI's Docker stack (`supabase_db_citykart_desk` container) |
| Next.js | 16.2.9 |
| React | 19.2.4 |

## How the app runs here

`npm run dev` — Next.js dev server with Turbopack, **not a production
build**. This is the important asymmetry called out in the main report §2:
dev mode recompiles routes on demand, skips production optimizations, and
runs extra development-only instrumentation. A raw response-time number from
this mode is not directly comparable to Main's production numbers — it's
included here for completeness, not as a benchmark target.

Backing services are the official Supabase CLI Docker stack (`supabase
start`), not the hand-built Windows-native services Main uses:

| Service | How it runs locally |
|---|---|
| Postgres | `supabase_db_citykart_desk` Docker container, port 54322 |
| Auth (GoTrue) | Supabase CLI's own container, official build |
| PostgREST | Supabase CLI's own container |
| Storage | Supabase CLI's own container (real `fs-xattr` works fine on Linux — the Windows shim is Main-only) |
| Everything fronted by | Supabase CLI's own Kong gateway, port 56321 |

This means Local never hit any of the three root causes documented in the
main report — they're all specific to running natively on Windows against a
hand-rolled service stack, which Local doesn't do. Local was never "the
control group proving the code is fast" in a strict sense; it just doesn't
have Windows-specific connection-string or `<Link>`-prefetch-vs-constrained-
server interactions to expose, because its Postgres/Auth/REST stack is a
different (Linux, containerized, officially-built) implementation entirely.

## Notable incident this session

The local dev server was found to have stopped running partway through this
session (not something this session's work intentionally did — no local dev
server commands were run for an extended stretch while work focused on the
Main server over SSH). On restart, a **second, already-running** dev server
instance was discovered bound to port 3001 instead of the expected 3210
(Next.js's own "one dev server per project" lock file correctly refused a
duplicate on 3210 once a stray process was cleaned up). Per this session's
standing instruction to never manually stop a live local server, that
existing instance on port 3001 was left running and used for local
verification instead of being killed and restarted on 3210. If a single
canonical `localhost:3210` is needed going forward, that pre-existing
process should be intentionally restarted with `PORT=3210` — this session
did not do that unilaterally.

## Data state

Clean slate as of this report: 0 rows in `requests`, exactly the 3 originally
preserved accounts (`suraj@citykart.org`, `kaushlesh.kumar@citykartstores.com`,
`ankur.pahwa@citykartstores.com`), `request_sequences.last_no` reset to 0.
All bulk-test data from this session's scale testing has been removed.

## What was NOT checked here (honest gaps, see main report §12)

- No production build (`next build` + `next start`) was run locally this
  session to get a true apples-to-apples number against Main — only the dev
  server was used, per the asymmetry noted above.
- Docker container resource limits (CPU/memory caps on
  `supabase_db_citykart_desk`) were not inspected.
- `postgresql.conf` inside the Local Postgres container was not pulled for
  comparison against Main's.
