# Live server vs local build - what is pending (checked 2026-10-22, read only)

> **Update 2026-10-22 15:50:** release 7 (number and text limits) was pushed on your word and is now LIVE (main 03959d0, build 20261022-154801, no database step, rollback folder standalone-bak-20261022-1549). Everything else below is still pending.

Nothing was changed on the live servers for this report. Only read-only looks were taken: the live address (`/api/version`, `/api/health`), the list of services, folders, scheduled tasks and setting NAMES on the app server 10.0.1.98 (secret values were masked). The database server 10.0.0.205 was not queried (that needs the postgres password, which only you type); its level below comes from our records and can be confirmed with the read-only script in section 6.

## 1. What is live now

| Item | Live today |
|---|---|
| App version | Build **20261019-112419** = git `main` (same code as `main` 516c874; the later commits there are only documents). Health: OK, database OK. |
| App server 10.0.1.98 | The five Citykart Desk services (App, Auth, Postgrest, Proxy, Storage) are **Running**. Rollback folders kept: `standalone-bak-20261015-1453`, `standalone-bak-20261019-1026`, `standalone-bak-20261019-1128`. |
| Database 205 (`ckdesk`) | At migration **174** (applied 2026-10-19 by you; we have no later record). |
| Scheduled tasks on 98 | Alerts, ApprovalReminders, BusinessRules, Csat, EmailReplySync, SystemLogArchive, LogShipper. **No** task for the sheets sync (and none for visits). |
| Settings on 98 | Supabase address, public address `http://182.72.84.10:3210`, cron address, `CRON_SECRET`, and the temporary `ALLOW_SHARED_SECRET_FALLBACK=1`. **No Google settings, no sheet settings.** |
| Feature level | Security release (Next 16.3.8), no manual priority change, OEM by type, store CVM, automatic CVM approval, Qty by category, interactive dashboard, reports, WhatsApp/e-mail intake (as before). |

## 2. What is built only on this PC (14 commits, none pushed)

| # | Feature | Plain words | Database step on 205 | New on the server | Needs first | Risk |
|---|---|---|---|---|---|---|
| 1 | **AC sheet is the master** | The AC Google Sheet is copied into our database 3 times a day (11:00, 15:00, 19:00) and by an "Update now" button. The ticket form shows the store's own ACs; the OEM e-mail comes from the sheet; the same mail goes again when a store reopens a resolved ticket. | Yes, migration 175 (new tables only, nothing existing changes) | A scheduled task for the sync; a **Google connection** (citykartdesk@ account, Sheets API, a redirect address - the public http address cannot be used, so a one-time local/tunnel step is needed); the sheet address in Admin | nothing | **Medium** (live AC tickets change how they reach the OEM; fully switchable off per sheet) |
| 2 | **Genset sheet** | Same idea for gensets: one mail to every OEM address of the store's genset rows. | Yes, 176 | Switch on in Admin after 1 | 1 | Low-Medium |
| 3 | **CVM sheet** | The store's CVM comes from the CVM sheet; Fixtures / Hangers tickets go to that CVM for approval automatically. | Yes, 177 | Switch on in Admin after 1 | 1 | Medium (decides who approves) |
| 5 | **AC master and Genset master screens** | Admin lists with filters, counts by brand/tonnage/region and Excel download. | No | nothing | 1 (genset list needs 2) | Low |
| 6 | **Clean-up of old OEM-bucket / CVM-tag screens** | Removes the old screens once the sheets run. | No | nothing | 1, 2 and 3 live and working | Low, but **only after** they have proved themselves (removal is not easy to undo) |
| 7 | **Number and text limits in the form builder** | The administrator sets smallest/largest number, whole numbers only, and shortest/longest text length; also used for the Qty 1-10000 rule. Checked in the browser and on the server. | **No** | nothing | nothing | **Low** |
| 8 | **Vendor technicians - core** | OEM engineers log in; business rules give them AC tickets; they Start working with the OEM ticket number, resolve with the AC RESOLUTION list (+ Other) and the FSR; vendor manager view-only; reopen goes back to the same vendor. | Yes (vendor core migration) | Admin set-up: vendor companies, logins, routing rules | **1** (uses the AC saved with the ticket) | **Medium-High** (new kind of login; new security rules on tickets) |
| 9 | **Vendor - Part required** | Vendor lists parts, ticket goes on Hold; "Parts received" brings it back. | Yes (vendor requests tables) | nothing | 8 | Medium |
| 10 | **Vendor - PO required** | Vendor lists items and prices; Krishan approves (PO number, date, document) or rejects; OEM mailed; PO registers with Excel for vendor and Citykart. | Yes (PO columns, one more allowed status move) | PO approver setting (Krishan default); the AC sheet column "Email for PO detail" is read | 8 and 9 (and 1) | Medium-High |

