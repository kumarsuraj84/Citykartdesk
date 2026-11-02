---
id: KB-08
title: Response time and resolution time (SLA)
type: policy
status: APPROVED
label: "Approved by Ankur (owner) in chat on 2 Nov 2026. Review again by the review_by date or when CKDesk changes."
audience: all
domain: sla
language: en
version: 1
owner: Ankur
approved_by: Ankur
approved_on: 2026-11-02
review_by: 2027-02-02
source: drafted from the code inventory of 2 Nov 2026 (docs/ckoneai-desk/evidence/inv-A, inv-C); facts to be checked by the owner
---

> Approved article, version 1.

# Response time and resolution time (SLA)

Each ticket has two targets: a **response** target (first reply or start of work) and a **resolution** target. They depend on the priority and the service.

- The clock counts **business hours** and skips holidays, as set by the administrator.
- The clock is **paused** while the ticket is Waiting on User, Hold due to Purchase from HO or Pending Approval. When the pause ends the deadlines move later by the paused time.
- A ticket shows **At risk** when less than 4 hours remain and **Breached** when the time has passed.
- Reopening a resolved ticket resets the resolution time.
