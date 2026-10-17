# 10 — Production release plan (proposal — nothing here has been run)

LOCAL ONLY. This is a plan for the owner to approve. **No push, merge, deployment or production migration has been done.** Each step needs the owner's explicit go-ahead, as the standing project rule requires ("get the user's explicit OK before every push/deploy"). Servers: app 10.0.1.98, database 10.0.0.205 (`ckdesk`), files on the NAS `CKDESK_DATA`; the old server 10.0.1.12 is retired and is not used. Deploy and rollback mechanics are in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`.

## What is being released

| Release | Content | Depends on |
|---|---|---|
| **R-A: framework** | Next.js 16.2.9 → 16.3.8 (production audit 9 → 0). Independent branch `release/p0-framework-next-16.3.8`; no feature change. | nothing |
| **R-B: application** | All code changes of this remediation (server-only writes, permission matrix + 6 owner switches, mail HTML cleaning, shared limits, display-name rules, double-submit protection, …). Works on the **old** database (proven: tests s0 run with the new app on the baseline schema). | R-A (or can be combined if the owner prefers one step) |
| **R-C: database** | Migrations 164 → 171, in order, each with an exact rollback in `supabase/rollback/`. | R-B already live |
| **R-D: HTTPS** | Certificate + reverse proxy (owner decision D-1). | owner decision |

Why this order: the rehearsal on a rebuilt copy of the production schema proved that the **new app works before the migrations** (it tolerates the missing `added_by` column and writes with the server key where users lost table rights), while the **old app does not work after migration 165**. So the app must be live first, then the database. This order is therefore *proven*, not assumed. The proof and the logs are in `rehearsal/` and `04-VAPT-RETEST-RESULTS.md`.

## Before anything (pre-flight; reads only)

1. **Backup:** the nightly task `CK_Backup_CKDESK` (02:30, dump to `E:DB BACKUPCK_CKDESK_DBBACKUP` on 10.0.0.205) exists; before the database step also run it by hand (or take a manual `pg_dump -Fc`) and check `backup.log` says OK. Write down the current git commit (`717e5c6`), the live build id (`20261015-145217`) and the rollback folder on 10.0.1.98.
2. **Restore test:** restore that dump into a scratch database (never into `ckdesk`) and confirm row counts. A backup that has not been restored is not a backup.
3. **Compare real grants:** run the privilege-state query (`rehearsal/privs.sql`) against production and compare with the rehearsal baseline. Any difference means production differs from what was rehearsed — stop and look.
4. **Live facts, read-only (checked on 2026-10-17 unless marked "you")**: (a) sign-up in the login service is **disabled** (checked); the anonymous key sees no tables (checked); (b) live runs build `20261015-145217`, all five `CkDesk*` services and all seven scheduled tasks are healthy, disk space is ample (checked); (c) the live `.env.local` has **only `CRON_SECRET`** — none of the per-purpose secrets exist (checked). The new code switches approval links, rating links, mailbox sign-in, mail webhooks, the intake worker and the log intake **off** when their own secret is missing, so the first deploy must carry `ALLOW_SHARED_SECRET_FALLBACK=1` in `appstandalone.env.local` (everything keeps working exactly as today and already-sent approval links stay valid); per-purpose secrets are introduced later as a separate, planned step; (d) `TRUSTED_PROXY_HOPS`: there is **no reverse proxy** in front of the app today (the public address forwards straight to port 3210), so leave it **unset** (the safe default); set it to 1 only when the HTTPS proxy is added; (e) **you** run `live-readonly/live-readonly-check.sql` on the DB server (read-only; you type the password) and give me the output: it counts accounts still on the old shared password, accounts with a pending forced password change, and lists table/function/policy rights so they can be compared with the rehearsed baseline. Do this before any migration.
5. **Owner choices that change the first run:** onboarding mode (D-6); scanner (D-10); the six policy switches stay at their defaults unless decided.
6. **Window:** pick a quiet window; tell users; keep the old app folder.

