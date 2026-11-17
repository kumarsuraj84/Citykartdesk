# 15 — Defect Register and Fix Log

Severity: **P0** blocker · **P1** high · **P2** medium · **P3** low · **P4** information.
"Fixed locally" = code or test changed in the working tree, **not committed**. Every product fix has a regression test; where written first it is marked **fail-first** (it failed on the old code, then passed).
Totals: **0 P0. 17 items fixed locally (3 P2, 10 P3, 4 P4 test/data items). Still open: 1 P1, 10 P2, 21 P3/P4 product or security items, plus 4 process notes.**

## A. Fixed locally (with regression evidence)
| ID | Sev | Defect | Root cause | Fix (files) | Regression test and retest | Residual |
|---|---|---|---|---|---|---|
| UI-001 | P2 | Buttons/date boxes/selects with no accessible name on 10 admin screens (WCAG 4.1.2) | missing `aria-label` | `AuditLogClient`, `admin/reports/page`, `WrongTechnicianSection`, `InboxList`, `ReclassifyButton`, `WorkflowBuilderClient`, `MasterDataClient`, `TaskConfigClient`, `TaskTemplatesClient`, `DetailDrawer` | browser `ui/ui-a11y-regress.mjs` 20/21 pages failing → 21/21 clean; `accessibility-names.test.ts` | none |
| UI-002 | P3 | Public pages had no `main` landmark | no layout | new `app/(auth)/layout.tsx`, `app/csat/layout.tsx`, `app/approve/layout.tsx` | regress + unit guard | none |
| UI-003 | P2 | Sideways-scrolling tables unreachable by keyboard | no focus target | `zoho/*`, `Audit/Event/SystemLogClient`, `TaskTable`, `AnalyticsDashboard` | regress (360 px) + unit guard | none |
| UI-004 | P3 | Details slide-over: unnamed close button, empty heading, hidden controls focusable | always mounted off-screen | `DetailDrawer` (named dialog, `inert` when closed) | regress | none |
| UI-005 | P3 | Run-books: second `main`, no heading; Tasks: no heading | markup | `RunbooksClient`, `tasks/page` | regress + unit guard | none |
| UI-006 | P3 | Pivot report field list: duplicate React key (`form:f_subject`) → possible duplicated/dropped picker rows | any form template used by two or more services (normal: in the audit data 4 services share `f_subject`/`f_desc`) produced one picker entry per service with the same key | `lib/queries/reporting.ts` (`toReportFields` de-duplicates, shared field named without a service prefix) | `report-form-field-keys.test.ts` **fail-first** (2 of 4 failed) | check live data for shared field ids (16: D-01) |
| UI-008 | P2 | Wrong-password message not announced to screen readers (WCAG 4.1.3) | error box without `role="alert"` | `login`, `forgot-password`, `reset-password` pages | keyboard check K03 failed → passes; unit guard | none |
| UI-009 | P3 | No "skip to main content" link (WCAG 2.4.1) | missing | `AppShell` (skip link + `id="main-content"`) | K04 failed → passes; unit guard (failed first) | none |
| UI-010 | P3 | Pop-ups with autofocus (Invite User…) lose the keyboard position on close | the helper read the focused element after autofocus had already moved it | `components/ui/useModalA11y.ts` (remembers the last control focused outside any pop-up) | `modal-focus-return.test.tsx` **fail-first** (2 of 2); K05 failed → passes | none |
| UX-001 | P3 | **Owner report:** in a ticket conversation the **Templates** list stayed open when clicking outside; it closed only by clicking Templates again | no outside-click handler | `components/requests/CommentForm.tsx` (closes on outside click and Escape) | `comment-form-template-and-paste.test.tsx` **fail-first** (2 of 4 tests failed on the old code); checked in the real browser | none |
| UX-002 | P3 | **Owner report:** copying a file (or a screenshot) and pressing **Ctrl+V** in the conversation box did not attach it; only the Attach button worked | no paste handler | new `lib/attachments/paste.ts`; `CommentForm.tsx` (paste and drag-and-drop attach, same validation, 25 MB limit and file-type list as the Attach button; screenshots named `screenshot-YYYYMMDD-HHMMSS.png`; text copied from Excel/Word still pastes as text) | `paste-attachments.test.ts` (6) + `comment-form-template-and-paste.test.tsx` (3 paste/drop tests **fail-first**); checked in the real browser | Safari paste of Finder files untested (13) |
| F-001…F-005 | P4 | Five VAPT tests no longer matched deliberate behaviour (20 API entities incl. `ac_units`; store place not filled from AC rows; problem line names ≤ 20 stores; vendor test store needs a region) | stale tests | `tests/vapt/70`, `34`, `72`, `36` | re-run: all pass | none |
| F-006 | P3 | Real-looking staff e-mail addresses (one with a mistyped domain) in the committed demo sheets | copied from real sheets | `audit-2026-10/demo/sheets/demo-ac.csv`, `demo-genset.csv` replaced by `@demo-citykart.test` | search shows none remain | none |

