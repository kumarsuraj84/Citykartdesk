# Sheet Masters - AC, Genset and CVM Google Sheets

Status: built and tested locally on branch `feature/sheet-masters`. Not on `main`, not on the live system. Go-live happens after the sheets are filled in completely
(see "Go-live checklist" at the end).

## What it does

Three Google Sheets are the master list. CK Desk copies them into its own PostgreSQL tables three times a day (11:00, 15:00 and 19:00 Indian time, and on demand
from Admin > Sheet Masters > "Update from sheets now"). Everything else in CK Desk reads the database copy, never Google. CK Desk only ever reads the sheets.

| Sheet | Columns CK Desk uses | Used for |
|---|---|---|
| AC DETAILS MASTER SHEET-ADMIN | Store Code, AC CKDESK SERIAL NO, AC Serial No, Status, Mail ID, AC Floor / Type / Tonnage / Brand, AC-AMC vendor / Brand, Zenatix, Store Priority list, Festival, Region, Cluster, Opening date, City, State, Address, pincode | the AC choices in the ticket form (Active ACs of the requester's own store), the OEM e-mail, the store details, the AC counts in reports |
| GENSET Detail MASTER SHEET-ADMIN | Store Code, Genset Brand, Genset KVA, Genset Serial No, CPCB Group, Mail ID | the OEM e-mail for Genset tickets |
| CVM Detail MASTER SHEET-ADMIN (for Approval) | Store Code, CVM EMAIL ID | the approver for categories that send to the CVM |

Columns are found by their heading (capitals, spaces and punctuation do not matter) and can be in any order. Extra columns are ignored. New rows (new stores) are read
automatically because the whole sheet is read each time.

## Rules

- **Ticket form:** a dropdown field marked "Choices come from the AC sheet" (Admin > Form Templates > the AC Serial Number field) lists only the Active
  `AC CKDESK SERIAL NO` values of the requester's store. A requester with no store keeps the typed list. The server refuses an AC that is not active for the store.
- **OEM e-mail:** a category set to "Auto-send ... by e-mail to the OEM addresses the AC / Genset sheet lists" (or the AC Issues service flag) mails ONE message
  to every address of the chosen AC (AC) or of every genset row of the store (Genset). Outside addresses are in To, `@citykartstores.com` and `@citykart.org`
  addresses in CC. An invalid address is skipped and the rest are mailed. The ticket goes In Process and the conversation shows what was sent. If anything is
  missing (no store, store not in the sheet, no address, mail failure) the ticket stays Open with an internal note.
- **Two mail templates** (AC and Genset) are edited in Admin > Sheet Masters, with details such as `{{store_code}}`, `{{ac_number}}`, `{{ac_serial}}`, `{{genset_details}}`.
- **CVM approval:** a category set to "send for approval to the CVM" puts the ticket In Process, sends it to the CVM listed for the store (by e-mail; must be an
  active technician, manager or admin in CK Desk), shows Pending Approval, and returns it to In Process on approval. Nothing listed means Open with an internal note.
  The same CVM is pre-filled on "Send for Approval".
- **Store details:** address, city, state, pincode, cluster, region, priority list, festival, opening date, AC total / brand / AMC brand / AMC vendor / Zenatix
  follow the AC sheet (the sheet wins, one way).
- **Reports:** the "OEM" of a store in dashboards and reports is the AC-AMC vendor from the AC sheet. Active AC counts exclude Inactive ACs.
- **Replies:** a reply from any address in the AC or Genset sheet is recognised as an OEM reply, and those addresses are offered as OEM contacts when copying people.

## What happens when the sheets change

- Every ticket saves the unit's details at the moment it is raised (`request_master_snapshots`), so old tickets never change.
- A unit is recognised by store + actual serial first, then store + CKDESK number. A deleted row is kept as "removed" (never deleted), so history stays.
  Renumbering rows with the serials kept keeps each machine's unit. A genset store with one genset keeps its unit when its serial is corrected.
- A big disappearance (more than 20 units, or 15% of them) is applied only at a later update, at least 30 minutes on, so a mistake can be undone in the sheet first.
- A sheet that cannot be read or has lost a required column is not applied; the last good copy keeps working and the page shows why. The first time a sheet
  fails, the administrators get an e-mail.
- Problems found in the sheets (wrong or broken e-mail, misspelt company domain, duplicate numbers, unknown stores, a CVM without a login) are listed on Admin >
  Sheet Masters ("Master data health"). One bad row never blocks the good rows.

## Set-up (once, on the live system)

1. Share the three sheets with `citykartdesk@citykartstores.com` as Viewer (done).
2. In the Google Cloud project that holds the mailbox connection, switch on the Google Sheets API. No new account is needed.
3. Sign in to CK Desk as an administrator, open Admin > Sheet Masters, press "Connect Google Sheets", sign in as `citykartdesk@citykartstores.com` and press Allow
   (view-only access to spreadsheets). The return address is the same one the mailbox connection already uses.
4. Paste the address of each sheet and press Save, then "Update from sheets now".
5. Open Admin > Form Templates > AC form > "AC Serial Number" > tick "Choices come from the AC sheet".
6. Check the two mail templates, and set the categories (AC / Genset OEM, send to the CVM).
7. Install the scheduled task: run `scripts\windows\install-cron-tasks.ps1` on 10.0.1.98 (adds `CitykartDesk-Cron-MastersSync` at 11:00, 15:00 and 19:00).

## Go-live checklist (needs the user's yes)

1. All stores, ACs, gensets and CVMs are in the sheets; the typos listed on the health page are fixed.
2. Back up and run `deploy-bundle-migration-175\run-migrations.ps1` on 10.0.0.205 (adds eight tables and two Vault helper functions; changes no existing data).
   Rollback: `supabase\rollback\175_sheet_masters_rollback.sql`.
3. Restart `CkDeskPostgrest` on 10.0.1.98, build and deploy the app from `main`.
4. Do the set-up above, then try one ticket of each kind.

Retired by this change (not deleted from the database, hidden from the screens): the OEM list screen and "assign stores to OEM", the AC OEM / Genset OEM / CVM tags on a
store, the OEM / CVM columns of the Store Master Excel upload. The columns `stores.oem_id`, `stores.genset_oem_id`, `stores.cvm_id` and the `oems` table stay for
history and can be dropped in a later clean-up.
