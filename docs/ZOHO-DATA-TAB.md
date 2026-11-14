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
| `/zoho/tickets` — Find a ticket | Open any Zoho ticket **by its Zoho ticket number**. Shows every field the old system held, the fields of that service, the attachments, and the whole conversation (e-mails, replies, notes and recorded changes). There is also a word search for when the number is not to hand. |

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
