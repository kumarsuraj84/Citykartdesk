# 09 — Performance and scale

Everything below ran on the **isolated audit database with synthetic tickets** on this PC (the same PC also ran the app, the browser and Docker, so absolute numbers are indicative; the *shape* — how time grows with data — is what matters). Raw files: `evidence/perf/perf-qa-{3k,100k,500k}.json` (data-API reads/writes), `evidence/perf/qa-perf-qa-{3k,100k,500k}.json` (whole workflows), logs `scale-*.log`, `workflows-*.log`, `campaign.log`. All three runs passed their isolation gate (21/21).

Data sizes: **3,268**, **103,268** and **503,268 tickets** (1.0 GB database). The extra tickets are tagged `PERF-DATA` and were removed afterwards (3,266 left).
Method: P50 / P95 / P99 over 40 timed runs per read (15 for workflows, 5 for the heavy dashboard load), as real signed-in users with row security on; writes with 1, 10 and 25 parallel callers.

## 1. Reads through the data API (ms, P50 / P95 / P99)

| Operation | 3k | 100k | 500k |
|---|---|---|---|
| Manager: list 1000 tickets | 4.5 / 6.0 / 6.8 | 5.5 / 7.7 / 8.5 | 5.1 / 6.0 / 6.6 |
| Manager: count all tickets | 4.2 / 5.3 / 6.5 | 19.5 / 22.1 / 22.6 | **83.4 / 86.5 / 89.7** |
| Technician: list own group (500) | 6.6 / 7.5 / 8.6 | 29.5 / 32.9 / 33.5 | **120.8 / 134.1 / 137.2** |
| Requester: list own tickets | 6.2 / 6.6 / 6.9 | 26.6 / 27.5 / 31.4 | **107.0 / 112.3 / 113.2** |
| Open one ticket | 2.2 / 5.1 / 5.7 | 2.1 / 2.9 / 3.3 | 2.1 / 2.7 / 3.2 |
| Attachment rows of a ticket | 3.3 / 5.1 / 6.0 | 1.6 / 3.8 / 4.3 | 1.3 / 3.3 / 3.6 |
| Title search (50 rows) | 2.3 / 3.0 / 3.6 | 2.4 / 3.3 / 3.9 | 2.3 / 2.9 / 3.1 |
| People list (requester / technician) | 19.2 / 20.8 ; 10.4 / 15.7 | 16.6 / 21.5 ; 11.8 / 12.9 | 18.0 / 23.3 ; 12.4 / 14.0 |
| Home dashboard (requester / manager) | 3.1 / 5.0 ; 4.1 / 6.6 | 2.6 / 3.7 ; 3.7 / 5.0 | 3.1 / 4.1 ; 4.0 / 4.6 |
| Activity of one ticket | 2.8 / 3.7 / 3.9 | 2.3 / 3.3 / 3.7 | 1.8 / 3.3 / 3.9 |

Errors: **0** in every cell. Compared with the security team's own runs of 17 Oct (3k: manager list 4.6/5.8, group list 5.4/6.0; 100k: group list 24.6/26.0, requester list 21.7/22.6) today's numbers are the same within noise — **no regression from the fixes**.

Reading: single-ticket and search operations stay at 2–3 ms at any size. "List what I may see" and "count" grow in step with the number of tickets (row-level security is evaluated per row): about 5 ms → 30 ms → 120 ms. That is acceptable up to 500k tickets for those screens.

## 2. Whole workflows (ms; app code + database)

| Workflow | 3k | 100k | 500k |
|---|---|---|---|
| Create a ticket (sequential) P50 / P95 | 128 / 140 | 122 / 177 | 122 / 155 |
| 10 tickets at once: P95, lost or doubled | 223, 0 | 233, 0 | 220, 0 |
| 25 tickets at once: P95, lost or doubled | 514, 0 | 494, 0 | 493, 0 |
| Technician group first page P50 | 31 | 76 | 274 |
| Search text in the queue P50 | 76 | 124 | 321 |
| **Manager queue first page P50 / P95** | 40 / 46 | **540 / 561** | **2,521 / 2,624** |
| **Executive dashboard load (all rows) P50** | 152 | **4,112** | **4,077** |
| CSV export of requests | 73 | 74 | 72 |
| Vendor dashboard list | 24 | 68 | 320 |
| Approval decision, sequential P50 | 58 | 59 | 66 |
| 20 approvals decided at once: P95 | 190 | 239 | 265 |
| AC PMS generation, 60 stores | 2.5 s | 2.8 s | 3.0 s |
| Sheet copy of 3,000 rows: first / unchanged / one row changed | 0.24 / 0.18 / 0.21 s | 0.26 / 0.20 / 0.20 s | 0.25 / 0.22 / 0.18 s |

## 3. Writes under parallel load (updates per second, P95 ms)

| Callers | 3k | 100k | 500k |
|---|---|---|---|
| 1 | 352/s (4.0) | 368/s (3.7) | 364/s (4.4) |
| 10 | 1,947/s (6.7) | 2,122/s (5.6) | 2,169/s (5.5) |
| 25 | 2,615/s (9.7) | 2,610/s (10.5) | 2,848/s (9.3) |

Audit-log appends (every audited action takes one lock, so they queue): 353 → 1,063/s with 25 callers; P95 at 25 callers 23–25 ms. After every run the **hash chain had no gap and no broken row** (`chain_sequence_gap 0`, `chain_broken_rows 0`). Database connections 27, waiting locks 0 after the runs.

## 4. Findings

* **QA-D015 (P3, open):** Manager queue first page and the executive dashboard load do not scale past ~100k tickets (0.5 s and 4.1 s at 100k; 2.5 s and 4.1 s at 500k). Today's live size is far below 100k, so no action is needed for this release; plan an index / server paging review before the data grows 10-fold.
* **QA-D014 (P3, open):** the same approval decided twice at once stores two decision rows (outcome applied once).
* Ticket numbers on the audit database jumped to `CKSD-507…` because the synthetic tickets used the same number sequence — a test-data effect only.
* Not measured: 1,000 simultaneous *browser* users (no load generator was available for the app server in dev mode — the app was running as a development server, which is slower than the production build), the production build itself (the production build needs the Google Fonts download, which the egress guard refuses), memory of the app server, and network latency to the NAS. These are listed in report 18.

## 5. Verdict

Data-layer and workflow performance is good at today's size and acceptable at 100k; two screens need attention before 100k tickets. **PASS with two observations.**
