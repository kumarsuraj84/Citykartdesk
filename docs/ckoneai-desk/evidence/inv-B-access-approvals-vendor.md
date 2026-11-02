# Inventory B: access control, approvals, vendor/OEM, masters (read-only evidence)

Repo: `D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate`. Written 2026-11-02 from local source only (no database, no network, no git changes).
Evidence format: `path:line` or `migration NNN:line` (`supabase/migrations/20240101000NNN_*.sql`; written as "mig NNN").
"Latest definition wins" was checked by grepping every `CREATE POLICY` / `CREATE OR REPLACE FUNCTION` across all 195 migrations (0 to 195).
Anything I could not confirm from files is marked **UNVERIFIED**. The live database was NOT queried, so "what is in the migration files" is certain, "what is applied on production" is not (see section 8).

---

## 0. The ten facts the design team must not miss

1. A ticket (`requests`) is readable through ONE policy, `requests_select` (latest: mig 177:94-107). It is an OR of 8 branches, not a simple "mine / my team" filter.
2. `manager`, `admin`, `platform_owner` read EVERY ticket of their organisation (mig 177:100). Nothing narrows a manager to a team in the database. Only some screens/reports narrow them (section 2.5).
3. Cross-organisation isolation is `org_id = current_org_id()` in front of every branch (mig 177:96). A person who must still change their password, or is inactive, has `current_org_id()` = NULL and sees nothing (mig 168:8-22).
4. A "direct report" branch exists for ANY role: `requester_id` or `assigned_to` in `profiles.manager_id = me` (mig 115:13-22, mig 177:103-104).
5. A named approver (`specific_user` step) can read the ticket, its approval row and its public comments, even if not on the team (mig 158:22-31, mig 113). An `any_manager` step gives no extra ticket access (managers already see all).
6. A vendor is NOT a role. It is `profiles.role = 'user'` plus `vendor_company_id` + `vendor_role` (`technician`|`manager`) (mig 177:28-37). Technician reads only tickets `assigned_to = me`; vendor manager reads tickets assigned to technicians of the same company (mig 177:70-81).
7. Writes by signed-in users are almost all removed (mig 165:47): every ticket/approval/vendor write is done by the server with the service key after code checks. So the RULES THAT MATTER FOR WRITES live in TypeScript, not in RLS.
8. Separation of duties on approvals is enforced at DECISION time for every approval type (`lib/approvals/decision.ts:91`) and at approver-CHOICE time for ad-hoc, delegation, auto-CVM (`lib/approvals/separation.ts`), but NOT when an admin builds a workflow, and NOT in the vendor PO decision (`lib/actions/vendor-po.ts:29-49`, no requester check).
9. The read-only Data API (`lib/data-api`) reads with the service key for the whole organisation. It carries no per-person visibility and does not export team membership, manager links, collaborators, approver steps, vendor company, vendor requests/POs (section 7).
10. Three different "who may see what" rules exist side by side: database RLS (section 2), screen/report scopes (section 2.5), and CKOneAI role labels (`lib/ckoneai/roles.ts`). They do not agree (section 2.6).

---

## 1. Identity primitives

### 1.1 Roles and profile columns

| Item | Value | Evidence |
|---|---|---|
| `user_role` enum | `user, manager, admin` created; `agent, platform_owner` added later. Order used in code: user < agent < manager < admin < platform_owner | mig 000:14; mig 035:7-8; `lib/permissions/matrix.ts:17-20` |
| Requester | `role = 'user'`. Stores raise tickets from a store login (profile with `store_id`) | mig 177:156 comment ("the store's login that raised it"); `lib/data-api/entities.ts:207` users col `store_code`. Whether every store has exactly ONE shared login: **UNVERIFIED** |
| Agent / technician | `role = 'agent'` plus rows in `team_members(team_id,user_id,is_lead,org_id)`. "Technician group" = `teams` | mig 000:140-146; mig 036:9-30 (org_id on team_members) |
| Manager | `role = 'manager'`; org-chart link is `profiles.manager_id` (separate from teams) | mig 115:1-12 |
| Admin / platform_owner | org-wide too; `platform_owner` is NOT cross-organisation for tickets (all policies use `current_org_id()`) | mig 067 (patched policies to add it); mig 177:96-100 |
| Vendor | `role='user'` AND `vendor_company_id` AND `vendor_role in ('technician','manager')`; DB constraint ties them together | mig 177:28-37 |
| Who may change role / org / manager / vendor fields | only service key; a trigger refuses it for `authenticated`/`anon` | mig 177:41-67 |

### 1.2 Helper functions (latest definitions)

| Function | Returns | Rule | Evidence |
|---|---|---|---|
| `current_org_id()` | uuid | `profiles.org_id` where `id = auth.uid()` AND `is_active` AND NOT `must_reset_password` | mig 168:8-14 (supersedes mig 157:88-95, mig 033:9) |
| `current_user_role()` | `user_role` | same conditions, returns `role` | mig 168:17-23 |
| `current_user_team_ids()` | `uuid[]` | teams of `team_members.user_id = me` whose `teams.org_id = current_org_id()`; NULL (not empty) when none | mig 045:26-34 |
| `current_user_subordinate_ids()` | `uuid[]` | `profiles.id` where `manager_id = me` AND same org. **Direct reports only, one level** | mig 115:13-22 |
| `current_user_collab_request_ids()` | `uuid[]` | `request_collaborators.request_id` where `user_id = me` | mig 158:15-20 |
| `current_user_approver_request_ids()` | `uuid[]` | `approvals.request_id` joined to `approval_workflow_steps` where `approver_type='specific_user'` AND `approver_user_id = me` AND same org. Includes decided/old approvals, any status | mig 158:22-31 |
| `current_user_vendor_assignees()` | `uuid[]` | vendor technician: `[me]`; vendor manager: ids of active-or-not technicians of the same company+org; anyone else `{}` | mig 177:70-81 |
| `is_vendor_user()` | bool | `vendor_company_id IS NOT NULL` | mig 177:86-89 |
| `is_request_approver(req)` | bool | same as approver ids, one ticket | mig 123:8-24 (supersedes mig 113:26) |
| `is_request_collaborator(req)` | bool | row in `request_collaborators` (not org-checked) | mig 087:37-42 |
| `is_agent()` | bool | user has any `team_members` row in own org | mig 123:26-34 |
| `is_team_member(team)` | bool | member of that team in own org | mig 087:25-31 |
| `can_manage_collaborators(req)` | bool | ticket in own org AND (manager+ OR team member) | mig 050:22-38, patched mig 100:11 |
| `current_user_visible_people()` | `uuid[]` | names a requester-role person may see (self, manager, reports, people on own/collab/approver/vendor-assignee tickets, public commenters, approvers, deciders, notification actors) | mig 177:157-179 (supersedes mig 170:106-125) |
| `request_status_transition_allowed(from,to)` | bool | status graph for client writes | mig 163:14-27, extended mig 179:19-29 (`hold_purchase_ho -> cancelled`) |

Notes:
- `current_user_team_ids()` can return NULL; policies cast `ANY((SELECT ...)::uuid[])`, so NULL means "no team branch" (mig 177:99).
- "Direct reports" is one level. A manager of managers does not see grand-reports via `subordinate_ids`; they see everything anyway as manager.

