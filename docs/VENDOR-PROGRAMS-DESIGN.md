# Vendor Programs — one settings screen for "mail the OEM / vendor and let them handle the ticket"

Status: design agreed with the owner on 2026-10-29 (data source = Google sheet per program, copied into a CK Desk table three times a day; the shape of the sheet is
decided later by the owner, so the engine supports both shapes). Phase 1 is built locally; nothing is pushed or deployed until the owner says so.

## 1. The problem
Today AC and Genset are written into the code: the database only accepts the two OEM types `ac` and `genset`, each has its own sheet layout, its own mail words and its own
tables. The vendor portal is tied to AC (routing by a rule on an "AC vendor" field, PO approval for AC tickets only, the AC RESOLUTION list). A new line such as the RO water
purifier would mean new code, and so would every line after it.

## 2. The idea
A **Vendor Program** is one record an administrator fills in (Admin -> Vendor Programs). One program = one service line (AC, Genset, RO purifier, ...).

| Question | Stored as |
|---|---|
| Which categories belong to it? | `service_categories.program_id` (a category is in at most one program) |
| Where is the list of stores and vendors? | the program's Google sheet (link + tab), copied into `program_rows` |
| What does one row mean? | `row_type`: `store` (one row per store, like Genset) or `machine` (one row per machine, like AC) |
| What mail goes out at the start? | the program's mail template (subject + HTML body, same editor and cleaning as AC / Genset) |
| What happens to the ticket? | `level`: `mail` (mail, then In Progress) or `portal` (mail, ticket stays Open for the vendor's own technician) - portal is Phase 2 |
| Is it switched on? | `is_active` (a program is saved switched OFF; the "Check my set-up" list must be green first) |

AC and Genset are NOT touched in Phase 1. They stay "built in" (their tables, parsers, templates, portal) so nothing live can change. A category that has an AC/Genset OEM type
cannot also be put in a program (and the other way round). Later they can be moved onto the same engine once a side-by-side test proves identical mail, status and vendor.

## 3. The sheet (the engine reads columns by heading, any order, extra columns allowed)
Same rules as the AC / Genset sheets: headings are matched ignoring case, spaces and punctuation; a sheet that cannot be read or lost a required column is NOT applied (the last good
copy stays in use and the screen shows why); rows that leave the sheet are kept and only removed by a later update (a big disappearance waits at least 30 minutes).

| Meaning | Default heading(s) | Needed? |
|---|---|---|
| Store code | `Store Code` | yes |
| Where the ticket mail goes | `Mail To` (also `OEM Ticket Mail To`, `Mail ID`) | yes (a row without one is reported) |
| Vendor name | `Vendor` | no (Phase 2 uses it to find the vendor company) |
| Machine number | `Machine No` (also `Machine Number`, `Asset No`) | only for `machine` programs |
| Serial number | `Serial No` (also `Serial`) | no |
| PO mail | `PO Mail To` | no (Phase 2) |
| Citykart PO approver | `PO Approver Mail To` | no (Phase 2) |
| Active | `Active` (yes / no / 1 / 0; empty = yes) | no |
| anything else | every other column is kept as an "extra detail" | no |

The admin can type different heading names for any of these in the program (so an existing sheet needs no change). Every extra column is available in the mail as
`{{extra_<heading>}}` and in the readiness check.

## 4. What happens when a ticket is raised
1. The ticket is created in a category that belongs to an active program (same moment AC / Genset mail goes out today).
2. The store's rows are looked up in the program's copy. `machine` programs use the machine the requester picked when there is one; otherwise all the store's active machines.
3. ONE mail goes to the "Mail To" addresses (company addresses are copied, OEM addresses are in To - the same rule as AC / Genset), using the program's template.
4. The conversation gets the note "Ticket sent to the <program name> OEM for servicing." with the To / CC lines and the mail's table (the same note the ticket page already shows
   as a table, and the same note the e-mail-reply check reads to accept the vendor's answer).
5. Level `mail`: the ticket goes to **In Progress** (only if it was still Open).
6. Anything missing (store not linked, not in the sheet, no address) leaves the ticket Open with an internal note for the technician - never a lost ticket.
7. A snapshot of the rows the ticket was mailed for is saved (`request_program_snapshots`), so old tickets stay readable whatever the sheet says later.
8. A reopened ticket is mailed again, subject starting REOPENED (same as AC / Genset).

## 5. Admin screen (Admin -> Vendor Programs)
- List of programs with status (Active / Off), the last sheet check and a problem count.
- One editor, sections in the order of the five questions: Name & type; Categories; Sheet (link, tab, "Update from sheet now", column headings); Mail wording
  (editor + "send a test to me"); What happens to the ticket. Plain words everywhere, no codes.
- **Check my set-up** (green / red list): categories chosen; sheet read OK; every store of the program's categories' requesters... see section 6; rows without a mail address;
  stores in the sheet that are not in CK Desk; mail template has no unknown {{field}}.
- Switching a program Active is refused while a red item is open (a short override is not offered in Phase 1).
- Every change is written to the admin audit log.

## 6. Checks and safety
- A program is server-only data (row security on, no right for signed-in users), like the other master tables; every action checks the administrator role itself.
- Categories already used by AC / Genset OEM routing or the AC PMS category cannot be added.
- The mail template is cleaned with the same sanitizer as the AC / Genset templates; ticket text is HTML-escaped; unknown `{{fields}}` are reported before going live.
- The test mail goes only to the administrator who pressed the button.
- The sheet copy uses the same one-at-a-time lock, the same paging (no 1,000-row cut), the same last-good-copy rule and the same 11:00 / 15:00 / 19:00 schedule as the other sheets.

## 7. Phases
| Phase | Content | Live impact |
|---|---|---|
| 1 | Programs, sheet copy, mail + In Progress, notes, reopen, admin screen, check list, tests | none until an admin creates a program |
| 2 | `portal` level: vendor company found from the "Vendor" column, round-robin technician, the vendor ticket page for the program, resolution list per program, PO switch + approver from the sheet | none until an admin sets a program to portal |
| 3 | Move AC and Genset onto the engine after a side-by-side test | planned, optional |

## 8. Open items
- The sheet layout of the first new program (RO purifier): the owner will send it; the engine already accepts either shape.
- Phase 2 details (which vendor screens each program shows) are decided when Phase 1 is accepted.

## 9. As built (2026-10-29) - Phase 1, local only, not committed or pushed
- Migration `186_vendor_programs.sql` (+ rollback): `vendor_programs`, `program_rows`, `program_issues`, `request_program_snapshots`, and `service_categories.program_id` (a category cannot be in a program and also have an AC / Genset OEM type or be the AC PMS category: a database rule).
- `lib/programs/*`: `parse` (sheet columns by heading, extra columns kept), `match` (rows recognised again), `sync` (same safety rules as the other sheets), `mail` (fields + default wording), `routing` (mail, note, snapshot, In Progress, reopen), `readiness` (check list), `admin-data`, `run`.
- Hooked into ticket creation (`lib/requests/create-request-core.ts`) and reopen (`lib/requests/master-routing.ts`); the scheduled sheet copy (`lib/masters/run.ts`) now also copies the programs' sheets (shared `lib/masters/source.ts`).
- Admin screens: Admin -> Vendor Programs (`/admin/programs`, `/admin/programs/[id]`), actions in `lib/actions/admin/programs.ts`; a program is saved OFF and can only be switched ON when the blocking items of the check list are green.
- The note "Ticket sent to the <program> OEM for servicing." is the same note AC / Genset write, so the ticket page shows it as a table and the e-mail reply check accepts the vendor's answer.
- Phase 1 limits: `machine` programs mail every active machine of the store (no machine picker in the ticket form yet); the `portal` level can be stored and mails the vendor but the vendor-portal part is Phase 2.
- Tests: `tests/unit/programs-engine.test.ts` (pure parts) and `tests/vapt/42-vendor-programs.test.ts` (database, mail, note, snapshot, reopen, privacy; runs through the isolation check).

## 10. AC and Genset on the same screens (2026-10-29, local, not pushed)
- Admin > Vendor Programs lists **AC (built in)** and **Genset (built in)** first. Each opens `/admin/programs/built-in/<ac|genset>` with the same sections as every other line: check list, categories, Google Sheet (link, tab, update, last check), the OEM mail wording, what happens to the ticket, and the problems found in the sheet.
- Nothing about behaviour changes: the categories are the existing "send to the AC / Genset OEM" switch (`service_categories.auto_oem_kind`, written by `saveBuiltInCategories` with the same audit entry), the sheet and the mail wording are the existing `master_sources` / `master_mail_templates` rows. The ticket form, OEM mail, vendor portal, PO approval and PMS keep their own engines.
- Admin > Sheet Masters keeps the Google connection, the update button, the CVM and AC PMS sheets and the health list; its AC and Genset cards are replaced by a pointer to Vendor Programs, so there is one place to set each line up.
- Next phases (agreed order): machine list, vendor portal and PO approval per program (proved on RO Purifier and Sensor Machine), scheduled tickets (PMS) and reports per program, then AC and Genset onto the engine with a side-by-side test.

## 11. Vendor portal and quote / PO approval for a program (2026-10-29, local, not pushed)
- Migration 187 (additive): `vendor_programs.resolution_options`, `vendor_programs.oem_number_required`.
- A program set to "the vendor works the ticket in the vendor portal" (level `portal`): the mail goes out and the ticket stays Open for the vendor technician it is given to. WHO gets it is decided in CK Desk only: Business Rules (Admin > Business Rules) assign it to particular vendor technicians exactly as they do for Citykart technicians; nothing in the Google Sheet routes a ticket. A ticket no rule gave to a vendor technician stays with Citykart staff with an internal note. The sheet gives only the e-mail addresses: `Ticket Mail To` (the first mail), `PO Mail To` (the mail to the vendor when the PO is approved) and `Quote Approval Mail To` (the approvers asked when the vendor sends a quote).
- The saved sheet row (`request_program_snapshots`) is written BEFORE the mail is sent, so the portal and the PO approval work even if the mail fails; a reopened ticket uses the saved row (same vendor and technician as the first time).
- Portal: start (the OEM ticket number is optional for a program), parts required, quote / PO, resolve. Resolve uses the program's own fixed list (`resolution_options`, "Other" always offered, FSR compulsory). AC keeps its own list from the AC service form until AC moves onto the engine; then it gets its own list like every other line.
- Quote / PO: the approvers are the row's "Quote Approval Mail To" (matched to active staff logins; any one decides; fallback = the default approver), the OEM PO mail goes to "PO Mail To" (else the ticket mail addresses), and the mails and screens say the program name instead of "AC" (`assetKind`); AC mails are unchanged (tests 36 / 37).
- E-mail replies: the addresses of a program's rows (ticket and PO) are known vendor contacts (`loadSheetOemContacts`); the files of a reply are kept under it (`lib/email/inbound-files.ts`: same checks as any upload; the signature logo is skipped; refused files leave an internal note).
- Admin: the program editor has the level choice, the OEM-ticket-number switch (off for programs by default, AC always needs it) and the resolution list (needed in the check list).
