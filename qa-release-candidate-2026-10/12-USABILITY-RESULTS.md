# 12 — Usability and accessibility

Tools: the browser pane, axe-core 4.x (WCAG 2.0/2.1 level A and AA rules), and reading what a real user sees at each step. Raw log: `evidence/12-usability.jsonl`.

## 1. Accessibility sweep (axe-core)

17 live pages were checked as admin, store user and vendor. First pass found **critical and serious** problems that no earlier test had found:

| Finding | Where | Fixed? |
|---|---|---|
| Switches with no name (22) | Business Rules | yes (QA-D010) |
| Selects with no name (10 + 3) | Vendors, Report Builder | yes |
| Icon buttons with no name (add collaborator, 80+ in Report Builder, group expander, move/remove) | ticket page, Report Builder, Technician groups | yes (D010, D012) |
| Date boxes with no label (2) | Report Builder | yes |
| Rich mail editor with no name | Sheet Masters | yes |
| Calendar marked as a grid without rows | Smart Dashboard | yes |
| Sideways-scrolling tables not reachable by keyboard | vendor list, PO register, report tables, drill-down list | yes (D011) |
| Pale small text (2.8 – 4.3 : 1) | vendor tiles, ticket message time | yes (D011) |
| Grey token 4.45 : 1 (needs 4.5) | small grey pills across the app | **open, design owner (QA-D013)** |

After the fixes axe reports **0 violations** on: Home, My requests, Agent Requests, Users, Settings, Sheet Masters, Vendors, Business Rules, Report Builder, Smart Dashboard, Purchase orders, Notifications, Profile, vendor ticket page, vendor PO page. The only remaining finding on any page is the grey token (Approvals 1, Technician groups 7, Categories 3, service form pills 2).

Guard tests keep the names from disappearing: `tests/unit/accessibility-names.test.ts` (11 tests).

Not covered: the sign-in page (axe's script cannot be loaded before sign-in on this setup), screen-reader listening tests with a real reader, colour-blind simulation, focus order of dialogs.

## 2. Usability observations from the journeys

Good:
* Every blocked action says why in plain words ("Please attach the quote before you send it", "This message is required.", "Resolve needs at least 10 characters", "The AC sheet is missing the column(s): Store Code. CK Desk keeps working with the last good copy.").
* Vendor screens are small and clear; the PMS and normal tickets are in two separate tabs and never mix.
* The approval box ("Earlier requests of this store…") is easy to read in the mail and on the approve page.
* The sheet-health page names the exact row and how to write the date.

To improve (not defects, your call):
* The Admin-Requirements form needs a *Contact number* even when the profile has none; the browser's own bubble is the only hint (nothing in the page).
* The store gets four "Request updated" mails during a vendor repair (start, part hold, part received, PO). Consider one summary mail.
* Update from sheets now has a 30-second wait; the message says so ("Please wait a moment").
* Sign-in with the service down used to say the wrong thing (fixed, QA-D016).
* Vendor on a phone: fixed bottom bar (QA-D009).

## 3. Verdict

Accessibility was the weakest area found in this QA; it is now clean except for one colour token. Usability of the tested journeys is good.
