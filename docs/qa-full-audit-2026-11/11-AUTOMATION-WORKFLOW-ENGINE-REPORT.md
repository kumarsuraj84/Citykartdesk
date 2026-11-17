# 11 — Automation and Workflow Engine Report

## Plain summary
The rule engine behaves correctly when many things happen at the same moment: nothing is done twice, the later rule wins in a conflict, two technicians cannot both take the same ticket, and ticket numbers never repeat. **One scale limit was found:** the scheduler takes about 12.5 milliseconds per overdue open ticket per rule, so a big backlog makes it slow (20,000 overdue tickets = 4 minutes for one rule). **One design trade-off** (at-most-once) can silently lose an action if the server dies at the wrong instant.

## What was tested (`wf/wf-concurrency.mjs`, 5/5 PASS; plus UAT C and existing suites)
| ID | Test | Result |
|---|---|---|
| W01 | Two conflicting scheduled rules (order 0: priority High; order 1: priority Urgent) on 6 overdue tickets; **8 scheduler calls fired at the same time** | **PASS** 12 events (one per rule per ticket), none duplicated, all 6 tickets end Urgent (later rule wins), at most 2 priority entries per ticket in the history, total "fired" over 8 simultaneous calls = 12 |
| W02 | A second wave of 4 simultaneous calls | **PASS** nothing changes, fired 0 |
| W03 | Two technicians click "Pick up" on the same unassigned ticket at the same instant (two real browsers) | **PASS** exactly one owner, status Assigned, one assignment entry in the history; the other person is told "someone else" has it |
| W04 | 60 tickets created in parallel | **PASS** 60 distinct, gap-free numbers |
| W05 | Scheduler run with the full ticket table present (3.3k tickets) | **PASS** 1.4 s |
Evidence: `evidence/wf/wf-run-3k.log`, `wf-concurrency-results.json`. A first run at 500,000 tickets could not validate W01 because one scheduler call took over 5 minutes (see scale below) and the test client gave up; the correctness checks were therefore run at normal volume and the scale limit measured separately.

## Rule engine facts verified from code and UAT
- Scheduled rules (`sla_pct_elapsed`, `unassigned_minutes`) claim a ticket first by inserting a unique `(rule, ticket)` row, then act (assign, priority, status, team, notify). The unique claim is what makes parallel calls safe (W01/W02). If **nothing** worked, the claim is released so the next run retries; if **something** worked it is kept (no second assignment or second e-mail).
- UAT C (report 08): 80 % warns managers, 100 % sets Urgent and notifies admin; resolved and SLA-paused tickets are skipped; wrong/missing secret = 401.
- Existing automated tests cover concurrency and idempotency (`stage4-concurrency`, `stage4-idempotency`, `stage5-idempotency`, `stage7b-duplicates-concurrency`, `stage5-tenant-isolation`, `118-status-transitions-db`) and passed in the baseline.

## Scale (PERF-004, P2)
One scheduler run with **one** active scheduled rule, as the number of overdue open tickets grows (synthetic data, this fast PC):
| Overdue open tickets | One run |
|---|---|
| 8 | 0.2 s |
| 2,088 | 27 s |
| 5,002 | 62 s |
| 9,994 | 126 s |
| 19,977 | 249 s (4.1 min) |
Cost is linear (~12.5 ms per overdue open ticket **per rule**): each such ticket is checked one by one with its own database lookups, and the tickets that do not match are checked again on every run. Eight overlapping calls at 208,000 overdue tickets took 5.1 minutes each. Evidence: `evidence/perf/scheduler-rule-scale.json`, `scheduler-scale.json`.
Risk for Citykart: normal day-to-day overdue volume is small, so runs are seconds. **A big backlog of overdue open tickets (for example a bulk import of old open tickets, such as the ManageEngine migration that is on hold) would make every scheduled run slow, and overlapping runs would pile up.** Owner action before any bulk import: decide the import's status/due-date handling or ask for the engine to filter in the database first.

## At-most-once design (REL-001, P3)
FR05 simulated a crash after the claim was written but before the action ran: the ticket is **not** retried and nothing reports it (the claim exists, so every later run skips it). This is the deliberate "never act twice" trade-off; the exposure is one lost escalation per crash. Suggested mitigation: a daily check for claims with no matching action/history entry. Owner decision.

## Other limits and observations
- "Notify managers" actions reach **all** managers of the organisation (not only the group's manager): confirm intent.
- Rule ordering is by `execution_order` (W01 proves later wins); two rules that set the same field silently override each other: consider showing a warning in the rule editor.
- Not tested: approval workflows with parallel approvers under simultaneous decisions (unit-tested in `approval-decision.test.ts`), DeskTime/Sheet sync overlap, e-mail inbound claim races (existing tests), real clock/holiday calendars.
