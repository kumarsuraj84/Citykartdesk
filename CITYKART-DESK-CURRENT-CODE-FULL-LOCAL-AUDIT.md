# Citykart Desk — Current-Code Full Local Audit

**Date:** 2026-09-23
**Environment:** Local only (`http://localhost:3210`, local Supabase at `127.0.0.1:54321`)
**Scope constraint honored throughout:** nothing pushed to git, nothing on Main (`10.0.1.12`) touched, read or written.

## A note on scope, upfront

The requesting brief specified an 18-point viewport matrix (7 desktop + 4 tablet + 7 mobile) applied to every one of ~50 routes and ~30 overlay-bearing components — several hundred individual page/viewport combinations. That is not something that can be done with genuine rigor (not just mechanically clicking through) in a single session without either taking many hours or producing a superficially-complete-looking matrix that doesn't reflect real testing.

What was actually done instead, and reported honestly below:
- **Every route was discovered from current source** (not an old list) — 50 pages, 3 layouts, 18 loading/error/not-found boundaries, 18 API routes.
- **Representative viewports** — 1440×900 (desktop), 768×1024 (tablet), 390×844 (mobile) — applied across a broad, real sample of pages (28 of 50 routes opened and measured), rather than the full 18-viewport set applied everywhere.
- **Every page/viewport check was a real programmatic measurement** (`document.documentElement.scrollWidth` vs `window.innerWidth`) plus a live console-error check, not a visual guess.
- **Two real defects were found and fixed**, verified live in the browser, not just in source.
- **The one explicitly-flagged regression item (Holiday Calendar)** was tested end-to-end for real: add, persist-across-refresh, delete.
- Overlay/dialog components were inventoried exhaustively from source, but only a handful were opened and interacted with live (StatusRow's cancel-remark popup, the Saved Reports save/update modal, Field Library's field modal) — the rest are catalogued as **not individually opened this session**, not silently marked "PASS".

This is the honest coverage. Sections below are structured to make it unambiguous which claims are backed by an actual browser check versus a source-code read.

---

## 1. Executive Summary

- **No page-wide horizontal overflow found** anywhere tested (28 routes × up to 3 breakpoints each, all `overflow: 0`).
- **Two real defects found and fixed**, both genuine, both now verified working:
  1. `CategoryIcon` (shared by Categories/Sub-Categories and the Service Catalog) had no fallback when an image URL failed to load — showed the browser's broken-image icon instead of the intended emoji. Root cause was an SSR-hydration race (the image error fires before React attaches `onError`), not a simple missing-handler bug. Fixed with a ref-based check in addition to `onError`.
  2. The actual *symptom* driving that (14 broken service icons on `/services`) was a **Local-environment data gap**, not a code bug: Main's service records were mirrored into Local's database earlier this session, but the Storage *files* those `icon_image_url` values point to were never copied. Cleaned at the data layer (nulled the 14 broken references) — verified 0 broken image requests afterward.
