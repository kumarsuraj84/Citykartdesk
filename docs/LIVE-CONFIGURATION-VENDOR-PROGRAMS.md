# Live configuration after the Vendor Programs release (RO Purifier, Sensomatic, and every program after them)

Servers: app 10.0.1.98, database 10.0.0.205 (`ckdesk`). Vendor and OEM mean the same thing in CK Desk and in the sheets.
Rule for everybody: no test, UAT or false entries on live. Every step below is either a setting or a real ticket. Mail checks use "Send a test to me" (it makes no ticket and mails only you).

## A. What is already on live (read-only check, 2026-10-29)
- Programs **RO PURIFIER** (231 rows, sheet 2) and **SENSOMATIC** (3 placeholder rows, sheet 3) exist, switched OFF, level "mail", one row per store.
- Categories `RO-PURIFIER ISSUE` and `SENSOR MACHINE ISSUE` are in them; their sub-categories are in the active service **ADMIN REPAIR**.
- `Ticket Mail To`, `PO Mail To`, `Quote Approval Mail To` are empty in both sheets; the RO sheet shows 2 store codes not in CK Desk (KGP, NLD) and CK Desk has 2 stores missing in the sheet (MKG, NEG).
- Both mail wordings have a fixed "Contact Person: Mohd. Shuaib" and no Warranty row.

