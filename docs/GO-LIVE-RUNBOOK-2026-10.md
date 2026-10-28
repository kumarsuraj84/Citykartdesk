# Go-live runbook — Sheet Masters, Vendor module (dormant), AC PMS, Approval history, Ticket Calendar

For: pushing **everything that is local and not on `main`** in one go (see `docs/RELEASE-2026-10-COMPLETE-CHANGE-LIST.md`).
Servers: app **10.0.1.98**, database **10.0.0.205**, files **NAS 10.0.0.25**. Old server 10.0.1.12 is retired — never use it.
Nothing in this file has been done yet. Nothing is pushed. Tick each box as you go; **do not skip a step; do not change the order.**

> Rules: nobody pastes a password in chat — the person who knows the `postgres` password types it on 10.0.0.205 only. Touch only Citykart Desk's own folder, services, tasks (98), the `ckdesk` database (205) and `CKDESK_DATA` (NAS). Spinwheel and other apps are look-only.

---

## 0. What happens, in one picture (≈ 60–90 minutes, best outside office hours)

```
 A. Before the day      → decisions, checks, backups, announce
 B. Dev PC              → push the combined branch to GitHub main (fast-forward) and build the app zip
 C. 10.0.0.205 (DB)     → backup, run migrations 175 … 185, check
 D. 10.0.1.98 (app)     → restart CkDeskPostgrest, swap the app, copy scripts, add 3 scheduled tasks
 E. Live set-up (admin) → connect Google, link 4 sheets, AC PMS service/category/SLA, test ticket
 F. NAS                 → check space and that a new file lands in CKDESK_DATA
 G. Verify + monitor    → checklist, first scheduled runs, 24-hour watch
```
The **order D-after-C is mandatory**: new database first, then the app (the new app queries tables that do not exist before the migrations).
Steps **D and E must be done in the same window**: from the moment the new app runs, AC / Genset OEM mail reads the Google sheets; until they are connected and copied, AC tickets are **not** mailed to the OEM.

---

## A. Before the day

