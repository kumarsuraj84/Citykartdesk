# VAPT source review: administrative, reporting, analytics, export and intake server actions (prefix VA-ADM)

Scope read: `lib/actions/admin/*`, `lib/actions/analytics*.ts`, `executiveDashboard.ts`, `export.ts`, `fixedReportExport.ts`, `reportExport.ts`, `reporting.ts`, `lib/actions/intake/*`, and their helpers (`lib/reporting/*`, `lib/queries/{reporting,executive-dashboard,fixed-reports,profiles}.ts`, `lib/export/*`, `lib/syslog/*`, `lib/rules/*`, `lib/org/*`, `lib/email/{config,auth-mail,sanitize-template,oem-template}.ts`, `lib/admin/target-guard.ts`), plus the admin page gates under `app/(app)/admin/*` and the log intake routes `app/api/system-log/ingest`, `app/api/csp-report`, `app/api/events`.
Method: code read only. RLS/trigger backing checked with read-only `psql` on `supabase_db_ckdesk_audit`. Nothing was started, edited, or contacted. There is no `lib/permissions*` file; the only role-permission code is `lib/actions/admin/permissions.ts` (see section 2/3). The audit database holds a single organisation, so all "cross-organisation" items are marked with that caveat.

Key architectural fact driving most findings: almost every admin/report action uses the **service-role client** (RLS bypassed) and relies on the role list inside the action. Where the DB (RLS) is *wider* than the action (managers have `ALL` on ~25 config tables), the action gate is not the real boundary. Where the DB is *narrower* than the action (global tables are `platform_owner`-only in RLS but writable by manager/admin through the actions), the action re-opens what migration 157 closed.

---

## 1. Candidate vulnerabilities

### VA-ADM-01 — Saved mailbox password can be sent to any server (credential redirection), and the mail server address is not checked at all
- **Severity: Medium.** Needs an admin session (or a stolen/XSS-driven one). Impact: theft of the shared intake mailbox password and internal network probing. This is the same class as the SMTP issue D-026, fixed for outgoing mail but not for the intake mailbox.
- **Module:** Intake channels.
- **Evidence:** `lib/actions/intake/channels.ts:195-262` (`connectChannel`). Lines 222-239: when the password field is blank the code re-reads the saved secret ("`if (!password) { ... const { data: existing } = await admin.rpc('intake_read_credential' ...`  `password = prev.password`") and line 241-250 writes a new secret `{host: creds.host.trim(), port, user, password}` with the **new host**. There is no `mailHostProblem()` call and no "host changed, so re-enter the password" rule (compare `lib/actions/admin/config.ts:127-135`, which has exactly that rule for SMTP). The worker connects to `secret.host` (`api/src/intake/credentials.ts:97-103`, `imap.ts:55,113`) and derives the SMTP host from it (`api/src/intake/smtp.ts:20-22`). `testChannel` (`channels.ts:430-457`) and `pollNow` (`:393`) make the worker connect immediately and return the error text.
- **Plain language:** The screen that edits the intake mailbox lets an admin leave the password empty to "keep the old one". But it also lets the admin type a different mail server. The saved password is then silently sent to whatever server was typed, which can be a machine the admin controls. The password is meant to be write-only, and this turns it into something an admin can read out.
- **Exploit scenario:** Admin (or an attacker using an admin session) opens Intake > Channels > edit the Gmail/IMAP channel, sets Host to an attacker-controlled IMAP listener (or an internal IP such as the DB server and a port), leaves Password empty, saves, then clicks "Test" or "Poll now". The worker logs in to the new host with the saved password. Port probing also works because `testChannel` returns the connection error text.
- **Prove locally:** Create an IMAP channel with fixture credentials through the UI/action, run a tiny local TCP/IMAP listener on the audit PC, call `connectChannel(channelId, {host:'127.0.0.1', port:<listener>, secure:false, user:'x', password:''})`, then `testChannel(channelId)`. Expect the listener to receive `LOGIN x <the saved password>`. (Only on the audit stack; needs the `api/` worker running locally or a unit test calling the same RPC read.)
- **Fix:** In `connectChannel`, if `!creds.password` and host, port or user differ from the saved secret, return an error ("enter the password again"); run `mailHostProblem(host)` (and add a private-address policy) on host; mirror the D-026 logic.
- **Confidence:** CONFIRMED-BY-CODE for the missing check; PLAUSIBLE for the end-to-end capture (needs the worker).

