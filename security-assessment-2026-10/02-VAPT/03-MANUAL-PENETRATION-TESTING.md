# 03 — Manual Penetration Testing Log (VAPT of Citykart Desk, CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This is a case-by-case log of the 15 attack scenarios the assignment ranked highest. For each one it says: what the safe behaviour should be, how it was checked, what happened, and where the proof is. "Penetration test" here means we tried to do the harmful thing ourselves, on a **disposable copy only**, never on production.

Three kinds of check are used and every case says which:
- **Exploit test, before and after (L-before / L-after).** We wrote a test that does the harmful thing. It succeeded on the old code and database, then failed (the attack was refused) after the fix. This is the strongest evidence (class A).
- **Read-only database check.** We read the real rules (policies, triggers, grants) from the audit database and, in a few cases, ran a read-only simulation as a given role. No data was changed (class A for the fact read, but it is not an attack).
- **Source review only.** We read the code and reasoned about it (class B). Nobody ran the attack. These are marked "source review only" and are weaker.

Plain wording for results: **Exploit worked before the fix** means the attack succeeded on the unfixed LOCAL stack. **Blocked** means the attempt was refused. **Not testable here** means the audit stack could not show it (for example it needs a real Gmail mailbox or Meta account, or a second company in the data).

Nothing here is deployed. Production runs build `20261015-145217` (main `717e5c6`) and does **not** contain the fixes. Nothing here tested production.

*Naming note:* the finding status table and a comment in `next.config.ts` call this log `02-VAPT/04-MANUAL-PENETRATION-TESTING.md`. This deliverable is numbered 03. They mean the same file.

---

## 1. Test environment and rules

| Item | Value |
|---|---|
| Application under test | local build of this checkout, port 3310 (Next.js 16.3.8 for the fixed build) |
| Database / API | disposable Postgres `supabase_db_ckdesk_audit`, API on 127.0.0.1:55421, 3,000 synthetic tickets, 336 synthetic profiles, **one** organisation |
| Mail | local mail trap only; no mail leaves the PC; no mailbox, WhatsApp or OAuth channel configured |
| Safety gate | isolation gate passed 21 of 21 checks before dynamic work; an egress guard refuses any non-loopback connection |
| Not touched | production 10.0.1.98, 10.0.0.205, 10.0.0.25, retired 10.0.1.12, public 182.72.84.10 |

Test files (all under the repository root):

| Short name | File | Tests |
|---|---|---|
| **T10** | `tests/vapt/10-confidentiality-exploits.test.ts` | 5: internal-note file (VA-INT-01); internal-note notification text (VA-INT-03); mobile numbers (VA-INT-13); direct upload to the task-files store (VA-INT-10); clearing the "must change password" flag (VA-API-02) |
| **T11** | `tests/vapt/11-integrity-exploits.test.ts` | 6: technician changes priority; manager changes priority; technician pushes the deadline a year ahead; requester creates a ticket straight in the database; manager changes SLA policy or service; admin still can (positive control) |
| **T12** | `tests/vapt/12-email-reply-participant.test.ts` | 4: who may reply to a ticket by e-mail (logic level) |
| **TU** | `tests/unit/vapt-hardening-units.test.ts` | mail-server address forms; public storage path dot; proxy static-file rule; code-level rules (flag, subject, server-only creation); who may change whom (VA-ADM-05) |
| **TB** | `tests/unit/approval-code-burst.test.ts` | 2: 20 simultaneous wrong guesses; the right code still works |
| **H** | HTTP probes against the audit app on 3310 | section 4 |
| **M164** | `supabase/migrations/20240101000164_vapt_security_hardening.sql` | the database fix that the exploit tests check |

Latest saved run of T10 + T11 + T12: **15 of 15 pass** on the fixed stack (`05-REMEDIATION/regress-vapt-2.log`). Each test states the secure behaviour. Before M164 and the code fixes the exploit tests failed, which is how each finding was shown to be real.

---

## 2. Summary of the 15 scenarios

