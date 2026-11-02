# 07. Identity and authorization matrix

Status: LOCAL. Evidence: `evidence/inv-B-access-approvals-vendor.md` (the rules, with migration and line numbers), `evidence/authz-differential.json` (measured), `tests/vapt/68-ckoneai-authz-differential.test.ts` (5 tests, pass), `tests/unit/ckoneai-*.test.ts`.

## 1. Who the assistant believes you are

1. The browser talks only to CKDesk. CKDesk checks the login (session), the profile (exists, active, no password change pending), and that the person is not a vendor login and is on the pilot list.
2. CKDesk decides the **roles** on every call (never cached): `requester` (everybody), `technician` (agent, manager, admin, platform owner), `approver` (manager tier, or anyone named on any approval step). **Since 2 Nov 2026 (CKOneAI commit c62c664) two more signed roles are sent: `manager` (the role manager: limited to their own hierarchy) and `orgwide` (admin and platform owner now; COO, CEO and Director roles when they exist: the whole organisation).** The three company-wide summaries give numbers only to `orgwide`; a `manager` gets "the hierarchy view is not ready yet" until manager link, team membership and a team id on the ticket are published; everyone else gets "ask your manager". Signed spec v1 carries: person id, roles, scope `ckdesk`, time (60 s), one-time number, body hash. **No organisation field** (CKDesk has one organisation today; if a second ever exists the spec needs an org field: recorded as decision 11 in doc 14).
3. CKOneAI trusts only those signed headers; the person's id is a **bound parameter** from the verified headers, never from the body, URL or question; a refused or unverifiable header is 401 and never falls back to another login.
4. The chat text can never change the person, the role, the store or the scope: tested at CKDesk's side by forging `x-ckdesk-*` headers and an Authorization header in the browser request (ignored; the signed values win) and, at CKOneAI's side, by their prompt-injection tests (reported by their session, not re-run here).

## 2. What CKDesk itself lets each person read (the real rule) and what the tools show

Measured on the isolated stack with each person's own login (7 people, 6 tickets, 1 approval, 2 surveys). **No leak: every ticket a tool returns is also visible to that person in CKDesk.**

| Person | CKDesk shows (real row security) | Tools show (`requester_id` / `assigned_to_id`) | Gap |
|---|---|---|---|
| Requester | tickets they raised (and direct reports', collaborations, named-approver tickets) | tickets they raised | none in the test |
| Technician (agent) | every ticket of **their team(s)**, assigned or not; plus raised, collaborating, approving, reports' | raised by them, or assigned to them | **narrower**: 5 visible in CKDesk vs 3 in the tool (two unassigned tickets of their own team are missed) |
| Named approver (any role) | the ticket and the approval, even in another team | only what they raised/assigned/decided | narrower |
| Manager, admin, platform owner | **every ticket of the organisation** (3,273 of 3,273) | only raised/assigned to them | narrower (CKDesk's report screens narrow a manager to their teams in the app layer, the database does not) |
| Person with direct reports | also their reports' tickets (requester or assignee), one level | not shown | narrower |
| Vendor technician / manager | assigned tickets / their company's technicians' tickets | **not served at all** (vendor logins refused) | by design |
| Other organisation | nothing (`org_id` in front of every branch) | one organisation in the platform | n/a |

Approvals: visible to the ticket's requester, the team, a named approver and manager+; **decisions** (`approval_decisions`) have no approver branch.
Surveys (CSAT): requester sees their own; **manager and above see all; an agent sees none** (measured: agent 0 of 8).

## 3. The three differences the owner must decide (also doc 14)

- **W1: counts wider than CKDesk for an agent.** `tickets_by_category_status` and `sla_by_store` are open to the technician role organisation-wide; an agent in CKDesk sees only their teams' tickets (5 of 3,273 in the test). Counts only, no names.
- **W2: CSAT wider than CKDesk for an agent.** `csat_summary` is open to the technician role; CKDesk lets an agent see no surveys.
- **N1: narrower for technicians, managers, report holders.** Safe, but users will see less than in CKDesk until team membership and manager id reach the platform (proposals P2, P3 in doc 05).

Recommended by CKOneAI and by this side: restrict the three aggregate tools to **manager and above** (a new signed role `manager`, computed by CKDesk from manager/admin/platform_owner; CKDesk has the rule ready and does **not** send it until the owner decides). Alternative: accept organisation-wide counts for technicians.

## 4. Required tests (the brief's list) and where each is covered

| Case | Covered by | Result |
|---|---|---|
| Requester views another requester's ticket | measured rule (requester B sees none of requester A's tickets); the tool's per-person filter; question bank `refuse_other_person` | rule measured, tool refusal to be run by CKOneAI |
| Technician accesses an unauthorised queue | measured (agent A cannot see team B tickets); question bank `refuse_team_scope` | rule measured |
| Manager requests outside-scope data | CKDesk's manager has **no** outside scope in the database (org-wide); the tools show less | documented (W/N above) |
| Vendor accessing another vendor's tickets | vendor logins are refused by the bridge gate (unit test); RLS rule documented (inv-B 2.3) | pass (refused) |
| User requests another user's approvals | measured: a stranger sees no approval (`approval_of_A2_visible_to.requesterB = false`); `my_approval_requests` filters on the person | rule measured |
| Cross-organisation access | isolation is `org_id` in every RLS branch (existing test 29); single organisation in the platform | existing tests; no org field in the signed spec |
| Prompt injection | question bank `prompt_injection` (12 items); CKDesk side proves forged headers are ignored | CKOneAI runs the bank |
| Expired / replayed / invalid / mismatched signed request | CKDesk signs a new time and one-time number every call (tested); verification is CKOneAI's (their tests: signatures, tampering, replay, window) | reported by CKOneAI |

## 5. Rules for adding any new tool

A user-scoped tool is allowed only if the dataset can enforce the **same** visibility CKDesk gives that role, or a strict subset of it, and a test proves "tool result is a subset of what that person sees in CKDesk" (the pattern of test 68). If the dataset cannot carry the rule (team membership, approver step, vendor company, collaborators), the tool is **withheld** and refuses in words.