### VA-ADM-02 — Forced password change after bulk import / admin reset is only a page redirect, and the default password is hard-coded (D-011 still open, re-verified)
- **Severity: High (conditional on use of bulk import with the password column blank).** Anyone who knows an imported person's e-mail address can sign in.
- **Module:** User administration.
- **Evidence:** `lib/actions/admin/users.ts:522` `const DEFAULT_BULK_PASSWORD = '<shared default password>'`; `:699` `const password = row.password?.trim() || DEFAULT_BULK_PASSWORD`; `:718` sets `must_reset_password: true`. The only enforcement is `app/(app)/layout.tsx:37-39` (`if (profile.must_reset_password) redirect('/reset-password')`), a layout. Next's own guide in this repo warns that layouts do not re-run on navigation and do not protect Server Actions or other entry points (`node_modules/next/dist/docs/01-app/02-guides/authentication.md:1352,1458`). The DB trigger `guard_profile_client_update` only blocks a client **setting** the flag to true; a signed-in user can clear it themselves (`PATCH profiles` with `must_reset_password=false` is allowed because only `NEW ... IS TRUE` is guarded).
- **Plain language:** Imported accounts all start with the same password, which is written in the source code. The "you must change it" step is only a redirect on the page; someone who does not follow the redirect (calling the API/server actions directly) is never forced.
- **Exploit scenario:** Attacker has a list of staff e-mails (public), tries `<shared default password>` at `/login`, and then uses the session against server actions or PostgREST with the JWT, ignoring the redirect.
- **Prove locally:** Call `bulkCreateUsers([{email:'t1@x.test', full_name:'T', role:'user'}])` as the admin fixture, sign in as `t1@x.test`/`<shared default password>` with the anon client, and call any server action or `from('requests').select()` with that token without visiting `/reset-password`. Expect success.
- **Fix:** Require a per-row random password (or send an invite link instead); enforce `must_reset_password` in `proxy.ts` and in `getCurrentProfile()` consumers (deny actions), and block clients from clearing the flag (extend the trigger to cover FALSE).
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-03 — Global (all-organisation) settings are writable by managers and admins through the service role, undoing the "platform owner only" database rule
- **Severity: Medium.** A manager can change SLA clocks, task and priority lists, e-mail sender name and any setting key for the whole system.
- **Module:** `lib/actions/admin/config.ts`, `task-config.ts`.
- **Evidence:** RLS (psql) on `app_settings`, `business_hours`, `holidays`, `request_priorities`, `retention_policies` has write policy `current_user_role() = 'platform_owner'` only (migration 157, D-006). But the actions use `createAdminClient()` and allow manager:
  - `config.ts:20-33` `updateAppSetting(key, value)` — role list `['admin','manager','platform_owner']` (line 25), **arbitrary `key`**, no allow-list, no value validation (`upsert({ key, value })`, line 32). Keys in use: `email_from_name`, `email_from_address`, `csat_enabled`, `csat_reminder_days`, `auto_close_days`, `retention_system_log_days`, `retention_event_log_days`, the approval-reminder marker.
  - `config.ts:52-71` `updateEmailFromSettings` (manager) — sets the display name on every system e-mail (for SMTP the address is fixed by `resolveSenderAddress`, lib/email/config.ts:74, but the name is free text, so "IT Security Team" is possible).
  - `config.ts:305-318` `updateBusinessHours`, `:325-345` `createHoliday`, `:349-359` `deleteHoliday`, `:458-471` `updateRequestPriority` (incl. `sla_multiplier`): these tables have **no `org_id`** and no `.eq` filter, so one org's manager changes the clock for everyone. `task-config.ts:11-14,19-80,102-160` same for `task_statuses`/`task_priorities`.
  - `config.ts:74-97` `sendTestEmail(to)` (manager): sends mail from the company mailbox to any address, no rate limit, no recipient restriction (spam/phishing relay with a fixed body; low impact alone).
  - `config.ts:491-512` `updateRetentionPolicy` (admin): `retention_days`, `purge_after_days` unvalidated (0 or negative) and no org filter. (The table is not read by any purge job in the code I read, so this is today harmless; flagged because it is a footgun.)
  - Audit: DB triggers on these tables write `system_log` rows with the actor from the `x-actor-id` header, so changes are traceable; they are not blocked.
