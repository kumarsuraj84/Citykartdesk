# 12 — Failure Recovery and Queue Resilience Report

## Plain summary
Each helper service was switched off on purpose (production-mode app, audit stack). **In every case the app stayed up, showed plain messages without technical text, and came back on its own, with no restart of the app.** The slow parts are the waits: when a service stops answering, a page can wait about 20 seconds before it gives up.

## Controlled failures (`recovery/fr.mjs`, 7/7 not failing; 1 NOTE)
| ID | Failure | What people saw | Recovery | Result |
|---|---|---|---|---|
| FR01 | Database stopped ~10 s | signed-in pages: HTTP 500 plain error page in 2.5 s, sign-in page still opens, health says 503; no technical text | back to normal 5–23 s after restart, same app process | **PASS** |
| FR02 | Data gateway (PostgREST) stopped | first signed-in page took **22.6 s** then a plain error; next pages 2.5 s; health 503 | normal 5–40 s after restart, same process | **PASS** (slow wait noted, REL-002) |
| FR03 | Sign-in service (GoTrue) stopped | people already signed in keep working (pages 200 in ~60 ms); health 200; new sign-ins cannot happen | immediate | **PASS** |
| FR04 | File storage stopped | opening an attachment answered a clear **503 "temporarily unavailable"** (not a wrong "not found") after the designed 20 s wait | file readable again within 2 s | **PASS** |
| FR05 | Simulated crash between a rule's claim and its action | the ticket is not retried and nothing reports it | — | **NOTE** at-most-once (REL-001, see 11) |
| FR06 | Scheduler run repeated right after an interruption | nothing done twice (2 events stay 2, fired 0/0) | — | **PASS** |
| FR07 | Scheduler without secret; 6 scheduler calls abandoned by the client after 50 ms | 401 without secret; app healthy, same process | — | **PASS** |
Evidence: `evidence/recovery/fr-run-4.log` (final), earlier runs `fr-run-1..3.log`. The first runs exposed harness mistakes (a failed check did not wait for recovery; a wrong column; the same test hitting the designed 20 s timeout) which were corrected; the app results were consistent in every run.

## Other resilience facts
- Zoho database down: clear "not connected" message and automatic recovery (UAT E09). CKOneAI down: plain message and recovery (UAT F). Meta/Graph unreachable: webhook still answers 200 and creates nothing wrong (UAT G07).
- Outbound mail failure: with no mail server configured, mail is a logged no-op; a deliberately **unreachable SMTP server** was **NOT RUN** (the audit environment keeps all mail settings blank by design). Existing unit test `business-rules-notify-failures` covers that a failed notification does not stop a rule.
- Queues: the app has no separate message queue. Background work is the scheduler endpoints (rules, alerts, reports, PMS, CSAT, retries `/api/automation/retry`) called by scheduled tasks on the server. Their behaviour under repeat, overlap and abandon is covered by W01–W05 and FR05–FR07.
- Not tested (needs the real server): Windows service restarts (NSSM), reboot behaviour, scheduled-task failure alerts, disk-full, NAS unavailable, backup/restore drills (documented in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`, not executed here), node process crash recovery (no supervisor in the audit setup).

## Findings
| ID | Sev | Finding | Status |
|---|---|---|---|
| REL-001 | P3 | At-most-once rule claims: a crash between claim and action loses that action silently | OPEN — owner decision (11) |
| REL-002 | P3 | When a service stops answering (not refusing), a page waits ~20–22 s (designed time-outs of 20 s) before showing the plain error | OPEN — observation: consider 5–8 s limits for page data and a friendly "service busy" page |
| REL-003 | P4 | While the database is down signed-in pages return HTTP 500 (plain page); a 503 with Retry-After would be more accurate for monitors | OPEN — observation |
