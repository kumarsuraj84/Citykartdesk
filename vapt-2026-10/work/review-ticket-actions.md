# VAPT source review: ticket actions and their satellites (prefix VA-TKT)

Scope: `lib/actions/{requests,approvals,approvalEmail,attachments,task-attachments,tasks,projects,ticketCopy,csatPublic,notifications,search,profile,auth,push,knowledge-base}.ts`, `lib/approvals/*`, `lib/requests/*`, `lib/rules/*`, `lib/sla/*`, `lib/queries/{requests,approvals,profiles,tasks,attachments}.ts`, and the RLS policies / triggers / function grants in the LOCAL audit database (`supabase_db_ckdesk_audit`, SELECT-only queries).
Method: read the current code, then confirmed what the database really enforces (policies, triggers, grants) before calling anything a vulnerability. No app was started, nothing was changed.

How the app is built (matters for every finding): almost every action uses the signed-in person's own database client (so row security applies), but the browser also holds that same login and the public Supabase key. So anything a person can do through a server action they can also try directly against the database REST API. A rule that exists only in a server action is therefore a "screen rule", not a real rule. Findings 01, 04, 09 are all of this kind.

Severity key: Critical / High / Medium / Low. Fixtures for recipes: `tests/setup/fixtures.ts` (`setupFixtures()` gives `requester`, `otherRequester`, `agent` (member of `teamId`), `clientForToken(accessToken)` for a client with that person's login, `getAdmin()` for set-up only). Audit API is on `http://127.0.0.1:55421`.

---

## 1. Candidate vulnerabilities

### VA-TKT-01  The database does not protect priority, deadlines, assignee or the requester's own words; the "nobody can change priority" rule is a screen rule only
- Severity: High (insider integrity). A technician or manager can silently rewrite the SLA and priority of any ticket of their group; any logged-in person can create a ticket with a forged priority in any group. Drops to Medium if technicians are treated as fully trusted.
- Module: `requests` table, RLS `requests_update` / `requests_insert`, trigger `guard_request_client_write`.
- Evidence (database, confirmed with `pg_policies` / `pg_get_functiondef`):
  - `requests_update`: USING `team_id = ANY(current_user_team_ids()) OR role IN (manager, admin, platform_owner)`; WITH CHECK only `request_identity_unchanged(id, org_id, requester_id, service_id, team_id)`. Column privilege `UPDATE` is granted to `authenticated` on every column.
  - `guard_request_client_write()` on UPDATE only blocks: change of `request_no`, `created_at`, and status moves not in `request_status_transition_allowed()`. It does not look at `priority`, `response_due_at`, `resolution_due_at`, `waiting_since`, `paused_ms_total`, `responded_at`, `resolved_at`, `reopen_count`, `assigned_to`, `category_id`, `sub_category_id`, `title`, `description`, `form_data`, `source_metadata`.
  - `requests_insert`: `requester_id = auth.uid() AND org_id = current_org_id()`; the INSERT guard only demands status `open`/`pending_approval`, no assignee and no SLA dates. `priority`, `team_id`, `service_id`, `sub_category_id`, `form_data` are free.
  - `system_log_audit_trigger` on `requests` watches `status, assigned_to, priority, team_id, requester_id, service_id, resolved_at, closed_at, reopen_count`. The two SLA due-date columns are not watched.
- App side: `lib/actions/requests.ts:876-883` says priority/service cannot be changed "whatever their role" and removes `changePriority()`; it is true for the actions only.
- Plain-language: the company decided that nobody, not even a manager, may change a ticket's priority by hand. The screens enforce that, but the database does not. A technician can open the browser console, use the page's own login, and send one update that sets `priority`, pushes the resolution deadline a year ahead (so the ticket never shows as late), reassigns the ticket to anyone, or edits what the requester originally wrote. Anyone can also create a ticket straight into another group's queue marked urgent, skipping the service's mandatory form.
- Exploit scenario (technician T, member of team X): `PATCH /rest/v1/requests?id=eq.<ticket of team X>` with T's login and body `{"priority":"low","resolution_due_at":"2030-01-01T00:00:00Z","assigned_to":"<any profile id>","description":"..."}`. Requester R: `POST /rest/v1/requests` with `{"requester_id":R,"service_id":<any>,"team_id":<any team>,"priority":"urgent","title":"x","status":"open","form_data":{}}`.
- Prove on the local stack: `const f = await setupFixtures(); const t = clientForToken(f.agent.accessToken); const r = getAdmin()-seeded ticket in f.teamId; await t.from('requests').update({priority:'low', resolution_due_at:'2030-01-01T00:00:00Z'}).eq('id', r.id).select()` returns the row (expected after fix: error 42501). Then `clientForToken(f.requester.accessToken).from('requests').insert({ request_no:'', requester_id:f.requester.id, service_id:f.serviceId, team_id:f.teamId, org_id:f.orgId, title:'t', priority:'urgent' })` succeeds today. Check `system_log` afterwards: priority change is logged, due-date change is not.
- Fix (minimal): extend `guard_request_client_write()` so that, when `current_user IN ('authenticated','anon')`, UPDATE may not change `priority, response_due_at, resolution_due_at, waiting_since, paused_ms_total, responded_at, resolved_at, closed_at, reopen_count, assigned_to, category_id, sub_category_id, cancellation_reason, reopen_deadline_at, pre_approval_status, form_data, description, title` (all of these are already written with the admin client where the app really needs it, e.g. `updateRequestCategory`, status change for requesters, `updateRequestFormData` via RPC). Where a technician legitimately needs it (assign, first response), do it through a SECURITY DEFINER function or the admin client. On INSERT force `priority`, `team_id`, `sub_category_id` to be what the server computed (or make `requests_insert` role `service_role` only, since `createRequest` already inserts via the server). Add `response_due_at, resolution_due_at` to the audit trigger's watched list.
- Confidence: CONFIRMED-BY-CODE (policy and trigger text read from the live audit DB). Reachability of PostgREST from a logged-in browser is how the app itself works, so no further dynamic check is needed.

### VA-TKT-02  A manager can still change priority, status or group by writing a Business Rule
- Severity: Medium. It is a permitted route ("or a Business Rule"), but the brief's own wording says no role may do it by hand; managers can, with a narrow rule, and rules bypass the normal checks.
- Module: `lib/actions/admin/business-rules.ts:12-16` (`requireAdminOrManager`), RLS `business_rules_write` (manager/admin/platform_owner), `lib/rules/actions.ts:170-210, 213-335, 337-351`.
- Evidence: `createBusinessRule` / `updateBusinessRule` accept role `manager`. Actions `set_priority`, `set_status`, `set_team` run with the admin client. `runSetStatus` moves a ticket from any status to any status (the matrix in `request-transitions.ts` is not consulted), skips the mandatory remark / resolution note, creates the CSAT survey, and `set_priority` rewrites both SLA due dates. Rules run on every "updated" event (`updateRequestFormData`, `updateRequestCategory`, status change) and on a schedule.
- Plain-language: a manager cannot change a priority directly any more, but can write a rule such as "if the title contains X then set priority to Urgent and group to Y", save it, and on the next edit of that ticket it is done. That undoes the decision "nobody can change priority by hand", and can also resolve or cancel a ticket without the note that is otherwise mandatory.
- Exploit: manager M calls `createBusinessRule({trigger:['updated'], conditions:[title contains '<unique text>'], actions:[{type:'set_priority', params:{priority:'low'}}, {type:'set_status', params:{status:'resolved'}}], is_active:true, ...})`, then edits any ticket whose title matches (or just waits for the schedule). Not logged as a person's action: the activity row is written with `actorId = request.requester_id` (see VA-TKT-17).
- Prove locally: sign in as a manager fixture (promote with `getAdmin()`), call `createBusinessRule`, then call `updateRequestFormData` on a matching ticket, read `requests.priority`/`status`.
- Fix: restrict rule authoring to `admin`/`platform_owner` (app and `business_rules_write` policy), or require a second admin to activate; in `runSetStatus` re-use the transition matrix and the resolution-note check; log rule changes to a place managers cannot edit; attribute rule-driven activity to a "system" actor.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-03  Text of internal notes is sent to people who may not see it (collaborators of any role, @mentioned colleagues) by bell, e-mail and push
- Severity: Medium (confidentiality; internal notes often hold diagnosis, escalation talk, sometimes credentials despite the warning).
- Module: `lib/actions/requests.ts` `addComment` + `addCollaborator`, `lib/notifications.ts`.
- Evidence:
  - `requests.ts:722-745`: for an internal note the recipients are `[assignee, ...collaboratorIds]` and the body is the first 120 characters of the note. `addCollaborator` (`requests.ts:501-585`) only checks that the chosen person is a visible profile; it does not require an agent-tier role, so the requester or any employee can be a collaborator. RLS hides the note from them (`comments_select`: internal needs team / manager / `is_request_collaborator AND is_agent()`), but the notification already carries the text.
  - `requests.ts:747-779`: @mention processing runs for internal notes too. It searches all active profiles in the organisation by first name (`ilike 'name%'`, `limit(3)`) and notifies the first match, whoever they are, with the note text (120 characters). No check that the person can open the ticket.
  - `lib/notifications.ts:162-209, 238-250`: the same `title/body` goes out by e-mail and web-push.
- Plain-language: a technician writes an internal note "@Ravi customer is lying, check the CCTV..." and Ravi, or another Ravi who has nothing to do with the ticket, or the requester who was added as a collaborator, receives the sentence in the bell and by e-mail. The "internal" label protects the screen, not the message.
- Exploit scenario: technician adds the requester as collaborator (or mentions the requester's first name) in an internal note. Or, without malice, mentions a common first name and a different employee with that name (first of 3 matches) gets the text.
- Prove locally: fixtures: agent on team, `requester` as a collaborator via `addCollaborator`, post `addComment(requestId, 'secret text @uat', true)` then read `notifications` for the requester with the admin client: body contains the text. Same with a mention of any profile that cannot see the ticket.
- Fix: for internal notes send only to recipients who are agent-tier AND can see the ticket (intersect with team / manager / agent collaborators); for @mentions resolve the person by id from a picker (not first name), require they can see the ticket (and for internal notes that they are agent-tier); restrict `addCollaborator` to agent-tier roles or label them as read-only public viewers who never get internal notifications; never put internal text in e-mail/push bodies (say "an internal note was added").
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-04  A file attached to an internal note is stored as a normal (visible) attachment
- Severity: Medium.
- Module: `lib/actions/attachments.ts:151-163`, RLS `request_attachments_select`, `app/api/storage/attachment/request/[id]/route.ts`, `lib/requests/ticket-pdf-model.ts:178-180`.
- Evidence: `uploadAttachment` always writes `is_internal: false` (line 161), even when `commentId` points at an internal note. `request_attachments_select` hides only rows with `is_internal = true`; it does not look at the comment's flag. The ticket page groups files under their comment so the requester does not see them in the browser, but the database row and the download route are open to the requester. The PDF and ticket-copy e-mail list attachments with `!x.is_internal`, so they list these files too.
- Plain-language: a technician attaches a log file or a screenshot of another customer to an internal note. The note is hidden from the requester, but the file is not marked hidden, so the requester (or anyone who can read the ticket's files through the REST API) can list and download it, and its name appears in the PDF/copy e-mail.
- Exploit: requester R runs `GET /rest/v1/request_attachments?request_id=eq.<own ticket>&select=id,file_name,comment_id`; every row of an internal note is returned; then opens `/api/storage/attachment/request/<id>` and gets the file.
- Prove locally: agent posts an internal comment, then `uploadAttachment(requestId, fd, commentId)`; with `clientForToken(requester.accessToken)` select `request_attachments` for that request: row is returned (expected after fix: none).
- Fix: in `uploadAttachment` look up the comment and set `is_internal` from it; make `request_attachments_select` additionally require `comment_id IS NULL OR the comment is visible` (join on `request_comments` under its own RLS); back-fill existing rows (`UPDATE request_attachments SET is_internal = true WHERE comment_id IN (SELECT id FROM request_comments WHERE is_internal)`).
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-05  "Submit for approval" picks an arbitrary workflow, can be started by the requester, and leaves the sender unrecorded
- Severity: Medium. Unrelated people can be made approvers (and so gain read access) of a ticket; a requester can freeze their own ticket and pause its SLA.
- Module: `lib/actions/requests.ts:1190-1382` (`submitForApproval`).
- Evidence:
  - 1205-1207: allowed for the requester themselves (`profile.id !== req.requester_id` is the only extra route), not only for technicians/managers.
  - 1239-1246: when the service has no workflow, `supabase.from('approval_workflows').select('id').limit(1).maybeSingle()` picks "any" workflow visible in the organisation. `approval_workflows` also holds one `Ad-hoc: <title>` row per ad-hoc approval ever sent (418 rows in the audit DB), so the choice is effectively random and can be somebody else's ad-hoc workflow.
  - 1279-1281: the `approvals` row is created without `requested_by`, so the separation-of-duties check in `lib/approvals/decision.ts:53` has nothing to compare.
  - 1294-1302: the status flip to `pending_approval` is not conditioned on the status that was read (compare `assignRequest`), so a concurrent resolve/cancel is overwritten, and `pre_approval_status` stores a stale value.
  - Effects of the wrong workflow: the people named in its steps get `current_user_approver_request_ids()` / `is_request_approver()` access, which gives them the whole ticket and its public conversation permanently, and the right to approve it.
- Plain-language: for a service that has no approval route configured, pressing "submit for approval" does not stop; it silently picks some other approval route and sends the ticket to whoever is on it. They can read the ticket and decide it. A requester can also push their own ticket into "pending approval", where the technician cannot move it (no transitions out) and the SLA clock is paused until an approver acts.
- Exploit: requester R of a ticket in a service without `approval_workflow_id` calls `submitForApproval(ticketId)`; or an agent does it on an HR ticket and unrelated approvers of a previous ad-hoc approval are granted access.
- Prove locally: fixtures service has no workflow; seed an ad-hoc workflow with `sendAdHocApproval` on another ticket; call `submitForApproval(requestId)` as `requester`; read `approvals.workflow_id` (equals an unrelated workflow) and `requests.status = pending_approval`; as an approver of that other workflow `select * from requests where id=...` now returns the ticket.
- Fix: no default workflow: return an error when the service has none (or use an explicit, flagged default `is_default` workflow); restrict to technicians/managers of the ticket's group; set `requested_by: profile.id`; add `.eq('status', req.status)` to the update and treat zero rows as a conflict.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-06  Approval route names and approvers are readable by every employee, and ad-hoc route names contain the ticket title
- Severity: Medium (confidentiality; works for plain requester accounts).
- Module: RLS `workflows_select` (`org_id = current_org_id()`), `approval_workflow_steps_select`, `lib/actions/approvals.ts:173`.
- Evidence: `sendAdHocApproval` stores `name: 'Ad-hoc: ' + req.title`. Any signed-in person can `GET /rest/v1/approval_workflows?select=name` and `GET /rest/v1/approval_workflow_steps?select=workflow_id,approver_user_id`. Right now the audit DB returns 418 workflow names that are built from titles.
- Plain-language: titles of tickets that went for approval (for example "Salary advance for ...", "Vendor payment ...") can be read by every employee, together with who the approvers are, without access to the ticket itself.
- Exploit: store user S (role `user`): `clientForToken(S.accessToken).from('approval_workflows').select('name')`.
- Prove locally: as above with the `requester` fixture after calling `sendAdHocApproval` on someone else's ticket.
- Fix: do not put the title in the workflow name (use the ticket number or a fixed "Ad-hoc approval"); restrict `workflows_select`/`approval_workflow_steps_select` to admin/manager or to people who can see an approval that uses the workflow; hide ad-hoc workflows (`is_adhoc` flag) from listings.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-07  Separation of duties in approvals (earlier D-030) is closed only on the "decide" step
- Severity: Medium (policy control; needs a dishonest or careless insider).
- Module: `lib/approvals/decision.ts:51-53` (the check), `lib/actions/approvals.ts` (`delegateApproval` 368-478, `addAdHocApprovers` 275-353, `loadValidApprovers` 106-118), `lib/actions/requests.ts` `submitForApproval`.
- Evidence and gaps:
  1. `delegateApproval` has no "own request / sent by me" check, so a manager who raised the ticket (and is blocked from deciding) can hand the step to any colleague of their choice (any active person, role not checked), and can in the same call pick someone who is not a manager at all (`approver_type` becomes `specific_user`).
  2. `submitForApproval` stores no `requested_by` (VA-TKT-05), so a manager or admin who submits somebody else's ticket can then approve it themselves in an "any manager" step: `approval.requested_by === profile.id` is false and `requester_id` is someone else.
  3. `addAdHocApprovers` lets any technician of the group add themselves (or anyone) as extra approver to a pending ad-hoc approval, and "the first decision is final"; the person who added them is not recorded, so only the original sender is blocked.
  4. Approvers in ad-hoc approvals can be any active employee of any role (`loadValidApprovers` checks only active + organisation). Authority is whatever the sender types in.
- Plain-language: the rule "you cannot approve what you raised or sent" works on the Approve button, but the side doors (delegate, add people, the other submit button) let the same person arrange who approves, or approve their own submission.
- Prove locally: manager fixture submits a ticket of `requester` via `submitForApproval` (service with a workflow whose step is `any_manager`), then calls `approveApproval(approvalId, 'ok')` with the same login: succeeds. Agent B adds self through `addAdHocApprovers` on agent A's pending approval, then `approveApproval`.
- Fix: one shared guard used by decide, delegate, add-approvers and submit: caller must not be requester or sender, delegatee/new approver must not be requester or sender, and (policy decision) must be a manager/specific-role; always record `requested_by` and `added_by`.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-08  New tickets accept any keys in `form_data`, including technician-only fields; this also defeats the "technician must fill this before changing status" gate
- Severity: Medium.
- Module: `lib/requests/create-request-core.ts:272, 373-377, 384-392, 486-487`, `lib/requests/status-change.ts:199-224`, `lib/sla/resolve.ts:25-60`.
- Evidence: `parsedFormData = { ...rawFormData }` is the client's whole JSON. Validation (`validateRequesterFormCompletion`) only walks fields the requester may see/set; it never removes the other keys, so `form_data` is stored as sent. The status-change gate (`status-change.ts:217-218`) tests `isTechnicianMandatory(f) && isFieldValueEmpty(formDataForCheck[f.id])`; a requester who pre-fills a technician-mandatory field id (ids are visible in the form snapshot) makes the gate pass. `resolveFieldSlaTier` reads every select/radio field including technician-only ones, so a pre-filled value also picks the "tightest" field SLA override.
- Plain-language: a requester can type answers into boxes that only the technician is supposed to fill (for example an approval reference or a severity), and the technician is then no longer forced to fill them before moving the ticket. They can also influence the SLA by filling a hidden field.
- Exploit: `createRequest(formData)` with `form_data` = `{ "<tech-only field id>": "OK", ... }` for a service whose form has a mandatory technician-only field.
- Prove locally: service with a section containing `{ id:'f1', type:'text', requester_can_view:false, requester_can_set:false, technician_mandatory... }` (see `lib/forms/sections.ts`), create as requester with `form_data` including `f1`; the technician moves it to `waiting_user` without being asked for `f1`.
- Fix: after validation keep only keys for fields with `requesterCanSet(field)` (and ignore all unknown ids); never read technician-only fields from the requester's data when choosing SLA overrides; same pruning in the `duplicateRequest` copy.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-09  Project, task and task-file rules in the database are weaker than the checks in the screens (cross-group reach for any technician; any user can create tasks)
- Severity: Medium (confidentiality of other groups' projects), Low for the rest.
- Module: RLS `project_members_insert/delete`, `milestones_update`, `tasks_insert`, `task_attachments_insert`, storage `task_attach_storage_insert`.
- Evidence:
  - `project_members_insert`: WITH CHECK only `org_id = current_org_id() AND role IN (agent, manager, admin, platform_owner)`. The earlier fix (D-04) added `can_view_project()` only inside `lib/actions/projects.ts:26-32`. Directly: an agent inserts `{project_id: <any>, user_id: <self>, org_id, role:'member'}` and `projects_select` then lets them read that project (`EXISTS project_members ... user_id = auth.uid()`), its milestones, updates, tasks. The project id only has to be known (it appears in links, searches by managers, notification URLs).
  - `tasks_insert`: WITH CHECK only `org_id` and `created_by = auth.uid()`, no role (the "agent and above" check in `createTask`, `tasks.ts:118`, and the module switch are app-only), no check of `assignee_id`, `team_id`, `parent_task_id`, `request_id`, `project_id`. A `user`-role account can create tasks assigned to anyone, or `task_type='team'` with another group's `team_id` (appears in that group's list) or child tasks of someone else's task. `createSubtask` (`tasks.ts:501-534`) has no role or parent check even in the app.
  - `task_attachments_insert` / `uploadTaskAttachment`: `storage_path` is not tied to the task (the request equivalent was fixed by D-054), and bucket policy `task_attach_storage_insert` lets any signed-in user upload any path in `task-attachments`. Someone who learns another task's file path could link it to their own task and read it through `task_attach_storage_select`. Path needs `<taskId>/<ms>-<name>`, so practical risk is low.
  - `milestones_update` and `project_members_delete` are role-only too but PostgreSQL also applies the `SELECT` rule to an UPDATE/DELETE with a WHERE filter, so those are blocked in practice (note only).
- Plain-language: the project and task screens check "is this your project?", but the database only checks "are you a technician?". A technician in group A can add themselves to group B's project through the API and read it. A normal employee, who has no Tasks menu, can still create tasks and drop them into someone's list or another team's list.
- Prove locally: `clientForToken(agent.accessToken).from('project_members').insert({project_id:<project of other team>, user_id:agent.id, org_id, role:'member'})` succeeds; then `from('projects').select('*').eq('id', ...)` returns the row. `clientForToken(requester.accessToken).from('tasks').insert({title:'x', created_by:requester.id, org_id, assignee_id:agent.id})` succeeds.
- Fix: put `can_view_project(project_id)` (or "owner/manager") into the `project_members_insert/delete` and milestone policies; require agent-tier role plus visible parent/assignee/team in `tasks_insert`; make `task_attachments_insert` require `storage_path LIKE task_id || '/%'` (same trigger pattern as `guard_attachment_client_write`) and restrict `task_attach_storage_insert` to the task's folder.
- Confidence: CONFIRMED-BY-CODE for the project-member insert and the task insert; PLAUSIBLE for the task-file path link (needs a known path).

### VA-TKT-10  "Duplicate request" builds a ticket with the server key and skips the creation checks
- Severity: Low.
- Module: `lib/actions/requests.ts:1147-1186`.
- Evidence: any person who can see a ticket (requester, collaborator, any technician of the group, any manager) can call `duplicateRequest`. It reads the source with the user's rights but inserts with the admin client: no module check, no "service is active" / location-scope check, no mandatory-field validation, no SLA deadlines (so the copy has none and can never breach), no business rules, no team notification, copies `priority` and the whole `form_data` (including technician-only answers) of the original, and sets the caller as requester.
- Plain-language: a quiet back door around the creation rules: a ticket for a service the person is not allowed to use any more (or that is switched off), without deadlines, carrying the old priority.
- Prove locally: deactivate the service with `getAdmin()`, call `duplicateRequest` as `requester`: a new ticket is created (`response_due_at` null).
- Fix: route it through `createRequestCore` with the original service/sub-category (so priority and SLA are recomputed), keep only requester-settable answers.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-11  Assignment rules differ by path: managers (and direct API calls) can assign to anyone, and re-classifying silently un-assigns
- Severity: Low.
- Module: `lib/actions/requests.ts:183-308` (`assignRequest`), `:891-1011` (`updateRequestCategory`).
- Evidence: for manager/admin the target `assigneeId` is not validated at all (any UUID: a plain requester, a deactivated person, a person of another organisation); `requests_select` gives an assignee no access unless they are on the team, so the ticket ends up "assigned" to someone who cannot open it. The rule "a technician cannot unassign a ticket" (`requests.ts:220-223`) is bypassed by `updateRequestCategory`, which sets `assigned_to: null` (line 969) and leaves the status at `assigned`/`in_progress` (a running time entry is not closed). Same data can be set through the REST API (VA-TKT-01).
- Plain-language: a ticket can be given to somebody who cannot see it, and a technician can drop a ticket from their own list by switching its sub-category.
- Fix: validate assignee (active, agent-tier, member of the ticket's team or an explicit "cross-team" permission); on reclassify set the status back to `open`, close the open time entry, notify the previous assignee.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-12  Re-classification is an unconstrained way to move priority and deadlines
- Severity: Low (design weakness; the owner decided priority comes from the sub-category).
- Module: `lib/actions/requests.ts:891-1011`.
- Evidence: any technician of the group (or any manager) can pick any sub-category tagged to the service, on a ticket in any status (also resolved/closed/cancelled): priority becomes that sub-category's tier, and both due dates are recomputed from `created_at` (so an overdue ticket can be made "not late", or a closed ticket changed). There is no reason field, no status guard, no limit on how often. The change is logged (`reclassified` with `priority_from/to`) but not the old/new deadlines.
- Plain-language: "priority comes from the category" still lets a technician pick whichever category gives the longest deadline when a ticket is about to breach.
- Fix: only allow while the ticket is open, require a short reason, keep the old deadline in the log, optionally manager-only after first response; never recompute for finished tickets.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-13  E-mail approval link: code protection rests on an in-memory counter; holders of the link can spam the approver and lock them out
- Severity: Low.
- Module: `lib/actions/approvalEmail.ts:50-104`, `lib/approvals/email-code.ts:24-42`, `lib/rate-limit.ts`.
- Evidence and analysis (this flow is otherwise well built, see section 2):
  - The 5-try limit in `consumeApprovalCode` reads `attempts`, compares, then increments with `.eq('attempts', row.attempts)`. Parallel requests all read the same value, so one wave of N guesses is not stopped by the database counter. What really stops brute force is the per-approval limit `approval-verify:` (8 per 10 minutes) which is process memory (reset by a restart, not shared between instances) and, for the per-address limit, only exists when `TRUSTED_PROXY_HOPS` is set.
  - Order of magnitude: 8 guesses per 10-minute window, a new code every window (3 requests per 10 minutes) => about 8 in a million per window, about 0.8% over the 7-day life of one link, and the approver receives dozens of code e-mails. Not practical, but a person holding a forwarded link can make the real approver's attempts fail ("Too many wrong tries") because the key is the same for both.
  - `requestApprovalCode` is unauthenticated: anyone with the link can trigger an e-mail to the approver (3 per 10 min).
  - `verifyApprovalCode` does not re-check link expiry / approval state (harmless: `decideByEmail` re-checks through `identify()`).
- Fix: increment `attempts` atomically in SQL (`update ... set attempts = attempts + 1 where id = ... and attempts < 5 returning attempts`) before comparing; keep the limiter in the database or a shared store; raise code length to 8 digits or bind the code also to the request IP/user-agent; count per code, not per approval, for the lock-out.
- Prove locally: send 20 parallel `verifyApprovalCode(token, 'xxxxxx')` calls: more than 5 are evaluated against the same code row before it locks; the 9th in a window is refused by the limiter.
- Confidence: CONFIRMED-BY-CODE for the counter race; PLAUSIBLE for the practical impact (needs the token).

### VA-TKT-14  Approver search lets any signed-in person test e-mail addresses
- Severity: Low.
- Module: `lib/actions/approvals.ts:39-93` (`searchManagersForApproval`).
- Evidence: no role check (a store `user` can call it). With the admin client it matches `q` against names, and, when fewer than 8 name hits, against every e-mail in `auth.users` (first 1000), returning `{id, full_name, role}` of the matching active person. By trying prefixes/guesses ("priya.", "psharma@") a person learns which employee owns which e-mail address. Limit: 20 per minute per user in memory.
- Plain-language: the people directory shows names but not e-mail addresses; this screen function reveals which e-mail belongs to whom.
- Fix: restrict the action to technicians/managers (the only people who can send for approval) and drop the e-mail lookup, or search a name-only column.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-15  Remaining race conditions on status (D-044 follow-ups)
- Severity: Low.
- Module: `requests.ts` `submitForApproval` (1294), `updateRequestCategory` (961), `updateRequestFormData` (1098); `sendAdHocApproval` (`approvals.ts:209`); `decision.ts`.
- Evidence: these updates are not conditioned on the status that was read. `sendAdHocApproval` checks `resolved/closed/cancelled` at read time but writes `pending_approval` without `.eq('status', req.status)`. In `decision.ts` the decision row is written before the "still pending" guard: with an approve and a reject at the same moment both decision rows are stored, the ticket follows the first, and the loser's call returns success (`return {}` at 148 and 311). `approveCore` also resumes the ticket with `status: pre_approval_status ?? 'in_progress'` without checking its current state, so a pending approval on a ticket that a Business Rule has since resolved/cancelled/closed brings it back to life when approved in the portal (the e-mail page refuses closed/cancelled, the portal does not).
- Fix: conditional updates (`.eq('status', ...)`) with a "changed by someone else" error everywhere; write the decision only after the pending-guard succeeds (or in one SQL function); refuse to resume unless the ticket is still `pending_approval`.
- Confidence: CONFIRMED-BY-CODE (logic); race itself PLAUSIBLE (needs two parallel calls).

### VA-TKT-16  Raw database error text returned to the browser
- Severity: Low.
- Module: `lib/actions/notifications.ts:25,45,72,96,116`, `profile.ts:48,92`, `push.ts:35,50`, `knowledge-base.ts:54,100,119` (and `admin/business-rules.ts` create/update).
- Evidence: `return { error: error.message }` instead of `sanitizeError(...)` used everywhere else. Can reveal table / column / constraint names.
- Fix: use `sanitizeError`.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-17  History attributes rule-driven changes to the requester or the new assignee
- Severity: Low (audit quality).
- Module: `lib/rules/actions.ts:150-155, 178, 204-209, 328-333, 345-350`.
- Evidence: `logActivity({ actorId: request.requester_id, action: 'priority_changed' | 'status_changed' | 'reclassified' ... })` and, for assignments, `actorId: chosenId`. The rule id/name is in `metadata`, but the actor column names an innocent person. Together with VA-TKT-02 and VA-TKT-01 (due dates unaudited) it weakens traceability.
- Fix: `actorId: null` (system) with the rule in metadata; show "Business rule X" in the history.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-18  Account hygiene in `auth.ts` / `profile.ts`
- Severity: Low.
- Evidence: (a) `resetPassword` (`auth.ts:82-108`) changes the password of any signed-in session without the current password and does not end other sessions, so a stolen session becomes a permanent takeover (`changeOwnPassword` does check the old password). (b) `changeOwnPassword` verifies the old password with `signInWithPassword` outside the app's rate limiter. (c) The sign-in limiter is per e-mail (10/min), so an outsider can keep a named person locked out ("Too many login attempts") with 10 bad tries a minute; `forgotPassword` is limited to 3 an hour per address in the same way. (d) `updateProfile` lets everybody change their own `full_name` to anything (no length cap, not unique): names shown in approvals, comments and notifications can be copied from someone senior. (e) The profile guard trigger lets a person set `must_reset_password` to false (only `true` is blocked), i.e. skip the forced reset after a bulk import (already known as D-011).
- Fix: require the current password (or a recovery session) in `resetPassword`; call `signOut({scope:'others'})` after any password change; key the limiter by account AND address, with a short back-off rather than a hard lock; keep display names but show the e-mail or employee id next to approver/decision names.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-19  `get_home_dashboard()` trusts caller-supplied role flags (information note)
- Severity: Low / informational.
- Evidence: SECURITY DEFINER function executable by `anon` and `authenticated`, parameters `p_is_manager`, `p_is_agent` decide what is counted. With `p_is_manager = true` a non-manager gets the count of pending "any manager" approvals of the whole database (no organisation filter on that one query) and the counts of their own team. Only numbers, no rows.
- Fix: derive the flags from `current_user_role()` inside the function, filter by organisation, revoke `EXECUTE` from `anon`.
- Confidence: CONFIRMED-BY-CODE.

### VA-TKT-20  Requesters can read the full activity log of their ticket (rule names, copied e-mail addresses)
- Severity: Low.
- Evidence: `request_activity_select` lets the requester read every row of their own ticket; metadata contains `rule_name`/`team_id` (business rules), `cc: [{email,name}]` (people copied by a technician, including OEM contacts), approver names, remarks. The screen may hide some of it, the API does not.
- Fix: a view for requesters limited to public event types, or strip `metadata` for non-agent readers.
- Confidence: PLAUSIBLE (depends on which rows exist; policy text is clear).

---

## 2. Controls verified as sound (coverage)

Authentication and identity
- Identity comes from the verified session everywhere: `getCurrentProfile()` (`lib/queries/profiles.ts:9-61`) only believes a proxy header whose HMAC verifies (`lib/auth/verified-user.ts:31-40`) and otherwise calls `auth.getUser()`; `createRequest` calls `auth.getUser()` (`requests.ts:70-73`). No action takes a "who am I" id from the browser. `markNotification*`, `archiveNotification`, `push` actions add `.eq('user_id', profile.id)`.
- Every exported action in scope calls an auth check, except `searchUsersForDelegation`, `fetchSubtasks`, `loadTaskPanelData`, `getApprovalPreview`, `getApprovalForRequestAction`; those are RLS-only, and with no login RLS returns nothing (anon has no matching policy). Worth adding an explicit check because `proxy.ts:84-90` lets `/csat/` and `/approve/` paths through without login (server actions can be posted to those URLs).

Tickets
- Status changes: one function, `applyStatusChange` (`lib/requests/status-change.ts`): role/object check (`isAgent` = manager+ or team agent; `isRequester`), transition matrices (`request-transitions.ts`), mandatory remarks for cancel/waiting/hold/reopen/resolve, resolution note rules (`resolution-note.ts`), compare-and-set on the old status (`.eq('status', currentStatus)` at line 320), requester path uses the admin client but filtered `requester_id = profile.id` (322). Database also enforces the transition list (`guard_request_client_write` + `request_status_transition_allowed`) and `request_identity_unchanged` stops changes of org / requester / service / team through the API (this closes the "service cannot be changed" back door: re-checked).
- `assignRequest`: team membership for technicians, same-team assignee, no un-assign for technicians, compare-and-set on `assigned_to` and `status` (`requests.ts:241-256`).
- Bulk actions (`bulkAssignRequests`, `bulkUpdateStatus`, `bulkAddCollaborators`, `bulkExportRequests`): list cleaned (UUID shape, unique, max 500, `requests.ts:321-331`), then every item goes through the same single-item action with its own checks; concurrency capped at 10; export uses the caller's RLS.
- `updateRequestFormData`: only fields the requester cannot set, validated, merged atomically through an RPC that is NOT executable by `authenticated`/`anon` (verified with `has_function_privilege`).
- `createRequest` "on behalf of": only agent-tier, target must be an active profile of the same organisation (`requests.ts:88-107`); service must be active and in the organisation, location scope re-checked, sub-category validated against the service's tags (`resolve-sub-category`), server computes priority and SLA, SLA written with the admin client (insert guard forbids client SLA).
- Comments: internal flag honoured only for agent-tier (`requests.ts:686`); `comments_select` RLS hides internal notes from requesters; `comments_immutable` (no delete/update) in the database; first-response timestamp only for public agent comments.
- Waiting-user auto-resume is compare-and-set on `waiting_user` and `requester_id` (`requests.ts:814-821`).
- Internal notes in other outputs: PDF / ticket-copy e-mail build the requester's view and drop internal comments (`ticket-pdf-model.ts:152`); "Catch me up" (`ticket-summary.ts`) is built only when `isAgent` (`requests/[id]/page.tsx:500`), quotes only public messages and only counts internal notes; ticket copy only for the comment author within 15 minutes, internal notes refused, recipients limited to CK Desk users / OEM contacts and at most 5 (`ticketCopy.ts:39-75`, `cc-recipients.ts:112-135`).
- Search: runs entirely with the caller's RLS client (`search.ts:43`), so results never exceed list-page visibility.

Approvals
- Decision rules are in one place (`decision.ts`): approver identity per step (parallel: own undecided step; sequential: current step, `any_manager` needs manager+), comment mandatory, requester and sender cannot decide (`:51-53`), decision unique per `(approval_id, step_order)` (database constraint) and the final status update is compare-and-set on `status = 'pending'`; one pending approval per ticket (unique index `approvals_one_pending_per_request`); decisions and approvals cannot be inserted by clients (`approvals_insert_deny`, `approval_decisions_insert_deny`).
- Delegation copies a shared workflow instead of rewriting it (`isolate-workflow.ts`, D-016 re-verified), and the new approver must be active and in the organisation.
- E-mail link: signed per approval and per approver (HMAC-SHA256, constant-time compare, `email-link.ts:24-66`), 7-day expiry, old undated links expire 14 days after the approval was raised, link read against live status (decided / closed / expired / not your turn / own request), code is 6 random digits from `randomInt`, stored only as a keyed hash bound to approval + approver, 10-minute life, single use claimed by `update ... where used_at is null`, new code cancels the previous one, sent only to the approver's own address, proof cookie is signed, HttpOnly, SameSite=Lax, path `/approve`, 30 minutes, bound to approval + approver (`email-link.ts:101-123`); a signed-in person who is not the approver is refused (`approvalEmail.ts:45`); `approval_email_codes` has RLS on with no policy (unreadable by clients).
- CSAT public link: HMAC-signed survey id + expiry, constant-time compare, rating integer 1-5, comment capped at 2000, update is `where submitted_at is null`; reopen goes through `applyStatusChange` as the requester so window, remark and SLA restart apply (`csatPublic.ts`).
- Approval secrets are domain-separated by purpose string, so a CSAT token cannot be reused as an approval token.

Attachments
- Upload: size, extension list, MIME list, magic-byte check, request access check (requester / manager+ / team agent), comment must belong to the same request, storage name built server-side with sanitised file name (`attachments.ts:48-184`); database trigger forces `storage_path` to start with the request's id (`guard_attachment_client_write`); download route re-checks RLS per fetch, verifies the path belongs to the request, sets type from the file extension and `nosniff` (`api/storage/attachment/request/[id]/route.ts`).
- Delete: uploader or team/manager; soft delete with the admin client after the permission check.
- Task attachments: same validation; access check at the action; storage select policy joins to the task.

Other
- Notifications / preferences / push: all scoped to `profile.id`; push endpoint allow-list (`isAcceptablePushEndpoint`); upsert on endpoint cannot take over another person's row (RLS `push_subscriptions_own`).
- Profile: the database trigger `guard_profile_client_update` freezes role, org, active flag, manager, store, department, location, employee id, job title, WhatsApp flag and `must_reset_password=true`; avatar upload checks size, extension and magic bytes and writes under the person's own folder.
- Sign-in: rate limit follows the account, not a header value; deactivated accounts get no session; audit records for login / failure / reset; `safeNextPath` on redirect; forgot-password does not reveal whether an address exists.
- KB actions: role gate + RLS on `kb_articles` (manager+ write).
- Business-rule `set_team`, `assign` check that the team belongs to the ticket's organisation / the assignee is on the ticket's team (`rules/actions.ts:139-147, 339-342`); rules claim before acting (D-042).
- Errors: most actions pass through `sanitizeError` (generic messages).

---

## 3. Areas not assessed, or only partly

- Managers are organisation-wide by design: `requests_select/update`, comments, attachments, approvals ("any manager" steps) all allow every `manager`/`admin`/`platform_owner` to read and change every ticket of the organisation, not only their reports or teams (`profiles.manager_id` only adds visibility for ordinary roles). This is the open design decision D-005 (no confidentiality tier for HR/Finance); I did not treat it as a defect.
- `profiles_select` is organisation-wide for every role (includes employee id, job title, store, manager). Left to the user/profile reviewer.
- `lib/actions/admin/*`, `intake/*`, reports / executive dashboard actions, `lib/email/inbound*` (reply sync identity, D-028), webhooks and cron routes: other reviewers. I only read `executiveDashboard.ts nudgeTicket` + `lib/requests/nudge.ts` (scoped by organisation and report access, cooldown, fine) and `admin/business-rules.ts` (for VA-TKT-02).
- `lib/queries/*` beyond the files named above (reports, workload, analytics, executive) were not reviewed for scope leaks.
- Storage routes other than `request` attachments (task and intake attachment download routes, preview routes) were not read; the bucket policies were (`task-attachments` accepts `image/svg+xml` in the bucket's allowed list although the app refuses SVG; check the task download route sets type and `nosniff`).
- Dynamic behaviour (races, rate-limit timing, real e-mail delivery, PostgREST reachability from a browser through the production reverse proxy) was not exercised: the app was not started, per brief. Findings 01, 03, 04, 05, 06, 07, 08, 09 are code/policy-level and unambiguous; 13 and 15 need a concurrency test to quantify.
- `lib/sla/*` (pure date maths), `lib/auth/safe-next.ts`, `lib/requests/{origin,queue-url,queue-status-filter,oem-message,first-response}.ts`, `lib/approvals/{people,reminders}.ts`: skimmed, no security-relevant code found.
- External recipients: ticket copy to OEM contacts sends the public conversation, approval comments and history to an outside company by design; a data-minimisation decision for the owner, not a bug.
