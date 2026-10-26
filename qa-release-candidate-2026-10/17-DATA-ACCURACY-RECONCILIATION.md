# 17 — Data accuracy and reconciliation

Method: take a number a person sees on a screen (or in a mail), recompute it independently with SQL on the isolated audit database, and compare. All numbers are synthetic QA data. Evidence: `evidence/06-e2e.jsonl` (J7), `evidence/09-*`, `evidence/mail-sink/`.

| # | What was compared | Screen / mail says | Independent SQL says | Match |
|---|---|---|---|---|
| 1 | Smart Dashboard, last 30 days: tickets created | 307 | 307 (window = IST calendar days, from 27 Sep 00:00 IST) | **yes** |
| 2 | …resolved + closed in the period | 58 Resolved + 65 Closed = 123 | 58 + 65 | **yes** |
| 3 | …open backlog | 1,595 (426 Open · 147 Assigned · 606 In Progress · 139 Hold-Purchase-HO · 139 Waiting on User · 138 Pending Approval) | the same six counts, total 1,595 | **yes** |
| 4 | …status table of the period | 47 + 14 + 74 + 21 + 14 + 22 + 47 + 59 + 9 = 307 | same by status | **yes** |
| 5 | Drill into "Hold – Purchase from HO" | 14 matching tickets, 6 stores | 14 | **yes** |
| 6 | Sheet Masters: AC sheet | 8 active + 1 inactive ACs; "Rows read 9" | CSV: 9 data rows, 8 "Active"; DB `master_ac_units` 8 active / 1 inactive | **yes** |
| 7 | Genset / CVM sheets | 2 gensets, 5 stores with a CVM | CSV 2 rows / 5 rows; DB 2 / 5 | **yes** |
| 8 | PMS sheet | "Rows read 4", 1 problem | CSV 6 rows = 4 valid dates + 1 blank date (ignored) + 1 text "not a date" (flagged with row number and advice); DB holds the 4 valid dates | **yes** |
| 9 | After a broken AC sheet (header changed) | "keeps working with the last good copy", 8 active ACs | DB still 8 / 1 | **yes** |
| 10 | Vendor PO register | PO-QA-0001, amount without GST 16,000.00 | DB: approved PO v2, 1 × 16,000 = 16,000; v1 (18,500) superseded and not counted | **yes** |
| 11 | Approval-history box in the CVM mail (store QSA, sub-category Fixtures 4 ways) | 10 rejected "not needed this time", 4 approved; "Approved in these 12 months: Qty 4" | DB approvals: CKSD-007077 rejected qty 10, CKSD-007076 approved qty 4 | **yes** |
| 12 | SLA hold and resume (CKSD-007075) | hold sets the pause time, resume credits it | `waiting_since` set while on hold, cleared after; `paused_ms_total` > 0 | **yes** |
| 13 | Ticket numbers / counts after fault injection (database stopped 35 s) | 3,267 tickets | 3,267 before and after | **yes** |
| 14 | Chain of audit-log rows after 3 scale runs | no gap, none broken | `system_log_verify_chain` = 0 broken rows, sequence gap 0 | **yes** |
| 15 | Approval history, 12 months | 11-month-old approval listed, 13-month-old not | by date arithmetic in the test | **yes** (after QA-D007) |
| 16 | CSV export of requests versus SQL | **first run: file held 1,000 rows, SQL counted 3,274** (QA-D020, fixed); after the fix: file rows = SQL count for all, per status, per priority, date range; commas, quotes and line breaks in titles read back unchanged; a title starting with `=` is neutralised | **yes (after fix)** |
| 17 | Dashboard totals compared with the *Report Builder* and the *Predefined Reports* for the same period | not compared in this run | — | **NOT DONE** |
| 18 | SLA breach counts versus a manual recount over business hours with holidays | the dashboard showed 0 breaches in this synthetic data, so it cannot prove the maths; SLA arithmetic is covered by unit tests (`tests/unit` SLA files, all passing) | — | **PARTIAL** |

Observations:
* The 30-day window on the Smart Dashboard starts at the beginning of the IST day 30 days back; a plain "now minus 30 × 24 h" count differs by a few tickets (310 vs 307). That is by design, but the wording on the screen ("last 30 days") could say "from 27 Sep".
* Two requests of the same minute get consecutive numbers; the number sequence is shared with synthetic tickets, so numbers on this QA database are not meaningful.

Verdict: where compared, the screens agree with the database. Rows 16–18 are listed as not done / partial in report 18.