| # | Scenario | Result in one line | Check type | Findings |
|---|---|---|---|---|
| 1 | Requester reads another person's ticket | **Blocked**; no way found | read-only DB check + source review | none open for this path |
| 2 | Requester reads internal notes | Direct note blocked; **two side paths worked before the fix** (files, notification text), now blocked; one Low path open | exploit before/after (T10) | VA-INT-01, VA-INT-03 fixed; VA-TKT-20 open |
| 3 | Technician reaches management reports | **Blocked** by scope rules; no exploit found | source review only | VA-ADM-13, VA-ADM-15 Low open |
| 4 | Manager exceeds their visibility | Org-wide reading is **by design**; **configuration writes worked before the fix** for 4 tables, now blocked; ~20 tables still open | exploit before/after (T11) + unit (TU) | VA-DB-03, VA-ADM-05 (fixed part); VA-DB-03 rest, VA-ADM-03, VA-ADM-06 decisions open |
| 5 | Bypass mandatory fields | Direct database insert **worked before**, now blocked; technician-only keys fixed by code; some skips remain | exploit before/after (T11) + source review | VA-DB-02, VA-TKT-08 fixed; VA-TKT-10, VA-TKT-01 rest open |
| 6 | Modify priority through the API | **Worked before the fix** for technician and manager (priority and deadlines); now refused | exploit before/after (T11) | VA-DB-01/VA-TKT-01 fixed (part); VA-TKT-02, VA-ADM-09, VA-TKT-12 open |
| 7 | Change the service of a ticket | **Blocked** at the database already | read-only DB check + source review | none for the update path; creation path fixed under #5 |
| 8 | Unauthorised approval | Main path **blocked**; code-guessing budget flaw fixed; **side doors open** | exploit before/after (TB) + source review | VA-DB-11/VA-TKT-13 fixed; VA-TKT-07, VA-ADM-06 open |
| 9 | Download another person's attachment | Request files **blocked** by row rules; internal-note file **worked before**, now blocked | exploit before/after (T10) + source review | VA-INT-01 fixed; VA-TKT-09 (task files) open |
| 10 | Manipulate report filters | **No widening path found**; one field-hiding gap fixed by code | source review only | VA-ADM-04 fixed (CODE); VA-ADM-15 open |
| 11 | Forged webhook | Authentication **holds on reading**; public log endpoint was floodable (fixed) | source review + HTTP probe (H) | VA-API-07 fixed; VA-API-12 open |
| 12 | Replayed request / duplicate ticket | Replays **blocked** where a unique key exists; portal double-submit **not examined** | source review (+ TB for codes) | VA-API-12, VA-TKT-10 open; double-submit Not Verified |
| 13 | Invoke an admin server action directly | Every admin action re-checks the role; **manager-allowed list is wide**; front-door bypass fixed | source review + unit (TU) + HTTP probe (H) | VA-API-04 fixed; VA-ADM-03/05/06/13 |
| 14 | Modify configuration through the database API | **Worked before the fix** for 4 tables (T11); ~20 tables still writable by managers | exploit before/after (T11) | VA-DB-03 |
| 15 | Malicious content against an AI feature | No model creates or changes tickets; two optional model uses give **suggestions to a human** | source review only | none open that depends on a model |

---

## 3. The 15 cases

Each case lists: **Expected** (safe behaviour) · **How checked** · **Result** · **Evidence**.

### Case 1 — A requester tries to read another person's ticket

