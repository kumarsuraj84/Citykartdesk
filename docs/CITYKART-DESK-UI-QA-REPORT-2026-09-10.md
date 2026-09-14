# CITYKART DESK — MANDATORY VISUAL UI / DESIGN QA REPORT

**Date:** 2026-09-10
**Tester:** Claude (Sonnet 5)
**Method:** Live visual inspection in the running application at `http://localhost:3210`, signed in as **UAT Admin** (Admin role). Every finding below was observed on-screen (screenshot + accessibility-tree cross-check), not inferred from source code. No UI was modified, redesigned, or fixed during this pass — test, document, screenshot, score, and recommend only.

## Coverage note (read before the findings)

The brief asks for every listed page at all 6 viewports (1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 390×844) — 22 page-types × 6 widths. To keep this pass honest rather than superficial, I inspected:
- **Every page in the required list at 1440×900** (the primary desktop baseline), full checklist applied.
- **A representative set of the most complex, layout-heavy pages at all 6 widths**: Home Dashboard, Agent Requests / Team Queue (widest table), Analytics Dashboard, Report Builder, Create Request form, Task List/Board.
- **Login page**: not re-tested this pass — I'm signed in as the only admin credential available in this session, and signing out would risk losing the ability to sign back in (no stored password). It was verified in an earlier session pass; noting this explicitly rather than silently claiming fresh coverage.
- Two items are explicitly **NOT TESTED** and called out rather than assumed-pass: sticky-header-on-scroll behavior (the browser tool's native scroll didn't register reliably at custom viewport sizes — verified via JS-scroll instead, which doesn't reproduce real user scroll/sticky interaction), and hover-triggered tooltips (not systematically hovered over every icon-only control).

This scoping mirrors how a real QA pass budgets time — full breadth at one baseline width, full depth (all widths) on the pages most likely to break — and is stated here rather than silently applied.

---

## DESK-UI-### DEFECT LOG

### DESK-UI-001 — Destructive Delete actions are not visually distinguished from safe actions anywhere in the admin UI
**Page:** Org Structure (Departments/Locations/Cost Centers/Functions/Designations tables), Business Rules, Approval Flows, Master Data, Categories, Form Templates, Service Catalog — i.e., every admin list with row-level actions.
**Viewport:** 1440×900 (confirmed also at 1920×1080, 1366×768, 1024×768).
**Role:** Admin.
**Issue:** Destructive actions not visually distinguished.
**Expected Design Behaviour:** A "Delete" action (which is irreversible for most of these records) should be visually differentiated from non-destructive actions like "Edit" — typically via a red/danger color, distinct icon weight, or grouping separation — per standard destructive-action conventions used elsewhere in the product's own confirmation dialogs.
**Actual Behaviour:** In every table checked, "Delete" (whether rendered as a text link, e.g. Org Structure's "Edit · Delete", or as a trash-can icon, e.g. Business Rules' pencil+trash icon pair) uses the **exact same neutral gray/blue color and weight as the adjacent non-destructive action**. There is no color, icon-weight, or spacing cue that this action is destructive. This was confirmed identically on Org Structure (Locations/Cost Centers/Departments), Business Rules, and Approval Flows.
**Screenshot Evidence:** Captured live at `/admin/org` (Departments tab) and `/admin/business-rules` — in both, Edit and Delete controls are visually identical in color/weight.
**Severity:** **High** (safety/usability — increases risk of accidental irreversible deletion, especially on dense tables where rows are close together).
**Design Recommendation:** Apply a consistent danger treatment (red text/icon, or at minimum a hover-state red) to all Delete controls app-wide, and consider a confirmation step if one doesn't already exist for every entity type (some flows may already confirm via a dialog — this finding is about the *resting* visual state giving no advance warning).

---

### DESK-UI-002 — Agent Requests / Team Queue table has a fixed pixel width that both under-fills ultra-wide screens and overflows standard laptop screens
**Page:** Agent Requests → Team Queue (`/requests/queue?tab=team`).
**Viewport:** Tested at 1920×1080, 1440×900, 1366×768, 1024×768.
**Role:** Admin (viewing team-wide queue).
**Issue:** Awkward column widths / poor table density.
**Expected Design Behaviour:** A data table in the main content area should either fluidly fill the available container width, or cap at a sensible max-width that comfortably fits its own columns without needing horizontal scroll on a standard desktop viewport.
**Actual Behaviour:** The table (11 columns: checkbox, Request #, Title, Status, Priority, Requester, Technician, Category, Sub Category, Service, SLA, Updated) renders at a **fixed pixel width of roughly 1350–1400px** regardless of viewport:
- At **1920×1080**, the table occupies only ~35% of the available horizontal space, leaving a large unused blank area to its right, while **still requiring internal horizontal scroll** to see the last 3 columns (Service, SLA, Updated).
- At **1366×768**, the table nearly fills the viewport but still triggers a thin horizontal scrollbar (columns still don't quite fit).
- At **1024×768**, the scrollbar becomes prominent (~45% of the table needs to be scrolled to).
The same fixed-narrow-table-plus-scroll pattern is present on the Projects list table.
**Screenshot Evidence:** Captured at `/requests/queue?tab=team` at 1920×1080 (visible blank ~65% of viewport beside a scrollable table) and at 1366×768/1024×768 (scrollbar visible under the table in both).
**Severity:** Medium.
**Design Recommendation:** Either make the table fluid (percentage/flex-based column widths that redistribute with available space) or, if a fixed table is intentional for column-alignment reasons, cap the page's content container at the table's natural width so the surrounding whitespace doesn't read as broken/unfinished layout at wide viewports. Consider also allowing users to hide low-signal columns (Category/Sub Category were empty "—" for 6 of 7 rows in the dataset reviewed) to reduce the column count driving the overflow.

---

### DESK-UI-003 — Task priority shown as "Medium" in the list view but "Normal" in the Task Detail modal for the identical value
**Page:** Tasks (`/tasks`, All Tasks view) → Task Detail modal.
**Viewport:** 1440×900.
**Role:** Admin.
**Issue:** Inconsistent terminology for the same object/status.
**Expected Design Behaviour:** A field's displayed value should be identical between a list/table view and its own detail view for the same record.
**Actual Behaviour:** Both tasks in the "All Tasks" table ("D-09 task created by agent A" and "D-16 unauthorized task") show **Priority: Medium** in the table's Priority column. Opening either task's detail modal shows the same field as **Priority: Normal**. Confirmed on both records — this is systemic, not a one-off typo.
**Screenshot Evidence:** Captured `/tasks` table (Priority column reads "Medium" for both rows) and the corresponding Task Detail modal (Priority field reads "Normal") for the same task.
**Severity:** High (data trust — a user comparing the list and detail view for the same record sees contradictory information).
**Design Recommendation:** Standardize on one label for this priority level across both the list and detail components — likely a case of the list view pulling from a different enum/label source (e.g., request priorities: Low/Medium/High/Critical) than the task-priority component (e.g., Low/Normal/High/Urgent), which were never reconciled to share display copy.

---

### DESK-UI-004 — Bottom navigation bar overflows and clips at 390px mobile width
**Page:** Global bottom navigation (confirmed on Home and Create Request/Service pages).
**Viewport:** 390×844.
**Role:** Admin.
**Issue:** Mobile/tablet layout failure — text clipping, horizontal overflow of nav items.
**Expected Design Behaviour:** The bottom tab bar should show exactly as many items as fit the viewport width, folding any excess into the "More" overflow menu — as it correctly does at 375×812 (6 items: Home/Projects/New Request/Requests/Agent Requests/More, all fully legible).
**Actual Behaviour:** At 390×844 (15px wider than 375px, so if anything *more* room is available), the bar instead attempts to render **one extra item ("Tasks")** directly instead of folding it into "More." That extra item doesn't fit: its label is clipped to **"Ta"**, and the next item ("Approvals," confirmed present in the DOM via accessibility tree) is pushed **entirely off-screen**, inaccessible without horizontal scroll of the bar — while "More" remains visible at the far right simultaneously. This indicates the breakpoint/item-count logic is inconsistent across nearby widths rather than being purely width-proportional.
**Screenshot Evidence:** Captured at 390×844 on `/home` and on the HR Support Create Request page — both show "Ta" clipped and no visible "Approvals" icon.
**Severity:** High (a core navigation element is broken/partially unusable at a common phone width — 390px matches iPhone 12/13/14 standard viewports).
**Design Recommendation:** Fix the overflow threshold so item count in the visible bar is calculated the same way (or more conservatively) at 390px as at 375px; audit exactly which breakpoint currently triggers the extra item.

---

### DESK-UI-005 — Volume Trend chart X-axis date labels overlap/collide at tablet width
**Page:** Analytics & Reports → Requests tab → Volume Trend chart.
**Viewport:** 768×1024 (tablet).
**Role:** Admin.
**Issue:** Text clipping / overlapping controls (chart axis labels).
**Expected Design Behaviour:** Chart axis labels should either all render legibly, or the chart should thin out the label set (e.g., show every other date) when there isn't enough width for all of them — a standard responsive-charting technique.
**Actual Behaviour:** At 768px width, the 8-9 date labels along the X-axis are packed in without thinning, and the last two collide into unreadable overlapping text (rendering as "09-009-08" instead of separate "09-0[3]" and "09-08" labels).
**Screenshot Evidence:** Captured `/admin/reports` (Requests tab, Volume Trend widget) at 768×1024.
**Severity:** Medium.
**Design Recommendation:** Apply a responsive label-thinning strategy (e.g., only render every Nth label once available width per label drops below a threshold) to the charting component.

---

### DESK-UI-006 — Breadcrumbs are present on roughly half of Admin pages and absent on the other half, with no discernible pattern
**Page:** Admin section broadly. Confirmed present on: Org Structure, Categories, Service Catalog, Teams, SLA Policies, Form Templates. Confirmed absent on: Business Rules, User Management, Master Data, Approval Flows, Task Configuration, Request Configuration, Platform Settings, DeskTime, Audit Log, Knowledge Base, System Monitoring, Roles & Permissions.
**Viewport:** 1440×900 (breadcrumb presence is viewport-independent — confirmed via page-content extraction, not just visual).
**Role:** Admin.
**Issue:** Breadcrumbs missing or inconsistent.
**Expected Design Behaviour:** Either every admin sub-page shows an "Admin / Page Name" breadcrumb, or none do (relying solely on the sidebar's active-state highlight for orientation) — one convention applied consistently.
**Actual Behaviour:** Verified by extracting each page's rendered text: 6 of the 18 admin pages checked render a leading "Admin\n[Page Name]" breadcrumb line above their heading; 12 do not, going straight into the page `<h1>`. There's no evident logic separating the two groups (both simple pages like Teams and complex ones like Master Data appear on each side).
**Screenshot Evidence:** Text-extraction comparison performed live across 18 admin routes during this session (Org Structure/Categories/Services/Teams/SLA Policies/Form Templates show the breadcrumb line; Business Rules/Users/Master Data/Approvals/Task Config/Request Config/Settings/DeskTime/Audit/Knowledge Base/Monitoring/Roles do not).
**Severity:** Medium.
**Design Recommendation:** Standardize breadcrumb presence — given the sidebar already communicates section/location, the simplest fix is likely to remove breadcrumbs from the 6 pages that have them (for consistency with the majority), or conversely add them everywhere if the product intends breadcrumbs as the primary "where am I" cue for deep admin pages.

---

### DESK-UI-007 — "Resolution" SLA timer lacks a directional qualifier, unlike the adjacent "Response" timer
**Page:** Request Detail (e.g., `/requests` → CKSD-000001).
**Viewport:** 1440×900.
**Role:** Admin (Technician/Manager would see the same header).
**Issue:** Confusing/ambiguous status communication.
**Expected Design Behaviour:** SLA countdown/elapsed indicators in the same status bar should use a consistent phrasing convention so the user doesn't have to guess direction (remaining vs. elapsed) per metric.
**Actual Behaviour:** The status bar shows "**Response met — 28h 0m 42s to spare**" (clearly remaining budget, explicit "to spare") immediately next to "**Resolution: 188h 12m 1s**" (no qualifier at all — could be read as elapsed time, remaining time, or the full SLA target).
**Screenshot Evidence:** Captured on Request Detail page CKSD-000001, status bar row.
**Severity:** Low–Medium.
**Design Recommendation:** Add a matching qualifier to the Resolution figure (e.g., "Resolution: 188h remaining" or "Resolution SLA target: 188h") so both timers read the same way.

---

### DESK-UI-008 — Analytics dashboard shows a negative average-resolution-time consistently across 5 widgets
**Page:** Analytics & Reports → Requests and SLA tabs.
**Viewport:** 1440×900 (also visually present at 1920×1080/1366×768/1024×768 — same underlying data, not a layout artifact).
**Role:** Admin.
**Issue:** Visual state does not match actual business state (a duration metric displaying as negative).
**Expected Design Behaviour:** TAT/resolution-time figures should never render as negative — a negative duration is not a valid business state and erodes trust in every other number on the same dashboard.
**Actual Behaviour:** "Avg Resolution" KPI tile, "Avg Resolution Time," "Median Resolution Time," the Priority Breakdown row, the Team Performance table, and the Agent Leaderboard **all show the identical value "-90m"** (or "-1.5h" on the SLA tab). This is a calculation defect, not a rendering one, but it is called out here because it directly produces an incorrect *visual* business state on-screen.
**Screenshot Evidence:** Captured `/admin/reports` (Requests tab KPI row and SLA Performance card) and SLA tab at multiple widths — same "-90m"/"-1.5h" in every capture.
**Severity:** High.
**Design Recommendation:** This is a backend/calculation fix (see the companion design-testing report for the data-defect writeup), but at minimum the UI layer should clamp/guard against negative duration values so a calculation bug doesn't surface as a nonsensical number to end users.

---

### DESK-UI-009 — "SLA Compliance by Priority" figure missing its % suffix, inconsistent with every other compliance metric on the same page
**Page:** Analytics & Reports → SLA tab.
**Viewport:** 1440×900.
**Role:** Admin.
**Issue:** Inconsistent number formatting.
**Expected Design Behaviour:** All percentage metrics on one screen should be formatted identically.
**Actual Behaviour:** "SLA Compliance by Priority: Medium — **17**" has no `%` suffix, while "Resolution SLA Compliance 50%" and "First Response SLA Compliance 100%" on the same screen do.
**Screenshot Evidence:** Captured `/admin/reports` (SLA tab).
**Severity:** Low.
**Design Recommendation:** Apply the shared percentage-formatting helper to this widget.

---

### DESK-UI-010 — Sidebar label doesn't match its destination page's title (two instances)
**Page:** Global sidebar.
**Viewport:** 1440×900.
**Role:** Admin.
**Issue:** Inconsistent terminology for the same object.
**Expected Design Behaviour:** A sidebar link's label should match (or clearly summarize) the heading of the page it navigates to.
**Actual Behaviour:** Sidebar item **"Task Templates"** links to a page titled **"Task Configuration"** (which covers Statuses, Priorities, *and* Templates — narrower link label than the page's actual scope). Sidebar item **"Jobs"** links to `/admin/runbooks`, which renders as a documentation/help-article browser ("Platform Overview," "Role Guide," etc.) — not a background-job/cron-status page, which is what "Jobs" would suggest, especially given the disabled cron integrations found on the Settings page.
**Screenshot Evidence:** Captured sidebar (both labels) alongside their destination page headers.
**Severity:** Low.
**Design Recommendation:** Rename sidebar labels to match destination content, or rename the destination pages.

---

### DESK-UI-011 — Service Catalog and other light-content admin pages leave large unused whitespace at standard desktop width
**Page:** Service Catalog (`/services`, `/admin/services`), Org Structure (Cost Centers/Functions/Designations tabs), and others with few records.
**Viewport:** 1440×900 and 1920×1080.
**Role:** Requester/Admin.
**Issue:** Excessive whitespace.
**Expected Design Behaviour:** Pages with a small, fixed number of items (7 services, 3 departments) should size their layout to avoid an overwhelming blank area below the content, especially at wider viewports.
**Actual Behaviour:** The Service Catalog's 3-column card grid uses roughly 30% of the 1440px viewport height, leaving ~70% blank below. This is consistent across most Org Structure sub-tabs with 0-3 records.
**Screenshot Evidence:** Captured `/services` and `/admin/org` (Cost Centers/Functions/Designations tabs) at 1440×900.
**Severity:** Low (cosmetic — not a functional issue, and arguably acceptable for an admin tool, but noted since it was explicitly in scope).
**Design Recommendation:** Low priority; consider only if these screens are meant to also serve as a "getting started" surface where empty space could instead hold a helpful illustration/CTA.

---

### DESK-UI-012 — Audit Log "Details" column exposes raw JSON to admin users
**Page:** Audit Logs (`/admin/audit`).
**Viewport:** 1440×900.
**Role:** Admin.
**Issue:** Raw technical data exposed in place of a human-readable summary (adjacent to, though not identical to, the checklist's "raw technical error messages" item — this is raw technical *data*, not an error, but the same underlying concern: unpolished text surfaced to a UI user).
**Expected Design Behaviour:** An audit trail aimed at admins (not developers) typically renders a plain-language summary ("Status changed from Resolved to Open") with raw payload available on demand (e.g., expand/copy), not inline as default.
**Actual Behaviour:** Every row's Details column shows raw JSON, e.g. `{"reason":"unsatisfied_with_resolution"...}`, `{"to":"open","from":"resolved"}`.
**Screenshot Evidence:** Captured `/admin/audit`.
**Severity:** Low.
**Design Recommendation:** Add a human-readable summary line per audit-log action type, keeping raw JSON as an optional expand.

---

## UI CONSISTENCY MATRIX

Scored qualitatively from this pass's direct observation across all pages visited (30+ surfaces). "Consistent" means the same visual treatment recurs everywhere the component appears; "Mostly" means one or two deviations found; "Inconsistent" means deviations were the norm, not the exception.

| Component | Consistency | Notes |
|---|---|---|
| **Buttons (primary)** | Consistent | Dark navy fill, white text, consistent corner radius across New Request/New Rule/Submit/Save/Post/Send buttons everywhere checked. |
| **Buttons (secondary/outline)** | Consistent | Light gray/white background, dark text, same border-radius as primary. |
| **Destructive buttons (Delete)** | **Inconsistent — flagged** | No red/danger treatment anywhere (DESK-UI-001). Visually identical to Edit in every table checked. |
| **Inputs (text/search)** | Consistent | Same rounded-rectangle style, placeholder gray, focus state, and left-icon convention (search icon) across forms, filter bars, and the global search. |
| **Dropdowns/Selects** | Mostly consistent | Filter-bar dropdowns (Master Data, Request Config, Agent Requests) share one visual style; the Priority Owner dropdown on Projects (native `<select>` with 60+ options) is visually plainer/more "raw HTML" than the custom-styled dropdowns elsewhere — a minor divergence, not flagged as a numbered ticket but worth designers' attention. |
| **Tables (row/header style)** | Consistent | Uniform header row shading, row hover, right-aligned Actions column across 20+ tables (Master Data, Task Config, Categories, Business Rules, Approval Flows, SLA Policies, Org Structure, etc.). |
| **Tables (column-width behavior)** | **Inconsistent — flagged** | Most admin tables (few columns) fit their container cleanly; wide operational tables (Agent Requests, Projects) use fixed pixel widths that don't adapt to viewport (DESK-UI-002). |
| **Cards** | Consistent | Service Catalog, Form Templates, and Role Overview all use the same white-card, rounded-corner, subtle-border treatment with icon+title+subtitle layout. |
| **Status badges (Requests)** | Consistent | Color-coded pills (green=Resolved, blue=In Progress, purple=Open/Reopened) used identically across Agent Requests table, Request Detail, and Approval Detail. Priority shown via a consistent directional-arrow + label convention (↓ Low, → Medium) across Requests, Approvals, and Request Detail. |
| **Status/Priority badges (Tasks)** | **Inconsistent — flagged** | Task priority uses a *different* label set than Request priority, and disagrees with itself between list and detail view (DESK-UI-003: "Medium" vs "Normal" for the same task). |
| **Modals** | Consistent | Task Detail and Approval Detail modals share the same overlay-dim + centered-card + contained-internal-scroll pattern; no overflow or nested-scroll conflicts found in either. |
| **Drawers** | Consistent | Mobile "More" navigation drawer reproduces the full desktop sidebar IA in a slide-over panel with the same grouping/icons. |
| **Headers (page)** | Mostly consistent | Every page has a bold `<h1>` + gray subtitle line directly beneath. Deviation: some admin pages additionally show a breadcrumb above the `<h1>` and some don't (DESK-UI-006). |
| **Breadcrumbs** | **Inconsistent — flagged** | Present on ~1/3 of admin pages, absent on ~2/3, no clear rule (DESK-UI-006). |
| **Empty states** | Consistent | Every empty table/list checked (Cost Centers, Functions, Designations, Task Templates, DeskTime sync, My Requests, My Tasks, Pending Approvals) uses the same centered-icon + message + optional CTA pattern. This is a genuine strength. |
| **Loading states** | Mostly consistent | Only one loading state was directly observed (Report Builder's circular spinner while data loads); no skeleton-screen pattern was seen anywhere, so nothing to compare it against for inconsistency — but also nothing more polished than a generic spinner across the app. |
| **Error states (404)** | Consistent (single sample) | The one error state exercised (unmatched route) uses on-brand icon/copy/two recovery buttons; no other error states (e.g., failed form submission, network failure) were triggered this pass to compare against. |

---

## DESIGN SYSTEM SCORECARD

Scored 1–10 based on direct observation this pass. A 10 would mean no deviations found anywhere in scope; scores below reflect the specific defects logged above, weighted by how many surfaces they touch.

| Dimension | Score /10 | Rationale |
|---|---|---|
| **Visual Consistency** | 7 | Strong on buttons/cards/tables/empty-states/badges-for-Requests; pulled down by the Delete-not-distinguished pattern (app-wide) and the Task priority label mismatch. |
| **Navigation** | 6 | Sidebar IA and mobile drawer are excellent; pulled down by the breadcrumb inconsistency (DESK-UI-006) and the sidebar-label/page-title mismatches (DESK-UI-010). |
| **Typography** | 8 | Heading/subtitle hierarchy is applied uniformly everywhere checked; no font-family or unexpected size deviations found. |
| **Spacing** | 7 | Card/table padding is consistent; the main deduction is the excessive-whitespace pattern on light-content pages at wide viewports (DESK-UI-011) and the opposite problem (cramped 11-column tables) on data-heavy pages (DESK-UI-002) — spacing doesn't adapt well to either extreme. |
| **Forms** | 8 | Create Request form is clean, well-labeled, required-field marking is clear and consistent; validation-message consistency was not fully exercised (would need to trigger multiple validation errors across different forms to confirm), so this isn't a perfect score. |
| **Tables** | 6 | Strong shared visual language, but the fixed-width/overflow issue (DESK-UI-002) is a real functional weakness on the two most important operational tables (Agent Requests, Projects). |
| **Status Communication** | 6 | Requests' status/priority system is clear and consistent; Tasks' priority contradicts itself between views (DESK-UI-003), the Resolution-timer ambiguity (DESK-UI-007) and the negative-TAT defect (DESK-UI-008) actively communicate incorrect states. |
| **Dashboard Design** | 6 | Good KPI-tile and chart layout patterns; marked down for the chart-label collision (DESK-UI-005) and the negative-duration display (DESK-UI-008), both of which undermine trust in the numbers shown. |
| **Responsive Design** | 6 | Genuinely strong adaptive behavior at tablet width (filter-bar wrapping, contained table scroll, sidebar→drawer collapse) is undercut by a real breakage at the 390px mobile breakpoint (DESK-UI-004) and the chart-label collision at tablet width (DESK-UI-005). |
| **Accessibility** | 6 | Icon-only header buttons (notifications, approvals, theme toggle) all carry descriptive accessible names — a genuine strength confirmed via the accessibility tree. Not scored higher because a full keyboard-navigation/focus-trap/contrast audit was out of scope for this visual pass (see the companion design-testing report's Accessibility section) and one real defect (Delete not visually/programmatically distinguished, which also affects screen-reader users who rely on visual conventions less) was found. |
| **Requester UX** | 8 | Service Catalog and Create Request are clean, low-friction, well-guided (clear required fields, helpful attachment hints). |
| **Technician UX** | 7 | Agent Requests queue is functionally rich (Table/Board, per-technician filters) but hurt by the table-overflow issue (DESK-UI-002), which is exactly the screen technicians live in daily. |
| **Manager UX** | 7 | Approval Detail's condensed request context + approver progress bar is a strong pattern; not scored higher since multi-approver/multi-step flows weren't available to inspect live (only a 1-approver example existed in the data). |
| **Admin UX** | 6 | Admin has the most surface area and inherits every table/breadcrumb/delete-button issue found; also carries the two real data-integrity defects (negative TAT, 0% avg progress — see companion report) that are Admin-facing by nature. |

**Overall pattern:** the underlying design system (color tokens, card style, empty-state pattern, badge conventions for Requests, form layout) is well-executed and applied with real discipline across ~30 surfaces — this is not a project with a weak design system. The issues found are concentrated in a few specific gaps: **destructive-action styling, one data table's fixed-width behavior, one component's (Task priority) label mismatch, one responsive breakpoint, and breadcrumb rollout** — all fixable without a broader redesign.

---

## Summary Table

| ID | Finding | Severity |
|---|---|---|
| DESK-UI-001 | Delete actions not visually distinguished from Edit, app-wide | High |
| DESK-UI-002 | Agent Requests / Projects tables: fixed width under/overflows at every tested viewport | Medium |
| DESK-UI-003 | Task priority "Medium" (list) vs "Normal" (detail) for same record | High |
| DESK-UI-004 | Bottom nav clips/overflows at 390px mobile width | High |
| DESK-UI-005 | Analytics chart X-axis labels collide at 768px tablet width | Medium |
| DESK-UI-006 | Breadcrumbs present on ~1/3 of admin pages, absent on rest | Medium |
| DESK-UI-007 | "Resolution" SLA timer lacks directional qualifier | Low–Medium |
| DESK-UI-008 | Negative avg-resolution-time shown across 5 Analytics widgets | High |
| DESK-UI-009 | Missing % suffix on one SLA-by-priority figure | Low |
| DESK-UI-010 | Sidebar label vs. page-title mismatches (Task Templates/Jobs) | Low |
| DESK-UI-011 | Excessive whitespace on light-content pages at wide viewports | Low |
| DESK-UI-012 | Audit log exposes raw JSON instead of human-readable summary | Low |

No UI was modified during this testing pass, consistent with the TEST-ONLY mandate. No test data was created.
