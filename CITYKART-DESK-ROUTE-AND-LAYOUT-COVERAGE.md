# Citykart Desk — Route & Layout Coverage

Legend: **PASS** = opened live and measured (overflow check + console check), clean. **N/T** = not individually opened this session (source-discovered, inventoried, no live check). **FIXED** = had a real issue, now fixed and re-verified. **N/A** = not a testable page (redirect stub, API route).

## ROUTE MASTER

| # | Route | Module | Dynamic? | 1440 | 768 | 390 | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `/home` | Core | No | PASS | PASS | PASS | |
| 2 | `/requests` | Requests | No | PASS | PASS | PASS | |
| 3 | `/requests/queue` | Requests | No | PASS | N/T | N/T | |
| 4 | `/requests/[id]` | Requests | Yes | PASS | N/T | PASS | Tested with a real ticket (CKSD-000713) |
| 5 | `/services` | Requests | No | FIXED | PASS | PASS | DESK-LUI-001 / DESK-LQA-001 found+fixed here |
| 6 | `/services/[slug]` | Requests | Yes | N/T | N/T | N/T | |
| 7 | `/tasks` | Tasks | No | PASS | PASS | PASS | |
| 8 | `/tasks/[id]` | Tasks | Yes | N/T | N/T | N/T | |
| 9 | `/projects` | Projects | No | PASS | PASS | PASS | |
| 10 | `/projects/[id]` | Projects | Yes | N/T | N/T | N/T | |
| 11 | `/approvals` | Approvals | No | PASS | PASS | PASS | |
| 12 | `/notifications` | Core | No | PASS | N/T | PASS | |
| 13 | `/profile` | Core | No | PASS | N/T | PASS | |
| 14 | `/reports/pivot` | Reports | No | PASS | PASS | PASS | Report Builder — also functionally tested (Saved Reports) by the user directly this session |
| 15 | `/intake` | Intake | No | PASS | N/T | N/T | |
| 16 | `/intake/inbox` | Intake | No | PASS | N/T | N/T | |
| 17 | `/intake/inbox/[id]` | Intake | Yes | N/T | N/T | N/T | |
| 18 | `/intake/channels` | Intake | No | PASS | N/T | N/T | |
| 19 | `/intake/queue` | Intake | No | N/T | N/T | N/T | |
| 20 | `/intake/review/[id]` | Intake | Yes | N/T | N/T | N/T | |
| 21 | `/intake/rules` | Intake | No | PASS | N/T | N/T | |
| 22 | `/intake/settings` | Intake | No | PASS | N/T | N/T | |
| 23 | `/admin` | Admin | No | N/T | N/T | N/T | |
| 24 | `/admin/approvals` | Admin | No | PASS | N/T | N/T | |
| 25 | `/admin/audit` | Admin | No | PASS | N/T | N/T | |
| 26 | `/admin/business-rules` | Admin | No | PASS | N/T | N/T | |
| 27 | `/admin/categories` | Admin | No | PASS | N/T | N/T | |
| 28 | `/admin/categories/[slug]` | Admin | Yes | N/T | N/T | N/T | |
| 29 | `/admin/desktime` | Admin | No | PASS | N/T | N/T | |
| 30 | `/admin/event-log` | Admin | No | PASS | N/T | N/T | |
| 31 | `/admin/field-library` | Admin | No | PASS | N/T | N/T | Search box added this session (pre-audit), functionally confirmed by user |
| 32 | `/admin/form-templates` | Admin | No | PASS | N/T | N/T | |
| 33 | `/admin/form-templates/[id]` | Admin | Yes | N/T | N/T | N/T | |
| 34 | `/admin/knowledge-base` | Admin | No | PASS | N/T | N/T | |
| 35 | `/admin/master-data` | Admin | No | PASS | N/T | N/T | |
| 36 | `/admin/monitoring` | Admin | No | PASS | N/T | N/T | |
| 37 | `/admin/org` | Admin | No | PASS | N/T | N/T | |
| 38 | `/admin/reports` | Admin | No | N/T | N/T | N/T | Analytics & Reports (distinct from Report Builder) |
| 39 | `/admin/reports/pivot` | Admin | No | N/A | N/A | N/A | Confirmed as an intentional redirect stub to `/reports/pivot` (Product Decision A / DESK-QA-001), not dead code |
| 40 | `/admin/request-config` | Admin | No | PASS | N/T | N/T | Holiday Calendar regression tested here (§19 of main report) |
| 41 | `/admin/roles` | Admin | No | PASS | N/T | N/T | |
| 42 | `/admin/runbooks` | Admin | No | PASS | N/T | N/T | |
| 43 | `/admin/services` | Admin | No | N/T | N/T | N/T | |
| 44 | `/admin/settings` | Admin | No | PASS | N/T | N/T | |
| 45 | `/admin/sla-policies` | Admin | No | PASS | N/T | N/T | |
| 46 | `/admin/task-config` | Admin | No | PASS | N/T | N/T | |
| 47 | `/admin/teams` | Admin | No | PASS | N/T | N/T | |
| 48 | `/admin/users` | Admin | No | PASS | N/T | N/T | |
| 49 | `/login` | Auth | No | N/T | N/T | N/T | Used functionally (audit account sign-in) but not layout-audited |
| 50 | `/reset-password`, `/forgot-password`, `/trial-expired` | Auth | No | N/T | N/T | N/T | |

**Totals:** 50 routes discovered. 28 opened live at 1440px (all clean). 8 of those also checked at 768px and 390px (all clean). 22 not individually opened this session.