- [ ] **A1. Decide the Next.js security upgrade.** `next` 16.3.8 has critical advisories; the fix 16.4.3 was tried on a scratch copy and the whole suite passed (`qa-release-candidate-2026-10/20-NEXT-UPGRADE-TRIAL.md`). If yes: apply it **before** step B (`npm install next@16.4.3 eslint-config-next@16.4.3 --save-exact`, `npm run typecheck`, full tests), then build. If no: the release goes with 16.3.8 and the risk stays open.
- [ ] **A2. Real stakeholder sign-off** of the UAT sheet (`qa-release-candidate-2026-10/08-UAT-RESULTS-AND-SIGNOFF-PACK.md`) — at least the store user, technician, approver and administrator rows.
- [ ] **A3. Google sheets are final:** the four sheets show **"Reading fine"** on the local portal with only warnings you accept (check Admin → Sheet Masters on the dev PC; today: AC 2,296 rows 0 to fix; Genset 219; CVM 224; AC PMS as many dates as you set).
- [ ] **A4. Google connection from live — checked over SSH on 27 Oct: `appstandalone.env.local` on 98 has NONE of the four Google settings** (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`, `OAUTH_REDIRECT_BASE_URL`). Without them "Connect Google Sheets" answers *unconfigured*. The script `deploy-app-2026-10-add-google-settings.ps1` adds them (you type the client id and secret; the state secret is generated). Google also **refuses a plain `http://<public IP>` return address** (it accepts only `http://localhost:<port>`), so the one-time connection is made through an SSH tunnel from your PC: `ssh -i <key> -L 3211:127.0.0.1:3210 Administrator@10.0.1.98`, then open `http://localhost:3211` (sign in as administrator → Admin → Sheet Masters → Connect). In Google Cloud console add `http://localhost:3211/api/intake/oauth/callback` to the *Authorised redirect URIs* of the same OAuth client the local portal uses. **Try the tunnel + sign-in once before the window** (it also works with today's app for sign-in) so you know it works.
- [ ] **A5. (checked over SSH on 27 Oct: all reachable)** 10.0.1.98 can reach the internet outbound (HTTPS 443): `oauth2.googleapis.com`, `sheets.googleapis.com`, `api.open-meteo.com`, `geocoding-api.open-meteo.com`, `archive-api.open-meteo.com`. On 98 (PowerShell): `Test-NetConnection sheets.googleapis.com -Port 443` and the same for the others — each `TcpTestSucceeded : True`.
- [ ] **A6. Free space:** NAS `CKAPPLICATIONS_DATA` ≥ 20 GB free; 10.0.0.205 `E:\DB BACKUP` ≥ 5× the size of the last dump; `D:` on 98 ≥ 2 GB (a new standalone folder + the rollback copy).
- [ ] **A7. Nightly backup is healthy:** on 205 `E:\DB BACKUP\CK_CKDESK_DBBACKUP\backup.log` — last line OK.
- [ ] **A8. Write down the current state on 98** (for the rollback): `Get-Content D:\Citykart_Applications\Citykart_Ckdesk_App\app\standalone\.next\BUILD_ID` or open `http://127.0.0.1:3210/api/version` (today `20261022-154801`); `Get-ScheduledTask CitykartDesk* | ft TaskName,State`; `Get-Service CkDesk* | ft Name,Status`.
- [ ] **A9. Announce** a short maintenance window (users may see "new version available — refresh").
- [ ] **A10. Nobody creates vendor logins or vendor Business Rules in this window** (they stay off — section H).

---

## B. Dev PC (10.0.0.47) — push and build

The combined branch is `release/all-pending-2026-10`; **`main` (03959d0) is already inside it, so the push is a plain fast-forward.**

- [ ] **B1. Last local checks** (on the combined branch, clean tree for the files you intend to push): `npx tsc --noEmit` (0 errors) · `npm run lint` (0 errors) · the full test run (summary at the end of this file).
- [ ] **B2. Push (needs your explicit OK):**
  ```
  git switch release/all-pending-2026-10
  git fetch origin
  git merge-base --is-ancestor origin/main HEAD && echo "fast-forward is possible"
  git push origin release/all-pending-2026-10:main
  git tag release-2026-10-sheets-vendor-pms && git push origin release-2026-10-sheets-vendor-pms
  ```
  If `origin/main` has moved since `03959d0`, stop and re-do the merge first.
- [ ] **B3. Build the app** (stash `.claude/settings.local.json` changes; never commit it):
  `scripts\windows\build-for-deploy.ps1 -SupabaseAnonKey <NEXT_PUBLIC_SUPABASE_ANON_KEY from 98's app\standalone\.env.local> -ZipPath <path>\ckdesk-20261027.zip` (defaults are already `-SupabaseUrl http://10.0.1.98:8443 -AppUrl http://182.72.84.10:3210`; it builds with webpack into `.next-deploy`).
  Check: the zip is about **20–25 MB** (a much bigger zip = `node_modules` junction problem, see `PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` and the release-7 note).
- [ ] **B4. Copy to 98:** the zip, the folder `deploy-bundle-migrations-175-185` (to 205), and the `scripts` folder (cron-tick + windows).

---

## C. Database server 10.0.0.205 — run by the person who knows the `postgres` password

- [ ] **C1.** Copy `deploy-bundle-migrations-175-185` to 205 (e.g. `E:\DB BACKUP\release-2026-10\`).
- [ ] **C2.** Open PowerShell on 205, `cd` into that folder, then:
  ```
  $env:PGPASSWORD = Read-Host "postgres password"
  .\run-migrations.ps1
  ```
  The script: shows counts BEFORE → **refuses to run unless migration 174 is recorded** → makes a full backup (`ckdesk-before-175-185-<time>.dump`) and checks it can be read back → applies 175, 177, 178, 179, 180, 181, 182, 183, 184, 185 **one by one, each in one transaction** (all-or-nothing), recording each → shows counts AFTER (**the same as BEFORE**) → lists the new tables / columns (**every line must say 1**) and the three admin policies.
- [ ] **C3.** Read the screen: the last line must be `DONE`. If it says `STOPPED`, **do not continue**; keep the log file (next to the script) and the backup; nothing after the failing file ran.
- [ ] **C4.** Keep the log file and the backup file. Copy the backup also to a second place if you can.
- [ ] **C5.** (Optional but advised) `psql -U postgres -h localhost -d ckdesk -c "select count(*) from auth.schema_migrations where version like '20240101%'"` — 10 more than before.

**Rollback of the database (only if needed, newest first, each in `--single-transaction`):** `supabase\rollback\185_…` down to `175_…` (files are inside the bundle's `rollback` folder; there is no 176). Or restore the backup (`pg_restore`) — only with the app stopped.

---

## D. App server 10.0.1.98

> Do D1 **after** C is `DONE`. Do D1…D8 in one go.

- [ ] **D1. Restart PostgREST** (it caches the schema): `Restart-Service CkDeskPostgrest`; wait 10 seconds; `Get-Service CkDesk*` all Running.
- [ ] **D2. Copy the scripts** (they live **outside** `standalone`): replace `D:\Citykart_Applications\Citykart_Ckdesk_App\app\scripts\cron-tick.mjs` and add/replace `app\scripts\windows\{install-cron-tasks.ps1, add-masters-sync-task.ps1, add-pms-task.ps1, add-weather-task.ps1}`. Keep `run-cron-tick.ps1` and `app\.env.local` (CRON_SECRET) as they are. *(Scripts containing `\\` paths must be written with an editor tool and checked on the server, not created through shell heredocs.)*
- [ ] **D3. Swap the app:** `Stop-Service CkDeskApp`; rename `app\standalone` → `app\standalone-bak-<yyyyMMdd-HHmm>`; expand the zip to `app\standalone`; copy `.env.local` from the bak folder into the new `app\standalone` (keep `NEXT_PUBLIC_APP_URL` = the public URL); `Start-Service CkDeskApp`.
- [ ] **D4. Health:** `http://127.0.0.1:3210/api/health` → `{"status":"ok","db":"ok"}`; `http://127.0.0.1:3210/api/version` → the **new** build id. Open `http://182.72.84.10:3210/login` from outside the server: the login page opens.
- [ ] **D5. Check the logs** `logs\CkDeskApp.err.log` has no new `Error` lines for the last 2 minutes.
- [ ] **D6. Add the three scheduled tasks** (PowerShell as Administrator, **after** the app is running; each script touches only its own task):
  ```
  D:\Citykart_Applications\Citykart_Ckdesk_App\app\scripts\windows\add-masters-sync-task.ps1   # 11:00 / 15:00 / 19:00
  D:\Citykart_Applications\Citykart_Ckdesk_App\app\scripts\windows\add-pms-task.ps1            # 09:00
  D:\Citykart_Applications\Citykart_Ckdesk_App\app\scripts\windows\add-weather-task.ps1        # 08:00
  ```
  Do **not** run `install-cron-tasks.ps1` (it re-registers every task). If an old `CitykartDesk-Cron-Visits` task exists on 98: `Unregister-ScheduledTask -TaskName 'CitykartDesk-Cron-Visits' -Confirm:$false`.
  Check: `Get-ScheduledTask CitykartDesk-Cron-* | ft TaskName,State` — the old tasks still there + 3 new, all `Ready`.
- [ ] **D7. Do not run the new tasks yet** — go to E first (they do nothing harmful without the Google connection, but the first run should be the one you watch).
- [ ] **D8. Keep the previous folder** `standalone-bak-<stamp>` until the 24-hour watch is over (older baks may be removed).

**Rollback of the app:** `Stop-Service CkDeskApp`; rename `standalone` → `standalone-failed`; rename the bak back to `standalone`; `Start-Service CkDeskApp`. The old app is **expected** to work on the new database (the migrations only add tables, columns, and replace row rules), but this was not tested; the safe full rollback is "old app + restored backup".

---

## E. Live set-up in the admin screens (data, not code) — administrator `…@citykart` signed in at `http://182.72.84.10:3210`

### E1. Google Sheets
- [ ] Admin → **Sheet Masters** → *Connect Google Sheets* → choose `citykartdesk@citykartstores.com` → allow **view only**. The page says "Connected as citykartdesk@citykartstores.com (view only)".
- [ ] Paste the four links (same sheets as local) and press **Save** on each:

| Sheet | Id inside the link |
|---|---|
| AC DETAILS MASTER SHEET-ADMIN | `1Lx5I1qCIhZIFqBoYTPmZb3twkr6iKYybngkRch6azug` |
| GENSET Detail MASTER SHEET-ADMIN | `1hfG04Ti4DJMkq3mmLSPxQtSeQ9-u1mCNf6yrXdBO1Dw` |
| CVM Detail MASTER SHEET-ADMIN (for Approval) | `1U21PZbIM4xayhayIXQxYNnqb_Ni1NDyI4_j_uHzCJb4` |
| AC PMS MASTER SHEET | `1bCueXI-RBqs0Xng-eyWIaUSYwEifah_aO48mlL42PTQ` — **link this one only after E3 is done** |

- [ ] Press **Update from sheets now** (wait up to 30 seconds). Expect: AC / Genset / CVM **"Reading fine"**; AC about **2,296 active**; Genset **219**; CVM **224**; the health list has only warnings you know. **Press it a second time after 30 seconds: the numbers must NOT change** (this is the check for the bug that duplicated the AC sheet).
- [ ] Open a **test store** login (or an administrator on behalf of a test store): the AC picker lists that store's CKDESK numbers (1, 2, 3 …).

### E2. Make sure the OEM mail still goes (the real risk)
- [ ] Use **one store row you control**: temporarily set that store's *OEM Ticket Mail To* in the AC sheet to an **internal** address, press *Update from sheets now*, raise an AC ticket as that store, and confirm: the mail arrives at the internal address with the AC details; the ticket goes to **In Progress**; the conversation shows "Ticket sent to the AC OEM". Put the sheet back and update again. **Never test with a real store row** (the real OEM would get the mail).
- [ ] Do the same once for a **Genset** ticket (internal test row), then restore.
- [ ] Auto-CVM category (e.g. Fixtures): raise a test request as a test store; the CVM gets the approval mail **with the new "Earlier requests of this store" box**.

### E3. AC PMS set-up — none of this exists on live today (copy of the local set-up)

| Item | Setting (as on the local portal) |
|---|---|
| **Team** | ADMIN GROUP (already on live) |
| **SLA policy** — Admin → SLA | name **`AC PMS SLA`**: Urgent response 8 h / resolution 12 h · High 10 h / 14 h · Medium 16 h / 20 h · Low **24 h / 72 h** |
| **Form template** — Admin → Form templates | name **`AC- PMS TEMPLATE`** with two sections: *Requester Detail* (empty) and *Ticket Detail* with **Subject** (text) and **Description** (long text), both from the Field Library, requester can set and view |
| **Category** — Admin → Categories | name **`AC-PMS`**, slug `ac-pms`, switch **"AC PMS"** (`is_pms`) **ON**; automatic CVM approval OFF; OEM kind none; approval history OFF |
| **Sub category** (under that category) | name **`AC-PMS`**, slug `ac-pms`, priority **Low** |
| **Service** — Admin → Services | name **`AC-PMS`**, slug `ac-pms`, active, team ADMIN GROUP, template `AC- PMS TEMPLATE`, SLA policy `AC PMS SLA`, default priority **Low**; link the sub category `AC-PMS` to the service |
| **Who can see the service** | **Decided by you: hidden from requesters, technicians and managers; only an administrator sees it** (and can raise one by hand if ever needed). This is built into the code of this release (the catalogue, the search and the web address hide it; a ticket of an AC PMS category cannot be raised by a store, technician or manager, nor through mail / WhatsApp). The daily job is not affected. Nothing to set for visibility — just create the service as above. |
| **Business Rule** | **none on live for now.** (Local has `[LOCAL TEST] AC PMS tickets of Voltas/Blue Star go to a technician` — test data, **do not copy**.) PMS tickets stay Open for ADMIN GROUP until the vendor stage |

- [ ] After E3 is created: paste the **AC PMS** sheet link (E1), *Update from sheets now*. The health shows how many PMS dates are read; "AC PMS tickets (n PMS dates still to come)" lists them. **A ticket is made only for a store whose PMS date is TODAY** (from 09:00; at the 09:00 run or at any sheet copy later that day). A date that has already passed is never made. Only put real dates you want ticketed.
- [ ] If you do **not** want PMS tickets yet: leave the PMS link empty — nothing happens.

### E4. First runs of the scheduled tasks (watch them)
- [ ] Run once by hand and read the result: `Start-ScheduledTask CitykartDesk-Cron-MastersSync`; then in 20 seconds `Get-ScheduledTaskInfo CitykartDesk-Cron-MastersSync | select LastRunTime,LastTaskResult` → `0`. Same for `CitykartDesk-Cron-WeatherDaily` (needs the internet access of A5; first run fills the city table, it may take a few minutes). `CitykartDesk-Cron-PmsDaily` only if E3 is done and PMS dates are meant to go.
- [ ] Sheet Masters page: "Last checked" moves after the scheduled run (11:00, 15:00, 19:00).

---

## F. NAS 10.0.0.25 — `CKAPPLICATIONS_DATA\CKDESK_DATA`

Nothing structural changes: no new share, no new user, no new bucket (the new features save quotes, PO documents, FSR and PMS reports in the same `request-attachments` area as today). Still check:

- [ ] **F1.** The app can still open an **old** attachment (open any old ticket with a file) — proves the NAS login of `ckappuser`.
- [ ] **F2.** Upload a small file to a **test ticket** (e.g. the AC test ticket of E2); then on the NAS, in `CKDESK_DATA`, the new file and its `*.xattrs.json` sidecar appear (look at the newest files).
- [ ] **F3.** Free space on the volume stays above the limit of A6; snapshots / RAID health is the NAS's job — note the time of the release for a possible restore point.
- [ ] **F4.** Restore thinking: DB dump + NAS files belong together; the backup of step C2 is the DB part of this release's restore point.

---

## G. Verification and watch

**Immediately (10 minutes)**
- [ ] Login page and Home open from outside (`http://182.72.84.10:3210`); a requester, a technician, a manager and an administrator can each sign in.
- [ ] New Request → AC Issues: the AC list shows only CKDESK numbers; submit a test ticket (E2) → mail + In Progress.
- [ ] A normal (non-AC) ticket is raised, assigned, worked, resolved (nothing else broke).
- [ ] Smart Dashboard opens; the **Ticket Calendar** opens (AC/genset mode shows data after the first weather run).
- [ ] Reports → **Export CSV** of requests: the file has as many rows as the screen count.
- [ ] Admin → **Sheet Masters**, **Vendors**, **Purchase orders** pages open (Vendors and Purchase orders are empty — that is correct).
- [ ] A manager login cannot open Admin pages (it is redirected).

**Within 24 hours**
- [ ] 11:00 / 15:00 / 19:00 sheet copies ran (Sheet Masters "Last checked"), no new red error, AC count unchanged (no duplication).
- [ ] 08:00 weather run `LastTaskResult 0`; 09:00 PMS run `0`.
- [ ] `logs\CkDeskApp.err.log` and `CkDeskPostgrest` logs: no repeated errors.
- [ ] The nightly backup at 02:30 shows OK in `backup.log`.
- [ ] Nobody reports "AC ticket stayed Open / OEM did not get the mail" — if they do: first look at Sheet Masters health for that store's code.

---

## H. Keep OFF until the vendor portal starts (later, one step at a time)

- No vendor company, vendor login or vendor Business Rule on live. **AC tickets keep going: OEM mail → In Progress**, exactly as today. A ticket stays Open **only** when a Business Rule has assigned it to a vendor technician.
- When the vendor is ready: (1) Admin → Vendors → company + logins; (2) the default PO approver; (3) the AC template must have the three technician-only boxes *AC OEM Ticket Number*, *AC OEM Ticket Creation Date*, *AC resolution* (they exist in the local AC template — verify on live); (4) **one** Business Rule for **one vendor** and a few stores first (condition: category AC + `ac_amc_vendor` contains the vendor); watch a week; widen vendor by vendor. To undo: switch that rule off.

---

## I. If something goes wrong — who does what

| Where it stops | Do this |
|---|---|
| C2 says `STOPPED` | Do not continue. Nothing after the failing file ran. Keep the log + backup. The app is still the old one and works on the old database. |
| App does not start after D3 | Rollback of the app (end of section D). Database stays at 185 (safe: additive). |
| Google refuses the connection (E1) | The OEM mail for AC / Genset tickets will not go. Roll the **app** back (old OEM-bucket routing) until the connection route is solved; the database can stay. |
| Sheet copy shows duplicates (AC count rises) | Stop the MastersSync task (`Disable-ScheduledTask`), tell the developer; do not press the button again. (Fixed in this release — the check in E1 proves it.) |
| Anything unclear | Stop, keep the logs, ask. Never "just run it again". |

---

## J. Results of the checks done before this runbook (evidence)

* `main` (03959d0) is inside the combined branch; trial merge had no conflict.
* `tsc` 0 errors; eslint 0 errors; **`next build` succeeded** on the combined branch.
* Migrations 175–185: rolled back from 185 to 175 and applied again in order, each in one transaction, then applied a second time — all OK on the disposable test database.
* Full regression on the combined branch: see the line below (filled after the run).

**Final result (27 Oct, after the AC PMS hiding change): 2,452 tests in one clean run: 2,434 passed, 0 failed, 18 skipped (WhatsApp, out of scope)** (`qa-release-candidate-2026-10/evidence/13-final-regression-results.json`). Earlier run on the same branch: 2,442 tests in one run on the combined branch: 2,423 passed, 18 skipped (WhatsApp, out of scope), 1 failed — the failing one (VAPT-019 *staff see everybody*) failed only because the disposable test database had collected 1,009 test people and one list is cut at 1,000; after removing the 654 leftover test users it passed (15/15). So: **2,424 passed, 0 failed, 18 skipped.** Evidence: `qa-release-candidate-2026-10/evidence/12-merged-regression-*`.

## K. Facts found over SSH on 27 Oct (read only)

* **10.0.1.98:** services CkDeskApp / Auth / Postgrest / Proxy / Storage all Running; live build `20261022-154801`, health ok; seven scheduled tasks (Alerts, ApprovalReminders, BusinessRules, Csat, EmailReplySync, SystemLogArchive, LogShipper) all Ready, last result 0; folder `appscripts` holds the OLD `cron-tick.mjs` (15 Oct) and no add-*-task scripts for the new jobs; D: 395 GB free; outbound HTTPS to Google and Open-Meteo works; 98 reaches 10.0.0.205:5432; `.env.local` has no Google settings (see A4).
* **10.0.0.205:** PostgreSQL 18 service Running; psql / pg_dump / pg_restore present; nightly backup 02:30 OK every day (last `ckdesk_20261027_023001.dump`, 4.9 MB); E: 884 GB free; no migration bundle on the server except an old `D:ck-migration`. The database level (174) could not be read without the postgres password: the migration script checks it itself.
* **NAS:** from the SSH session the share path was not visible (the SSH login is not the NAS user `ckappuser`); that proves nothing about the app, which runs as `ckappuser`. Check by opening an old attachment in the app (step F1).
