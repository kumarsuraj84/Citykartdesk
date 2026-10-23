# Vendor technicians (OEM engineers log in to Citykart Desk) — design

**Status: design approved by the owner on 2026-10-22 (answers in §2). BUILT AND TESTED LOCALLY on 2026-10-22 (releases 8, 9 and 10 in the full local build); NOT pushed, NOT deployed.**
Where the build differs from the first draft of this document, the build is described in §8 and §16.
It replaces the dropped "engineer visit / FSR" release 4. Build locally, one release at a time (§13). Nothing is pushed to `main` or deployed without the owner's word.

---

## 1. In one minute (plain words)

AC repair is done by the OEMs' own engineers (Voltas, Blue Star …). Today they work outside Citykart Desk and we chase them by e-mail. Instead, each **vendor technician gets a login**. A business rule hands every AC ticket to the right vendor technician. He sees only his own tickets in a small dashboard, starts work (typing the OEM's own ticket number), asks for a PO or parts if needed, and resolves the ticket by picking a reason from the AC RESOLUTION list and attaching the FSR.

Citykart staff see the **same normal statuses as today**. No new status is created. The vendor's boxes are only a different way of looking at the same statuses.

## 2. Decisions the owner has made

| # | Topic | Decision |
|---|---|---|
| 1 | Statuses | **No new statuses.** "PO required" and "Part required" both use the existing **Hold due to Purchase from HO** (SLA clock stops). |
| 2 | Cancel | The vendor **cannot cancel**. Only a Citykart technician or the requester can. The vendor sees such tickets in the **Cancelled** box. |
| 3 | OEM e-mail on creation | **Continues as today**, but the ticket does **not** move to In Progress by itself; it stays **Open** until the vendor clicks **Start working**. |
| 4 | PO approver | **Krishan** by default; an administrator can change the person in a setting. Applies to **AC-template tickets only**. All other approvals work exactly as today. |
| 5 | What the vendor sees | Only tickets assigned to him, **without Citykart's internal notes**. A vendor **manager** sees (read-only) all tickets of the technicians of **his own company**. |
| 6 | Routing | By the AC's **AMC vendor / brand** and the store's **region**, round-robin among that vendor's technicians. |
| 7 | Resolution list | The existing **AC RESOLUTION** list, plus a new option **Other** (remarks compulsory). Administrator can edit the list any time; removing an option never changes old tickets. |
| 8 | PO-details e-mail | Sent to the sheet column **"Email for PO detail"**: **on approval** with the PO details, **on rejection** as a short note. |
| 9 | Prices | Visible to everyone who can see the ticket (no special hiding). |
| 10 | PO rejected | **Ticket is cancelled**, exactly like a rejected approval today (the store can reopen within 48 hours). |
| 11 | Reopen | Ticket goes back to the **same vendor technician's Open box**; the OEM e-mail is sent again as for a new ticket; a **new OEM ticket number is compulsory** and **replaces the old one**. |
| 12 | PO approval page | Opened from the e-mail link but **needs a CK Desk login** (no code-only access). |

## 3. People (logins)

| Login | Sees | Can do |
|---|---|---|
| **Vendor technician** | Only tickets assigned to him | Start working, ask for PO, ask for parts, mark parts received, resolve, comment, see his PO list |
| **Vendor manager** | All tickets of his company's technicians | **Read only** (view, search, download); no actions |
| Citykart technician / manager / admin | As today, plus a note on the ticket "With vendor: Ramesh (Bluestar) — PO requested / Parts required" | Everything as today; may also cancel or take a vendor ticket back |
| **PO approver** (Krishan, changeable) | The PO approval page | Approve (enter PO number, date, document) or reject with reason |

A **vendor company** (Voltas, Blue Star, …) groups its technicians and manager. Administrator creates companies and invites people in *Admin → Vendors*.

## 4. What the vendor sees

**Dashboard** (`/vendor`) — six boxes with counts; click a box to see the list:

