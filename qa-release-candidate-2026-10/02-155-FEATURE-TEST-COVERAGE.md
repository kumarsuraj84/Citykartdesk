# 02 — Test coverage of the 155 features

Source list: Appendix A of `docs/CKDESK-ARCHITECTURE-FEATURES-AND-TEST-GUIDE.md` (155 rows). Status words: **PASS / FAIL / BLOCKED / NOT TESTED / OUT OF SCOPE**. A feature is PASS only when something actually ran and passed: the automated test files that name it passed in the **final regression run** (`evidence/11-final-regression-results.json`) and/or it was driven by hand in the browser (`evidence/06-e2e.jsonl`). "Guide" says whether the written guide matched the code (`agrees` / `differs` / `unclear`, from the code reading in `evidence/feature-trace.json`).

**Totals:** PASS 141 · FAIL 0 · BLOCKED 0 · NOT TESTED 7 · OUT OF SCOPE 7 (= 155).

Honesty notes: "automated" is the project's own test suite plus the new QA tests; for many rows the suite proves the rules and the screen was not opened. Rows marked *by hand* were opened and used in the QA browser. WhatsApp, DeskTime and the dropped engineer-visit module were out of scope by your instruction; none of the 155 rows is a WhatsApp, DeskTime or visit feature.

| ID | Module | Feature | Status | Guide | Basis |
|---|---|---|---|---|---|
| F001 | Sign-in and accounts | Sign in with e-mail and password | **PASS** | agrees | automated (4 file(s), 34 tests) + driven by hand in the browser |
| F002 | Sign-in and accounts | Forgot password and invitation by e-mail | **PASS** | agrees | automated (3 file(s), 14 tests) |
| F003 | Sign-in and accounts | Password rules | **PASS** | agrees | automated (4 file(s), 17 tests) |
| F004 | Sign-in and accounts | My Profile | **PASS** | agrees | automated (2 file(s), 26 tests) |
| F005 | Sign-in and accounts | Roles | **PASS** | differs | automated (1 file(s), 5 tests) |
| F006 | Sign-in and accounts | Permission matrix with owner switches | **PASS** | differs | automated (1 file(s), 13 tests) |
| F007 | Sign-in and accounts | User administration | **PASS** | agrees | automated (6 file(s), 30 tests) + driven by hand in the browser |
| F008 | Sign-in and accounts | Technician groups and many groups per technician | **PASS** | agrees | automated (1 file(s), 10 tests) |
| F009 | Sign-in and accounts | Vendor logins (technician and manager) | **PASS** | agrees | automated (2 file(s), 44 tests) + driven by hand in the browser |
| F010 | Raising a request | Create Request page | **PASS** | unclear | driven by hand in the browser (no automated test names it) |
| F011 | Raising a request | Service catalogue | **PASS** | agrees | driven by hand in the browser (no automated test names it) |
| F012 | Raising a request | Dynamic forms per service | **PASS** | agrees | automated (4 file(s), 64 tests) + driven by hand in the browser |
| F013 | Raising a request | Form Templates and Field Library | **PASS** | agrees | automated (3 file(s), 31 tests) |
| F014 | Raising a request | Number and text limits in the form builder | **PASS** | agrees | automated (1 file(s), 17 tests) |
| F015 | Raising a request | Fields limited to categories | **PASS** | agrees | automated (2 file(s), 8 tests) |
| F016 | Raising a request | Attachments with preview | **PASS** | agrees | automated (6 file(s), 47 tests) + driven by hand in the browser |
| F017 | Raising a request | Ticket title from the Subject field | **PASS** | agrees | automated (2 file(s), 18 tests) |
| F018 | Raising a request | No double tickets | **PASS** | agrees | automated (1 file(s), 4 tests) |
| F019 | Raising a request | Ticket numbers | **PASS** | agrees | automated (1 file(s), 1 tests) |
| F020 | Raising a request | Pick your own AC | **PASS** | agrees | automated (2 file(s), 27 tests) + driven by hand in the browser |
| F021 | Handling requests | Agent Requests (my queue and team queue) | **PASS** | agrees | automated (3 file(s), 13 tests) + driven by hand in the browser |
| F022 | Handling requests | Assignment | **PASS** | agrees | automated (3 file(s), 16 tests) + driven by hand in the browser |
| F023 | Handling requests | Start working with first response | **PASS** | agrees | automated (2 file(s), 5 tests) + driven by hand in the browser |
| F024 | Handling requests | Status flow with compulsory remarks | **PASS** | differs | automated (5 file(s), 38 tests) + driven by hand in the browser |
| F025 | Handling requests | Hold due to Purchase from HO | **PASS** | agrees | automated (3 file(s), 29 tests) + driven by hand in the browser |
| F026 | Handling requests | Resolution note rules | **PASS** | agrees | automated (3 file(s), 16 tests) + driven by hand in the browser |
| F027 | Handling requests | Cancel with a remark | **PASS** | agrees | automated (2 file(s), 15 tests) |
| F028 | Handling requests | Reopen a resolved request | **PASS** | agrees | automated (4 file(s), 14 tests) |
| F029 | Handling requests | Reopen after a rejected approval | **PASS** | agrees | automated (1 file(s), 5 tests) |
| F030 | Handling requests | Priority from the sub category | **PASS** | agrees | automated (2 file(s), 10 tests) |
| F031 | Handling requests | Service of a ticket is locked | **PASS** | agrees | automated (1 file(s), 4 tests) |
| F032 | Handling requests | Collaborators and related requests | **PASS** | agrees | automated (2 file(s), 18 tests) |
| F033 | Handling requests | Catch me up summary | **PASS** | agrees | automated (1 file(s), 7 tests) |
| F034 | Handling requests | Ticket as PDF | **PASS** | agrees | automated (2 file(s), 13 tests) + driven by hand in the browser |
| F035 | Handling requests | Automatic time tracking | **PASS** | agrees | qa-gap-coverage: automatic time tracking |
| F036 | Handling requests | Nudge | **PASS** | agrees | automated (2 file(s), 33 tests) |
| F037 | Handling requests | Bulk actions | **PASS** | agrees | automated (1 file(s), 2 tests) |
| F038 | Handling requests | Auto-close after the reopen window | **PASS** | differs | automated (2 file(s), 14 tests) + driven by hand in the browser |
| F039 | Handling requests | Ticket history | **PASS** | agrees | driven by hand in the browser (no automated test names it) |
| F040 | Handling requests | Hand AC tickets to a vendor technician | **PASS** | agrees | automated (2 file(s), 26 tests) + driven by hand in the browser |
| F041 | Handling requests | End a vendor hold yourself | **PASS** | agrees | automated (2 file(s), 26 tests) |
| F042 | Conversation and e-mail | Public conversation | **PASS** | agrees | automated (3 file(s), 14 tests) |
| F043 | Conversation and e-mail | Internal notes | **PASS** | agrees | automated (2 file(s), 24 tests) |
| F044 | Conversation and e-mail | CC a comment | **PASS** | agrees | automated (3 file(s), 18 tests) |
| F045 | Conversation and e-mail | Reply by e-mail | **PASS** | agrees | automated (5 file(s), 27 tests) |
| F046 | Conversation and e-mail | AC ticket: automatic OEM e-mail and In Progress | **PASS** | agrees | automated (4 file(s), 49 tests) + driven by hand in the browser |
| F047 | Conversation and e-mail | Genset ticket: automatic OEM e-mail and In Progress | **PASS** | agrees | automated (1 file(s), 23 tests) |
| F048 | Conversation and e-mail | Ticket e-mails | **PASS** | agrees | automated (5 file(s), 54 tests) + driven by hand in the browser |
| F049 | Conversation and e-mail | Notification rules | **PASS** | agrees | automated (2 file(s), 9 tests) |
| F050 | Conversation and e-mail | Bell, unread count and pop-up | **PASS** | agrees | automated (5 file(s), 27 tests) + driven by hand in the browser |
| F051 | Conversation and e-mail | Browser push notifications | **PASS** | agrees | automated (2 file(s), 26 tests) |
| F052 | Conversation and e-mail | Mailbox settings | **PASS** | agrees | automated (4 file(s), 27 tests) |
| F053 | SLA | SLA policies and business hours | **PASS** | agrees | automated (2 file(s), 14 tests) |
| F054 | SLA | Field-level SLA overrides | **PASS** | agrees | automated (1 file(s), 12 tests) |
| F055 | SLA | Pause and resume | **PASS** | agrees | automated (2 file(s), 11 tests) + driven by hand in the browser |
| F056 | SLA | Breach views and highlights | **PASS** | agrees | automated (1 file(s), 8 tests) |
| F057 | SLA | Escalation and alert rules | **PASS** | agrees | automated (4 file(s), 21 tests) |
| F058 | SLA | Daily alert digest | **NOT TESTED** | differs | no automated test found and not driven by hand in this QA |
| F059 | Approvals | Approval flows | **PASS** | agrees | automated (4 file(s), 21 tests) + driven by hand in the browser |
| F060 | Approvals | Approve from the e-mail link | **PASS** | agrees | automated (4 file(s), 35 tests) + driven by hand in the browser |
| F061 | Approvals | Quick approve | **PASS** | agrees | automated (2 file(s), 12 tests) |
| F062 | Approvals | Add approvers and delegate | **PASS** | agrees | automated (3 file(s), 14 tests) |
| F063 | Approvals | Separation of duties | **PASS** | agrees | automated (2 file(s), 16 tests) |
| F064 | Approvals | Daily approval reminder | **PASS** | agrees | automated (2 file(s), 19 tests) |
| F065 | Approvals | Automatic CVM approval | **PASS** | agrees | automated (2 file(s), 29 tests) + driven by hand in the browser |
| F066 | Automation | Business Rules | **PASS** | agrees | automated (4 file(s), 33 tests) + driven by hand in the browser |
| F067 | Automation | Round-robin and load-balanced assignment | **PASS** | agrees | qa-gap-coverage: round robin, load balanced, vendor-held ticket (and QA-D018) |
| F068 | Automation | Rule search | **PASS** | agrees | automated (1 file(s), 2 tests) |
| F069 | Automation | Rules for vendor technicians | **PASS** | agrees | automated (2 file(s), 26 tests) |
| F070 | Equipment (AC, Genset) and OEM | OEMs by type (AC and Genset) | **PASS** | agrees | automated (1 file(s), 23 tests) |
| F071 | Equipment (AC, Genset) and OEM | Red-flag stores | **PASS** | agrees | automated (3 file(s), 41 tests) |
| F072 | Equipment (AC, Genset) and OEM | AC and AMC reports | **PASS** | agrees | automated (3 file(s), 55 tests) |
| F073 | Equipment (AC, Genset) and OEM | OEM mail again on reopen | **PASS** | agrees | automated (1 file(s), 23 tests) |
| F074 | Equipment (AC, Genset) and OEM | AC and Genset master screens | **PASS** | agrees | automated (2 file(s), 8 tests) |
| F075 | Master data | Store Master | **PASS** | agrees | automated (4 file(s), 26 tests) + driven by hand in the browser |
| F076 | Master data | Organisation structure | **PASS** | agrees | automated (2 file(s), 8 tests) |
| F077 | Master data | Store CVM | **PASS** | agrees | automated (2 file(s), 29 tests) + driven by hand in the browser |
| F078 | Master data | Google Sheets as master data | **PASS** | agrees | automated (4 file(s), 65 tests) + driven by hand in the browser |
| F079 | Master data | Sheet health page | **PASS** | agrees | automated (3 file(s), 48 tests) + driven by hand in the browser |
| F080 | Master data | CVM from the sheet | **PASS** | agrees | automated (2 file(s), 44 tests) + driven by hand in the browser |
| F081 | Vendor portal | Vendor dashboard | **PASS** | agrees | automated (2 file(s), 38 tests) + driven by hand in the browser |
| F082 | Vendor portal | Vendor manager view | **PASS** | agrees | automated (1 file(s), 19 tests) |
| F083 | Vendor portal | Start working with the OEM ticket number | **PASS** | agrees | automated (2 file(s), 44 tests) + driven by hand in the browser |
| F084 | Vendor portal | Resolve with AC RESOLUTION list and FSR | **PASS** | agrees | automated (2 file(s), 44 tests) + driven by hand in the browser |
| F085 | Vendor portal | Messages with the store | **PASS** | agrees | automated (1 file(s), 19 tests) + driven by hand in the browser |
| F086 | Vendor portal | Part required (no PO) | **PASS** | agrees | automated (2 file(s), 26 tests) + driven by hand in the browser |
| F087 | Vendor portal | PO required with a quote | **PASS** | agrees | automated (2 file(s), 44 tests) + driven by hand in the browser |
| F088 | Vendor portal | Revise price required | **PASS** | agrees | automated (2 file(s), 44 tests) + driven by hand in the browser |
| F089 | Vendor portal | Quote versions | **PASS** | agrees | automated (1 file(s), 19 tests) + driven by hand in the browser |
| F090 | Vendor portal | Reject only the quote | **PASS** | differs | automated (2 file(s), 26 tests) |
| F091 | Vendor portal | Vendor e-mails | **PASS** | agrees | automated (2 file(s), 32 tests) + driven by hand in the browser |
| F092 | Vendor portal | Reopened tag | **PASS** | agrees | automated (1 file(s), 19 tests) |
| F093 | Vendor portal | Safe vendor access | **PASS** | agrees | automated (2 file(s), 44 tests) + driven by hand in the browser |
| F094 | Purchase orders | PO approval page | **PASS** | agrees | automated (2 file(s), 44 tests) + driven by hand in the browser |
| F095 | Purchase orders | Approvers from the AC sheet | **PASS** | agrees | automated (2 file(s), 32 tests) + driven by hand in the browser |
| F096 | Purchase orders | Default PO approver | **PASS** | differs | automated (1 file(s), 7 tests) |
| F097 | Purchase orders | Purchase orders register | **PASS** | agrees | automated (1 file(s), 25 tests) + driven by hand in the browser |
| F098 | Purchase orders | OEM mail on PO decision | **PASS** | agrees | automated (2 file(s), 26 tests) |
| F099 | Dashboards - interactive | Home dashboard | **PASS** | agrees | automated (2 file(s), 8 tests) + driven by hand in the browser + qa-gap-coverage: home dashboard counts |
| F100 | Dashboards - interactive | Interactive Smart Dashboard | **PASS** | differs | automated (4 file(s), 83 tests) + driven by hand in the browser |
| F101 | Dashboards - interactive | KPI scorecard with trend | **PASS** | agrees | automated (2 file(s), 27 tests) |
| F102 | Dashboards - interactive | Click-to-drill pop-up (4 steps) | **PASS** | agrees | automated (4 file(s), 41 tests) + driven by hand in the browser |
| F103 | Dashboards - interactive | Cascading filter bar | **PASS** | agrees | automated (3 file(s), 70 tests) |
| F104 | Dashboards - interactive | Time periods | **PASS** | agrees | automated (2 file(s), 51 tests) |
| F105 | Dashboards - interactive | Priority highlights strip | **PASS** | agrees | automated (1 file(s), 26 tests) + driven by hand in the browser |
| F106 | Dashboards - interactive | Stores and Regions view | **PASS** | agrees | automated (2 file(s), 39 tests) |
| F107 | Dashboards - interactive | Group and OEM matrix | **PASS** | agrees | automated (1 file(s), 26 tests) |
| F108 | Dashboards - interactive | Workload and Approvals view | **PASS** | agrees | automated (2 file(s), 33 tests) |
| F109 | Dashboards - interactive | Heatmap and ticket explorer | **PASS** | agrees | automated (2 file(s), 57 tests) |
| F110 | Dashboards - interactive | Export from the dashboard | **NOT TESTED** | agrees | no automated test found and not driven by hand in this QA |
| F111 | Dashboards - interactive | Technician dashboard and workload | **PASS** | agrees | automated (5 file(s), 45 tests) |
| F112 | Dashboards - interactive | Drag-and-drop dashboard widgets | **NOT TESTED** | agrees | no automated test found and not driven by hand in this QA |
| F113 | Dashboards - interactive | Service, Category and Sub category filters | **PASS** | agrees | automated (2 file(s), 39 tests) |
| F114 | Ticket Calendar | Ticket Calendar for every group | **PASS** | agrees | automated (3 file(s), 30 tests) |
| F115 | Ticket Calendar | Colour by the group's own normal | **PASS** | agrees | automated (1 file(s), 10 tests) |
| F116 | Ticket Calendar | Place picker | **PASS** | differs | automated (2 file(s), 24 tests) |
| F117 | Ticket Calendar | Faulty AC and genset calendar | **PASS** | agrees | automated (2 file(s), 20 tests) |
| F118 | Ticket Calendar | ACs that fail again and again | **PASS** | agrees | automated (1 file(s), 14 tests) |
| F119 | Ticket Calendar | Same issue again | **PASS** | agrees | automated (1 file(s), 10 tests) |
| F120 | Ticket Calendar | Break it down by | **PASS** | unclear | automated (1 file(s), 10 tests) |
| F121 | Ticket Calendar | Day pop-up | **NOT TESTED** | differs | no automated test found and not driven by hand in this QA |
| F122 | Ticket Calendar | Worst places right now | **PASS** | agrees | automated (1 file(s), 14 tests) |
| F123 | Ticket Calendar | Outside temperature | **PASS** | agrees | automated (2 file(s), 15 tests) |
| F124 | Reports | Report Builder | **PASS** | differs | automated (4 file(s), 42 tests) + driven by hand in the browser |
| F125 | Reports | Saved reports | **PASS** | agrees | automated (1 file(s), 7 tests) |
| F126 | Reports | Report Analytics | **PASS** | agrees | automated (3 file(s), 55 tests) |
| F127 | Reports | Predefined Reports | **PASS** | agrees | automated (5 file(s), 61 tests) |
| F128 | Reports | Excel and CSV exports | **PASS** | agrees | automated (4 file(s), 21 tests) |
| F129 | Reports | India-time reporting | **PASS** | agrees | automated (3 file(s), 26 tests) |
| F130 | Projects, tasks, knowledge | Projects and milestones | **PASS** | agrees | automated (3 file(s), 27 tests) |
| F131 | Projects, tasks, knowledge | Tasks | **PASS** | agrees | automated (4 file(s), 15 tests) |
| F132 | Projects, tasks, knowledge | Knowledge Base | **NOT TESTED** | differs | no automated test found and not driven by hand in this QA |
| F133 | Projects, tasks, knowledge | Runbooks | **NOT TESTED** | agrees | no automated test found and not driven by hand in this QA |
| F134 | Customer satisfaction | Rate the fix (CSAT) | **PASS** | agrees | automated (2 file(s), 15 tests) + driven by hand in the browser |
| F135 | Customer satisfaction | Low-rating alert | **PASS** | agrees | automated (1 file(s), 8 tests) |
| F136 | Intake channels | E-mail intake with human review | **PASS** | agrees | automated (4 file(s), 27 tests) |
| F137 | Intake channels | Intake rules and classification | **NOT TESTED** | agrees | no automated test found and not driven by hand in this QA |
| F138 | Administration, security and logs | Categories, services and SLA set-up screens | **PASS** | agrees | automated (2 file(s), 18 tests) |
| F139 | Administration, security and logs | Platform settings | **PASS** | agrees | automated (2 file(s), 18 tests) |
| F140 | Administration, security and logs | Security hardening | **PASS** | agrees | automated (8 file(s), 88 tests) |
| F141 | Administration, security and logs | System Log (tamper-evident) | **PASS** | agrees | automated (6 file(s), 50 tests) |
| F142 | Administration, security and logs | Monitoring and health | **PASS** | agrees | automated (4 file(s), 37 tests) |
| F143 | Administration, security and logs | Daily weather job | **PASS** | agrees | automated (1 file(s), 6 tests) |
| F144 | Not built yet | Send scheduled reports by e-mail | **OUT OF SCOPE** | agrees | Not built yet (the guide says so; not a defect) |
| F145 | Not built yet | Reminder for a waiting quote | **OUT OF SCOPE** | agrees | Not built yet (the guide says so; not a defect) |
| F146 | Not built yet | Vendor replies by e-mail | **OUT OF SCOPE** | agrees | Not built yet (the guide says so; not a defect) |
| F147 | Not built yet | Weather fallback by the nearest store | **OUT OF SCOPE** | agrees | Not built yet (the guide says so; not a defect) |
| F148 | Not built yet | Calendar fix for reopened tickets | **OUT OF SCOPE** | agrees | Not built yet (the guide says so; not a defect) |
| F149 | Not built yet | CK Desk Bot | **OUT OF SCOPE** | agrees | Not built yet (the guide says so; not a defect) |
| F150 | Not built yet | Google Workspace user sync | **OUT OF SCOPE** | agrees | Not built yet (the guide says so; not a defect) |
| F151 | AC PMS (new) | AC PMS Google Sheet and daily tickets | **PASS** | agrees | automated (2 file(s), 26 tests) + driven by hand in the browser |
| F152 | AC PMS (new) | Vendor tabs: My tickets / AC PMS tickets | **PASS** | agrees | automated (2 file(s), 26 tests) + driven by hand in the browser |
| F153 | AC PMS (new) | Lighter PMS visit for vendors | **PASS** | agrees | automated (2 file(s), 26 tests) + driven by hand in the browser |
| F154 | Approvals (new) | Approval history box | **PASS** | differs | automated (2 file(s), 15 tests) + driven by hand in the browser |
| F155 | Sheet masters (new) | Master data health with check time | **PASS** | agrees | automated (3 file(s), 40 tests) + driven by hand in the browser |

