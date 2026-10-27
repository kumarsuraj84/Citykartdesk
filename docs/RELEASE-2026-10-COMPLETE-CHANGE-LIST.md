# Release 2026-10 — complete list of what is in the local code and not yet on `main` / live

Prepared 27 Oct 2026 by comparing `main` (= `origin/main` = `03959d0`, **live today**) with the local branch `release/all-pending-2026-10`.
The comparison was **read only** (no push, no change to `main`, nothing done on 10.0.1.98 / 10.0.0.205 / NAS).

## 0. In one page

| | |
|---|---|
| Live today | `main` `03959d0` (release 7: number and text limits), app build `20261022-154801`, database level **174** |
| Combined branch | `release/all-pending-2026-10` — `main` is already inside it, so `main` can simply be **fast-forwarded** (no merge commit, no conflict) |
| New commits | 40 (plus the merge of `main`) |
| Files | 378 changed: 27,058 lines added, 2,203 removed. About 8,400 lines of application code added, 1,270 removed |
| New database migrations | **10**: 175, 177, 178, 179, 180, 181, 182, 183, 184, 185 (there is **no 176**: the engineer-visit module was dropped). Each has a rollback file |
| New scheduled tasks on 10.0.1.98 | 3: Sheet Masters sync (11:00, 15:00, 19:00), AC PMS daily (09:00), Weather daily (08:00) |
| Removed from the product | the old "OEM bucket" and "CVM tag" admin screens (replaced by the Google sheets) |
| Tests | 2,431 + new ones: all pass (report: `qa-release-candidate-2026-10/07-REGRESSION-RESULTS.md`; merged-branch re-run: see section 9) |
| Code checks | `tsc` 0 errors, eslint 0 errors, **production build (`next build`) succeeded** on the combined branch |

## 1. New features (what users will see)