| Box | Real ticket state |
|---|---|
| **Open** | `open` / `assigned` |
| **In process** | `in_progress` |
| **PO required from Citykart** | `hold_purchase_ho` with a pending PO request |
| **Part required** | `hold_purchase_ho` with a pending parts request |
| **Resolved** | `resolved` / `closed` |
| **Cancelled** | `cancelled` |

Plus: **My POs** page (§8). The vendor's menu holds only these pages and his profile. Reports, analytics, report builder, other tickets, admin screens are blocked for vendor roles (menu, route guard **and** database).

**Ticket page for a vendor** shows: store, address, AC details (brand, tonnage, serial), the store's problem text, the conversation (public comments only), attachments (not internal ones), his action buttons.

## 5. The ticket flow, step by step

```
Store raises AC ticket
   │  business rule picks the vendor technician (AMC vendor + region, round-robin)
   │  OEM e-mail goes (as today); ticket stays OPEN
   ▼
OPEN  ── vendor clicks "Start working" and types the OEM ticket number (compulsory)
   ▼
IN PROGRESS ─────────────┬───────────────────────────────────────────────┐
   │                     │ "PO required"                  │ "Part required"
   │                     ▼                                ▼
   │           HOLD (PO) + approval to Krishan    HOLD (parts) — no PO
   │             approve ─► back to IN PROGRESS     vendor clicks "Parts received"
   │             reject  ─► CANCELLED                 ─► back to IN PROGRESS
   ▼
RESOLVED (pick from AC RESOLUTION or "Other" + FSR)
   ▼
Store satisfied ─► closed.   Store not satisfied ─► REOPEN ─► back to OPEN of the same vendor technician
```

### 5.1 Assignment
- The existing **Business Rules** screen is used. Two things are added: new **conditions** (AC's AMC vendor, AC's brand, store region/state/cluster) and a new **action "Assign to vendor technician(s)"** (direct or round-robin over the chosen vendor technicians). Today's *assign* action only accepts people of the ticket's team, so vendors need their own action.
- If no rule matches, nothing changes: the ticket behaves as today (OEM e-mail and automatic In Progress).
- For a ticket assigned to a vendor technician the **OEM routing no longer moves the ticket to In Progress**; it only sends the e-mail.
- The AC details used by the rule (vendor, brand, region) must already be saved on the ticket when the rule runs; today they are saved *after* the rules, so the order is changed (§12).

### 5.2 Start working
- Button **Start working** opens a small window with one compulsory box: **OEM ticket number**.
- Saved into the existing field **AC OEM Ticket Number**; **AC OEM Ticket Creation Date** is filled automatically with that day.
- A public note is posted: "Vendor started work. OEM ticket no. X". This is also the "first response" for the SLA.
- Without the number the ticket does not move.

### 5.3 Resolve
- Window: a dropdown with every option of the **AC RESOLUTION** list **plus Other**; **remarks** box (compulsory when Other); **FSR attachment compulsory**.
- The chosen reason is saved in the field **AC resolution** and posted in the conversation as the resolution (`Resolution: <reason>` + remarks). For **Other**, the typed remarks are the final resolution text.
- The usual resolution-quality check and the store's CSAT e-mail work as today.
- A vendor cannot resolve straight from Hold; he must first return the ticket to In Progress.

### 5.4 Parts required (no PO)
1. Vendor clicks **Part required**; a window takes lines: **item name + qty** (add as many lines as needed).
2. Ticket → **Hold**; the lines appear in the conversation; Citykart sees "With vendor … Parts required". SLA stops.
3. When the engineer comes with the parts the vendor clicks **Parts received** (a remark is compulsory), the ticket returns to **In Progress**, and only then can he resolve.

### 5.5 PO required
1. Vendor clicks **PO required**; lines: **item name, qty, price without GST**; the window shows the total. Add as many lines as needed.
2. Ticket → **Hold**; lines and total appear in the conversation. SLA stops.
3. **One** e-mail goes to the PO approver (Krishan) with a link. The link opens `/vendor-po/<id>` and **requires login** (the generic 6-digit-code path is not used).
4. The approver sees the lines and either
   - **Approves** — must enter **PO number**, **PO date** and attach the **PO document**; or
   - **Rejects** — must give a reason.
