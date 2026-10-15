# 05 — API and Workflow Security (VAPT of Citykart Desk, CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This file covers how a ticket lives and dies in CKDesk (create, assign, change status, approve, meet or miss the deadline, resolve, rate), the Business Rules and reports built on top, the System Log, and the web-address ("API") findings that are not about files or e-mail. Files and e-mail are in file 06; sign-in and database rules are in file 04.

Every finding uses the same plain-language template. Statuses come only from `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`. "Fixed in LOCAL" means changed in the working copy and tested on the disposable stack; it is **not deployed**. Production runs build `20261015-145217` (main `717e5c6`) and contains none of these fixes. Nothing here was tested on production.

Evidence classes: **A** verified LOCAL technical evidence (named tests T10, T11, T12, TU, TB, HTTP probe H; see file 03); **B** repository evidence (source read); **E** not verified.

### The architecture point that explains most findings

The browser holds the **same login** as the server actions, plus the public key. A person can therefore open the browser console and send, straight to the database service (`/rest/v1`), the same kind of request the screens send. A rule that exists **only in a server action or a page** is a **screen rule**: it stops the honest user from clicking, but not a determined one. The "nobody may change priority" rule was exactly this. Where a rule matters, the database has to repeat it (a trigger, a policy, or a column right). In the table below, a control marked "screen only" is one the database does not repeat.

---

## 1. Ticket lifecycle: where each control lives

| Stage | Rule | Enforced in the screen/action | Enforced in the database | Assessment |
|---|---|---|---|---|
| Create | mandatory form, priority from sub-category, deadlines computed, routing | yes: `lib/requests/create-request-core.ts` (server computes priority and SLA, writes with the service key) | **after M164:** a signed-in user has no direct insert; before: free insert with any priority/service/team | Fixed in LOCAL (VA-DB-02) |
| Create | requester may fill only requester-settable fields | yes (after LOCAL fix) | no | Fixed in code (VA-TKT-08) |
| Assign | technician only within own group; no un-assign | yes: `assignRequest` (compare-and-set) | `assigned_to` is free for a technician/manager through the data API | Partially Fixed (VA-TKT-01 rest) |
| Status change | allowed moves, mandatory remarks, resolution note rules | yes: one function `applyStatusChange` | allowed-moves list enforced by trigger (`request_status_transition_allowed`, migration 163); `closed` unreachable by a user; **"resolution note must exist" is screen only** | Strong for moves; note rule is a screen rule |
| Priority | nobody changes it by hand | yes (button removed) | **after M164:** refused; before: allowed | Fixed in LOCAL (VA-DB-01) |
| Deadlines (SLA) | computed, never edited | yes | **after M164:** change allowed only together with a status change (pause, resume, reopen); now logged | Fixed in LOCAL (VA-DB-01) |
| Service / team / requester | frozen after creation | yes | yes: `request_identity_unchanged` in the update check | Strong (re-verified) |
| Approval | approver decides; requester and sender cannot; one decision per step | yes: `lib/approvals/decision.ts` | inserts of approvals and decisions denied to users; one pending approval per ticket; decision unique per step | Strong on the decide step; side doors open (VA-TKT-07) |
| Business Rules | set priority, status, team, notify | engine uses the service key; managers can author | managers can write rules | Needs a decision (VA-TKT-02) |
| Resolve / close | note, reopen window, CSAT | yes | closed not reachable by user client | Strong |
| History and System Log | what changed, by whom | `request_activity` written by the server; System Log trigger on ticket columns | users cannot write either; System Log append-only with hash chain | Strong; some columns were unwatched before M164 |

---

## 2. Findings: ticket lifecycle