### A. Sheet Masters — Google Sheets become the master data (migration 175)
* Admin → **Sheet Masters**: connect the CK Desk Google account (view only), paste the link of the **AC**, **Genset**, **CVM** (and **AC PMS**) sheets; the sheets are copied into the database at 11:00, 15:00 and 19:00 and on the **Update from sheets now** button (30-second wait between presses). Nothing is ever written back to a sheet.
* **Master data health** list: every problem is shown with its row number, in plain words (duplicate AC number, bad e-mail, store not in the master, two genset rows…). A sheet that cannot be read keeps the **last good copy** and mails the administrators once.
* AC list for the requester comes from the sheet (only that store's active ACs; shown as the **CKDESK number only**; the floor, type, tonnage, brand and serial are kept for the OEM mail and for reports).
* The **OEM mail** for AC and Genset tickets uses the addresses from the sheet (To = OEM, CC = company people). Genset: one mail to every genset row of the store. Reopened ticket: mail again, marked REOPENED.
* **CVM** for automatic approval comes from the CVM sheet.
* AC master and Genset master screens (filters, counts, Excel download); store details (count of ACs, address, opening date) follow the AC sheet.
* Files: `lib/masters/*`, `app/(app)/admin/masters/*`, `app/api/masters/*`, migration 175.

### B. Vendor module — OEM engineers log in (migrations 177–181)
* Admin → **Vendors**: vendor companies; vendor **technician** and vendor **manager (view only)** logins.
* A vendor sees **only** tickets assigned to him: *Start working* (needs the OEM ticket number) → *Part required* (hold, no PO) → *Parts received* → *PO required* (items, price without GST, compulsory quote file) → approver may ask a **revised price** (quote versions) → approve with **PO number, PO date, PO document** or reject → *Resolve* (AC resolution + FSR file).
* **Purchase orders** register for staff, Excel export, vendor "My POs". PO approvers come from the AC sheet (`CK PO Approver Mail To`, several allowed, first decision wins).
* Mails for every step (store, vendor, approver, OEM PO mailbox); store notified of parts changes; vendor mail when Citykart ends the hold; REOPENED mail.
* **It does nothing until an administrator creates a vendor company, a vendor login and a Business Rule that assigns AC tickets to the vendor technician.** Without that, AC tickets behave exactly as today (OEM mail, then In Progress).
* Files: `lib/vendor/*`, `lib/actions/vendor*.ts`, `app/(app)/vendor*`, `app/(app)/purchase-orders`, migrations 177–181.

### C. AC PMS — preventive maintenance (migration 184)
* A fourth sheet (Store Code, AC PMS Date). At **09:00** on each PMS date one **AC PMS ticket per store** is made (a log makes sure no date creates two); a PMS category switch (`is_pms`) tells the system which category to use.
* Vendor sees PMS tickets in their own tab ("AC PMS tickets"), never mixed with normal tickets; lighter visit (no OEM ticket number; PMS report file).
* **Nothing happens until the PMS sheet is linked and the AC PMS service / category / sub category exist** (section 6 of the runbook).
* **The AC PMS service is hidden from requesters, technicians and managers** (catalogue, search, web address); only an administrator sees it; nobody else can raise an AC PMS ticket by hand, nor through mail / WhatsApp. Only the daily job makes them.

### D. Approval history box (migration 183)
* In the approval mail and on the approve page: the store's earlier requests of the **same sub category in the last 12 months** (who decided, when, which Qty), and the approved total. Per category switch (`show_approval_history`); migration 183 switches it on for every category that already has automatic CVM approval (Fixtures, Hangers, Fixture Attachments). The form fields shown (for example Qty) are ticked in the form builder.

### E. Ticket Calendar / AC Calendar on the Smart Dashboard (migration 182)
* Calendar for every group (colour by the group's own normal), machine mode for AC and genset (faulty units per day), repeat-fault ACs, "same issue again", break-down by technician / cluster / region / state / store / category, day pop-up.
* Daily **outside temperature** (Open-Meteo, 08:00 job) per city; needs outbound internet from 10.0.1.98 to `api.open-meteo.com`, `geocoding-api.open-meteo.com`, `archive-api.open-meteo.com` (only city names are sent).

### F. Smaller additions
* Mobile menu for vendor logins; Report Builder / dashboard accessibility; engineer-visit module **not included** (dropped).
* Docs and workbooks: guide for testers, management workbook, vendor mail map (`docs/`).

## 2. Existing behaviour that CHANGES on live (read this twice)

1. **AC and Genset OEM mail now reads the Google sheets.** The old OEM-bucket routing is retired. **If the sheets are not connected and copied on live, AC tickets are not mailed to the OEM and stay Open** (the AC Issues service is "quiet", so not even a note appears). The Google connection and the first copy must be done in the same window as the deploy (runbook section 7).
2. **The Admin "OEM" and "CVM tag" screens are gone.** Automatic CVM approval uses the CVM sheet.
3. **The AC picker in the ticket form** lists the store's ACs from the sheet (only the CKDESK number). A store with no row in the AC sheet has an empty list.
4. **Approval mails** of categories with automatic CVM approval get the new history box.
5. **A manager can no longer change categories, form templates and technician groups** through the data interface (migration 185); the screens were already admin-only.
6. **Sign-in, forgot-password and reset-password forms** now post (the password can no longer end up in the web address).
7. **Exports** (requests, tasks, projects, stores) now contain **all** rows (before, they stopped at 1,000 without any warning).
8. **Round robin** spreads a burst of tickets; the **System Log integrity check** checks the whole chain; an outage of the sign-in service or file storage now says so.
9. New sidebar items: Sheet Masters, Vendors (admin), Purchase orders (staff); an empty Purchase orders page is normal at first.

## 3. QA defects fixed in this release (21 found, 17 fixed — full list `qa-release-candidate-2026-10/15-MASTER-DEFECT-REGISTER.md`)

QA-D001 two sheet updates at once · D002 manager could change category switches (migration 185) · D003 password in the web address · D004 AC PMS routing · D006 obsolete "Visits" task · D007 approval history window · D008 double star label · D009 vendor phone menu · D010–D012 accessibility names, keyboard scrolling, pale text · D016 sign-in outage message · D017 storage outage message · D018 round robin burst · D019 integrity check beyond 500,000 rows · D020 exports cut at 1,000 rows · **D021 every sheet update added the AC sheet again** (found on the real 2,316-row sheet).

**Still open (your decision):** D005 Next.js 16.3.8 security advisories (fix = 16.4.3, trial passed, not applied) · D013 grey text colour (4.45:1) · D014 same approval decided twice stores two rows · D015 slow manager queue above 100,000 tickets.

## 4. Migrations (apply in this order, on 10.0.0.205, before the app)

| # | What it does | Rollback |
|---|---|---|
| 175 | Sheet Masters tables, Google credential helper functions | `175_sheet_masters_rollback.sql` |
| 177 | Vendor companies, vendor columns on profiles, row rules so a vendor sees only his tickets | `177_…` |
| 178 | Vendor "Part required" requests and items | `178_…` |
| 179 | PO fields, PO e-mails on AC rows, status-transition function update | `179_…` |
| 180 | Quote versions, revision note | `180_…` |
| 181 | PO approver e-mails from the sheet | `181_…` |
| 182 | Weather cache tables | `182_…` |
| 183 | `show_approval_history` on categories (on for categories with auto CVM approval) | `183_…` |
| 184 | AC PMS: PMS dates, ticket log, `is_pms`, sheet kind `pms` | `184_…` |
| 185 | Categories / form templates / technician groups: administrators and platform owners only | `185_…` |

All were rehearsed on the disposable test database: rolled back from 185 to 175, applied again in order (each in one transaction), then applied a second time (safe to repeat). None deletes data. Run them with `deploy-bundle-migrations-175-185/run-migrations.ps1` (backup first, stops at the first problem).

## 5. Files that change on the servers

* **App** (`app\standalone`): rebuilt from the combined branch (`scripts\windows\build-for-deploy.ps1`).
* **Scripts folder on 10.0.1.98 (`app\scripts`)**: `cron-tick.mjs` (three new job names) and `windows\` (`install-cron-tasks.ps1`, `add-masters-sync-task.ps1`, `add-pms-task.ps1`, `add-weather-task.ps1`) — these live **outside** `standalone`, so they must be copied separately.
* **.env**: **four new settings are needed on 10.0.1.98** (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`, `OAUTH_REDIRECT_BASE_URL`); they are not there today (checked over SSH). `deploy-app-2026-10-add-google-settings.ps1` adds them.
* **NAS**: nothing structural (section 8 of the runbook).

## 6. NOT in git, must be created on live by hand (data, not code)

| Item | Where on live | Local example (copy this) |
|---|---|---|
| Google connection | Admin → Sheet Masters → Connect | account `citykartdesk@citykartstores.com`, view only |
| 4 sheet links | Admin → Sheet Masters (AC, Genset, CVM, AC PMS) | ids are the same as local (see the runbook) |
| **AC PMS service / category / sub category / SLA / template** | Admin → Services, Categories, SLA, Form templates | see runbook section 6 — none of it exists on live today |
| Vendor companies, vendor logins, vendor Business Rules | Admin → Vendors, Business Rules | **leave empty until the vendor portal starts** (local has Voltas / Blue Star test data and `[LOCAL TEST]` rules — do **not** copy) |
| Default PO approver | Admin → Vendors | needed only when vendors start |

## 7. Left out of the push on purpose

Three local helper files that contain **local test passwords** stay on this PC and are not in git: `local-testing/README-LOCAL-TESTING.md`, `local-testing/seed-local-vendors.mjs`, `audit-2026-10/demo/seed-demo.mjs`. Also not pushed: your uncommitted `docs/VENDOR-EMAIL-MAP.xlsx` edit and `security-assessment-2026-10/05-REMEDIATION/perf-run.json`, the untracked zips/dumps/screenshots, `.qa-credentials.json`, mail-sink and database dumps. `.claude/settings.local.json` is already in `main` from an old commit (unchanged here).

## 8. All commits (oldest first)

| Commit | Date | Subject |
|---|---|---|
| dc07bbd | 2026-10-19 | LOCAL feature: AC, Genset and CVM Google Sheets as the master data (copied into PostgreSQL at 11:00, 15:00 and 19:00), AC choices per store in the ticket form, OEM e-mail |
| 7fcd8b7 | 2026-10-19 | Sheet Masters: reconnect button wording, admin page render test |
| 0ad4d03 | 2026-10-19 | LOCAL feature: engineer visit module (public /engineer page, daily visit code, store confirmation, 48h auto-resolve, parts to order), OEM e-mail again when a resolved AC  |
| d601b38 | 2026-10-19 | LOCAL feature: AC master and Genset master screens (filters, counts by brand/tonnage/region, Excel download) from the copied sheets; tests |
| d74a2e1 | 2026-10-19 | LOCAL: push plan with one branch per feature; tests ignore the local-only mail sink / demo switches; failing-OEM-mail test targets only the OEM mail |
| 5ce8ea4 | 2026-10-21 | Fix: an empty OAUTH_REDIRECT_BASE_URL setting is treated as not set (the return address to Google was only '/api/intake/oauth/callback') |
| fbfd08c | 2026-10-21 | Connect Google Sheets always shows the Google account chooser (the sheets are read as the CK Desk account) |
| fab7f38 | 2026-10-21 | gitignore: live data copy files for local testing |
| 7876653 | 2026-10-21 | gitignore: live people list for local testing |
| 86000d0 | 2026-10-21 | Form builder: the administrator sets the smallest and largest number (and whole numbers only) of a number field; checked in the browser and on the server; also on library |
| 3fe733e | 2026-10-21 | plan: release 7 (number field limits) |
| 90e816e | 2026-10-21 | Form builder: shortest / longest length of text fields |
| e22270e | 2026-10-21 | plan: release 7 also covers text length |
| f5dda28 | 2026-10-22 | Vendor technicians: OEM engineers log in, work their AC tickets (OEM ticket number, resolve with AC RESOLUTION + FSR), ask for parts or a PO (approval, PO register, Excel |
| 0d41f53 | 2026-10-22 | docs: release 7 is live |
| d47aabb | 2026-10-22 | Vendor: no doubled 'Parts received' in the conversation; demo ticket helper |
| b387a33 | 2026-10-23 | Vendor: quote versions, 'Revise price required' box, compulsory quote file, edit/withdraw requests, files tied to their conversation messages |
| d53bf55 | 2026-10-23 | Vendor: reject only the quote (ticket goes on, vendor arranges the parts), own mails for the vendor on PO approved / cancelled, Krishan told when a quote is withdrawn, ma |
| c10e037 | 2026-10-23 | docs: vendor mail map as a spreadsheet |
| 7991946 | 2026-10-23 | Vendor: PO approvers from the AC sheet (CK PO Approver Mail To, several allowed, first decision wins), renamed OEM mail columns, store mail on parts-list change, vendor m |
| f026ba6 | 2026-10-23 | Smart Dashboard: AC Calendar (green/yellow/red days by share of faulty ACs, grey future, place picker store/cluster/region/state, repeat-fault ACs, worst places) with dai |
| cc19bf0 | 2026-10-23 | AC Calendar follows the Smart Dashboard filters (group, technician, region ...) |
| 98e6146 | 2026-10-23 | Ticket Calendar for every group: named after the group, Service/Category/Sub category filters, machine mode (AC and genset) and ticket-volume mode (own usual level), brea |
| e607a96 | 2026-10-23 | docs: live (main) vs local comparison since 20 September |
| 2c7101d | 2026-10-23 | docs: CK Desk features by requester / technician / vendor with local and main status |
| c87df39 | 2026-10-23 | docs: detailed feature list (149 features) by area and role with local / main status and ManageEngine comparison column |
| 4f31dd8 | 2026-10-23 | docs: management workbook - live on main / ready to go live / future enhancements, with a sheet for user feedback |
| 2d73de7 | 2026-10-23 | docs: management workbook by journey (requester, technician, enhancements, vendor AC, future) with a complete feature sheet and a verification sheet; corrected genset aut |
| 67efe06 | 2026-10-23 | docs: management workbook - tidy verification sheet |
| 3371978 | 2026-10-26 | feat: approval mail and approve page show what the store asks now and the last decisions of the same store and sub-category (Qty etc. chosen per form field), switch per c |
| c07e185 | 2026-10-26 | feat: AC PMS - fourth master sheet (store code + AC PMS date), one ticket per store and date from 09:00 with a log so no date makes two tickets, AC PMS category setting,  |
| 0e5639f | 2026-10-26 | test: local demo data for the approval history box (earlier Fixtures / Hangers approvals of the ALC store) and its cleanup script |
| 52007e4 | 2026-10-26 | docs: complete architecture, features, workflows and test guide (for handing to another tester or AI model) |
| 59534a9 | 2026-10-26 | qa: local release-candidate QA 2026-10 - 19 defects found (15 fixed, 4 open), 2,431 tests run (2,413 passed, 0 failed, 18 skipped), 8 journeys, scale 3k/100k/500k, axe sw |
| a5a06eb | 2026-10-26 | qa: exports read in pages (were cut at 1,000 rows silently, QA-D020); export reconciliation test; Next.js 16.4.3 upgrade trial report (not applied) |
| 50c06d6 | 2026-10-27 | fix: sheet masters copy read only 1,000 stored rows, so every update re-added the rest of the AC sheet (QA-D021); read in pages; scale test |
| 9d0406c | 2026-10-27 | AC picker in the ticket form shows only the CKDESK number (floor, type, tonnage, brand stay in the database and in the saved AC details for the OEM mail and reports); tes |
| f932fcf | 2026-10-27 | Keep three local-only helper files (they contain local test passwords) out of the release; they stay on this PC, untracked |
| fa6bd36 | 2026-10-27 | Demo readme: no password text |
| a47c5ca | 2026-10-27 | Release bundle for migrations 175-185 (run sheet script with backup, ordered apply, checks; rollbacks) and a single-task installer for the Sheet Masters schedule; the old |

## 9. Evidence that the combined branch is sound

* `main` is an ancestor of the branch (a plain fast-forward will do); a trial merge was conflict-free.
* `tsc --noEmit`: 0 errors. `eslint`: 0 errors (5 old warnings). `next build`: succeeded, all routes compiled (including the new ones).
* Migrations: rehearsed (section 4). Rollbacks: executed once on the test database.
* Full test run on the combined branch: 2,442 tests, 2,424 passed, 0 failed, 18 skipped (WhatsApp, out of scope); `qa-release-candidate-2026-10/evidence/12-merged-regression-results.json`.
