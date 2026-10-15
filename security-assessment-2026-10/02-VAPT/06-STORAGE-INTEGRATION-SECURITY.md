# 06 — Storage and Integration Security (VAPT of Citykart Desk, CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This file covers files (upload, download, storage), e-mail in and out, WhatsApp, the mail webhooks, the Google/Microsoft sign-in connections (OAuth), and the intake side (the mailbox reviewer screens and the separate intake worker). Findings carry the prefix VA-INT (integration) or relate to it.

The same plain-language template is used for every finding. Statuses come only from `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`. Evidence classes: **A** verified LOCAL technical evidence (tests T10, T12, TU named in file 03); **B** repository evidence (source read); **E** not verified.

**An honest limit that runs through this whole file:** the disposable test stack has no real Gmail mailbox, no Meta WhatsApp account, no Microsoft or Google sign-in connection and no running intake worker, and it is not allowed to reach the internet. So what happens with real mail, real Meta calls and real mailbox behaviour is **not proven**. Where a test exists, it is a logic-level test of our own code. Section 4 lists exactly what could not be proven.

"Fixed in LOCAL" means changed in the working copy and tested on the disposable stack; it is **not deployed**. Production runs build `20261015-145217` (main `717e5c6`), which contains none of these fixes. Nothing here was tested on production.

---

## 1. Findings: files and storage

