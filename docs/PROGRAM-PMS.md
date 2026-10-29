# PMS (preventive maintenance) tickets for a Vendor Program

LOCAL ONLY until released. Migration 191 (rollback in `supabase/rollback/191_program_pms_rollback.sql`). Step 3 of moving AC / Genset onto the Vendor Program mechanism.

## In plain words

PMS is **optional, per program**. A program with no PMS sheet does nothing extra and shows nothing extra. A program with scheduled service visits (for example AC) gets its **own PMS Google Sheet**:

| Store Code | PMS Date |
|---|---|
| DBH | 12/11/2026 |
| CTP | 14/11/2026 |

One row per store and date. A store with no date is not due. CK Desk copies the sheet with the other sheets (09:00, 11:00, 15:00, 19:00) and never writes to it.

On the PMS date, **from 09:00 India time**, CK Desk makes **ONE ticket for the store** (all the store's machines in it), raised from the store's own login, in the program's **PMS category**. Because that category belongs to the program, the ticket is **mailed to the program's vendor** with all the store's machines, exactly like a normal ticket of the program; the vendor portal and Business Rules treat it the same way. The vendor sees it in the PMS tab and finishes it with the PMS report (same as AC PMS today).

## Rules it follows (same as AC PMS today)

- Only today's date is made, only from 09:00; a date in the past is never made, a date in the future waits.
- `program_pms_log` keeps one row per program, store and date: a date never makes two tickets (even if two runs overlap), and a second run sends no second mail.
- A store that is not in the store master, or has no active login, or a ticket that is refused: nothing is made, the reason is shown on the program screen (problems list), and the date is tried again at the next run of the same day.
- A date removed from the sheet later does not touch tickets already made.
- A program that is switched off makes no PMS tickets. Removing the PMS sheet removes its copied dates and PMS problems and nothing else.
- The old built-in AC PMS (one org-wide sheet) is not affected: it only looks at a PMS category that belongs to NO program.

## Set-up for a program that has PMS (administrator)

1. Admin > Categories: make a category for the PMS tickets (for example "AC PMS") with a sub-category, add it to the service, and tick **AC PMS category**.
2. Admin > Vendor Programs > the program > Categories card: tick that PMS category too (a PMS category is allowed in a program).
3. Same screen > **PMS tickets (optional)** card: paste the PMS sheet link, Save, then "Update from sheet now". Share the sheet with the Google account the other sheets use.
4. Switch the program on. Optionally a Business Rule gives the PMS category to a vendor technician.

## Release steps (when released)

Migrations 189 (services visibility), 190 (ticket automation state) and 191 (this) on the database server; after the app swap restart CkDeskPostgrest. Nothing new to schedule: the existing 09:00 / 11:00 / 15:00 / 19:00 sheet copy makes the tickets.

## Tests

`tests/vapt/48-program-pms.test.ts` (isolated stack).