## Features with no test and not driven by hand (NOT TESTED)

* F058 Daily alert digest — Digest is an in-app notification to manager/admin roles; e-mail only if the alert rule has the email channel; uses server local hour (getHours()===8), not explicit IST.
* F110 Export from the dashboard — CSV built in the browser (ticketsToCsv); not tested; not logged as an export.
* F112 Drag-and-drop dashboard widgets — @dnd-kit only on the normal dashboards (/dashboards, /admin/reports), not on the Smart Dashboard.
* F121 Day pop-up — Appendix lists Requester; unreachable (see F100).
* F132 Knowledge Base — Appendix Who = Requester, Technician, Manager/Admin; the only screen is under /admin (manager/admin/platform owner). No requester-facing article view found.
* F133 Runbooks —
* F137 Intake rules and classification — Live: built, switched off.

## Differences between the written guide and the code (found by the code reading)

* **D001** — Guide: Guide 8.8 step 5 and scenario E6: 'Reject only the quote' puts the ticket back to In Progress. → Code: The ticket stays on Hold (SLA still paused) and moves to the vendor's Part required box with the quote items (no prices). Only cancelTicket=true cancels.
* **D002** — Guide: Appendix A, Auto-close: 'Runs whenever someone opens the Home page (there is no scheduled job)'. Sections 8.11 and 9 say job csat every 30 minutes. → Code: Auto-close is done by /api/csat/run (every 30 min, all organisations); the Home trigger is only a legacy extra for managers. The guide contradicts itself.
* **D003** — Guide: Appendix A: Permission matrix has 'four switches'. → Code: Six policy keys exist (global_settings_write, business_rules_write, workflow_edit, intake_priority_override, external_invites, report_recipients). Guide section 2.4 lists six.
* **D004** — Guide: Guide 8.10: time periods 7/30/60/90/120 days, FY. → Code: Period options are 30d, 60d, 90d, 120d, fy and custom; no 7-day option (Appendix A is right).
* **D005** — Guide: Guide 8.10 lists drag-and-drop widgets as part of the Smart Dashboard. → Code: @dnd-kit widget reordering exists only in AnalyticsDashboard (/dashboards and /admin/reports), not in the Smart Dashboard (Appendix A says normal dashboards).
* **D006** — Guide: Guide 8.10: calendar days are yellow when >10% and red when >30% over the group's normal. → Code: The 10%/30% rule applies to the share of faulty ACs (AC/genset calendar). Groups without assets use the median and busiest-15% level of the last 90 days.
* **D007** — Guide: Appendix A lists Requester as a user of the Smart Dashboard, Place picker, Faulty AC calendar and Day pop-up ('one dashboard for every role'). Section 4 says requesters get Home only. → Code: /dashboards/executive redirects role user to /home and the sidebar hides it from requesters. Section 4 is right; Appendix A 'Who' is wrong for those rows (the requester level copy in levels.ts is unreachable).
* **D008** — Guide: Section 4: Reports - requester: no. → Code: Report Builder (/reports/pivot) is open to every signed-in role with the Requests module; a requester sees only their own tickets (scope own). Other entities stay manager+.
* **D009** — Guide: Appendix A: Knowledge Base used by Requester and Technician. → Code: The only Knowledge Base screen is /admin/knowledge-base (manager, admin, platform owner); no requester-facing article page was found.
* **D010** — Guide: Appendix A 'Roles ... each with its own pages and rights' and section 7 Roles screen. → Code: Admin > Roles permission matrix (custom roles / overrides) is read-only and labelled 'Not enforced - Coming soon'; toggles change nothing. Only the five fixed roles are enforced.
* **D011** — Guide: Section 6.1 transition table. → Code: Agents may also move Waiting on User -> Resolved; requesters may move Waiting on User -> Open and -> Cancelled; agents cannot cancel from Waiting on User or Hold (Hold -> Cancelled exists only for a system PO rejection). Table says Open/Assigned/... -> Cancelled.
* **D012** — Guide: Section 9 scheduled job list. → Code: install-cron-tasks.ps1 also registers CitykartDesk-Cron-Visits (job visit-automation, every 15 min) for the dropped engineer-visit module. cron-tick.mjs has no such job, so it would call /api/visit-automation/run (no such route) and log a failure every 15 minutes. Re-running the installer on the server would create it.
* **D013** — Guide: Sheet copies run at 11:00, 15:00, 19:00 (section 8.7, 9). → Code: Times agree with schedule.ts and the installer, but the route comment in app/api/masters/sync/route.ts says 'Scheduled job (every minute)' and docs/SHEET-MASTERS-GUIDE.md still says three sheets (now four).
* **D014** — Guide: Section 8.8 / 12: the PO default approver is the single approver set in Admin > Vendors. → Code: When no approver is set, code falls back to a hard-coded person's company e-mail address (DEFAULT_PO_APPROVER_EMAIL) found in auth users.
* **D015** — Guide: Appendix A, SLA escalation and alert rules 'at 15-minute checks'. → Code: Scheduled Business Rules (SLA %, unassigned minutes) run every 15 min; alert rules (unassigned requests, task/milestone alerts) run in the alerts job every 30 min.
* **D016** — Guide: Appendix A, Daily alert digest: 'One summary mail every morning at 08:00'. → Code: The digest is an in-app notification to the alert rule's roles (manager, admin by default); an e-mail goes out only when the rule has the email channel. The hour test uses server local time (getHours()===8), not explicit India time.
* **D017** — Guide: Section 11: 'Unit (about 1,560 tests)'. → Code: A count of it/test declarations in tests/unit gives about 1,405 (before it.each expansion). Cannot confirm 1,560 without running.
* **D018** — Guide: Section 2.3: 184 numbered migrations (000 ... 184); rollbacks kept from 164. → Code: There are 184 files because number 176 does not exist (175 -> 177); there is no 176 rollback.
* **D019** — Guide: docs/ARCHITECTURE.md vs the guide. → Code: ARCHITECTURE.md states Next.js 16.2.9 (package.json: 16.3.8), e-mail via Resend (code: SMTP, Resend only as fallback), deployment 'local only' (CLAUDE.md: production on 10.0.1.98), 87 migrations (184), in-process rate limiting only, and has no vendor/PMS/sheet masters. The guide calls it partly outdated.
* **D020** — Guide: HANDOVER.md (old session note) vs the guide. → Code: HANDOVER.md says Docker is not running, describes a single-admin model and QA leftovers, and treats SLA escalation as Business Rules; the guide section 5 still lists escalation_policies / sla_escalation_rules / sla_escalation_events as current tables. Code reads sla_escalation_rules only in the one-time conversion action.
* **D021** — Guide: Guide 8.9(4) and docs/AC-PMS.md: PMS tickets are not counted in the AC Ticket Calendar and AC complaint reports. → Code: No PMS check exists in the calendar or report code. Exclusion happens only because those read categories with auto_oem_kind ac/genset and services with auto_oem_routing, so it holds only if the AC-PMS category/service lack those flags. Untested.
* **D022** — Guide: Guide 8.5e: last 5 decisions of the same store and sub-category in the last 12 months. → Code: Rows also include approvals still waiting; the window is 12 x 31 days; at most 100 earlier approvals are read (totals could be understated for very large histories).
* **D023** — Guide: Section 10.1: job routes without x-cron-secret return 401. → Code: They return 401 for a missing/wrong secret but 503 when CRON_SECRET is not configured on the server.
* **D024** — Guide: Guide and Appendix: vendor dashboard has 7 boxes. → Code: Code and tests agree (7), but a code comment in lib/vendor/access.ts and the test title 'the six boxes' still say six.
* **D025** — Guide: Comment in lib/constants/request-transitions.ts points to tests/vapt/23-business-rule-limits.test.ts. → Code: That file does not exist; the matching test is tests/vapt/23-permission-matrix-and-rules.test.ts.
* **D026** — Guide: Guide 8.11 / Appendix: a low CSAT rating alerts managers. → Code: Ratings of 1-2 stars notify the technician who handled the ticket and the leads of its group (bell).
* **D027** — Guide: Guide 8.2: Qty appears for FIXTURES/HANGERS. → Code: Depends on the form configuration; the automated test only proves Qty for the Fixture category and absence elsewhere.
* **D028** — Guide: CLAUDE.md and AGENTS.md vs the guide. → Code: No contradiction found: guide section 0 (no push, no deploy, test locally) is consistent with CLAUDE.md; CLAUDE.md production topology is not repeated in the guide.

## Things the code does that the guide does not mention

* Kanban board view of requests and tasks (drag between statuses using AGENT_TRANSITIONS)
* Global search box in the top bar
* Manual Send now for a scheduled report
* Duplicate a ticket; edit category / sub-category and form answers after creation; change ticket source
* Admin > Task Configuration (task statuses, priorities, templates)
* Admin > Audit Logs and Event Log screens; /api/admin/audit
* Trial banner and Trial expired page
* WhatsApp intake, conversation engine, questionnaire (out of scope, code present)
* DeskTime sync and admin screen (out of scope, code present)
* Mobile-number management for users (used by WhatsApp)
* Server Room AC is excluded from counted ACs in the calendar and AC reports
* Home cards: store snapshot and technician workload
* Theme switcher, mobile navigation, new-version banner
* Public endpoints: CSP report, system-log ingest, public storage route
* Preview configuration citykart-desk-qa (port 3310, same as demo)
* Engineer-visit scheduled task still in the installer (module dropped)
* Resend e-mail provider as third sending option
* Intake pages: queue, inbox, channels, settings
