# CITYKART DESK — DEDICATED DESIGN & UI/UX TESTING REPORT

**Date:** 2026-09-10
**Tester:** Claude (Sonnet 5), acting as QA
**Scope:** Full-level Application Design Check (Test Stream 4 of the master QA prompt), performed as a dedicated, standalone pass — supersedes and completes the partial design coverage noted in `CITYKART-DESK-COMPLETE-TEST-REPORT-2026-09-10.md`.
**Method:** Live browser inspection at `http://localhost:3210`, signed in as **UAT Admin** (Admin role), custom viewport 1440×900 (desktop) plus 768×1024 (tablet) and 375×812 (mobile) emulation. View-only navigation — no data was created, edited, or deleted during this pass. No QA-prefixed test records were added; the "Test Data Created" table is empty for this report.
**Rules honored:** TEST ONLY. No fixes applied. No genuine Citykart business data (Projects, Knowledge Base articles, real employee records) was modified — pages containing real production data were inspected visually only, with no clicks into editable fields.

---

## 1. Executive Summary

The application's visual design and interaction patterns are **consistent and professional** across the ~30 admin and workspace surfaces inspected. Table layouts, tab structures, empty states, color-coded status pills, and the sidebar/drawer IA all follow the same conventions page to page. Responsive behavior (desktop → tablet → mobile) is **notably strong** — the sidebar collapses to a bottom tab bar with a full-IA slide-over drawer under "More," and no layout breakage or horizontal page-scroll was observed at any tested width.

However, this pass surfaced **two data/calculation defects that are more than cosmetic** (negative average-resolution-time figures on the Analytics dashboard, and a 0%-average-progress bug on the Projects analytics tab), plus one **business-logic/configuration gap** (an Approval Flow bound to all seven live services but with zero approval steps configured) that should be routed to the business owner, not just design. These are documented in Section 4 as they were discovered during the visual sweep and materially affect what users see on screen.

| Severity | Count |
|---|---|
| Defect (data/calc) | 2 |
| Business Decision Required | 1 |
| Design/IA inconsistency (cosmetic) | 4 |
| Positive observations (no action needed) | 6+ |

---

## 2. Pages Inspected This Pass

All pages below were opened directly (via URL, to avoid a prior-session typing-reliability issue with the browser automation tool) at 1440×900, screenshotted, and visually reviewed. Pages already covered in the earlier testing pass (see the complete test report) are marked "re-verified"; pages new to this dedicated pass are marked "new."

| Area | Page | Status |
|---|---|---|
| Workspace | Tasks (Table/Board/Calendar/Timeline) | Re-verified |
| Workspace | Projects (list, card view, one detail page — **real data, view-only**) | New |
| Admin | Knowledge Base (**real data, view-only**) | New |
| Admin | Org Structure — Departments/Locations/Cost Centers/Functions/Designations/Stores/OEMs | New (5 tabs) / Re-verified (2 tabs) |
| Admin | Teams | Re-verified |
| Admin | SLA Policies | Re-verified |
| Admin | Master Data — Tags/Request Priorities/Task Statuses/Task Priorities | New (all 4 tabs) |
| Admin | Task Configuration — Statuses/Priorities/Templates | New (all 3 tabs) |
| Admin | Service Catalog (Service Management) | New |
| Admin | Form Templates | New |
| Admin | Categories — Cards view + Tree view | New |
| Admin | Business Rules | Re-verified |
| Admin | Approval Flows | New |
| Admin | Request Configuration — Field SLA Matrix/Lifecycle/Business Hours/Alert Rules/Notification Rules/General | New (all 6 tabs) |
| Admin | Platform Settings — General/Retention/Integrations | New (all 3 tabs) |
| Admin | DeskTime — Application hours/Project hours by person | New |
| Admin | Audit Logs | New |
| Admin | Report Builder (`/admin/reports/pivot`) — Table + Pivot modes | New |
| Admin | Jobs / Runbooks (`/admin/runbooks`) | New |
| Admin | Analytics & Reports — Requests/SLA/Tasks/Workload/Projects tabs | New |
| Admin | Roles & Permissions — Role Overview + Permission Matrix | Re-verified |
| Auth | Set new password (`/reset-password`) | New |
| Responsive | Home page at tablet (768×1024) and mobile (375×812) | New |
| Responsive | Mobile "More" navigation drawer | New |

---

## 3. Design System & IA Consistency — What's Working Well

