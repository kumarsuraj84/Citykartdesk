# 06 — System / end-to-end results (8 journeys)

All journeys were done by hand in the QA copy of the app (`http://localhost:3310`, Chromium pane) with synthetic users on the isolated audit stack, and checked against the database with SQL. Each step is also a line in `evidence/06-e2e.jsonl`. Mail went to the mail sink (`evidence/mail-sink/`). Tickets made: CKSD-007073 (J1), CKSD-007074 (J2), CKSD-007075 (J3), CKSD-007076/77/78 (J4), CKSD-007030–32 (PMS), CKSD-507628 (XSS test).

| # | Journey | Result | Defects found on the way |
|---|---|---|---|
| 1 | Normal ticket: raise → assign → start → waiting on user → requester replies → resolve → rate → auto-close | **PASS** (7 steps) | QA-D003 (password in the address on an early sign-in submit) found while logging in |
| 2 | SLA pause and resume: Hold due to Purchase from HO with remark, leaving it with its own remark | **PASS** (2 steps) | none |
| 3 | AC vendor flow: raise AC ticket → auto-assign to Voltas technician → OEM mail → start with OEM number → part required → parts received → PO required with quote → approver asks revised price → vendor sends v2 → approver approves with PO number, date, document → vendor resolves with resolution + FSR | **PASS** (5 steps) | none new (QA-D004 and QA-D008 relate to the PMS side) |
| 4 | CVM approval with history: two earlier requests (approved 4, rejected 10), new request qty 6 → CVM mail and approve page show the box; another user opening the link is refused; comment required; replay safe | **PASS** | none |
| 5 | AC PMS: sheet row → ticket at 09:00 → vendor "AC PMS tickets" tab → start PMS visit (no OEM number) → resolve with PMS report | **PASS** | QA-D004 (routing), QA-D008 (double star) |
| 6 | Sheet Masters: bad date flagged in plain words; broken AC sheet header → "keeps working with the last good copy"; restored sheet recovers; 30-second throttle; one sheet failing does not touch the others | **PASS** | QA-D001 (two updates at once) found by test |
| 7 | Dashboards / reporting: 30-day numbers reconciled with SQL (307 / 123 / 1,595), drill-down count equals SQL | **PASS** | — |
| 8 | Administration: all admin pages open and pass axe; vendor login created through the form; role access matrix for requester, technician, vendor | **PASS (partial)** — creating services, forms, categories, rules and permissions was not walked by hand (report 18) | QA-D002 (manager could change category switches through the data API, found by test), QA-D010–D012 (accessibility) |

## Highlights worth knowing

* **Journey 1:** the requester's reply while "Waiting on User" moved the ticket back to In Progress and **credited the paused time** to the deadline (33.5 s in the test). Resolve refuses a note shorter than 10 characters. A 1-star link demands a reason. After the reopen window the auto-close job closed the ticket once and sent one notice; a second run did nothing.
* **Journey 2:** both remarks (going on hold, coming off hold) are mandatory and appear in the conversation; deadline moved by exactly the paused time (41.3 s).
* **Journey 3:** every gate worked: empty OEM number (button disabled), empty parts list, missing quote ("Please attach the quote before you send it"), reason for a revised price, old quote version locked ("Replaced by a newer version"), PO needs number + date + document, resolve needs resolution + FSR. Mails in the sink: created, PO approval needed (approver), revised price (vendor), revised quote v2 (approver), PO approved (OEM PO mailbox + vendor + store), resolved (store). **Observation:** the store receives four "Request updated" mails during one vendor repair.
* **Journey 4:** the box says "Earlier requests of this store, same sub-category (last 12 months)": 10 rejected "not needed this time", 4 approved, "Approved in these 12 months: Qty 4". A rejected request becomes Cancelled; an approved one goes to In Progress.
* **Journey 5:** the vendor sees two tabs; the PMS ticket never appears under My tickets and the AC ticket never under PMS; "ACs to service (2)" is listed on the ticket.
* **Journey 6:** after the header of the AC sheet was broken, the page said "Cannot read … missing column Store Code. CK Desk keeps working with the last good copy"; 8 active ACs stayed; the admins got an alert mail ("CK Desk could not read the AC DETAILS sheet"); fixing the file turned it back to "Reading fine".
* **Journey 7:** numbers on the Smart Dashboard agree exactly with SQL (see report 17).
* **Smoke / role access** (report 03): 54 routes as admin without error; requesters, technicians and vendors are kept out of pages that are not theirs.

## Differences from the written guide seen during the journeys

Start Working does not ask for a typed first-response message (the system writes one automatically) — guide says it is compulsory (DOC-QA-08). Other differences are listed in report 02 and the guide's errata section.

## Verdict

All eight journeys completed. **PASS** (Journey 8 partial, stated above).
