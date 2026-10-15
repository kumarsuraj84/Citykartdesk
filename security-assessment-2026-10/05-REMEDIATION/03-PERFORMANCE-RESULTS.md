# 05 / 03 — Performance and stability (LOCAL, bounded synthetic workload)

Method: `tests/vapt/90-performance.test.ts` — 40 timed calls per operation after one warm-up, as real signed-in synthetic users against the audit stack (PostgREST with row security on), 3,000 synthetic tickets in one organisation. The same test was run with the previous database rules (rollback of migration 164 applied) and with the new rules. Raw: `perf-before-164.json`, `perf-after-164.json`. Milliseconds.

| Operation | P50 before → after | P95 before → after | P99 before → after |
|---|---|---|---|
| manager: list 1000 tickets | 4.6 → 4.7 | 6.0 → 6.6 | 7.1 → 6.8 |
| manager: count all tickets | 3.6 → 3.6 | 4.2 → 4.2 | 4.3 → 4.4 |
| technician: list own group tickets | 4.9 → 4.9 | 5.8 → 5.8 | 6.4 → 6.5 |
| requester: list own tickets | 4.9 → 4.8 | 5.5 → 5.1 | 6.3 → 5.3 |
| technician: edit a ticket (update trigger path) | 4.3 → 4.1 | 5.6 → 6.0 | 5.6 → 6.3 |
| requester: read attachment rows of a ticket | 2.6 → 2.7 | 3.6 → 3.3 | 4.0 → 3.5 |
| manager: title search | 2.5 → 2.0 | 3.1 → 2.5 | 3.5 → 2.7 |

Reading: no measurable regression; differences are within run-to-run noise (about ±1 ms). The extra trigger comparisons and the stricter policies cost nothing visible at this size.
Limits (stated honestly): one organisation, loopback network, 40 samples, no concurrent users, no file transfers, no authentication timing, no production load. The System Log now also records SLA due-date and pause-ledger changes on ticket updates (more audit rows on every resume/pause): the earlier audit warned that every audited ticket change takes one shared lock in the log chain, which could return as contention under heavy concurrency; this needs a load run on a production-like machine before release. The upgrade to Next.js 16.3.8 was not benchmarked separately (page rendering was not measured).
