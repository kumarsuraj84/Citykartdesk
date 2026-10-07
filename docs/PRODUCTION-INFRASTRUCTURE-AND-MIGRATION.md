# Citykart Desk — Production Infrastructure, Deployment & Migration Runbook

**Status as of 2026-10-07.** This is the source of truth for where Citykart Desk runs and how it is
deployed. Older documents in this repo that mention `10.0.1.12` ("Main") describe the *previous*
production server, which is **retired**; treat them as history.

> No passwords, keys or tokens are written in this file — only *where* they live. Never add secrets
> to the repo. Never ask a user to paste a password into chat; they type it on the server.

---

## 1. The big picture

```
 Staff / requesters (office LAN or internet)
        │  http://182.72.84.10:3210   (public IP; router NAT forwards TCP 3210 → 10.0.1.98)
        │  http://10.0.1.98:3210      (same app, internal address)
        ▼
 ┌─ APP SERVER 10.0.1.98 (Windows Server 2022) ──────────────────────────────────────────┐
 │  D:\Citykart_Applications\Citykart_Ckdesk_App                                          │
 │                                                                                        │
 │  CkDeskApp      Next.js web app (server.js)          :3210  (only port open to LAN)    │
 │     │  all data access is HTTP via supabase-js — the app never talks to Postgres       │
 │     ▼                                                                                  │
 │  CkDeskProxy    node reverse proxy                    :8443  (the "Supabase URL")      │
 │     ├─ /auth/v1     → CkDeskAuth       (GoTrue, auth.exe serve)     127.0.0.1:9999     │
 │     ├─ /rest/v1     → CkDeskPostgrest  (PostgREST 16)               127.0.0.1:3001     │
 │     └─ /storage/v1  → CkDeskStorage    (Supabase Storage, node)     127.0.0.1:5000     │
 │                                                                                        │
 │  Task Scheduler: CitykartDesk-Cron-Alerts (30 min), -BusinessRules (15 min),           │
 │                  -EmailReplySync (1 min)  → call the app on 127.0.0.1:3210             │
 │  Outbound: Gmail SMTP (send) + IMAP (reply sync), settings saved in the app            │
 └───────┬───────────────────────────────────────────────────────┬────────────────────────┘
         │ Auth / PostgREST / Storage connect as role             │ Storage reads/writes files
         │ citykart_desk_app, TCP 5432                            │ as Windows user ckappuser (SMB 445)
         ▼                                                        ▼
 ┌─ DB SERVER 10.0.0.205 ───────────────────┐   ┌─ NAS 10.0.0.25 (Synology RS1221+) ─────────┐
 │ PostgreSQL 18, data on D:\POSTGRESQL DB  │   │ \\10.0.0.25\CKAPPLICATIONS_DATA\CKDESK_DATA │
 │ database  ckdesk  (UTF8)                 │   │ attachments (+ a *.xattrs.json sidecar per  │
 │ SHARED with other apps' databases        │   │ file — that is why 215 objects = 431 files) │
 │ Nightly backup 02:30 → E:\DB BACKUP\     │   └─────────────────────────────────────────────┘
 │ CK_CKDESK_DBBACKUP (+ backup.log)        │
 └──────────────────────────────────────────┘
 Dev PC 10.0.0.47 ──git──▶ GitHub (kumarsuraj84/Citykartdesk, branch main) ──▶ deploy to 10.0.1.98
```

**Shared servers — scope rules.** 10.0.1.98 also runs *Citykart Spinwheel* (internal ports 3000 and 4000,
public port 3213, Windows scheduled tasks `CitykartSpinwheel*`). 10.0.0.205 also hosts the Spinwheel
database (`CKSpinwheel`) and others. For Citykart Desk work touch **only**:
the `Citykart_Ckdesk_App` folder, the `CkDesk*` services / `CitykartDesk-Cron-*` / firewall rule
"Citykart Desk web app (3210)" on 98; the database `ckdesk` (and its backup task/folder) on 205;
the `CKDESK_DATA` folder on the NAS. Ports in use on 98 are listed in `D:\Citykart_Applications\PORTS.md`
— add a line there before giving any app a new port.

