# 08 — Storage and Reliability Simulations

*All simulations ran on the disposable audit stack with local storage (a Docker volume, no NAS). Every outage was produced by stopping a container of the **audit** stack (or changing a role setting of the audit database) and was always undone in a `finally`/`afterAll`, even when an assertion failed. Tests: `tests/remediation/91-reliability.test.ts` (9 tests) and `92-db-timeout.test.ts` (1 test), plus the cited integration tests.*

## 1. Results

| # | Simulation | What was done | Observed | Status |
|---|---|---|---|---|
| 1 | **Duplicate file name** | A requester uploads `photo.png` twice | Two attachment rows with two different storage keys; both files exist in storage and download byte-for-byte identical to the upload | **Verified** |
| 2 | **Interrupted upload** (record fails after the file is stored) | A temporary constraint makes the database reject the attachment row after the file was written | The action returns an error, **no row** and **no orphan file** remain (the stored object is removed again). A genuine mid-stream disconnect cannot be produced in this harness (the action receives the complete form), so this simulates the failure after storage | **Verified** (as simulated) |
| 3 | **Storage unavailable** | The storage container is stopped; a requester uploads | The upload fails with a clear error, **no database record**, no crash; after storage is started again the next upload works | **Verified** |
| 4 | **Unauthorized upload** | A requester of another team uploads to a ticket they are not on | Refused; no row and no stored file | **Verified** |
| 5 | **Unauthorized read/write at the storage layer** | An unrelated requester tries to upload to, list or download another request's folder directly | Refused (migration 157, D-004); the download route returns 404 for an unrelated user (`desk-storage-001`) | **Verified** |
| 6 | **Bad files** | A page of HTML renamed `.png`, an empty file, an SVG | All refused, nothing stored. (The 25 MB size limit is in the code but was **not** simulated: producing a 25 MB upload in this harness was not worth the time) | **Verified** (size limit not simulated) |
| 7 | **API layer down** | The REST container is stopped; an agent changes a status | The action never reports success: it either returns an error or throws into the application's error screen; the ticket is unchanged; after the container is started again the same action works | **Verified** — but see finding REL-1 |
| 8 | **Database statement timeout** | The signed-in role's limit is cut from 8 s to 1 ms | The API answers with a timeout error (code 57014), the action fails and changes nothing; the 8 s limit is restored and the same action then works | **Verified** |
| 9 | **Application restart** | The audit app is stopped and started twice while a requester is signed in | The session survives (it is a signed cookie checked against the authentication service, not memory in the app); `/api/health` reports `ok` after each start | **Verified** |
| 10 | **Concurrent updates** | Two technicians change the status of one ticket at the same instant; a technician and a manager assign one ticket at the same instant | One consistent result each time (legal status, timestamps matching the status, the ticket owned by one person), history records the changes | **Verified** (tests `90-uat-lifecycle`, `91-reliability`) |
| 11 | **Mail provider down** | The mail transport is made to fail on every send | The status change still succeeds and is saved | **Verified** |
| 12 | **WhatsApp provider down** | Outbound sends fail | Covered by `stage5-outbound-failure` (passes in the final run) | **Verified** (stubbed provider) |
| 13 | **Scheduled-job overlap** | Two runs of the business-rules job start at the same moment against five matching tickets | **Before the fix: the rule's action ran twice on each ticket. After: once** (and one fired-record each). Two runs both return 200 | **Verified** (before and after) |
| 14 | **Job retry** | An action that throws releases its claim so the next run tries again | Implemented for the business-rules job and the CSAT reminder (and the inbound-reply claim, unit-tested); the CSAT release-on-failure path itself was not exercised by a dedicated test | **Implemented** — release path for CSAT **not separately tested** |

## 2. Findings from these simulations

| ID | Finding | Severity | Status |
|---|---|---|---|
| **REL-1** | **With the API layer down, a screen hangs for about 165 seconds before the error screen appears.** The shared fetch wrapper aborts a call after 20 s and then **retries** reads (twice) — and loading one page makes several sequential calls. A user sees a spinner for minutes during an outage | Medium | **Open.** Recommendation: retry only fast connection failures (not timeouts), cap the total time per page, and show the error screen after ~20–30 s. Not changed because it alters how the application behaves under slow-but-working conditions, which is the owner's call |
| **D-069** | Ticket numbers repeated after 999,999 (found at 500,000-ticket scale) | Medium | **Fixed** (document 04) |
| **D-068** | Soft-deleting an attachment always failed | Medium | **Fixed** (document 03) |
| REL-3 | The "storage unavailable" test took about 23 s end to end, including the wait for the container to come back; the failing upload itself was not timed separately | Info | Recorded |

## 3. What was **not** simulated

A real network cut between the app and the database (the API-down and timeout cases stand in for it); disk full on the storage volume; the NAS (not part of the audit stack by design); a power loss during a database write; a 25 MB or 30 MB upload; multiple application instances (the in-process rate limiter is per instance).

## 4. How to repeat

All simulations are scripted and safe to re-run on the audit stack only:

```
powershell -NoProfile -ExecutionPolicy Bypass -File audit-2026-10\guard\run.ps1 npx vitest run --config vitest.remediation.config.ts tests/remediation/91-reliability.test.ts tests/remediation/92-db-timeout.test.ts
```

(The gate runs first and the tests refuse to run anywhere except the audit stack.) The API-outage test takes about three minutes because of the behaviour in REL-1.