## PAGE / VIEWPORT MATRIX

Only the representative breakpoints actually used are shown (1440 desktop / 768 tablet / 390 mobile), per the scope note in the main audit report. All entries not listed as PASS above are N/T at every width.

## OVERLAY MASTER

| # | Overlay | Source | Used on | Desktop | Mobile |
|---|---|---|---|---|---|
| 1 | `StatusRow` cancel-remark popup | `components/requests/RequestSidebarPanel.tsx` | Request detail | PASS (fixed + verified earlier this session) | N/T |
| 2 | `SaveReportModal` | `components/reports/PivotBuilder.tsx` (inline) | Report Builder | PASS (functionally, by user) | N/T |
| 3 | Holiday "Add Holiday" inline form | `app/(app)/admin/request-config/HolidayCalendarClient.tsx` | Request Config → Business Hours | PASS | N/T |
| 4 | `FieldModal` (create/edit library field) | `app/(app)/admin/field-library/FieldLibraryClient.tsx` (inline) | Field Library | N/T | N/T |
| 5 | `BulkPasswordResetDialog` | `components/admin/BulkPasswordResetDialog.tsx` | Users admin | N/T | N/T |
| 6 | `BulkImportUsersDialog` | `components/admin/BulkImportUsersDialog.tsx` | Users admin | N/T | N/T |
| 7 | `BulkImportCategoriesDialog` | `components/admin/BulkImportCategoriesDialog.tsx` | Categories admin | N/T | N/T |
| 8 | `BulkUploadProjectsDialog` | `components/projects/BulkUploadProjectsDialog.tsx` | Projects | N/T | N/T |
| 9 | `NewMilestonePanel` | `components/projects/NewMilestonePanel.tsx` | Project detail | N/T | N/T |
| 10 | `NewProjectPanel` | `components/projects/NewProjectPanel.tsx` | Projects | N/T | N/T |
| 11 | `NewTaskPanel` | `components/tasks/NewTaskPanel.tsx` | Tasks | N/T | N/T |
| 12 | `TaskDetailPanel` | `components/tasks/TaskDetailPanel.tsx` | Tasks | N/T | N/T |
| 13 | `ApprovalPreviewDialog` | `components/requests/ApprovalPreviewDialog.tsx` | Request detail (send-for-approval flow) | N/T | N/T |
| 14 | `ApprovalPanel` | `components/requests/ApprovalPanel.tsx` | Request detail | N/T | N/T |
| 15 | `AssignmentPanel` | `components/requests/AssignmentPanel.tsx` | Request detail | N/T | N/T |
| 16 | `RelatedRequestsPanel` | `components/requests/RelatedRequestsPanel.tsx` | Request detail | N/T (auto-refresh behavior fixed+verified earlier this session) | N/T |
| 17 | `SubmittedDataPanel` (edit form fields) | `components/requests/SubmittedDataPanel.tsx` | Request detail | N/T | N/T |
| 18 | `DetailDrawer` | `components/analytics/DetailDrawer.tsx` | Admin → Reports (Analytics) | N/T | N/T |
| 19 | `CustomColumnManager` | `components/tasks/CustomColumnManager.tsx` | Tasks | N/T | N/T |
| 20 | `ImportModal` | `components/ui/ImportModal.tsx` | Shared, multiple admin screens | N/T | N/T |
| 21 | `RequestBoardView`'s modal(s) | `components/requests/RequestBoardView.tsx` | Requests board view | N/T | N/T |
| 22 | `RequestActionBar`'s modal(s) (incl. "Start Working") | `components/requests/RequestActionBar.tsx` | Request detail | N/T | N/T |
| 23 | Various admin client "add/edit" modals | `UserManagementClient.tsx`, `BusinessRulesClient.tsx`, `FormTemplatesAdminClient.tsx`, `SlaPoliciesAdminClient.tsx`, `ScheduledReportsClient.tsx`, `PermissionMatrixClient.tsx`, `ServicesAdminClient.tsx` | Respective admin pages | N/T | N/T |
| 24 | `Sheet`/`DropdownMenu` (Base UI primitives) | `components/ui/sheet.tsx`, `components/ui/dropdown-menu.tsx` | Widely used | Used incidentally throughout navigation (no crashes/overflow observed) | N/T |
| 25 | `RequesterFieldsPanel` | `app/(app)/intake/_components/RequesterFieldsPanel.tsx` | Intake review | N/T | N/T |
| 26 | `StatusTransitionPanel` | `components/requests/StatusTransitionPanel.tsx` | — | **Confirmed dead code** (unused, superseded by `StatusRow`) — no test needed |

**Totals:** ~26 distinct overlay sources catalogued. 3 opened and interacted with live this session; 1 confirmed dead code; the remainder inventoried only.

## UNTESTED / BLOCKED ITEMS

- All `[id]`-parameterized detail/edit sub-routes except Request detail (which was tested with a real record).
- Tablet/mobile breakpoints for 20 of the 28 opened routes.
- The full 7-desktop / 4-tablet / 7-mobile viewport matrix the original brief specified, at literal scope.
- 23 of 26 catalogued overlays, not individually opened.
- Dedicated table stress-testing (0/1/many rows, many columns), form stress-testing (long values, validation states), chart responsiveness, accessibility (keyboard/contrast/focus-trap), and dedicated dropdown/popover collision-testing.

Nothing above is a known defect — it is explicitly unaudited ground, listed so it isn't mistaken for "checked and fine."