## B. Open — product, security and scale (need an owner decision or a release branch)
| ID | Sev | Finding | Where in the reports |
|---|---|---|---|
| V-001 | **P1** | Next.js 16.3.8: critical advisories (not reachable as configured; DoS advisory cannot be ruled out). Upgrade to ≥ 16.4.6 | 10 |
| PERF-001 | P2 | Executive dashboard sends **18.6 MB** (up to 30,000 tickets, a hard cap with an on-screen notice) in one page; 6–24 s under load at 100k tickets | 09 |
| PERF-002 | P2 | Admin Reports page: 1.1 s at 100k, **13–16 s at 500k** tickets for one user, 60 s time-outs under load; technician manager Home 2.3 s at 500k | 09 |
| PERF-003 | P3 | Admin > Users ships all 684 people in one 2.4 MB page | 09 |
| PERF-004 | P2 | Scheduler cost 12.5 ms per overdue open ticket per rule (20,000 → 4 min) | 11 |
| PERF-005 | P3 | One Node process is the ceiling: ~30 requests/s at 3k tickets, ~15/s at 100k on a very fast PC | 09 |
| V-002/3/4 | P2/P2/P3 | zod, nodemailer/mailparser, sanitize-html advisories | 10 |
| V-006/7/8 | P2/P3/P2 | CSP report-only with unsafe-inline/eval; session cookie readable by script; no TLS | 10 |
| V-009 | P3 | `app_settings` readable by every signed-in user including vendors | 10 |
| V-010 / SOC-G3 | P2 | `TRUSTED_PROXY_HOPS` not set: no caller address in the log, per-address limits off (live status unknown) | 10, 14 |
| SOC-G1/G2 | P2 | Forbidden attempts and rejected machine calls are not logged | 14 |
| SOC-G4/G5/G7 | P3 | Actor missing on service-key row changes; alert delivery untested; no stated retention period | 14 |
| ALERT-001 | P2 | **Found 2026-11-17 while testing the Zoho transfer:** alert rules that notify **by role** (for example the "unassigned request" alert) find **nobody** to notify: `app/api/alerts/run/route.ts` reads `profiles.email`, a column that does not exist, so the read fails and the recipient list is empty. Not changed here, because fixing it would suddenly start sending alerts on live (owner decision) | 16 (decision 11) |
| QA-001…004, H-4 | P2–P4 | **Zoho transfer QA (stage 4, report 19):** QA-001 (P2) a ticket stayed locked after a server stopped half way — **fixed**; QA-002 (P3) confirm boxes did not take keyboard focus — **fixed**; QA-003 (P3) low contrast "N open" — **fixed**; QA-004 (P4) unnamed navigation landmarks app-wide — **fixed**; H-4 (P4) a WhatsApp test is not re-runnable | 19 |
| MAIL-001 | P4 (owner decision) | A ticket moved from Zoho whose requester was not in CK Desk gets an inactive profile, but CK Desk still tries to mail that address on every comment / status change | 19 (UAT H) |
| REL-001 | P3 | At-most-once rule claims can silently lose one action on a crash | 11, 12 |
| REL-002/003 | P3/P4 | 20–22 s waits when a dependency hangs; HTTP 500 instead of 503 during DB outage | 12 |
| V-011 | P3 | Zoho "not connected" message shows server path to managers | 10 |
| UI-007/011/012/013/014 | P3/P4 | Nested buttons in calendar cell; contrast near-misses; 24 px target size; assistant dock Escape; dev-only React warning | 05 |
| V-005 / V-012 | P3/P4 | Transitive/dev-only advisories; unused default SVGs | 10 |
| D-02 | P3 | "Notify managers" reaches every manager | 11 |

## C. Process / hygiene
| ID | Sev | Finding | Status |
|---|---|---|---|
| H-1 | P4 | Test runs, dev server and production build rewrite tracked files (`AGENTS.md`, `audit-2026-10/evidence/*`, `tsconfig.json`) | restored by `git checkout` after each run (**re-check before any commit**) |
| H-2 | P4 | Stray folder `D:\ANKUR%20AI PROJECTS` from my early smoke screenshots; deletion was refused by the safety check | owner may delete |
| H-3 | P4 | `npm run verify` runs unit tests only | add the other three layers to the release checklist |
| F-007 | P3 | The local `.next/standalone` build bundles a 555-row staff e-mail CSV (`local-testing/`); the deploy script has no content guard; **live was not checked** | owner: confirm live does not carry it (needs an explicit read-only check) |
| F-008 | P4 | Test-data leftovers in the audit database (UAT tickets, synthetic organisations removed) | audit database is disposable; reset it |
