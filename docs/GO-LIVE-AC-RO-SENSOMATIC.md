# Go-live plan: AC, RO Purifier and Sensomatic together (LOCAL PLAN ONLY, nothing here has been done on live)

Decided by the owner: all three go live on the same day, with vendor logins (vendor portal). Genset stays on mail only, no vendor portal.
Live today: build 488e0bd (main 18b50ad). Servers: app 10.0.1.98, database 10.0.0.205 (`ckdesk`).
Everything below is tested in the local app (see `docs/MORNING-WALKTHROUGH.md`). Nothing is pushed.

## 0. What goes live, and what does NOT yet
- **Release from the branch `local/night-2026-10-31`**: the AC-on-program fixes (the program row is saved before the Business Rules run) and the scheduled reports. **No database change** (no new migration), so the live step is the app only.
- **Do NOT release the clean-up branch `local/cutover-cleanup` yet.** It removes the "tick the category back" undo. On the go-live day we want that undo. The clean-up comes about a week after the three programs have been stable.
- **Genset**: no change. It keeps working as it does today. (If you later want Genset on the program, section L of `docs/LIVE-CONFIGURATION-VENDOR-PROGRAMS.md`, mail level only.)

## 1. What each program uses
| | Program level | Who works the ticket | What the vendor logs in for |
|---|---|---|---|
| **AC** | **Mail the vendor, then In Progress** ("mail") | Business Rule gives it to a vendor technician (stays Open for him), otherwise a Citykart technician (In Progress) | The same AC flow as today: OEM number, parts, PO, resolve |
| **RO Purifier** | **Vendor works in the portal** ("portal") | Business Rule "RO Purifier tickets go to Radhey Water solution" | Start, OEM number (optional), parts, PO, resolve with the program's resolution list |
| **Sensomatic** | **Vendor works in the portal** ("portal") | 4 rules, one per vendor company (BNR ELECTRO, CHECKPOINT, ENTHASIS, SECUREMATE) | Same as RO |

Why AC is "mail" and not "portal": the portal level keeps EVERY AC ticket Open, even those no vendor was given. AC vendors still use the portal; a ticket given to their technician shows in it either way (proved in local: CKSD-003104).
(In the local app RO is on "mail" and Sensomatic on "portal". For go-live RO uses "portal" as in section E5 of the live configuration doc. CONFIRMED by the owner on 2026-10-31: RO on portal.)

## 2. What YOU must have ready BEFORE the day (I cannot do these)
1. **Sensomatic sheet: the real e-mail addresses** in `Ticket Mail To` (they are EMPTY on live today). Delete the 3 placeholder rows (xtz, chjk, hjhk) and the 4 rows with no Store Code. Also `PO Mail To` and `Quote Approval Mail To` because it works in the portal.
2. **RO sheet**: already filled on all 234 rows (checked 30 Oct). Keep the formulas error-free.
3. **AC sheet**: the same sheet the old AC screen uses (2,296 machines). Nothing new.
4. **The vendor people** (company name, person name, e-mail, technician or manager): AC vendors (for example Voltas, Blue Star), Radhey Water solution, BNR ELECTRO, CHECKPOINT, ENTHASIS, SECUREMATE. On live there are no vendor companies or logins yet for the programs.
5. **Which stores belong to which Sensomatic vendor** (so the 4 rules can be made; in local they come from the `Vendor` column of the sheet).
6. **Which AC categories go first** (suggested: ADMIN AC ISSUE alone for the first day, then the others).
7. **The mail wording** of RO and Sensomatic (and what "Contact Person" is: the store requester or a fixed Citykart person).
8. **Default PO approvers** (active staff logins) for each of the three programs.
9. The three secrets (approval links, rating links, system logs): create or leave off. Not needed for this go-live.

## 3. The day, in this order (about 2 hours; each step can be stopped)
**A. Release the app** (I give the commands, you press go; no database step): back-up copy of the live app is kept automatically (`standalone-bak-<time>`). Check health, build id, all scheduled tasks Ready.
**B. Vendor people**: Admin > Vendors: create the companies, add the logins. Check that each "set your password" mail arrives.
**C. AC program** (steps 1 to 6 of `docs/LIVE-CUTOVER-AC.md`): new program "AC", one row per machine, sheet link, level **mail**, OEM number required, resolution list, default approvers; change every Business Rule that says "Vendor Program = AC (built in)" to the new AC program; move **ADMIN AC ISSUE only**.
**D. RO Purifier program** (section E of the live configuration doc): sheet "Update from sheet now", mail wording, "Send a test to me", level **portal**, resolution list, default approvers, create the rule, check list green, switch on.
**E. Sensomatic program** (the same): only after the real addresses are in the sheet and the 4 rules exist; check list must say "Every row has a mail address".
**F. Watch the FIRST REAL ticket of each program** (no test tickets on live): the mail and its table in the conversation, which technician got it, Start, reply, parts / PO if needed, resolve.
**G. Next day**: if AC is fine, move the remaining AC categories.

## 4. Back out (one step each, nothing else is touched)
- **AC**: Admin > Vendor Programs > AC (built in) > tick the category again > Save categories (new tickets go the old way again).
- **RO / Sensomatic**: Vendor Programs > the program > Switch off (tickets are normal tickets again).
- **The whole app**: `rollback-app.ps1` on 98.

## 5. After about a week of stable use
Release the clean-up branch (the old AC / Genset switch is retired) and later remove the old routing code (stage 2).

## 6. Still needed from you
- (Done) RO on "portal" confirmed.
- Items 2.1 to 2.8 above.
- Say the words **"commit and push to git and main"** on the day. Until then nothing leaves this PC.

## 7. The store card (added 2026-10-31)
The release also carries "the store card is the main store master" (docs/MORNING-WALKTHROUGH.md item 12): Business Rules and mails can use a store's region, cluster, city, state, priority list, festival and opening date for ANY ticket, and every address is address + pincode. No database change, no setting to switch on.
- Check on live after the release (read-only): open Admin > Business Rules > a condition and see "Store region (from the store list)"; open one RO program mail screen and see the new `{{store_...}}` buttons.
- A store that has no AC rows gets its details only from the Store Master import or an admin edit. Check how many live stores have a region and cluster before you build rules on them.
- IMPORTANT for the later clean-up (stage 2): keep the AC sheet copy that fills the store card (`updateStoreMaster` in `lib/masters/sync.ts`) until the stores have their own sheet or import. Removing the old AC code must not stop that feed.