### VA-DB-01 / VA-TKT-01 (priority and deadlines part) — Priority and SLA deadlines could be changed by hand through the database API
- **Severity:** High (as found).
- **Where found:** `requests` table: policy `requests_update`, trigger `guard_request_client_write`, System Log trigger watch list. The rule being bypassed is in `lib/actions/requests.ts` ("no role can override it") and `tests/unit/no-priority-change.test.ts`.
- **What is wrong?** The company decided that nobody, not even a manager or admin, changes a ticket's priority by hand. Only the screens enforced it. A technician of the group or any manager could send one update straight to the database and set priority, push the response and resolution deadlines a year ahead, or inflate the paused-time total so a late ticket looks on time. A change to deadlines alone left no row in the System Log.
- **Why does it matter to Citykart?** A missed SLA could be hidden and a ticket silently downgraded, so SLA and breach reports could not be trusted. It also defeats a decision the owner made.
- **How was it checked?** Policy and trigger text read from the audit database; exploit tests T11 tests 1 to 3 (technician changes priority; manager changes priority; technician pushes deadlines a year ahead), run on the old and the fixed stack with real technician and manager logins.
- **What was changed?** Migration 164 changes `guard_request_client_write()`: priority cannot change; the two due dates and the paused-time total cannot change unless the status changes in the same update (pause, resume, reopen). The due dates and pause columns are now in the System Log watch list.
- **What happened after the fix?** All three exploit tests are refused (error 42501) and the stored values are unchanged. The server's own paths run with the service key and are unaffected; the earlier "technician can still change their team's tickets" positive tests were updated and passed in the second remediation run.
- **Status:** **Fixed in LOCAL** (priority and SLA part).
- **What remains:** deploy migration 164 together with the code (production does not have it); the other columns in the next finding; the routes through Business Rules and intake review (VA-TKT-02).
- **Technical evidence:** `supabase/migrations/20240101000164_vapt_security_hardening.sql` (lines 17-72); `tests/vapt/11-integrity-exploits.test.ts` tests 1-3; `vapt-2026-10/work/review-database-rls.md` VA-DB-01; `review-ticket-actions.md` VA-TKT-01; `05-REMEDIATION/regress-vapt-2.log`.

