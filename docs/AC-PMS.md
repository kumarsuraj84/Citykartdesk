# AC PMS (preventive maintenance) tickets

LOCAL ONLY until released. Migration 184 (rollback in `supabase/rollback/184_ac_pms_rollback.sql`).

## What it does, in plain words

1. A fourth Google Sheet, **AC PMS MASTER SHEET**, has two columns: **Store Code** and **AC PMS Date**. One row per store and PMS date. A store with no date is not due.
2. CK Desk copies it with the other sheets (11:00, 15:00, 19:00) and also at **09:00** (the `pms-daily` job). Wrong rows are listed on Admin > Sheet Masters, under the filter "AC PMS".
3. On the PMS date, **from 09:00**, one ticket is made for the store in the AC PMS service, form, category and sub-category, raised from the store's own login (the first active store login).
4. The ticket is routed to a vendor technician by a Business Rule, like a normal AC ticket (the Administrator creates the rule: category = the AC PMS category, condition on the AC vendor of the store).
5. Vendors see two tabs: **My tickets** and **AC PMS tickets**. Both have the same 7 boxes (Revise price, Open, In process, Part required, PO required, Resolved, Cancelled). A ticket is in exactly one tab, decided by its category.
6. A PMS visit is lighter: no OEM ticket number to start, and the PMS report (an attachment) with optional remarks to finish. Parts required, PO required and revise price work as for any AC ticket.

## Set-up (Administrator)

- Service, form template, SLA, category and sub-category for AC PMS (done on the local site: service AC-PMS, category AC-PMS).
- Admin > Categories > edit the AC PMS category > tick **AC PMS category**.
- Admin > Sheet Masters > AC PMS MASTER SHEET > paste the sheet address > Save > "Update from sheets now". The Google account the other sheets use (citykartdesk@citykartstores.com) must have the sheet shared with it.
- Admin > Business Rules: one rule per AC vendor (category = AC PMS, vendor contains Voltas / Blue Star, assign to that vendor's technicians). `local-testing/seed-pms-local.sql` shows the local example.
- Server: run `scripts/windows/add-pms-task.ps1` once (adds the 09:00 task; `install-cron-tasks.ps1` also has it).

## Rules the job follows (`lib/pms/tickets.ts`, `lib/pms/window.ts`)

- Today's date is made only from 09:00 India time. A date missed because the job did not run is still made for 2 days afterwards, never older.
- `pms_ticket_log` keeps one row per store and date: a date never makes two tickets (even if two runs overlap).
- No category marked as AC PMS, a store that is not in the store master, a store with no login, or a refused ticket: nothing is made, the reason is shown in Sheet Masters, and the date is tried again at the next run until it is older than 2 days.
- A date removed from the sheet later does not touch the tickets already made.
- PMS tickets are not in the AC Ticket Calendar and the AC complaint reports (those read the AC OEM categories and AC services only).

## Tests

`tests/unit/ac-pms.test.ts`, `tests/vapt/40-ac-pms.test.ts` (isolated stack).
