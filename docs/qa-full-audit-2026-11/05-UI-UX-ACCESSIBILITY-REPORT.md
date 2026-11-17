# 05 — UI, UX and Accessibility Report

Audit run: 2026-11-16, local only. App under test: the audit copy of Citykart Desk (port 3310, development mode) on the isolated audit stack, with made-up people and made-up data.
Business sign-off on look and feel: **pending owner/business sign-off**.

## Plain summary

- Every main screen was opened as 9 kinds of person (store requester, head-office requester, technician, technician manager, approver, administrator, vendor technician, vendor manager, and someone not signed in) at 6 screen widths (360, 390, 768, 1024, 1366, 1920).
- **564 page views in Chrome and 201 in Edge: no screen failed to load, no screen scrolled sideways, no screen showed an error page.**
- An automatic accessibility scanner (axe-core 4.12.1, WCAG 2.0/2.1/2.2 levels A and AA, plus best-practice) found real problems. Most were small labelling gaps on admin screens. **All the clear-cut ones were fixed locally and re-tested (21 of 21 pages clean).** A few are design decisions and are left for the owner.
- Keyboard-only use works for sign-in, pop-up windows and focus order. Two real gaps were found and fixed: a missing "skip to content" link and an unannounced sign-in error.

## What was tested

| Area | How | Result |
|---|---|---|
| Page loads, no error page | 9 personas x 63 distinct pages x 6 widths (Chrome 157). Edge 157: reduced matrix (3 widths, every 2nd admin page). | **PASS** 564/564 and 201/201 |
| Responsive layout | `scrollWidth > innerWidth` on every page view; plus 28 screenshots at 360/768/1366/1920 inspected | **PASS** 0 sideways-scroll cases. 320 px (400 % zoom) also PASS on 4 pages. |
| Text size/spacing | 200 % text, WCAG text-spacing overrides on Home | **PASS** no page overflow; 1 control clips its text with an ellipsis (cosmetic) |
| Accessibility scan | axe-core on every page view | See findings below. Before fixes: 90 critical + 345 serious page-view instances (Chrome). |
| Keyboard | K01-K11 scripted checks, Chrome and Edge | **PASS** 11/11 not failing (after fixes), 5 NOTES |
| Dark theme | Contrast scan with OS dark preference | The app has its own light/dark switch and does not follow the OS setting. No contrast issues found in the OS-dark check. NOTE only. |
| Real screen reader (NVDA/JAWS/VoiceOver) | not available on this PC | **NOT RUN** — only automated checks plus roles/labels/names were verified |
| Colour-blind / low vision simulation | not run | **NOT RUN** |

Evidence: `evidence/ui/ui-audit-chrome.json`, `ui-audit-edge.json`, `ui-keyboard-*.json`, `a11y-regress-BEFORE.log` → `a11y-regress-AFTER-3.log`, `screens/` (28 images).

## Findings and what was done

| ID | Severity | Finding | Status |
|---|---|---|---|
| UI-001 | P2 | Buttons, date boxes and drop-downs with no name for a screen reader on 10 admin screens (Reports date range, Audit log filters, Stuck tickets, Intake inbox sort, Intake settings, Approval workflows expand arrow (802 instances), Master data / Task settings up-down arrows, colour swatches, on/off switches, delete icons). WCAG 4.1.2 (A). | **FIXED locally**, verified by browser regression test + static guards |
| UI-002 | P3 | Public pages (sign in, forgot/reset password, rating link, e-mail approval link) had no `main` landmark. | **FIXED locally** (3 small layout files) |
| UI-003 | P2 | Tables that scroll sideways on a phone could not be reached with the keyboard (Zoho pages, Audit/Event/System log, Tasks, dashboard widget). WCAG 2.1.1 (A). | **FIXED locally** (focusable named region) |
| UI-004 | P3 | The "details" slide-over on dashboards had an unnamed close button, an empty heading when closed, and its hidden controls could still be tabbed to. | **FIXED locally** (named dialog, `inert` when closed) |
| UI-005 | P3 | Run-books page had a second `main` landmark and no page heading; Tasks page had no page heading. | **FIXED locally** |
| UI-006 | P3 | Pivot report field list: "two children with the same key" (`form:f_subject`, `form:f_desc`). Cause: two services whose forms use the same field id produce two entries with one key. | **FIXED locally** with a failing-first unit test (4 tests). Owner check recommended on live data (see 16). |
| UI-008 | P2 | A wrong password showed "Invalid login credentials" but a screen reader was not told (no `role="alert"`). WCAG 4.1.3 (AA). Same for forgot/reset password errors. | **FIXED locally** |
| UI-009 | P3 | No "skip to main content" link (the page has a top bar, search and a menu before the content). WCAG 2.4.1 (A). | **FIXED locally** |
| UI-010 | P3 | Pop-ups whose first box has autofocus (Invite User) lost the keyboard position on close: focus went to the top of the page instead of back to the button. | **FIXED locally** in the shared pop-up helper, failing-first unit test (2 tests) |
| UI-007 | P3 | The calendar day cell on the Executive dashboard is a button that contains two more buttons (R and F). axe: nested-interactive. It is a deliberate design (comment in the code). | **OPEN — design decision** (owner) |
| UI-011 | P3 | Colour contrast slightly under 4.5:1 on a few small tinted badges and alert text (for example 3.2:1 initials chip on the Notifications page, 4.4:1 and 3.4:1 on the technician Home alert strip). | **OPEN — design decision** |
| UI-012 | P3 | 24 px minimum touch-target rule (WCAG 2.2) is missed by some small controls (sidebar group labels, tiny arrows). | **OPEN — design decision** |
| UI-013 | P3 | "Ask CK Desk" assistant dock: not a modal, Escape does not close it. Acceptable for a chat dock, but a note for the owner. | **OPEN — observation** |
| UI-014 | P4 | React development warning "script tag while rendering" from the theme-start script in the root layout (development mode only). | **OPEN — observation** (not seen as a failure; check on the production build in the compatibility report) |

Not defects (test artefacts, recorded so nobody chases them): "colour contrast" at 1920 px on many pages was the mouse pointer resting on a menu heading in the middle of its hover colour change.

## Fix evidence

- Browser regression `ui/ui-a11y-regress.mjs`: **before 1/21 pages clean (20 failing), after 21/21 clean**. Logs: `evidence/ui/a11y-regress-BEFORE.log`, `-AFTER-1..3.log`.
- Unit tests added: `tests/unit/accessibility-names.test.ts` (+7 tests), `tests/unit/report-form-field-keys.test.ts` (4), `tests/unit/modal-focus-return.test.tsx` (2). The report-field and pop-up tests were written first and **failed before the fix** (2 of 4 and 2 of 2).
- `tsc` 0 errors, `eslint` clean on every changed file.

## Not done / limits

- Real assistive technology, high-contrast mode, Windows magnifier and voice control: **NOT RUN**.
- Only synthetic data was shown on screen (the development database with real staff names was never used).
- Look-and-feel approval and copy review are business decisions: **pending owner/business sign-off**.