## B. Before the push (sheets, 15 minutes)
What the sheet is used for, and nothing more: the **e-mail addresses**. `Ticket Mail To` = the first mail when a ticket is raised (always used). `PO Mail To` = the mail to the vendor when the approver attaches the PO, and `Quote Approval Mail To` = the approvers who get the mail when the vendor sends a quote: **these two are used ONLY when the vendor portal is switched on for that program** (a vendor technician sends the quote). For a mail-only program (the mail goes to the OEM and your own technicians do the work) they are ignored, so you may leave them empty. Which vendor TECHNICIAN gets a ticket is never taken from the sheet: it is set in CK Desk (Business Rules). `Store Code` finds the store's row; `Vendor` and every other column (Warranty, helpers) are only shown / usable in the mail wording.
1. RO and Sensomatic sheets: delete the `Status` column (done); keep unique headings. The columns CK Desk reads: `Store Code`, `Ticket Mail To`, `PO Mail To`, `Quote Approval Mail To` (and `Vendor` for the mail wording).
2. Put your formulas in those columns (they are read as their results). Keep the helper columns on the right with DIFFERENT headings (for example `UW Vendor`, `OW Vendor`): if two columns have the same heading the first one wins.
3. Only for programs with the vendor portal ON: `Quote Approval Mail To` must hold the e-mail of an ACTIVE CK Desk login (technician, manager or admin). An address that is not a CK Desk login is skipped and the **default approvers of that program** (set on the program screen) decide instead. If the sheet names nobody for a store, the quote goes to the program's default approvers too.
4. Fix the store codes: KGP and NLD (not in CK Desk) and MKG, NEG (in CK Desk, not in the sheet).
5. Sensomatic: delete the 3 placeholder rows (xtz, chjk, hjhk) and the 4 rows with no Store Code.
6. One store = one row. A store written twice mails both rows.
7. A cell with a formula error (#N/A) shows as a bad address in the problem list: keep the formulas error-free.
8. The sheets are copied at 11:00, 15:00 and 19:00 (or press "Update from sheet now"). A warranty that ends today changes in CK Desk at the next copy.

## C. The push and the deploy (I give the commands)
1. Database 10.0.0.205: migration 187 (adds `vendor_companies.aliases`, `vendor_companies.rr_index`, `vendor_programs.resolution_options`; nothing existing changes). Backup first (the script does it).
2. App 10.0.1.98: the new zip. The old app is kept as `standalone-bak-<time>`.
3. Check after: health ok, build id, all scheduled tasks Ready, Admin > Vendor Programs opens.

## D. Admin > Vendors (the vendor companies and their people)
1. **Create each vendor company** (for example "Radhey Water solution").
2. (the company name is only a label for your own screens, mails and reports: the sheet is not matched to it)
3. **Add the logins**: as many technicians as you want per company, and one or more managers (a manager only VIEWS the tickets of his company's technicians). A login is created by name + e-mail; the person gets the "set your password" mail. Check that the mail arrives. A technician sees only the tickets given to him.
4. The **default PO approver on this page is for AC only**. Every Vendor Program has its OWN default approvers on its program screen (E5). There is no global default for programs.
5. A company needs at least one active technician for a Business Rule to be able to assign tickets to it.

## E. Admin > Vendor Programs > RO PURIFIER and SENSOMATIC (each one)
1. **1 Name and kind of sheet**: one store per row (already set).
2. **2 Categories**: `RO-PURIFIER ISSUE` / `SENSOR MACHINE ISSUE` ticked (already).
3. **3 Google Sheet**: link saved; press "Update from sheet now"; read "Problems found". Nothing red.
4. **4 The mail**: write the wording. Use the field buttons: `{{ticket_no}}`, `{{subject}}`, `{{description}}`, `{{requester_name}}`, `{{requester_email}}`, `{{requester_phone}}`, `{{store_address}}`, `{{store_code}}`, `{{vendor}}`, and `{{extra_warranty}}` (any extra column of the sheet is `{{extra_<heading>}}`). Decide if "Contact Person" is the store requester (`{{requester_name}}`) or a fixed Citykart person (then every vendor mail shows that person). Press "Save the mail", then "Send a test to me" and read it (it is mailed to you only, no ticket is made).
5. **5 What happens to the ticket**: choose **"The vendor works the ticket in the vendor portal"**. Then:
   - **How the ticket reaches a vendor technician**: only through **Business Rules** (Admin > Business Rules), set up in CK Desk exactly as you do for Citykart technicians. New conditions: **Vendor Program** (RO Purifier, Sensomatic, AC, Genset), **Vendor company** (of the technician who has the ticket), **Ticket is with a vendor technician**, **Store of the requester** (plus the existing Category, Service, Location, Requester ... ). New action choice in "Assign": **all the active technicians of a vendor company** (direct / round robin / load balanced) - a technician you add to the company later takes part without editing the rule - or the usual chosen people. Example: Vendor Program = RO Purifier AND Store = (a store list) -> Assign to all technicians of "Radhey Water solution", round robin. Nothing in the sheet routes a ticket. A rule that runs first and assigns a vendor technician is never undone. A ticket no rule gave to a vendor technician stays with Citykart staff, with an internal note, to assign by hand.
   - **Default PO approvers of this program** (choose people on the program screen): they decide a vendor's quote when the sheet column Quote Approval Mail To names nobody (or nobody who is an active login). Each program has its own. This and the two sheet columns PO Mail To / Quote Approval Mail To matter ONLY when the vendor portal is ON for the program. The check list needs either default approvers or an approver on every row.
   - **The OEM ticket number switch**: "The vendor must enter the OEM ticket number to start work" (off by default for programs; AC always needs it). Switch it on later for a program when you want it compulsory.
   - Write **the list of resolutions** (one per line) for THIS program, press "Save the resolutions". "Other" is always offered in addition (the vendor then writes what he did, at least 10 characters). Each program has its own list.
6. **Check my set-up**: all red items must be green. Amber items are warnings: "vendors not a vendor company" (go back to D) and "company without technician".
7. **Switch on** (only after D is done and the sheet has real rows with real addresses).

## F. How a ticket then works (nothing to configure, for your information)
1. The store raises a ticket in the category. CK Desk finds the row of the store in the sheet, mails the `Ticket Mail To` addresses (vendor in To, company people in CC) and writes the mail as a table in the conversation. The saved row stays with the ticket (a later sheet change never changes an old ticket).
2. **The ticket stays Open** for the vendor technician your Business Rule gave it to (no rule = it stays with Citykart staff with a note). The technician and the store are told.
3. The vendor technician signs in (`/vendor`), opens the ticket and presses **Start working**. The **OEM ticket number** is compulsory for AC; for a program it is optional until you switch it on (E5), and then a vendor who has none writes any reference, for example NA. When given it is written in the conversation and saved: in the form's own box if the ticket's form has a box whose label ends with "OEM Ticket Number" (and "OEM Ticket Creation Date"), otherwise in the background of the ticket (always shown on the vendor's page and list).
4. **Part required** (parts list, no prices; the ticket goes on hold) and **PO required** (parts with prices and the quote file; sent to the approvers named in `Quote Approval Mail To`, any one decides, the first decision wins; the approver enters the PO number, date and document; the OEM is mailed at `PO Mail To` with the PO document; a revised price can be asked; a quote can be rejected with or without cancelling the ticket). It is exactly the AC flow; the mails and screens say the program name instead of "AC".
5. **Resolve**: the vendor chooses from the program's list (or Other with words) and must attach the FSR.
6. **Reopen** by the store: the same vendor and technician get it again, the OEM ticket number is cleared and entered again.
7. **E-mail replies**: a vendor who answers the ticket mail by e-mail is added to the conversation as a reply (the old quoted thread is cut, the files are added under the reply). Only people of that mail (the addresses in its To / CC line) can answer.
8. A store with no row in the sheet, an empty `Ticket Mail To`, or no rule that matches: the ticket stays Open with an internal note for the Citykart technician group, never lost.

## G. Form template of the service (ADMIN REPAIR)
1. **Do not add a resolution list to the template.** A program's resolution list lives in the program (E5).
2. **OEM ticket number box (optional)**: add a technician-only box "OEM Ticket Number" (and "OEM Ticket Creation Date") to the template only if your staff want to SEE the number in the ticket's details or in reports. If there is no such box nothing breaks: the number is kept in the background and shows on the vendor page, the vendor list and the conversation.
3. **Remove nothing now.** Keep the AC form template exactly as it is: its "AC OEM Ticket Number", "AC OEM Ticket Creation Date" and "AC resolution" boxes and list are still used by live AC tickets. They will be removed only when AC itself moves onto Vendor Programs (then AC gets its own list in its program, like the others).
4. Service **ADMIN REPAIR**: "Route to OEM" stays UNTICKED (only the AC service has it ticked; reports use it to recognise AC tickets).

## H. Routing and staff (check once)
1. **Business Rules (needed)**: create the rules that assign RO / Sensomatic tickets to the vendor technicians (see E5). If a rule of the service assigns the ticket to a Citykart technician first, a later rule that assigns a vendor technician takes over, and nothing takes a ticket back from a vendor technician. Put the vendor rules BEFORE the general rules (a lower execution order number).
2. Keep the Citykart technician group of ADMIN REPAIR: it handles every ticket the program could not give to a vendor.
3. PO approvers: the people named in the sheets and the default approver must be active staff logins.

## I. Go-live without test tickets
1. Pilot by the sheet: fill the addresses only for a few real stores first. A store with no address is not mailed (the ticket stays Open with a note), so nothing wrong goes out. Add the other stores after the first real tickets worked.
2. Watch the first real ticket: the mail (conversation table), the technician assigned, Start with the OEM number, a reply by e-mail (with a file if the vendor sends one), parts / PO if needed, resolve.
3. If anything is wrong: Vendor Programs > the program > **Switch off** (tickets are normal tickets again), or `rollback-app.ps1` on 98 for the app.

## J. Not in this release (for later)
Resolution list for AC and Genset as their own program lists; AC and Genset onto the engine; scheduled (PMS-style) tickets for programs; program tickets in the AC reports.

## K. What the conversation shows (nothing to configure)
- The mail sent to the vendor: as a table (like the mail itself).
- The vendor's e-mail reply: only the new words (the old quoted thread is cut), with its files under it.
- A vendor's parts list ("Part required") and quote ("PO required from Citykart", revised quote, PO approved, quote not approved, parts list updated): as a table with Item and Qty, and Price (without GST), Line total and the Total when the vendor gave prices. Older messages of this kind (AC too) are shown the same way.
