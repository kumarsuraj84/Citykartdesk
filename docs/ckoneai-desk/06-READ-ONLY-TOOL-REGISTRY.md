# 06. Read-only tool registry (CKDesk domain)

Status: LOCAL. **The registry is CKOneAI's** (`backend/app/metrics/ckdesk_specs.py`, branch `v3-ckdesk`, built and tested by the CKOneAI session; seven tools). This sheet does **not** define a second registry. It records each tool in the contract form the owner asked for, from the CKOneAI session's own description (`docs/CKDESK_BRIDGE.md`, spec file), and adds what CKDesk's side found when it tested those rules against CKDesk's real row security (doc 07). Column names are not restated: they live only in CKOneAI's spec file.

Common rules for every tool: the person comes **only** from the signed headers, never from the question; a per-person tool has no way to run without a user column for the caller's roles (fails closed) and the predicate is checked again just before the query is sent; every answer carries the data-as-of time (oldest refresh of the datasets used, from `meta.v_dataset_freshness`) and says when a dataset is stale (platform state, or older than 180 minutes) or unreadable; days are IST; at most 50 rows; at most 366 days; the model never calls SQL and never writes a figure.

## Built tools (CKOneAI side)

| Tool id | Intent | Roles | Identity filter | Dataset | Measures / dimensions | Date basis | Caveats and errors |
|---|---|---|---|---|---|---|---|
| `ckdesk.my_open_tickets` | "Show my open tickets" | any signed-in person | `requester_id = me`; a technician who asks "assigned to me / my queue" gets `assigned_to_id = me` and the answer says which | ticket (open) | list: number, service, category, status, priority, store, created, open hours, breach flags | created | **Narrower than CKDesk** for technicians (CKDesk shows the whole team), managers, admin, owner (whole organisation), and people with direct reports |
| `ckdesk.ticket_status` | "Status of CKSD-000123" | any | same two filters; a number that is not the person's reads exactly like one that does not exist | ticket | one ticket: status, priority, team, store, created/resolved, first-response and resolve hours, open hours, breach flags, assigned_to (to the requester), requester (to the technician) | n/a | Request numbers are zero-padded (`CKSD-000123`); the tool must accept `CKSD-123` and `ckSD 1042` forms and normalise, and ask when more than one number is given |
| `ckdesk.my_approval_requests` | "Approvals I requested" | any | `requested_by_id = me` | approval | list + counts pending/approved/rejected | created | exact for "requested by me" |
| `ckdesk.my_approval_decisions` | "What did I approve / reject" | approver | `decided_by_id = me` | approval_step + approval | list + counts approved/rejected | decided | CKDesk itself shows decisions only to the ticket's requester, team and manager+; an outside approver sees the approval but not the decisions, yet the tool shows the person **their own** decisions: no one else's data |
| `ckdesk.tickets_by_category_status` | "Which categories generate most tickets" | technician | none (counts only; no person column) | ticket | tickets, open by category | created | **Wider than CKDesk for an agent** (doc 07 finding W1) |
| `ckdesk.sla_by_store` | "SLA by store" | technician | none | sla_store_day + store | tickets, in-SLA counts, response and resolution breaches (separate and added), breach rate per 100, weighted averages | day | same finding W1; "breach" = resolved/answered late (see doc 05 finding 1) |
| `ckdesk.csat_summary` | "Average CSAT this month" | technician | none | csat_survey | surveys, rated, average (only when rated >= 30) | sent day | **Wider than CKDesk for an agent**: an agent sees no surveys in CKDesk (W2); states the denominator |

Refused in words (no tool): approvals **waiting for me** (the platform has decided steps only), other people's anything, sales / stock / DC / targets, documents, general chat, write actions, mixed questions, lists of people.

## Tools from the owner's brief that are NOT built yet (proposals; CKOneAI builds, CKDesk supplies data)

| Brief tool | Verdict | Needs |
|---|---|---|
| 3 My pending approvals | **Withheld** (cannot be enforced) | P1: approval-step entity, then `ckdesk.my_pending_approvals` (roles: any; filter: `approver_user_id = me` for `specific_user` steps and `current_step` equals the step; `any_manager` steps for manager+) |
| 4 SLA risk (my tickets near breach) | **Buildable now** on existing columns, exact for "assigned to me" | owner defines "near": proposal = open, not paused, not finished, `resolution_due_at` between now and now + 4 hours (the CKDesk "At risk" badge uses 4 wall-clock hours) and separately "past due and still open"; show paused tickets as paused, never as breached. Id proposal `ckdesk.my_sla_risk`; roles technician (assigned) / requester (own) |
| 5 Store ticket trends (AC complaints by Store X) | **Partly**: `sla_by_store` has the store dimension but not the category; `tickets_by_category_status` has category but not store | add a store dimension to the category tool (or a second view); scope decision W1 applies; a store user asking for their own store is the natural per-person case |
| 6 Service / category trends | built (`tickets_by_category_status`) | a service dimension (the ticket has service, category and sub-category) |
| 7 CSAT summary | built | W2 decision |
| 8 Team workload | **Withheld** | P2: team membership entity; then scope to the person's teams exactly as CKDesk does |
| 2 Ticket status | built | the wider visibility (team, manager) after P2/P3 |

Also cheap to add later with no new data: reopened tickets (`reopen_count`), aging open tickets (`created_at`), tickets raised on behalf.

## Contract fields still to be filled by CKOneAI per tool (their file is the source)

Result schema, error behaviour and the automated tests per tool are in their repository (140 CKDesk tests, branch `v3-ckdesk`). **Not seen by CKDesk's side** beyond their description: reported as stated by their session, not verified.