- **Table pattern**: every admin list (Tags, Request Priorities, Task Statuses/Priorities, Locations, Cost Centers, Business Rules, Approval Flows, Alert Rules...) uses the same header row styling, row hover, and right-aligned Actions column. No visual drift found across 20+ tables.
- **Empty states**: consistently designed with a centered icon/message and a clear next action (e.g., "No cost centers yet" + "Add Cost Center" button; "No templates yet" on Task Templates; "No DeskTime project time in this range. Run a sync or widen the dates."). This pattern held on every empty table checked.
- **Color-coded pills**: status/priority colors (green=Active, red=Critical, etc.) are used consistently between Master Data, Task Configuration, and live request/task views.
- **404 page**: clean, on-brand, with "Go to Home" and "View Requests" recovery actions — good UX even for a broken link.
- **Responsive breakpoints**: sidebar → bottom tab bar → "More" drawer transition is smooth at both tablet and mobile widths; no horizontal page scroll, no clipped content, no overlapping elements observed at any tested size. Dense tables that don't fit (e.g., "Requests by Technician" on the Home page) scroll **within their own card**, not the page — correct containment pattern.
- **Test data hygiene**: my own prior-session QA test rule (`UAT-DESK-20260910-Escalation-Test`) is still present and correctly disabled in Business Rules — confirms test data is being preserved as required, not silently cleaned up by the app.

---

## 4. Defects & Notable Findings (New This Pass)

### 4.1 — DEFECT: Negative average-resolution-time displayed across the Analytics dashboard
**Where:** Admin → Analytics & Reports → **Requests** tab and **SLA** tab (30-day range).
**What was observed:** The "Avg Resolution" KPI tile, "Avg Resolution Time," "Median Resolution Time," the Priority Breakdown ("Medium … -90m"), the Team Performance table ("HR Support … Avg TAT -90m"), and the Agent Leaderboard ("UAT Agent One … 5 open · -90m avg") **all show identically `-90m`** (equivalently `-1.5h` on the SLA tab). A duration/TAT metric should never be negative — this is either a reversed subtraction (e.g., `created_at - resolved_at` instead of `resolved_at - created_at`) or a timezone-offset bug in the aggregation query. The fact that the exact same negative value appears across five independent widgets points to a single shared calculation function, not isolated bad records.
**Classification:** FAIL (data/calculation defect). Not fixed, per TEST-ONLY rules.
**Suggested next step for engineering:** inspect the TAT/resolution-time aggregation query behind the Analytics module; likely candidates are the resolved-vs-created timestamp subtraction or a UTC/local timezone mismatch equal to ~90 minutes.

### 4.2 — DEFECT: "Avg Progress" always shows 0% on Projects analytics, even for completed projects
**Where:** Admin → Analytics & Reports → **Projects** tab → "Team Performance" and "Project Owners With No Manager Set" tables.
**What was observed:** Every project owner row shows **0% Avg Progress**, including owners with multiple projects marked "Done" (e.g., Praveen Singla: 3 Done projects, listed at 0% avg progress; Amit Mangal: 2 Done, 0%). A completed project should contribute 100% to that owner's average, so an owner with any Done project showing 0% average is inconsistent with the underlying status data shown elsewhere on the same page (Status Mix: 7 Done overall).
**Classification:** FAIL (data/calculation defect). Not fixed, per TEST-ONLY rules. This concerns real production project data, not QA test data.

### 4.3 — BUSINESS DECISION REQUIRED: "Manager Approval" flow bound to all 7 live services with zero configured steps
**Where:** Admin → Approval Flows.
**What was observed:** The "Manager Approval" workflow card is expanded to show "APPROVAL STEPS: No steps yet. Add a step below," yet its "BOUND SERVICES" list includes **all seven live services** (BD Support, FINANCE & ACCOUNTS Support, HR Support, IT Support, L&D Support, LEGAL Support, Vendor Creation Support). Every other workflow on the same page (Ad-hoc rules, HR Manager Approval) has at least one step. A workflow with zero steps bound to live services will not gate or route anything when triggered — this is either intentionally a placeholder awaiting configuration, or a real gap where approvals are silently not happening for these services.
**Classification:** BUSINESS DECISION REQUIRED — needs a business owner to confirm whether this is intentional (in-progress config) or a live gap. This is genuine business configuration, not QA data, so it was not modified.

