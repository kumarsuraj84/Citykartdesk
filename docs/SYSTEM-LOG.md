# System Log (audit trail + error capture)

One append-only record of **who changed what** (with before/after values), **security events**, and **every error** from the
browser, the app, the database, storage, sign-in service, scheduled jobs and outside services. Screen: **Logs** in the sidebar (`/admin/logs`, tabs **System Log**, **Audit Log**, **Event Log**; the old `/admin/system-log`, `/admin/audit` and `/admin/event-log` addresses redirect there)
(administrators and platform owners; managers see only the Audit Log tab, as before). Design: `docs/superpowers/specs/2026-10-14-system-log-design.md`.

## What is recorded

| Category | Examples | Kept |
|---|---|---|
| `audit` | any change to ~45 business tables (database triggers, with before/after), sign-in/out, user administration, exports, scheduled-report changes | 7 years, then archived (never dropped) |
| `security` | denied access, role changes, failed sign-ins | 7 years |
| `error` | browser JS/render errors (with the click that preceded them), server action / route / cron failures, failed database/auth/storage/outside calls, process crashes, lines from the service logs | 180 days, then archived |
| `event` | notable non-error events | 180 days, then archived |

* Audit and security rows are **hash-chained** (`prev_hash`/`row_hash`, ordered by `chain_seq`) under a locked head row; the screen's
  **Verify integrity** button re-checks the whole chain, archive included.
* Every database write made by the app is attributed to the signed-in person (the app passes `x-actor-id` / `x-request-id`; the
  trigger trusts them only for the service role).
* Secrets, tokens, e-mail addresses and phone numbers are redacted from error/event text; audit before/after values keep their text.
* **Copy for Claude** builds a redacted markdown bundle of the grouped errors for pasting into a chat. CSV and JSON exports are audited.
* Errors that happen while the database is down are kept in a spool file (`SYSTEM_LOG_SPOOL_DIR`, default the temp folder, 5 MB cap) and
  retried.

## Deploying (production — only on the user's explicit instruction)

1. Build and deploy the new app build to **10.0.1.98** first (the app tolerates a missing table: capture simply spools).
2. The user runs `supabase/migrations/20240101000160_system_log.sql` on **10.0.0.205** (database `ckdesk`). Rollback:
   `supabase/rollback/20240101000160_rollback.sql` (restores the earlier `owner_delete_org`; drops the log tables).
3. Restart `CkDeskPostgrest` on 98 so its schema cache sees the new tables/functions.
4. Optional environment (in the app's `.env.local`): `SYSTEM_LOG_INGEST_SECRET` (16+ characters; the cron secret is accepted too),
   `SYSTEM_LOG_SPOOL_DIR`, `SYSTEM_LOG_ERROR_DAYS` (180), `SYSTEM_LOG_AUDIT_YEARS` (7), `TRUSTED_PROXY_HOPS`.
5. Re-run `scripts\windows\install-cron-tasks.ps1` as Administrator on 98: it now also installs
   `CitykartDesk-Cron-SystemLogArchive` (every 6 h) and `CitykartDesk-LogShipper` (every 2 min).

The old `event_log` / `audit_log` tables are left in place (their rows were back-filled into `system_log`).

## Log shipper

`scripts/log-shipper.mjs` (no dependencies, Node 18+) reads the **problem lines only** of PostgREST, Supabase Auth, Supabase Storage and
PostgreSQL logs and posts them to `/api/system-log/ingest` (shared secret; the endpoint can only add `error`/`event` rows).
Ordinary traffic, 4xx answers (people's mistakes) and unique-key clashes are ignored; identical problems in a batch collapse into one
row with a repeat count; request headers/bodies are never copied. It keeps a cursor file, starts at the **end** of each log on its
first run, and keeps its place while the app is unreachable.

```
node scripts/log-shipper.mjs --once --file postgrest=D:\...\logs\CkDeskPostgrest.err.log --file auth=...\CkDeskAuth.out.log --file storage=...\CkDeskStorage.out.log
node scripts/log-shipper.mjs --audit-stack --dry-run        # local audit stack (docker); prints what would be sent
```

* On **10.0.1.98** the scheduled task `CitykartDesk-LogShipper` runs `scripts\windows\run-log-shipper.ps1`, which finds the
  `CkDesk*.err.log / .out.log` files next to the app and reads the secret from `.env.local`.
* PostgreSQL's own log lives on **10.0.0.205**, not 98. To capture it, run the same script on 205 with
  `--file postgres=<path to the PostgreSQL log>` and `SYSTEM_LOG_TARGET_URL=http://10.0.1.98:3210` (the secret must match the app's).
  Until then, database errors the app itself sees are already captured by the app (failed calls, slow/timeout, RLS denials).

## Operating notes

* A flood of one error is rate-limited per key (one row plus a "suppressed N" summary); that is intentional.
* The screen's user filter lists the organization's users; very large organizations may want a search box there later.
* Tests: `tests/unit/syslog-*.test.ts`, `tests/unit/log-shipper-*.test.ts`, `tests/remediation/100…105-system-log-*.test.ts`
  (the latter run only on the isolated audit stack via `audit-2026-10\guard\run.ps1`).
