# 18 — Git Diff Summary and Proposed Release Plan

> **Nothing below has been executed.** No commit, push, merge, deploy, live restart, production migration, real mail or WhatsApp message was made. This is a proposal for you to review.

## Starting point
Branch `main` = `origin/main` = `6a160dd`. The working tree contained, before the audit, 6 modified test/demo files (listed as "B" below) and nothing else. **No database migration was added** (none is needed for any fix).

## Exact changed-file inventory (working tree, uncommitted)
Counts at the end of the audit: 29 tracked files modified, 8 new source/test files, plus the audit evidence folder.

### A. Product changes — accessibility and UX (proposed branch `qa-2026-11-a11y-ux-fixes`)
| File | Change |
|---|---|
| `app/(auth)/layout.tsx` (new), `app/csat/layout.tsx` (new), `app/approve/layout.tsx` (new) | one `<main>` landmark on public pages |
| `app/(auth)/login/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx` | `role="alert"` on error boxes |
| `components/layout/AppShell.tsx` | skip link + `id="main-content"` |
| `components/ui/useModalA11y.ts` | focus returns to the opener even when the first box has autofocus |
| `components/analytics/DetailDrawer.tsx` | named dialog, `inert` when closed, named close button |
| `components/tasks/TaskTable.tsx`, `app/(app)/zoho/page.tsx`, `zoho/reports/page.tsx`, `zoho/tickets/page.tsx`, `app/(app)/admin/logs/AuditLogClient.tsx`, `EventLogClient.tsx`, `SystemLogClient.tsx`, `app/(app)/admin/reports/AnalyticsDashboard.tsx` | scrolling tables reachable by keyboard |
| `app/(app)/admin/reports/page.tsx`, `admin/stuck-tickets/WrongTechnicianSection.tsx`, `intake/inbox/InboxList.tsx`, `intake/settings/ReclassifyButton.tsx`, `admin/approvals/WorkflowBuilderClient.tsx`, `admin/master-data/MasterDataClient.tsx`, `admin/task-config/TaskConfigClient.tsx`, `TaskTemplatesClient.tsx` | accessible names on controls |
| `app/(app)/admin/runbooks/RunbooksClient.tsx`, `app/(app)/tasks/page.tsx` | landmark and heading fixes |
| `lib/queries/reporting.ts` | `toReportFields` de-duplicates shared template fields (exported for test) |
| `components/requests/CommentForm.tsx`, `lib/attachments/paste.ts` (new) | **owner requests:** Templates list closes on outside click/Escape; paste (Ctrl+V) and drag-and-drop attach files |

### B. Tests and demo data (proposed branch `qa-2026-11-tests-and-demo-data`)
Modified: `tests/vapt/34-sheet-masters.test.ts`, `36-vendor-module.test.ts`, `70-data-api-team-steps-manager.test.ts`, `72-store-details-tab.test.ts`, `tests/unit/accessibility-names.test.ts` (+12 tests), `audit-2026-10/demo/sheets/demo-ac.csv`, `demo-genset.csv`.
New: `tests/unit/report-form-field-keys.test.ts`, `modal-focus-return.test.tsx`, `paste-attachments.test.ts`, `comment-form-template-and-paste.test.tsx`.

### C. Audit evidence and scripts (`docs/qa-full-audit-2026-11/`, ~88 MB)
Reports 01–18, scripts (`smoke/`, `uat/`, `ui/`, `security/`, `perf/`, `wf/`, `recovery/`, `soc/`, `seed/`), evidence (`evidence/`). **Do not commit** `evidence/db/` (73 MB database snapshot) or `evidence/mail-sink/`; keep them in an archive. The scripts are safe to commit: each refuses to run against anything but the audit stack.

### D. Tool side-effects that must NOT be committed
`audit-2026-10/evidence/*` (isolation/egress logs rewritten by every run), `AGENTS.md`, `tsconfig.json` (rewritten by a production build). They were restored after each run; **re-check `git status` before any commit** (H-1).

## Proposed commit plan (for your approval, in this order)
1. `Tests: bring five stale VAPT tests in line with current behaviour; demo sheets without real-looking addresses` (B, minus new unit tests).
2. `Accessibility: names, landmarks, skip link, keyboard-reachable tables, focus return, sign-in error announced` (A, accessibility files + their unit tests).
3. `Conversation box: Templates list closes on outside click; paste and drop attach files` (CommentForm + paste helper + their tests) — **small and independent, can ship first if you want the two annoyances gone quickly.**
4. `Reports: one report field per shared template field` (`reporting.ts` + test).
5. **Separate, later:** `Dependencies: upgrade Next.js ≥ 16.4.6, zod, nodemailer/mailparser, sanitize-html` — not prepared here; needs its own regression and load pass.
Each commit message to end with the attribution line required by this project's tooling.

## Proposed release procedure (follows CLAUDE.md; **needs your explicit OK at every step**)
1. Re-run all four test layers + `tsc` + `eslint` on the branch (`npm run verify` alone is not enough).
2. Local check on the audit copy: `ui/ui-a11y-regress.mjs`, `ui/ui-keyboard.mjs`, `security/sec-dast.mjs`.
3. Push `origin main` only on your word; build with `scripts/windows/build-for-deploy.ps1`; **check the standalone bundle contains no `local-testing/*.csv`** (F-007) before copying.
4. Deploy to 10.0.1.98 (not the retired 10.0.1.12); no migration, so no restart of `CkDeskPostgrest` is needed.
5. Smoke on live read-only (sign in, open a ticket, post a comment, paste a file); rollback = previous standalone folder (rollback folder is kept by the deploy recipe).
6. Not part of this release: decisions 1–4 of report 16.

## E. Zoho → CK Desk transfer (stages 1–3) — a SEPARATE feature branch, not part of the accessibility release
Built after the audit, locally, on the same working tree. **Keep it out of the audit commits.** New migrations 196 (mapping tables), 197 (`ZOHO-` number kept by the ticket-number trigger, server only), 198 (run log). Files: `lib/zoho/transfer/*`, `lib/actions/zohoTransfer.ts`, `app/(app)/zoho/{mapping,move}/*`, the Moved markers in `app/(app)/zoho/{page,tickets/page}.tsx`, the "From Zoho" source in `lib/sources.ts` and `components/requests/RequestBadges.tsx`, the quiet mode in `lib/rules/{run,actions}.ts`, and the "silent moved tickets" guard in `app/api/{alerts,business-rules}/run/route.ts`. Tests: `tests/unit/zoho-transfer*.test.ts`, `tests/integration/zoho-transfer-{move,run}.test.ts`. Release order if approved: migrations 196-198 on 205 → restart CkDeskPostgrest on 98 → deploy the app → first live move of a few tickets by the owner. Live also needs `ZOHO_ATTACHMENTS_ROOT` on 98 to copy attachment files.