### 4.4 — Minor: "Pending Approval" request status marked Terminal with no listed transitions
**Where:** Admin → Request Configuration → Lifecycle tab.
**What was observed:** In the status-transition matrix, "Pending Approval" is tagged **Terminal** — the same tag used for Closed and Cancelled (true end states). Unlike those, Pending Approval presumably should progress once an approval decision is made, but the matrix shows no Agent or Requester transitions out of it. This is likely because the transition happens via the approval-decision code path rather than a manual status change, so the "Terminal" label may just mean "no manual transition" — but as displayed, it reads as confusing/inconsistent with its neighboring rows. Worth a copy/label clarification (e.g., "System-managed" instead of "Terminal") but is not a functional defect on its own.
**Classification:** Design-clarity observation, cosmetic.

### 4.5 — Minor: Settings duplication — "Auto-close after resolution" editable in two separate admin screens
**Where:** Admin → Platform Settings → General, **and** Admin → Request Configuration → General.
**What was observed:** Both screens show the identical setting "Auto-close after resolution (days)" = 15d, independently editable via its own "Edit" link on each page. Unlike the Master Data "Task Statuses"/"Task Priorities" tabs (which are simple redirect stubs pointing to Task Configuration — not a duplication, just an IA shortcut), this appears to be the **same underlying value exposed as an independent editable control in two different places**, which risks the two screens drifting out of sync depending on how each is wired.
**Classification:** IA/design inconsistency — worth a design decision on whether one of the two should defer/link to the other (as Master Data does for Task Statuses/Priorities) rather than both being independently editable.

### 4.6 — Minor: Sidebar/page-label mismatches
- Sidebar label **"Task Templates"** links to a page titled **"Task Configuration"** (`/admin/task-config`). The tab contents (Statuses, Priorities, Templates) are broader than "Templates" alone implies.
- Sidebar label **"Jobs"** links to `/admin/runbooks`, which is a **documentation/help-article browser** ("Platform Overview," "Role Guide," etc.), not a background-job/cron status page. An admin looking for cron/job health (relevant given the disabled integrations found in 4.7) would not find it under "Jobs."
**Classification:** Naming-consistency observation, cosmetic — does not block any workflow, but could cause momentary confusion for new admins.

### 4.7 — Environment/operational note: Email delivery and scheduled jobs are unconfigured in this environment
**Where:** Admin → Platform Settings → Integrations.
**What was observed:** "Email (Resend)" shows a red status dot with "RESEND_API_KEY not set — email delivery is disabled." "Business Rules Cron," "Alert Cron," and "Report Cron" all show red/unwired status with instructions to wire them to `.claude/cron.md`. This is disclosed transparently on the page itself (good design), and explains why email-based notification flows and time-based automation (SLA escalations, alert rules, digest emails) could not be verified live in this or the prior testing pass — the gap is environment configuration, not application code. Flagging for visibility; not a defect in the reviewed UI.

### 4.8 — Minor: Inconsistent percentage formatting on SLA analytics tab
**Where:** Admin → Analytics & Reports → SLA tab → "SLA Compliance by Priority."
**What was observed:** "Medium: 17" is shown with no `%` suffix, while every other compliance figure on the same page (Resolution SLA Compliance 50%, First Response SLA Compliance 100%) is formatted with `%`. Likely a missing format string on this one widget rather than a wrong value.
**Classification:** Cosmetic formatting inconsistency.

### 4.9 — Minor: Service Management list — every row shows "Unassigned"
**Where:** Admin → Service Catalog.
**What was observed:** All 7 services (L&D, LEGAL, HR, IT, BD, FINANCE & ACCOUNTS, Vendor Creation Support) show "Unassigned" in the ownership/team column. This may simply reflect that no default team routing has been configured yet (a data-completeness item for the business, not a UI bug) — flagging for awareness since it's visible on every row with no exceptions.

### 4.10 — Minor: Audit Log "Details" column shows raw JSON
**Where:** Admin → Audit Logs.
**What was observed:** The Details column renders raw JSON strings (e.g., `{"reason":"unsatisfied_with_resolution"...}`, `{"to":"open","from":"resolved"}`) rather than a human-readable summary. Acceptable for a technical audit trail aimed at admins, but a lower-priority polish opportunity if this log is ever surfaced to less technical users.

---

## 5. Responsive / Viewport Testing

Tested the Home page (chosen as the most widget-dense workspace page) at three widths:

