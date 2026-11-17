# The Zoho Data tab

The old Zoho (ManageEngine) tickets, inside CK Desk, **without being part of CK Desk**.

## The rule this is built on

> Zoho data is a tab of its own. It is read from the Zoho database. Nothing is copied into CK Desk and nothing is
> mapped or linked to CK Desk. Tickets are looked up by the Zoho ticket number only.

So:

- the tab reads **`zohomigrationdb` on the database server 10.0.0.205**, through its own login, and nothing else;
- it keeps **Zoho's own words** — Zoho statuses, Zoho priorities, Zoho service names, Zoho technician and store names.
  Nothing is translated into CK Desk's words, because they are not the same thing;
- **no CK Desk table is read** by any of this code, and **nothing is written** anywhere — the database refuses a write
  even if a query asked for one;
- if the Zoho database cannot be reached, the tab says so in one box. **Nothing else in CK Desk is affected.**

## What is on it

| Page | What it shows |
|---|---|
| `/zoho` — Overview | How many tickets, how many still open, how long the open ones have waited, raised vs finished each month, and the lists of services, statuses, technicians, who raises the most, and priorities. |
| `/zoho/reports` — Reports | **Stores with AC tickets still open**: open AC tickets per store against how many ACs that store has, with the age buckets and the owner's red flag at 30%. |
| `/zoho/tickets` — Find a ticket | Open any Zoho ticket **by its Zoho ticket number**. Shows **every field Zoho held**, the attachments, and the whole conversation (e-mails, replies, notes and recorded changes). There is also a word search for when the number is not to hand. |

### Every field, and nothing lost

The ticket screen does **not** work from a fixed list of fields. It reads each ticket's **whole original Zoho record**
(the copy keeps it), so a Zoho field nobody ever named still appears, under *Everything else Zoho held*. The fields are
laid out the way a person reads them:

| Part of the screen | What it holds |
|---|---|
| **What was written when the ticket was raised** | the store's own message, formatting and all |
| **What the technician recorded on closing** | the closure code and what the technician wrote — on our tickets this is where "what was done" lives, because Zoho's own *Resolution* box is empty throughout |
| **What the store asked for** | subject, who raised it, when, department, site, how it was raised, the service, category, item, priority, urgency, impact |
| **What the technician did** | technician, group, status, assigned / responded / resolved / completed dates, time taken, closure, approval, first-call-resolution, reopened |
| **Fields of this service** | the service's own fields (AC number, employee code, bank details, …); empty ones are left out |
| **Zoho's own record** | SLA, due dates, overdue / escalated flags, tags, last changed in Zoho, and the rest of its book-keeping |
| **Everything else Zoho held** | any Zoho field not yet given a proper name — shown as Zoho named it |

A blank field means **Zoho itself was blank** when the copy was taken, not that anything was lost in copying.
`lib/zoho/ticket-fields.ts` holds the names and the owner of each field, and the rules for reading Zoho's value shapes
(a date is `{value, display_value}`, a person is `{id, name}`, time taken is in milliseconds).

Open to **administrators and managers** only. A vendor login can never reach it (the vendor allow-list does not include it).

## Where the store details come from