### VA-INT-01 / VA-TKT-04 / VA-DB-06 (file-store part) — A file attached to an internal note was stored as a normal file, so the requester could list and download it
- **Severity:** Medium.
- **Where found:** `lib/actions/attachments.ts` (always wrote `is_internal: false`), policy `request_attachments_select`, storage policy `storage_request_attachments_select`, `lib/requests/ticket-pdf-model.ts`, `lib/actions/ticketCopy.ts`, the History tab (file name in `request_activity`).
- **What is wrong?** When a technician writes a private internal note and attaches a file (a quote, a screenshot with other people's details), the system marked the file as normal. The requester could not see it on the page, but could list the file record and download the file straight from the API, and the file name showed up in the ticket PDF, the copy e-mails and the history.
- **Why does it matter to Citykart?** Staff-only information (escalation e-mails, vendor quotes, diagnostics, sometimes other people's data) reached the requester.
- **How was it checked?** Exploit test T10 test 1: a technician posts an internal note with a file; the requester tries to list and download it. It worked on the old stack and is refused on the fixed stack. Code and policy reading confirmed the cause.
- **What was changed?** `uploadAttachment` now copies the comment's internal flag to the file; migration 164 back-fills old rows (`UPDATE request_attachments SET is_internal = true WHERE comment_id IN (internal comments)`) and tightens the file-store read rule (same organisation, and not internal unless staff).
- **What happened after the fix?** T10 test 1 passes: the requester cannot list or download it and the file is flagged internal.
- **Status:** **Fixed in LOCAL**.
- **What remains:** deploy (the migration back-fill matters for existing files on production); the History tab also recorded the file name of an attachment; whether that row is hidden for internal-note files was not confirmed in the material I was given (check in acceptance testing); the insert-policy organisation tests are VA-DB-06 rest in file 04 (Open).
- **Technical evidence:** `tests/vapt/10-confidentiality-exploits.test.ts` test 1; `supabase/migrations/20240101000164_vapt_security_hardening.sql` (lines 74-93); `lib/actions/attachments.ts` (modified); `review-uploads-email-whatsapp.md` VA-INT-01; `review-ticket-actions.md` VA-TKT-04.

### VA-INT-10 / VA-DB-05 (upload part) — Any signed-in user could upload files straight into the task-files store, skipping the app's checks
- **Severity:** Low-Medium (as found: Medium in the database review).
- **Where found:** storage policy `task_attach_storage_insert` (role public, `auth.uid() IS NOT NULL`, no path rule), `lib/actions/task-attachments.ts`, `lib/actions/attachments.ts`, `lib/attachments/validate.ts`.
- **What is wrong?** The upload screen checks file type, size and the real file signature. But the file store accepted a direct upload from any signed-in person into the task-files folder, with no checks, up to 25 MB each and no quota. The folder's allowed list even contains SVG pictures.
- **Why does it matter to Citykart?** Unchecked content on the NAS, storage use without limit, and a way to place files that a later flaw could expose.
- **How was it checked?** Exploit test T10 test 4: a direct Storage API upload by an ordinary user: accepted before, refused after.
- **What was changed?** Migration 164 drops `task_attach_storage_insert`. All real uploads already go through the server.
- **What happened after the fix?** T10 test 4 passes (direct upload refused).
- **Status:** **Fixed in LOCAL** (upload part).
- **What remains:** no per-user or per-minute limit and no daily quota on the two upload actions; no virus scan (there is a `VIRUS_SCAN_HOOK` comment only); macro-capable formats (`.doc`, `.xls`, `.ppt`) are allowed; SVG is still on the bucket's type list; task attachments are stored but no download route exists for them (a functional gap, and the files are never deleted); a user can still forge a file record for their own task that points at another task's file (VA-DB-10 in file 04, Open).
- **Technical evidence:** `tests/vapt/10-confidentiality-exploits.test.ts` test 4; migration 164 line 94; `review-uploads-email-whatsapp.md` VA-INT-10; `review-database-rls.md` VA-DB-05.

### VA-API-06 / VA-INT-04 / VA-ADM-18 — The spreadsheet preview and the Store Master upload believe the size written inside the file
- **Severity:** Medium (availability; any requester can attack the single app process).
- **Where found:** `lib/attachments/xlsx-preview.ts`, `app/api/storage/attachment/request/[id]/preview/route.ts`, `lib/stores/master-file.ts`.
- **What is wrong?** The preview tries to refuse "booby-trapped" spreadsheets by reading how big the file says it will become when unpacked. A crafted file can lie: a few kilobytes that expand to gigabytes when the preview opens it. The Store Master import loads a 5 MB spreadsheet in the web process with no check of uncompressed size or column count.
- **Why does it matter to Citykart?** One crafted file attached to a ticket and previewed by anyone could run the single Node process out of memory and disconnect every user.
- **How was it checked?** Source reading (the code path is unambiguous; the crash is "plausible", not shown). The crafted-file test was not run.
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Open** (the status table notes "see the changelog for any later fix").
- **What remains:** inflate with a hard output cap (streaming unzip with a byte counter) or run the parse in a worker process with a memory limit and timeout; cap uncompressed size, rows and columns for the Store Master import.
- **Technical evidence:** `review-api-proxy-auth.md` VA-API-06; `review-uploads-email-whatsapp.md` VA-INT-04; `review-admin-report-actions.md` VA-ADM-18.

### Upload size observation — a 10 to 25 MB attachment may be cut off silently
- **Severity:** Medium (plausible).
- **Where found:** `next.config.ts` (Server Action limit 30 MB, attachment cap 25 MB) with `proxy.ts` in front; Next.js buffers a request body up to 10 MB by default when a proxy file exists.
- **What is wrong?** The app allows 25 MB attachments, but with the proxy file in front the framework probably cuts the body at 10 MB. If the truncated multipart request were accepted, the file would arrive incomplete.
- **Why does it matter to Citykart?** Broken or partial attachments, and a possible integrity problem.
- **How was it checked?** Reading the framework's own documentation in `node_modules` and the config. Not tested with a real large file.
- **What was changed?** `experimental.proxyClientMaxBodySize: '30mb'` in `next.config.ts` (the audit build log shows it active).
- **What happened after the fix?** Not tested.
- **Status:** **Not Verified** dynamically (the status table: confirm with a 20 MB upload in acceptance testing).
- **What remains:** one 20 MB upload test on the local stack; confirm the production reverse proxy (port 8443 / 3210 path) does not impose its own limit.
- **Technical evidence:** `next.config.ts`; `02-VAPT/work/audit-build.log`; `review-uploads-email-whatsapp.md` observation 1.

---

## 2. Findings: e-mail, notifications, intake and WhatsApp

### VA-INT-03 / VA-TKT-03 — The start of an internal note was sent by bell and e-mail to people who cannot read the note
- **Severity:** Medium.
- **Where found:** `lib/actions/requests.ts` (`addComment`, `addCollaborator`), `lib/notifications.ts`, `lib/email/notify-email.ts`.
- **What is wrong?** The screen correctly hides internal notes, but the "new internal note" alert and the "you were mentioned" alert carried the first 120 characters of the note into the person's notification and into an e-mail. Collaborators can be any employee, and an @mention picked the first colleague with a matching first name, whoever that was.
- **Why does it matter to Citykart?** A technician's private remark ("customer is a repeat complainer, do not refund") could reach the customer or an unrelated employee with the same first name.
- **How was it checked?** Exploit test T10 test 2: an ordinary-user collaborator is added, an internal note is posted, and the notifications are read: the note text arrived before and does not now.
- **What was changed?** Recipients of an internal note are filtered to staff; @mentions go only to people who may read the ticket.
- **What happened after the fix?** T10 test 2 passes (no notification carrying the note text reaches the ordinary-user collaborator).
- **Status:** **Fixed in LOCAL**.
- **What remains:** mentions are still resolved by first name rather than chosen from a list (VA-TKT recommendation); adding non-staff collaborators remains possible; deploy.
- **Technical evidence:** `tests/vapt/10-confidentiality-exploits.test.ts` test 2; `lib/actions/requests.ts` (modified); `review-uploads-email-whatsapp.md` VA-INT-03.

### VA-INT-02 — An e-mailed reply was accepted from any employee, or any person at a vendor (OEM), for any ticket number
- **Severity:** Medium.
- **Where found:** `lib/email/inbound.ts` (`resolveKnownSender`, ticket chosen from the subject tag), `lib/email/inbound-match.ts`, `lib/requests/email-reply-comment.ts`.
- **What is wrong?** Anyone who could send a mail to the help-desk mailbox with a ticket number in the subject (for example `[CKSD-000123]`) and a Citykart address had the text added to somebody else's ticket as a normal comment, under their own name. The same was true for any staff member of a vendor company, for every ticket. Ticket numbers are sequential and guessable.
- **Why does it matter to Citykart?** A way around the website's access rules: a store cashier could write into the CEO's ticket, and notifications went to the real participants.
- **How was it checked?** Logic-level test T12 on the isolated stack (no Gmail mailbox is available): who is accepted as a participant. Before the fix an unrelated employee was accepted. **Not tested with a real mailbox.**
- **What was changed?** The sender must now take part in the ticket (requester, assignee, collaborator, a member of its group, a manager, or the vendor the ticket was sent to). Otherwise it is recorded as "sender not recognised", as before.
- **What happened after the fix?** T12 passes 4 of 4: the requester, assignee, group technician and manager may; an unrelated employee and a technician of another group may not; a collaborator may; a vendor may answer only a ticket sent to it.
- **Status:** **Fixed in LOCAL** (evidence level: LOGIC).
- **What remains:** a real-mailbox test; deploy; replies from non-participants should still be visible to a reviewer for follow-up (the existing staff note).
- **Technical evidence:** `tests/vapt/12-email-reply-participant.test.ts`; `lib/email/inbound.ts` (modified); `review-uploads-email-whatsapp.md` VA-INT-02.

### VA-INT-07 — The "who really sent this e-mail?" check has three weak spots
- **Severity:** Low (becomes Medium only if a spoof works together with an unfixed participant check).
- **Where found:** `lib/email/inbound-auth.ts`, `lib/email/inbound.ts`.
- **What is wrong?** The check accepts a message in three cases where it should not: when there is no verdict at all ("unchecked"), when the passing verdict is about another domain than the one in the From line, and when a message carries two From lines (the mail library keeps the last, while the mail provider judges the first).
- **Why does it matter to Citykart?** A crafted message could be attributed to an employee. After the VA-INT-02 fix it also has to be a participant of that ticket, which limits the harm.
- **How was it checked?** Source reading; unit-level reasoning only. What Gmail really writes into the verdict header, and how it handles a duplicate From line, needs a real mailbox.
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Open**.
- **What remains:** reject any message with more than one From header; require the DMARC "header.from" to match the sender's domain; treat "unchecked" as a note for review.
- **Technical evidence:** `review-uploads-email-whatsapp.md` VA-INT-07; `tests/unit/inbound-auth.test.ts`.

### VA-INT-09 — No protection against automatic replies and mail loops
- **Severity:** Low.
- **Where found:** `lib/email/send.ts`, `lib/email/inbound.ts`.
- **What is wrong?** Outbound notification mail carried no "this is automatic" headers, and inbound mail was never checked for them, so a colleague's out-of-office answer was posted to the ticket as their comment and could start a chain of automatic mails.
- **Why does it matter to Citykart?** Noise, wasted notifications, and in rare cases a ping-pong between two out-of-office responders.
- **How was it checked?** Source reading.
- **What was changed?** Outbound mail now carries `Auto-Submitted` and `X-Auto-Response-Suppress`; inbound automatic replies are skipped.
- **What happened after the fix?** Code-level evidence only (CODE).
- **Status:** **Fixed in LOCAL** (CODE).
- **What remains:** a real-mailbox test with an out-of-office reply.
- **Technical evidence:** `lib/email/send.ts`, `lib/email/inbound.ts` (modified); `review-uploads-email-whatsapp.md` VA-INT-09.

### VA-INT-06 — The one-time approval code was written in the e-mail subject and therefore in the Event Log
- **Severity:** Low-Medium.
- **Where found:** `lib/actions/approvalEmail.ts` (subject), `lib/email/send.ts` (records "Email sent: <subject>" in the Event Log; prints the subject to the console when no mailbox is set).
- **What is wrong?** The six-digit code that proves "this is really the approver" was in the subject line, and the system logs every subject, so the code ended up in the admin log screens.
- **Why does it matter to Citykart?** An administrator, or anyone who can read the logs and also holds the approval link, could read the code within its 10 minutes and decide as the approver.
- **How was it checked?** Source reading; unit test TU ("the approval code is never put in the subject of the mail").
- **What was changed?** The code is in the body only; the subject is generic ("Your Citykart Desk verification code").
- **What happened after the fix?** TU passes. Existing integration and remediation tests were updated to read the code from the body.
- **Status:** **Fixed in LOCAL**.
- **What remains:** production (which still sends the code in the subject) may hold old codes in its Event Log (each was single use and has expired); the saved logs still show approval-code tests failing (file 02 §5), probably the test helper reading the wrong number, which needs a clean re-run.
- **Technical evidence:** `lib/actions/approvalEmail.ts`, `lib/email/send.ts` (modified); `tests/unit/vapt-hardening-units.test.ts`; `tests/integration/approval-email-link.test.ts`, `tests/remediation/110-approval-hardening.test.ts` (modified).

### VA-INT-05 / VA-ADM-07 — The OEM e-mail template preview ran stored HTML without cleaning it (stored script from manager to administrator)
- **Severity:** Medium.
- **Where found:** `components/admin/RichEmailEditor.tsx` (preview uses `dangerouslySetInnerHTML`), policy `oems_admin` (managers have full write), `lib/actions/admin/oems.ts`.
- **What is wrong?** The template is cleaned when saved through the normal button, but the database also lets a manager write the template directly, skipping the cleaning. The preview then showed the raw stored text, so a booby-trapped template would run in the administrator's browser with the administrator's rights. The browser policy is report-only, so nothing blocked inline scripts.
- **Why does it matter to Citykart?** A manager could take over an administrator's or platform owner's session and call any admin action as them.
- **How was it checked?** Source reading (the path is clear; the browser run was not done).
- **What was changed?** The preview is now built from the editor's own cleaned HTML.
- **What happened after the fix?** Code-level evidence only (CODE; the browser render was not run).
- **Status:** **Fixed in LOCAL** (CODE).
- **What remains:** make `oems` writes administrator-only at the database as well (a decision, see VA-DB-03 rest); enforce the browser policy once HTTPS exists (VA-API-01). It is the only other use of `dangerouslySetInnerHTML` besides a constant theme script.
- **Technical evidence:** `components/admin/RichEmailEditor.tsx` (modified); `review-uploads-email-whatsapp.md` VA-INT-05; `review-admin-report-actions.md` VA-ADM-07.

### VA-ADM-01 / VA-ADM-14 — The saved intake-mailbox password could be redirected to any mail server; the mail-server address check could be bypassed
- **Severity:** Medium (VA-ADM-14: Low).
- **Where found:** `lib/actions/intake/channels.ts` (`connectChannel`, `testChannel`, `pollNow`), `lib/validation/mail-host.ts`, `api/src/intake/credentials.ts`.
- **What is wrong?** The intake-mailbox edit screen lets an administrator leave the password empty to "keep the old one". It also let the administrator type a different mail server, so the saved password was silently sent to whatever server was typed. The shortcut spellings `127.1`, `0177.0.0.1`, `0x7f.0.0.1` passed the mail-server check.
- **Why does it matter to Citykart?** The password is meant to be write-only. This turned it into something an administrator (or an attacker using an admin session) could read out, and allowed port probing of internal machines through the test button.
- **How was it checked?** Source reading (confirmed by code). The end-to-end capture needs the running worker. Unit test TU for the address forms (existing test file `tests/unit/mail-host.test.ts` as well).
- **What was changed?** Changing the host, port or user now requires entering the password again; the host is validated; the numeric check is stricter.
- **What happened after the fix?** TU: the shortcut spellings of the local machine are refused and real mail servers (by name and by plain private address) are still accepted. The channel behaviour is CODE evidence.
- **Status:** **Fixed in LOCAL** (VA-ADM-01 CODE; VA-ADM-14 TU).
- **What remains:** resolve the name at connect time and reject loopback/link-local results; return generic errors from the test button; real-worker test.
- **Technical evidence:** `lib/actions/intake/channels.ts`, `lib/validation/mail-host.ts` (modified); `tests/unit/vapt-hardening-units.test.ts`; `review-admin-report-actions.md` VA-ADM-01, VA-ADM-14.

### VA-ADM-10 / VA-ADM-11 — Intake rule patterns could hang the worker; any employee could add notes to staff mail threads
- **Severity:** Low-Medium (VA-ADM-10); Low (VA-ADM-11).
- **Where found:** `lib/actions/intake/rules.ts`, evaluated in `api/src/intake/classify/rule-classifier.ts`; `lib/actions/intake/communication.ts` (`addNote`).
- **What is wrong?** An administrator-typed pattern is run on the text of mail from strangers; a pattern such as `(a+)+$` with a crafted mail makes the worker spin for minutes. Separately, `addNote` had no role check, so a requester could write "internal" notes on staff mail threads that technicians then read as colleagues' notes.
- **Why does it matter to Citykart?** Denial of service of the mail intake; forged internal remarks.
- **How was it checked?** Source reading (confirmed by code); not run.
- **What was changed?** Patterns now have a length cap and nested repeats are refused when a rule is saved; `addNote` needs a reviewer role.
- **What happened after the fix?** Code-level evidence only (CODE).
- **Status:** **Fixed in LOCAL** (CODE).
- **What remains:** the fix checks a pattern when a rule is saved, so rules saved earlier were not reported as re-checked; the worker itself is unchanged (a safe regex engine or a time limit would be stronger); the database note policy has no role condition (inert today because the table has no insert right for signed-in users).
- **Technical evidence:** `lib/actions/intake/rules.ts`, `lib/actions/intake/communication.ts` (modified); `review-admin-report-actions.md` VA-ADM-10, VA-ADM-11.

### VA-INT-12 — The intake mail viewer does not fully block remote images, and a mail can redirect its own frame
- **Severity:** Low.
- **Where found:** `app/(app)/intake/_components/EmailBody.tsx`.
- **What is wrong?** The viewer blocks only some picture forms, so a mail can still tell its sender "read, from this address" and can show a fake page inside the frame. The frame has no script permission, so no code can run.
- **Why does it matter to Citykart?** Reviewer privacy and in-frame phishing; no code execution.
- **How was it checked?** Source reading.
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Open**.
- **What remains:** add a restrictive content policy inside the frame and strip `meta`, `link`, `base` tags before display; load remote images only on a click.
- **Technical evidence:** `review-uploads-email-whatsapp.md` VA-INT-12.

### VA-API-12 — Webhook design weaknesses (Gmail, Outlook, WhatsApp)
- **Severity:** Low.
- **Where found:** `app/api/intake/webhook/gmail|outlook|whatsapp/route.ts`, `lib/whatsapp/signature.ts`, `lib/whatsapp/webhook-handler.ts`, `lib/whatsapp/config.ts`.
- **What is wrong?** The checks are right where they exist (WhatsApp: HMAC-SHA256 on the raw body with a constant-time compare, fails closed; Gmail and Outlook: constant-time token compare, Outlook also re-checks its `clientState` per notification). The weak points: the Gmail hook relies on one token in the web address and does not verify Google's signed token; Outlook and WhatsApp have no timestamp or replay guard; the Outlook GET echoes any validation token; the WhatsApp GET challenge can be called repeatedly and costs a database and vault read each time.
- **Why does it matter to Citykart?** Tokens in web addresses end up in access logs; a replayed message could re-trigger work; steady load could be placed on the database.
- **How was it checked?** Source reading (confirmed by code for the missing limits; replay behaviour is "plausible"). **No forged or genuine Meta, Google or Microsoft call was made.**
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Open** (listed among the Low items).
- **What remains:** verify the Pub/Sub signed token; rate-limit the GET challenge and cache verify tokens briefly; reject WhatsApp events older than a few minutes if the payload carries a timestamp; set `TRUSTED_PROXY_HOPS` so per-address limits work (VA-API-03).
- **Technical evidence:** `review-api-proxy-auth.md` VA-API-12; `review-uploads-email-whatsapp.md` observations 5 and 6.

### D-025 (earlier audit, re-checked in `01-BASELINE/03-EXISTING-AUDIT-RECONCILIATION.md`) — A signed-in user can store any web-push address through the data API, and the server later posts to it
- **Severity:** Medium in the earlier audit; the status table lists it among the Low open items.
- **Where found:** `lib/actions/push.ts`, `lib/push/endpoint.ts`, `lib/push/send.ts`, policy `push_subscriptions_own`.
- **What is wrong?** The screen action checks the push address against a deny-list, but the database policy lets any signed-in user insert any address directly, and the sending code posts to the stored address without checking it again. A public name that points inside the network would pass a deny-list.
- **Why does it matter to Citykart?** The server can be made to send requests to an address the user chose (a "blind" request forgery toward internal machines).
- **How was it checked?** Re-read of the code and policy during the baseline reconciliation (class B). Not exploited; the web-push feature is off unless VAPID keys are set.
- **What was changed?** Nothing in this assessment.
- **What happened after the fix?** Not applicable.
- **Status:** **Open** (Low list in the status table).
- **What remains:** re-validate at send time and in a database trigger; prefer an allow-list of real push hosts; confirm whether push is enabled in production.
- **Technical evidence:** `01-BASELINE/03-EXISTING-AUDIT-RECONCILIATION.md` (D-025 row); `tests/unit/push-endpoint.test.ts` (covers the action only).

### Findings in this area written up in other files

- VA-INT-13 / VA-DB-07 (mobile numbers readable by everyone; a manager could attach a number to anyone) — **Fixed in LOCAL for the numbers, T10 test 3** — file 04.
- VA-INT-08 / VA-API-07 / VA-ADM-08 (floodable log endpoint) — **Fixed in LOCAL, probe H3** — file 05.
- VA-INT-11 (approval link and code hardening) — file 05, under VA-DB-11 / VA-TKT-13.
- VA-API-05 (one secret reused; the Outlook connection places the secret in a URL that Microsoft stores) and VA-API-10 — file 05.
- VA-ADM-17 (outside address added as "OEM contact") — file 05.

### Observations with no status in the status table (recorded, not hidden)

1. The avatar bucket is read by `app/api/storage/public/...` and written by `uploadAvatar`, but no migration creates an `avatars` bucket (the audit database has `request-attachments`, `task-attachments`, `intake-attachments`, `icons`). Avatar upload fails unless the bucket was created by hand in production. A functional point.
2. The intake worker's MP4 signature check expects bytes that are never present, so genuine MP4 attachments in mail are refused (the web copy of the check was fixed, the worker's was not).
3. A replayed, identical, signed WhatsApp message is de-duplicated, but the last prompt is sent to the user again (bounded by 30 messages per minute per sender).
4. Phone numbers are stored in `intake_audit_log` metadata (`from`): personal data in logs; retention to be decided.
5. `sendFromMessage` lets any technician send mail to arbitrary recipients from the organisation's intake mailbox through the worker: by design for staff, but an open relay for a compromised technician account.

---

## 3. Controls found sound (read, class B)

| Area | What is in place |
|---|---|
| **Download of request files** | the file row is read with the caller's own row rules on every request; the path must start with the ticket's own folder; type comes from a fixed extension table (images, PDF, plain text open inline; all else downloads); `X-Content-Type-Options: nosniff`; `Cache-Control: private, no-store`; SVG and HTML are not served inline |
| **Intake attachments** | exactly three clean path segments; always a forced download; `nosniff`; row rules limit to technician-and-above of the same organisation |
| **Public files** | only the `icons` and `avatars` buckets; a strict file-name shape; type from the extension; images only |
| **Upload checks** | 25 MB cap; extension and type allow-lists (no SVG or HTML); real-signature (magic-byte) check for the common types; file names reduced to safe characters and prefixed with the ticket id, time and a random part; no overwrite; an orphan file is removed if the database insert fails; the comment must belong to the same ticket; a database trigger forces the stored path to start with the ticket id and freezes path, name and ticket |
| **WhatsApp media** | the same allow-list, size and signature checks; staged under a private folder and moved to the ticket path only after the ticket exists |
| **Ticket PDF** | built from a data model (no HTML, no remote resources, no outbound requests); internal notes and internal files left out; file name made of safe characters only; UUID check on the id |
| **Outbound e-mail** | every field HTML-escaped; vendor templates cleaned on save and again before sending with an allow-list of tags and addresses; header injection prevented by the mail library; copies go only to Citykart users and listed vendor contacts, at most 5, only the author's own public comment within 15 minutes |
| **Inbound e-mail** | the sender is read from the structured From field and a message without exactly one plain address is rejected; mail failing Google's DMARC/SPF/DKIM verdict is not attributed; replies are always public comments (never internal notes, never status changes except the requester's own wait-resume); duplicates blocked by a claim row and a unique Message-ID; inbound attachments are ignored |
| **WhatsApp** | HMAC-SHA256 on the raw body; the channel is chosen by the destination phone-number id, never by the sender; mixed phone numbers refused; one ticket per message id; per-sender limits; the sender must be a registered, active, WhatsApp-enabled profile; outbound sends go only to the sender of a signed message |
| **OAuth (Gmail/Outlook)** | start and callback require admin or platform owner; state is HMAC-signed, 15 minutes, bound to the admin who started it; credentials go to the vault through a service-role function; token and authorize addresses are fixed provider URLs (no user-controlled address is fetched anywhere) |
| **Secrets** | mailbox password, WhatsApp, OAuth and DeskTime secrets stored in the encrypted database vault by service-role functions only; the screens receive only host, port, user and "has password"; audit metadata excludes passwords; the log redactor hides tokens, keys, e-mails and phone numbers |
| **Outbound HTTP** | calls go only to fixed hosts or configured worker addresses: no request to a user-supplied address (no SSRF path found) |
| **AI** | no language model creates or changes tickets. The reviewer-only mail summary (`lib/actions/intake/brief.ts`) and the optional Stage-2 mail classifier in the intake worker are both off unless `INTAKE_LLM_API_KEY` is set; their output is shown as text or a suggestion for a human; no tool use; the summary takes the first 2,000 characters only |

