# 03 — Complete Feature Inventory

## Plain summary
Citykart Desk has **75 pages**, **40 API routes**, **1,031 source files**, **431 test files** and **195 database migrations**. The directive lists 30 modules; this table maps each one to its code and to the evidence produced in this audit. The counts come from `evidence/feature-matrix.mjs` (a scan of the repository on 2026-11-16).

"Tests" are the existing automated tests found for that area (unit / integration / remediation / VAPT). "Audit evidence" is what this audit added or re-ran. A module marked **LOW** has fewer than 30 existing automated tests.

| # | Module | Code files | Lines | Existing tests (u / i / r / v) | Audit evidence in this run | Existing cover |
|---|---|---|---|---|---|---|
| 01 | Login, authentication, passwords | 14 | 981 | 49 / 20 / 19 / 19 | Smoke; UI K01-K04; DAST S03-S06; UAT login in every scenario | good |
| 02 | User and employee administration | 13 | 3,797 | 12 / 26 / 4 / 7 | UI sweep (admin/users 6 widths); K05 Invite User pop-up; R04 profile-write attacks | good |
| 03 | Roles, permissions, organisation scope | 10 | 1,116 | 73 / 39 / 19 / 18 | DAST S10-S12, R01-R04, R06 (multi-organisation); persona matrix in every UAT | good |
| 04 | Requester dashboard / home | 5 | 1,238 | 0 / 0 / 0 / 4 | UI sweep (Home, 9 personas); load test; screenshots | **LOW** |
| 05 | Ticket creation and service catalogue | 8 | 2,847 | 7 / 13 / 0 / 16 | UAT A (store AC complaint), B (fixtures) | good |
| 06 | Categories and subcategories | 6 | 1,679 | 54 / 32 / 6 / 21 | UI sweep (admin/categories); existing 116 tests | good |
| 07 | Dynamic forms and mandatory fields | 10 | 2,272 | 16 / 15 / 0 / 2 | UAT A/B (form filled through the screen); UI-006 fix | good |
| 08 | Assignment and technician groups | 1 | 192 | 60 / 37 / 18 / 31 | UAT D; W03 two technicians pick up at once | good |
| 09 | Ticket lifecycle and status transitions | 3 | 930 | 79 / 76 / 21 / 42 | UAT A-D (open > assigned > in progress > resolved); existing 220 tests | good |
| 10 | Priority, SLA and escalations | 7 | 1,460 | 41 / 18 / 6 / 10 | UAT C (SLA 80%/100%); W01/W02 | good |
| 11 | Business Rules and automation | 9 | 2,269 | 16 / 10 / 3 / 16 | UAT C; W01 conflict + parallel scheduler; W02; W05 | good |
| 12 | Approval workflows and delegation | 24 | 3,337 | 74 / 9 / 8 / 22 | UAT B (CVM approval); public approve links S07; existing 115 tests | good |
| 13 | Conversations and attachments | 17 | 1,737 | 60 / 32 / 6 / 39 | UAT D (comments, attachments); SAST file serving review | good |
| 14 | Notifications, e-mail and WhatsApp | 41 | 4,520 | 149 / 72 / 27 / 52 | UAT A/C/G (mail to the mail-catcher, WhatsApp webhook); egress evidence | good |
| 15 | Search, filters and exports | 8 | 1,159 | 101 / 40 / 15 / 37 | DAST S14 hostile search; load test /requests?q=; UI sweep | good |
| 16 | Dashboards and reports | 49 | 7,767 | 95 / 26 / 10 / 16 | UI sweep; load test (executive dashboard, analytics); existing 150 tests | good |
| 17 | Knowledge Base | 4 | 385 | 19 / 7 / 0 / 3 | UI sweep only; 30 existing tests | **LOW** |
| 18 | CSAT and feedback | 9 | 560 | 20 / 1 / 0 / 7 | DAST S07 token pages; UI sweep (rating page) | **LOW** |
| 19 | Vendor / OEM access and workflows | 43 | 4,762 | 63 / 5 / 0 / 24 | UAT D (vendor technician and vendor manager); S12 vendor isolation | good |
| 20 | AC and genset management | 29 | 3,597 | 61 / 18 / 0 / 18 | UAT A (AC sheet, store AC complaint) | good |
| 21 | Parts, quotations and purchase orders | 9 | 1,191 | 23 / 1 / 3 / 7 | UAT D (parts request, PO, approval) | good |
| 22 | Field Service Reports | 1 | 131 | 3 / 0 / 0 / 4 | Code only: module dropped 2026-10-22; 7 legacy tests. NOT RUN in the browser. | **LOW** |
| 23 | Preventive maintenance (PMS) | 6 | 568 | 7 / 0 / 0 / 6 | Unit tests only (13). No PMS sheet is configured in the audit stack. NOT RUN in the browser. | **LOW** |
| 24 | Google Sheet Masters and sync | 24 | 2,626 | 145 / 82 / 32 / 53 | UAT A/B (three sheets loaded); 323 existing tests | good |
| 25 | CVM and fixtures approval | 0 | 0 | 17 / 79 / 19 / 53 | UAT B (CVM approves on the Approvals screen); 178 tests | good |
| 26 | Zoho historical tickets | 12 | 1,578 | 2 / 0 / 0 / 0 | UAT E (Zoho overview, reports, look-up, read-only proof, outage) | **LOW** |
| 27 | CKOneAI assistant | 10 | 441 | 50 / 31 / 3 / 11 | UAT F (signed bridge vs stand-in, 18 checks); K11 | good |
| 28 | Scheduled tasks and background jobs | 10 | 918 | 38 / 13 / 6 / 12 | UAT C; W01-W05; recovery tests (report 12) | good |
| 29 | Audit trails and system logs | 21 | 2,393 | 42 / 14 / 28 / 46 | SOC readiness (report 14); UAT F audit rows | good |
| 30 | Other (projects, tasks, intake inbox, data API, weather, profile) | 51 | 9,668 | 86 / 54 / 19 / 40 | UI sweep (projects, tasks, intake, weather, profile); data API in UAT F | good |

## Notes on the table
- **Page and API route lists** per module are in `evidence/feature-matrix.json` (`sampleCode` per area) and in report 07 (smoke) and 05 (UI sweep: 63 distinct pages visited).
- **LOW** areas (Requester Home, KB, Field Service Reports, PMS, Zoho, and a few others) carry the highest regression risk for future changes; this audit added browser checks for Home, KB (UI sweep), Zoho (UAT E) but **no new automated tests for FSR or PMS**: they are listed in report 16.
- **Not reachable in the audit stack** (need real outside services): live WhatsApp send, live mail send, Google/Microsoft mailbox sync, DeskTime sync, Google Sheet sync (the three sheets are read from local sample files), real CKOneAI machine, weather service, push notifications. These are marked NOT RUN (outside the isolation) in report 04.
- Module 22 (Field Service Reports / engineer visit) was **dropped by the owner on 2026-10-22**; only leftover code and tests remain.
