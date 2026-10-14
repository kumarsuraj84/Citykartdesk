# System Log — unified audit trail, event log and error capture

*Design approved by the user on 2026-10-14 (defaults accepted). Local branch `feature/system-log`; nothing is deployed, and production steps are run by the user.*

## Goal
One append-only record of everything that matters for audit rules and for fixing errors: who changed what (before/after), what failed and where (browser, app server, server action, API route, cron, database, storage, auth, integration, admin), whether a click caused it — in one table, one admin screen, one "copy for Claude" export.

## Data (migration `…160_system_log.sql`)
* `system_log` — `category` (audit | security | error | event), `source`, `severity`, `outcome`, `action`, actor (id, role), entity (type, id, label), `before`/`after` (changed fields only, secrets redacted), message / error code / stack, request id, path, method, IP, user agent, `from_click` + `click_target`, correlation and session ids, `fingerprint` (for grouping), `legacy_ref` (back-fill), and a **hash chain** (`prev_hash`, `row_hash`) on audit/security rows.
* **Append-only:** UPDATE/DELETE/TRUNCATE are refused by trigger (except the archive function); client roles have SELECT only (admin / platform owner of the same organization); rows are written by the server's service client or by the `SECURITY DEFINER` trigger function.
* `system_log_archive` + `system_log_archive_old(error_days, audit_years)` — errors/events after 180 days and audit rows after 7 years are **moved**, never dropped. `system_log_verify_chain()` reports the first broken link.
* **Database triggers** on configuration, security and structure tables, and on ticket status/assignment/priority — the trail exists even for direct database writes.
* Existing tables (`admin_audit_log`, `request_activity`, `task_activity`, `project_activity`, `intake_audit_log`, `owner_audit_log`, `error_reports`, error rows of `app_event_log`) are **back-filled** (idempotent) and left in place.

## Capture
1. `instrumentation.ts`: `register()` installs Node process-level handlers; `onRequestError` records every unhandled error in pages, route handlers, server actions and the proxy.
2. `lib/syslog/record.ts`: one buffered, never-throwing writer with redaction, size limits, per-key flood control and request context (request id, user, path, IP, user agent). The existing `logger` sink also persists warnings and errors, so the central error sanitizer and all cron/rule/email logging flow in.
3. The Supabase fetch wrapper records failed database / auth / storage calls (5xx and unexpected 4xx with the PostgREST code); the outbound fetch helper records integration failures — this captures errors that application code swallows.
4. Browser: `/api/events` accepts only client event kinds; JS and render errors are mirrored into `system_log` with the last click (control + age).
5. Application audit calls (`logAdminAudit` and new calls on user, team, structure and report actions) write `audit` rows with the real actor.
6. `/api/system-log/ingest` (secret-protected) lets the cron runner and the **log shipper** add rows; `scripts/log-shipper.mjs` reads PostgREST / auth / storage / PostgreSQL logs (docker or files) and posts them.

## Screen
`/admin/system-log` (admin, platform owner): filters (category, source, severity, user, entity, date, click / no click), grouped-errors view, export CSV / JSON, "Verify integrity", and **Copy for Claude** (compact, redacted bundle).

## Out of scope / for the user
Installing the shipper on the app server and running migration 160 in production; new retention rules beyond the defaults; replacing the old viewers (they stay, pointing to the new screen).