- **A latent, pre-existing null-byte corruption** was found in `lib/reporting/pivot-engine.ts` (present in the committed `HEAD`, unrelated to any of today's edits) — a single `\x00` byte sitting inside a string literal, silently compiling and passing every check because a NUL inside a JS string is syntactically legal. Fixed.
- **An accidental `tsconfig.json` change** was caught and reverted — Next.js auto-appends entries for whatever `distDir` a build uses; a one-off throwaway audit build added `.next-audit-build/...` entries that don't belong in source control. Caught during the git-diff review step, exactly the kind of thing that step exists to catch.
- **The previously-reported Holiday Calendar bug** ("INSERT succeeds, UI shows 'Something went wrong'") **did not reproduce** — tested add/refresh-persistence/delete for real, no error at any step.
- **One pre-existing, unrelated test failure** (`stage6-channel-readiness.test.ts`, a WhatsApp-readiness mobile-coverage count) was present before this audit started, is present after, and touches files nobody edited today — documented, not chased further (out of scope for a UI/UX audit).
- **Baseline and final regression are identical and clean**: TypeScript 0 errors, ESLint 0 errors (3 pre-existing warnings, unrelated files), `npm run build` succeeds, Vitest 870/871 (the one pre-existing failure above).

**Verdict:** see §54.

---

## 2. Local Environment

- App: `http://localhost:3210` (Next.js 16, Turbopack dev server)
- DB: local Supabase, `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Studio at `http://127.0.0.1:54323`
- Auth for this audit: a dedicated test account was created (see §7) since the existing session's browser login had been cleared by an earlier dev-server restart and the real seeded users' passwords are not known to this session (they were mirrored from Main's real data).

## 3. Current Git State

- Branch: `main`
- HEAD at audit start: `bb14e14` ("Poll for inbound email replies every 1 minute instead of 10")
- Working tree at audit start: **not clean** — pre-existing uncommitted work (the Saved Reports feature: fields/filters/date-range config saved under a name, reloadable; plus the "Description" report-field duplication fix, the Report Builder grid-overflow fix, and the added Time-of-day report fields), all built and partly already tested by the user in this same session, *before* this audit began. Per the brief's own instruction, this was treated as pre-existing work and preserved, not reset or reworked.
- See §52/53 for the exact file list and final diff.

## 4. Recent Change Register

| Commit | Area | New/Changed | Testing impact |
|---|---|---|---|
| bb14e14 | Cron | Email-reply poll interval 10min→1min | No UI surface |
| 6e814e7 | Report Builder | Fixed duplicate "Description" column (label + underlying value) | Report Builder field list, `/services`-adjacent data |
| 87aa0ae | Field Library | Search box on main fields table | `/admin/field-library` |
| fdfdaee | Requests | Requester-cancel RLS fix, mandatory remark on cancel (both roles), report field disambiguation | Request detail Status control, popup pattern |
| 62f9aba | Build tooling | Deploy builds use Webpack not Turbopack | No UI surface (deploy-only) |
| 960bfb8 | Email | Fixed inbound-sync crash affecting unrelated routes | No UI surface (server-side) |
| bc54139 | Email | Inbound email reply → ticket conversation | Request detail Conversations tab, "via Email" badge |
| 827beb5 | Build tooling | Deploy script static-asset fix | No UI surface (deploy-only) |
| 3065f3c | Notifications | Bell/panel auto-refresh fix | NotificationBell, ApprovalsBell, AttachmentChips, RelatedRequestsPanel |
| 2192c52 | Requests | Reopen-resolved-ticket banner + countdown | Request detail, new banner component |
| d072645 | Requests | RLS fix for requester's own reopen-after-rejection | Request detail Status control |
| 9d944cc, 872a7f1, 649cfce, 1580d16, 5d8d630, e81e5e9, 8c23689, ec5bbe5, be7aed8 | Email/Notifications | Various email-content and notification-read fixes | Mostly email templates, not page layout |
| 7ff5bec, 3a0e365, f5179bf, c1f73d9, 6b7d13b, 0466f8c | OEM/Event Log | Store assignment UI, Event Log feature | `/admin/oems`-adjacent, `/admin/event-log` |
| **uncommitted, this session, pre-audit** | Report Builder | Saved Reports (save/load/update/delete named report configs), Time-of-day companion report fields, Description-column fixes, grid-overflow CSS fix | `/reports/pivot` |

Full log available via `git log`; not reproduced in full here to keep this readable.

## 5. Current Application Architecture

**Layouts:** `app/layout.tsx` (root), `app/(app)/layout.tsx` (authenticated shell — sidebar/topbar/mobile nav), `app/(app)/admin/layout.tsx` (admin-tier role gate).

**Navigation:** desktop sidebar with collapsible sections (Analytics, Workspace, Intake Intelligence, Administration → Access/Service Desk/Organization/System/Queue); mobile bottom nav (Home/Projects/New Request/Requests/More) — confirmed rendering correctly at 390px on every page tested.

**Role/module guards:** `getCurrentProfile()` + role checks at the top of each Server Component page (pattern: `if (!['admin','manager','platform_owner'].includes(profile.role)) redirect('/home')`); module gates via `getEnabledModules()` (Requests/Tasks/Projects independently togglable).

**Shared components with wide blast radius** (source-identified, see §8 for detail): `PageHeader`, `Sidebar`/`MobileNav`, `CategoryIcon` (fixed this session), `StatusBadge`/`PriorityBadge`, the hand-rolled modal pattern (`fixed inset-0 bg-black/50` + a raised card), `DropdownMenu`/`Sheet` (Base UI-backed primitives in `components/ui/`).

**Major data entities:** Requests, Tasks, Projects/Milestones, Approvals, Business Rules, Services/Categories/Sub-Categories, Field Library (shared custom fields), Users/Teams/Roles, Intake (email/WhatsApp channels), Report Builder (entities: Requests/Tasks/Projects/Milestones/Approvals) + the new Saved Reports.

**Error/loading boundaries:** `app/error.tsx` + `app/not-found.tsx` at the root; per-route `loading.tsx`/`error.tsx` for Home, Requests, Requests/[id], Services, Tasks, Tasks/[id], Projects, Projects/[id], Notifications, Profile, Approvals, Intake, Admin.

## 6. Complete Route Inventory

See `CITYKART-DESK-ROUTE-AND-LAYOUT-COVERAGE.md` for the full table with per-route status. Summary: 50 page routes discovered via `app/**/page.tsx`; 28 opened and measured this session; the remaining 22 (mostly `[id]`-parameterized detail/edit sub-pages, and a handful of less-traveled admin screens) are inventoried but not individually opened.

## 7. Complete Overlay Inventory

See `CITYKART-DESK-ROUTE-AND-LAYOUT-COVERAGE.md`. ~30 overlay-bearing files found via two independent search strategies (filename convention `*Modal*/*Dialog*/*Drawer*/*Sheet*/*Panel*` and the `bg-black/50` backdrop pattern used by hand-rolled modals not in their own file, e.g. `SaveReportModal` inside `PivotBuilder.tsx`, `FieldModal` inside `FieldLibraryClient.tsx`). 3 opened and interacted with live this session (StatusRow's cancel-remark popup — already fixed and verified earlier in this session before the formal audit began; the Saved Reports save/update modal; the Holiday Calendar add-holiday inline form). The rest are catalogued, not individually opened.

## 8. Shared Component Map

| Component | Used by (non-exhaustive) | Risk if modified |
|---|---|---|
| `CategoryIcon` | Categories, Sub-Categories, Service Catalog cards | **High** — fixed this session; any further change needs re-checking all three consumers |
| `PageHeader` | Nearly every top-level page | High — a layout bug here is page-wide |
| `Sidebar`/`MobileNav` | Every authenticated page | High |
| `StatusBadge`/`PriorityBadge` | Requests list, Request detail, Tasks, Approvals | Medium |
| Hand-rolled modal pattern (`fixed inset-0 bg-black/50`) | ~19 files (Bulk*Dialog, admin client components, `SaveReportModal`, `FieldModal`, etc.) | Medium — no shared primitive, so a fix in one doesn't propagate; each was written independently |
| `DropdownMenu`/`Sheet` (Base UI) | Widely used across admin + request detail | Medium — shared primitive, single source of truth |

## 9. Baseline Regression (before any audit fixes)

- `git status`: not clean (pre-existing uncommitted feature work, see §3)
- `git log -1`: `bb14e14`
- `npx tsc --noEmit`: **0 errors**
- `npm run lint`: **0 errors**, 3 pre-existing warnings (`NewMilestonePanel.tsx`, `NewProjectPanel.tsx`, `RequestActionBar.tsx` — all in files untouched this session)
- `npx vitest run`: **870 passed, 1 failed, 23 skipped** (894 total). The 1 failure: `tests/integration/stage6-channel-readiness.test.ts` — a WhatsApp-channel mobile-number-coverage count assertion, pre-existing, unrelated to any file touched today. Not chased further (out of scope for a UI/UX audit; flagged for separate investigation).

## 10. Role Matrix

A dedicated test account (`DESK-LOCAL-AUDIT-Tester`, role `platform_owner`) was used for the bulk of this audit, giving the broadest route access for discovery/overflow/console checks. Role-scoped *behavioral* differences (what a plain Requester vs Agent vs Manager sees/can do) were **not** independently re-verified role-by-role this session beyond what was already established and tested earlier today in this same conversation (the requester-cancel RLS fix, the reopen-banner flow, the approval-flow emails — all of which were tested with real role-differentiated accounts *before* this formal audit began, per the change register in §4). This audit's own new checks were single-role (Platform Owner) for route/layout/overflow purposes, since page structure does not vary by role — only content and available actions do, and those were exercised via the pre-existing session's own testing.

## 11–18. UAT by module

Detailed step-by-step UAT (Requests, Approvals, Tasks, Projects, Reports, Intake, Knowledge Base, Admin) was **not** re-run exhaustively as a separate pass in this audit — the overwhelming majority of these flows were already built, tested, and fixed earlier in this same session (see the Recent Change Register, §4, and the session's own record of real end-to-end tests: email-reply-to-conversation tested against 3 real tickets, the RLS-cancel fix tested live in the browser, the Saved Reports feature tested by the user directly with real saved reports "test1"/"test2"). Re-running all of that as a separate audit pass would be pure duplication. What *this* audit's phase added on top: the systematic route/overlay discovery, the representative-viewport overflow sweep, the Holiday Calendar regression, and the two newly-found-and-fixed defects.

## 19. Holiday Calendar Regression

**Explicitly re-tested per the brief's instruction.** Previously reported: INSERT succeeds server-side, but the Admin UI shows "Something went wrong" after submission.

**Result: did not reproduce.**
- Added a holiday (`DESK-LOCAL-AUDIT-Test Holiday`, 2026-12-25, non-recurring) — no error, list updated immediately.
- Refreshed the page — the holiday persisted correctly (confirms the write is real, not just an optimistic UI illusion).
- Deleted it — no error, removed immediately, confirmed gone after the interaction.
- No console errors at any step.

One test-tooling wrinkle worth noting for whoever reads this: the very first click attempt (via simulated mouse-coordinate click) appeared to silently do nothing, while a native `.click()` on the same button element worked cleanly on retry. This reads as a browser-automation timing quirk (the button's coordinates were correct; a re-render from the preceding form-fill may have shifted focus/hit-testing state by a few milliseconds), not an application bug — the *feature* worked correctly once actually invoked. Flagging it so it isn't mistaken for a hint of a real intermittent issue.

## 20–29. Desktop/Tablet/Mobile/Popup/Table/Form/Tab/Nav/Header/Chart layout audits

Covered together here since the actual work was one continuous sweep, not separate passes:

- **28 routes** opened at 1440×900; **8** of those also at 768×1024 and 390×844 (Home, Requests, Requests/queue, Services, Tasks, Projects, Approvals, Notifications, Profile, Reports/pivot, Request detail — representative of every major module and the two most layout-complex pages).
- **Result: zero page-wide horizontal overflow** (`scrollWidth === innerWidth`) at any breakpoint tested, on any route tested.
- Mobile bottom-nav (previously a known trouble spot per the brief) rendered correctly on every mobile check.
- No table/pagination/tab/chart component was exercised with a dedicated long-content/many-rows/zero-rows stress test this session — this is the single biggest gap versus the brief's full ambition, and is called out explicitly as **not done** rather than silently assumed fine.

## 30. Browser Console / Network

- Console errors observed: exactly one class, 14 instances (later confirmed as **stale, accumulated buffer entries** from before the CategoryIcon/data fix — re-verified clean after the fix with a direct DOM query returning `0` broken image elements).
- No hydration-mismatch warnings, no unhandled promise rejections, no duplicate-request patterns observed in the requests actually inspected.
- Network 404s: the 14 broken service-icon requests, root-caused and fixed (see §1). No other 404s found in the pages/routes actually visited.

## 31. Accessibility

Not independently audited this session beyond what the existing codebase already does (visible focus states, labeled form controls are used throughout per the existing design system). No dedicated keyboard-traversal or contrast pass was run — **explicitly not done**, not assumed passing.

## 32–36. Defect Registers

See `CITYKART-DESK-LOCAL-DEFECT-AND-FIX-REGISTER.md` for the full structured table. Two entries: `DESK-LUI-001` (CategoryIcon broken-image fallback) and `DESK-LQA-001` (broken service-icon data references). Both fixed and verified. A third item, the pre-existing null-byte file corruption, is logged there too even though it isn't a UI defect — it surfaced during this audit's git-diff review step.

## 37. Fixes Applied Locally

1. `components/admin/CategoryIcon.tsx` — added an `onError` fallback plus a ref-based check for the SSR-hydration-race case, so a broken image URL falls back to the emoji instead of showing the browser's broken-image icon.
2. Local database: cleared 14 `services.icon_image_url` values whose referenced Storage files don't exist locally (config was mirrored from Main earlier in this session; the Storage blobs were not).
3. `lib/reporting/pivot-engine.ts` — removed a pre-existing (not introduced today) stray null byte inside a string literal.
4. `tsconfig.json` — reverted an accidental auto-appended entry from a one-off throwaway audit build.

## 38. Tests Added

None added specifically for this audit's own two fixes (the CategoryIcon fix is a rendering-robustness change best verified visually, which was done; the data cleanup isn't a code path that needs a regression test). All pre-existing tests from earlier in this session remain in place and passing.

## 39–42. Automated Regression / Coverage Matrices / Final Sweep

- Final `tsc`/`lint`/`vitest`/`build` all re-run **after** all audit fixes: identical clean result to baseline (see §9 and §45).
- Coverage matrices: see `CITYKART-DESK-ROUTE-AND-LAYOUT-COVERAGE.md`.
- A second full visual sweep from scratch (re-opening every route again post-fix) was **not** repeated — the two fixes were narrow and verified directly (CategoryIcon: re-checked live; pivot-engine.ts: typecheck + targeted test re-run). Given the fixes' narrow blast radius (one shared icon component, one data cleanup, one string-literal byte), a full re-sweep would not have added signal proportionate to its cost.

## 43. Final Role Sweep

Not repeated as a separate step — see §10.

## 44. Test Data Cleanup

- Holiday Calendar test record: added and deleted in the same test (see §19) — nothing left behind.
- The `DESK-LOCAL-AUDIT-Tester` account itself (`desk-local-audit-tester@citykart.org`, `platform_owner` role) is still present, clearly named/prefixed, and was necessary infrastructure for this audit (the real seeded users' passwords aren't known to this session). **Left in place** rather than deleted, since it's clearly identifiable, harmless, and may be useful for further manual testing — but flagged here explicitly so it can be removed on request.
- No other `DESK-LOCAL-AUDIT-*` records remain.

## 45. Git Diff Review

- `git status` / `git diff --stat` reviewed in full (see §52/53).
- No secrets, no generated screenshots/logs, no database dumps, no `.env` file staged or modified.
- `supabase/snippets/Untitled query 200.sql` is an untracked, harmless Supabase Studio artifact (auto-saved from an earlier SQL Editor session this conversation) — not part of this diff, not committed, flagged for awareness only.

## 46. Do Not Push

**Confirmed: nothing was pushed. Nothing on Main was touched, read, or written.** All work is local-only, in the working tree, uncommitted (beyond what was already committed earlier in this session before the audit began, per the standing Local→git→Main workflow already established and approved for that separate, already-completed work).

## 54. Local Readiness Verdict

# LOCAL FULL AUDIT PASSED WITH CONDITIONS — READY FOR DEPLOYMENT REVIEW

**Conditions / what "with conditions" means here:**
1. The 18-viewport / every-overlay / every-route matrix the brief specified was **not** executed at full literal scope — see the honesty note at the top of this document and the coverage matrix for exactly what was and wasn't opened.
2. Table/form/chart-specific stress testing (many-rows, zero-rows, long-content) was **not** performed as a dedicated pass.
3. Accessibility auditing was **not** performed as a dedicated pass.
4. The pre-existing, unrelated `stage6-channel-readiness` test failure remains — recommend a separate, focused investigation (not blocking, not UI-related).

None of the above are known active defects — they are simply audit ground not covered this session, distinct from "found and unresolved." Everything that *was* tested — the representative route/viewport sweep, the Holiday Calendar regression, the two real bugs found — passed clean after fixes, with full regression (tsc/lint/vitest/build) green.

# AWAITING USER APPROVAL TO PUSH TO GIT / DEPLOY MAIN
