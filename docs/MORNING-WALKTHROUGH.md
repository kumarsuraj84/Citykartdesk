# Morning walkthrough: everything is DONE in local, look at it one by one

Everything here is in the LOCAL app (http://localhost:3210) and the LOCAL database. Nothing is on main or on a server (live is still build 488e0bd).
Sign in with your own local login. Mail in the local app is never sent outside: it is saved as a file in the folder `local-mail-outbox` (the newest file is the newest mail).
Commands are for PowerShell in `D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate`.
Git: tonight's work is on local branches only (nothing pushed): `local/night-2026-10-31` = everything except the clean-up; `local/cutover-cleanup` = that + the clean-up (checked out now).
To drop the clean-up: `git checkout local/night-2026-10-31`.

## 1. Search inside Category / Sub Category on the ticket page
Open any ticket (as admin or technician). Right side: click **Category** and type a few letters in the **Search category...** box; pick one: the **Sub Category** pop-up opens with its own **Search sub category...** box. Picking a sub category asks for a reason (10 characters); Cancel saves nothing.

## 2. Linked filters (Service > Category > Sub Category)
Agent Requests > **Technician Group Queue**: filters read Service, Category, Sub category, then Sort. Choose Service **IT**: Category lists only IT's categories; choose **IT SUPPORT**: Sub category lists only its sub-categories. Changing the Service clears the two below. The same on **Requests**.

## 3. Created column and Sort box
Both lists have a **Created** column (India time) and a **Sort:** box (Updated, Created, Priority, Status, Request #) with an arrow to flip the order. Vendor list (/vendor, sign in as a vendor user): a **Sort:** box too.

## 4. Scheduled reports that send themselves
Admin > Reports > **Scheduled** tab: "DEMO daily tasks report" shows "Next: ... (every day at 07:00 India time)". Run `node scripts/local-run-job.mjs scheduled-reports`: it sends (`sent: 1`), "Last Sent" fills, the mail is in `local-mail-outbox`; run it again: nothing due. To repeat: `docker exec supabase_db_citykart_desk psql -U supabase_admin -d postgres -c "update scheduled_reports set last_sent_at = null where name = 'DEMO daily tasks report'"`. Details: `docs/SCHEDULED-REPORTS.md`.

## 5. AC cut-over: DONE in local (real actions, real tickets)
- ADMIN AC ISSUE is now in the **AC** program (Admin > Vendor Programs > AC, 2,296 ACs, level "mail", OEM ticket number required). Card 2 no longer lists it.
- Real tickets raised from real local store accounts:
  - **CKSD-003104** (store JHG, a Voltas AC): the Voltas OEM is mailed, the ticket goes to **Voltas Technician One** and STAYS OPEN for him.
  - **CKSD-003105** (store KRC, another vendor): mailed, a Citykart technician (Krishan) has it, it goes to **In Progress** - exactly what the old AC setting did.
  Open them in Agent Requests; the mails are in `local-mail-outbox` (subject "New AC Issue Ticket - CKSD-...").
- Two things the real run found and I fixed: (1) the program saved its row AFTER the Business Rules ran, so the Voltas rule did not see the vendor (now saved before: `saveProgramRowsForRules`); (2) the AC program must be level **mail**, not portal (portal keeps every AC ticket Open). Both have permanent tests (`tests/vapt/64-ac-on-program.test.ts`, 9 checks).
- The live steps: `docs/LIVE-CUTOVER-AC.md`.

## 6. Genset cut-over: DONE in local
GENSET-CUMMINS, MAHINDRA, EICHER and KILOSKAR are in the **Genset** program (Admin > Vendor Programs > Genset). **CKSD-003106** (store KRC): the Genset OEM (Garuda / Cummins addresses) is mailed ("New Genset Issue Ticket ..."), ticket In Progress. Proof: `tests/vapt/44-genset-on-program.test.ts`. Live steps: section L of `docs/LIVE-CONFIGURATION-VENDOR-PROGRAMS.md`.

## 7. Vendor companies, technicians, managers and rules: DONE in local
- Admin > **Vendors**: SECUREMATE (2 technicians + 1 manager), BNR ELECTRO, CHECKPOINT, ENTHASIS, Radhey Water solution (1 technician each), plus the older Blue Star, Voltas, XYZ. Each login got its "set your password" mail (in the outbox).
- Admin > **Business Rules**: "Sensomatic tickets of SECUREMATE / BNR ELECTRO / CHECKPOINT / ENTHASIS" (that vendor's stores -> all technicians of its company, in turn) and "RO Purifier tickets go to Radhey Water solution".
- Real tickets: **CKSD-003107** (SENSOR MACHINE ISSUE, store LAD) -> Securemate Technician One, stays Open, vendor mail written; **CKSD-003108** (RO-PURIFIER ISSUE, store MAR) -> Radhey Technician One, stays Open.

## 8. SENSOMATIC addresses: DONE in local (made-up addresses)
Admin > Vendor Programs > **Sensor Machine**: every one of the 231 rows has a made-up address (`<vendor>.service@example.test`), its **Check my set-up** list is green, and the program is switched ON (portal level, resolution list, default approver). On live you fill the real "Ticket Mail To" column of the sheet instead.

## 9. The clean-up (stage 1) - on the branch `local/cutover-cleanup`
- The old per-category switch "send to the AC / Genset OEM" is **retired**: Admin > Categories no longer offers it (a category that still has it shows an amber note and can be cleared); the built-in AC / Genset screens can only take a category OFF the old setting; nothing can put a category on it or move it back.
- Kept on purpose for one more release (safety net, because live data cannot be checked from here): the old mail routing in the code, the AC / Genset sheet copies (the calendars, reports, the AC dropdown, the vendor portal and PMS read them). Removing that code is stage 2, after the live cut-over has been stable.
- Tests updated: 42, 44, 64 (the "move back" tests are now "cannot be moved back").

## 10. Do it again from the start (optional)
`docker exec -i supabase_db_citykart_desk psql -U supabase_admin -d postgres < scripts/local-demo/reset-cutover.sql` puts ADMIN AC ISSUE and the Genset categories back on the old setting and switches SENSOMATIC off; then `npx vitest run --config vitest.demo.config.ts scripts/local-demo/01-cutover-ac-genset.demo.ts` does the cut-over again for real.

## 11. Open decisions (your answers decide what I do)
Live is untouched. Pending on your side: which AC category goes first on live (suggested: ADMIN AC ISSUE alone), the three secrets that are off on live, B-22, B-32, F-17 and the others in `release-out/FINAL-PASS-REPORT-2026-10-30.md`.

## 12. The store card is the main store master (built 2026-10-31, local only)
The standard details of a store (address + pincode, city, state, region, cluster, priority list, festival, opening date) live on the store card (the store list), not in any program sheet. The AC sheet and the Store Master import fill it; EVERY ticket of the store reads it, with or without a Vendor Program.
- **Business Rules**: Admin > Business Rules > a condition: "Store region / state / cluster / city / priority list / festival (from the store list)" and "Months since the store opened" (for example "less than 9" for a new store). They work for an IT or HR ticket too. The AC row / program row is only the back-up when the card has nothing.
- **Mail wording**: the field buttons `{{store_city}}`, `{{store_state}}`, `{{store_region}}`, `{{store_cluster}}`, `{{store_priority}}`, `{{store_festival}}`, `{{store_open_date}}` on every Vendor Program screen and on the AC / Genset mail screen. Try: Admin > Vendor Programs > RO Purifier > the mail.
- **Address**: always address + pincode once ("Main Road, Allahabad - 211001"); a pincode already typed in the address is not repeated. No separate pincode field. Used on the ticket form, every mail and the vendor ticket page. Old tickets keep what they have.
- Proof: `tests/unit/store-details.test.ts`, `tests/unit/rules-store-card-facts.test.ts`, `tests/vapt/66-store-card-on-all-tickets.test.ts` (real database: program mail, old AC mail, address, rules).