### VA-DB-02 / VA-TKT-01 (insert part) — A signed-in user could create a ticket straight in the database with any priority, service and team
- **Severity:** High → Medium (status table); the review rated it Medium.
- **Where found:** policy `requests_insert` and the INSERT branch of `guard_request_client_write`.
- **What is wrong?** A normal employee who knew how to call the database service could create a ticket that never went through the request form: choose "urgent", send it to any group's queue, skip the mandatory questions, and get no deadlines (so no SLA clock ever ran).
- **Why does it matter to Citykart?** Queue pollution, forged priority, tickets that can never breach, and a way around the mandatory form.
- **How was it checked?** Policy text; exploit test T11 test 4 (a requester inserts a ticket with priority urgent, another group's service and team): created before, refused after. Unit test TU: tickets are created by the server only.
- **What was changed?** Migration 164 drops the `requests_insert` policy; the server creates tickets with the service key (`useAdminForWrites: true`).
- **What happened after the fix?** T11 test 4 passes (insert refused). The earlier remediation test that created an ordinary ticket as a requester through the database was updated to match, and the second remediation run no longer failed on it.
- **Status:** **Fixed in LOCAL**.
- **What remains:** deploy; "Duplicate request" still builds a ticket with the service key and skips creation checks (VA-TKT-10).
- **Technical evidence:** migration 164 line 57; `tests/vapt/11-integrity-exploits.test.ts` test 4; `tests/unit/vapt-hardening-units.test.ts` ("tickets are created by the server only"); `lib/requests/create-request-core.ts`.

### VA-TKT-01 / VA-DB-01 (rest) — Other ticket columns are still writable by a technician or manager through the data API
- **Severity:** Medium.
- **Where found:** `requests` table: `authenticated` has `UPDATE` on every column.
- **What is wrong?** A technician of the group or a manager can still change `assigned_to` (to someone not on the team), `description` and `form_data` (what the requester wrote), `resolved_at`, `closed_at`, `reopen_count`, the category, and can move a ticket to resolved with no note, by calling the database directly.
- **Why does it matter to Citykart?** The ticket record, the requester's original words and resolution timing can be altered without the screen rules and, for some columns, without an obvious trace.
- **How was it checked?** Policy, grant and trigger text read from the audit database (confirmed by code). Not exploited beyond the three priority/deadline tests.
- **What was changed?** Nothing for these columns.
- **What happened after the fix?** Not applicable.
- **Status:** **Partially Fixed**. Needs a design decision.
- **What remains:** column-level grants for the user role (the same technique already used for `profiles`), with the few legitimate writes (assign, first response) done by the server or a controlled database function.
- **Technical evidence:** `review-ticket-actions.md` VA-TKT-01; `review-database-rls.md` VA-DB-01 (list of writable columns).

### VA-TKT-02 / VA-ADM-06 / VA-ADM-09 — Priority, status and approver can still be set through Business Rules, workflow edits and the intake review
- **Severity:** Medium (VA-ADM-09: Low-Medium).
- **Where found:** `lib/actions/admin/business-rules.ts` and `workflows.ts` (managers allowed), policies `business_rules_write` and `approval_workflow_steps_admin` (managers allowed), `lib/rules/actions.ts` (actions `set_priority`, `set_status`, `set_team` run with the service key and skip the status-move list and the resolution-note rule), `lib/actions/intake/work.ts` (`priorityOverride`).
- **What is wrong?** The owner said priority may come only from the sub-category or a Business Rule. A manager can write a rule such as "if the title contains X, set priority urgent and resolve it", save it, and the next edit of a matching ticket obeys it. A manager can also change the approver on a step that is already waiting and then approve it themselves. The person reviewing an e-mail can choose any priority when making the ticket. Rule-driven history lines name the requester as the actor (VA-TKT-17).
- **Why does it matter to Citykart?** It reopens by a side door what the owner decided to close, and weakens separation of duties in approvals.
- **How was it checked?** Source and policy reading (confirmed by code). Not exploited dynamically.
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Requires Decision**. Whether managers should author rules and workflows is the owner's call; it conflicts with "nobody sets priority by hand" only if the owner wants it that way.
- **What remains:** the decision; if admin-only, restrict the app gates and the database policies; copy-on-write for workflows with pending approvals; make rule-driven history show "Business rule X" as the actor.
- **Technical evidence:** `review-ticket-actions.md` VA-TKT-02, VA-TKT-17; `review-admin-report-actions.md` VA-ADM-06, VA-ADM-09; `lib/rules/actions.ts`.

### VA-TKT-05 / VA-TKT-06 — "Submit for approval" picked an arbitrary workflow, could be started by the requester, and ad-hoc route names carried ticket titles
- **Severity:** Medium.
- **Where found:** `lib/actions/requests.ts` (`submitForApproval`), `lib/actions/approvals.ts` (`sendAdHocApproval`), policies `workflows_select` and `approval_workflow_steps_select`.
- **What is wrong?** For a service with no approval route, pressing "submit for approval" silently picked some other approval route and sent the ticket to whoever is on it; those people then gain read access and the right to decide. A requester could also push their own ticket into "pending approval", where the technician cannot move it. The ad-hoc route was named "Ad-hoc: <ticket title>", and every employee can read workflow names.
- **Why does it matter to Citykart?** Unrelated people could read and decide tickets; titles such as "Salary advance for ..." were readable by all employees.
- **How was it checked?** Source and policy reading (confirmed by code). Not run as a dynamic test.
- **What was changed?** No default workflow (an error if the service has none); staff only (a requester can no longer start it); `requested_by` is recorded; the name is now "Ad-hoc approval <ticket no>".
- **What happened after the fix?** Code-level evidence only (CODE).
- **Status:** **Fixed in LOCAL** (CODE).
- **What remains:** every employee can still read workflow names and approver ids (VA-DB-07, Open); the status flip is not conditioned on the status read (VA-TKT-15, Open).
- **Technical evidence:** `lib/actions/requests.ts`, `lib/actions/approvals.ts`; `review-ticket-actions.md` VA-TKT-05, VA-TKT-06.

### VA-TKT-08 — A new ticket stored any form keys, including technician-only fields
- **Severity:** Medium.
- **Where found:** `lib/requests/create-request-core.ts`, `lib/forms/sections.ts`, `lib/requests/status-change.ts`, `lib/sla/resolve.ts`.
- **What is wrong?** A requester could type answers into boxes meant only for the technician (for example an approval reference). The technician was then no longer forced to fill them before changing status, and a hidden field could influence the SLA tier.
- **Why does it matter to Citykart?** The mandatory technician steps and the SLA tier can be pre-satisfied by the requester.
- **How was it checked?** Source reading (confirmed by code); no dynamic test.
- **What was changed?** Only requester-settable fields are kept when a ticket is created.
- **What happened after the fix?** Code-level evidence only (CODE).
- **Status:** **Fixed in LOCAL** (CODE).
- **What remains:** the same pruning in "Duplicate request" (VA-TKT-10, Open).
- **Technical evidence:** `review-ticket-actions.md` VA-TKT-08; `lib/requests/create-request-core.ts`, `lib/forms/sections.ts` (modified).

### VA-TKT-07 — "You cannot approve what you raised or sent" is closed only on the Decide button
- **Severity:** Medium.
- **Where found:** `lib/approvals/decision.ts` (the check), `lib/actions/approvals.ts` (`delegateApproval`, `addAdHocApprovers`), `lib/actions/requests.ts` (`submitForApproval`).
- **What is wrong?** The rule holds on the Approve button, but the side doors let the same person arrange who approves: a manager who raised the ticket can delegate the step to a chosen colleague of any role; any technician of the group can add themselves as an extra approver to a pending ad-hoc approval; the person who added them is not recorded.
- **Why does it matter to Citykart?** Separation of duties in approvals (a control auditors look for) can be sidestepped by a dishonest or careless insider.
- **How was it checked?** Source reading (confirmed by code); not run.
- **What was changed?** `requested_by` is now recorded on "submit for approval" (VA-TKT-05), which closes one of the doors.
- **What happened after the fix?** Not applicable for the remaining doors.
- **Status:** **Open**.
- **What remains:** one shared guard used by decide, delegate, add-approvers and submit: the caller must not be the requester or the sender, and the delegate or new approver must not be either; record who added whom; decide whether ad-hoc approvers must be managers.
- **Technical evidence:** `review-ticket-actions.md` VA-TKT-07.

### VA-DB-11 / VA-TKT-13 (also VA-API-13, VA-INT-11) — Approval e-mail code: parallel wrong guesses were counted as one try
- **Severity:** Low (needs a valid signed link first).
- **Where found:** `lib/approvals/email-code.ts` (`consumeApprovalCode`), `lib/actions/approvalEmail.ts`, `lib/approvals/email-link.ts`.
- **What is wrong?** The six-digit code allows five wrong tries, but if hundreds of guesses are sent at the same instant they were counted as one. The code-request and verify limits are counters in memory that reset on every restart. A person holding a forwarded link can ask for new codes (cancelling the real approver's code) and mail the approver repeatedly.
- **Why does it matter to Citykart?** A determined holder of an approval link had a small, but not zero, chance to guess the code and decide on the approver's behalf. Each code attempt also e-mails the real approver.
- **How was it checked?** Burst test TB: 20 simultaneous wrong guesses on the old and the fixed code.
- **What was changed?** A wrong guess is now counted atomically (read, then update only if the count is unchanged, up to six tries); a guess that keeps losing the race is treated as a lock-out.
- **What happened after the fix?** TB: 20 guesses were accepted before; at most 4 are accepted after, and the code ends up locked. The right code still works on the first try.
- **Status:** **Fixed in LOCAL** (counter). The in-memory limits are **Open** (VA-API-13's other half is not named in the status table).
- **What remains:** persist the code-request and verify counters in the database; do not cancel an unexpired code when a new one is requested within its window; the code hash falls back to an empty key when no secret is set; the link-signing key falls back to the cron secret (VA-API-05); the proof cookie is not `Secure` over HTTP. **Caution:** the last saved regression logs still show failing approval-code tests (file 02 §5); I read the cause as a test helper problem, not as a failure of the control, but a clean re-run is needed.
- **Technical evidence:** `lib/approvals/email-code.ts` (modified); `tests/unit/approval-code-burst.test.ts`; `review-database-rls.md` VA-DB-11; `review-ticket-actions.md` VA-TKT-13; `review-uploads-email-whatsapp.md` VA-INT-11.

### VA-TKT-10, 11, 12, 14, 15, 16, 17, 20 (grouped) — Smaller lifecycle weaknesses
- **Severity:** Low.
- **Where found:** `lib/actions/requests.ts` (`duplicateRequest`, `assignRequest`, `updateRequestCategory`, `submitForApproval`), `lib/actions/approvals.ts` (`searchManagersForApproval`, decisions), `lib/actions/notifications.ts`, `profile.ts`, `push.ts`, `knowledge-base.ts`, `lib/rules/actions.ts`, policy `request_activity_select`.
- **What is wrong?** In plain words, one line each:
  - **VA-TKT-10:** "Duplicate request" makes a ticket with the service key and skips creation checks (inactive service, mandatory fields, deadlines, rules), copying priority and technician-only answers.
  - **VA-TKT-11:** a manager can assign to anyone (even a person who cannot open the ticket); changing the sub-category quietly un-assigns the ticket.
  - **VA-TKT-12:** changing the sub-category recomputes priority and deadlines on a ticket in any status, with no reason field, so someone can pick the category with the longest deadline.
  - **VA-TKT-14:** the approver search lets any employee test which e-mail address belongs to which person.
  - **VA-TKT-15:** several updates are not conditioned on the status that was read (races); an approval can bring a ticket back that a rule has since resolved.
  - **VA-TKT-16:** some actions return raw database error text to the browser.
  - **VA-TKT-17:** history lines created by Business Rules name the requester or new assignee as the actor.
  - **VA-TKT-20:** a requester can read the full activity log of their own ticket through the API, which can include rule names and copied e-mail addresses.
- **Why does it matter to Citykart?** None gives an outsider access. They weaken checks, traceability and privacy at the edges.
- **How was it checked?** Source and policy reading (confirmed by code; races are "plausible").
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Open** (listed with fixes in the master register).
- **What remains:** the fixes in the review file: route "Duplicate" through the normal creation function; validate assignees; limit reclassification (status, reason, log old deadlines); restrict the approver search; conditional updates everywhere; use `sanitizeError`; record the system as actor for rules; a requester view of activity limited to public event types.
- **Technical evidence:** `review-ticket-actions.md` VA-TKT-10, 11, 12, 14, 15, 16, 17, 20.

The ticket-related findings VA-TKT-03 and VA-TKT-04 (internal-note notification text and internal-note file) are in file 06 (VA-INT-03, VA-INT-01); VA-TKT-09, VA-TKT-18 and VA-TKT-19 are in file 04.

---

## 3. Findings: administration, reports and exports

### VA-ADM-03 — Company-wide settings are editable by managers and admins through the app, although the database reserves them for the platform owner
- **Severity:** Medium.
- **Where found:** `lib/actions/admin/config.ts` (`updateAppSetting`, `updateEmailFromSettings`, `sendTestEmail`, `updateBusinessHours`, `createHoliday`, `deleteHoliday`, `updateRequestPriority`, `updateRetentionPolicy`), `lib/actions/admin/task-config.ts`; tables with no `org_id` (business hours, holidays, request priorities, task statuses, app settings, retention policies).
- **What is wrong?** The database says only the platform owner may change business hours, holidays, priorities and settings. The screens let any manager or admin do it, because the action talks to the database with the all-powerful key. `updateAppSetting` accepts any setting name with no list and no value check. `sendTestEmail` can send mail from the company mailbox to any address.
- **Why does it matter to Citykart?** A manager could mark every day a holiday so no ticket ever looks late, change the sender name of all system e-mails to something deceptive, or use the test e-mail as a relay. Changes are logged by database triggers, but not blocked.
- **How was it checked?** Source and policy reading (confirmed by code); not exploited.
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Requires Decision**.
- **What remains:** decide the intended owner. If platform-owner only, gate the actions; if managers or admins should edit, add `org_id` to these tables, use an explicit list of setting keys with value checks, and rate-limit and restrict the test e-mail.
- **Technical evidence:** `review-admin-report-actions.md` VA-ADM-03; `00-FINDING-STATUS-TABLE.md` row "VA-DB-03 (rest) / VA-ADM-03".

### VA-ADM-05 — A manager could rewire people and identities
- **Severity:** Medium.
- **Where found:** `lib/actions/admin/users.ts` (`updateUserProfile`, `addMobileNumber`, `removeMobileNumber`, `setUserTeams`), `lib/admin/target-guard.ts`.
- **What is wrong?** The code did not stop a manager from editing an administrator, attaching their own mobile number to someone else's account (so WhatsApp messages from the manager's phone raise tickets as that person, with no log row), naming a chosen person as someone's "line manager" (which opens that person's tickets to them), or adding themselves to any technician group.
- **Why does it matter to Citykart?** Insider impersonation and quiet widening of who can see which tickets.
- **How was it checked?** Source reading (confirmed by code); unit test TU on the "who may change whom" guard.
- **What was changed?** `targetGuardError` now covers profile, phone and team edits; reporting line and phone numbers are admin-only; the changes are written to the audit log.
- **What happened after the fix?** TU: a manager cannot edit an administrator or platform owner, cannot attach mobile numbers, cannot change their own groups; a manager can still edit an ordinary user and set their groups; an administrator can manage numbers of ordinary users but not of a platform owner. This proves the guard function, not a click through the screens.
- **Status:** **Fixed in LOCAL**.
- **What remains:** deploy; a click-through test of the screens.
- **Technical evidence:** `tests/unit/vapt-hardening-units.test.ts` ("who may change whom"); `lib/admin/target-guard.ts`, `lib/actions/admin/users.ts` (modified); `review-admin-report-actions.md` VA-ADM-05.

### VA-ADM-04 — The Report Builder showed technician-only form fields to the requester
- **Severity:** Medium.
- **Where found:** `lib/queries/reporting.ts`, `lib/actions/reporting.ts`, `lib/actions/reportExport.ts`.
- **What is wrong?** Administrators can mark some form fields "technician only" so the requester never sees them. The ticket screen respected that, but the Report Builder did not: a requester could add those columns to a report of their own tickets and download them.
- **Why does it matter to Citykart?** Information meant to be hidden (internal remarks, cost codes) could be read and exported by the requester.
- **How was it checked?** Source reading (confirmed by code). The browser rendering was not run.
- **What was changed?** Technician-only fields are filtered out for the "own" and "reports" scopes.
- **What happened after the fix?** Code-level evidence only (CODE).
- **Status:** **Fixed in LOCAL** (CODE).
- **What remains:** the comment count in the Report Builder may include internal notes (noted in the review; the fix described in the status table covers form fields only); a dynamic check.
- **Technical evidence:** `lib/queries/reporting.ts` (modified); `review-admin-report-actions.md` VA-ADM-04.

### VA-ADM-12, 13, 15, 16, 17 (grouped) — Smaller administration and export weaknesses
- **Severity:** Low.
- **Where found:** `lib/actions/admin/sla-matrix.ts`, `org.ts`, `teams.ts`, `intake/reviews.ts`; `app/(app)/admin/teams/page.tsx` and `knowledge-base/page.tsx`; `reportExport.ts`, `fixedReportExport.ts`, `events.ts`, `analytics-drill.ts`; `admin/users.ts` (`adminSendPasswordReset`, `inviteUser`); `lib/requests/cc-recipients.ts`, `lib/actions/admin/oems.ts`.
- **What is wrong?**
  - **VA-ADM-12:** several admin writes accept ids from another organisation without checking (matters only if a second organisation exists; see VA-DB-06 in file 04).
  - **VA-ADM-13:** two admin pages (teams, knowledge base) have no role check of their own and rely on the layout.
  - **VA-ADM-15:** several exports (report builder up to 20,000 tickets, fixed reports, event CSV, bulk request export) are not recorded as audit events, the heavy report loads have no per-user limit, and the pivot settings from the browser are not validated.
  - **VA-ADM-16:** the admin password-reset and invite functions accept any e-mail address, not only people of the organisation.
  - **VA-ADM-17:** a manager can add an outside address as an "OEM contact", which then counts as an organisation address for report recipients and ticket copies.
- **Why does it matter to Citykart?** Weaker audit trail for data leaving the system; small ways around the "reports only go to your own addresses" control.
- **How was it checked?** Source reading (confirmed by code; VA-ADM-13 plausible).
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Open**.
- **What remains:** audit every export the same way; per-user rate limit; validate the pivot configuration; look up the address in the organisation first; restrict OEM addresses to an approved list; add the role check to the two pages.
- **Technical evidence:** `review-admin-report-actions.md` VA-ADM-12, 13, 15, 16, 17.

---

## 4. Findings: web addresses (API), the proxy, the System Log

### VA-API-04 (also earlier D-039) — Any path ending `.png`, `.jpg` or `.svg` skipped the session check and the public-form size cap
- **Severity:** Medium (defence in depth).
- **Where found:** `proxy.ts` (static-file fast path), `lib/http/public-body-limit.ts`.
- **What is wrong?** The login gate had a side door for image-looking addresses. Dynamic pages accept dotted values, so `/requests/x.png` was matched by the page but skipped by the proxy's session check and size guard, and server actions can be posted to any matched address.
- **Why does it matter to Citykart?** It did not let a stranger act as someone else, but it let an unauthenticated caller reach pages and actions without the usual redirect and without the 256 KB cap on public forms (memory pressure on the single server process).
- **How was it checked?** Code reading; unit tests TU and `tests/unit/header-trust.test.ts`; HTTP probe H2: an unauthenticated `/requests/x.png` was redirected by the **page layout** even on the old build, so the finding was defence in depth and **not** a login bypass.
- **What was changed?** The fast path now matches only root-level static files (one path segment ending in an image extension).
- **What happened after the fix?** TU: page-looking and nested paths no longer match; `header-trust`: such paths get the proxy's redirect to `/login`.
- **Status:** **Fixed in LOCAL**.
- **What remains:** deploy; ensure the real logo files stay at the root of `public/`.
- **Technical evidence:** `proxy.ts:35-39`; `tests/unit/vapt-hardening-units.test.ts`; `tests/unit/header-trust.test.ts`; file 03 §4 (H2).

### VA-API-07 / VA-INT-08 / VA-ADM-08 — Anyone could flood the System Log through the browser-report address
- **Severity:** Medium.
- **Where found:** `app/api/csp-report/route.ts` (no login, in the proxy allowlist), `app/api/events/route.ts`, `lib/syslog/writer.ts`.
- **What is wrong?** Anyone who could reach the server could post fake "browser blocked something" reports. The per-sender limit used a header the sender could invent, the body was read before its size was checked, and every distinct text made a new row. A signed-in user could do the same with fake browser errors.
- **Why does it matter to Citykart?** Disk growth and a log full of invented warnings, hiding real events.
- **How was it checked?** Code reading; HTTP probe H3: 120 forged reports with invented sender addresses produced **120** System Log rows on the old build and **30** on the fixed build.
- **What was changed?** The sender address is taken only from the trusted proxy setting; a global cap applies; the size is checked before the body is read; the number of events per request is capped at 50.
- **What happened after the fix?** 30 rows for 120 forged reports (H3).
- **Status:** **Fixed in LOCAL**.
- **What remains:** the per-address limits on the e-mail-note and WhatsApp paths depend on `TRUSTED_PROXY_HOPS` being set in production (VA-API-03); cap tagged-mail notes per ticket per hour.
- **Technical evidence:** `app/api/csp-report/route.ts`, `app/api/events/route.ts` (modified); `tests/unit/csp-report.test.ts` (modified); file 03 §4 (H3).

### VA-API-05 — One secret (`CRON_SECRET`) is the fallback for many unrelated purposes and can reach Microsoft in a URL
- **Severity:** Medium.
- **Where found:** `lib/cron-auth.ts`, `lib/auth/verified-user.ts`, `lib/approvals/email-link.ts`, `lib/csat/token.ts`, `lib/intake/oauth.ts`, `app/api/intake/webhook/gmail|outlook/route.ts`, `app/api/system-log/ingest/route.ts`, `app/api/intake/oauth/callback/route.ts`.
- **What is wrong?** If a dedicated secret is not set, the cron secret is also the signing key of the verified-user header, approval and survey links, the OAuth state, and the mail-webhook token. The Outlook connection puts that secret into the web address and the `clientState` stored by Microsoft. No minimum length is enforced for the cron secret on cron routes.
- **Why does it matter to Citykart?** Learning one secret (from a log, a script file, a header) opens the cron routes, forges webhook calls and signed links.
- **How was it checked?** Source reading (confirmed by code). Which secrets are set in production is not known.
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Open**. It is a deployment-configuration fix.
- **What remains:** set separate secrets of 32 bytes or more for each purpose; remove the `?? CRON_SECRET` fallbacks so the service fails closed; never put a secret in a URL a third party stores.
- **Technical evidence:** `review-api-proxy-auth.md` VA-API-05.

### VA-API-10 — A test option could mail live Approve/Reject links to any outside address
- **Severity:** Low (needs the cron secret).
- **Where found:** `app/api/approvals/reminders/route.ts` (`?sampleTo=`).
- **What is wrong?** The daily approval-reminder address accepted any e-mail address as a test recipient and sent it the real approver's signed approve and reject links.
- **Why does it matter to Citykart?** With a leaked cron secret, ticket titles and requester names would leak to an outsider (the links still need the e-mailed code or the approver's login).
- **How was it checked?** Source reading (confirmed by code).
- **What was changed?** Only the company mail domain is accepted.
- **What happened after the fix?** Code-level evidence only (CODE).
- **Status:** **Fixed in LOCAL** (CODE).
- **What remains:** consider stripping the links from sample mails and logging the use as a security event.
- **Technical evidence:** `app/api/approvals/reminders/route.ts` (modified); `review-api-proxy-auth.md` VA-API-10.

### VA-API-14 — Hygiene items: a loose pattern in the public-file path check, the framework banner header, and others
- **Severity:** Info.
- **Where found:** `lib/storage/publicPath.ts`, `next.config.ts`, `app/api/health/route.ts`, `lib/supabase/admin.ts`.
- **What is wrong?** A backslash was lost in a pattern, so a dot matched any character (not exploitable: the file must exist). The server announced its framework in an `X-Powered-By` header. Other notes: the health address is public and runs a database query on each call; the client address is never stored in production (the proxy hop count is unset), so sign-in failures in the log have no source address.
- **Why does it matter to Citykart?** Low. A banner helps an attacker choose exploits (the framework is a main source of published weaknesses, file 02); the missing address weakens investigations.
- **How was it checked?** Code reading; unit tests TU; HTTP probe H5 (header present before, absent after).
- **What was changed?** The pattern uses `String.raw`; `poweredByHeader: false`.
- **What happened after the fix?** TU passes (a character in place of the dot is refused); H5 shows the header gone.
- **Status:** **Fixed in LOCAL** (these two). The remaining notes are **Open** (informational).
- **What remains:** cache the health result briefly; set `TRUSTED_PROXY_HOPS` so the address is stored; align the `/auth/callback` redirect base with the configured address.
- **Technical evidence:** `lib/storage/publicPath.ts`, `next.config.ts` (modified); `tests/unit/vapt-hardening-units.test.ts`; file 03 §4 (H5).

Findings in the same range written up elsewhere: VA-API-01, 02, 03, 08, 09, 11 are in file 04; VA-API-06 (spreadsheet preview) and VA-API-12 (webhooks) are in file 06.

---

## 5. Controls found sound (read, class B unless stated)

- **Identity:** every action reads the profile from the signed session; none takes a user id from the browser. The verified-user header is signed, stripped on every path, and compared in constant time.
- **Status changes:** one function, with allowed-move lists, mandatory remarks and notes, compare-and-set on the old status; the database also enforces the move list (migration 163).
- **Approvals:** decisions in one place, unique per step, inserts denied to users, one pending approval per ticket; e-mail links signed per approval and per approver, 7-day expiry, code random, hashed, single use, 10 minutes, 5 tries; a signed-in person who is not the approver is refused.
- **Delegation** copies a shared workflow instead of rewriting it (D-016 re-verified).
- **Bulk actions** (assign, status, collaborators, export): list cleaned (UUID shape, unique, max 500), then each item goes through the same single-item checks.
- **Search** runs with the caller's own row rules.
- **CSV exports** neutralise leading `= + - @`; Excel exports write text as text, so formulas are not evaluated.
- **Reports scope:** decided on the server per role; the browser's filters can only narrow. Scheduled reports are admin-only; recipients must be company addresses and are re-checked at send time.
- **System Log:** append-only table, update/delete/truncate refused by trigger, hash chain with a verify function, read by admin and platform owner of the organisation only; filter values are allow-listed; exports are capped and recorded; the ingest address cannot write audit rows (identity and organisation forced to none, 512 KB and 200-entry caps, constant-time secret compare).
- **Business Rules** contain no code, URLs or regular expressions; they use fixed action types; `set_team` and `assign` check organisation and team.
- **Server Actions CSRF:** Next's built-in same-origin check is in use (no extra allowed origins configured). If a reverse proxy with a different host name is added, the allowed origins must be set.
- **Errors:** most actions return generic messages (`sanitizeError`); cron routes return detail only to the secret holder.

## Open questions / evidence requests for management

1. Decision on Business Rules, approval-workflow steps and the intake priority override: may managers author them? (VA-TKT-02, VA-ADM-06, VA-ADM-09.) Owner to be assigned by management.
2. Decision on company-wide settings (business hours, holidays, priorities, application settings): platform owner only, or admin/manager with per-organisation tables? (VA-ADM-03.)
3. Decision on the remaining ticket columns: approve a design for column-level rights, and name who will test it. (VA-TKT-01 rest.)
4. Please supply a list of the secrets set on the app server by name only (not values): `CRON_SECRET`, `INTAKE_WEBHOOK_TOKEN`, `APPROVAL_LINK_SECRET`, `CSAT_LINK_SECRET`, `INTAKE_WORKER_SECRET`, `TRUSTED_PROXY_HOPS`, so the fallbacks in VA-API-05 can be assessed.
5. Who reviews the System Log, how often, and with what sign-off? The repository defines no reviewer or alert rule (control inventory §8).
6. Please approve a click-through acceptance test of the fixed behaviours on the local stack before any deployment (priority refused, direct insert refused, manager guard, report fields, approvals).
7. Please confirm the release order for migration 164 and the code (the migration must not reach production without the matching app build; the rollback file is `supabase/rollback/164_vapt_security_hardening_rollback.sql`). Nothing has been deployed.
