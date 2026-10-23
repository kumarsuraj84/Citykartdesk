# Vendor journey - who gets which e-mail, when, with what words, and where the address comes from

> The same map as a spreadsheet, in the owner's layout, is `docs/VENDOR-EMAIL-MAP.xlsx` (the owner's copy with the remarks). The updated copy after the 2026-10-23 build is `docs/VENDOR-EMAIL-MAP-UPDATED.xlsx` (new mails marked "new", changed ones "changed", plus a sheet on the AC sheet columns).
>
> **Changes of 2026-10-23 (local only):** AC sheet columns renamed to **OEM Ticket Mail To**, **OEM PO Mail To** and the new **CK PO Approver Mail To** (the old headings "Mail ID" and "Email for PO detail" still work); a quote goes in ONE mail to every approver named for that AC (any one decides, the first decision wins); new mail to the store when the parts list changes; new mail to the vendor when Citykart ends the hold; new wording for reject-and-cancel (OEM, store, vendor); the vendor's reopen mail is its own "REOPENED by the store" mail, with a "Reopened ×N" tag in his boxes.

Checked on 2026-10-23. Every mail below was recorded from a real run of the journey on the isolated test stack (`tests/vapt/37-vendor-mail-journey.test.ts`, which fails if a mail goes to the wrong person) and from the real mails the local app saved while we clicked through the demo. Nothing is sent from this PC: locally every mail is saved as a file in `local-mail-outbox/`.

## 1. Where each address comes from

| Who | Address used | Where it comes from |
|---|---|---|
| **Store / requester** | The e-mail of the login that raised the ticket (for example `sm.alc@citykartstores.com`) | The login's own e-mail, set when the user was created. A ticket booked on behalf of somebody else goes to that person. |
| **Vendor technician** | His own login e-mail | Typed by the administrator in **Admin > Vendors > Add a vendor login**. If it is wrong, he receives nothing: correct it in Admin > Users. |
| **PO approver(s)** | Login e-mail of each approver | The AC sheet column **"CK PO Approver Mail To"** of the AC on the ticket (one or several addresses; each must be an active technician, manager or admin with a CK Desk login, otherwise it is skipped with a warning on the Master data health page). If the cell is empty or none is valid: the **Default PO approver** in Admin > Vendors (Krishan). One mail goes To all of them; any one can decide. |
| **OEM - new ticket / reopened** | OEM addresses in **To**, Citykart people in **CC** | The AC sheet column **"OEM Ticket Mail To"** (formerly "Mail ID") of the AC chosen on the ticket. Addresses of the company (`@citykartstores.com`, `@citykart.org`) go to CC, all others to To. |
| **OEM - PO approved / PO rejected+cancelled** | Same split | The AC sheet column **"OEM PO Mail To"** (formerly "Email for PO detail"). If that cell is empty, the AC's "OEM Ticket Mail To" is used. If both are empty nothing is sent and an internal note tells the Citykart technician to inform the OEM himself. |
| **Sender (From)** | `CitykartDesk <citykartdesk@citykartstores.com>` | Settings: the mailbox connected in Admin (e-mail from-name and address). |
| **Opt-outs** | - | A person can switch an event type off for himself, and an administrator can switch an event type off for everybody (Request Configuration > Notification Rules). Default: all on. A broadcast to a whole team is bell-only. |

Every person also gets a **bell message** in the app for most of these events; the table below is about e-mail.

## 2. The journey, mail by mail

### A. The ticket is raised and given to the vendor

| # | Trigger | To | CC | Subject | What it says |
|---|---|---|---|---|---|
| 1 | The store submits the ticket | **Store** | - | `Request created: CKSD-… — <title>` | "Your request … has been submitted via ADMIN - AC." + link. |
| 2 | Same moment, the AC's OEM is mailed (category set to send to OEM) | **OEM** (sheet "Mail ID") | Citykart addresses of that sheet row | `New AC Issue Ticket - CKSD-… - <store>` | A table: ticket no, contact person, e-mail, phone, store address, store code, AC number, serial, AC details, the issue and its description. No link (the OEM has no login). |
| 3 | A Business Rule gives the ticket to the vendor technician | **Vendor** | - | `Request assigned to you: CKSD-… — <title>` | "<assigner> assigned you to …" + link (he lands on his own ticket page). |
| 4 | Same moment | **Store** | - | `Your request has been assigned: CKSD-…` | "<Vendor name> is now handling your request." |