| Viewport | Result |
|---|---|
| 1440×900 (desktop) | Full sidebar with nested sub-menus, multi-column KPI cards. No issues. |
| 768×1024 (tablet) | Sidebar collapses to a bottom tab bar (Home/Projects/New Request/Requests/Agent Requests/Tasks/Approvals/Notifications/More); KPI cards reflow correctly; no clipped content. |
| 375×812 (mobile) | KPI cards stack 2-per-row then adapt; dense tables scroll horizontally **within their card** rather than breaking page layout; header logo swaps to a larger full wordmark+icon lockup (consistent with the one used on the password-reset page — appears to be an intentional compact-vs-full logo swap for space-constrained headers, not a bug); "More" opens a full slide-over navigation drawer reproducing the entire desktop sidebar IA (Analytics, Workspace, Administration → Access/Service Desk/... groups), giving mobile admins complete parity with desktop. |

No layout breakage, overlap, or unreachable functionality was found at any tested width. This is a genuine strength of the application.

**Not tested this pass** (would need additional time): dark/light theme toggle interaction at each breakpoint, orientation change (portrait↔landscape) on mobile, and zoomed browser text-size accessibility (200% zoom reflow).

---

## 6. Accessibility — Partial Coverage (Carried Over)

A single spot-check of the login form's keyboard tab order and focus visibility was performed in the prior testing pass and is not repeated here. **Not completed in this pass**: systematic keyboard-only navigation across the sidebar/drawer, focus-trap verification inside modals (e.g., "Add Status," "Edit" dialogs), screen-reader label audit, and color-contrast measurement against WCAG AA. This remains a gap; a dedicated accessibility pass would need either browser dev-tools axe-core scanning or a screen reader, neither of which is available through the current browser-automation tooling in a reliable way. Recommend a follow-up pass with dedicated a11y tooling if this is a compliance requirement.

---

## 7. What Remains Genuinely Not Testable Here

Per the broader instruction to complete partial coverage from the original master QA prompt wherever reasonably possible, the following were assessed for feasibility and are called out explicitly rather than silently skipped:

- **Multi-role live UAT flows** (e.g., a Requester submitting → a Technician resolving → a Manager approving, as one continuous live chain) require simultaneously signed-in sessions across multiple role accounts, which this single-browser-session tooling cannot do in parallel. The individual role capabilities were spot-checked in the earlier pass; the end-to-end handoff was not re-verified here.
- **CSV/XLSX export reconciliation** (verifying exported file contents byte-for-byte against on-screen data) requires downloading and opening a file outside the browser, which is outside the scope of this browser-based design pass.
- **Load/performance testing** requires tooling (e.g., concurrent request generation) not available here and was not attempted.
- **Email notification delivery** cannot be verified live because Resend is unconfigured in this environment (see 4.7) — this is an environment limitation, not something further testing could resolve.

These are named here so they are visible as explicitly NOT TESTED rather than silently omitted, consistent with the master prompt's classification system.

---

## 8. Test Data Created

None. This pass was navigation/visual-inspection only — no records were created, edited, or deleted.

---

## 9. Summary Table

| # | Finding | Area | Classification |
|---|---|---|---|
| 4.1 | Negative avg resolution time (-90m) across 5 widgets | Analytics → Requests/SLA | FAIL |
| 4.2 | 0% Avg Progress for all project owners incl. Done projects | Analytics → Projects | FAIL |
| 4.3 | "Manager Approval" flow: 0 steps, bound to 7 live services | Approval Flows | BUSINESS DECISION REQUIRED |
| 4.4 | "Pending Approval" status labeled Terminal, no transitions shown | Request Config → Lifecycle | Cosmetic |
| 4.5 | Duplicate editable "Auto-close after resolution" setting | Platform Settings vs Request Config | IA inconsistency |
| 4.6 | Sidebar label vs page title mismatches (Task Templates/Jobs) | Sidebar IA | Cosmetic |
| 4.7 | Email + 3 cron integrations unconfigured (disclosed on-page) | Platform Settings → Integrations | Environment note |
| 4.8 | Missing % suffix on one SLA-by-priority figure | Analytics → SLA | Cosmetic |
| 4.9 | All services show "Unassigned" | Service Catalog | Data-completeness note |
| 4.10 | Audit log Details column shows raw JSON | Audit Logs | Cosmetic |

**Overall design-system consistency across ~30 surfaces: strong.** Two data-calculation defects (4.1, 4.2) and one business-logic gap (4.3) are the items warranting prompt follow-up; the remainder are polish-level.