## Steps

| # | Step | Check before moving on | Stop and roll back if |
|---|---|---|---|
| 1 | **R-A** deploy the framework branch (app only). Read-only smoke as in the rule above. | smoke passes; health route OK | any smoke step fails → put back the old app folder (11) |
| 2 | Soak R-A for a normal working day. | no new errors in System Log | errors that did not exist before |
| 3 | **R-B** deploy the application. Read-only smoke as above, then watch real work. | smoke passes with the **old** database | a screen shows empty data or a permission error that did not exist before |
| 4 | Take a fresh database dump. | dump verified | — |
| 5 | **R-C** apply 164, 165, 166, 167, 168, 169, 170, 171 **one at a time**, the project's documented way: on 10.0.0.205 you run `psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f <file>` (you type the postgres password) and then insert the version into `auth.schema_migrations` (never use `apply-migrations.ps1`); after each, restart `CkDeskPostgrest` on 10.0.1.98 (mandatory, it caches the schema) and run the quick smoke. | each migration reports no error; smoke passes | any error or smoke failure → run that migration's rollback, then the earlier ones in reverse (11) |
| 6 | Read-only smoke (above) as an existing requester, technician, manager, admin and the platform owner, plus 30 minutes of watching normal work. | all pass | any failure in sign-in, ticket create/update, approvals, attachments |
| 7 | Set the six policy switches if the owner decided differently from the defaults (D-2 … D-8). | audited in System Log | — |
| 8 | **R-D** HTTPS when the owner is ready; update the public URL, e-mail links and webhooks; verify cookies are marked Secure. | HTTPS works end to end | — |

## Rule for the live system: NO test or dummy data

**Nothing synthetic is ever created on the live system** — no test tickets, comments, uploads, users, approvals, exports or mails. Everything that creates data was tested on the isolated copy only. On live, verification is **read-only**, done with real existing accounts (the owner's / IT head's own, or a technician who volunteers) and by watching the real work:

- Health route answers `{"status":"ok","db":"ok"}`; the version route shows the new build id.
- Sign in with an existing account; the home page loads; an existing ticket opens; the requester-side History tab of an existing ticket (use your own ticket, or look with a manager account) shows no internal notes; an existing attachment opens (proves the file store works).
- Admin → Users list loads; Platform Settings opens for the owner and shows the six policy switches at their defaults; Reports page opens (viewing only, no export); System Log opens and `select count(*) from system_log_verify_chain(...)` returns no row (read-only).
- For 30 minutes after each step, technicians simply carry on with their normal work; the System Log and the service logs on 10.0.1.98 are watched for errors (read-only).
- The database migrations insert **no data**: they create empty tables and functions and change rights and rules. The only change to existing rows is one correction in migration 164 (files attached to internal notes are flagged internal so requesters cannot read them); the number of rows it will touch can be counted beforehand with a read-only query.

What was tested only on the isolated copy (never on live): creating tickets (including double-click), uploads of 10–25 MB, approval by e-mail link with the code, exports, password reset and forced change, report e-mails, webhook replay and spoofing.

## What each environment change does to users

- Existing sessions keep working.
- After 168, an account that was forced to change its password but never did can no longer use the application until it does.
- After 169, the **old** app would show requesters an empty History tab — another reason the app goes first.
- After 170, ordinary users see fewer names in people lists (only themselves, their manager, their reports and people on their tickets). Staff are unaffected.
- Uploads of Office files with macros are refused unless `ALLOW_MACRO_OFFICE_FILES` is set.

## Things that are NOT done by this release

HTTPS (D-1), a malware scanner (D-10), the six management decisions (D-2 … D-8), the HR/Finance confidentiality tier (D-9), organisation evidence for ISO 27001 / SOC 2. See `12-FINAL-RELEASE-GATE.md`.