5. **On approval:** ticket returns to **In Progress**; the vendor is notified and sees the PO number, date and document; **one e-mail** (with PO number, date, items and the document) goes to the AC's **"Email for PO detail"** address; the vendor then resolves in the normal way.
6. **On rejection:** ticket is **Cancelled** (reason "PO rejected": same behaviour and 48-hour reopen window as a rejected approval today); **one short e-mail** goes to the "Email for PO detail" address ("PO rejected, ticket cancelled, reason …"); the vendor and the requester are notified.
7. While a PO request is pending the vendor cannot take the ticket out of Hold himself. A Citykart technician still can (remark compulsory); that cancels the open PO request.

### 5.6 Reopen by the store
- Existing reopen rules and window apply. The ticket returns to **Open**, **assigned to the same vendor technician**.
- The OEM e-mail is sent again (the "REOPENED" e-mail that already exists).
- **AC OEM Ticket Number** and **AC OEM Ticket Creation Date** are cleared (the old number stays in the conversation/history); the vendor must type the **new** number at Start working, which replaces the old one.

### 5.7 Cancel
Only a Citykart technician/manager or the requester can cancel. A cancelled ticket shows in the vendor's **Cancelled** box.

## 6. PO register

| Page | Who | What |
|---|---|---|
| **My POs** (`/vendor/pos`) | Vendor technician (own) and vendor manager (company) | PO number, PO date, ticket number, store, items, amount without GST; search, filter by date/store/status, download |
| **Purchase orders** (`/purchase-orders`) | Citykart technicians, managers, admins | Every PO of every vendor with the ticket number; filters; **Excel download** |
| Ticket page | Everyone who can see the ticket | The ticket's PO(s): number, date, document, lines |

## 7. E-mails (all with the standard template/sanitising; none for vendors' internal notes)

| When | To | Content |
|---|---|---|
| Ticket created | OEM address from the sheet ("Mail ID") | As today |
| Ticket assigned to a vendor technician | The technician | New ticket |
| Reopened | OEM + the same vendor technician | "REOPENED …" + reason |
| PO requested | PO approver | Link to the approval page |
| PO approved | OEM "Email for PO detail" + vendor technician | PO number, date, items, document |
| PO rejected | OEM "Email for PO detail" + vendor technician + requester | Short note with reason; ticket cancelled |
| Parts requested | Citykart technician team / assignee-of-record | Informational |

If a PO address is missing in the sheet, the PO-details e-mail falls back to the AC's normal "Mail ID"; if that is also missing, an internal note tells the technician to inform the OEM by hand. Nothing is lost.

## 8. Data model (new; names indicative, final names at build)

