# 09 — Performance, Load, Stress and Soak Results

> Everything ran on the **audit copy only** (disposable database, app on this PC). Nothing was run against the live server.
> **Important:** the test PC (Intel i9-14900KS, 32 threads, 128 GB RAM) is far stronger than the live app server. Numbers below show **how the software behaves as data and users grow**, not what the live server will deliver. Run the same scripts on a copy of the live hardware before quoting any figure to the business.

## Plain summary
- **Today's volume (about 3,000 tickets): fine.** Up to 50 people clicking at the same time, no errors and every page under about 2 seconds. At 100 people the typical page takes 1.6 seconds and the slow ones 2.7 seconds. No errors.
- **At 100,000 tickets: fine up to about 25 people, slow at 50 and above.** At 50 people the typical page takes 2.2 s and the slowest 10 s; at 100 people 4.6 s / 15 s. Still **no errors**; the app just gets slow.
- **At 500,000 tickets: usable for one to ten people, slow after that,** and a few requests time out (60 s) when 50 or more people open the Admin Reports page at once.
- **The bottleneck is one thing:** the app runs as a **single Node process** (it can use one processor core), and a few heavy pages (Executive dashboard, Admin Reports, Admin Users) do a lot of work in that one process.
- **Stable over time:** 15 minutes at 25 people on 100,000 tickets: 7,117 requests, **0 errors**. Memory grew from 678 MB to 906 MB; I did not collect a long enough trend to say whether it levels off (see "Open questions").
- **Hard stress** (100 and 200 people with no pauses at 100,000 tickets): **0 errors, but 4 to 9 seconds for a typical page, 20 to 40 seconds for the heaviest pages.** The app queues rather than failing.

## How it was measured
| Item | Detail |
|---|---|
| Script | `perf/load.mjs` (signs in as the nine test personas, then walks a realistic page list: Home, requests, approvals, dashboards, reports, admin pages, with 1–4 s "think time") |
| Server | production-mode build on port 3311 (`perf/start-audit-prod.cjs`), single Node process, local database |
| Data sizes | 3,284 tickets (the audit data), 103,284 and 503,284 (synthetic tickets added by `perf/gen-tickets.sql`, labelled `PERFLOAD`) |
| User counts | 1, 10, 25, 50, 100 simultaneous users per size |
| Measures | requests, errors, requests/second, P50 / P95 / P99 / max in milliseconds, server memory and CPU |
| Pass rule used (my proposal — the owner has set no target) | **0 errors and P95 ≤ 3 seconds** |

## Result table (ms; evidence `evidence/perf/table.md`, one JSON per run)
| Tickets | Users | Requests | Errors | Req/s | P50 | P95 | P99 | Max | Server RAM MB | CPU (one core) | Slowest page (P95) | Rule |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3,284 | 1 | 24 | 0 | 0.4 | 59 | 70 | 73 | 73 | 179→186 | 2% | Executive dashboard | PASS |
| 3,284 | 10 | 271 | 0 | 4.5 | 51 | 249 | 1,695 | 1,944 | 235→409 | 17% | Requests list | PASS |
| 3,284 | 25 | 613 | 0 | 10.2 | 60 | 592 | 1,422 | 1,667 | 344→565 | 30% | Executive dashboard | PASS |
| 3,284 | 50 | 1,185 | 0 | 19.8 | 141 | 1,068 | 1,719 | 2,083 | 542→754 | 54% | Requests list | PASS |
| 3,284 | 100 | 1,738 | 0 | 29 | 1,567 | 2,497 | 2,734 | 4,606 | 748→805 | 78% | Executive dashboard | PASS |
| 103,284 | 1 | 24 | 0 | 0.4 | 66 | 88 | 1,429 | 1,429 | 733→734 | 2% | Requests list (store) | PASS |
| 103,284 | 10 | 271 | 0 | 4.5 | 58 | 399 | 1,633 | 1,789 | 741→738 | 13% | Requests list | PASS |
| 103,284 | 25 | 620 | 0 | 10.3 | 72 | 1,020 | 1,965 | 4,635 | 749→846 | 35% | Executive dashboard | PASS |
| 103,284 | 50 | 696 | 0 | 11.6 | 2,159 | 4,983 | 10,072 | 11,109 | 850→840 | 97% | Executive dashboard | **FAIL (P95 > 3 s)** |
| 103,284 | 100 | 981 | 0 | 16.4 | 4,588 | 8,883 | 15,012 | 24,498 | 879→1,016 | 114% | Executive dashboard | **FAIL** |
| 503,284 | 1 | 35 | 0 | 0.6 | 96 | 1,766 | 1,880 | 1,880 | 526→226 | 15% | Approvals | PASS |
| 503,284 | 10 | 215 | 0 | 3.6 | 96 | 2,974 | 5,620 | 16,543 | 442→651 | 36% | Admin Reports | PASS (borderline) |
| 503,284 | 25 | 520 | 0 | 8.7 | 320 | 3,199 | 5,323 | 7,676 | 813→849 | 77% | Admin Reports | **FAIL** |
| 503,284 | 50 | 644 | **3 (0.47%)** | 10.7 | 1,484 | 7,980 | 18,316 | 60,010 | 762→1,072 | 86% | Admin Reports | **FAIL** |
| 503,284 | 100 | 901 | **2 (0.22%)** | 15 | 4,179 | 10,670 | 20,532 | 60,457 | 1,386→1,305 | 117% | Admin Reports | **FAIL** |

