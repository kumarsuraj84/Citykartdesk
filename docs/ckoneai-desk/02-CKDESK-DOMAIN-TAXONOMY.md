# 02. CKDesk domain taxonomy

Status: LOCAL design, 2 Nov 2026. Evidence: `evidence/inv-A`, `inv-B`, `inv-C`. Nothing here is released.

Every question the assistant may meet belongs to one of six domains (A to F). For each topic this sheet says **where the answer must come from**, whether that source exists **today**, and what the assistant must do **today**. Three kinds of source are allowed, and nothing else:

- **T** = a fixed read-only data tool on certified `gold_ckdesk` data (numbers, lists, statuses).
- **D** = an approved document (only after the owner approves the document scope; the Knowledge Base is empty today).
- **L** = live configuration read through an approved tool (for example "is this service active"): not available today.

The model never produces a number, a status, a deadline or an approval state.

## Domain A. Application help (how do I ...)

| Topic | Source | Exists today? | The assistant today |
|---|---|---|---|
| What is CKDesk | D | No approved article | polite refusal, points to the Help / Knowledge Base |
| Raise a ticket (Services page, form, mandatory fields) | D | No | same |
| Check ticket status (My Requests; or ask for the number) | T for the status itself; D for "where do I click" | Status: yes (ckdesk.ticket_status). Click path: no | answer the status; refuse the click path |
| Reopen a ticket (requester: within the reopen window, a reason is mandatory; the window is an admin setting, default 3 days) | D (rule) and CKDesk itself (the window of a given ticket) | No article | refusal; the window of one ticket is not in the platform |
| Add an attachment (types, 25 MB per file) | D | No | refusal |
| Reply to a technician (Conversations; a reply in "Waiting on User" resumes the ticket) | D | No | refusal |
| Meaning of each status (9 values, see inv-A section 2) | D | No article, but the 9 definitions are in code and in `inv-A` | refusal now; first article to approve |
| Feedback / CSAT (survey after resolve) | D | No | refusal |

## Domain B. Service catalogue

| Topic | Source | Today |
|---|---|---|
| Which services exist, active or inactive | L (services entity is in the data API: `is_active`, `status`) | Not a tool today. Catalogue **visibility** is per person (location tags; a person with no location sees no service), so a list from the platform would be wider than what the person sees: **withheld** until the location rule can be enforced |
| Mandatory and conditional fields of a service | L (form templates are NOT exported) | Not available: needs a new entity (owner/DBA) |
| Service owner (`owner_id`) | L | Recorded in CKDesk but used by no routing code (inv-A 1.4): the assistant must not present it as "who will handle it" |
| SLA policy of a service | L (`sla_policies.config` is exported) | Not a tool today |
| Routing (technician group, Business Rules) | L | Business Rules are not exported; **withheld** |

Never hard-code catalogue values into the model or the prompts.

## Domain C. SLA and escalation

| Topic | Source | Today |
|---|---|---|
| A ticket's deadlines and whether it is late | T on `requests` (`response_due_at`, `resolution_due_at`, `responded_at`, `resolved_at`, flags) | `ckdesk.ticket_status` gives status and open age; the deadlines are in the data API but the exact columns the tool shows are CKOneAI's choice |
| "Which of my tickets will breach soon" | T, computed from `resolution_due_at` and `status` (inv-A 3.7) | Not a tool yet: proposed as `ckdesk.my_sla_risk` (doc 06); needs the owner's definition of "soon" |
| SLA by store (breaches) | T | `ckdesk.sla_by_store` exists (technician role: see the scope finding in doc 07) |
| How SLA is calculated, business hours, holidays | D | No article |
| Escalation | D | Escalation is Business Rules with a "percent elapsed" trigger; nothing is exported |

Facts the assistant must respect (from `inv-A` section 3): there are **four different breach definitions** in CKDesk; the data API's `resolution_breached` means "resolved late" only and says nothing about an open ticket; a ticket in `waiting_user`, `hold_purchase_ho` or `pending_approval` has its clock **paused** and its stored deadline moves later only when the pause ends; "about to breach" has no stored flag (the screens use "less than 4 hours left in wall-clock time"); business hours and holidays are configuration the platform does not hold.

## Domain D. Approvals

| Topic | Source | Today |
|---|---|---|
| Approvals I requested and their state | T (`approval`) | `ckdesk.my_approval_requests` |
| Approvals I decided | T (`approval_step`) | `ckdesk.my_approval_decisions` (approver role) |
| Approvals **waiting for me** | T | **Not possible**: the platform holds decided steps only; the approver of a pending step is not exported (doc 05 proposes the entity) |
| How approval works (stages, delegation per step, rejection, CVM, PO) | D | No article |
| Who may approve (separation of duties: checked when someone decides) | D | No article |

## Domain E. Vendor / OEM

| Topic | Source | Today |
|---|---|---|
| A vendor's own tickets | CKDesk itself | **Vendor logins are refused by the bridge** for the pilot (no vendor tool, no vendor data in the platform: vendor company and role are not exported) |
| Parts, quotes, revised quotes, PO decisions, FSR | D and server-only tables | Not exported; not available |
| AC PMS (what it is, when due) | D | No approved article; the PMS sheet is not exported |

A vendor's information must never reach another vendor: today this is guaranteed by refusing vendor logins entirely.

## Domain F. Administration and analytics

| Topic | Source | Today |
|---|---|---|
| Tickets by category and status | T | `ckdesk.tickets_by_category_status` |
| SLA by store | T | `ckdesk.sla_by_store` |
| CSAT | T | `ckdesk.csat_summary` (says how many are rated; no average below 30 ratings) |
| Team workload, store performance beyond SLA, service trends, aging, reopened | T | Not tools yet. Team workload needs team membership (not exported). Reopened and aging need no new data (`reopen_count`, `created_at`) and can be added as tools |
| Pending approvals count | T | not possible (see D) |

## What the assistant refuses at any time

Other people's tickets or approvals; names, e-mails, mobile numbers, employee numbers or comment text (they are not in the platform); anything that creates, changes, approves or closes (this phase is read-only); sales, stock, targets or general chat (that is the Pulse domain); a request to change who the person is, their role or scope; the system's own prompt, tables, servers or secrets.