## 2. Servers, paths and names

| What | Value |
|---|---|
| Dev machine | 10.0.0.47 (this repo; all development/testing happens here — never experiment on production) |
| App server | 10.0.1.98 — `D:\Citykart_Applications\Citykart_Ckdesk_App\{app,services,logs,tools,scripts}` |
| Web app files | `app\standalone` (Next.js standalone build, with its own `.env.local`), previous builds `app\standalone-bak-<timestamp>` |
| Services (NSSM, `tools\nssm.exe`) | `CkDeskApp`, `CkDeskProxy`, `CkDeskAuth`, `CkDeskPostgrest`, `CkDeskStorage` — start type Automatic; logs in `logs\<Service>.out.log / .err.log` (10 MB rotation) |
| Cron tasks | `CitykartDesk-Cron-Alerts`, `-BusinessRules`, `-EmailReplySync` (SYSTEM). Runner: `app\scripts\windows\run-cron-tick.ps1` (needs only `CRON_SECRET` from `app\.env.local`) |
| DB server | 10.0.0.205 — PostgreSQL 18 (`C:\Program Files\PostgreSQL\18`), data `D:\POSTGRESQL DB`, database `ckdesk`, app role `citykart_desk_app` (not superuser) plus roles `anon`, `authenticated`, `service_role` |
| Backups | scheduled task `CK_Backup_CKDESK` 02:30 daily → `E:\DB BACKUP\CK_CKDESK_DBBACKUP` (generic script `C:\ProgramData\CKBackup\backup-db.ps1`, backup role `ck_backup` with BYPASSRLS, 30 days kept, `backup.log`) |
| Files | NAS 10.0.0.25, share `CKAPPLICATIONS_DATA`, folder `CKDESK_DATA`, NAS user `ckappuser` |
| Public URL | `http://182.72.84.10:3210` (also the URL used in emails). 3213 is Spinwheel — do not mix up |
| SSH (admin PC key) | `ssh -i ~/.ssh/citykart_newservers Administrator@10.0.1.98` (and `@10.0.0.205`) |

## 3. Configuration and where secrets live (names only)

| File on 10.0.1.98 | Holds |
|---|---|
| `app\standalone\.env.local` | `NEXT_PUBLIC_SUPABASE_URL` (`http://10.0.1.98:8443`), `NEXT_PUBLIC_APP_URL` (public URL), anon + service-role JWT keys, `CRON_SECRET`, `TZ=Asia/Kolkata`, `PORT=3210` |
| `app\.env.local` | `CRON_SECRET` only (read by the cron runner) |
| `services\auth\.env` | DB URL, `GOTRUE_JWT_*` secrets, `GOTRUE_SITE_URL` (public URL), allow-list (public + `10.0.1.98:3210`) |
| `services\postgrest\postgrest.conf` | DB URI, JWT secret; PostgREST needs the libpq DLLs sitting next to `postgrest.exe` (no PostgreSQL client is installed on 98) |
| `services\storage-src\.env` | DB URL, JWT/encryption secrets, `STORAGE_BACKEND=file`, `STORAGE_FILE_BACKEND_PATH=\\10.0.0.25\CKAPPLICATIONS_DATA\CKDESK_DATA` |

