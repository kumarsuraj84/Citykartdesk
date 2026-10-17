# 06 — Performance and scalability (local, synthetic data)

LOCAL ONLY. Everything below was measured on the disposable audit database on the developer PC (Docker, 62 GB RAM available to Docker, one database container), as real signed-in users through the data API with row security switched on, using synthetic tickets. **This is NOT a production performance claim.** Production has 314 tickets, 554 users and a 50 MB database (read-only figures from 2026-10-17), far smaller than any size tested here.

**Scope decision (owner, 2026-10-17):** the 500,000-ticket run was **not performed** ("not required"). The assignment asked for 3,000 / 100,000 / 500,000; the 500k point is therefore a recorded gap. A 400,000-ticket extra load was started and cancelled before any measurement.

## How it was measured
Test `tests/vapt/91-performance-scale.test.ts`, per operation 40 timed calls after one warm-up (P50 / P95 / P99 in milliseconds); writes with 1, 10 and 25 parallel callers; System Log hash-chain appends with 1, 10 and 25 parallel callers (every audit row takes the single chain lock); database container CPU, memory, connections and waiting locks sampled every 3 s by a separate process (so sampling does not distort the timings; an earlier version sampled synchronously and inflated the latencies — it was fixed). After the writes the System Log chain was re-verified over its newest 20,000 rows and the chain sequence was checked for gaps.

## Reads — before (migrations 164–170 rolled back) and after (applied), same 100,255 tickets
| Operation | Before P50 | Before P95 | Before P99 | After P50 | After P95 | After P99 | Errors (after) |
|---|---|---|---|---|---|---|---|
| manager: list 1000 tickets | 5 | 7.5 | 8.3 | 4.5 | 7.8 | 8.4 | 0 |
| manager: count all tickets | 18.8 | 21.4 | 22.9 | 18.8 | 21.1 | 21.7 | 0 |
| technician: list own group tickets | 24.8 | 26 | 28.8 | 24.6 | 26 | 26.9 | 0 |
| requester: list own tickets | 22.1 | 22.7 | 23.4 | 21.7 | 22.6 | 22.9 | 0 |
| technician: open one ticket | 2.2 | 2.9 | 3.1 | 2.3 | 2.8 | 3 | 0 |
| requester: attachment rows of a ticket | 2.8 | 3.4 | 3.5 | 3.3 | 3.6 | 3.9 | 0 |
| manager: title search | 2.3 | 2.9 | 3.2 | 2.3 | 2.8 | 3.3 | 0 |
| requester: list people they can see (profile rule) | 4.4 | 4.9 | 5.2 | 14 | 15.2 | 15.6 | 0 |
| technician: list people | 4.3 | 5 | 5.3 | 7.9 | 11.4 | 11.6 | 0 |
| requester: home dashboard | 3.7 | 6.5 | 8.3 | 2.5 | 4.4 | 4.5 | 0 |
| manager: home dashboard | 3.2 | 4 | 4 | 3.5 | 5.9 | 6 | 0 |
| technician: activity of one ticket | 2.4 | 3.1 | 3.4 | 2.6 | 3.3 | 3.5 | 0 |

All values in ms. **One deliberate cost:** listing the people a requester may see went from about 4 ms to about 14 ms (P50) because the new privacy rule decides per query who is visible; technicians' people lists rose from about 4 to 8 ms. Both are far below a perceptible delay. Everything else is within measurement noise.

## Reads at 3,253 tickets (after, for the small-size point)
| Operation | P50 | P95 | P99 |
|---|---|---|---|
| manager: list 1000 tickets | 4.6 | 5.8 | 6.2 |
| manager: count all tickets | 4.4 | 5.1 | 5.1 |
| technician: list own group tickets | 5.4 | 6 | 6.5 |
| requester: list own tickets | 5 | 5.5 | 5.7 |
| technician: open one ticket | 2 | 2.4 | 2.5 |
| requester: attachment rows of a ticket | 1.5 | 3.2 | 3.3 |
| manager: title search | 2.2 | 2.6 | 2.9 |
| requester: list people they can see (profile rule) | 472.1 | 501.1 | 526.8 |
| technician: list people | 7.6 | 8.1 | 8.5 |
| requester: home dashboard | 2.7 | 3.1 | 4.6 |
| manager: home dashboard | 3.7 | 4 | 4.4 |
| technician: activity of one ticket | 2.1 | 2.7 | 3 |

## Writes (updates of tickets through the server key), 100,255 tickets, 3000 updates per level
| Parallel callers | Before P50 / P95 / P99 | Before updates/s | After P50 / P95 / P99 | After updates/s | Errors |
|---|---|---|---|---|---|
| 1 | 2.3 / 3.2 / 4 | 394.3 | 2.3 / 3.2 / 4.2 | 395.2 | 0 / 0 |
| 10 | 3.7 / 5 / 9.5 | 2084.8 | 4.5 / 6.4 / 11.4 | 1150.6 | 0 / 0 |
| 25 | 5.9 / 9.1 / 11.9 | 2902.5 | 7.9 / 13.1 / 16.5 | 2089 | 0 / 0 |

## System Log hash-chain appends (the lock every audit row takes), 100,255 tickets
| Parallel callers | Before P50 / P95 / P99 | Before appends/s | After P50 / P95 / P99 | After appends/s | Errors |
|---|---|---|---|---|---|
| 1 | 2.2 / 2.9 / 3.5 | 434.6 | 2.4 / 3.9 / 4.6 | 372.7 | 0 / 0 |
| 10 | 6.1 / 9.5 / 10.4 | 1050.3 | 6.4 / 10.2 / 11.7 | 988.1 | 0 / 0 |
| 25 | 13.2 / 22.1 / 24.8 | 1107.7 | 13.3 / 22.4 / 25.3 | 1093.5 | 0 / 0 |

The chain lock serialises audit writers: throughput saturates at about 1,100 appends per second regardless of the number of callers (25 callers wait for the lock, P95 about 22 ms). That is far above any realistic load for this organisation (production holds 2,288 System Log rows in total). **Chain integrity under concurrency:** after 18,000 chained appends (9,000 before, 9,000 after) the sequence gap was 0 (every successful append took exactly one position, none lost or duplicated) and the verification of the newest 20,000 rows reported 0 broken rows.

## Database resources during the "after" write run
- Database container CPU: 23.05%, 22.51% (single container, sampled every 3 s).
- Memory: 390MiB / 62.68GiB.
- Connections: up to 27; waiting locks: 0 at every sample.
- Note: with only 2 samples in a short run these are indicative, not a profile.

## Row-level-security cost
All reads above are made with row security ON as ordinary signed-in users. The measured effect of the new rules on the busiest operations (ticket lists, counts, dashboards, activity) is within noise; the only measurable increase is the requester people list (above). A before/after plan comparison was not separately captured.

Migration 171 (table and function rights only, no query or index change) was added after these runs and cannot change query plans; it was not separately timed.

## What was NOT measured
- 500,000 tickets (owner decision).
- Browser rendering times, network latency to real users, the real application server under load (the data API was driven directly).
- Contention with the real mail/WhatsApp workers, cron jobs and the nightly backup.
- The production server hardware (the numbers above are from a developer PC).

## Raw data
`perf/perf-baseline-100k.json`, `perf/perf-final-100k.json`, `perf/perf-final-3k.json` (the 3k run pre-dates the append phase and the non-blocking sampler; its read figures are unaffected).