---

## 4. What could not be proven without a real mailbox, Meta account or live service

| Item | What was done | What is missing |
|---|---|---|
| E-mail reply acceptance (VA-INT-02) | logic-level test T12 on our own functions | a real Gmail inbox receiving a real reply with a ticket tag; how Gmail writes its verdict header; duplicate From handling (VA-INT-07) |
| Automatic-reply skipping (VA-INT-09) | code reading | a real out-of-office reply |
| Outbound mail content and headers | code reading; mail trap shows the local auth mail only | delivery through the company mailbox, SPF/DKIM/DMARC of the sending domain, display in real mail clients |
| Webhooks (Gmail Pub/Sub, Outlook Graph, WhatsApp) | code reading of signature and token checks | real signed calls from Meta, Google, Microsoft; behaviour of replays; load of the GET challenge |
| OAuth connect and token storage | code reading | a real consent flow and callback; what the vault stores |
| WhatsApp media download and staging | code reading; existing integration suites with the Meta boundary stubbed | real media from Meta |
| The intake worker `api/` (IMAP polling, classification, send) | only its helper files and secret check were read | running the worker; whether it runs in production |
| Language model behaviour | code reading | any real model call (no key, no internet) |
| Antivirus on the NAS, share permissions, NAS snapshots | not assessed | evidence from the NAS owner |
| Whether the storage API on port 8443 is reachable from outside | not assessed | firewall and router rules |
| Large uploads (10 to 25 MB) and decompression bombs | config reading; crafted file not built | dynamic tests on the local stack |