**Not going live at all:** the old release 4 (engineer visits / FSR public page). It was dropped; its code was removed from the local build and its branch must never be pushed.

## 3. Side by side (live vs local)

| Area | Live today | On this PC (pending) |
|---|---|---|
| Where AC / Genset / CVM data comes from | Old OEM buckets and CVM tags typed in admin screens | Google Sheets copied into the database (1, 2, 3) |
| AC ticket form | Free AC number | Store's own Active ACs list (1) |
| OEM e-mail on a new AC ticket | From the OEM bucket; ticket moves to In Progress by itself | From the sheet (1); for vendor tickets it does **not** move by itself (8) |
| OEM e-mail when a resolved ticket is reopened | Not sent | Sent again (1) |
| Who repairs the AC inside CK Desk | Citykart technician only | Vendor technician can log in and work it (8) |
| Statuses | Unchanged | Unchanged (no new status anywhere) |
| Hold due to Purchase from HO | Technician only | Also used for vendor "Part required" / "PO required" (9, 10) |
| Approvals | Ad-hoc / workflow approvals | Same, plus a separate PO approval used only for vendor POs (10) |
| Reports / dashboards | As live | Unchanged (AC master screens added in 5) |
| Form builder limits | Required / optional only | Number range, whole numbers, text length (7) |
| Public pages | login, approve, CSAT, intake webhooks | Same. (The dropped `/engineer` page never goes live.) |

## 4. Dependencies (what must go first)

```
7  (independent)
1 -> 2 -> (5 genset list)
1 -> 3
1 -> 5
1 + 2 + 3 -> 6
1 -> 8 -> 9 -> 10
```

## 5. Recommendation (for you to decide)

1. **Push now (safe):** **7** - number and text limits. No database step, no new server task, nothing to set up, easy to roll back (previous build folder).
2. **Push next, one by one, after a week of calm:** **1** (AC sheet). It needs the Google connection first (your admin steps) and one scheduled task; test on live with ONE category before switching all AC tickets. Then **5**.
3. **Later:** **2** and **3** once 1 has run well for a few days (each is its own switch in Admin).
4. **Hold:** **6** (clean-up) until 1-3 have been live for some time.
5. **Hold until the business setup is ready:** **8, 9, 10** (vendors). They need release 1 live first, plus: vendor companies and logins created, routing rules written (and placed AFTER the existing "AC ticket rule - Krishan"), the AC sheet column "Email for PO detail" filled by the OEMs' addresses, and the AC RESOLUTION list given the "Other" option. They should be pushed one at a time (8, then 9, then 10) after more hands-on testing by you on this PC. The three branches are not split yet.
6. **Never push:** the old engineer-visit release (4).

## 6. How each release is pushed (when you say)
Re-run that release's checks -> you run its database run sheet on 205 (backup first) -> I restart `CkDeskPostgrest` on 98 -> merge to `main`, push, build and deploy to 98 (rollback folder kept) -> your admin steps. Optional read-only confirmation of the live database level (you run it on 205): `select max(version) from supabase_migrations.schema_migrations;` (or the compare script in `security-assessment-2026-10/07-FINAL-REMEDIATION/tools/compare-live-state.cjs`).

## 7. Things that are open and not part of any release
- `ALLOW_SHARED_SECRET_FALLBACK=1` is still set on live (temporary, from the security release).
- 461 accounts still must reset their password (your earlier decision: leave).
- The postgres password was pasted in chat earlier (your earlier decision: leave).
- Google sign-in from the public http address is not possible; connecting Google needs a localhost/tunnel or an https address.
