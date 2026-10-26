# 14 — Failure recovery and resilience

All fault injection was done on the **audit stack only** (containers `*_ckdesk_audit`) and the QA copy of the app (port 3310). The developer stack and production were not touched. Raw log: `evidence/14-failure.jsonl`.

The app has **no durable job queue** (no outbox / retry table). Its resilience comes from: a database-backed claim per job, idempotent steps, the guarded status changes, retry inside the data client (`resilient-fetch`) and the next scheduled run finishing what a stopped run left. The tests below exercise those.

| # | Fault | What was done | What happened | Result |
|---|---|---|---|---|
| FR-1 | Data API (PostgREST) stopped | Container stopped ~40 s, page loaded, then started | `/api/health` showed `ok (cached)` for a few seconds then **503 degraded** (correct). Signed-in pages failed with a logged `server_error` ("Could not load the signed-in profile"); error boundaries exist (`app/error.tsx`, `global-error.tsx`). After the start the same page loaded again without restarting the app. | **PASS** |
| FR-2 | Database stopped | Container stopped 35 s, started | `/api/health` **503**; after start: ok again within ~25 s on its own; ticket count identical before and after (3,267); nothing lost, nothing doubled. | **PASS** |
| FR-3 | Sign-in service (GoTrue) stopped | Tried to sign in | Before the fix: ~30 s, then *"Invalid login credentials"* (wrong, and counted toward the lockout). | **FAIL → fixed (QA-D016)** |
| FR-3b | same, after the fix | | *"Sign-in is temporarily unavailable. Please try again in a few minutes."* after 6 s; after the start, sign-in worked at once. Test `tests/unit/auth-outage.test.ts`. | **PASS (retest)** |
| FR-4 | File storage stopped | Opened an attachment | Before the fix: **404 "not found"** after 20 s. | **FAIL → fixed (QA-D017)** |
| FR-4b | same, after the fix | | 503 + `Retry-After` for an unreachable store, 404 only for a really missing file. Download worked again after the start. Test `tests/unit/attachment-storage-outage.test.ts`. | **PASS (retest)** |
| FR-5 | App server stopped and started | `preview_stop` / `preview_start` | The signed-in session stayed valid; next page worked. | **PASS** |
| FR-6 | Job interrupted half way (AC PMS) | test `qa-jobs-automation` | A run that stops half way is finished by the next run; one bad store does not lose or double the others (4 stores skipped as expected). | **PASS** |
| FR-7 | Overlapping jobs | tests | Two auto-close runs close once and tell the requester once; the daily approval reminder is sent once per approver per day even when called twice or at the same moment; two sheet copies never duplicate (this one found D001). | **PASS** |
| FR-8 | Mail transport failing / upload record failing | existing remediation tests (`tests/remediation/91-reliability.test.ts`) re-run in the final regression | A failing upload record leaves no orphan file; ticket creation does not depend on mail delivery. | **PASS** (see 07) |
| FR-9 | 25 tickets created at once | `qa-perf-workflows` | 25 stored, 0 lost, 0 doubled at 3k, 100k and 500k tickets. | **PASS** |
| FR-10 | Same approval decided twice at once | `qa-perf-workflows` | Both calls accepted, **two decision rows**, outcome applied once. | **FAIL → open (QA-D014)** |

## Not tested (and why)

* Killing the app process in the middle of a ticket save (would need a production-mode build under the guard; the google-fonts download of a production build is refused by the guard). Risk judged low because ticket creation is a single database write guarded by a submission key (`tests/vapt/28-concurrency-and-idempotency.test.ts` re-run, passing).
* Power loss / disk full / network partition between app and database: not simulated.
* Restore of a backup into a fresh database: not run here (the audit DB dump exists; production restore is described in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`).

## Verdict

Recovery behaviour is good: services come back by themselves and no data was lost. Two wrong *messages* during outages were found and fixed. A later full run on a half-stopped test database also showed that the System Log integrity check had a size limit (QA-D019, fixed). One data-integrity wart (duplicate decision rows) is open.