**Important:** the vendor rule must have a **lower order number than the old "ADMIN AC TICKET RULE_KRISHAN"** rule (0). If it runs after it, Krishan first gets a wrong "assigned to you" mail and the store gets two "assigned" mails. With the vendor rule first, only the vendor and the store are mailed (checked by the test). Local seed data now uses -20.

### B. The vendor works the ticket

| # | Trigger | To | Subject | What it says |
|---|---|---|---|---|
| 5 | Vendor presses **Start working** (OEM ticket number) | **Store** | `Request updated: …` | "status changed from Open to In Progress" + the line "<vendor> (vendor) started work on this ticket. OEM ticket number: …". Nobody else is mailed (not Krishan, not the OEM). |
| 6 | Vendor presses **Part required** | **Store** | `Request updated: …` | "from In Progress to Hold due to Purchase from HO" + the parts list. Krishan is NOT mailed (no PO). |
| 7 | Vendor **changes the parts list** | **Store** *(new)* | `Parts list updated (version N) - CKSD-…` | "<vendor> has updated the list of parts needed (version N). The request stays on hold until the parts arrive." + the new list (no prices) + link. The conversation message stays too. |
| 8 | Vendor presses **Parts received** | **Store** | `Request updated: …` | "from Hold … to In Progress" + the remark. |
| 9 | Vendor **withdraws** a parts request | **Store** | `Request updated: …` | "Hold … to In Progress" + "withdrawn by …, reason …". |
| 10 | A Citykart technician ends the hold himself | **Store** | `Request updated: …` | "Hold … to In Progress" + his remark. The pending vendor request is closed as cancelled. |
| 10b | Same moment (only if the ticket is with a vendor) | **Vendor** *(new)* | `Hold ended by Citykart - your parts request is closed - …` | "<name> of Citykart has taken this ticket back and ended the hold. Your request is closed. The ticket is In Progress again." + his remark + link; also a bell message. |
| 11 | Vendor or store writes a message | the **other side** (vendor writes -> **Store**; store writes -> **Vendor**) | `New comment on: …` | "<name> commented on …:" + the text + link. |

### C. PO required (the quote)

| # | Trigger | To | Subject | What it says |
|---|---|---|---|---|
| 12 | Vendor sends the **quote** (items, prices, quote file) | **Every approver of the AC** (one mail; Krishan by default) | `PO approval needed - CKSD-… - <vendor>` | "<vendor> needs a purchase order to repair the AC on the ticket below." Ticket, store, AC, vendor, the item lines, total without GST, and a sign-in link to the approval page. (The quote file itself is on the ticket under the message, not attached to the mail.) |
| 13 | Same moment | **Store** | `Request updated: …` | "In Progress to Hold due to Purchase from HO" + the quote lines and total. (Prices are visible to the store by your decision.) |
| 14 | Krishan presses **Ask for revised price** | **Vendor** | `Revised price needed - CKSD-… - <store>` | "<Krishan> has asked for a revised price" + "What was asked: <his note>" + link to the ticket. Nobody else is mailed. |
| 15 | Vendor sends the **revised quote** | **The same approvers** | `Revised quote (version 2) - PO approval needed - …` | "<vendor> sent a revised quote (version 2), the earlier total was X" + the new lines and total + the approval link. The old link now says "replaced by a newer version". |
| 16 | Krishan **approves** (PO number, date, document) | **OEM** (sheet "Email for PO detail") + CC Citykart addresses | `PO <no> approved - CKSD-… - <store>` | "Citykart has approved the purchase order": ticket, store, AC, vendor, PO number, PO date, the item lines, total, and the **PO document attached**. |
| 17 | Same moment | **Vendor** | `PO <no> approved - CKSD-… - <store>` | "<Krishan> has approved your quote. The ticket is back In Progress", PO number, date, lines, total, the **PO document attached**, link. *(fixed in this check: it used to be an empty "status changed from  to ." mail)* |
| 18 | Same moment | **Store** | `Request updated: …` | "Hold … to In Progress" + the approval line with PO number, date, lines and total. |
| 19 | Krishan **rejects only the quote** (reason) - the ticket goes on | **Vendor** | `Quote not approved - arrange the parts yourself - …` | "<Krishan> has not approved your quote. The ticket is NOT cancelled. Please arrange the parts yourself (no PO) and press Parts received", the reason, and the parts list kept on the ticket. The OEM is **not** mailed. The store is not mailed (the conversation shows it). |
| 20 | An approver **rejects and cancels the ticket** (reason) | **OEM** (sheet "OEM PO Mail To") | `PO request rejected - CKSD-… - <store>` | *(new wording)* "Citykart will not issue a purchase order for the AC repair on the ticket below, so the ticket is cancelled. Please do not do any further work on it." + reason. |
| 21 | Same moment | **Store** | `Request cancelled: …` | *(new wording)* "Cancelled because the cost of the repair was not approved (<name>). Reason: … If the AC is still not working, you can reopen the request within 48 hours." The store is not told about POs. |
| 22 | Same moment | **Vendor** | `Quote rejected and ticket cancelled - …` | *(new wording)* "Your quote for <CKSD-…> was rejected by <name> and the ticket is cancelled. Please do not do any further work on it." + reason. |
| 23 | Vendor **withdraws** a quote Krishan has not decided | **Krishan** | `Quote withdrawn by the vendor - …` | "<vendor> has withdrawn quote version N. Nothing more is needed from you." + reason. *(new in this check: before, Krishan was not told)* |
| 24 | Same moment | **Store** | `Request updated: …` | "Hold ... to In Progress" + "PO request withdrawn by …". |

