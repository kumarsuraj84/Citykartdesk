# 11 — Compatibility

Honest scope: the only real browser engine available to the test tools in this session was **Chromium** (the Claude desktop browser pane, user agent Chrome 152). Other browsers and real phones were **not available**, so they are marked NOT TESTED rather than guessed.

| Platform | How tested | Result |
|---|---|---|
| Desktop Chromium / Chrome 152 (Windows 11) | all journeys, smoke, axe | **PASS** (see 06, 03, 12) |
| Microsoft Edge (real) | not installed in the test session | **NOT TESTED** |
| Mozilla Firefox | not available to the tools | **NOT TESTED** |
| Safari / iOS / WebKit | not available | **NOT TESTED** |
| Real Android phone / real iPhone | not available | **NOT TESTED** |
| Phone size, emulated 375 × 812 (Chromium) | no sideways page scroll on /home, /requests, a request, the service form, executive dashboard, Report Builder, Sheet Masters, Users, Business Rules and the vendor pages; wide tables scroll inside their own box | **PASS** (one defect found: vendor bottom bar, QA-D009, fixed) |
| Tablet size, emulated 768 × 1024 | no sideways page scroll on /home, dashboards, Sheet Masters, Agent Requests | **PASS** |
| Desktop width of the pane (≈800–1280) | normal use | **PASS** |
| Dark mode / print / zoom 200 % | not run | **NOT TESTED** |
| Keyboard-only use | scrolling tables and buttons are now reachable (axe rules); a full keyboard-only walk-through of every journey was not done | **PARTIAL** |
| Export files (Excel/CSV/PDF) opened in Excel / Word / PDF viewers | files are produced by the integration tests (CSV export 72 ms at all sizes; PO register Excel; ticket PDF route 307 to sign-in when signed out); opening in Excel itself was not done | **PARTIAL** |
| Mail clients (Gmail, Outlook) rendering of the OEM / approval mails | HTML was checked for escaping and structure only; real mail clients were not used (no mail may leave this PC) | **NOT TESTED** |

Evidence: `evidence/11-compat.jsonl`.

Practical advice for the release: before go-live, ask one person to open the home page, a ticket, the new-request form and the vendor page on a real Android phone, an iPhone, Edge and Firefox (about 15 minutes), and send one OEM mail and one approval mail to a real Gmail and Outlook inbox from a **test** ticket.