## Open questions / evidence requests for management

1. Please arrange a controlled test with a real, dedicated test mailbox (not the live help-desk mailbox) so the reply-sync findings (VA-INT-02, VA-INT-07, VA-INT-09) can be proven end to end. Owner to be assigned by management.
2. Which intake channels are active in production (Gmail API, Outlook, IMAP, WhatsApp), and is the intake worker (`api/`) deployed? Please supply the list of channel types and their status from the Intake > Channels screen (no credentials).
3. Is a virus scan on the NAS or in the upload path in place or planned? Who owns it? (No scan exists in the code; a hook comment only.)
4. Which file formats must really be accepted? Please approve removing macro-capable Office formats or accepting the risk with a named owner (VA-INT-10 rest).
5. Is `INTAKE_LLM_API_KEY` set anywhere in production, which provider, and has a data-processing agreement been signed? (Mail text of up to 2,000 characters goes to that provider.)
6. Evidence of the contracts or data-processing terms with Google (mailbox), Meta (WhatsApp), Microsoft (if used) and DeskTime. None is in the repository.
7. Retention decision for phone numbers kept in the intake audit log and for stored e-mail copies.
8. Please approve a 20 MB upload test and a crafted-spreadsheet test on the local stack (upload-size observation, VA-API-06/VA-INT-04).
9. Please confirm the avatar storage bucket exists in production, and whether avatars are meant to be used.