### D. Resolved, reopened

| # | Trigger | To | Subject | What it says |
|---|---|---|---|---|
| 25 | Vendor **resolves** (list choice or Other + FSR) | **Store** | `Resolved: CKSD-… — <title>` | "has been marked resolved by <vendor>. Resolution: <words>", then five one-click rating links (1-5 stars) and a "not fixed - reopen" link. This is the only "resolved" mail (the rating mail replaces the plain one). |
| 26 | Store does not rate for 2 days | **Store** | rating reminder | One reminder (admin setting, default 2 days). |
| 27 | Store **reopens** the ticket | **OEM** (sheet "Mail ID") + CC | `REOPENED - New AC Issue Ticket - CKSD-… - <store>` | The same table as mail 2, with "REOPENED:" in the issue and the store's reason. |
| 28 | Same moment | **Vendor** | `REOPENED by the store - please attend again - CKSD-… - <store>` *(changed)* | "The ticket was REOPENED by <name> (reopened N times). The problem is not fixed." + the reason + "Enter the NEW OEM ticket number to start working" (the old number and date are cleared) + link; also a bell message and a red **Reopened ×N** tag on his dashboard and ticket page. |
| 29 | Same moment | **Store** | `Request updated: …` | "Resolved to Open. It's with <vendor>." |

## 3. Who gets what, in one view

- **Vendor technician:** hold ended by Citykart (10b) - assigned to you (3) - revised price needed (14) - PO approved with document (17) - quote not approved, arrange the parts (19) - ticket cancelled (22) - store's message (11) - reopened (28). He is never mailed about his own actions.
- **PO approvers of the AC (Krishan by default):** PO approval needed (12) - revised quote (15) - quote withdrawn (23). That is all: not for parts-only requests, not for ordinary ticket events. *(A Citykart-side "assigned to you" mail appears only if the old Krishan rule runs before the vendor rule.)*
- **OEM:** new ticket (2) - PO approved (16) - PO rejected and cancelled (20) - reopened (27). Not mailed when only a quote is rejected (19), when a quote is revised, or when the vendor starts, holds or resolves.
- **Store:** created (1) - assigned (4) - every status change (5, 6, 8, 9, 10, 13, 18, 24) - messages (11) - cancelled (21) - resolved with rating links (25) - reopened (29). It does **not** get mail for revised-price requests, revised quotes, or a quote that is rejected while the ticket goes on.

## 4. What I found while checking (and what was done)

| Finding | Status |
|---|---|
| The vendor's mail for "PO approved" and "ticket cancelled" read "status changed from  to ." (blank) | **Fixed**: dedicated mails (17, 22); the PO document is attached to the vendor's mail |
| The mails said "The quote is attached" / "The PO document is attached", but the file is on the ticket, not in the mail | **Fixed**: wording now says the file is attached to this message on the ticket |
| Krishan was not told when the vendor withdrew a quote | **Fixed** (23) |
| The old "ADMIN AC TICKET RULE_KRISHAN" rule (order 0) ran before the vendor rule and mailed Krishan and the store | **Handled**: vendor rules must have a lower order number (set locally to -20; to do on live when the vendor releases go) |
| The parts list changes (7) sent no mail to the store | **Fixed** (the store now gets the new list) |
| No reminder for a quote that waits for Krishan, or for a revision the vendor has not answered | **Not built** - suggestion: remind Krishan after 1 day and the vendor after 2 days (your decision) |
| A vendor who replies to a mail by e-mail | **Not tested** - the replies of known participants are posted into the conversation for normal users; whether a vendor's reply is accepted is not checked yet |