- **Expected:** a requester sees only their own tickets (plus tickets they collaborate on, approve, or that belong to their direct reports where that view exists). A stranger's ticket id returns nothing, over the screens, the PDF, the attachments and the database API.
- **How checked:** (a) read-only catalog check of `requests_select` and the policies for comments, activity, approvals and attachments (all begin with the organisation test and limit non-staff to their own tickets); (b) read-only role simulation in the audit DB as an ordinary requester with no tickets: no rows from `requests`, `request_comments`, `tasks`, `notifications`; as `anon`: zero rows from every table; (c) source review of the PDF route (viewer's RLS on every query) and the attachment routes. No new HTTP exploit test was written for this case.
- **Result:** **Blocked.** No path found. Related weakness found on the way and fixed: a manager could make any chosen person someone's "line manager", which opens the subordinate's tickets to that person (VA-ADM-05, fixed in LOCAL, unit-tested). The "submit for approval" route that made unrelated people approvers (and so readers) of a ticket was also fixed (VA-TKT-05).
- **Not testable here:** cross-company reading, because the audit DB has one organisation. Those statements rest on the policy text.
- **Evidence:** class A (read-only simulation) and B. `vapt-2026-10/work/review-database-rls.md` §2 "Isolation of tickets for requesters"; `review-ticket-actions.md` §2.

### Case 2 — A requester tries to read internal notes

- **Expected:** internal notes, and anything derived from them (files, notification text, e-mail, PDF, history), are staff-only.
- **How checked:** read-only check of `comments_select` (internal notes hidden from requesters); T10 exploit tests for the two side paths below, run before and after the fix.
- **Result:**
  - The note itself: **blocked** at the database.
  - A file attached to an internal note: **exploit worked before the fix.** The system stored it as a normal file, so the requester could list and download it (and its name appeared in the PDF and history). After M164 and the upload fix the requester cannot list or download it (T10 test 1). Old rows were back-filled by the migration.
  - The start of an internal note sent by bell or e-mail to a collaborator who is not staff, or to an @mentioned colleague who cannot open the ticket: **worked before**; after the fix recipients are filtered (T10 test 2).
  - Still open (Low): the requester can read the ticket's activity rows through the database API, which can include rule names and copied e-mail addresses (VA-TKT-20). The Report Builder review also noted that a comment count may include internal notes; the status table's fix covers technician-only form fields, so treat the count as unconfirmed.
- **Evidence:** class A. T10 tests 1 and 2; `lib/actions/attachments.ts`, `lib/actions/requests.ts`; M164 (file-store read rule). Findings VA-INT-01, VA-INT-03 (file 06), VA-TKT-20 (file 05).

### Case 3 — A technician tries to reach management reports

- **Expected:** a technician sees only the tickets of their own group(s), not company-wide figures, not the management dashboards, not the admin area.
- **How checked:** **source review only.** `authorizeReportAccess` / `resolveReportAccess` decide own, group or all by role; non-ticket report entities are manager and above; fixed reports limit groups to the viewer's memberships and ignore other picks; the admin layout redirects every role except admin, manager, platform owner. No dynamic request was made as a technician.
- **Result:** **Blocked on reading; no exploit found.** Low open items: two admin pages have no check of their own (VA-ADM-13, only reachable through the layout; reads go through RLS; "plausible", needs a crafted request); several exports are not recorded in the audit log and have no per-user limit (VA-ADM-15).
- **Evidence:** class B. `review-admin-report-actions.md` §2 "Reports and analytics scope".

### Case 4 — A manager tries to exceed their visibility

- **Expected:** by design a manager reads every ticket in the organisation (open decision D-005: no confidentiality tier for HR or Finance). A manager must **not** be able to edit configuration reserved for administrators, edit an administrator or platform owner, attach a mobile number to someone else's account, or give themselves technician-group membership.
- **How checked:** read-only simulation (a manager in one group reads all 3,000 tickets: confirmed, by design); T11 exploit tests on configuration tables (before and after); TU unit tests of the "who may change whom" guard; source review for the app-level gates.
- **Result:**
  - Org-wide reading: **confirmed, by design**, recorded as a decision (D-005).
  - Database configuration writes (services, SLA policies, global SLA settings, field SLA overrides): **exploit worked before the fix** (manager PATCH accepted); **refused after M164** (T11 test 5); the administrator can still write (T11 test 6, positive control).
  - Editing administrators, attaching phone numbers, setting reporting lines, adding self to groups: **possible before**; after the LOCAL fix `targetGuardError` covers profile, phone and team edits and the last two are administrator-only (TU). This is a unit-level proof of the guard, not a click-through of the screens.
  - Still open: about 20 other configuration tables are writable by managers in the database; managers can edit global settings through the app (business hours, holidays, priorities, settings) although the database reserves them for the platform owner; managers can author Business Rules and edit approval-workflow steps. These need an owner decision (VA-DB-03 rest, VA-ADM-03, VA-TKT-02, VA-ADM-06).
- **Evidence:** class A (T11 tests 5-6, TU) and B. Files 04 and 05.

### Case 5 — Someone tries to bypass mandatory fields

- **Expected:** a ticket exists only if the service's form was completed (mandatory fields, requester-only versus technician-only fields), priority and deadlines come from the sub-category, and a resolution needs a proper note.
- **How checked:** T11 test 4 (a requester inserts a ticket straight into the database with an urgent priority and another group's service and team); source review of `create-request-core.ts` for technician-only keys; source review of the status-change gate.
- **Result:**
  - Direct insert: **worked before the fix** (the ticket was created with the forged priority and no deadlines). **Refused after M164** (T11 test 4).
  - Technician-only form keys sent by a requester: **possible, by reading the code** (the technician's mandatory-field gate could be pre-satisfied and the SLA tier influenced). Fixed in code to accept only requester-settable fields (CODE; no dynamic test was run).
  - Still open: "Duplicate request" builds a ticket with the server key and skips the creation checks (VA-TKT-10, Low). The database does not enforce the "resolution note exists" rule; it lives in the server action only, so a technician talking to the database directly can move a ticket to resolved without a note (part of VA-TKT-01 rest, Partially Fixed).
- **Evidence:** class A (T11 test 4) and B. VA-DB-02 and VA-TKT-08 (file 05).

### Case 6 — Someone tries to change priority through the API

- **Expected:** nobody, not even a manager or admin, sets a ticket's priority or deadlines by hand. Priority comes from the sub-category and its SLA, or from a Business Rule. This was the owner's recent decision, built into the screens.
- **How checked:** T11 tests 1 to 3 against the data API with real technician and manager logins, before and after M164. The test sends an update straight to the database service (as the browser can), not through the screens.
- **Result:** **Exploit worked before the fix** in all three cases: a technician of the group changed priority; a manager changed priority; a technician pushed the resolution and response deadlines a year ahead and inflated the paused-time ledger (so a late ticket looks on time). The database review also found, by reading, that deadline-only changes left **no System Log row**. **After M164** the database refuses each with error 42501 and the stored values are unchanged; deadline changes are now watched by the System Log. The finding was High because the rule was only a screen rule.
- **Still open:** three legitimate-looking routes to change priority remain, all waiting on an owner decision: a manager writing a Business Rule that sets priority or status (VA-TKT-02); the intake reviewer choosing a priority when making a ticket from an e-mail (VA-ADM-09); changing the sub-category after creation, which recomputes priority and deadlines (VA-TKT-12, Low). A technician or manager can still change `assigned_to`, `description`, `form_data`, `resolved_at`, `closed_at`, `reopen_count` and the category through the data API until column-level rights are designed (VA-TKT-01 rest).
- **Evidence:** class A. T11 tests 1-3; M164 (`guard_request_client_write`); `tests/unit/no-priority-change.test.ts` for the screen side.

### Case 7 — Someone tries to change the service of a ticket

- **Expected:** nobody can change a ticket's service (every service has its own mandatory form). Category and sub-category can still be changed.
- **How checked:** read-only catalog check of `requests_update` (its WITH CHECK calls `request_identity_unchanged(id, org_id, requester_id, service_id, team_id)`, which freezes organisation, requester, service and team); source review confirms the app action `reclassifyRequest` was removed in the earlier release. No separate VAPT exploit test was written because the update path was already closed.
- **Result:** **Blocked** at the database for updates. The only service-related hole was on **creation** (a direct insert with any service or team), fixed under Case 5.
- **Evidence:** class A (policy text read from the audit DB) and B. `review-database-rls.md` §1 VA-DB-01 evidence and §2.

### Case 8 — Someone tries an unauthorised approval

- **Expected:** only the named approver can decide; the person who raised or sent the request cannot; an e-mailed link alone never decides; the one-time code is random, single use and limited to five wrong tries.
- **How checked:** TB burst test (20 simultaneous wrong guesses, before and after the fix); TU rule that the code is never in the subject; source review of `lib/approvals/decision.ts`, `email-link.ts`, `email-code.ts`, `approvalEmail.ts`; integration tests for the e-mail-link flow exist (see the caution on the saved logs in file 02 §5).
- **Result:**
  - Main decision path: **blocked** (identity per step, requester and sender barred, decision unique per step, compare-and-set update; decisions cannot be inserted by clients).
  - Code guessing: **exploit worked before the fix**: parallel wrong guesses were counted as one try (**20 of 20 accepted before; at most 4 after**, then lock). Class A (TB).
  - Code printed in the e-mail subject and therefore copied into the Event Log: **was the case before** (found by reading the code); the code is now in the body only and a unit test checks that the subject never carries it (TU).
  - "Submit for approval" picked any workflow and a requester could start it: **fixed in code** (VA-TKT-05, CODE).
  - **Open:** the "separation of duties" rule is closed only on the decide step; delegating, adding approvers and the other submit path let one person arrange who approves (VA-TKT-07); a manager can edit the live approver on a waiting step (VA-ADM-06, decision).
- **Evidence:** class A (TB) and B. Files 05 (approvals) and 06.

### Case 9 — Someone tries to download another person's attachment

- **Expected:** a file is downloadable only by people who can see the ticket, and internal files only by staff. A path from another ticket must not work.
- **How checked:** source review of the download routes (RLS read with the caller's session on every fetch; path must start with the ticket's own folder; content type from a fixed table; `nosniff`); T10 test 1 for the internal-file case; T10 test 4 for direct upload to the task-files store.
- **Result:** Ordinary request files: **blocked** by the row rules (reading). Internal-note file: **worked before, blocked after** (T10 test 1). Direct upload into the task-files store by an ordinary user: **worked before, refused after M164** (T10 test 4). Open: a user could forge a "file record" for a task they own pointing at another task's file path and read it; this needs the exact path (long random id), practical risk low (VA-TKT-09/VA-DB-10, Open).
- **Not testable here:** cross-company download. No dedicated "requester B downloads requester A's file over HTTP" test is recorded in the material I was given; the result for that case is from policy text and route code.
- **Evidence:** class A (T10) and B. File 06.

### Case 10 — Someone tries to manipulate report filters

- **Expected:** filters (group, assignee, store, date, pivot settings) can narrow what a person sees, never widen it beyond their role.
- **How checked:** **source review only.** `getFilteredRequests` re-derives scope from the session; `narrowScopeToGroups` validates ids and intersects with allowed groups; fixed reports and the executive dashboard re-apply scope; report recipients are re-validated at send time.
- **Result:** **No widening path found.** One related gap found by reading, not by a test: the Report Builder showed technician-only form fields to the requester for their own tickets (VA-ADM-04). Fixed in code (filtered for own and reports scopes). The browser rendering was not run. Open (Low): the pivot configuration from the browser is not validated, and exports are not all audited (VA-ADM-15).
- **Evidence:** class B. `review-admin-report-actions.md` §2.

### Case 11 — Someone sends a forged webhook

- **Expected:** a call to the WhatsApp, Gmail, Outlook or log-ingest address without the right signature or secret is refused and changes nothing.
- **How checked:** **source review** of the signature and token checks (WhatsApp HMAC-SHA256 on the raw body with constant-time compare; token compare for Gmail and Outlook; Outlook `clientState` per notification; ingest secret of 16+ characters). **HTTP probe H** for the public CSP-report endpoint (forged reports, see section 4). No forged Meta or Google call was made, and no real signature could be produced without their secrets.
- **Result:** the signature and token checks **hold on reading** (missing secret fails closed). The unauthenticated CSP-report endpoint was **floodable before the fix** (120 forged reports from invented source addresses made 120 System Log rows; **30 after**). Open (Low): the Gmail hook relies on one token in the URL and does not verify Google's signed token; the Outlook and WhatsApp hooks have no replay or timestamp guard; the WhatsApp verification page can be called repeatedly to cause database work (VA-API-12).
- **Not testable here:** real Meta/Google/Microsoft traffic.
- **Evidence:** class B for the checks, class A for the CSP probe. File 06 (webhooks) and file 05 (log flooding).

### Case 12 — Someone replays a request or creates a duplicate ticket

- **Expected:** sending the same message twice must not create two tickets, two comments or two approvals.
- **How checked:** source and catalog review of the unique keys: one ticket per intake message (`requests_one_per_intake_message`, migration 162), WhatsApp `UNIQUE(org_id, channel_type, external_message_id)`, e-mail claim row with unique Message-ID, approval code claimed by an update that needs `used_at IS NULL`, survey rating single-use through `submitted_at IS NULL`, one pending approval per ticket, one decision per approval step. TB covers the approval-code replay. The WhatsApp integration suites exist and ran in the default run; no replay-specific test was added in this assessment.
- **Result:** replays are **blocked where a unique key exists**. Gaps: a replayed Outlook notification has no timestamp guard (idempotent downstream, not re-proven); a replayed signed WhatsApp payload is de-duplicated but still re-sends the last prompt to the user (bounded by 30 messages per minute per sender; observation, not a finding).
- **Not examined (Not Verified):** whether an ordinary portal submit (double click on "Create request") has an idempotency key. The reviews looked at e-mail and WhatsApp creation, not at double submission in the portal.
- **Evidence:** class B, TB for codes (class A).

### Case 13 — Someone invokes an admin server action directly

- **Expected:** an admin action called by an ordinary user, by a script, or through a path the screen never links must refuse, because each action checks the caller's role itself (the page redirect is not a protection).
- **How checked:** source review of all 54 action files (file 01 §4.4); TU and `tests/unit/target-guard.test.ts` for the target guard; H probe for the side door in the proxy. **Not done:** posting a real Next.js action id to an admin action as a requester and reading the answer. No such test is recorded.
- **Result:** every admin action reads the caller's profile and rejects roles outside its list. Findings: the lists are **wider than the database or the screens intend** in several places (managers allowed on settings, Business Rules, workflow steps, org lists; VA-ADM-03, VA-TKT-02, VA-ADM-06, decisions open); two admin pages rely on the layout only (VA-ADM-13); five actions rely on row rules only (no explicit sign-in check). The proxy side door (any path ending `.png` skipped the session check and the public-form size cap, so actions could be posted to such an address) is **fixed** in LOCAL (VA-API-04, section 4).
- **Evidence:** class B and TU/H (class A). Files 01, 05.

### Case 14 — Someone tries to modify configuration through the database API

- **Expected:** a configuration table the screens reserve for administrators cannot be written by a manager, even with their own valid login and the public key (the browser holds both).
- **How checked:** T11 tests 5 and 6 (before and after M164).
- **Result:** **Exploit worked before** for `services`, `sla_policies`, `global_sla_config` and `field_sla_overrides` (a manager's PATCH changed them). **Refused after M164**; the administrator can still write. **Not fixed:** about 20 further configuration tables (for example form templates, categories, stores, OEMs, assignment rules, alert rules, approval workflows) stay writable by managers in the database (Requires Decision, VA-DB-03 rest). The reverse gap also exists: global settings are database-reserved for the platform owner, but app actions let managers and admins edit them (VA-ADM-03).
- **Evidence:** class A. T11 tests 5-6; M164.

### Case 15 — Malicious content against an AI feature

- **Expected:** hostile text in a ticket or e-mail ("ignore your instructions and ...") must not make any automated system change data, leak data, or act for the attacker.
- **What exists (from the code):** **no language model reads, creates or changes tickets.** Two optional uses exist and both are off unless a model key (`INTAKE_LLM_API_KEY`) is set: (1) a reviewer-only e-mail summary in the web app (`lib/actions/intake/brief.ts`; role check, first 2,000 characters in, output shown as plain text, no tools); (2) an optional second-stage mail classifier in the separate intake worker (`api/src/intake/classify/local-model-classifier.ts`) whose output is a suggestion (type, priority) placed in a human review queue; a person must click to create the ticket. The "Catch me up" ticket summary is built from the ticket's own history by fixed rules, with no model.
- **How checked:** **source review only.** No model key is configured on the audit stack and no connection to a model provider is allowed, so nothing could be run.
- **Result:** hostile text can at most distort a suggestion or a summary that a person then reads. There is no tool call or write path for a model to abuse. Whether the key is set in production is not known from the repository (data request below). Related, and not model-based: the mail viewer shows e-mail HTML in a sandbox without scripts, but its "block remote images" step is incomplete and a mail can redirect its own frame (VA-INT-12, Low, open).
- **Evidence:** class B. `review-uploads-email-whatsapp.md` §2.

---

## 4. HTTP probes (H) against the audit app

Made by the lead tester against the audit app on 127.0.0.1:3310 (old build = before the fixes; fixed build = Next.js 16.3.8 with the fixes). The raw request and response captures were **not among the files given to me**; the facts below are as reported in the task brief. They are class A as reported, and should be backed by saved captures before an auditor sees this.

| # | Probe | Old build | Fixed build | What it tells us |
|---|---|---|---|---|
| H1 | The image optimizer (`/_next/image`) with different formats and remote URLs | serves **only webp and png**; **remote image URLs are refused with 400** | same | The conditions for the AVIF remote-code-execution advisory and the image-optimizer SSRF advisory are not met by our configuration (file 02 §3.3). It does not remove the need to upgrade |
| H2 | An unauthenticated request to `/requests/x.png` (a page-looking path ending in `.png`) | redirected by the **page layout** (not the proxy) | now decided by the proxy: the unit test expects a 307 to `/login` (an HTTP result on the fixed build was not separately reported) | The old proxy side door (VA-API-04) did **not** give a stranger access to a ticket. The finding was **defence in depth**, not a login bypass. The proxy rule is now root-level files only (TU + `header-trust` test) |
| H3 | 120 forged CSP reports posted with invented `X-Forwarded-For` values | **120** System Log rows | **30** System Log rows | Anyone could fill the System Log; now capped (VA-API-07, VA-INT-08, VA-ADM-08) |
| H4 | A cross-site POST to `/auth/confirm` (login CSRF) | processed (**303**) | refused (**403**); a **same-origin** POST still works | Fixed with an `Origin` / `Sec-Fetch-Site` check (VA-API-08) |
| H5 | Response headers | `X-Powered-By` present | `X-Powered-By` **absent** | Framework banner removed (VA-API-14) |

Not probed: HTTPS, cookie flags on the real site, rate limits per address (needs the production proxy chain), and anything on production.

---

## 5. What this testing did not and could not show

- Everything that needs a real Gmail mailbox, Meta WhatsApp account, Microsoft or Google OAuth: logic was tested, not the live service (details in file 06).
- Cross-company behaviour: the audit database has one organisation.
- Production configuration (HTTPS, login-service self sign-up, cookie flags, firewall). VA-DB-08 stays **Not Verified**.
- Concurrency at scale, denial-of-service by large or crafted files (the spreadsheet preview issue VA-API-06/VA-INT-04 is still open), and the 10-25 MB upload size change (**Not Verified** dynamically; confirm with a 20 MB upload in acceptance testing).
- Social engineering, physical access and the servers themselves.

## Open questions / evidence requests for management

1. Please decide the open policy questions that decide whether Cases 4, 6, 8, 13 and 14 end as "blocked": may managers write Business Rules, approval-workflow steps, global settings and the other configuration tables? Owner name to be assigned by management.
2. Please decide whether the intake reviewer may still choose a ticket's priority when creating a ticket from an e-mail (VA-ADM-09).
3. Please confirm whether `INTAKE_LLM_API_KEY` is set on the production app server or intake worker, and which provider (Case 15).
4. Please authorise a short acceptance test of a 20 MB attachment upload on the local stack after the next build.
5. Please arrange a one-off test of a portal double submit (Case 12) and an HTTP-level test of requester B downloading requester A's attachment, both on the local stack.
6. Please provide, if an external assessor will rely on this log, the saved raw captures of probes H1 to H5 (the lead tester to save them into `02-VAPT/work/`).
