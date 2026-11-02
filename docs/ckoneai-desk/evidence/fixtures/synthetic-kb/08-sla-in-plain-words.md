---
id: SYN-08
title: Response time and resolution time (SLA)
type: policy
status: SYNTHETIC-NOT-APPROVED
label: "SYNTHETIC DEMONSTRATION ARTICLE - LOCAL TESTING ONLY - NOT APPROVED - NEVER PROMOTE TO PRODUCTION"
audience: technician
domain: sla
language: en
version: 0
owner: none (synthetic)
approved_by: none
approved_on: none
review_by: none
source: written for tests from docs/ckoneai-desk/evidence/inv-A and inv-C
---

> SYNTHETIC DEMONSTRATION ARTICLE. Not approved. Local testing only.

# Response time and resolution time (SLA)

Each ticket has two targets: a **response** target (first reply or start of work) and a **resolution** target. They depend on the priority and the service.

- The clock counts **business hours** and skips holidays, as set by the administrator.
- The clock is **paused** while the ticket is Waiting on User, Hold due to Purchase from HO or Pending Approval. When the pause ends the deadlines move later by the paused time.
- A ticket shows **At risk** when less than 4 hours remain and **Breached** when the time has passed.
- Reopening a resolved ticket resets the resolution time.