The reports need to know how many ACs a store has. That is not in the Zoho tickets, and it must not be taken from
CK Desk. So a copy of the store list lives **inside the Zoho database** (`zoho_store_master`), filled from the **same AC
Google Sheet CK Desk reads** — by `zoho-sync\load-store-master-from-sheet.cjs` on the application server, run by the
scheduled task **`CitykartDesk-ZohoStoreMaster`** at **11:00, 15:00 and 19:00** (the same times as CK Desk's own copy).

A store code that is on a Zoho ticket but not in the sheet (a closed store, or a head-office person who raised an AC
ticket under their own name) is **still shown**, exactly as the Zoho ticket has it — just without a city, cluster or AC
total.

## Switching it on

Two things are needed, once.

**1. A read-only login on the database server (10.0.0.205).** Already done: the login is **`zoho_report`**. It may read
every table of `zohomigrationdb`, it has **no write permission on any table**, it cannot open the `ckdesk` database and
it cannot create anything. (The script that makes one is
`manageengine-migration\SETUP-ZOHO-READONLY-ON-205.ps1`.)

**2. Five lines in the application's settings** on the app server 10.0.1.98, in
`D:\Citykart_Applications\Citykart_Ckdesk_App\app\standalone\.env.local`:

```
ZOHO_DB_HOST=10.0.0.205
ZOHO_DB_PORT=5432
ZOHO_DB_NAME=zohomigrationdb
ZOHO_DB_USER=zoho_report
ZOHO_DB_PASSWORD=<the password you set for zoho_report>
```

Then restart the CkDeskApp service. Until those lines are there, the tab simply says it cannot read the Zoho data; it
never breaks anything else.

(Instead of the five lines a single `ZOHO_DB_URL=postgresql://…` also works.)

## How it is kept safe

| Barrier | What it stops |
|---|---|
| The login has **no INSERT, UPDATE, DELETE or TRUNCATE grant** on any table | a write can never be allowed, whatever the code asks for |
| Every connection is opened with `default_transaction_read_only=on` | a write is refused by the database before it reaches a table — proven: DELETE, UPDATE, INSERT and CREATE TABLE are all refused |
| A 25-second limit on every query, and at most 4 connections | one heavy report cannot slow the Zoho database or the sync |
| Values a person types always travel as query **parameters**, never inside the query text | nothing typed in the box can change what a query does |
| The ticket number is checked to be digits before it is used | anything else is answered with "that is not a ticket number" |
| E-mail and note bodies are cleaned on the server and shown in a sealed frame | an old e-mail cannot run anything or load a tracking image |
| The login cannot open `ckdesk` at all | the Zoho tab can never touch CK Desk data, even by mistake |

## The code

| File | What it does |
|---|---|
| `lib/zoho/db.ts` | the read-only connection, the settings, and the plain-words version of every connection problem |
| `lib/zoho/queries.ts` | every read the tab makes |
| `lib/zoho/report-shapes.ts` | the rules the reports follow (open statuses, age buckets, the red flag) — no database, so the screens can use them too |
| `app/(app)/zoho/*` | the three pages |
| `tests/unit/zoho-tab.test.ts` | the rules that decide what a report says |

## Still to come

- A Zoho **report builder** (choose the columns and the filters yourself), like CK Desk's own.
- More ready-made reports: how long tickets take per service, technician workload, and the service-by-month table.
- Downloading a report as Excel.

## Moving Zoho tickets to CK Desk — STAGE 1 (mapping + preview only, built locally, not released)

Two new tabs, **Mapping** and **Move to CK Desk**. This is the one deliberate bridge between the two systems and it only ever writes
**into CK Desk** (its own mapping tables), never into Zoho. **No ticket is created in stage 1.** Full plan: `docs/ZOHO-TO-CKDESK-TRANSFER-PROPOSAL.md`.

The owner's basic mapping (Zoho → CK Desk):

| Zoho | CK Desk |
|---|---|
| Template | Form Template |
| Template + Category | Service |
| Sub Category | Category |
| Item | Sub Category |
| Requester | Requester (matched by saved hand match, then e-mail, then exact full name) |
| Technician | Technician (matched the same way; an open ticket is still given to a technician by CK Desk's own rules) |
| Status | Status |

Plus the Zoho fields of each template → the fields of the mapped CK Desk form template. Priority is **not** mapped: CK Desk's own rule
decides it (the sub-category's SLA priority, else the service's default). SLA deadlines are worked out from the **Zoho created time**.

- `/zoho/mapping` — one Zoho template at a time (Template → Service → Category → Sub Category → fields), Statuses, Requesters, Technicians.
  "Suggest the blanks" fills a best guess in yellow; nothing is saved until **Save**. Only an administrator can save; managers can look.
- `/zoho/move` — filters (ticket numbers and ranges, template, category, status, requester, technician, dates, "not moved yet"), then a
  preview of up to 200 tickets: the number `ZOHO-<Zoho number>` (exactly as Zoho has it), created time, where it would go, requester and
  technician matches, status, CK Desk priority, SLA deadlines and whether it would be breached, and a plain reason when a ticket cannot move yet.
  The **Move** button is switched off.
- Database: migration `196_zoho_transfer_mapping.sql` (7 tables, server key only). Code: `lib/zoho/transfer/*`, `lib/actions/zohoTransfer.ts`.
- Tests: `tests/unit/zoho-transfer.test.ts` (21).
- Still to build (stages 2–5): the silent move itself, the "Moved" badge and filter in the Zoho tab, the ZOHO- number rule in the database, local QA, live.

### STAGE 2 — the move itself (built locally, not released)

`/zoho/move` now has tick boxes and **Move the ticked tickets** (administrators only, up to 25 at a time, with a "Yes, move them now" confirmation). A move:
- creates the CK Desk ticket **`ZOHO-<Zoho number>`** with the **Zoho created time**; SLA, priority and (for an open ticket) the technician are worked out by CK Desk, the technician by the Business Rules run **quietly**;
- sends **no mail, WhatsApp, push, survey or notification**; the automation is recorded as finished, so the 15-minute retry and "Run automation again" never mail for it;
- copies **everything Zoho held**: the store's message, every field, the e-mails and the requester's replies, notes, conversation items, tasks, work logs, the history, and the attachments (when `ZOHO_ATTACHMENTS_ROOT` is set on the server; otherwise they are listed);
- keeps **Zoho's dates, times and people** on every entry: the person who wrote a note, the technician who sent a ticket for approval, the approver who approved or rejected it, each at the Zoho time (a person CK Desk has never seen becomes an inactive profile, which cannot sign in);
- is **all or nothing** and can **never happen twice** (one row per Zoho number in `zoho_transfers`);
- marks the Zoho ticket page "**Moved to CK Desk as ZOHO-…**".

Migration `197_zoho_request_no.sql` lets the number trigger keep a `ZOHO-<digits>` number, only for the server (never for a signed-in user). Code: `lib/zoho/transfer/move.ts`, `approval.ts`, `coerce.ts`, `data-pure.ts`. Tests: `tests/unit/zoho-transfer*.test.ts`, `tests/integration/zoho-transfer-move.test.ts` (9).

### STAGE 3 — move everything that matches, markers, and "silent until switched on" (built locally, not released)

- **Move everything that matches** (`/zoho/move`, administrators): "Check what would move" reads **every** matching Zoho ticket (up to 20,000) and says how many are ready (open / finished), how many cannot yet and why. Then "Move these N tickets…" asks once more and moves them **25 at a time** from the browser, with **Pause / Resume / Stop** between steps. Each run is recorded in `zoho_transfer_runs` (who, when, filters, asked / moved / failed, the first 200 failures); the last runs are listed on the page.
- **Moved filter:** All tickets / Not moved yet / Already moved.
- **Markers:** Zoho **Overview** has a "Moved to CK Desk" card (count and share); **Find a ticket** shows "Moved → ZOHO-…" in the list and a green note with a link on the ticket; CK Desk tickets carry a **"From Zoho"** badge (ticket page, list, board). To list them all, search `ZOHO-` in Requests.
- **Moved tickets are SILENT until switched on.** A moved ticket keeps its Zoho created time, so an old open one is already late. The scheduled Business Rules ("unassigned for N minutes", SLA % elapsed, overdue) and the "unassigned" alert would otherwise notify about thousands of old tickets at the next run. Tickets with a `ZOHO-` number are therefore **left out of those jobs** by default (`lib/zoho/transfer/silent.ts`, applied in `app/api/business-rules/run` and `app/api/alerts/run`). One switch on the Move page (`app_settings` key `zoho.moved_tickets_active`, default OFF) lets them take part when the owner is ready. They remain searchable, countable and workable.
- **Migration 198** (`zoho_transfer_runs`). Code: `lib/zoho/transfer/batch.ts`, `silent.ts`; screens `RunPanel.tsx`, `MovedSwitch.tsx`. Tests: `tests/unit/zoho-transfer-silent.test.ts`, `tests/integration/zoho-transfer-run.test.ts`.

### Approvals in Zoho — what exists (checked 2026-11-17, read-only)

- **The live copy already carries approvals, in the history lines** (live `zohomigrationdb`, 107,648 tickets): approval status Approved 25,337 · Pending Approval 574 · Denied 270 · Pending Clarification 3; history lines `approver_added` 28,054 · `req_approval` 28,051 · `approve` 26,283 · `reject` 285 · `approver_removed` 398 · `approval_reminder_sent` 9,554 · `approval_status_change` 52,612. Every `approve` / `reject` line (26,568) carries the approver's name and the "Approval Comments". The move writes each of these as an entry with its Zoho time and person; reminders and the system's status lines stay only in the history list.
- **The Zoho API also has them in full** (read-only, tested on live ticket #42366): `GET /api/v3/requests/{id}/approval_levels` (level number, who sent it, created / completed time, status) and `GET /api/v3/requests/{id}/approval_levels/{level}/approvals` (the approver with e-mail, employee id and department, `comments`, `sent_on`, `action_taken_on`, status). It is **not** pulled by the sync today (one more call per level per approved ticket, about 28,000 tickets). The history lines hold the same facts for the tickets copied so far, so it is an option, not a need: add it only if the stage-by-stage list for **pending** approvals becomes important.

### What a technician sees on a moved ticket that was already In Process in Zoho
Zoho "In Process" becomes CK Desk **In progress** (the mapping you confirm). The ticket arrives already **In progress**, so the technician does **not** press **Start Working** (that button is shown only while a ticket is Open or Assigned). The move also marks it as already responded to, so it does not open with "response overdue". A Zoho "Open" ticket stays **Open** and needs Start Working as usual. The technician is chosen by the Business Rules **quietly**, so there is no "assigned to you" bell: the ticket is in their queue with the **From Zoho** badge. Open question for the owner: whether a ticket already worked on in Zoho should keep the same technician (when he exists in CK Desk and is on the team) instead of the rule's choice.