---

## 2. Who can read which row (RLS, latest definitions)

### 2.1 Policy table (SELECT policies only; latest definition)

| Table | Policy | Defined in | Condition (summary) |
|---|---|---|---|
| `requests` | `requests_select` | mig 177:94-107 | `org_id = my org` AND ( `requester_id = me` OR `team_id` in my teams OR role in (manager,admin,platform_owner) OR `id` in my collaborations OR `id` in my named-approver tickets OR `requester_id` in my direct reports OR `assigned_to` in my direct reports OR `assigned_to` in my vendor assignees ) |
| `request_comments` | `comments_select` | mig 177:110-133 | (parent ticket in my org AND (requester=me OR team OR manager+ OR requester in reports OR assignee in reports OR assignee in vendor assignees)) OR `is_request_approver()`; AND (public OR manager+ OR ticket's team is mine OR (collaborator AND is_agent())) |
| `request_attachments` | `request_attachments_select` | mig 177:136-154 | `deleted_at IS NULL` AND parent in my org AND (requester=me OR team OR manager+ OR assignee in vendor assignees); AND (not internal OR ticket team is mine OR manager+) |
| `request_activity` | `request_activity_select` | mig 169:8-21 | role is NOT `user` AND parent in my org AND (requester=me OR team OR manager+). No collaborator, approver, report or vendor branch |
| `approvals` | `approvals_select` | mig 113:63-76 (supersedes mig 080:96-107) | (parent in my org AND (requester=me OR team OR manager+)) OR `is_request_approver(request_id)` |
| `approval_decisions` | `approval_decisions_select` | mig 080:110-121 (never replaced) | `approval -> request` in my org AND (requester=me OR team OR manager+). **No approver branch** |
| `approval_workflows` | `workflows_select` | mig 166:12-20 | `org_id = my org` AND (role <> 'user' OR a visible `approvals` row uses it) |
| `approval_workflow_steps` | `approval_workflow_steps_select` | mig 166:22-24 | the workflow is visible to me (see above) |
| `request_time_entries` | `time_entries_select` | mig 080:310-322 | `user_id = me` OR (parent in my org AND (requester=me OR team OR manager+)) |
| `request_collaborators` | `collab_select` | mig 050:50-58 | `user_id = me` OR `added_by = me` OR `can_manage_collaborators()` |
| `team_members` | `team_members_select` | mig 167:159-161 | my org AND (`user_id = me` OR role <> 'user') |
| `teams` | `teams_select` | mig 080:49-51 | my org |
| `profiles` | `profiles_select` | mig 170:130-133 | `id = me` OR (my org AND (role <> 'user' OR id in `current_user_visible_people()`)) |
| `vendor_companies`, `vendor_requests`, `vendor_request_items`, `master_*`, `program_*`, `request_master_snapshots`, `request_program_snapshots`, `request_automation_state`, `pms_ticket_log` | none | mig 177:23-25; mig 178:38-43; mig 175:142-144; mig 186:97 | RLS on, all rights revoked from `authenticated`/`anon`: **server key only** |

### 2.2 Writes (so you know where the rules live)

| Fact | Evidence |
|---|---|
| Signed-in users have no INSERT/UPDATE/DELETE right on `requests` | mig 165:47 |
| Ticket creation policy `requests_insert` dropped | mig 164:57 |
| `requests_update` policy still exists but is moot after the revoke (team or manager+, identity columns unchanged) | mig 158:65-79 |
| Tickets are created/changed by server actions with the service key | mig 177:10 comment; `lib/actions/requests.ts` |
| Comment insert: author = me AND parent ticket in my org AND (requester OR team member OR manager+ OR collaborator) | mig 167:111-122 |
| Time entries: insert by team member or manager+ only for `user_id = me`; update only own row, cannot re-point to another ticket | mig 080:324-333; mig 167:143-146 |
| A vendor cannot write a ticket through the data API; vendor actions are server actions that re-check ownership | mig 177:181-182 comment; `lib/vendor/ctx.ts:27-37` |

### 2.3 Role -> rows readable (matrix)

Legend: Y = all rows of own org. "own" = `requester_id = me`. "team" = `team_id` in my teams. R = branch via direct reports. C = my collaborations. A = tickets where I am a named `specific_user` approver. V = vendor assignee set.
"internal" = comments with `is_internal = true`.

| Role | `requests` | `request_comments` (public) | `request_comments` (internal) | `request_attachments` | `approvals` | `approval_decisions` | `request_time_entries` |
|---|---|---|---|---|---|---|---|
| Requester (`user`, no reports, not vendor) | own, plus C, A | own tickets; tickets in C? **no** (no collab branch in comments_select); A via approver branch | none (not team, not manager) | own tickets, public only | own tickets; A | own tickets only | own entries (`user_id=me`) + entries on own tickets |
| `user` with direct reports | own, C, A, R(requester or assignee in reports) | own; R | none | own only (attachments policy has NO R branch) | own, A (no R branch) | own | as requester |
| Agent / technician | own, team, C, A, R | own; team; R; A | tickets of own team(s) only | own, team (public + internal on team) | own, team; A | own, team | own entries; entries on own or team tickets |
| Manager | ALL of org | ALL | ALL | ALL (incl. internal) | ALL | ALL | ALL |
| Admin / platform_owner | ALL of org | ALL | ALL | ALL | ALL | ALL | ALL |
| Vendor technician | only `assigned_to = me` | those tickets | none (internal blocked unless team/collab-agent; a vendor is neither) | those tickets, public only | none (own tickets only if he is requester, which the app forbids) | none | own entries only |
| Vendor manager | tickets assigned to any technician of his company | those tickets | none | those tickets, public only | none | none | none |
| Named approver (any role) | the ticket (branch A) | yes (approver branch) | only if also team member or manager+ | only if also own/team/manager+ (attachments policy has no approver branch) | the approval row | **no** unless team/manager+ | no |
| Collaborator | the ticket (branch C) | **no** (see 2.4 item 3) | no, unless also team member or manager+ (the collaborator-agent clause sits behind an outer ticket test that a collaborator does not pass) | no | no | no | no |
| Inactive, or must-reset-password | nothing (`current_org_id()` NULL) | nothing | nothing | nothing | nothing | nothing | `user_id = me` rows still match (policy has no org guard on that branch) |
| Other organisation | nothing | nothing | nothing | nothing | nothing | nothing | nothing |

Important reading of the Vendor rows: a vendor sees comments of other people too (store, Citykart), but only `is_internal = false`.

### 2.4 Where a simple filter would NOT reproduce the real rule

| # | Simple filter | Real rule differs because | Evidence |
|---|---|---|---|
| 1 | `requester_id = me` | adds team, collab, named-approver, direct reports (requester OR assignee), vendor assignees, and manager+ = whole org | mig 177:98-105 |
| 2 | `assigned_to = me` | a technician also sees every ticket of his team(s) whether or not assigned; a manager also sees tickets assigned to his reports | mig 177:99,104 |
| 3 | "who can see the ticket can see its comments" | `comments_select` has no collaborator branch (a non-team collaborator reads the ticket but not its comments); has approver branch; has no vendor-manager difference | mig 045:62-84, mig 115:48-69, mig 177:110-133 |
| 4 | "who can see the ticket can see its attachments" | attachments policy has no collaborator, no approver, no report branch, but has the vendor branch | mig 177:136-154 |
| 5 | "who can see the ticket can see its approval" | `approvals_select` has no direct-report branch and no vendor branch; `approval_decisions_select` has no approver branch (an outside approver sees the approval, not the decisions) | mig 113:63-76; mig 080:110-121 |
| 6 | "who can see the ticket can see its history" | `request_activity` is blocked for role `user` and has no collaborator/approver/report/vendor branch | mig 169:8-21 |
| 7 | manager = "my team's tickets" | database gives manager the whole organisation. Screens may show less (2.5) | mig 177:100 |
| 8 | "technician group" = `assigned_to` list | team scope is through `requests.team_id`, not through the technician; a ticket moved to another team leaves the old team's view | mig 177:99 |
| 9 | named approver = anybody on a step | only `approver_type='specific_user'` steps count; `any_manager` steps give no ticket access; steps stay valid after the decision so the approver keeps ticket access forever (any approval status) | mig 158:22-31 |
| 10 | vendor manager = same `vendor_company_id` | RLS keys on the CURRENT company of the ASSIGNEE: if a technician is moved to another company, his old tickets become visible to the new company's manager (code warns about it) | mig 177:75-76; `lib/actions/admin/vendors.ts:155-158` |
| 11 | "company switched off" = no access | `vendor_companies.is_active` is NOT in RLS. It is checked in app code only (`vendorCompanyIsActive`); direct data-API reads by a switched-off vendor would still pass RLS | `lib/vendor/ctx.ts:19-24,31`; mig 177:70-81 (no is_active test on company) |
| 12 | manager visibility = org chart tree | only ONE level of `manager_id`; no recursion | mig 115:13-22 |
| 13 | "inactive user cannot see" | true for all helper-based policies; `time_entries_select` first branch `user_id = auth.uid()` is not guarded by `current_org_id()` | mig 080:311-312 |

### 2.5 Screen- and report-level scopes that are narrower or different than RLS

| Place | Rule | Evidence |
|---|---|---|
| Report builder, `requests` entity | admin/platform_owner: all; **manager: only their teams**; agent: own + assigned + own teams; user: own. Other entities (tasks, projects, approvals): manager+ only | `lib/reporting/access.ts:41-65` |
| Report scope "reports" (person with direct reports) | tickets raised by or assigned to the reports | `lib/reporting/access.ts:16,27-30` |
| "My Team" tab in Requests | `requester_id` or `assigned_to` in `manager_id = me` | `lib/queries/requests.ts:409-418` |
| Approvals page for `manager` | only approvals sent to them (named or any_manager steps), on their own tickets, and on their teams' tickets; admin/platform_owner see all | `lib/queries/approvals.ts:58-83`; `app/(app)/approvals/page.tsx:60-72` |
| Approvals page for others | whatever `approvals_select` returns (own tickets, tickets where named approver) | `app/(app)/approvals/page.tsx:48-58` |
| Requester reading ticket history | RLS blocks it; the server first checks ticket visibility, then reads with the service key and returns a reduced field set | `lib/queries/requests.ts:74-90`; mig 169 |
| Services a requester can pick | service has no location tag -> hidden from requesters (since mig 189); tagged -> visible only if `profiles.location_id` matches. This is catalogue visibility, not ticket visibility | mig 127:1-9; mig 189:1-4 |
| Config tables (alert rules, escalation, permission overrides, scheduled reports, related requests) | role <> 'user' only | mig 167:149-158 |
| Custom per-role permission matrix | exists in tables but NOT enforced (`PERMISSION_MATRIX_ENFORCED = false`); real rules are `lib/permissions/matrix.ts` | `lib/permissions/enforced.ts:5` |
| Who may change company-wide configuration | capability table (admin/manager/platform_owner per capability, three switchable by platform owner) | `lib/permissions/matrix.ts:22-95` |
| Vendor pages | allow-list `/vendor`, `/profile`, `/notifications`; anything else redirects (ticket links go to `/vendor/tickets/<id>`) | `lib/vendor/access.ts:22-35`; `app/(app)/layout.tsx:33-35` |
| PO register | staff (agent+) see EVERY PO of the org; a vendor sees POs of the tickets RLS lets him read | `lib/vendor/register.ts:57-66`; `app/(app)/purchase-orders/page.tsx:10,16` |
| PO approval page `/vendor-po/<id>` | any agent/manager/admin/platform_owner of the same org can OPEN it; only an addressed approver or admin/platform_owner sees the decision form | `app/(app)/vendor-po/[id]/page.tsx:27-30` |

### 2.6 CKOneAI role labels (not the same as RLS)

| Label | Rule | Evidence |
|---|---|---|
| requester | everybody allowed to use the assistant | `lib/ckoneai/roles.ts:19` |
| technician | agent, manager, admin, platform_owner | `lib/ckoneai/roles.ts:14,20` |
| approver | manager tier, OR anyone with ANY row in `approval_workflow_steps.approver_user_id` (current or historic, any workflow, not only pending ones) | `lib/ckoneai/roles.ts:15,21,28-31` |
| Vendor logins | refused entirely | `lib/ckoneai/roles.ts:26`; `lib/ckoneai/access.ts:16-18` |
| Not passed on | team ids, manager links, collaborations, named-approver ticket ids | by absence in `roles.ts` (UNVERIFIED for the CKOneAI side, which is outside this repo) |

So the label "technician" does not say which teams; "approver" does not say which tickets; "requester" does not say whether the person has reports.

---

## 3. Approvals

### 3.1 Tables and states

| Table | Key columns | Notes | Evidence |
|---|---|---|---|
| `approval_workflows` | `id, org_id, name, description` | reusable route; ad-hoc workflow is created per approval (name "Ad-hoc approval <no>") | mig 000:167-173; mig 033:15; `lib/approvals/adhoc.ts:~40` |
| `approval_workflow_steps` | `workflow_id, step_order, approver_type (specific_user|any_manager), approver_user_id, added_by` | CHECK: specific_user needs a user, any_manager needs none; `added_by` records who added an approver | mig 000:178-189; mig 166:7 |
| `approvals` | `request_id, workflow_id, current_step, status (pending|approved|rejected|cancelled), requested_by, org via request` | more than one round per ticket allowed; **at most one pending per ticket** (partial unique index) | mig 000:338-346; mig 031; mig 086; mig 144 |
| `approval_decisions` | `approval_id, step_order, decided_by, decision, comment, decided_at` | UNIQUE (approval_id, step_order): second decision on a step fails (code 23505 -> "already decided") | mig 000:353-362; `lib/approvals/decision.ts:~150` |
| `approval_email_codes` | one-time code per approval+approver (hashed) | for approving from e-mail without login | mig 161; `lib/approvals/email-code.ts:1-65` |
| `requests.pre_approval_status`, `waiting_since` | remembers the status before approval | restored on approve and on recall | mig 124; `lib/approvals/decision.ts:236`; `lib/approvals/recall.ts:55` |
| `service_categories.auto_cvm_approval` | category sends ticket to the store's CVM automatically | default off | mig 174:5 |
| `service_categories.show_approval_history` | show earlier same-store decisions in approver mail/page | ON where auto_cvm_approval was on | mig 183:9-10 |
| `stores.cvm_id` | the store's CVM (approver) user | DB trigger: must be active, same org, role agent/manager/admin/platform_owner | mig 173:10-37 |
| `services.approval_workflow_id` | service-level route | used by `submitForApproval` | `lib/actions/requests.ts:1307` |

Ticket status during approval: `pending_approval` (SLA clock paused; `waiting_since` set). A client cannot move a ticket out of `pending_approval`; only the server does (mig 163 header).

### 3.2 Ways an approval starts

| Way | Who may start | Approver chosen by | Mode | Evidence |
|---|---|---|---|---|
| Service workflow ("Submit for approval") | manager/admin/platform_owner, or an **agent who is on the ticket's team** | the service's workflow steps (any_manager and/or named) | sequential (`current_step` 1..N); a service with no workflow is refused; a workflow with zero steps is refused | `lib/actions/requests.ts:1284-1310,1340-1366` |
| Ad-hoc "Send for approval" | same people | the sender picks active users of the same org | parallel (`current_step = 0`): **first decision settles it** | `lib/actions/approvals.ts:137-185`; `lib/approvals/adhoc.ts` |
| Add approvers to a pending ad-hoc approval | same people | extra `specific_user` steps; not allowed on fixed workflows | still parallel | `lib/actions/approvals.ts:188-262` |
| Automatic CVM approval | system, when category has `auto_cvm_approval` | CVM of the requester's store (`stores.cvm_id`) | parallel, single approver; ticket forced to In Process first | `lib/cvm/auto-approval.ts:1-80` |
| Vendor PO/quote approval | vendor technician action | PO approvers (section 4.5), separate mechanism, NOT the `approvals` table | see 4.5 | `lib/actions/vendor-requests.ts:125-154` |

### 3.3 Approver types and who may decide

| Type | Meaning | Who may act | Evidence |
|---|---|---|---|
| `specific_user` | one named person | exactly that user (while not yet decided for his step in parallel mode) | `lib/approvals/decision.ts:101-134`; `lib/approvals/canAct.ts:25-38` |
| `any_manager` | any manager | any user with role manager, admin or platform_owner (org check comes from reading the approval through the caller's client/RLS, and in e-mail path from the proven approver identity) | `lib/approvals/decision.ts:127-129`; `lib/approvals/canAct.ts:29,36-40` |
| Parallel (ad-hoc) | all asked at once | any addressed user; first approve OR first reject finalises | `lib/approvals/decision.ts:167-170,382` |
| Sequential | steps in order | only the person of the CURRENT step; each approve advances `current_step`; last approve completes | `lib/approvals/decision.ts:116-134,167-170,~270-300` |

The word "any_manager" appears as the enum `approver_type` (mig 000:39). For `any_manager` steps the bell/e-mail goes to every manager/admin/platform_owner of the ticket's organisation (`lib/actions/requests.ts` around 1442-1452, comment "B-21").

### 3.4 Outcomes, rejection, recall, delegation, reminders

| Topic | Behaviour | Evidence |
|---|---|---|
| Comment | required to approve or reject | `lib/approvals/decision.ts:24` |
| Approve (last step) | approval -> `approved`; ticket returns to `pre_approval_status` (default in_progress); hold time credited to SLA; requester and sender notified | `lib/approvals/decision.ts:167-290` |
| Reject | approval -> `rejected`; ticket -> `cancelled` with `cancellation_reason='approval_rejected'` and a **reopen window** (`reopen_deadline_at`, REOPEN_WINDOW_HOURS) for the requester; open timers stopped; requester and sender notified | `lib/approvals/decision.ts:382,420-426` |
| Race safety | conditional updates `WHERE status='pending'`; losing decision is rolled back | `lib/approvals/decision.ts:150-200,382-400` |
| Recall (withdraw) | manager, admin, platform_owner only; restores `pre_approval_status`; SLA credit | `lib/approvals/recall.ts:15,23,55` |
| Delegation | **exists**, per step: the current approver (or any manager for any_manager step) hands THAT step to another active user of the same org. Workflow is copied first if shared (so only this approval changes) | `lib/actions/approvals.ts:297-392`; `lib/approvals/isolate-workflow.ts:1-55` |
| Out-of-office / standing delegation | **not found** (grep for out_of_office / substitute: none in lib) | UNVERIFIED beyond grep |
| Reminders | daily 10:00 job; one e-mail per approver listing all approvals waiting for them; skipped if sent today; sequential approvals listed only for the person whose turn it is; per-approver claim keys in `app_settings` | `lib/approvals/reminders.ts:1-25,48-75`; scheduler script `scripts/windows/install-cron-tasks.ps1` |
| E-mail approval | link per approver+approval, valid 7 days (14 for legacy); visitor must be signed in as the approver OR enter a 6-digit code mailed only to the approver (10 min, 5 attempts, hashed); verified session cookie 30 min | `lib/approvals/email-link.ts:14,16,85-86,104`; `lib/actions/approvalEmail.ts:1-30` |
| What the e-mail/approve page shows an approver | priority, requester name, sender name, service, category, description (clipped 800), last 6 PUBLIC comments (`is_internal=false`), and the history box | `lib/approvals/email-state.ts:15-26,86-98` |
| History box (CVM approval history) | for categories with `show_approval_history`: this request's ticked answers + last 5 decided requests of the SAME store and sub-category in 12 months, **whoever decided them**, with decider name, outcome and the decider's comment; read with the service key (bypasses RLS) | `lib/approvals/history.ts:10-20`; `lib/approvals/history-model.ts:6-47`; mig 183 |
| In-app "who is it with" names | approver and decider names are read with the service key so technicians can see them | `lib/queries/approvals.ts:134-140` |

### 3.5 Separation of duties (can a requester approve their own ticket?)

| Control | Where | Effect |
|---|---|---|
| Decision-time block | `lib/approvals/decision.ts:91` | If the actor is the ticket's requester OR `approvals.requested_by` (the sender), the decision is refused (`OWN_REQUEST_MESSAGE`). Applies to portal AND e-mail path, workflow AND ad-hoc AND any_manager steps |
| Choice-time block (ad-hoc send) | `lib/actions/approvals.ts:170` | requester and sender cannot be chosen as approver |
| Choice-time block (add approver) | `lib/actions/approvals.ts:225` | requester, original sender, and the actor himself barred |
| Choice-time block (delegate) | `lib/actions/approvals.ts:362-363` | requester, sender and delegator himself barred |
| Choice-time block (auto CVM) | `lib/cvm/auto-approval.ts:41` | if CVM is the requester: no approval, internal note instead |
| Rule module | `lib/approvals/separation.ts:1-33` | one shared function |
| NOT checked | service workflow definition (`lib/actions/admin/workflows.ts:143-144`) | an admin can name the requester of future tickets as a step approver; the decision-time block is the only protection |
| NOT checked | vendor PO decision (`lib/actions/vendor-po.ts:29-49`) | no requester/sender comparison. Today the approver pool is staff only (`lib/vendor/po.ts:19-25`) while requesters are `user`-role store logins, so it cannot happen by role, but there is no explicit test. **UNVERIFIED** if some staff can raise tickets as requester for AC categories |
| Deactivated approver | step stays but `loadValidApprovers` requires `is_active` for new picks only | `lib/actions/approvals.ts:120-134` |

### 3.6 What an approver may see (summary)

- Through RLS: the ticket row, the approval row, public comments (outside the team) via the `specific_user` approver branch; NOT internal comments, NOT attachments, NOT activity log, NOT decisions (unless team/manager+). Evidence rows in 2.1.
- Through the server pages: approve page/e-mail show the reduced detail in 3.4; the in-app approval preview uses `getApprovalPreview` (`lib/actions/approvals.ts:425-496`; contents **not read in detail, UNVERIFIED**).
- `getActionableApprovalsForUser` (bell and reminders) uses the service key scoped by `request.org_id` (`lib/queries/approvals.ts:246-264`).

---

## 4. Vendor / OEM

### 4.1 Data model (all server-only except the profile columns)

| Table / column | Purpose | Evidence |
|---|---|---|
| `vendor_companies(id, org_id, name, is_active, created_by)` | Voltas, Blue Star ...; unique name per org | mig 177:14-22 |
| `profiles.vendor_company_id`, `profiles.vendor_role` | who is a vendor person | mig 177:28-37 |
| `vendor_requests(id, org_id, request_id, kind parts|po, status, created_by, decided_by, decided_at, decision_reason, approver_id, approver_ids[], po_number, po_date, po_attachment_id, version, replaces_id, quote_attachment_ids[], revision_note, revision_requested_by, revision_requested_at)` | one row per quote/parts version | mig 178:9-20; mig 179:10-13; mig 180:9-14; mig 181:34 |
| status values | `pending, revision_requested, approved, rejected, received, cancelled, superseded, withdrawn` | mig 180:16-18 |
| open-request rule | at most ONE open (`pending` or `revision_requested`) request per ticket | mig 180:22 |
| `vendor_request_items(vendor_request_id, line_no, item_name, qty, price_excl_gst)` | quote lines; `price` null for parts-only | mig 178:25-33 |
| `master_ac_units.po_emails[]`, `.approver_emails[]` | OEM address for PO details; Citykart approvers for that AC ("CK PO Approver Mail To") | mig 179:17; mig 181:32 |
| `app_settings` key `vendor_po_approver_id` | default PO approver (AC only); "no built-in person" | `lib/vendor/po.ts:17,30-36` |
| `vendor_programs.default_approver_ids[]`, `resolution_options[]`, `oem_number_required` | the same for Vendor Programs | mig 187:8-11 |
| OEM ticket number | stored in form box "AC OEM Ticket Number" if the form has one, and always in `form_data._oem_ticket_no` / `_oem_ticket_date` | `lib/vendor/fields.ts:13-14`; `lib/actions/vendor.ts:24-70` |

### 4.2 Roles in the vendor workflow

| Person | Sees | Can do | Evidence |
|---|---|---|---|
| Vendor technician | tickets `assigned_to = me`; their public comments and public attachments; own PO register | start (OEM number), PO request, parts request, revise quote, withdraw, parts received, resolve (list choice + FSR file), public comment | mig 177:7; `lib/actions/vendor.ts`; `lib/actions/vendor-requests.ts`; `lib/vendor/ctx.ts:27-37` |
| Vendor manager | tickets of his company's technicians, read only; PO register of those | nothing (no actions); the actions refuse non-technicians | `lib/vendor/ctx.ts:30`; mig 177:75-76 |
| Citykart staff | as section 2 | cancel/take back a vendor ticket; see "with vendor" note | `docs/VENDOR-TECHNICIAN-DESIGN.md` section 3 |
| PO approver | see 4.5 | approve / ask revised price / reject | `lib/actions/vendor-po.ts` |
| Admin / platform_owner | vendor admin (companies, invite, switch off), set default PO approver | | `lib/actions/admin/vendors.ts:24,32-172` |

Vendor ticket boxes (dashboard grouping, no new status): revise_price, open, in_process, part_required, po_required, resolved, cancelled; derived from status and the open `vendor_requests` kind/status. Evidence: `lib/vendor/access.ts:42-100`. A hold without a recorded vendor request shows as "In process".

### 4.3 How a ticket reaches a vendor technician

| Step | Rule | Evidence |
|---|---|---|
| Assignment | only by a Business Rule action "assign" (with `vendorCompanyId` = round-robin among that company's ACTIVE technicians) or by an administrator. Nothing from the sheet routes a ticket to a vendor technician | `lib/rules/actions.ts:123-137`; mig 187:5 |
| Switched-off company | rule assigns nothing | `lib/rules/actions.ts:128-132` |
| Vendor technician as valid assignee | exempt from the "must be on the ticket's team" rule | `lib/rules/actions.ts:95-117` |
| Re-assignment protection | a ticket already with a vendor technician is never taken away by a rule | `lib/rules/actions.ts:141-146` |
| Rule conditions | `vendor_company_id` of the assignee is a rule condition | `lib/rules/evaluate.ts:37`; `lib/rules/run.ts:146-148` |
| Ticket stays Open until the vendor presses Start | design decision 3 | `docs/VENDOR-TECHNICIAN-DESIGN.md` section 2 |

### 4.4 Parts, quotes, revised price (revise price), OEM numbers, FSR, visits

| Item | Rule | Evidence |
|---|---|---|
| Parts request (no PO) | only from `in_progress`; items+qty; ticket -> `hold_purchase_ho`; vendor can correct (new version) and later mark "parts received" (remark ≥ 3 chars) -> back to `in_progress` | `lib/actions/vendor-requests.ts:28-84` |
| PO/quote request | only from `in_progress`; lines with price ex-GST; at least one quote file uploaded by the vendor himself (`ownFiles`); at least one approver must resolve else error; ticket -> hold | `lib/actions/vendor-requests.ts:125-154`; `lib/vendor/requests.ts:209-213` |
| Versions | any change = new version; old becomes `superseded`; old cannot be approved | `lib/vendor/requests.ts:148-160` |
| Revise price | approver sets `revision_requested` with a note (≥5 chars); ticket stays on hold; vendor sends new quote version with a NEW file; same approvers get the new version | `lib/actions/vendor-po.ts:117-142`; `lib/actions/vendor-requests.ts:157-188`; `lib/vendor/po-rules.ts:35-43` |
| Withdraw | vendor can withdraw an open request (reason ≥3 chars); ticket -> `in_progress`; approvers mailed | `lib/actions/vendor-requests.ts:191-222` |
| Citykart technician takes the ticket back | open request closed as `cancelled` | `lib/vendor/requests.ts:182-192` |
| OEM ticket number | AC and AC PMS rules: compulsory for AC (not for AC PMS); programs: compulsory only if `oem_number_required`; stored in form and background keys | `lib/actions/vendor.ts:24-70`; mig 187:4 |
| FSR | resolve needs ≥1 file uploaded by that vendor on that ticket (FSR for normal, "PMS report" for PMS); the file is linked to the resolution message | `lib/vendor/fields.ts:90-101`; `lib/actions/vendor.ts:76-119` |
| Resolution choice | must be a value of the administrator's current list (or Other with remarks) | `lib/actions/vendor.ts:98-114` |
| Vendor visits ("R4 visits") | **not in the build**: engineer-visit module dropped, public `/engineer` page removed | `docs/VENDOR-TECHNICIAN-DESIGN.md` line 235 |
| Public comments | vendor comments are always `is_internal=false`; vendors cannot read internal notes | `lib/actions/vendor.ts:132`; mig 177:127-132 |

### 4.5 PO decisions (vendor POs, not the `approvals` table)

| Rule | Evidence |
|---|---|
| Who may decide: a user NOT a vendor, same org, who is in `approver_ids`/`approver_id` of THAT request, OR admin / platform_owner (override so it never stalls) | `lib/actions/vendor-po.ts:29-37`; `lib/vendor/po.ts:87-88` |
| Who is an approver: sheet column "CK PO Approver Mail To" of the AC (or program row) mapped to active staff by e-mail, roles agent/manager/admin/platform_owner, not vendor; else the default approver; programs use their own defaults | `lib/vendor/po.ts:19-76` |
| Several approvers: ONE mail to all; any one decides; first decision wins; later ones are told who decided | `lib/actions/vendor-requests.ts:94-119`; `lib/actions/vendor-po.ts:41-46` |
| Approve | needs PO number (≤60), PO date (not future, ≥2020-01-01), PO document; decision written with a conditional update FIRST (pending->approved), ticket then -> `in_progress` (server key reads the ticket because approver may not be on the team); undo if ticket cannot move | `lib/vendor/po-rules.ts:8-23`; `lib/actions/vendor-po.ts:61-98`; `lib/requests/status-change.ts:50-53,172-178,194` |
| Reject (default) | reason ≥5 chars; only the QUOTE is rejected; ticket stays on hold; items become a new `parts` request (no prices) | `lib/actions/vendor-po.ts:157-183` |
| Reject + cancel ticket | ticket cancelled (reopenable 48 h as for rejected approvals); OEM and vendor mailed | `lib/actions/vendor-po.ts:185-204` |
| Mail to OEM | PO-details address from the AC sheet ("OEM PO Mail To", else OEM addresses); failure leaves an internal note | `lib/vendor/po.ts:163-210` |
| Login required | PO approval page needs a CK Desk login (no 6-digit code path) | `app/(app)/vendor-po/[id]/page.tsx:22-24`; design doc decision 12 |
| Requester != approver check | not present (see 3.5) | `lib/actions/vendor-po.ts:29-49` |
| Ticket must still be on hold | else "no longer waiting for this PO" | `lib/actions/vendor-po.ts:47` |

### 4.6 Notifications in the vendor flow

| Event | Goes to | Channel | Evidence |
|---|---|---|---|
| PO/quote sent or revised | each approver | ONE e-mail to all + bell each | `lib/actions/vendor-requests.ts:94-119` |
| Approved | OEM PO address (with document); vendor technician (own mail + bell) | e-mail, bell | `lib/actions/vendor-po.ts:94-111` |
| Revised price asked | vendor technician | e-mail + bell + public comment | `lib/actions/vendor-po.ts:126-140` |
| Quote not approved | vendor technician (+ public comment) | e-mail + bell | `lib/actions/vendor-po.ts:168-180` |
| Ticket cancelled by PO rejection | OEM, vendor | e-mail + bell | `lib/actions/vendor-po.ts:190-202` |
| Parts list updated | the store (requester) | mail/bell | `lib/vendor/ticket-notify.ts:1-12` |
| Hold ended by Citykart / reopened | vendor | mail | `lib/vendor/ticket-notify.ts` (functions `buildVendorHoldEndedMail`, `buildVendorReopenedMail`) |
| Comment by vendor | the requester | bell | `lib/actions/vendor.ts:135-139` |
| Any failed mail | internal note on the ticket telling staff to inform by hand | | `lib/vendor/po.ts:195-210` |

### 4.7 What stops one vendor seeing another vendor's data

| Barrier | Layer | Evidence |
|---|---|---|
| Technician sees only `assigned_to = me`; manager only technicians of own company and org | RLS | mig 177:70-81,105 |
| Comments/attachments through the same vendor assignees set, internal blocked | RLS | mig 177:122,127-132,146 |
| `vendor_requests`, items, companies are server-only; no direct read | RLS + grants | mig 178:38-43; mig 177:23-25 |
| Names of other people: a `user`-role profile sees only `current_user_visible_people()` (includes vendor assignees' set) | RLS | mig 170:130-133; mig 177:157-179 |
| Vendor list and PO register read tickets through the vendor's OWN login, so RLS decides | app | `lib/queries/vendor.ts:189-195`; `lib/vendor/register.ts:64-66` |
| All write actions re-load the ticket with the vendor's login and compare `assigned_to` | app | `lib/vendor/ctx.ts:32-35` |
| Route allow-list for vendor sessions | app | `lib/vendor/access.ts:22-35`; `app/(app)/layout.tsx:33-35`; `lib/ui/requireStaff.ts:10` |
| Cannot move yourself to another company | trigger | mig 177:41-67 |
| Admin cannot move a technician with open tickets to another company | app | `lib/actions/admin/vendors.ts:140-150` |
| Vendor cannot open PO approval or PO register of Citykart | app | `app/(app)/vendor-po/[id]/page.tsx:24`; `app/(app)/purchase-orders/page.tsx:15` |
| Vendor logins cannot use the CKOneAI assistant | app | `lib/ckoneai/access.ts:16-18` |
| Known holes | | resolved tickets keep their assignee: after a company move the new company's manager sees them (`lib/actions/admin/vendors.ts:155-158`); `is_active` of the company not in RLS (2.4 row 11); manager rule includes deactivated technicians of the company (mig 177:75 has no `is_active` filter on `t`) |
| Cross-vendor leak via the Data API | the API is not vendor-aware; it exports `requests.assigned_to` and `users.is_vendor` but no company | section 7 |

---

## 5. AC PMS, Sheet Masters, Vendor Programs (structure only)

### 5.1 Sheet Masters (mig 175)

Idea: Google Sheets stay the master; the app copies them (read only, never writes to a sheet). The migration header says "every minute" (mig 175:3); the guide says the scheduled task runs at 11:00, 15:00 and 19:00 (`docs/SHEET-MASTERS-GUIDE.md`). Which is current on live: **UNVERIFIED**. All tables are server-only (mig 175:142-144).

| Table | Content | Evidence |
|---|---|---|
| `master_sources(org_id, kind ac|genset|cvm|(pms), spreadsheet_id, tab_name, last_*status/error, row_count, content_hash)` | which sheet is which | mig 175:10-22; mig 184:12 widened kind |
| `master_google_connection` | Google account used to read; token in the Vault | mig 175:24-34 |
| `master_ac_units` | one row per AC: `store_code, ckdesk_no, serial, brand, tonnage, amc_vendor, amc_brand, region, cluster, address ..., emails[], po_emails[], approver_emails[], removed_at` | mig 175:36-66; mig 179:17; mig 181:32 |
| `master_gensets` | `store_code, brand, kva, serial, cpcb_group, emails[]` | mig 175:69-85 |
| `master_store_cvm` | `store_code, cvm_email` (the CVM sheet) | mig 175:87-99 |
| `master_issues` | sheet problems shown on a health page | mig 175:101-112 |
| `master_mail_templates` | one AC mail and one Genset mail template | mig 175:115-123 |
| `request_master_snapshots(request_id, kind ac|genset, unit_ids[], snapshot jsonb, mailed_to[], mailed_cc[])` | what the ticket was raised for, frozen at creation | mig 175:126-135 |
| Behaviour | a removed row is kept (`removed_at`); big disappearance (>20 units or 15%) applied only ≥30 min later; one bad row never blocks others | `docs/SHEET-MASTERS-GUIDE.md` |
| Effects on other things | store details (address, city, cluster, priority list, festival, AC counts, AMC vendor) follow the AC sheet; the "OEM" of a store in reports is the AC-AMC vendor from the sheet; a reply from an address in the sheets is recognised as an OEM reply | `docs/SHEET-MASTERS-GUIDE.md` |
| CVM link | the CVM sheet gives each store's CVM, resolved to an active staff user; `stores.cvm_id` is the field the auto-approval reads | mig 173; `lib/cvm/resolve.ts:1-40` |

### 5.2 AC PMS (mig 184)

| Item | Content | Evidence |
|---|---|---|
| Fourth master sheet "pms" | one row per store and PMS date | mig 184:15-24 |
| `master_pms_dates(org_id, store_code, pms_date, sheet_row)` | copy of the sheet | mig 184:15-24 |
| `pms_ticket_log(org_id, store_code, pms_date, status creating|created|skipped|failed, request_id, note)` | PK on (org, store, date): a date can never make two tickets | mig 184:26-36 |
| `service_categories.is_pms` | tickets of this category are PMS tickets; vendors see them in their own "AC PMS tickets" tab, never in "My tickets" | mig 184:48; `lib/queries/vendor.ts:211,236,245-252` |
| Ticket creation | made from the sheet from 09:00 India time on the PMS date, one per store, raised from the store's own login (per program PMS doc comment) | mig 191:5; `docs/AC-PMS.md` (not read in full, **UNVERIFIED**) |
| Vendor rules | starting a PMS visit needs no OEM number; resolving needs a PMS report file; resolution list not used | `lib/actions/vendor.ts:30-35,87-96` |

### 5.3 Vendor Programs engine (mig 186-188, 190-191)

| Item | Content | Evidence |
|---|---|---|
| `vendor_programs` | one record per service line (AC-like, Genset-like, RO purifier ...): name, slug, `level mail|portal`, `row_type store|machine`, sheet id/tab, column-name map, mail subject/body, status of last sync; later `resolution_options[]`, `oem_number_required`, `default_approver_ids[]`, `details_template`, PMS sheet fields | mig 186:9-33; mig 187:8-11; mig 188:6; mig 191:9-15 |
| `program_rows` | one row per sheet row: `store_code, machine_no, serial, vendor, emails[], po_emails[], approver_emails[], extra jsonb, removed_at` | mig 186:36-56 |
| `program_issues` | sheet problems per program | mig 186:59 |
| `request_program_snapshots(request_id, program_id, row_ids[], snapshot, mailed_to[], mailed_cc[])` | what a ticket was mailed for | mig 186:73-82 |
| `service_categories.program_id` | a category belongs to at most one program (and not to an AC/Genset OEM type) | mig 186:85 |
| `program_pms_dates`, `program_pms_log` | per-program PMS copy and ticket log | mig 191:17-46 |
| `request_automation_state(request_id, started_at, rules_ran_at, finished_at, rerun_*, auto_attempts, gave_up_at, last_result)` | how far the automatic steps of a new ticket got; admin "Run automation again"; retry every 15 min, 3 tries | mig 190:10-22 |
| `level = portal` | the vendor logs in and uses the same vendor workflow as AC (same code paths `loadProgramAsset`) | `lib/vendor/asset.ts`; `lib/actions/vendor.ts:32,101-103` |
| Access | all new tables server-only; created by admin; none exists until an administrator creates one | mig 186:1-6,91-101 |
| Production state | per docs the live level is 191 and "no vendor companies or logins yet for the programs" | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md:104`; `docs/GO-LIVE-AC-RO-SENSOMATIC.md:26` |

---

## 6. Tables relevant to access, and how a downstream copy sees them

| Authorization-relevant fact | Source of truth | Reproducible from a copy of the Data API? |
|---|---|---|
| Ticket org | `requests.org_id` | n/a (API serves one org; `DATA_API_ORG_ID` or the only org) `lib/data-api/query.ts:104-109` |
| Requester | `requests.requester_id` | yes (`requests.requester_id`) |
| Assignee | `requests.assigned_to` | yes |
| Team of ticket | `requests.team_id` | yes |
| Teams a person belongs to | `team_members` | **no** (entity not exported; `teams` has names only) |
| Direct reports / manager | `profiles.manager_id` | **no** (`users` does not select `manager_id`) |
| Role | `profiles.role` | yes (`users.role`) |
| Active / must reset password | `profiles.is_active`, `must_reset_password` | active yes; reset flag no |
| Collaborators | `request_collaborators` | **no** |
| Named approvers (current steps) | `approval_workflow_steps` | **no** (not exported; `approvals.workflow_id` is, `workflows` has name only) |
| Past deciders | `approval_decisions.decided_by` | yes after decision (no comment) |
| Sender of approval | `approvals.requested_by` | yes |
| Store CVM | `stores.cvm_id`, `master_store_cvm` | **no** (stores export has no `cvm_id`) |
| Vendor company / role | `profiles.vendor_company_id`, `vendor_role` | **no** (only `users.is_vendor`) |
| Vendor requests, quotes, POs, versions | `vendor_requests`, `vendor_request_items` | **no** |
| Program row / vendor mail addresses | `program_rows`, `master_ac_units` | **no** (by design) |
| Internal vs public comment | `request_comments.is_internal` | flag yes, text no |
| Vendor assignee of a ticket | assignee's profile | indirectly: `requests.assigned_to` -> `users.is_vendor`; company unknown |
| Services visible to a location | `service_location_tags` | **no** |

---

## 7. Read-only Data API: what it exports and what it cannot say

Facts: all reading uses the service key (`createAdminClient`, `lib/data-api/handler.ts:64`), bearer token DATA_API_TOKEN ≥32 chars, host allow-list optional (`lib/data-api/auth.ts:16-47`), one organisation, GET only, nothing is `select *`. No per-user filter, no concept of "viewer".

Entities (all in `lib/data-api/entities.ts`; columns are exactly the lists below):

| Entity (source table) | Mode | Columns returned | Lines |
|---|---|---|---|
| `requests` (requests) | incremental/updated_at | id, request_no, service_id, category_id, sub_category_id, status, priority, team_id, requester_id, assigned_to, parent_request_id, created/updated/responded/resolved/closed_at, response_due_at, resolution_due_at, waiting_since, paused_ms_total, reopen_count, store_code (of requester), response_breached, resolution_breached. **No title, description, form data, org id, store of the ticket itself** | 62-85 |
| `request_status_history` (request_activity, action=status_changed) | append | id, request_id, actor_id, created_at, from_status, to_status | 86-96 |
| `request_comments` | append | id, request_id, author_id, is_internal, source, from_external, text_length, created_at. No text | 97-107 |
| `services` | incremental | id, name, slug, is_active, status, team_id, sla_policy_id, default_priority, owner_id, created/updated | 108-115 |
| `service_categories` | incremental | id, name, slug, is_active, is_pms, program_id, created/updated. **No auto_cvm_approval, no show_approval_history** | 116-122 |
| `service_sub_categories` | incremental | id, category_id, name, slug, is_active, sla_priority, ... | 123-129 |
| `stores` | incremental | id, code, name, address, city, state, pincode, region, cluster, priority_list, festival, open_date, is_active, ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, zenatix. **No cvm_id** | 130-138 |
| `sla_policies` | incremental | id, name, is_active, config, ... | 139-145 |
| `csat_surveys` | snapshot | id, request_id, rating, sent_at, submitted_at, reminder_sent_at (no comment, no requester id) | 146-152 |
| `approvals` | incremental | id, request_id, status, current_step, workflow_id, requested_by, created/updated | 153-159 |
| `approval_decisions` | append | id, approval_id, step_order, decision, decided_by, decided_at (no comment) | 160-167 |
| `teams` | incremental | id, name, slug, prefix, department_id, is_active, created/updated | 168-174 |
| `departments` | snapshot | id, name, code, parent_id, is_active, created_at | 175-181 |
| `locations` | snapshot | id, name, code, city, country, timezone, is_active, created_at | 182-188 |
| `approval_workflows` | incremental | id, name, created/updated | 189-195 |
| `programs` (vendor_programs) | incremental | id, name, slug, level, row_type, is_active, created/updated | 196-202 |
| `users` (profiles) | incremental | id, full_name, role, is_active, store_code (derived), department_id, location_id, is_vendor (derived from vendor_company_id), created/updated. No e-mail, mobile, employee number, manager_id, team, vendor company | 203-214 |

### 7.1 Authorization facts NOT available to a downstream dataset

1. **Team membership** (`team_members`): not exported. A downstream copy cannot compute "tickets of my teams".
2. **Org-chart** (`manager_id`): not exported. "My team / my reports" cannot be computed. Only `department_id` and `role` exist.
3. **Collaborators** (`request_collaborators`): not exported.
4. **Named approver steps** (`approval_workflow_steps`): not exported, so "tickets where I am the named approver", "who is it waiting on", "any_manager vs specific step" are unknowable. Only `approvals.current_step`, `status`, `workflow_id`, `requested_by` and past `decided_by`.
5. **Store CVM** (`stores.cvm_id`, `master_store_cvm`): not exported.
6. **Vendor identity**: no `vendor_company_id`, no `vendor_role`, no `vendor_companies`; `users.is_vendor` only. So "a vendor technician sees only his tickets / a vendor manager sees his company's" cannot be reproduced; company of the assignee is unknown.
7. **Vendor quotes, POs, versions, approvers, FSR files, OEM numbers**: not exported (`vendor_requests*`, `request_attachments`, form data).
8. **Per-viewer comment visibility**: `request_comments.is_internal` exists, but there is no way to decide whether a given viewer may count an internal row.
9. **Request-level store**: only the REQUESTER's store code; the store of the ticket as a business object is not given when the requester is a head-office user.
10. **Service-location visibility** (`service_location_tags`) and **permission overrides**: not exported.
11. Deleted rows: the `/ids` endpoint lets the copy find ids that disappeared (`lib/data-api/query.ts:190-205`); it says nothing about visibility.
12. **`must_reset_password`**, session state, vendor company `is_active`: not exported.
13. The API gives all rows of the organisation to the token holder. Any per-person filtering has to be rebuilt downstream from the exports above plus the missing facts, and the missing ones (1-7) are exactly the ones RLS uses.

---

## 8. Not verified / assumptions

| # | Item | Why unverified |
|---|---|---|
| 1 | Which migrations are applied on production | docs say live level 191 and 192 "built locally" (`docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md:104`) but later commits (18b50ad, 9c1e8f9) mention 192-195; no DB access. Vendor migrations 177-181 are said to be live in level 191, not queried |
| 2 | Actual policies on the database vs files | the live DB may differ in grants (mig 171 header says live had extra grants); policies were reported equal on 2026-10-17 by that same header |
| 3 | `tests/remediation/70-rls-equivalence.test.ts` result | not run (no DB). It is the named proof that the 158 rewrite equals the earlier rule; vendor branch added later in 177 |
| 4 | Whether a store has exactly one login | only comment text in mig 177:156 |
| 5 | Content of `getApprovalPreview` | not read |
| 6 | `docs/AC-PMS.md`, `docs/PROGRAM-PMS.md` details | read only migration headers |
| 7 | Business Rules UI for "assign to vendor technician(s)" | seen in `lib/rules/actions.ts`; UI not opened |
| 8 | CKOneAI side (outside repo) | only `lib/ckoneai/*` and `docs/CKDESK-BOT-VIA-CKONEAI.md` lines 20-22 read |
| 9 | `platform_owner` behaviour across organisations | policies only use `current_org_id()`; whether more than one organisation exists on live is not known (Data API errors if more than one and `DATA_API_ORG_ID` unset: `lib/data-api/query.ts:104-109`) |
| 10 | Collaborator comments gap (2.4 item 3) | derived from policy text; recommend a quick live check with a test collaborator before relying on it |
| 11 | Uncommitted changes in working tree (`lib/data-api/params.ts`, `types/index.ts`, `lib/secrets.ts`, CKOneAI folders) | git status shows them modified; this inventory read the working-tree files; entities.ts itself is unmodified |

## 9. File index (where to look)

- RLS: `supabase/migrations/20240101000177_vendor_core.sql` (tickets, comments, attachments, vendor), `...158_post_audit_rls_performance.sql` (helpers), `...113_approver_visibility.sql`, `...115_manager_subordinate_visibility.sql`, `...080_rls_hardening_cross_tenant.sql`, `...166_approvals_privacy.sql`, `...169_low_findings_db.sql`, `...170_low_findings_db_b.sql`, `...167_ownership_and_privacy.sql`, `...165_server_only_writes.sql`, `...168_must_change_password_enforced.sql`.
- Approvals: `lib/approvals/*.ts`, `lib/actions/approvals.ts`, `lib/actions/approvalEmail.ts`, `lib/queries/approvals.ts`, `lib/cvm/*.ts`.
- Vendor: `lib/vendor/*.ts`, `lib/actions/vendor*.ts`, `lib/queries/vendor.ts`, `lib/actions/admin/vendors.ts`, `lib/rules/actions.ts`, `app/(app)/vendor*`, `app/(app)/purchase-orders`.
- Masters/programs/PMS: migrations 175, 184, 186-188, 190, 191; `lib/masters/*`, `lib/programs/*`, `lib/pms/*`; docs `docs/SHEET-MASTERS-GUIDE.md`, `docs/VENDOR-PROGRAMS-DESIGN.md`, `docs/VENDOR-TECHNICIAN-DESIGN.md`.
- Data API: `lib/data-api/{entities,query,handler,auth,params}.ts`, `docs/CKDESK-DATA-API.md`.
- Assistant bridge: `lib/ckoneai/{roles,access,sign,forward}.ts`, `docs/CKDESK-BOT-VIA-CKONEAI.md`.
