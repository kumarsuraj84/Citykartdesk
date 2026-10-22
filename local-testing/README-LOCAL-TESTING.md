# Local testing with the real configuration

This runs on THIS computer only: your local database (a mirror of the main configuration: the real services, categories, sub-categories, templates, stores) and the app at
http://localhost:3210. It has no e-mail provider and `MAIL_SINK_DIR=local-mail-outbox` is set in `.env.local`, so **nothing is e-mailed**: every message the app would send
(for example the mail to the OEM) is saved as a file in `local-mail-outbox/` and can be opened to read it.

What was set up here (the same switches an administrator will set on the live system at go-live):
- the local database brought up to the latest migration (176); a backup of how it was before is `local-backup-before-sheet-masters-20261019.dump`;
- ADMIN AC TEMPLATE: the "AC Serial Number" dropdown reads the store's Active ACs from the AC sheet;
- ADMIN REQUIREMENT TEMPLATE: a "Qty" field, mandatory only for FIXTURES, FIXTURES-ATTACHMENT and HANGERS;
- category ADMIN AC ISSUE sends to the AC OEM; GENSET-CUMMINS ISSUE and GENSET-MAHINDRA send to the Genset OEM; FIXTURES, FIXTURES-ATTACHMENT and HANGERS go to the store's CVM for approval;
- the three real Google Sheets are the sources (Admin > Sheet Masters). They are read once Google Sheets is connected (see below).

Logins (all with the password `Local-Test-Pw-2026!`):

| Who | E-mail | What to try |
|---|---|---|
| Administrator | local.admin@example.test | Admin > Sheet Masters (connect Google, update, health, templates); Admin > Vendors |
| Technician (Admin group) | local.tech@example.test | Agent Requests, Purchase orders |
| ALC store | local.alc@example.test | New request > ADMIN - AC: the AC list is ALC's Active ACs |
| MAR store | local.mar@example.test | Same for MAR |
| COB store | local.cob@example.test | Same for COB |
| OEM engineer (vendor technician) | voltas.tech1@example.test, voltas.tech2@example.test, bluestar.tech1@example.test, bluestar.tech2@example.test, bluestar.tech3@example.test | http://localhost:3210/vendor : Start working (OEM ticket number), Resolve (AC RESOLUTION + FSR), Part required, PO required |
| Vendor manager (view only) | voltas.manager@example.test, bluestar.manager@example.test | http://localhost:3210/vendor : all tickets of the company's technicians |
| PO approver | krishan.patel@citykartstores.com (real person, default approver) or local.po.approver@example.test | the e-mail link or http://localhost:3210/purchase-orders : approve (PO number, date, document) or reject |

## Connecting Google Sheets locally (needs three things from you, done once)
1. In Google Cloud (the project of the mailbox connection) switch on the **Google Sheets API**.
2. In the OAuth client, add the redirect address `http://localhost:3210/api/intake/oauth/callback` (for a separate local client, create one of type "Web application").
3. Put the client's id and secret into `.env.local` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` (the two keys are there, empty), restart the dev server, open
   Admin > Sheet Masters, press **Connect Google Sheets**, sign in as `citykartdesk@citykartstores.com` and press **Allow** (view-only), then **Update from sheets now**.

## Refreshed from live on 2026-10-21
The local database was replaced with a copy of the live DATA taken on 2026-10-21 (231 stores, 554 people, 384 tickets). Passwords and mail settings were NOT copied.
- Every person has a local login with their real e-mail address (for example sm.mic@citykartstores.com, suraj@citykart.org) and the SAME local test password given above, so any role can be tested.
- local.admin@example.test and local.tech@example.test are extra helpers (administrator / technician of the Admin group).
- No e-mail leaves this PC (saved as files in local-mail-outbox/). Attachment files of old tickets do not open (they are on the NAS, not copied).
- The files live-data-for-local-*.dump and live-people-for-local-*.csv in this folder are copies of live data: never commit them (they are ignored by git) and delete them when no longer needed.
- Before the refresh, the previous local database was saved as local-backup-before-live-refresh-20261021.dump in the project folder.

## Vendor test data (2026-10-22)
Run `node local-testing/seed-local-vendors.mjs` once (safe to repeat): vendor companies Voltas and Blue Star, their logins (same local test password), two test Voltas ACs for the stores ALC and MAR, and two Business Rules that give an ADMIN AC ISSUE ticket to a technician of the AC's vendor. `local-testing/make-vendor-test-ticket.sql` turns the COB ticket CKSD-000385 into an Open ticket of Blue Star Technician One.
