# 05. Data contract and `gold_ckdesk` dataset proposal

Status: **PROVISIONAL / NOT CERTIFIED.** LOCAL. Nothing here changes the data API, the data platform or any Gold view. Everything marked "proposal" needs the owner's yes, and the DBA (01-DBA) must be told before the API changes.

## 1. The flow (unchanged)

CKDesk read-only data API (`/api/data/v1/meta | rows | ids`, bearer token, 17 entities) -> DBA data platform (`bronze` -> `silver` -> `gold_ckdesk`) -> CKOneAI read-only tools. CKOneAI never reads CKDesk's database. The first full load by the DBA already matched the API counts (2 Nov 2026).

## 2. What exists today (the contract as built)

17 entities: `requests`, `request_status_history`, `request_comments` (flags only), `services`, `service_categories`, `service_sub_categories`, `stores`, `sla_policies`, `csat_surveys`, `approvals`, `approval_decisions`, `teams`, `departments`, `locations`, `approval_workflows`, `programs`, `users` (id, display name, role, store, vendor flag; no e-mail, mobile, employee number). Full column sheet: `docs/CKDESK-DATA-API.md` section 7.

Load styles: **incremental** (`updated_at`), **append** (history, comments, decisions), **snapshot** (`csat_surveys`, read whole). Keyset paging with `next_after`; a short page is never the end; `ids` gives the delete check. Timestamps keep the database offset (`-08:00`/`-07:00` on live, `Z` when UTC): **do not change this without telling the platform**.

## 3. Local contract tests (what was checked, and the result)

Run on the isolated audit stack through the real handler: `tests/vapt/67-data-api.test.ts` (12 tests, earlier) and the new `tests/vapt/69-ckoneai-data-contract.test.ts` (12 tests). **All pass.**

| Brief item | Test | Result |
|---|---|---|
| Entity schemas | meta columns match the rows returned; `csat_surveys` has no comment column; privacy of every entity (67) | pass |
| Pagination | page sizes 1,000 / 1,700 / 5,000 over 3,274 tickets; no row skipped or repeated (67); no id twice in 5 entities at page size 700 (69) | pass |
| Incremental loads | `updated_since` in the future returns nothing; a changed ticket reappears; no duplicates | pass |
| Snapshot loads | `csat_surveys` is a snapshot | pass |
| Deleted-row reconciliation | `ids` drops a deleted ticket (67) | pass |
| Null handling | unassigned ticket has a real `null`; head-office requester has `store_code = null` | pass |
| Timestamp precision | every timestamp of every entity has `Z` or `+/-hh:mm` and parses as a moment | pass |
| Row counts / freshness | `meta.count` equals the rows delivered; `meta` newest change date equals the newest `updated_at` | pass |
| Duplicate prevention | see pagination | pass |
| Identifier consistency | every history, comment, survey and approval row points at an existing ticket; every ticket's requester exists in `users` | pass |
| Store mapping | the ticket's `store_code` is the requester's store; `stores.code` is unique (the platform's join key; all 231 matched `dim_site` on the first live load) | pass |
| Status consistency | every status is one of the 9 values of the application enum | pass |
| SLA calculations | `response_breached` / `resolution_breached`: true when late, false in time, **null** while unanswered / unresolved / no target | pass |
| CSAT metrics | a sent but unanswered survey has `rating = null`; ratings are 1 to 5; rated rows have `submitted_at` | pass |

Findings that matter for answers (not defects):

1. `resolution_breached` means **resolved late only**. It is silent for open tickets. A question "which tickets are late now" cannot be answered from the flags: compute from `resolution_due_at`, `status` (not resolved/closed/cancelled, **not paused**).
2. A ticket in `waiting_user`, `hold_purchase_ho` or `pending_approval` keeps its old `resolution_due_at` until the pause ends. `waiting_since` and `paused_ms_total` are exported so a tool can say "paused".
3. `request_status_history` omits the initial `open`, assign/unassign flips and rule-driven `from_status` (it is null for those): a "time in status" measure from it would be wrong.
4. CSAT: 1 rated of 277 surveys on live (2 Nov). Any average must show the denominator; CKOneAI already refuses an average below 30 ratings.
5. Business hours, holidays, SLA policy hours: not usable for recomputation in the platform (`sla_policies.config` is exported, business hours are not): tools must use the **stored** deadlines.

## 4. The `gold_ckdesk` datasets (as the DBA built them, per the CKOneAI session)

`gold_ckdesk.ticket`, `approval`, `approval_step` (decided steps only), `csat_survey`, `sla_store_day`, `store`; freshness through `meta.v_dataset_freshness`. Column names are the DBA's and live only in CKOneAI's spec file; this pack does not restate them. **Not re-verified here** (no access to the platform).

## 5. Proposed additions (each needs the owner's yes; tell 01-DBA first)

| # | Addition | Why | Privacy |
|---|---|---|---|
| P1 | New entity `approval_workflow_steps` (workflow_id, step_order, approver_type, approver_user_id) | Answers "approvals **waiting for me**" (today refused) and fixes the `approver` label (today "named on any step, ever") | ids only |
| P2 | New entity `team_members` (team_id, user_id, is_lead) | Technician sees their team's tickets as CKDesk does; "team workload"; team-scoped analytics | ids only |
| P3 | Column `manager_id` on `users` | Direct-report visibility (CKDesk gives a manager their reports' tickets) | id only |
| P4 | Columns `vendor_company_id`, `vendor_role` on `users`, and vendor request entities | Only if vendor tools are wanted; today vendor logins are refused | company id, role |
| P5 | New entity `kb_articles` (published, **approved** articles only; id, title, content, audience, version, approved_on, updated_at) plus the missing fields in CKDesk | Document answers with citations. This is the first time text leaves CKDesk: it is article text approved for the audience, not ticket text | none, if only approved articles |
| P6 | `request_collaborators` | Collaborator visibility | ids only |

**Update 2 Nov 2026: the owner said yes to P1, P2 and P3. They are BUILT LOCALLY (not released): entities approval_workflow_steps and team_members (synthetic text id team_id:user_id), column manager_id at the end of users; 9 tests in tests/vapt/70 pass; 01-DBA agreed names and one release for all three, and was told nothing goes live without the owner's separate go.**

P1 to P3 are the ones that make the user-scoped tools **exact** instead of "safe but narrower" (doc 07). Until then the tools stay on the person's own raised/assigned tickets.

## 6. Local fixture

The "disposable LOCAL PostgreSQL fixture" is the isolated audit stack (synthetic data, no production address, enforced by the isolation gate). A separate copy of the DBA's Silver/Gold layer was **not** built: the platform's views are CKOneAI's and the DBA's to define, and a second copy here would only restate their column list. The contract is tested at the API (the only thing CKDesk owns).
