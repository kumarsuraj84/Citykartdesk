# VA-INT review: uploads / downloads, inbound and outbound e-mail, WhatsApp and intake channels, output encoding

Scope: LOCAL white-box source review only. No file other than this report was written, no command other than read-only source reads and `SELECT`/catalog queries against `supabase_db_ckdesk_audit`. Nothing was executed against the app. Current checkout (branch `vapt/local-2026-10`), earlier `D-0xx` fixes re-verified by reading the code.

Severity scale: Critical / High / Medium / Low. No Critical or High issue was found in this slice; the earlier fixes (D-020, D-028, D-051..D-057, D-058/D-059, D-060, D-061/D-062) are present and hold up. The real findings are authorisation gaps around **internal notes** and **inbound e-mail**, plus a handful of hardening items.

Dynamic-proof recipes use the fixtures in `tests/setup/fixtures.ts` (synthetic users: requester A/B, technician of team T, manager). "Browser/PostgREST" means a session cookie / JWT of that user against the audit stack (API :55421, app :3310).

---

## 1. Candidate vulnerabilities

### VA-INT-01 - Files attached to an internal note are stored as "public" and can be read (name and content) by the requester
- **Severity:** Medium. Confidentiality break of staff-only information; any requester can do it to their own tickets; needs only a technician to attach a file to an internal note (a normal action).
- **Module:** `lib/actions/attachments.ts`, RLS `request_attachments_select`, `lib/requests/ticket-pdf-model.ts`, `app/api/storage/attachment/request/[id]/route.ts`
- **Evidence**
  - `lib/actions/attachments.ts:153-162` always writes `is_internal: false` (line 161), and the optional `commentId` (lines 118-130) is only checked for "belongs to this request", never for "is this an internal comment".
  - `components/requests/CommentForm.tsx:85` posts the comment with `isInternal`, then `:95` calls `uploadAttachment(requestId, fd, result.commentId)` for the files of that same internal note.
  - RLS (audit DB): `request_attachments_select` = requester OR team OR manager, **and** `(is_internal = false OR team/manager)`. Because the flag is always false, the requester's rows pass. `storage.objects` policy `storage_request_attachments_select` has no `is_internal` test at all.
  - `lib/requests/ticket-pdf-model.ts:179` filters `!x.is_internal` (useless, flag never true): the requester's PDF and the "ticket copy" e-mails to CC recipients (`lib/actions/ticketCopy.ts:62-65`, `viewer.isAgent:false`) list the file names of internal-note attachments.
  - `lib/actions/attachments.ts:174-179` logs `attachment_added` with `file_name` into `request_activity`; the requester's `request_activity_select` policy lets them read it (History tab).
  - The ticket page hides the file only because it renders attachments next to their (hidden) internal comment (`app/(app)/requests/[id]/page.tsx:474-487`). The data itself is not protected.