- **Plain language:** The database says "only the platform owner may change the company-wide working hours, holidays, priorities and settings". The app screens, however, let any manager or admin change them, because the screen talks to the database with a master key. A manager could, for example, mark every day as a holiday so no ticket ever looks late, or rename the sender of all system e-mails.
- **Exploit scenario:** Manager calls `createHoliday({name:'x', date:'2026-10-15', is_recurring:true})` many times, or `updateBusinessHours(d,{is_active:false,...})` for all days; SLA due dates (business-hours aware) stretch and breaches disappear from reports. Or `updateAppSetting('email_from_name','Citykart IT Security – verify your password')`.
- **Prove locally:** Sign in as a manager fixture, call `updateAppSetting('email_from_name','TEST')` via a server-action harness or unit test; read back with the admin client; confirm the same `upsert` through PostgREST with the manager JWT is rejected (RLS), proving the action is the bypass.
- **Fix:** Decide the intended owner. If platform-owner-only, gate these actions to `platform_owner`; if manager/admin should edit, add `org_id` to the tables (or make them per-organisation) and restrict `updateAppSetting` to an explicit key allow-list with value validation; rate-limit `sendTestEmail` and restrict it to admins and the caller's own address.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-04 — Report Builder shows technician-only form fields to the requester
- **Severity: Medium.** Data meant to be hidden from the requester becomes visible and exportable.
- **Module:** Reporting (`lib/queries/reporting.ts`, `lib/actions/reporting.ts`, `reportExport.ts`).
- **Evidence:** `lib/queries/reporting.ts:200-205` scope `own` returns the requester's tickets; `:324` `row['form:'+f.id] = reportCellValue(r.form_data?.[f.id])` and `:190-196`/`getOrgRequestFormFields` build columns from **all** services' fields with no `requester_can_view === false` filter. The ticket pages hide these fields (`lib/forms/sections.ts:67-93`, "Drops requester_can_view===false fields"). `app/(app)/reports/pivot/page.tsx:14-20` and the sidebar (`components/layout/Sidebar.tsx:86`) expose Report Builder to every role with the Requests module. `exportReportXlsx` (`reportExport.ts:46`) exports the same rows.
- **Plain language:** Admins can mark some form fields as "technician only" so the requester never sees them (for example internal cost codes or notes). The ticket screen respects that, but the Report Builder does not: a requester can add those columns to a report for their own tickets and download them.
- **Exploit scenario:** Requester opens Report Builder, entity Requests, picks the "Service: Internal remark" column, exports to Excel.
- **Prove locally:** Create a service with a field `requester_can_view:false`, create a ticket by `requester` fixture with a value in it, call `getReportData('requests')` as that requester (or `exportReportXlsx`) and look for `form:<fieldId>` in rows.
- **Fix:** In `fetchRequestRows`/`getReportFieldsForEntity`, when scope is `own` (and `reports`), drop fields where `requester_can_view === false`; also exclude `description`/comment counts of internal notes (`comment_count` currently counts internal notes too, `reporting.ts:~290`).
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-05 — A manager can re-wire people and identities well beyond "edit my team": no target guard, no audit on phone numbers
- **Severity: Medium.** Insider impersonation and visibility changes, with weak traceability for phone numbers.
- **Module:** `lib/actions/admin/users.ts`.
- **Evidence:** Manager is allowed on `updateUserProfile` (`:146`), `addMobileNumber` (`:239`), `removeMobileNumber` (`:278`), `setUserTeams` (`:298`). None calls `targetGuardError` (that guard exists only for role/active/password, `lib/admin/target-guard.ts`). So a manager can:
  1. `addMobileNumber(adminUserId, <own phone>)` — the WhatsApp webhook resolves the sender by `profile_mobile_numbers` (`lib/users/resolveWhatsAppUser.ts`) and raises tickets **as that user** (`lib/whatsapp/webhook-handler.ts:167-181`). `profile_mobile_numbers` has no audit trigger (psql list of `trg_system_log_audit` tables) and the action writes no `recordAudit`, so the change leaves no record.
  2. `updateUserProfile(anyUserId, {manager_id: someUser})` — `current_user_subordinate_ids()` (SQL) grants **the named manager read access** to the subordinate's tickets via RLS (`requests_select`, `comments_select`) and the Dashboard "team view" (`executive-dashboard.ts:155-166`). A manager can therefore give any plain `user` account visibility of the tickets raised by or assigned to any chosen person (even an admin). No audit row except the generic profile trigger.
  3. `updateUserProfile(adminUserId, {full_name, store_id, ...})` — rename or re-store admin and platform_owner accounts (and the sign-in copy of the name, `:215-223`).
  4. `setUserTeams(self_or_other, [any teams])` — adds anyone, including themselves, to any technician group; membership drives the fixed reports, agent visibility and update rights (`requests_update`), and is the basis of the report scope for managers (`resolveReportAccess`, `lib/reporting/access.ts:41-56`). The comment in `lib/actions/admin/teams.ts` makes `addTeamMember` admin-only, but `setUserTeams` does the same job for managers.
