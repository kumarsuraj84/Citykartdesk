# AC cut-over: moving the AC mail from the old AC setting to the AC Vendor Program (LOCAL ONLY until the owner says)

Part 1 (proof in local) is done: `tests/vapt/64-ac-on-program.test.ts` (7 tests) runs the SAME AC rows through the old setting and through a program and compares them.
Nothing here changes live until the owner presses the button described in step 6.

## What stays the same, what changes
| | Stays as it is | Changes |
|---|---|---|
| The AC list, AC PMS tickets, AC reports, the AC dropdown on the ticket form, the vendor portal, the quote / PO flow | yes (they keep reading the AC sheet records) | - |
| WHO gets the OEM mail, WHAT the mail says about the AC, the note in the conversation, the status after the mail | same result (proved by the test) | The program sends it instead of the old setting |
| Where the mail wording is written | - | On the AC program screen (one place, like every other line) |

## What I found and fixed in local while proving it
1. The AC dropdown of the ticket form (the CKDESK number) now also chooses the machine of the program. Without this, after a move the program would have mailed EVERY AC of the store instead of the chosen one. A value the program does not know is ignored (the old AC list still decides what can be chosen).
2. Business Rules that route by "AC AMC vendor", brand, region, state or cluster keep matching: through the AC record saved with the ticket (a form with the old AC dropdown) and, when the form has the machine-picker dropdown, through the program's saved row. FOUND BY THE REAL RUN in local (not by the first tests): the program saved its row AFTER the rules ran, so the Voltas rule did not see the vendor and the ticket went to the wrong person. Fixed: the row is now saved BEFORE the rules run (`saveProgramRowsForRules`), and two permanent tests keep it fixed.
3. What I did NOT change (the owner must do it in step 5): Business Rules whose condition is **Vendor Program = AC (built in)** stop matching after the move, because the ticket then belongs to the new AC program. Change those rules to the new program.

## Steps on live (when you decide; about 20 minutes; each step can be stopped)
1. **Create the program** (Admin > Vendor Programs > New): name **AC**, "one row per machine".
2. **Google Sheet**: paste the AC sheet link (the same one the AC (built in) screen uses), save, "Update from sheet now". In "Which columns mean what" type: **Vendor = AC-AMC Vendor**. The other columns (CKDESK serial no, serial, PO mail, approver) are found by themselves. Read "Problems found". Compare the number of rows with the AC (built in) screen (it should be the same).
3. **The mail**: use the details wording `{{machine_no}} - {{extra_acfloor}}, {{extra_actype}} {{extra_actonnage}} - {{extra_acbrand}} - serial {{serial}}` and write the same words as the AC mail today. "Send a test to me" and read it next to a real AC mail.
4. **What happens to the ticket**: choose **"Mail the vendor, then In Progress"** (the level "mail"). This is exactly what AC does today: a ticket a rule gave to a vendor technician stays Open for him, any other ticket goes to In Progress. Do NOT choose the portal level for AC: it would keep every AC ticket Open, even those nobody gave to a vendor. Then switch on "The vendor must enter the OEM ticket number" (AC always needs it), copy the AC resolution list into the program's list, and set the default PO approvers of the program the same as the AC default approver.
5. **Business Rules**: open Admin > Business Rules and change every rule that says Vendor Program = AC (built in) to the new AC program. Rules that say AC AMC vendor / brand / region need nothing.
6. **Move one category first**: on the program screen, card 2 "Move categories from the old AC / Genset setting": tick **ADMIN AC ISSUE** only, press the button (the program is switched on in the same step; it refuses if the program is not ready).
7. **Watch the first real ticket**: the mail (and its table in the conversation), the vendor technician it goes to, Start with the OEM number, parts / PO if needed, resolve.
8. **Back out any time**: Admin > Vendor Programs > AC (built in) > tick the category again, "Save categories" (one step, new tickets go the old way again).
9. About a week later (after the owner's OK) I remove the old AC mail setting from the code (clean-up).