The five errors at 500,000 tickets are all **60-second time-outs on the Admin Reports page**, not crashes: the app kept answering other requests.

Tally against the proposed rule: 3,284 tickets 5/5 PASS; 103,284 tickets 3 PASS, 2 FAIL; 503,284 tickets 2 PASS, 3 FAIL. **Total 15 runs: 10 PASS, 5 FAIL** (all five at data sizes 30 to 150 times today's).

## Soak (long run)
| Test | Result |
|---|---|
| 25 users, 100,000 tickets, **15 minutes** (`evidence/perf/soak100k-u25.json`) | 7,117 requests, **0 errors**. P50 400 ms, P95 3,273 ms, P99 5,046 ms, max 10,219 ms. Server memory 678 → 906 MB. About 87% of one core |
| Verdict | **PASS for stability** (no errors, no crash, no restart). P95 is slightly over the 3 s rule because the test has no pauses between pages beyond the think time and the Executive dashboard is the heavy page. |

## Stress (no think time, 100,000 tickets)
| Users | Result |
|---|---|
| 100 | P50 4,041 · P95 8,896 · P99 20,076 · max 36,958 ms · **0 errors** |
| 200 | P50 9,196 · P95 20,679 · P99 34,060 · max 42,013 ms · **0 errors** |

The app does not fall over; it queues. Typical response time grows roughly in step with the number of waiting users because one process does all the work.

## Page weight (single user)
| Page | Size / time | Comment |
|---|---|---|
| Executive dashboard | **18.6 MB** page, about 0.9 s at 3k tickets; 6–24 s under load at 100k | loads up to 30,000 tickets into one page (hard cap with an on-screen "oldest tickets left out" notice) |
| Admin > Reports | 1.1 s at 100k; **13–16 s at 500k**; time-outs under load | heavy server-side aggregation |
| Admin > Users | 2.4 MB (all 684 people in one page) | fine today; grows with staff |
| Technician manager Home | 2.3 s at 500k tickets | |
| Ordinary pages (requests list, ticket, approvals) | under 0.1 s at 3k and 100k; up to 2 s at 500k for the busiest roles | |

## Scheduler (business-rule engine) cost
Measured with `perf/scheduler-scale.mjs` and `scheduler-rule-scale.mjs` (see report 11): **about 12.5 ms per overdue open ticket per rule per run**. One rule over 8 tickets: 0.2 s; 2,088: 27 s; 5,002: 62 s; 9,994: 126 s; 19,977: 249 s. Safe today, but a bulk import of many old open tickets would make each scheduled run long.

## Defects and observations
| ID | Sev | Finding |
|---|---|---|
| PERF-001 | P2 | Executive dashboard sends 18.6 MB (up to 30,000 tickets) in one page |
| PERF-002 | P2 | Admin Reports slow at scale (13–16 s at 500k, time-outs under load) |
| PERF-003 | P3 | Admin > Users ships every person in one 2.4 MB page |
| PERF-004 | P2 | Scheduler cost grows with overdue open tickets (see 11) |
| PERF-005 | P3 | One Node process is the ceiling: about 30 requests/s at 3k tickets, about 15/s at 100k, even on a very fast PC |

None was changed in this audit (each is a design or owner decision; see report 16 items 2 and 3).

## What was not measured
| Item | Status |
|---|---|
| Live server hardware / network (10.0.1.98, 10.0.0.205, NAS) | **NOT RUN** (no production access, by instruction) |
| Browser rendering time on a slow office PC or phone for the 18.6 MB dashboard | **NOT RUN** |
| Database tuning (indexes, query plans) at 500k | partly seen (slow pages are in-app aggregation) but no separate plan analysis was done |
| More than 15 minutes of soak, memory trend over hours | **NOT RUN** — memory rose 680 → 910 MB in 15 minutes; check a longer run before judging a leak |
| File upload and download throughput on the NAS | **NOT RUN** |
| Real mail, WhatsApp, mailbox sync under load | **NOT RUN** (blocked on purpose) |

## Recommendations (all are owner decisions)
1. Plan server-side summaries for the Executive dashboard and Admin Reports before the live ticket count passes about 20,000; keep the on-screen truncation notice until then.
2. Run the same load script once against a copy of the live hardware so the business has real numbers.
3. Consider running two app processes behind the existing proxy once users exceed about 50 at the same time (a deployment decision; no code change).
4. Do the bulk import of old tickets as closed/resolved, or first move the rule filter into the database (report 11).