- **Plain language:** Managers are allowed to edit people's details. The code does not stop them from editing an administrator, from attaching their own mobile number to someone else's account (so WhatsApp messages from the manager's phone are treated as coming from that person), from making a chosen person someone's "line manager" (which opens that person's tickets to them), or from adding themselves to any technician group. The phone-number change is not recorded anywhere.
- **Exploit scenario:** Manager A calls `addMobileNumber(<CEO profile id>, '98xxxxxx10')` then sends a WhatsApp message from that phone to the support number; a ticket appears as raised by the CEO. Or sets `manager_id` of a finance user to a colluding plain user.
- **Prove locally:** With manager fixture: call each action against an admin fixture's id and confirm success; query `system_log` for `profile_mobile_numbers.*` (expect none) and `profiles.update` (present, but nothing for the phone).
- **Fix:** Apply `targetGuardError`-style rule (only platform_owner may touch admin/platform_owner accounts) to all four actions; restrict phone and reporting-line edits to admin (or add an approval step); add `recordAudit` to phone/team changes and a `trg_system_log_audit` on `profile_mobile_numbers`.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-06 — A manager can edit approval workflows, including naming themselves as approver of approvals already running
- **Severity: Medium (separation of duties).**
- **Module:** `lib/actions/admin/workflows.ts` (manager allowed, `:14-21`); approvals engine `lib/actions/approvals.ts`.
- **Evidence:** `workflows.ts:110-178` `upsertWorkflowStep` lets a manager change `approver_user_id` of an existing step (`input.id`) or add a step. The approvals engine reads the **live** step: `lib/actions/approvals.ts:397-417` (`.from('approval_workflow_steps')... .eq('workflow_id', approval.workflow_id).eq('step_order', approval.current_step)`). D-016 stopped *delegation* from rewriting shared workflows, but the admin editor can still do it deliberately. RLS `approval_workflow_steps_admin` also lets managers write directly.
- **Plain language:** The people who must approve a request are defined in a workflow. A manager may change that list. Pending approvals look up the approver in the live list, so a manager can put their own name on the step that is currently waiting and then approve it themselves.
- **Exploit scenario:** Manager opens Admin > Approvals, edits step 1 of the "Purchase" workflow to "specific user = me", then approves pending purchase requests.
- **Prove locally:** Seed a pending approval on a service workflow; as manager call `upsertWorkflowStep({id: stepId, workflowId, stepOrder:1, approverType:'specific_user', approverUserId: manager.id})`; then run the approve action as the manager. Expect success.
- **Fix:** Make workflow and step edits admin-only (and never alter steps of workflows that have pending approvals; copy-on-write like `isolateStepForDelegation`); audit step changes.
- **Confidence:** CONFIRMED-BY-CODE (live lookup); the business decision whether managers should edit workflows is the open point.

### VA-ADM-07 — OEM e-mail template preview renders unsanitised HTML (stored XSS path from manager to administrator/platform owner)
- **Severity: Medium.** Needs a manager account and an admin/owner who opens the preview tab; result is script running in a privileged session.
- **Module:** `components/admin/RichEmailEditor.tsx`, `lib/actions/admin/oems.ts`.
- **Evidence:** The save action sanitises (`oems.ts:29-34` `cleanBodyTemplate` -> `sanitizeTemplateHtml`), but RLS `oems_admin` gives managers `ALL` on `oems`, so a manager can write `email_body_template` straight through PostgREST with their own token and skip the action. The editor then does `previewHtml = renderHtmlEmail(toEditorHtml(value) ...)` (`RichEmailEditor.tsx:140`) and `dangerouslySetInnerHTML={{ __html: previewHtml }}` (`:187`). `renderHtmlEmail` (lib/email/oem-template.ts:100-103) only escapes **placeholder values**; it does not sanitise the template. The comment in `sanitize-template.ts` says it is sanitised "on save AND again at send time", but not at preview.
- **Plain language:** The e-mail template screen cleans dangerous code when saved through the normal button. But a manager can write straight to the database table (the database allows it), skipping the cleaning. When an admin then clicks "Preview", the stored dangerous code runs in the admin's browser.
- **Exploit scenario:** Manager: `PATCH /rest/v1/oems?id=eq.<oem>` with `{"email_body_template":"<p><img src=x onerror=fetch('/…server action…')>"}` using their JWT. Admin or platform owner opens Admin > Org > OEM edit > Preview. Script can call any server action as that admin (set passwords of non-privileged users; if a platform owner opens it, everything).
- **Prove locally:** As the manager fixture update the row via `clientForToken(manager.accessToken).from('oems').update(...)`, then render `previewHtml` (call `renderHtmlEmail` on the stored value in a unit test) and check the `onerror` attribute survives.
- **Fix:** Run `sanitizeTemplateHtml` on the value before putting it into `dangerouslySetInnerHTML` (and inside `renderHtmlEmail`'s preview use); better, add a DB check/trigger or make `oems` write admin-only. Also consider a `Content-Security-Policy` without `unsafe-inline` for script.
- **Confidence:** PLAUSIBLE (code path clear; confirm the CSP in `lib/http/csp.ts` does not already block inline handlers).

### VA-ADM-08 — Unauthenticated log flooding: the CSP report endpoint's rate limit uses the client-supplied first X-Forwarded-For value
- **Severity: Medium (availability and log integrity, unauthenticated).**
- **Module:** `app/api/csp-report/route.ts`, `lib/syslog/*`.
- **Evidence:** `route.ts:16` `const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'`; `rateLimit('csp-report:'+ip, 30, 60_000)`. The leftmost XFF value is attacker-controlled (D-017 fixed the rest of the app with `getClientIp()`/`TRUSTED_PROXY_HOPS`, this route was missed). Route is public in `proxy.ts:80`. Each accepted request writes a `system_log` event; the flood key `csp|directive|blocked|page` is built from attacker text, so changing it defeats de-duplication (`lib/syslog/writer.ts` flood limit is per key).
- **Plain language:** Anyone on the Internet can post fake "browser security" reports. A limit of 30 per minute is meant to stop abuse, but it is counted per "address" that the sender can invent, so the limit does nothing. This can fill the System Log table and bury real security events.
- **Exploit scenario:** Loop of `curl -H "X-Forwarded-For: 1.2.3.$i" -d '{"csp-report":{"violated-directive":"x$i","blocked-uri":"https://e/$i","document-uri":"https://a/$i"}}' /api/csp-report`.
- **Prove locally:** Against the audit app (port 3310 when running, not started by me) send 500 such requests and count `system_log` rows with `action='security.csp_violation'`; expect all accepted, then repeat with a fixed IP and see the 30/min cap.
- **Fix:** Use `getClientIp()` (trusted hops) for the key, add a global cap on rows per minute for this route, and drop reports whose `document-uri` host is not the app's own.
- **Confidence:** CONFIRMED-BY-CODE for the key; PLAUSIBLE for effect (depends on proxy chain).

### VA-ADM-09 — Intake review lets the reviewer set the ticket priority by hand, overriding the sub-category (new "no manual priority" rule bypassed)
- **Severity: Low-Medium (policy bypass by any agent).**
- **Module:** `lib/actions/intake/work.ts`.
- **Evidence:** `work.ts:261` `priorityOverride: mapPriorityToRequest(decision.final_priority)`; `lib/requests/create-request-core.ts:438` `const priority = (priorityOverride ?? subCategoryResolution.slaPriority ?? service.default_priority)`. `decision` is a client-supplied object (`approveAndCreate(reviewId, decision, payload)`), so any agent can choose "urgent". The recent local change says nobody, not even admin, may set priority by hand; this path still does, and SLA due dates are computed from it.
- **Plain language:** The product now says priority must come from the category and its SLA. When a ticket is made from an e-mail, the person doing the review can still pick any priority, and the deadline follows it.
- **Exploit scenario:** Agent calls `approveAndCreate(reviewId, {…, final_priority:'urgent'}, {type:'request', …})` for a low-importance mail.
- **Prove locally:** As `agent` fixture with an intake review, call the action and compare `requests.priority` with the sub-category `sla_priority`.
- **Fix:** Pass `priorityOverride` only when the policy allows (or drop it and keep the reviewer's choice as a note); same for the `additional_form_data` merge (arbitrary keys go into `form_data`, `work.ts:~190`).
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-10 — Intake rule regular expressions are admin-authored and run on attacker-controlled mail text (ReDoS)
- **Severity: Low-Medium.** Needs an admin to save a risky pattern (or a compromised admin); trigger is any external sender.
- **Module:** `lib/actions/intake/rules.ts:47-49`; evaluated in `api/src/intake/classify/rule-classifier.ts:42-44` (`new RegExp(rule.match.regex, 'i').test(haystack)`).
- **Evidence:** only `new RegExp(pattern)` compile check; no length limit, no backtracking guard, no timeout.
- **Plain language:** An admin can enter a "pattern" that, with a crafted e-mail, makes the intake worker spin for minutes. Anyone who can send an e-mail to the intake mailbox supplies the crafted text.
- **Prove locally:** Create rule with `(a+)+$`, feed a 40-character `aaaa…b` message to the classifier unit (`api/src/intake/classify/rule-classifier.ts`) and time it.
- **Fix:** Reject patterns with nested quantifiers, cap length (e.g. 200), run with a safe regex engine (`re2`) or a time limit.
- **Confidence:** CONFIRMED-BY-CODE (the worker may not run in production: UNKNOWN).

### VA-ADM-11 — Any signed-in user can add internal notes to intake messages
- **Severity: Low.**
- **Module:** `lib/actions/intake/communication.ts:62-85` `addNote`.
- **Evidence:** no `canReview` check (compare `deleteNote` line 87-89); RLS `intake_notes_org_write` (INSERT, `with_check org_id = current_org_id()`) has **no role condition** and does not tie `message_id` to the org. Note rows are shown to agents as internal information.
- **Plain language:** A requester can write "internal" notes on staff e-mail threads, which technicians then read as if they were colleagues' notes.
- **Prove locally:** `requester` fixture calls `addNote(<a message id>, 'x')` (with Intake module enabled), expect success; then `agent` lists notes.
- **Fix:** `if (!canReview(profile.role)) return Unauthorized` in the action and add the role to the policy (`current_user_role() IN ('agent','manager','admin','platform_owner')` plus a `message_id` org check).
- **Confidence:** CONFIRMED-BY-CODE (policy text from `pg_policies`).

### VA-ADM-12 — Cross-organisation identifiers are accepted in several admin writes (matters only if a second organisation ever exists)
- **Severity: Low (single organisation today; becomes Medium with multi-tenant use).**
- **Evidence (group):** `lib/actions/admin/sla-matrix.ts:34-75` and SQL `upsert_field_sla_override` (psql): `ON CONFLICT (service_id, field_id, option_value) DO UPDATE` with no org check, so a manager of org A who knows org B's service UUID changes B's SLA override (function is `SECURITY DEFINER`, execute only for `service_role`, but the action passes the caller's `service_id` unchecked). `lib/actions/admin/org.ts:29-80` (`parent_id`, `head_user_id` unchecked), `teams.ts:140-166` `addTeamMember` (`userId` not checked in org), `intake/reviews.ts:52-67` `assignReviewer` (`userId`), `services.ts` `sub_category_tag_ids`/`location_tag_ids` (RPC `retag_service_*` is `SECURITY INVOKER`; policy `service_sub_category_tags_admin` checks only the service's org).
- **Fix:** Use `assertRefsInOrg` (`orgScopeGuard.ts`) for every referenced id; in the SQL function add `WHERE EXISTS (select 1 from services where id=p_service_id and org_id=p_org_id)`.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-13 — Some admin pages rely on the layout guard only (and the manager gate is wider than the page comments suggest)
- **Severity: Low.**
- **Evidence:** `app/(app)/admin/layout.tsx:5-8` allows admin, manager, platform_owner. `app/(app)/admin/teams/page.tsx` and `app/(app)/admin/knowledge-base/page.tsx` contain **no** role check of their own. The Next guide in this repo says layout-only checks do not protect nested routes or Server Actions (`authentication.md:1352-1358,1458`). Reads there go through the user client (RLS), so a requester who bypasses the layout sees only what RLS gives (teams are org-readable; unpublished KB rows are manager+), hence Low. All other admin pages have their own check (listed in section 2).
- **Fix:** Add the explicit role check to those two pages; keep the layout as UX only.
- **Confidence:** PLAUSIBLE (needs a crafted RSC request to confirm the layout is skipped).

### VA-ADM-14 — Mail-server address check can be bypassed (`127.1`, `0177.0.0.1`) and allows all private ranges; error text is returned
- **Severity: Low (admin only; port-probe oracle).**
- **Evidence:** `lib/validation/mail-host.ts:10-26`: the numeric test needs four decimal octets; `127.1`, `0177.0.0.1`, `0x7f.1`, or a DNS name that resolves to loopback (`*.nip.io`) pass. Used by `saveMailboxSettings` (`config.ts:112`) only; `connectChannel` (VA-ADM-01) has none. `sendTestEmail` returns the SMTP error text to the browser (`config.ts:93-96`).
- **Fix:** Resolve the name and reject loopback/link-local/metadata results at connect time (or pin an allow-list of ports 25/465/587/993/143), and return a generic error.
- **Confidence:** PLAUSIBLE (name-resolution behaviour needs a dynamic check).

### VA-ADM-15 — Several data exports are not audited, and heavy report loads have no per-user limit
- **Severity: Low.**
- **Evidence:** `lib/actions/export.ts:11-18` states "Every export of organization data is an audit event", yet `exportReportXlsx` (`reportExport.ts:46`, up to 20,000 tickets with all form fields), `exportFixedReportXlsx` (`fixedReportExport.ts:9`), `exportEventsCsv` (`events.ts:81`) and `bulkExportRequests` do not call `recordAudit`. `exportReportXlsx` always reads fresh (`fetchReportData(..., { fresh: true })`) and `loadDrillData` (`analytics-drill.ts:20`) too, for any signed-in role, with no rate limit; `config.pivot` from the browser is unvalidated in `computePivot`.
- **Fix:** Audit every export the same way; add `rateLimit` per user; validate the pivot config (field keys, number of dimensions).
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-16 — `adminSendPasswordReset` and `inviteUser` accept any e-mail address, not only people of the organisation
- **Severity: Low.**
- **Evidence:** `users.ts:769-790` sends a recovery link to whatever address is typed (rate limit 10/min per admin); no check that the address belongs to this organisation, and `emailPasswordResetLink` returns success even for unknown addresses. `inviteUser` creates accounts at any external address (by design). Link goes to the owner of the mailbox, so no takeover.
- **Fix:** Look the address up in the caller's organisation first. Keep the rate limit.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-17 — Allow-list of "organisation" e-mail addresses includes OEM contacts that managers can set to any outside address
- **Severity: Low.**
- **Evidence:** `lib/requests/cc-recipients.ts` (`loadCcBook`) treats every `oems.emails` entry as an organisation address; `checkReportRecipients` (`lib/reporting/report-recipients.ts:11-24`) and ticket-comment CC use it. `oems.ts:76-91 updateOem` (manager allowed, no domain check) and RLS `oems_admin` accept any address. So the D-012 control "reports only go to your own addresses" can be bypassed by an admin who adds the outside address as an "OEM contact" first; OEM auto-routing e-mails (every AC ticket with requester name/phone/store address) go to those addresses too (`runOemAutoRouting`).
- **Fix:** Restrict OEM addresses to an approved domain list or require admin approval for new addresses; show "external" in the report-recipient picker.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-ADM-18 — Store Master upload parses a 5 MB spreadsheet in the web process (decompression/size DoS)
- **Severity: Low (manager-level).**
- **Evidence:** `lib/stores/master-file.ts:27-44` (`MAX_STORE_FILE_BYTES` = 5 MB compressed; `wb.xlsx.load(bytes)` then loops `sheet.columnCount` for every row). A small zip can expand very large or declare a huge column count.
- **Fix:** Check uncompressed size/rows before loading (e.g. stream parse with limits) and cap `columnCount`.
- **Confidence:** PLAUSIBLE.

---

## 2. Controls verified as sound (coverage list)

Authentication and identity
- `lib/auth/verified-user.ts:20-40`: forwarded user id is HMAC-signed with a server-only key, falls back to `auth.getUser()` when unsigned; used by `getCurrentProfile()` (`lib/queries/profiles.ts:~12-30`). No action trusts a user id from the client; every action reads `getCurrentProfile()` first.

Privilege escalation
- Role assignment: `users.ts:64-69` `assertCanAssignRole` (only platform_owner may grant admin/platform_owner) used by `updateUserRole`, `inviteUser`, `bulkCreateUsers`; `lib/admin/target-guard.ts` blocks admin acting on admin/platform_owner, self role change and self deactivation (`updateUserRole`, `toggleUserActive`, `adminSetPassword`); `updateUserEmail` has the same rule (`:820`).
- DB backstop: trigger `guard_profile_client_update` (psql) rejects client-side changes of `role`, `org_id`, `is_active`, `manager_id`, `store_id`, and others for `authenticated`/`anon`; `profiles_update_own` therefore cannot be used to self-promote (checked with `pg_get_functiondef`).
- Deactivation really bans at the auth service (`users.ts:107-120`, D-010). Bulk reset is limited to user/agent/manager of the caller's org and not self (`resetPasswordsBatch`, `:983-1020`).
- Cross-organisation: users, teams, stores, OEMs, workflows, scheduled reports, business rules, channels, intake rules, DeskTime all carry `.eq('org_id', profile.org_id)` or `assertRefsInOrg` / `assertRuleActionsInOrg` (`orgScopeGuard.ts`) for referenced ids (D-031 re-verified in code). Intake `createRequestCore` re-validates service, team and sub-category against `orgId` (`create-request-core.ts:287,455-463`).
- Mass assignment: update actions use explicit field lists or `pickFields` (`config.ts:420-428,462-466`, `task-config.ts`, `reports.ts:121-140`, D-013 re-verified).

Secrets
- Mailbox password: stored only through service-role RPC into Vault; `email_smtp_settings` has no `anon`/`authenticated` grants (psql); the admin page gets `host, port, username, hasPassword` only (`lib/email/mailbox.ts:68-78`); changing host/port/user without re-entering the password is refused (`config.ts:127-135`). IMAP/WhatsApp secrets also write-only (`getChannelConnectionInfo`, `getWhatsAppChannelInfo` never return them). Audit metadata excludes passwords (`config.ts:150`).
- System Log redaction: `lib/syslog/shape.ts:50-75` (JWTs, Bearer, key/value secrets, e-mails, phone numbers, long hex/opaque strings, secret-named keys) applied to messages, stacks, details; query strings stripped from failed-call URLs (`process.ts:42-48`); the "copy for Claude" bundle redacts again (`bundle.ts`).

System Log
- Read: RLS `system_log_select` admin/platform_owner of the same org only (psql); `authenticated` has `SELECT` only, no insert/update/delete grant. `system-log.ts` `requireAdmin` on every function; filters are allow-listed and `q` has `% , ( ) * \` stripped (`:84,100`); export capped at 50,000 and recorded (`:177-186`); hash chain verifier is service-side. Browser/cron ingest cannot write audit rows (`app/api/system-log/ingest/route.ts:35-60`), identity and org forced to null, secret compared in constant time.
- Retention: only `updateLogRetention` (admin) with min/max (`retention.ts:7-9,25-30`); nothing deletes rows from the browser side.

CSV / spreadsheet
- Every CSV goes through `lib/export/csv.ts:2-29` (leading `= + - @ TAB CR` neutralised; quoting) — users, requests, tasks, projects, stores, approvals, system log, events, categories, audit log, bulk request export (`AuditLogClient.tsx:196`, D-056). XLSX writers (`reportExport.ts`, `report-table-xlsx.ts`) write strings as typed string cells, no formulas, so a leading `=` is not evaluated.
- Export volume: 10,000-row cap with an error instead of silent truncation (`lib/export/reports.ts:15,86-92`); approvals read in pages (D-021).

Reports and analytics scope
- `authorizeReportAccess`/`resolveReportAccess` (`lib/reporting/access.ts`) decides own/agent/team/all per role; every report action calls it (`reporting.ts`, `reportExport.ts`) and `fetchRequestRows` applies the scope on the server with an explicit guard for "team with no teams" (`reporting.ts:196-198`). Non-request entities are manager/admin/owner only (`access.ts:41-46`).
- `getFilteredRequests` (`lib/actions/analytics.ts:60-190`) re-derives scope from the session; caller filters (`teamId`, `assignedTo`, `groupIds`, `store`) can only narrow; `narrowScopeToGroups` validates UUIDs and intersects with allowed groups (`lib/analytics/group-filter.ts`). Task drawer mirrors `tasks_select`.
- Executive dashboard: `loadExecutiveData` limits "people" picks to the viewer's direct reports (`executive-dashboard.ts:155-161`, `within()`); `getExecutiveTicketDetail` and `nudgeTicket` re-apply `applyScope` before returning/acting (`executiveDashboard.ts:92-94,166-169`). "team dashboard for user with direct reports" uses `profiles.manager_id` (note VA-ADM-05 item 2 for how that field can be changed).
- Fixed reports: `loadFixedReport` limits groups to the viewer's memberships (`fixed-reports.ts:78-105`) and ignores picks outside them (`:92`); role must be agent+.
- Scheduled reports: create/update/delete/send are admin-only; recipients must be organisation addresses and are re-checked at send time (`reports.ts:24-28,73-92,156-196`).
- Saved reports: RLS limits update/delete to the creator or manager+, and the org id is immutable (psql).

Business rules / integrations
- Business rules contain no code, URLs or webhooks: fixed action types only (`lib/rules/actions.ts:18-40`); conditions use `includes`/equality, no regex, so no ReDoS there; notify e-mail body is escaped (`actions.ts:~395`); assign/set_team re-checked (team membership and org).
- OEM templates: server sanitisation on save (`oems.ts:29-34`), strict allow-list (`sanitize-template.ts`); plain text is escaped by `plainToHtml`.
- WhatsApp: no URL or version taken from admin input except `config.api_version` (via `resolveGraphApiVersion`; host is fixed to graph.facebook.com).
- Intake actions enforce `canReview`/`canManageChannels` and org scope on read before using the service client (`work.ts:103-112`, `communication.ts:99-110`).

Admin pages with their own role check (in addition to the layout): approvals, business-rules, categories (admin only), desktime, field-library, form-templates, logs (`resolveLogsView`: managers see ticket/task activity only), master-data, monitoring (admin only), org, reports, request-config, roles, runbooks, services (admin only), settings, sla-policies, task-config, users.

Defence-in-depth, not a finding
- `permission_overrides` / `custom_roles` (`lib/actions/admin/permissions.ts`): admin-only, RLS-backed, and **not enforced anywhere** (`PermissionMatrixClient.tsx:8-20`, psql: no function reads `permission_overrides`). The screen is disabled in the UI, but the three actions stay callable; harmless today. Do not rely on it as a control.
- `exportTasks`/`exportProjects` scope non-staff by `team_id IN (my teams)` with the service role, without the RLS `task_type='team'` clause (`lib/export/reports.ts:176-177`). Personal tasks are created without `team_id` in the normal app (`tasks.ts:136,518`), so no leak is reachable through the UI; a direct `createTask({taskType:'personal', teamId})` call would create one.
- `app_settings` is readable by all signed-in users (`app_settings_read` = true); it currently holds no secrets.

---

## 3. Not assessed, and why
- `api/` Express intake worker (IMAP/Gmail/Outlook poller, classifier, SMTP send): outside the listed scope; whether it runs in production is unknown. VA-ADM-01 and VA-ADM-10 depend on it.
- Gmail/Outlook OAuth routes, webhooks, `lib/intake/*` (other reviewers).
- Business-rule and alert **cron routes** (`/api/business-rules/run`, `/api/alerts/run`), scheduled-report sender, retention/archive jobs, and what the nightly System Log archiver does (not in the listed files).
- `lib/actions/requests.ts` (`bulkExportRequests`, priority/service lock rules), approvals actions, KB article actions (`lib/actions/kb*`; the KB editor's rendering path for article bodies was not read), CSAT/approval e-mail link flows: other reviewers' scope. Stored-XSS check was therefore limited to sinks found by search: the only `dangerouslySetInnerHTML` uses are the theme-init script (`app/layout.tsx:49`, constant) and the OEM preview (VA-ADM-07). Field labels, service names, report names and notification text are rendered by React and escaped.
- Real mail delivery, DNS behaviour, TLS, and the CSP header value (`lib/http/csp.ts` not read) — needed to settle VA-ADM-07/14 impact.
- `lib/queries/analytics.ts`, `workload.ts`, `projectAnalytics.ts` internals were read only for how they receive `scope`; the per-query filters inside were not line-audited.
- No dynamic test was run (rules: do not start the app).