- **Plain-language explanation:** When a technician writes a private internal note and attaches a file (a quote, a screenshot with other people's details, an escalation e-mail), the system marks the file as normal, not private. The requester cannot see it on the page, but the file name appears in the ticket PDF and history, and the requester (or anyone using the data interface directly) can list and download the file itself.
- **Exploit scenario:** Technician (team T) posts an internal note with `vendor-quote.pdf` on requester A's ticket. A signs in, runs `GET /rest/v1/request_attachments?request_id=eq.<ticket>&select=id,file_name,comment_id` with their own JWT (the `comment_id` points to a comment A cannot see), then opens `/api/storage/attachment/request/<attachment id>` and gets the file.
- **Prove on LOCAL:** (1) as technician call `addComment(ticket, 'note', true, true)` then `uploadAttachment(ticket, fd, commentId)`; (2) as requester call the two URLs above, expect 200 + file (should be 404); (3) `GET /api/requests/<id>/pdf` as requester, the attachment list contains the file name.
- **Suggested minimal fix:** in `uploadAttachment`, when `commentId` is given load the comment and set `is_internal = comment.is_internal`; add the same `is_internal` test to the `storage_request_attachments_select` policy; back-fill existing rows (`UPDATE request_attachments SET is_internal = true WHERE comment_id IN (SELECT id FROM request_comments WHERE is_internal)`). Also stop logging the file name of an internal attachment in `request_activity` (or log it as internal).
- **Confidence:** CONFIRMED-BY-CODE (flag hard-coded false, RLS keyed on the flag).

### VA-INT-02 - An e-mailed reply is accepted from any active employee or any person at an OEM's domain, for any ticket (no "participant" check)
- **Severity:** Medium. Unauthorised write into another person's ticket (a public comment shown to the requester, notifications to requester/technician/collaborators). Ticket numbers are sequential and guessable. Cannot reopen or change status, cannot post internal notes.
- **Module:** `lib/email/inbound.ts`, `lib/email/inbound-match.ts`, `lib/requests/email-reply-comment.ts`
- **Evidence**
  - `lib/email/inbound.ts:180` ticket chosen only from the subject tag `[CKSD-000123]` or a `+CKSD-000123` address (`thread-tag.ts:11,43`).
  - `inbound.ts:213` `resolveKnownSender(fromAddress, profilesByEmail, oemNameByEmail)`: `profilesByEmail` is **every active profile of the org** (`inbound.ts:33-54`). Whether that person is the requester, assignee, collaborator or in the technician group is never checked.
  - `inbound.ts:215` an OEM "colleague" rule: any sender whose domain equals the domain of any listed OEM contact is accepted when the mail server said `authentic` (`inbound-match.ts:63-81`); the OEM is not linked to the ticket (no check that this ticket was ever sent to that OEM).
  - `lib/requests/email-reply-comment.ts:39-47,56-81` inserts a public comment as that person and notifies requester + assignee + collaborators.
  - In the portal the same user could not do this: `request_comments` INSERT is RLS-limited to people with access to the ticket.
- **Plain-language explanation:** Any Citykart employee (for example a store cashier) can write a mail with a ticket number in the subject to the help-desk mailbox and the text is added to somebody else's ticket as a normal comment, under their own name. The same is true for every staff member of a vendor (OEM) company, for every ticket. It is a way around the access rules of the website.
- **Exploit scenario:** Employee X (role `user`, no relation to ticket CKSD-000123) sends from X's real mailbox to the helpdesk address, subject `Re: [CKSD-000123] hello`, body "please close this, wrong store". Within one minute (EmailReplySync) the comment appears on the ticket of requester B and B and the technician get a notification ("X replied by email"). An OEM employee does the same for tickets that have nothing to do with that OEM.
- **Prove on LOCAL:** the sync needs a Gmail IMAP mailbox (blocked on the audit stack), so prove the logic at unit/integration level: call `resolveKnownSender('x@<org domain>', maps, oemMap)` with X in `profilesByEmail` and observe `kind:'profile'`; then call `appendEmailReplyComment({ requestId: <B's ticket>, body:'hi', author:{kind:'profile', profileId:X, name:'X'} })` (see `tests/integration/email-reply-comment.test.ts`) and read `request_comments` as B. Expect a row (should be refused).
- **Suggested minimal fix:** after the sender is resolved, require that the profile is the requester, the assignee, a collaborator, a member of the ticket's technician group, a manager/admin, or an approver of a pending approval; require that an OEM contact/domain is one the ticket was actually routed to (`oem` recorded on the ticket / `oem_message`). Otherwise record `sender_not_recognized` as today.
- **Confidence:** CONFIRMED-BY-CODE (logic); end-to-end needs a mailbox.

### VA-INT-03 - Text of internal notes (and of public comments) is pushed to people who may not see the ticket (non-staff collaborators, @mentioned strangers) by bell and e-mail
- **Severity:** Medium. Disclosure of the first 120 characters of internal notes plus the ticket number and title to arbitrary users.
- **Module:** `lib/actions/requests.ts` `addComment`, `lib/notifications.ts`, `lib/email/notify-email.ts`
- **Evidence**
  - `lib/actions/requests.ts:722-744`: an internal note is notified to `assigneeId + collaboratorIds` with `type: 'internal_note_added'` and `body: notifBody` (first 120 chars). `addCollaborator` (`requests.ts:501-561`) accepts **any org profile** (role `user` included); the page RLS hides internal comments from non-agent collaborators (`comments_select`: `is_request_collaborator(...) AND is_agent()`), but the notification path has no such test.
  - `requests.ts:747-778`: `@name` mentions look up `profiles.ilike('full_name', name%)` (up to 3, first name match) and notify the match with `trimmed.slice(0,120)`; no check that the target can open the ticket, and the target may be the requester (in an internal note) or a different person with the same first name.
  - `lib/notifications.ts:123-135,172-195`: bell row + e-mail (`notify-email.ts:70-79,195-202` puts `commentBody`, `requestNo`, title) are sent to whoever is in the list. No per-recipient access filter.
- **Plain-language explanation:** The system correctly hides internal notes on screen, but the "you have a new internal note" alert and the "you were mentioned" alert carry the start of the note into the person's notification and into an e-mail. If the person is a watcher who is an ordinary user, or simply shares a first name with the person the technician meant, they read text meant only for staff.
- **Exploit scenario:** Manager adds store user S as collaborator (to keep S informed). Technician posts an internal note "customer is a repeat complainer, do not refund". S gets a bell item + e-mail with those words. Or a technician types "@Rahul check price with vendor" in an internal note, the first "Rahul" in the org (a different employee) receives it.
- **Prove on LOCAL:** as technician `addCollaborator(ticket, userS)` where S has role `user`; `addComment(ticket, 'secret text', true)`; read `notifications` as S (`select body,title`). Expect the secret text (should be none). For mention: `addComment(ticket,'@<firstname of an unrelated user> secret', true)`.
- **Suggested minimal fix:** before calling `notify`, drop recipients who cannot read the comment (for internal notes: role in agent/manager/admin/platform_owner or in the ticket's group; for mentions: same plus "has access to the ticket"); for internal notes send "an internal note was added" without the body; restrict collaborators to staff or at least do not mail internal text to non-agents.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-INT-04 - XLSX preview trusts the size numbers written inside the file (zip-bomb memory exhaustion of the single app server)
- **Severity:** Medium (availability, any requester). Needs a dynamic check, hence PLAUSIBLE.
- **Module:** `lib/attachments/xlsx-preview.ts`, `app/api/storage/attachment/request/[id]/preview/route.ts`
- **Evidence:** `xlsx-preview.ts:30-47` computes "uncompressed size" from the **central directory** of the zip (`readUInt32LE(offset + 24)`), numbers that the file's author writes; `:75-82` accepts the file if those declared numbers are small and then calls `workbook.xlsx.load(buffer)` (ExcelJS/JSZip), which inflates the real data in memory (JSZip only compares with the declared size after inflating the entry). The preview route (`preview/route.ts:29-43`) is reachable by whoever can see the attachment, i.e. the uploader. The upload check for `.xlsx` is only the ZIP magic bytes (`validate.ts:97`) and a client-supplied MIME (`preview/route.ts:29` also trusts the stored `mime_type`). The app is a single Node process (architecture report).
- **Plain-language explanation:** The preview feature tries to refuse "booby-trapped" spreadsheets by reading how big the file says it will become when unpacked. A crafted file can lie, be a few KB, and expand to gigabytes when the preview opens it, freezing or crashing the whole help desk for everybody.
- **Exploit scenario:** Requester uploads `x.xlsx` (ZIP with a 2 GB run of zeros whose headers declare 1 KB) to their own ticket, then opens the preview (or an unsuspecting technician does). Node runs out of memory.
- **Prove on LOCAL:** craft the zip with a patched central directory (declared size 1 KB, real 1.5 GB, deflate), upload as requester (MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, name `.xlsx`), call `GET /api/storage/attachment/request/<id>/preview`, watch the audit app process memory/exit. Do this only on the disposable stack.
- **Suggested minimal fix:** do not rely on declared sizes: stream-inflate with a hard byte cap (e.g. `yauzl`/`unzipper` with a counter) or run the parse in a worker/child process with a memory limit and timeout; keep the 5 MB input cap.
- **Confidence:** PLAUSIBLE.

### VA-INT-05 - OEM e-mail template preview renders the stored template unsanitised (stored XSS, manager to admin)
- **Severity:** Medium (privilege escalation inside the admin screen; requires a manager to write the template without going through the sanitising server action, which RLS allows).
- **Module:** `components/admin/RichEmailEditor.tsx:140,187`, RLS `oems_admin`
- **Evidence:** the preview does `renderHtmlEmail(toEditorHtml(value), OEM_SAMPLE_VALUES).html` and `<div dangerouslySetInnerHTML={{ __html: previewHtml }} />` (lines 140, 187). `value` is the raw `oems.email_body_template` from the database. Sanitising (`sanitizeTemplateHtml`) happens only on save in `lib/actions/admin/oems.ts:41` and when the e-mail is sent (`create-request-core.ts:95`), not before the preview. Policy `oems_admin` (audit DB) lets `manager` do `ALL` on `oems`, so a manager using the data interface directly (`PATCH /rest/v1/oems`) can store `<p><img src=x onerror=...>` that the server action would have cleaned. CSP is report-only (`next.config.ts`), so nothing blocks inline handlers.
- **Plain-language explanation:** The e-mail templates are cleaned before saving, but the screen that shows the preview does not clean them again. A manager who writes the template through a side door can leave a booby trap that runs as soon as an administrator opens the preview, with the administrator's rights.
- **Exploit scenario:** Manager M PATCHes OEM row template to `<p><img src=x onerror="fetch('/api/...')"></p>`; admin opens Master Data > OEM > template > Preview; script runs in the admin's session (calls server actions as admin).
- **Prove on LOCAL:** as manager JWT `PATCH /rest/v1/oems?id=eq.<id>` body `{"email_body_template":"<p><img src=x onerror=\"document.title='XSS'\"></p>"}`; as admin open the editor, click Preview; check `document.title`.
- **Suggested minimal fix:** `sanitizeTemplateHtml(...)` on the preview string too (it is already imported server-side; use a client-safe copy or sanitise server-side before sending the value to the page); restrict `oems` writes to admins at the policy level or add a `WITH CHECK`/trigger that runs the same sanitiser.
- **Confidence:** PLAUSIBLE (needs the dynamic check; code path is unambiguous).

### VA-INT-06 - The one-time approval code is written in clear text to the Event Log and the console
- **Severity:** Low to Medium (secret exposure to log readers; a code is single use, 10 minutes, and useless without the signed link).
- **Module:** `lib/actions/approvalEmail.ts:75`, `lib/email/send.ts:111,129`
- **Evidence:** `approvalEmail.ts:75` sends the mail with `subject: \`Your Citykart Desk code: ${code}\``. `send.ts:129` then records `Email sent: ${p.subject}` (target = approver's address) in `app_event_log` through `recordEvents`; when no mailbox is configured `send.ts:111` prints the same subject with `console.log`, which the log shipper forwards to `system_log`. Event Log and System Log are visible to admins.
- **Plain-language explanation:** The six-digit code that proves "this is really the approver" is written in the subject line, and the system logs every subject, so the code ends up in the admin log screens.
- **Exploit scenario:** An administrator (or anyone who can read the logs) who also obtains the approval link (e.g. from a forwarded e-mail, access log or browser history: the token is in the URL path) reads the code in the Event Log within 10 minutes and decides the approval as the approver.
- **Prove on LOCAL:** open `/approve/<token>` (token from `approvalLinkUrls`), click "send code", then `select message from app_event_log order by created_at desc limit 3` (read-only) and see the code.
- **Suggested minimal fix:** keep the code out of the subject (put it in the body only) and pass a `logSubject` / `redact` option to `sendEmail` so only a generic label is stored; never `console.log` subjects containing secrets.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-INT-07 - Sender authenticity check of inbound e-mail has three weak spots (fail-open "unchecked", DMARC pass not tied to the From domain, last From header wins)
- **Severity:** Low (exploitation depends on how Gmail treats malformed mail; today it is defence in depth). Becomes Medium together with VA-INT-02 if a spoof works.
- **Module:** `lib/email/inbound-auth.ts`, `lib/email/inbound.ts:172,198-215`
- **Evidence**
  - `inbound-auth.ts:42` no Google result header gives `unchecked`, and `inbound.ts:199` only rejects `failed`; an "unchecked" message from an exactly matching employee address is attributed to that employee (`inbound.ts:213`).
  - `inbound-auth.ts:45` returns `authentic` for **any** `dmarc=pass` without comparing the passing domain (`header.from=`) with the address that is used to attribute the comment.
  - `inbound.ts:172` takes the sender from mailparser's `parsed.from`; mailparser keeps the **last** value of a repeated `From:` header (`node_modules/mailparser/lib/mail-parser.js:455-462`, key listed as "keep only the first value" but the code takes `value[value.length-1]`), while a mail provider evaluates DMARC for the first. A message with two `From:` lines could pass DMARC for the attacker's own domain and be attributed to the second (employee) address.
  - the header-owner regex `[\w.-]*google\.com` (line 41) also accepts an `evilgoogle.com` authserv-id, only harmless because the topmost header wins.
- **Plain-language explanation:** The check "did the mail server confirm who sent this?" accepts the message in cases it should not: when there is no verdict at all, when the verdict is about some other domain than the one named in the From line, and when a message carries two From lines.
- **Exploit scenario:** An outsider sends a crafted message with two From headers to the helpdesk Gmail, tag `[CKSD-000123]`; if Gmail passes DMARC for the first domain, the comment is posted as the employee named by the second.
- **Prove on LOCAL:** unit level with `senderAuthenticity('mx.google.com; dmarc=pass header.from=attacker.example', 'ceo@citykart.org')` returns `authentic`; and parse a raw message with two `From:` lines with `simpleParser` to see which wins. A true end-to-end test needs Gmail.
- **Suggested minimal fix:** reject any message with more than one `From` header (`parsed.headerLines`), require `header.from` of the DMARC result to be aligned with the sender domain, and treat `unchecked` as "post as a note for review" or require the mail to come from the org's own domain only.
- **Confidence:** PLAUSIBLE.

### VA-INT-08 - Unauthenticated callers can write rows into the logs (CSP report endpoint, spoofable rate limit; tagged mail note spam)
- **Severity:** Low (log pollution, disk growth, hiding real events). No data disclosure.
- **Module:** `app/api/csp-report/route.ts`, `lib/email/inbound.ts:201,219`, `app/api/intake/webhook/whatsapp/route.ts:56`
- **Evidence**
  - `csp-report/route.ts:16` rate-limit key is the first value of the client-supplied `X-Forwarded-For`; rotating it removes the limit. `recordSystemLog` flood key includes attacker-chosen `blocked` and `page` (lines 40-45), so every variant creates a new row. The route is in `PUBLIC_API_ROUTES` (`proxy.ts:80`). (All other limiters use `getClientIp()` with `TRUSTED_PROXY_HOPS`.)
  - `inbound.ts:201,219` for a forged-From mail at a domain the org knows (`isPlausibleSender` is domain-only), a staff-only note ("An e-mail reply ... was not added ...") plus a `recordEvents` row is created for each mail; there is no per-ticket or per-sender cap; every mail also adds a `processed_inbound_emails` row.
  - `whatsapp/route.ts:56` and `lib/actions/approvalEmail.ts:88` per-address limits are skipped when `TRUSTED_PROXY_HOPS` is not set (documented design, `rate-limit.ts:47-52`): each unauthenticated WhatsApp POST then costs a DB + Vault read before the signature is rejected.
- **Plain-language explanation:** Some doors that must stay open to the outside (browser security reports, mail, WhatsApp callbacks) can be hammered to fill the logs or make the server work, and the "slow down" counter on one of them can be cheated.
- **Prove on LOCAL:** `for i in 1..200: POST /api/csp-report` with `X-Forwarded-For: 10.0.0.$i` and a distinct `blocked-uri`; count `system_log` rows (should be capped).
- **Suggested minimal fix:** use `getClientIp()` in `csp-report`, add a global per-minute cap for the endpoint, cap notes per ticket per hour in the inbound sync, and set `TRUSTED_PROXY_HOPS` correctly in production.
- **Confidence:** CONFIRMED-BY-CODE (csp-report), PLAUSIBLE (others).

### VA-INT-09 - No protection against automatic replies and mail loops (inbound or outbound)
- **Severity:** Low (noise, wasted notifications, in rare cases a ping-pong between two out-of-office responders).
- **Module:** `lib/email/send.ts`, `lib/email/inbound.ts`
- **Evidence:** outbound mail (`send.ts:69-79`) sets no `Auto-Submitted: auto-generated` / `X-Auto-Response-Suppress` headers, and `Reply-To` is the tagged mailbox. Inbound (`inbound.ts:160-250`) never looks at `Auto-Submitted`, `Precedence`, `X-Autoreply`. A user's out-of-office answer to a notification is posted as that user's comment and triggers new notification e-mails to the other participants (`email-reply-comment.ts:59-81`), whose own auto-responders can answer again.
- **Plain-language explanation:** If someone is on holiday with an automatic reply, their "I am away" message is added to the ticket as if they had written it and it can start a chain of automatic mails.
- **Prove on LOCAL:** unit test `syncInboundReplies` with a fake parsed message carrying `Auto-Submitted: auto-replied`; expect it to be skipped (today it is posted).
- **Suggested minimal fix:** add `Auto-Submitted: auto-generated` and `X-Auto-Response-Suppress: All` to outbound notification mail; skip inbound mail whose headers say auto-reply/bulk/list.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-INT-10 - Upload controls can be bypassed or abused (direct Storage API write to `task-attachments`, no quota/rate limit, no malware scan, macro-capable formats)
- **Severity:** Low.
- **Module:** storage policies, `lib/actions/attachments.ts`, `lib/actions/task-attachments.ts`
- **Evidence**
  - Policy `task_attach_storage_insert` (role `public`, `WITH CHECK bucket_id='task-attachments' AND auth.uid() IS NOT NULL`) lets **any signed-in user** upload objects straight to the Storage API (`/storage/v1`, proxied on 8443) into that bucket at any path, skipping the server-side type / magic-byte / 25 MB checks. The bucket's own MIME list even contains `image/svg+xml` (bucket config). Objects without a `task_attachments` row are unreadable (SELECT policy) but still use NAS space. `task_attach_storage_delete` is also `public` for the owner.
  - No per-user, per-ticket or per-minute limit on `uploadAttachment` / `uploadTaskAttachment` (no `rateLimit` import), each up to 25 MB; the action buffers the whole file in memory (`attachments.ts:136`, body limit 30 MB, `next.config.ts`).
  - `attachments.ts:133` has only a comment `VIRUS_SCAN_HOOK`; `.doc/.xls/.ppt` (macro-capable) are allowed (`validate.ts:10-14`). Technicians open files from any requester.
  - `lib/actions/task-attachments.ts` uploads files but no download route exists for task attachments (only the list query, `lib/queries/tasks.ts:257`), so the data is stored but unreachable: functional gap, and files are never deleted.
- **Plain-language explanation:** The upload screen checks files, but a signed-in user can talk to the file store directly for one folder and skip the checks; there is no limit on how many large files someone can send; files are not scanned for viruses.
- **Prove on LOCAL:** with a requester JWT `POST /storage/v1/object/task-attachments/<anything>/x.html` with a 20 MB body and `Content-Type: image/svg+xml`; expect 200 today.
- **Suggested minimal fix:** drop `task_attach_storage_insert` (all writes already go through the service role) or restrict the path to a task the user can access; add a daily per-user byte quota and a rate limit to both upload actions; remove `image/svg+xml` from the bucket list; add AV scanning at the existing hook for the NAS.
- **Confidence:** CONFIRMED-BY-CODE (policy and absence of limits).

### VA-INT-11 - Approval e-mail link / code hardening items
- **Severity:** Low.
- **Module:** `lib/approvals/email-link.ts`, `lib/approvals/email-code.ts`, `lib/actions/approvalEmail.ts`, `app/approve/[token]/page.tsx`
- **Evidence**
  - A holder of the link can call `requestApprovalCode` 3 times per 10 minutes (`approvalEmail.ts:59`); each call cancels the previous unused code (`email-code.ts:14`), so a stranger holding a forwarded link can keep invalidating the real approver's code and mail-bomb them. Guessing: 5 tries per code, 8 verifies per 10 minutes per approval (`approvalEmail.ts:87`); all counters are in process memory and reset on restart (`rate-limit.ts`). With a 7-day link the chance to guess a 6-digit code stays below about 1% in 7 days, and every attempt cycle e-mails the approver, so this is acceptable but not strong.
  - `email-link.ts:19` the signing key falls back to `CSAT_LINK_SECRET`, then `CRON_SECRET`: if no dedicated secret is set, anyone who knows the cron secret (script files on the server) can forge approval links and verified cookies. Tokens are bearer and reusable until the approval is decided; the token sits in the URL path (proxy and browser history).
  - `approvalEmail.ts:98-101` the "verified" cookie is `Secure` only when `NEXT_PUBLIC_APP_URL` starts with `https` (production is `http://...:3210`), so it travels in clear text for 30 minutes.
  - Before proving identity the page shows request number, title, "sent to" names and the outcome (`page.tsx:62-97`) to anyone holding the link.
- **Plain-language explanation:** The approval-by-email design is sound (the link alone does not approve; the visitor must be signed in as the approver or type a code mailed only to the approver). The weak points are small: a forwarded link lets a stranger spam the approver with codes, a missing dedicated secret would reuse the cron secret, and the proof cookie is not marked secure on HTTP.
- **Suggested minimal fix:** require `APPROVAL_LINK_SECRET` (refuse to build links otherwise), do not cancel an unexpired code when a new one is requested within the window (return "a code was sent"), persist the counters in the database for code requests, and set the cookie `Secure` once HTTPS is in place.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-INT-12 - Intake mail viewer: "remote images blocked" is not complete, and a mail can redirect its own frame
- **Severity:** Low (privacy: tracking pixels reveal the reviewer's IP / read time; in-frame phishing).
- **Module:** `app/(app)/intake/_components/EmailBody.tsx:26-34,57-65`
- **Evidence:** the block only rewrites `<img ... src=` and `srcset=` that are preceded by whitespace; `<img/src=...>`, CSS `background:url(...)`, `<style>@import`, `<link rel=stylesheet>`, `<body background>`, `<video poster>`, SVG `<image href>` still load. The sandbox (`allow-same-origin allow-popups allow-popups-to-escape-sandbox`, no `allow-scripts`) correctly stops script execution, so there is no XSS; `<meta http-equiv=refresh>` can navigate the frame to an attacker page that looks like a login form inside the app. Links open with `<base target=_blank>`.
- **Plain-language explanation:** Opening a mail in the review screen can still tell the sender "your mail was read, from this address", and a mail can show a fake page inside the frame. It cannot run code.
- **Suggested minimal fix:** add a restrictive CSP inside the `srcdoc` (`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` and allow `img-src https:` only when the user clicks "Load images"), and strip `<meta>`, `<link>`, `<base>` before rendering.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-INT-13 - WhatsApp phone-number map: every org member can read all registered numbers, and managers can re-point a number to any user
- **Severity:** Low (PII exposure to any signed-in user; insider impersonation via the channel). The webhook itself cannot be used to claim another person.
- **Module:** RLS on `profile_mobile_numbers`, `lib/users/resolveWhatsAppUser.ts`
- **Evidence (audit DB):** `profile_mobile_numbers_select` = `(org_id = current_org_id()) OR (profile_id = auth.uid())`, so every authenticated user (role `user` included) can `GET /rest/v1/profile_mobile_numbers` and obtain the mobile numbers of the whole organisation; `profile_mobile_numbers_admin` gives `ALL` to `manager` as well as admin. The sender identity in the webhook comes from Meta's signed `from` field (`webhook-handler.ts:161-186`), so a number cannot be spoofed from outside, but a manager can add their own number to another employee's profile (the unique index is per org, they can delete the old row first) and then create tickets as that employee.
- **Plain-language explanation:** The list of employee mobile numbers is readable by every employee, and a manager can attach their own phone to someone else's account, after which WhatsApp tickets are raised in that other person's name.
- **Prove on LOCAL:** as a requester `select mobile_number, profile_id` through PostgREST; as manager `DELETE` + `POST` a row for another profile.
- **Suggested minimal fix:** limit SELECT to the owner and admins; limit writes to admin and log them in `owner_audit_log`.
- **Confidence:** CONFIRMED-BY-CODE.

### Observations (not security findings, for the project owner)
1. `proxy.ts` matches every route, and Next's `proxyClientMaxBodySize` is **10 MB by default** (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`): the 25 MB upload limit (`bodySizeLimit: '30mb'`) is probably cut at 10 MB (silently truncated body). Test with a 20 MB file; set `experimental.proxyClientMaxBodySize` if intended. Integrity risk if the truncated multipart is accepted.
2. `app/api/storage/public/.../route.ts` serves the bucket `avatars`, and `uploadAvatar` writes to it, but no migration creates an `avatars` bucket (audit DB has only `request-attachments`, `task-attachments`, `intake-attachments`, `icons`): avatar upload fails unless created by hand in production.
3. `lib/storage/publicPath.ts:15-16`: `\.` inside a template literal becomes `.`, so the path regex accepts any character before the extension (no exposure, the object must exist).
4. `api/src/intake/attachmentValidate.ts:42` the worker's MP4 signature expects `00 00 00 18 ftyp` at offset 4 (never true): real MP4 e-mail attachments are refused (the web copy fixed this, the worker was not).
5. WhatsApp: a replayed (identical, signed) payload is de-duplicated (`UNIQUE(org_id, channel_type, external_message_id)`) but `sendAll` still re-sends the last prompt to the user (`webhook-handler.ts:226`), bounded by 30 messages/min/sender. Phone numbers are stored in `intake_audit_log.metadata` (`from`) - PII in logs, retention to be decided.
6. `INTAKE_WEBHOOK_TOKEN ?? INTAKE_WORKER_SECRET ?? CRON_SECRET` is placed in the URL query given to Microsoft Graph and Pub/Sub (`oauth/callback/route.ts:94-103`): if the dedicated variable is unset the cron secret is exposed to those logs. Set `INTAKE_WEBHOOK_TOKEN`.
7. `sendFromMessage` (`lib/actions/intake/communication.ts:167`) lets any `agent` send mail to arbitrary recipients from the organisation's intake mailbox (via the worker); by design for staff, but it is an open relay for a compromised agent account.

---

## 2. Controls verified as sound (current code, not the old documents)

**Files**
- Download type comes from the file name through a fixed table, not the stored MIME column (`lib/attachments/serve.ts:7-21`); only images, PDF and plain text open inline, everything else downloads (`:16,:24`); `nosniff` on every attachment response (`app/api/storage/attachment/request/[id]/route.ts:58`, intake route `:50`, public route `:63`, global header `next.config.ts` headers()); `Cache-Control: private, no-store` (`:60`).
- Path traversal: request file must live in its own `<request id>/` folder (`serve.ts:32-34`, used in both request routes), intake path must be exactly `<org>/<message>/<file>` (`lib/attachments/intake-key.ts:6-10`), public buckets accept only `<uuid>.<img ext>` shapes (`lib/storage/publicPath.ts:12-39`); DB trigger `guard_attachment_client_write` repeats this at the database and forbids changing `storage_path`, `file_name`, `request_id` from a client session.
- Access check on every download uses the caller's own RLS-scoped client (`request/[id]/route.ts:31-35`, intake `:24-28`, preview `:18-22`), then streams with the admin client; no signed URLs remain (`createSignedUrl` only in comments).
- Upload: size cap 25 MB, extension allow-list, MIME allow-list without SVG/HTML, magic bytes for jpeg/png/gif/webp/pdf/zip/OOXML/mp4 (`lib/attachments/validate.ts:4-124`); file name sanitised to `[a-zA-Z0-9._-]` and prefixed with request id, timestamp, random (`attachments.ts:26-38`); `upsert:false`; orphan object removed when the DB insert fails (`:166-171`); comment must belong to the same request (`:122-130`); uploader needs requester/technician/manager role plus RLS insert policy.
- WhatsApp media goes through the same allow-list/size/magic check (`lib/whatsapp/media.ts:23-45`, D-055), staged under `staging/<org>/<conversation>/...`, moved to `<request id>/` path with sanitised name; a failed insert moves the object back (`:158-177`).
- Icon/avatar uploads: admin-only (icons) / owner-only (avatars), 5 MB, image extensions plus magic check, random or user-id path.
- Ticket PDF is generated with PDFKit from a data model (no HTML, no remote resources, no SSRF): `lib/pdf/ticket-pdf.ts`; the model drops internal comments (`ticket-pdf-model.ts:152`), reads data with the caller's session (`pdf/route.ts:21-30`), file name is `[A-Za-z0-9_-]` only (`:200-202`), UUID check on the id (`:16`).

**E-mail**
- Sender is read from the structured `From` field and a message without exactly one plain address is rejected (`lib/email/inbound-sender.ts:13-20`, D-057); Google-only `Authentication-Results` is believed, topmost header wins (`inbound-auth.ts:41`), fail result is not attributed (`inbound.ts:198-210`).
- Duplicate handling: claim row first, unique Message-ID, release on failure (`inbound-claim.ts:14-37`, D-020); header-only pre-scan avoids downloading handled mails (`inbound.ts:142-156`).
- Reply is always a public comment, never an internal note, no status change except the requester's own wait-resume with the `eq('status','waiting_user')` guard (`email-reply-comment.ts:39,85-95`); inbound attachments are ignored (no file intake from replies).
- Outbound HTML: every field is HTML-escaped (`lib/email/escape.ts:9-33`, used at the top of each builder in `templates.ts`), OEM template is sanitised on save and again before sending with a tag/attribute/scheme allow-list (`sanitize-template.ts:11-41`, `create-request-core.ts:95`), placeholder values are escaped (`oem-template.ts:fillHtmlTemplate`). Header injection: nodemailer 10 strips control characters from header values (`node_modules/nodemailer/dist/cjs/mime-node/index.js:117`); Resend uses JSON.
- CC / ticket copy only to CK Desk addresses (users and OEM contacts), max 5, only the author's own public comment within 15 minutes, requester view of the ticket (`cc-recipients.ts`, `ticketCopy.ts:39-68`).
- Approval link: HMAC-SHA256 with purpose prefix, constant-time compare, UUID checks, 7-day expiry and live status check, link alone does not decide, approver must be signed in as the named person or hold a code (random `randomInt`, stored as keyed hash, single use, 10 minutes, 5 attempts, claim by conditional update) (`email-link.ts:35-123`, `email-code.ts:12-42`, `approvalEmail.ts:33-47`); verified cookie is `httpOnly`, `sameSite=lax`, path-limited, bound to approval and approver; the decision runs through `decideApproval` with the approver's profile, not the visitor's. CSAT token: HMAC with expiry and timing-safe compare (`csat/token.ts`), rating single-use through `submitted_at IS NULL` update.
- Outbound HTTP only goes to fixed hosts or environment-configured worker URLs (grep of every `fetch(`): no SSRF with user-controlled URLs.

**WhatsApp / intake**
- Webhook: body size caps before parsing (`whatsapp/route.ts:59-62`), HMAC-SHA256 over the raw body, constant-time compare, missing secret/header fails closed (`signature.ts:13-25`, `webhook-handler.ts:306-313`), channel chosen by Meta's `phone_number_id` and mixed-phone payloads refused (`:292-295`, D-062), audit-row flood limit, GET handshake compares the verify token in constant time (`config.ts:92-104`).
- Idempotency by `UNIQUE(org_id, channel_type, external_message_id)` (`conversations/repository.ts:71-99`); per-sender 30/min and unregistered-number limits (`webhook-handler.ts:161-177`); conversation state is server-side, service/sub-category must come from the lists computed for the requester's location (`orchestrator.ts:496-505`), requester re-checked at create (`:815`), single-create gate (`:887-902`).
- Identity: number to profile map is org-scoped, active and `whatsapp_enabled` required (`resolveWhatsAppUser.ts:79-110`); outbound sends go only to the `from` of a signed message (no path for arbitrary numbers); media ids come from the signed payload; the access token never appears in logs.
- No language model touches tickets: the only LLM call in the app is the reviewer-only e-mail summary (`lib/actions/intake/brief.ts`, role check D-027, output shown as text, 2000-character input cap, no tool use); classification suggestions go to a human review queue (`approveReview` / `convertToWork` need an agent+ click). Prompt injection can at most distort a suggestion or summary.
- Mailbox webhooks use constant-time token compare and verify the Graph `clientState` (`webhook/gmail|outlook`); OAuth state is HMAC-signed, 15 minutes, bound to the admin who started it, callback re-checks role and channel ownership (`lib/intake/oauth.ts`, `oauth/callback/route.ts:21-35`, D-058/D-059).
- Intake attachments for reviewers: forced download, extension-based type, `nosniff`, unguessable generated key (`api/src/intake/storage-key.ts`), RLS limits to agent+ of the org.

**Output encoding**
- `dangerouslySetInnerHTML` appears only twice in the whole codebase: a constant theme script (`app/layout.tsx:49`) and the OEM preview (VA-INT-05). No `innerHTML`, `srcDoc` only in the sandboxed mail viewer, no Markdown renderer. Conversation view renders comment text as React text (`requests/[id]/page.tsx:207-214`).
- CSV exports all go through `toCSV` which prefixes `= + - @ TAB CR` with a quote (`lib/export/csv.ts:7-14`); the `.xlsx` exports write strings as plain cell values (no `formula:` objects built from user text anywhere under `lib/`).
- `href` values are built from fixed prefixes plus ids; notification `link` can only be set for oneself (RLS `notifications_insert_own_only`); every `target="_blank"` found has `rel="noreferrer"` or `noopener`; the sign-in `next` parameter is path-only (`lib/actions/auth.ts:48`).

---

## 3. Areas not assessed and why
- Real Gmail/IMAP behaviour (what Gmail writes into `Authentication-Results`, handling of duplicate `From`), WhatsApp Cloud API, Graph/Pub/Sub: no external connection allowed; findings VA-INT-02/07 are proven at logic level only.
- The separate Express service in `api/` (IMAP poller, classifier, `/intake/send`): only its attachment/storage key helpers and secret check were read; whether it runs in production is unknown.
- `lib/approvals/decision.ts` and `lib/requests/create-request-core.ts` business rules (covered by other reviewers); `tests/` not executed (no `npm`/`vitest` allowed).
- Production proxy (`deploy/windows/proxy/server.js`) was read only to learn that `/storage/v1`, `/rest/v1`, `/auth/v1` are exposed on one port; firewall exposure of 8443 is unknown (affects VA-INT-10 and VA-INT-13 reachability).
- Antivirus, NAS share permissions, mailbox/OAuth app configuration, actual values of `TRUSTED_PROXY_HOPS`, `APPROVAL_LINK_SECRET`, `INTAKE_WEBHOOK_TOKEN` in production.
- Dynamic behaviours flagged PLAUSIBLE (VA-INT-04, -05, -07, observation 1) still need the recipes above on the audit stack.