* The JWT secret is shared by the services and signs the anon/service keys baked into the build. **Do not change it** without rebuilding and re-issuing keys — everyone would be logged out and the app would break.
* `NEXT_PUBLIC_*` values are inlined at **build time** (client and server). Changing an address means a rebuild + redeploy.
* **The mailbox (Gmail) password** is saved in the app (Admin → Platform Settings → Integrations) and stored encrypted in the database (`vault.secrets`, pgcrypto-based "Vault" shim: `supabase_vault` extension, files `supabase_vault.control` / `supabase_vault--1.0.sql` in PostgreSQL's `share\extension`). The encryption key is the **database setting `app.vault_key`** (plus `search_path = public, auth, extensions`) — see §6 for why this matters for restores.
* The storage service runs as the local Windows user `ckappuser` (same name/password as the NAS user) so it can open the NAS share. Change that password in **both** DSM and `nssm set CkDeskStorage ObjectName .\ckappuser <password>` (typed by the user on the server).

## 4. Deploying a new version (what "commit and push to git and main" means)

1. Develop and test on the dev PC. Run `npx tsc --noEmit` and the relevant tests.
2. Get the user's explicit OK, then commit and `git push origin main`.
3. Build for production on the dev PC (this stamps a build id; temporarily stash `.claude/settings.local.json` — it must never be committed):
   `scripts\windows\build-for-deploy.ps1 -SupabaseAnonKey <NEXT_PUBLIC_SUPABASE_ANON_KEY from 98's app\standalone\.env.local> -ZipPath <zip>`
   (defaults are already `-SupabaseUrl http://10.0.1.98:8443 -AppUrl http://182.72.84.10:3210`; it uses `.next-deploy`, never the dev server's `.next`).
4. Copy the zip to 98, then on 98: `Stop-Service CkDeskApp`; rename `app\standalone` → `app\standalone-bak-<yyyyMMdd-HHmm>`; expand the zip to `app\standalone`; copy `.env.local` back from the bak folder (keep `NEXT_PUBLIC_APP_URL` = the public URL); `Start-Service CkDeskApp`. Remove older bak folders, keep the latest one.
5. Verify: `http://127.0.0.1:3210/api/health` → `{"status":"ok","db":"ok"}`; `/api/version` → the new build id. Open pages show a "new version available — refresh" bar to users who have an older build loaded.
6. **Rollback:** stop `CkDeskApp`, rename the folders back, start it. App rollback never reverses a database change (see 5).

## 5. Database migrations

* Migration files live in `supabase/migrations`. The migration history is tracked in `auth.schema_migrations` (shared with GoTrue's own rows). **Never** use `deploy\windows\apply-migrations.ps1` — it assumes a different history table.
* Tables/schemas in `ckdesk` are owned by `postgres`, so DDL must be run by the PostgreSQL admin. The user runs it on 10.0.0.205 (they type the `postgres` password):
  `psql -U postgres -h localhost -d ckdesk -v ON_ERROR_STOP=1 --single-transaction -f <file.sql>`,
  then insert the version into `auth.schema_migrations`. Always back up first (run `CK_Backup_CKDESK`, or take a manual `pg_dump -Fc`), and deploy the migration **before** the code that needs it.
* New `request_status`-style enum values etc. must be committed in their own migration (see existing examples).
* The app role (`citykart_desk_app`) cannot read rows directly because of row-level security; for diagnostics connect and `SET ROLE service_role`.

## 6. Backups and restore

* Nightly full dump (`pg_dump -Fc`, integrity-checked with `pg_restore --list`) of `ckdesk` at 02:30, 30 days kept, `backup.log` records OK/FAILED per run. **Check the log after changes to the DB.** `ck_backup` needs `BYPASSRLS`, otherwise the dump fails on `auth.audit_log_entries`.
* Attachments are on the NAS (RAID/snapshots are the NAS's job). DB dump and files should be considered together when restoring a point in time.
* **The dump does NOT contain** (a) the database settings `app.vault_key` / `search_path`, nor (b) the `vault.secrets` rows (extension-owned table). After restoring a dump into a fresh database you must: create the database with owner `citykart_desk_app` and the roles above; restore as `postgres` (`pg_restore -U postgres -d ckdesk <dump>`); then
  `ALTER DATABASE ckdesk SET search_path = public, auth, extensions;` and `ALTER DATABASE ckdesk SET app.vault_key TO '<any new random 64-hex value>';` and **re-enter the mailbox password** in Platform Settings (the old encrypted secret cannot be decrypted without the old key). Restart the five `CkDesk*` services after a restore.
  *Recommended improvement:* extend the backup to also export the DB settings and the vault row, stored somewhere safe.
* **Not done yet:** a second copy of the dumps outside 10.0.0.205 (proposal: separate NAS share `CKAPPLICATIONS_BACKUP`, backup-only NAS user, 03:15 copy task, ~90 days, NAS snapshots, monthly restore test).

## 7. Operations checklists

**After a reboot of 10.0.1.98:** all five `CkDesk*` services Running; health OK; the three `CitykartDesk-Cron-*` tasks Ready with last result 0; an old attachment opens (proves the NAS login works); public URL answers; Spinwheel's tasks Running (look only).
**Service control:** `Get-Service CkDesk*`, `Restart-Service CkDeskApp`; start order if all are down: Postgrest, Auth, Storage, Proxy, App. Logs: `logs\*.log`. A service stuck in "Paused" under NSSM means the program exits immediately — run the exe by hand to see the error.
**Known gotchas:** `auth.exe` must be started with the `serve` argument (with no argument it runs migrations and exits); `PowerShell` functions must not use a parameter named `$args`; Windows services cannot use mapped drive letters — use the UNC path; scripts containing `\\` UNC paths must not be created through shell heredocs (backslashes get collapsed) — write them with an editor tool and verify on the server.
**Reply-by-email and notifications** need the mailbox saved in Platform Settings; if emails fail check `logs\CkDeskApp.err.log` for `notifications.email_failed`.

## 8. How the move from "Main" to this layout was done (2026-10-07)

Previously everything (app, PostgREST/Auth/Storage, PostgreSQL, files) ran on one server, 10.0.1.12 ("Main").
Sequence that worked: prepare 98/205/NAS → copy the services (without secrets) → create `ckdesk` and roles →
rehearse with a copy of Main's data (mailbox secret deliberately left out so no real mail was sent) →
freeze Main (stop the app and its cron tasks) → fresh `pg_dump`, fresh file copy, restore (as `postgres`)
including the mailbox secret and DB settings → mirror attachments to the NAS → start services and cron on 98 →
router forward 3210 → 10.0.1.98 → rebuild with the public URL for emails → disable Main permanently.
Lessons learned: see §7 "Known gotchas"; plus PostgREST on a machine without PostgreSQL needs libpq DLLs beside it; the
NAS share name must be exact; a test attachment uploaded before the NAS switch is stored in the wrong place (rehearsal only).

**Main (10.0.1.12) after the move:** its five Citykart Desk services are Stopped + Disabled, its cron tasks and the two firewall rules are disabled; `http://10.0.1.12:3210` and `:8443` must stay dead. Its old `citykart_desk` database is kept untouched as a safety archive and may be dropped by the user later. A final dump of Main's data is kept at `E:\DB BACKUP\CK_CKDESK_DBBACKUP\main_final_precutover_20261007.dump` on 10.0.0.205. Never run the old and the new system at the same time (two cron pollers / two databases = data conflict). Old links in emails sent before the move point at `10.0.1.12:3210` and no longer work (no redirect, by decision).

## 9. Rules for any AI session working on this app

* Production is 10.0.1.98 + 10.0.0.205 + NAS `CKDESK_DATA`. Do **not** work on or deploy to 10.0.1.12.
* Test locally on the dev PC only; ask the user before every push/deploy; one deploy at a time.
* Touch only Citykart Desk's own resources on shared servers (§1). Never read or change other apps' databases.
* Never ask for, accept or repeat passwords/keys; the user types them on the servers. Superuser database steps are run by the user.
* Commit messages end with the co-author line the user's tooling specifies.
* Update this document when infrastructure changes.

## 10. Open items

* Second (off-server) backup copy — deferred by the user.
* Reboot test of 10.0.1.98 — the user will do it and report.
* Later option: a DNS name with HTTPS (e.g. `desk.<company domain>`) instead of the raw public IP over HTTP.
* Drop Main's archived `citykart_desk` database after a couple of weeks of clean running (user decides).
