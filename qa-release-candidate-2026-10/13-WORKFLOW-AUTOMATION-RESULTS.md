# 13 — Workflow and automation engine

Scope: Business Rules (assignment, set status/priority/team, notify), SLA clock (pause / resume), scheduled jobs (auto-close, reminders, PMS, sheet copy), idempotency, overlap, missed runs. Evidence: `qa-release-candidate-2026-10/tests/qa-jobs-automation.test.ts`, `qa-gap-coverage.test.ts`, `qa-vendor-concurrency.test.ts`, `tests/vapt/*`, `tests/integration/*`, browser journeys 1–5.

| Behaviour | How exercised | Result |
|---|---|---|
| Every job route needs the shared secret (`alerts`, `approvals/reminders`, `business-rules`, `csat`, `masters/sync`, `pms/daily`, …) | no secret → 401, wrong secret → 401, right secret → 200; also by curl on the QA app (401 without) | **PASS** |
| Auto-close after the reopen window | two overlapping runs close the ticket once and tell the requester once; a ticket still inside its window and a reopened one are left alone | **PASS** |
| Daily approval reminder | sent once per approver per day, even when called twice or at the same moment | **PASS** |
| Sheet copy runs overlapping | two copies at the same time never duplicate units, CVMs or PMS dates (found D001, fixed) | **PASS** after fix |
| AC PMS daily run | interrupted run finished by the next; one failing store neither loses nor doubles others; a second run the same day creates nothing; 60 stores in 2.5–3 s | **PASS** |
| Missed schedule | a PMS date missed yesterday is created on the next run (the sheet shows QSC 25 Oct created on 26 Oct); the sheet copy has 3 daily slots and "unchanged" runs are cheap (0.18 s for 3,000 rows) | **PASS** |
| Business Rule: direct assign | assignee set once; "Start working" re-running the same rule does not send a second "assigned" mail (regression test `assign-rule-and-status-email`) | **PASS** |
| Business Rule: round robin | 4 tickets → A, B, A, B | **PASS** |
| Business Rule: load balanced | goes to the technician with fewer *open* tickets; resolved/closed do not count | **PASS** |
| Business Rule: vendor-held ticket | never taken away by any rule (round robin included) | **PASS** |
| Business Rule: AC routing facts (`ac_amc_vendor`) | only from the saved AC snapshot; PMS ticket now routed to the Voltas technician (D004) | **PASS** after fix |
| Business Rule re-run racing itself | two overlapping runs of the scheduled rules job fire a rule once per ticket | **PASS** |
| SLA pause / resume on Waiting on User, Hold-Purchase-HO, pending approval | browser (J2) and tests; resume credits the paused time to the deadlines | **PASS** |
| Approval: decide the same approval twice at the same moment | status changes once; **two decision rows** stored | **FAIL / open (QA-D014)** |
| Round robin: eight tickets created at the very same moment | **FAILED first**: all 8 went to one technician (read-then-write of the "last used" position) — QA-D018. Fixed with a compare-and-set; now spread between the listed technicians | **FAIL → FIXED → PASS** |
| Scheduled Business Rules (SLA-% escalation, "unassigned for N minutes") | only the health envelope and the overlap guard are tested | **NOT TESTED** in depth |
| Alerts job (due-soon / overdue alerts, 08:00 digest) | secret check and overlap guard only | **NOT TESTED** in depth |
| Field-level SLA override really shortens a deadline | not tested | **NOT TESTED** |
| Browser push, per-user notification opt-out | not tested | **NOT TESTED** |

Verdict: the parts that change data (assignment, approvals, auto-close, PMS, sheet copy) are idempotent and safe under overlap, with one open wart (D014); the round-robin burst problem (D018) was found and fixed. Four automation behaviours were not exercised (listed in 18).
