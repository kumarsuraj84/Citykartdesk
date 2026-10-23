# Live (main) vs local - everything since 20 September (checked 2026-10-23, read only)

Nothing was changed on the live servers. What was looked at: the public address (`/api/version`, `/api/health`), the app server 10.0.1.98 (services, scheduled tasks, folder names, setting NAMES only with values hidden, and a connection test to Google and the weather service), git `main` against this PC, and a clean copy of `main` that was tested and then removed. The database server 10.0.0.205 was not queried (that needs the postgres password only you type); its level below is from our own records.

## 1. What is live today

| Item | Live |
|---|---|
| App | Build **20261022-154801** = git `main` **03959d0** (release 7 on top of the 19 October releases). Health OK, database OK. |
| App server 98 | The five services (App, Auth, Postgrest, Proxy, Storage) Running. Rollback folders kept: 15 Oct, 19 Oct (two), 22 Oct. |
| Database 205 | Migration **174** (our records; confirm with `select max(version) from supabase_migrations.schema_migrations;` on 205). |
| Scheduled tasks on 98 | Alerts, ApprovalReminders, BusinessRules, Csat, EmailReplySync, SystemLogArchive, LogShipper. **None** for sheets, visits or weather. |
| Settings on 98 (names) | Supabase, public address, cron, CRON_SECRET, `ALLOW_SHARED_SECRET_FALLBACK` (still on). **No Google settings. No sheet settings.** |
| Can 98 reach outside services? | **Yes**: Google Sheets, Google sign-in and the weather service (api / geocoding / archive.open-meteo.com) all answer on https. |
| Google Sheet concept on main | **None.** No sheet code, no sheet tables on `main`. The AC, Genset and CVM data are still typed in admin screens. |
| Tests of `main` (clean copy) | Type check clean; **1456 unit tests**: all pass (5 header/proxy tests only need the local settings file to be present). |

## 2. Already LIVE (on main), built since 20 September - 206 commits

| Area | What you got | Live since |
|---|---|---|
| E-mail | Mail goes through the app mailbox; requester gets "logged" and "assigned" mails; real titles; status mails show the technician's comment; one mail to all OEM contacts with a table; reply-by-mail posts into the ticket conversation (every minute); full OEM mail shown in the conversation | 21 Sep - 14 Oct |
| Ticket handling | Reopen banner with countdown and remark; remark compulsory on cancel; new status **Hold due to Purchase from HO**; technician in several groups; Start working posts a first response; ticket PDF download; CC a comment to people and OEM; attachment preview; **no manual priority change**; **resolution note must say what was done (10+ characters)**; **"Catch me up" ticket summary**; service of a ticket cannot be changed | 22 Sep - 15 Oct |
| Creating tickets | 3-panel Create Request page with shortcuts; ticket title = the Subject field; Qty field limited to categories (Fixtures, Hangers) | 24 Sep, 19 Oct |
| Approvals | Quick approve; first answer decides; approve from the e-mail link; approver names everywhere; role-scoped page; **daily 10:00 reminder mail**; links expire after 7 days; **automatic CVM approval** for Fixtures / Hangers | 24 Sep - 19 Oct |
| Dashboards | Technician workload, 9-bucket aging, Daily Activity; saved reports; **Smart Dashboard** (click to drill, OEM views, Store Master data, filters, nudge, pop-ups); Home numbers fixed; 30/60/90/120/FY periods; numbers refresh every minute | 24 Sep - 14 Oct |
| Reports | Report Analytics (age bucket, ticket status, store wise, AC Not Working, AMC vendor), 12 fixed **Predefined Reports** (+ weekly, monthly, priority wise, repeated AC complaints), India-time dates | 8 - 14 Oct |
| Admin | OEM "Assign stores"; **Store Master** fields and Excel upload; stores export; change a user's sign-in e-mail; search in rules, stores, OEMs, reports; **OEM by type (AC and Genset)**; **store CVM** | 21 Sep - 19 Oct |
| CSAT | Rating mail flow with one-click stars | 8 Oct |
| Security and audit | The audit fixes: Critical, High and Medium (migrations 156-171); **Next.js 16.3.8**; no shared default password; one secret per purpose; tickets written by the server only; approval separation of duties; double-submit protection; headers and limits | 13 Oct (156-163), 19 Oct (164-171) |
| Monitoring | **System Log** (tamper-evident, screen, shipper, archive jobs), one "Logs" menu, retention settings | 14 Oct |
| Servers | Move to app 10.0.1.98 / database 10.0.0.205 / NAS files; deploy scripts | 7 Oct |
| Form builder | Smallest / largest number, whole numbers only, shortest / longest text (release 7) | 22 Oct |

Note: five of these commits were labelled "LOCAL TRIAL" when written (resolution-note length, "Catch me up", service lock, priority lock, mail-sync fixes). They are in `main` and in the live build, so they are live.

## 3. Built only on this PC - NOT live (full local build = branch `feature/sheet-masters`, 23 commits ahead)

