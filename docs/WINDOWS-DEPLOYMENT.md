# Deployment: native Windows Server (no Docker)

This is the deployment path used for the on-prem LAN server (`10.0.1.12` as of
this writing), where Docker was not available and the box already runs two
other production Postgres databases (`wms_db`, `workforce_os`) that must never
be touched. Everything here runs natively as Windows Services via
[NSSM](https://nssm.cc/) against one dedicated Postgres database
(`citykart_desk`) on the server's existing PostgreSQL 18 instance.

Unlike [RAILWAY-DEPLOYMENT.md](RAILWAY-DEPLOYMENT.md) (hosted Supabase +
Railway), there is no managed Supabase project here — Auth (GoTrue),
PostgREST, and Storage are each run as standalone binaries/services, fronted
by a small reverse proxy so the app talks to one URL.

Scripts and config templates referenced below live in `deploy/windows/` at
the repo root.

## Architecture

```
Browser / LAN device
        |
        v
CitykartApp      (Next.js, standalone build)      port 3210
        |
        v
CitykartProxy    (deploy/windows/proxy/server.js)  port 8443
        |  strips /auth/v1, /rest/v1, /storage/v1 prefixes
   +----+----+-------------+
   v         v             v
CitykartAuth  CitykartPostgrest  CitykartStorage
(GoTrue)      (PostgREST)        (Supabase Storage)
port 9999     port 3001          port 5000
   |               |                  |
   +---------------+------------------+
                   v
        PostgreSQL 18, database `citykart_desk`
        (same instance as wms_db / workforce_os —
         never touch those; citykart_desk is fully isolated
         via its own role + table-level grants)
```

All five services are installed as NSSM Windows Services with
`Start=SERVICE_AUTO_START`, so they come back up on reboot without manual
intervention.

## Two Windows-specific problems this deployment works around

Neither of these is a workaround for a missing tool — both are things that
**cannot exist on Windows at all**, so don't waste time trying to "properly"
install them first.

### 1. `fs-xattr` (Supabase Storage's `file` backend)

Storage's `file` backend uses `fs-xattr` to persist each object's
`content-type`/`cache-control` as a POSIX extended attribute. Windows has no
`getxattr`/`setxattr` syscall — `fs-xattr`'s own `package.json` declares
`"os": ["!win32"]`, and installing Visual Studio's C++ build tools does not
change that; there is nothing to compile against.

Fix: `deploy/windows/fs-xattr-shim/` is a drop-in replacement package (same
`getAttributeSync`/`setAttributeSync`/`removeAttributeSync` signatures, same
`ENOATTR` error shape that `file.ts`'s own `isMissingXattrError` already
expects) that stores the same metadata in a `<file>.xattrs.json` sidecar
file instead of a real xattr. Wired in via `package.json`'s `dependencies`
(not `overrides` — npm rejects an override that exactly matches a version it
thinks conflicts with a direct dependency):

```json
"dependencies": { "fs-xattr": "file:./vendor-fs-xattr" }
```

Copy `fs-xattr-shim/` into Storage's source tree as `vendor-fs-xattr/` before
`npm install`.

### 2. `supabase_vault` (the Intake credential-storage migration)

One app migration (`intake_ingestion`) does
`CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;` to encrypt
mailbox/WhatsApp channel credentials at rest. `supabase_vault` only ships
inside Supabase's own `supabase/postgres` Docker image — it is not on PGXN
and does not install on a stock PostgreSQL 18 instance.

Fix: `deploy/windows/postgres-extensions/` registers a **real** Postgres
extension also named `supabase_vault` (a `.control` file + plain-SQL
`--1.0.sql` script — no C/Rust compilation needed) that provides the same
`vault.secrets` / `vault.decrypted_secrets` / `vault.create_secret` /
`vault.update_secret` interface, backed by `pgcrypto`'s `pgp_sym_encrypt`/
`pgp_sym_decrypt` instead of Supabase's proprietary pgsodium-based backend.
Same security property (encrypted at rest, only decryptable through the
already-locked-down `SECURITY DEFINER` RPCs) — the app's own migration file
needs zero changes.

Install by copying `supabase_vault.control` and `supabase_vault--1.0.sql`
into Postgres's `share\extension\` directory. The encryption key is set
**once**, directly in the database (never in a file, never in git) via
`postgres-extensions/set-vault-key.sql`, which generates a random key
server-side and stores it with `ALTER DATABASE citykart_desk SET
app.vault_key = ...` — run that before `CREATE EXTENSION supabase_vault`.

## Deployment steps, in order

1. **Postgres**: create the `citykart_desk` database and a dedicated login
   role (`citykart_desk_app`) with its own random password. Do **not** grant
   it broad privileges on the cluster — table-level grants only, scoped to
   `citykart_desk`.
2. Run `postgres-extensions/bootstrap-roles.sql` — creates the
   `anon`/`authenticated`/`service_role` Postgres roles PostgREST's
   role-switching model requires, and grants them + `citykart_desk_app` on
   `public`. **On a shared cluster, verify `service_role` actually has
   `BYPASSRLS` after running this** (`SELECT rolbypassrls FROM pg_roles WHERE
   rolname = 'service_role'`) — roles are cluster-wide, not per-database, so
   if a role with that name already existed (from another app, or a prior
   partial deployment attempt) the script's `CREATE ROLE IF NOT EXISTS` guard
   skips creating it and silently leaves whatever attributes it already had.
   The symptom is severe and silent: every `createAdminClient()` write in the
   app (approvals, notifications, any admin action) appears to succeed —
   PostgREST returns 200 — but actually updates zero rows, because it's
   running under normal RLS instead of bypassing it. This happened on the
   first deployment to `10.0.1.12` and was only caught by testing a bulk
   write and noticing the row count. Fix: `ALTER ROLE service_role
   BYPASSRLS;` (safe, idempotent, no downtime).
3. `CREATE SCHEMA auth; CREATE EXTENSION pgcrypto; CREATE EXTENSION
   "uuid-ossp";` — GoTrue's own migrations only create tables inside `auth`,
   not the schema itself.
4. Copy the app checkout to the server (`git archive HEAD | gzip` + transfer
   + extract keeps it byte-identical to what's on `origin/main`, no `.git`
   needed on the server).
5. Run `apply-migrations.ps1` against `supabase/migrations/*.sql` — it's
   resumable: pass `-SkipCount N` to skip the first N files if a previous
   run got partway through, and it self-registers each newly-applied file
   into a `schema_migrations` table so a second run without `-SkipCount`
   skips everything already done.
6. Run `supabase/seed.sql` (**after** migrations, it's a separate step) to
   create the bootstrap admin account. This is the same file
   [RAILWAY-DEPLOYMENT.md](RAILWAY-DEPLOYMENT.md) §1.4 warns about — its
   admin password is hardcoded and known to anyone who's seen this repo.
   Change it immediately after first login on a real deployment.
7. Build and install Auth: `services/patch-auth-windows.ps1` (removes the
   Unix-only `SO_REUSEPORT` code path — a multi-process port-sharing
   optimization, unused for a single-instance deployment, not part of any
   auth/session logic), then `services/build-auth.ps1`, then
   `services/install-auth-service.ps1`.

   **Build-target gotcha**: build `.` (repo root, `package main`), never
   `./cmd` (a library package, `package cmd`). Building `./cmd` silently
   produces a Unix `ar`-archive at the requested `.exe` path — not a
   toolchain bug, not antivirus, just the wrong package.
8. Copy `postgrest.exe` (official Windows binary) + a filled-in
   `config/postgrest.conf.example` → `postgrest.conf`, then
   `services/install-postgrest-service.ps1`.
9. Set up Storage per §2 above, fill in `config/storage.env.example` →
   `.env`, run its own `migration:run` script, `npm run build` (the plain
   `tsc -noEmit` gate inside `npm run build` may fail on pre-existing test-file
   type errors unrelated to this deployment — run `node build.js && npx
   resolve-tspaths` directly instead if so), copy `.next`-style static output
   as documented in Storage's own README, then
   `services/install-storage-service.ps1`.
10. Deploy `proxy/server.js` and install it (no build step, no
    dependencies — plain Node `http`).
11. Mint `ANON_KEY`/`SERVICE_ROLE_KEY` with `mint-keys.js <JWT_SECRET>` (same
    JWT secret as Auth/PostgREST/Storage above — any freshly-signed JWT with
    the right `role` claim works, there's no fixed canonical token).
12. Fill in `config/app.env.local.example` → `app/.env.local`, `npm run
    build`. If `next.config` has `output: "standalone"`, run
    `node .next/standalone/server.js` (not `next start`, which warns and
    still works but isn't the intended path) — and manually copy
    `.next/static` → `.next/standalone/.next/static` and `public/` →
    `.next/standalone/public` first; the standalone build doesn't do this
    for you. Copy `.env.local` into `.next/standalone/` too so the running
    server can read it. Then `services/install-app-service.ps1`.
13. Open Windows Firewall inbound rules for the app port (3210) and the
    proxy port (8443) — nothing else needs to be reachable from other LAN
    devices.

## Performance: GoTrue (Auth) was 5-10x slower than it should be

Every GoTrue endpoint that touches Postgres — `/token` (login) and
`/admin/users` (create) — was taking 1.1-1.3 seconds on `10.0.1.12`, making
every real login feel slow. `/health` (no DB, no bcrypt) was a normal
~20ms, and an isolated benchmark of `bcrypt.GenerateFromPassword` at
GoTrue's actual cost factor (`bcrypt.DefaultCost`, unmodified) took 87ms on
this same hardware — so neither raw CPU speed nor the bcrypt cost factor
was the problem. Two real, fixable causes were found and fixed, in
`services/auth/.env` and `services/postgrest/postgrest.conf`:

1. **`localhost` instead of `127.0.0.1`.** Both `DATABASE_URL`/`db-uri`
   pointed at `localhost:5432`. On this Windows box, connecting to
   `localhost:5432` measured **768ms** versus **14ms** for `127.0.0.1:5432`
   (`Measure-Command { Test-NetConnection -ComputerName localhost -Port
   5432 }` vs the same with `127.0.0.1`) — the classic IPv6 (`::1`)
   attempted first, timing out, then falling back to IPv4 gotcha. Always
   use `127.0.0.1` literally in every service's Postgres connection string
   here, never `localhost`.
2. **No explicit `sslmode`.** Neither connection string specified one, so
   the Go Postgres driver's default negotiation (attempt SSL, fall back to
   plaintext) added real, measurable overhead against a Postgres instance
   not configured for SSL. Adding `?sslmode=disable` (safe here — this is
   loopback-only traffic on `127.0.0.1`, never leaving the box) cut login
   time further, from ~950ms to ~550-650ms.

Together those two took GoTrue from ~1.1-1.3s down to ~550-650ms per
request — a real, confirmed improvement, not a guess. The remaining
~500-600ms did not respond to setting `GOTRUE_DB_MAX_POOL_SIZE`/
`GOTRUE_DB_CONN_MAX_LIFETIME` explicitly (tried, measured, no change), and
`pg_stat_activity` polled at 100ms resolution during a live request never
caught GoTrue's own query as "active" even once — consistent with the cost
being connection/round-trip overhead rather than query execution time.
Login and create-user each involve several sequential round trips (lookup,
insert, session, refresh token), and Windows' loopback TCP stack is
measurably slower per round-trip than Linux's; that compounding is the
most likely explanation for what's left, but wasn't independently proven
here (would need packet-level tracing to confirm) — treat it as the
leading theory, not a closed case. PostgREST wasn't visibly affected by
either issue because it holds a warm, persistent connection pool from
startup (`db-pool = 10`) and pays this cost at most once; GoTrue opens
connections per-request more often, so it pays it repeatedly.

If you're chasing further Auth latency on a future deployment, start here
before assuming it's the shared-server CPU contention noted above — that's
a real, separate, and much larger effect (bulk user creation ran at
~1.2s/row on `10.0.1.12` under load from another app on the box, versus
~230ms/row on an unloaded local machine), but it's not the whole story on
its own, as this section's numbers show.

## JWT signing keys (JWKS) — the other ~500-600ms

The section above closed with "the remaining ~500-600ms did not respond
to..." — the actual dominant cause of that remainder was found and fixed
separately: GoTrue was configured with only `GOTRUE_JWT_SECRET` (symmetric
HS256), so `/.well-known/jwks.json` returned a valid, healthy-looking
`{"keys":[]}`. The app's `proxy.ts` calls Supabase's `getClaims()` on almost
every request; `getClaims()` verifies a JWT with **zero network calls** when
the issuer publishes a real public key, but silently falls back to a real
network `getUser()` round-trip to GoTrue when the JWKS is empty. On Main
this turned one page load into 6-7 concurrent `GET /user` calls, each
1.0-1.7s under load — see
`docs/CITYKART-DESK-DEPLOYMENT-PARITY-AND-PERFORMANCE-REMEDIATION.md` for
the full measurement.

### The fix

Add an asymmetric ES256 (P-256) signing key alongside the existing
`GOTRUE_JWT_SECRET`, without removing or rotating the secret:

```
node deploy/windows/generate-jwt-signing-key.js "<current GOTRUE_JWT_SECRET>"
```

This prints three values, one per consuming service — apply all three
together, then restart `CitykartAuth`, `CitykartPostgrest`, and
`CitykartStorage`:

- **`services/auth/.env`**: add the printed `GOTRUE_JWT_KEYS` line.
  `GOTRUE_JWT_SECRET` stays exactly as it is.
- **`services/postgrest/postgrest.conf`**: **replace** the `jwt-secret`
  line with the printed one (a JWKS containing both the legacy secret and
  the new public key — not an addition, a replacement).
- **`services/storage-src/.env`**: add the printed `JWT_JWKS` line.
  `AUTH_JWT_SECRET`/`AUTH_JWT_ALGORITHM` stay exactly as they are.

### Why old sessions keep working

This was the main risk, and it's verified, not assumed:

- GoTrue's `FindPublicKeyByKid()` falls back to the raw `GOTRUE_JWT_SECRET`
  whenever a token's `kid` claim is empty and no `GOTRUE_JWT_KEY_ID` is
  configured — which describes every token issued before this key existed
  (a real Main token decoded to `{"alg":"HS256","typ":"JWT"}`, no `kid` at
  all). Confirmed against GoTrue's actual compiled logic, not just by
  reading the source.
- PostgREST has no separate flat-secret fallback once `jwt-secret` holds a
  JWKS, which is why the legacy secret must be included *inside* that JWKS
  (as an `"oct"` key) rather than left in place elsewhere. Verified against
  the real PostgREST 16.3 binary in an isolated container: old no-kid
  tokens, new ES256 tokens, and a tampered signature all resolved exactly as
  expected (200, 200, 401).
- Storage's `src/internal/auth/jwt.ts` has an explicit fast path
  (`!header.kid && header.alg === jwtAlgorithm`) that keeps using the flat
  `AUTH_JWT_SECRET` for any no-kid token, so it needs only the new *public*
  key added via `JWT_JWKS` — the legacy secret doesn't need to move.

Validated end-to-end on Main: an existing browser session, logged in
*before* this change, continued to load real pages with no forced
re-login immediately after the restart.

### Rotating the key later

Generate a new key the same way
(`node deploy/windows/generate-jwt-signing-key.js "<GOTRUE_JWT_SECRET>"`),
then:

1. Add the new key to `GOTRUE_JWT_KEYS` (as an additional array entry)
   **alongside** the current one, with the current one's `key_ops` changed
   from `["sign"]` to `["verify"]` so it keeps validating already-issued
   tokens without signing new ones. GoTrue requires exactly one key with
   `key_ops: ["sign"]` across the whole array.
2. Add the new public key to the PostgREST and Storage JWKS values the same
   way (append, don't replace) — leave their existing entries in place until
   every token signed under the old key has expired (`GOTRUE_JWT_EXP`,
   currently 3600s).
3. Only remove the old key's entries after that expiry window has passed.

### Validating any of the above

`deploy/windows/validate-deployment.ps1` checks JWKS is non-empty (among
the other fixes on this page) and fails loudly if it regresses to `{"keys":
[]}` — run it after any config change or service restart.

## NSSM gotcha: `AppParameters` with spaces

`nssm set <service> AppParameters "<value with spaces>"` does not reliably
survive quoting through PowerShell → `nssm.exe` → the process it launches —
nssm re-tokenizes that string itself when building the final command line.
Prefer a **relative** parameter (resolved against `AppDirectory`, which has
no such problem) over fighting nssm's quoting with embedded literal quote
characters.

## Windows Services / ports reference

| Service              | Port | Role                              |
|-----------------------|------|------------------------------------|
| `CitykartApp`          | 3210 | Next.js app (client-facing)        |
| `CitykartProxy`        | 8443 | Unified Auth/REST/Storage gateway  |
| `CitykartAuth`         | 9999 | GoTrue (internal only)             |
| `CitykartPostgrest`    | 3001 | PostgREST (internal only)          |
| `CitykartStorage`      | 5000 | Supabase Storage (internal only)   |

## Secrets — never in this repo

None of the files under `deploy/windows/` contain a real secret — every
`.example` file uses a `<PLACEHOLDER>`. The actual `.env`/`.conf` files (with
the real DB password, JWT secret, anon/service-role keys, cron secret) exist
**only** on the target server, generated fresh per deployment. If you're
setting this up again: generate new random values, don't copy old ones out
of a backup or chat history.