- **Who is a vendor** (built differently from the first draft): a vendor is an ordinary requester-level account (`role = user`) that also carries `profiles.vendor_company_id` and `profiles.vendor_role` (`technician` | `manager`). The role list is NOT extended: every existing "not a requester" test in the database then keeps treating a vendor as the least trusted kind of person. A person cannot change these two columns himself (profile guard trigger); a vendor needs both columns or neither (check constraint).
- **vendor_companies**: `org_id`, `name`, `is_active`. Optional "sheet names" list so the AC sheet's text ("Voltas", "BLUE STAR") is matched to the company.
- **vendor_requests**: one per PO/parts request — `request_id`, `kind` (`po`|`parts`), `status` (`pending`|`approved`|`rejected`|`received`|`cancelled`), `created_by`, `approver_id`, PO number, PO date, PO document (attachment), decision reason, timestamps, total (without GST).
- **vendor_request_items**: `item_name`, `qty`, `price_excl_gst` (null for parts).
- **AC unit (master AC)**: new column `po_email`, read from sheet column **"Email for PO detail"** (22nd; found by heading, comma/semicolon lists allowed, same address checks as "Mail ID").
- **Settings**: `vendor_po_approver_id` (default Krishan; admin can change).
- **Business rules**: new condition fields (AC AMC vendor, AC brand, store region / state / cluster, read from the AC saved with the ticket) and the existing **Assign to** action also accepts vendor technicians (round-robin or direct). A rule NEVER takes a ticket away from a vendor technician (an "edited" rule that always assigns AC tickets to a Citykart technician cannot undo the routing).
- **Transitions**: the database transition function and `SERVER_ALLOWED_TRANSITIONS` gain `hold_purchase_ho → cancelled` (used only by PO rejection). No other status change.
- **Ticket reading rules (RLS)**: vendor technician sees a ticket only when `assigned_to = him`; vendor manager when `assigned_to` is a technician of his company; comments marked internal and internal attachments are never returned to vendors; vendors have no access to other tables (people list, reports, stores beyond the ticket's own store). Every existing policy that tests "role in (...)" is reviewed so a new role gets **no** access by accident.

## 9. Rules that must hold (these become tests)

1. A vendor never reads a ticket that is not assigned to him (technician) / his company (manager), by any route: pages, API, exports, search, report builder, storage download.
2. A vendor never reads an internal comment or internal attachment.
3. A vendor cannot cancel, reassign, change priority/category, or approve anything.
4. A vendor manager cannot change anything.
5. Start working fails without the OEM ticket number; resolve fails without a reason, without the FSR, or (for Other) without remarks.
6. From Hold the vendor can only go to In Progress (parts received), never straight to Resolved; and not while a PO request is pending.
7. PO approval needs a login, the right approver, PO number, PO date and document. Nobody approves a PO of another organisation. The approver cannot approve a PO that he raised.
8. PO rejection cancels the ticket exactly once; a second click does nothing.
9. The SLA clock pauses in Hold and resumes with pause credit (existing logic, unchanged).
10. Reopen returns the ticket to the same vendor technician, clears the OEM number, and sends the OEM e-mail again once.
11. Tickets that no vendor rule matches behave exactly as today.
12. Removing an option from the AC RESOLUTION list does not change an old ticket's recorded resolution.
13. Other approvals (non-AC) behave exactly as before.

## 10. Screens to add / change

- `/vendor` dashboard (six boxes, list, search) and vendor ticket page.
- `/vendor/pos` and `/purchase-orders` (Excel download).
- `/vendor-po/[id]` approval page (login required).
- Admin → **Vendors** (companies, technicians, manager, PO approver setting).
- Business-rule builder: new conditions and action.
- Sidebar per role; Start working / Resolve / PO / Parts windows.
- Citykart ticket sidebar: "With vendor: <name> (<company>) — PO requested / Parts required" note.
- AC RESOLUTION list: add **Other** (a template edit by the administrator; no code).

## 11. Security notes

- Vendors are outside Citykart's teams on purpose (team membership opens up many tickets).
- Vendor logins are created by an administrator only (invite); same password rules, rate limits and sign-in protections as everyone.
- PO documents and FSR files go through the standard attachment validator and are served only to people who may see the ticket.
- The PO approval page checks login, role/approver identity and organisation on the server.
- No change to the public routes list. (`/engineer` and the visit code secret from release 4 are **not** needed.)

## 12. Existing code that must change (so nobody is surprised)

| Place | Change |
|---|---|
| `lib/requests/master-routing.ts` | After sending the OEM e-mail, **do not** move the ticket to In Progress when it is assigned to a vendor technician |
| `lib/requests/create` flow (§6.3 of the design) | Save the AC snapshot **before** running Business Rules, so rules can use AC vendor/brand/region |
| `lib/requests/status-change.ts` | Technician-mandatory-field gate becomes **stage-specific for vendors** (OEM number at Start; resolution at Resolve); vendor-only checks (no cancel, no Hold→Resolved, no resume during a pending PO); reopen clears OEM number/date and keeps the assignee |
| `lib/constants/request-transitions.ts` + DB function | `hold_purchase_ho → cancelled` for the system (PO rejection) |
| `lib/masters/*` | Read the "Email for PO detail" column |
| Business Rules (`lib/rules/*`) | New condition fields and the `assign_vendor` action |
| Row-level security and route guards | New roles; review of every role list |
| Notifications / e-mail templates | The new e-mails of §7 |

## 13. Build in three independent releases (all local first)

| Release | Content |
|---|---|
| **8 — Vendor core** | Roles, vendor companies, Admin → Vendors, rule conditions + action, vendor dashboard and ticket page, Start working (OEM number), Resolve (list + Other + FSR), reopen back to the same technician, stage-specific gate, OEM routing change, vendor manager (read-only) |
| **9 — Parts required** | Parts window, Hold, "Parts received", boxes "Part required", note on the Citykart ticket |
| **10 — PO flow and register** | PO window, approval page, PO number/date/document, reject → cancel, PO-details e-mails, "Email for PO detail" from the sheet, My POs, Purchase orders + Excel |

Each release has its own branch, its own migration and its own tests, and is pushed only when the owner says so (for example "push vendor core one"). Release 9 and 10 need release 8.

## 14. Tests planned

- Unit: vendor stage gates, resolve rules, PO totals, transition rules, routing order, "Email for PO detail" parsing.
- Isolated test stack (21-point gate): row-level fencing of vendor technician / manager, internal comment hiding, storage download fencing, PO approval authorisation, reject-cancel once, reopen clears OEM number, other approvals unchanged.
- Local walk-through with real-looking logins for two vendors (Voltas 2 technicians, Blue Star 3 technicians, one manager each), the PO approver, a store and a Citykart technician. Mail only to the local mail sink.

## 15. Open items (small, can be settled while building)

- Names of the vendor people and the vendor-company ↔ sheet-name mapping (administrator enters them).
- Which regions go to which vendor technicians (written as Business Rules by the administrator).
- Exact wording of the e-mails (shown to the owner before release).

## 16. As built (2026-10-22) - what to know

- **Migrations** (local numbering; renumbered when released): 177 vendor core (companies, profile columns, row-security for tickets, comments, attachments and visible names, profile guard), 178 vendor requests (parts / PO records and their lines), 179 vendor PO (approver, PO number / date / document, the AC master's PO address, a held ticket may be cancelled by the system).
- **Release 8 - vendor core**: Admin > Vendors, `/vendor` dashboard and ticket page, Start working (OEM ticket number, date filled), Resolve (live AC RESOLUTION list + Other + FSR), message box, the ticket stays Open after the OEM mail, reopen back to the same technician with the OEM number and date emptied, the two new rule conditions, vendor logins refused everywhere else (menu, page guard, ticket creation, status actions).
- **Release 9 - part required**: item lines, Hold, "Parts received" with a remark, the "Part required" box, the "With vendor ..." note on Citykart's ticket page; a Citykart technician who ends the hold closes the pending request.
- **Release 10 - PO**: PO window with prices, one approval mail and bell message to the approver, `/vendor-po/<id>` (login needed; only the approver or an administrator decides), approve (number, date, document -> In Progress, one mail to the OEM with the document), reject (reason -> cancelled with 48 h to reopen, one short mail), PO register for vendors (`/vendor/pos`) and Citykart (`/purchase-orders`) with Excel download, the AC sheet column "Email for PO detail" (falls back to the AC's normal OEM address), the PO approver setting (Krishan until an administrator names somebody else).
- **Tests**: `tests/unit/vendor-module.test.ts` (18) and `tests/vapt/36-vendor-module.test.ts` (14, on the isolated stack: row-level fences, vendor-only status changes, start / resolve, parts, PO approve and reject, reopen, rules). The existing integration suites were re-run and stay green.
- **Local test data**: `local-testing/seed-local-vendors.mjs` (companies, logins, test AC units, two routing rules) and `local-testing/make-vendor-test-ticket.sql`.
- **Dropped**: the engineer-visit module (old release 4) was removed from the local build, with its public `/engineer` page, the visit code secret and the visits scheduled task.

## 17. Quote versions and revised price (added 2026-10-23, built locally)
- **A PO is final; a quote is negotiated.** What a vendor sends for "PO required" is a QUOTE (items, quantity, price without GST, and the compulsory quote file). Every change is a new quote VERSION; the earlier one becomes "replaced" and can no longer be approved. The PO exists only when the approver approves the final quote (PO number, date, document); the register shows real POs by default (with the quote version it is based on).
- **Revised price:** the approver does not enter prices. On the approval page he can Approve, **Ask for revised price** (a note is compulsory) or Reject. Asking moves the ticket on the vendor's dashboard from "PO required from Citykart" to **"Revise price required"** (the ticket stays on hold, the clock stays paused). The vendor opens it, sees the note, changes the prices, attaches a **new** quote file and sends; the ticket returns to "PO required" and the approver gets ONE new request.
- **Files under their messages:** the quote, the revised quote, the PO document and the FSR are tied to the conversation message they belong to (they used to appear only in the "request submitted" block at the bottom).
- **Parts list:** the vendor can change it while on hold (a new version) and can withdraw a parts or quote request (reason compulsory; the ticket returns to In Progress).
- **Dashboard boxes (in order):** Revise price required, Open, In process, Part required, PO required from Citykart, Resolved, Cancelled, each with a "whose turn" line; he lands on the box that needs him.
- **Database:** migration 180 (version, replaces, quote files, revision note, new request states, one open request per ticket). Tests: unit (21) and integration (18, including both flows).

## 18. PO approvers from the AC sheet, new mails, reopen tag (added 2026-10-23, built locally)
- **AC sheet columns** (found by heading; the older headings still work, the new one wins if both exist): **OEM Ticket Mail To** (was "Mail ID"), **OEM PO Mail To** (was "Email for PO detail"), **CK PO Approver Mail To** (new). The Genset sheet keeps "Mail ID", the CVM sheet "CVM EMAIL ID".
- **Approvers per AC:** the quote goes in ONE mail (To: all) to the Citykart people named in "CK PO Approver Mail To" for that AC, plus a bell message each. Each must be an active technician, manager or admin with a CK Desk login (checked on the Master data health page: "approver_no_login" warning; a bad address is a "bad_approver_email" warning). Empty or no valid address: the **Default PO approver** (Admin > Vendors, Krishan) is used. Any approver (or an administrator) can approve, ask for a revised price or reject; the first decision wins and the others see "already decided by <name>". A revised quote and a withdrawal go to the same approvers. The AC row is read live when the quote is sent; the copy saved on the ticket is used if the row has left the sheet.
- **Database:** migration 181 (`master_ac_units.approver_emails`, `vendor_requests.approver_ids`; the first approver is still kept in `approver_id`). Rollback: `supabase/rollback/181_vendor_approvers_rollback.sql`.
- **New / changed mails:** store told when the parts list changes (with the list); vendor told (mail + bell) when Citykart ends the hold; reject-and-cancel mails re-worded for the OEM ("will not issue a purchase order ... do not do any further work"), the store ("the cost of the repair was not approved ... you can reopen within 48 hours") and the vendor; the vendor's reopen mail is its own "REOPENED by the store - please attend again" mail with the reason and the reminder to enter the NEW OEM ticket number; a red "Reopened xN" tag on his dashboard and ticket page. Code: `lib/vendor/ticket-notify.ts`, `lib/vendor/po-mail.ts`.
- **Tests:** unit (parsing of the new headings and aliases, approver mail wording), integration 34 (columns stored, health-page warning), 36 and 37 (approvers, first decision wins, fallback, every new mail).
- **Not built (waiting for the owner):** reminder to the approver after 1 day for a waiting quote and to the vendor after 2 days for an unanswered revision request.
