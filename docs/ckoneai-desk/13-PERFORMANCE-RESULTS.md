# 13. Performance results

Status: LOCAL, measured 2 Nov 2026 on the development PC (10.0.0.47). **CKOneAI's own response time was not measured** (it runs on another machine, and no run of the question bank has happened). Only what CKDesk adds can be stated.

## What was measured

| Measure | Result | How |
|---|---|---|
| Time added by CKDesk's forwarding step (checks, signing, one extra local hop), one caller, 300 calls | **median +0.12 ms, 95th percentile +0.17 ms** (0.32 ms vs 0.21 ms direct) | `CKONEAI_BENCH=1 npx vitest run tests/unit/ckoneai-forward.test.ts`; file `evidence/forwarding-overhead.json` |
| Same, 20 callers at once x 10 rounds (200 calls) | median 2.5 ms, 95th percentile 5.2 ms per call (calls queue on one Node process and one local stand-in) | same |
| Streaming | answer pieces arrive as produced: 3 pieces at 0.75 s, 1.45 s and 2.15 s through the running dev app; first piece **not** held until the end | end-to-end run through the dev app |
| Long answer | a stream of 130 seconds (13 pieces plus end) delivered whole, both in the forwarder test and through the running app | tests |
| Data API paging | 3,274 tickets read in pages of 1,000 / 1,700 / 5,000 with no row skipped (test 67); the 12 contract tests of file 69 ran in 3.5 s on the isolated stack | tests |

## What these numbers do not cover

- The full browser path in a **production build** (login check, `proxy.ts`, session refresh) was not benchmarked; the dev server is not representative. This is unmeasured and must be measured in the pilot, before CKOneAI's own time is added.
- CKOneAI's routing, query and answer time, model fallback frequency (expected zero: the model is not called in this scope) and concurrent load on its server: **not measured**. To be taken from the run of the question bank by the CKOneAI session (P50/P95 per tool and for concurrent users).
- The platform's refresh lag (every 30 minutes by the DBA's schedule) is the real "freshness" limit of every operational answer: an answer can be up to about 30 minutes old plus the platform's load time; the answer must show its as-of time.

## Limits set in CKDesk for protection

20 chat questions per person per minute; message at most 256 KB; first byte within 60 s (15 s for page files); answer at most 10 minutes. If CKOneAI is slow the only effect is a slow chat: CKDesk's own pages never wait for it.


## Real measurement against the CKOneAI test instance (2 Nov 2026, first run)

From `evidence/eval-run-1.json` and the browser test. Warm, over 229 questions through signed calls from the dev PC to 10.0.0.82:8196: **P50 62 ms, P95 227 ms, maximum 1810 ms** (mock model, so no model time). Through CKDesk in the browser the answer appeared within about a second once warm.

**Cold start (needs fixing before a pilot):** the first question after the test instance started took more than 60 seconds before CKOneAI sent anything. CKDesk's forwarder waits 60 seconds for the first byte, then answers 502, so the person saw "I couldn't finish that answer (http_502)" and had to press Retry. A direct call a minute later waited about 28 seconds (queued behind the abandoned first question; one shared model slot), and every call after that was fast (about 50 ms for a personal list, about 600 ms for an org-wide summary). Asked of CKOneAI: warm the platform connection when it starts, and send the first event (conversation / status) at once so the stream opens early. CKDesk can also wait longer for the first byte if the owner prefers; today it is 60 s.