| # | Feature | Plain words | Database step on 205 | New on the server | Needs first | Risk |
|---|---|---|---|---|---|---|
| 1 | **AC Google Sheet is the master** | Sheet copied into our database at 11:00, 15:00, 19:00 and by "Update now"; the ticket form lists the store's own ACs; OEM mail from the sheet; OEM mailed again on reopen | Yes (new tables only) | Google connection, sync task, sheet address | nothing | Medium |
| 2 | **Genset sheet** | Same for gensets | Yes | switch in Admin | 1 | Low-Medium |
| 3 | **CVM sheet** | The store's CVM comes from the sheet | Yes | switch in Admin | 1 | Medium |
| 5 | **AC / Genset master screens** | Lists with filters, counts, Excel | No | nothing | 1 | Low |
| 6 | **Clean-up of the old OEM / CVM screens** | Removes screens the sheets replace | No | nothing | 1, 2, 3 working | Low but hard to undo |
| 8 | **Vendor technicians - core** | OEM engineers log in, work their AC tickets (OEM ticket number, resolve with the AC RESOLUTION list + Other + FSR); vendor manager view-only | Yes | vendor companies, logins, routing rules (must run BEFORE the old "Krishan" rule) | 1 | Medium-High |
| 9 | **Vendor - Part required** | Parts list; ticket on Hold; "Parts received"; the vendor can correct the list; the store is mailed the new list | Yes | nothing | 8 | Medium |
| 10 | **Vendor - PO required** | Quote with file; approver decides (PO number, date, document); **revised-price box**; **quote versions**; **reject only the quote** (ticket goes on) or reject and cancel; PO registers with Excel; **approvers come from the AC sheet column "CK PO Approver Mail To"** (several allowed, first decision wins) | Yes | default approver; AC sheet columns **OEM Ticket Mail To / OEM PO Mail To / CK PO Approver Mail To** | 8, 9 and 1 | Medium-High |
| 11 | **Vendor mails and reopen tag** | New mails (hold ended, REOPENED, new cancel wording), "Reopened xN" tag; full mail map in `docs/VENDOR-EMAIL-MAP-UPDATED.xlsx` | none (part of 8-10) | nothing | 8-10 | Low |
| 12 | **Ticket Calendar (Smart Dashboard)** | Green / yellow / red calendar per group ("IT Ticket Calendar" ...), place picker (store, cluster, region, state), break-down lists, same-issue-again, repeat-fault ACs, outside temperature; new top-bar filters **Service / Category / Sub category** | Yes (weather cache tables) | **a daily 08:00 task**; the server must reach the weather service (it can) | the AC / genset machine view needs **1 (and 2)**; the ticket-count view alone does not | Medium |

**Dropped, never push:** the old engineer-visit module (old release 4).
Old branches `push/1..6` and `release/p0-framework-next-16.3.8` are earlier packaging attempts; the live build already has their useful content. Do not push them as they are.

## 4. Side by side

| Area | Live today | On this PC (pending) |
|---|---|---|
| Where AC / Genset / CVM data come from | Typed in admin screens (OEM buckets, CVM tags) | Google Sheets copied into the database (1, 2, 3) |
| AC ticket form | Free AC number | The store's own active ACs (1) |
| Who repairs the AC inside CK Desk | Citykart technician only | A vendor technician can log in and work it (8) |
| Parts / PO from the vendor | Not possible | Part required, PO required with quote, approval, registers (9, 10) |
| Who approves a PO | - | Approvers named in the AC sheet, else Krishan (10) |
| Mails to the vendor / OEM | OEM mail on a new ticket | Plus mails for assigned, revised price, PO approved, cancelled, reopened, hold ended (8-11) |
| Dashboard calendar | None | Ticket Calendar for every group (12) |
| Dashboard filters | Group, technician, region, state, cluster ... | Plus Service, Category, Sub category (12) |
| Outside temperature | None | Collected once a day at 08:00 for AC / genset views (12) |
| Statuses | Hold due to Purchase from HO exists | Unchanged (no new status) |

## 5. Dependencies

```
1 -> 2 -> genset list (5)         1 -> 3          1 -> 5          1+2+3 -> 6
1 -> 8 -> 9 -> 10 -> 11
12: ticket-count calendar and the new filters stand alone;
    the machine (AC / genset) view of 12 needs the sheet tables of 1 (and 2)
```

## 6. Recommendation (for you to decide)

1. **Push first: 1 (AC sheet).** Everything else leans on it. Your steps: Google connection (needs localhost / tunnel or https), the sheet address in Admin, one scheduled task. Test with ONE category before switching all AC tickets.
2. **Then 5**, and after a few calm days **2** and **3** (each its own Admin switch).
3. **Then the vendor set 8, then 9, then 10 (+11)**, one at a time, only when vendor companies, logins, routing rules and the three AC sheet columns are ready.
4. **12 (Ticket Calendar)**: can go in two steps. Step A (after 1): everything. Step B (if you want it earlier): I make a "calendar without sheets" cut - the ticket-count view and the new filters only - which needs only the weather tables and the 08:00 task. Say which you want.
5. **Hold: 6 (clean-up)** until 1-3 have run for a while.
6. **Never: the old engineer-visit module.**
7. Nothing in this list is safe to push "as is" in one go: the local build mixes all features, so each release must be cut into its own branch and its migration renumbered first (the local numbers 175, 177-182 are not final).

## 7. Open things that are not part of any release
- `ALLOW_SHARED_SECRET_FALLBACK=1` is still set on live (temporary since the security release).
- 461 accounts still must reset their password (your earlier decision: leave).
- The postgres password was pasted in chat earlier (your earlier decision: leave).
- Google sign-in from the public http address is not possible; the Google connection needs a localhost / tunnel step or an https address.
- A weather city the service cannot find (21 of 230 in the local test) shows no temperature; the job lists them, and misspellings in the Store Master can be corrected.
