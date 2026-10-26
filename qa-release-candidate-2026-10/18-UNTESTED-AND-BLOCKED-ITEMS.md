# 18 — Untested, partly tested and blocked items

Nothing here is hidden behind a PASS. "Blocked" = could not be done safely or at all in this setting. "Not tested" = no time / no tool; it may well work.

## A. Blocked on purpose (rules of this QA)

| Item | Why |
|---|---|
| Anything on the live app, live database, NAS, 10.0.1.98 / 10.0.0.205 / 10.0.0.25, even read-only | forbidden by the instruction; the isolation gate and the egress guard enforce it |
| The real Google Sheets API, real Google sign-in | no outside connection allowed; demo CSV files were used (the code path after "read the rows" is the same) |
| Real e-mail, WhatsApp, browser-push delivery | no message may leave this PC; the mail sink was used |
| Real weather service | outside connection refused by the guard |
| WhatsApp channel, DeskTime sync, engineer-visit module | out of scope by your earlier instruction |
| Pushing, merging, deploying, applying migration 185 anywhere but the audit database | forbidden |
| The developer database (production-derived data) for any destructive, load, fault or fuzz test | forbidden; the synthetic audit stack was used |

## B. Blocked by the tools available

| Item | Why |
|---|---|
| Edge, Firefox, Safari, real phones and tablets | only the Chromium pane existed (report 11) |
| A production build (`next build`) under the guard | the build downloads Google Fonts, which the guard refuses; the app was therefore tested as a **development** server (slower than live) |
| Real load of many browsers at once (hundreds of signed-in users) | no load generator for the app server; the data layer and 25 parallel writers were measured instead |
| Mail-client rendering (Gmail / Outlook) | no real mailbox |
| Opening exports in real Excel / PDF readers | not available to the tools |
| Screen-reader listening test, colour-blind simulation | not available |

## C. Not tested (time / depth) — please read

| Item | Risk if it is wrong | Suggested follow-up |
|---|---|---|
| Alerts job: due-soon / overdue alerts and the 08:00 daily digest (content, recipients) | people miss SLA warnings | one test day with a test alert rule |
| Scheduled Business Rules: SLA-% escalation, "unassigned for N minutes" | escalations silent | same |
| Field-level SLA override really shortens a deadline | wrong deadline | unit test of `lib/sla/matrix.ts` |
| Notification opt-out per user, browser push failure handling | people get / miss messages | small test |
| Knowledge Base, Runbooks, drag-and-drop dashboard widgets, dashboard export, day pop-up of the calendar, intake rules and classification, daily alert digest | low | listed as NOT TESTED in report 02 |
| Excel (xlsx) and PO-register exports compared row by row (the CSV of requests was compared and fixed, QA-D020) | wrong numbers in a file | 30-minute check by the report owner |
| Report Builder / Predefined Reports compared with the dashboard for the same period | two screens disagree | same |
| SLA breach count recounted by hand across business hours and holidays | wrong breach numbers | recount a sample of 20 tickets |
| Creating and editing services, forms, categories, rules, roles through the admin screens in the browser | admin screens | covered by integration/vapt tests, not walked by hand |
| Old tickets keep their own form (snapshot) after the form is edited | old tickets change | quick manual check |
| Sign-in page accessibility (axe could not be loaded before sign-in) | low | manual |
| A full keyboard-only walk through every journey | accessibility | manual |
| Restore of a backup into a fresh database; disk full; power cut; network split | recovery | the production runbook drill |
| Killing the app in the middle of a ticket save | possible half-save | protected by the submission key (tests pass) |
| CSRF on Server Actions beyond the framework's origin check; file-upload fuzzing with hostile archives | security | covered by existing tests (zip-bomb, type table); no new fuzzing here |

## D. Needs a person, not a tool

* **Real stakeholder acceptance (UAT sign-off).** Report 08 is a pack to be filled by the store, technician, vendor, approver and admin users. Nothing in it is a real signature. Simulated UAT in this QA is **not** stakeholder acceptance.
* Owner decisions listed in report 15 (dependency upgrade, grey colour token, double decision rows, tuning beyond 100k tickets) and the earlier open design questions (OEM-number history, vendor work per category, several PMS categories).
* Applying migration 185 to the developer and live databases (and restarting `CkDeskPostgrest` on 10.0.1.98 afterwards, as in your deployment notes).
