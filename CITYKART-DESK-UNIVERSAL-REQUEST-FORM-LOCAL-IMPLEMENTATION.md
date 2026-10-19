# Citykart Desk — Universal Request Form: Local Implementation & UAT Report

**Local only. Not pushed to git. Not deployed to Main. Main (10.0.1.12) was not touched in any way during this work.**

---

## 1. Executive Summary

The approved 3-panel Create Request workspace (left service context · center the real `DynamicForm` · right personalized shortcuts) is now implemented in the actual production route, `app/(app)/services/[slug]/page.tsx` — not a preview, not a fork. It is fully config-driven: the same code renders IT, Admin Repair, HR, Legal, or any other active service correctly, verified live against all of them. The shortcut click mechanism resolves by ID and writes into `DynamicForm`'s own existing Category/Sub-Category state via a new `useImperativeHandle` — no parallel form state, no bypass of validation, priority derivation, SLA calculation, or `createRequestCore`. The temporary preview route from the design-review phase has been deleted. All temporary UAT test data has been removed; local configuration and real profiles are untouched.

One real defect was found and fixed during testing (not assumed in advance): the shortcuts query's "only show active configuration" rule was initially incomplete — see §15.

**Verdict: LOCAL UNIVERSAL REQUEST FORM VERIFIED — READY FOR USER REVIEW** (§25).

---

## 2. Baseline

Captured before any change, per the instructions:

```
git status  → clean except pre-existing uncommitted Saved Reports work (unrelated, untouched — see below) and this session's own untracked design docs
git log -1  → 995c8cc "Add inline quick-approve to the Approvals list and header bell"
npx tsc --noEmit  → clean
npm run lint      → 0 errors, 3 pre-existing warnings (NewMilestonePanel.tsx, NewProjectPanel.tsx, RequestActionBar.tsx — all unrelated to this feature)
npx vitest run    → 115 test files passed, 5 skipped (120) · 871 tests passed, 23 skipped (894)
npm run build     → succeeded, full route table generated including the (then-still-present) /preview-redesign/[slug]
```

Pre-existing uncommitted changes identified and **deliberately left untouched** throughout this work (the in-progress Saved Reports feature from earlier in this session, explicitly on hold): `components/reports/PivotBuilder.tsx`, `lib/actions/reporting.ts`, `lib/reporting/pivot-engine.ts`, `types/database.ts`, `types/index.ts`. `tsconfig.json`'s diff is a line-ending no-op, also left alone. `.claude/settings.local.json` was already modified earlier this session (an unrelated Bash permission rule) — also untouched here.

---

## 3. Files Changed

**Modified (production code):**
- [`app/(app)/services/[slug]/page.tsx`](app/(app)/services/[slug]/page.tsx) — fetches shortcuts alongside the existing service/profile/allowed-subcategory data, renders the new `ServiceRequestWorkspace` in place of the old bare form wrapper. Breadcrumb and compact header markup carried over unchanged.
- [`components/forms/DynamicForm.tsx`](components/forms/DynamicForm.tsx) — converted to `forwardRef` exposing `applyCategoryShortcut(categoryId, subCategoryId)` via `useImperativeHandle`; two responsive-grid fixes (§16).
- [`lib/queries/requests.ts`](lib/queries/requests.ts) — added `getRequesterServiceShortcuts()` and the `RequesterServiceShortcut` type.

**New (production code):**
- [`components/requests/ServiceRequestWorkspace.tsx`](components/requests/ServiceRequestWorkspace.tsx) — the 3-panel layout, holds the `DynamicForm` ref, wires shortcut clicks.
- [`components/requests/ServiceContextPanel.tsx`](components/requests/ServiceContextPanel.tsx) — About / SLA Targets / Recently Used.
- [`components/requests/RequestShortcutPanel.tsx`](components/requests/RequestShortcutPanel.tsx) — Your Frequent Issues.

**Removed:** `app/(app)/preview-redesign/` (the entire temporary design-review route, per §22).

**Diff size:** `app/(app)/services/[slug]/page.tsx` +90/−47 lines (mostly the layout swap), `DynamicForm.tsx` +28/−4 lines, `lib/queries/requests.ts` +117 lines (new function only, nothing existing touched).

No migrations. No database schema changes. Nothing outside `app/`, `components/`, and `lib/queries/requests.ts` was touched.

---

## 4. Query Implementation

`getRequesterServiceShortcuts(userId, serviceId, allowedSubCategories)` in `lib/queries/requests.ts`:

1. One query: `requests.select('sub_category_id, created_at').eq('requester_id', userId).eq('service_id', serviceId).not('sub_category_id', 'is', null).order('created_at', desc).limit(200)`.
2. Groups in memory by `sub_category_id`, counting occurrences and tracking first-seen (= most recent, since the query is already newest-first) timestamp.
3. Intersects against `allowedSubCategories` (the same tagged-to-this-service list `getAllowedSubCategoriesForService()` already provides to the Category/Sub Category picker) — zero extra query for "still tagged."
4. One bounded follow-up query against `service_sub_categories`/`service_categories`, `.in('id', [...the handful of distinct sub-category ids actually in history])`, to check `is_active` on both — added after testing found the gap (§15).
5. Returns `{ recent, frequent }` — `recent` sliced to 5 in already-correct recency order (no sort needed), `frequent` sorted by count desc / recency tie-break, sliced to 5.

Ships only `{subCategoryId, subCategoryName, categoryId, categoryName, lastUsedAt, count}` per shortcut — never full request rows.

---

## 5. Security Scoping

- Every query is explicitly `.eq('requester_id', userId)` with `userId` passed in from `getCurrentProfile()` server-side — never "whatever this session's RLS happens to allow." Verified live: an agent/manager session's broader RLS visibility (team, subordinates) does not leak into the shortcuts panel — see §15's cross-user test.
- `service_id` further scopes — verified live that IT history does not appear on HR's page and vice versa.
- Only aggregated `{id, name, count, last_used}` — never full request objects — reach the client.

---

## 6. Recently Used Logic

Recency-ordered, deduplicated, capped at 5. **Verified with real data** (created via the actual Create Request form, not synthetic): Network Issue → Laptop Issue → Mouse Issue (in that creation order) produced, after the full sequence, **Mouse Issue, Laptop Issue, Network Issue** — correct most-recent-first order, each shown once despite Mouse having 3 separate tickets.

---

## 7. Frequent Issues Logic

Count-desc ordered, capped at 5, count badge shown. **Verified with real data**: Mouse Issue (3 tickets) → Laptop Issue (2) → Network Issue (1) rendered in exactly that order with exactly those counts.

---

## 8. Shortcut State Integration

`DynamicForm` is `forwardRef`-wrapped; `useImperativeHandle` exposes one method, `applyCategoryShortcut(categoryId, subCategoryId)`, which calls the component's own existing `setCategoryId`/`setSubCategoryId` — the identical state the manual picker sets. `ServiceRequestWorkspace` holds a `useRef<DynamicFormHandle>` and calls it from both panels' click handlers. No second form-state object exists anywhere. Verified live end-to-end: a single click on "Mouse Issue" populates Category = IT SUPPORT and Sub Category = MOUSE ISSUE in the real rendered `SearchableSelect` controls, shows a green "✓ Mouse Issue selected" confirmation for ~2.5s, smooth-scrolls the form into view, creates no request, and a subsequent normal Submit correctly derives priority/SLA from that sub-category and completes through the unmodified `createRequestCore` — confirmed by inspecting the created row's `sub_category_id` and `category_id` directly in the database.

---

## 9. Empty State

- No history at all → both panels show/collapse independently; grid becomes `26%/1fr` (no dead third column). Verified live on Legal (a real service with zero shortcut history).
- Recent populated, Frequent empty (or vice versa) → each panel handles its own empty state independently, right panel doesn't fully collapse if Recently Used still has content. Verified live on HR (real data: 2 recent, 0 frequent).

---

## 10. Service Header

Unchanged from the already-approved design — icon, name, team, SLA headline chip, approval-required chip when applicable. Entirely from the already-fetched `service` object, no new queries.

---

## 11. SLA Display

Renders whichever tiers are actually configured in `service.sla_policy.config` (Urgent/High/Medium/Low, response/resolution, sub-60-minute values shown in minutes). Omits the card entirely when `sla_policy` is null — not applicable to any service tested (all 14 active services have a policy), but the code path is defensive per the original proposal's §10.

---

## 12. Responsive Changes

Desktop `xl:` breakpoint (1280px) chosen over `lg:` (1024px) after live testing showed the real app shell's sidebar width makes a 3-column layout cramped at exactly 1024px — confirmed both ways during the earlier visual-review phase and re-confirmed here on the real route.

---

## 13. Mobile Category/Subcategory Fix

`DynamicForm.tsx`'s Category/Sub Category row: `grid-cols-2` → `grid-cols-1 gap-4 sm:grid-cols-2` (stacks below 640px, pairs above). Verified live at 390×844 and 320×568 — both category pickers full-width, placeholders fully readable, no truncation. Confirmed via `document.documentElement.scrollWidth === clientWidth` at 320px — no page-wide horizontal scroll.

---

## 14. Multi-Service Validation

Verified live, each with its own real header/team/SLA/form fields:

| Service | Team | Urgent SLA | Notable |
|---|---|---|---|
| IT | IT Group | 30min/2h | 2 fields (Contact Number; Serial Number, Subject) |
| Admin Repair | Admin Group | 1h/6h | 7 fields incl. 3 technician-only (view-only, disabled) — Repaired Item Qty, Vendor Ticket Creation Date, Vendor Ticket Number |
| HR | HR Group | 1h/6h | Contact Number + Employee Code |
| Legal | Legal Group | 1h/6h | No shortcut history (empty-state case) |

No hard-coded slug/name checks anywhere in the new code — confirmed by reading `ServiceRequestWorkspace.tsx`/`ServiceContextPanel.tsx`/`RequestShortcutPanel.tsx` end to end: every value rendered comes from a prop.

---

## 15. Personalization Tests

All run against real data created through the actual UI (not fabricated rows) except where noted:

| Test | Result |
|---|---|
| A. Recent order | ✅ Network → Laptop → Mouse creation order produced Mouse → Laptop → Network display order |
| B. Frequency order | ✅ Mouse(3) → Laptop(2) → Network(1), counts correct |
| C. Duplicates | ✅ 3 separate Mouse Issue tickets → one row, count 3 |
| D. Different service | ✅ HR page shows zero IT shortcuts |
| E. Different user | ✅ A ticket inserted for a second real user (Ajay Kumar) never appeared in the test operator's panels |
| F. Inactive subcategory | ⚠️→✅ **Found broken on first test** — see below — then fixed and re-verified |
| G. Empty history | ✅ Legal renders cleanly, right panel collapsed, left grid widened |

**Test F in detail:** `getAllowedSubCategoriesForService()` (the picker's own existing query) does not filter `is_active` — confirmed by reading it. My first implementation relied solely on that list, so a deactivated sub-category kept appearing as a shortcut. Reproduced live (temporarily set Network Issue's `is_active = false`, reloaded, it still showed), fixed by adding the bounded follow-up query described in §4 step 4, reproduced the *fix* live (same toggle, reloaded, Network Issue correctly disappeared from both panels), then immediately reverted the test toggle. This is a real bug that was caught and fixed, not a hypothetical.

---

## 16. On-Behalf-Of Regression

Verified live, full end-to-end: selected "Ajay Kumar" in Requesting on Behalf Of → shortcut panels continued showing the *operator's* own history (Mouse/Laptop/Network), not Ajay's → clicked "Mouse Issue" shortcut (still populates the form correctly) → filled remaining fields → submitted → **queried the created row directly**: `requester_id` = Ajay Kumar's id (not the operator's), `sub_category_id` = Mouse Issue. Confirms shortcuts-stay-with-operator and on-behalf-of-still-assigns-correctly both hold simultaneously, unmodified from existing behavior.

---

## 17. Performance Check

`EXPLAIN ANALYZE` on the shortcuts query at current local data volume (single-digit rows per requester/service) returns a sub-millisecond Seq Scan — too small a table to say anything about production-scale behavior. `idx_requests_requester` already exists and covers the `requester_id` filter; `service_id` narrows further via a plan-time filter. **No new index added** — per the explicit instruction not to add one without evidence, and none exists yet at this data volume. Flagging as a "watch this" item, not a blocker: if production `EXPLAIN ANALYZE` ever shows this filter step dominating query time, a composite `(requester_id, service_id, sub_category_id)` index is the documented next step (§28.11 of the proposal) — not applied here.

---

## 18. Accessibility Check

*(Not a formal WCAG audit — basic checks only, as scoped.)*

- Every shortcut row is a real `<button type="button">` (verified via `document.querySelectorAll` — confirmed `tabIndex: 0` on all of them) — native keyboard focus and native Enter/Space activation, no custom key handling needed, no div-only controls.
- Added explicit `focus-visible:ring-2 focus-visible:ring-ring/40` to both panels' shortcut buttons (they had none before — an oversight caught during this check, not present in the original design-review-phase preview either) — now consistent with the app's existing `focus-visible:ring-*` pattern used elsewhere (e.g. `SearchableSelect`).
- Labels are plain visible text content — no icon-only controls needing `aria-label`.
- Touch targets: each shortcut row is a full-width `px-2 py-2` button — comparable to existing list-row touch targets elsewhere in the app; not separately measured against a specific px minimum.

---

## 19. Automated Regression

Run twice — once immediately after implementation, once again as the final pass after test-data cleanup and the `.next` incident (§21) was resolved. Identical both times:

```
npx tsc --noEmit  → clean, 0 errors
npm run lint      → 0 errors, 3 pre-existing warnings (unchanged from baseline, unrelated files)
npx vitest run    → 115 files passed, 5 skipped (120) · 871 tests passed, 23 skipped (894) — IDENTICAL to baseline, zero regressions
npm run build     → succeeded, clean route table
```

No new test suite was written for `getRequesterServiceShortcuts()` itself — verification was done via live database + live UI end-to-end instead (§15), which exercises the real RLS-scoped client the way a unit test with a mocked client would not. Flagging as a reasonable gap: a future unit test around the pure grouping/sorting logic (extracted from the Supabase call) would be cheap to add and is a fair ask for a follow-up, not done here since it wasn't explicitly requested and the live testing already exercised every branch.

---

## 20. Screenshots

All in [`design-review-screenshots/`](design-review-screenshots/), captured from the real `/services/[slug]` route (not the deleted preview route):

| File | Shows |
|---|---|
| `01-REAL-IT-1600.png` | IT, desktop, populated shortcuts |
| `02-REAL-ADMIN-REPAIR-1600.png` | Admin Repair, desktop, different SLA/fields, technician-only fields visible-but-disabled |
| `03-REAL-HR-1600.png` | HR, desktop, Recent populated / Frequent empty (independent collapse) |
| `04-REAL-NEW-USER.png` | Legal, desktop, zero-history empty state, widened 2-column grid |
| `05-REAL-SHORTCUT-SELECTED.png` | Real single click on "Mouse Issue" → Category/Sub Category populated, confirmation shown |
| `06-REAL-TABLET-1024.png` | 1024×768, full page, form-first stacking order |
| `07-REAL-MOBILE-390.png` | 390×844, full page, Category/Sub Category stacked |
| `08-REAL-MOBILE-320.png` | 320×568, full page, narrowest tested width, no horizontal scroll |

(The earlier design-review screenshots `01`–`09` without the `-REAL-` prefix remain in the same folder from the prior phase, for comparison.)

---

## 21. Temporary Test Data Cleanup

8 requests were created during testing, all titled with a `[UAT test data]` prefix (6 as the primary test operator, 2 as a second real user for cross-user isolation testing) — listed, confirmed, and deleted by exact title match after all screenshots were captured:

```sql
DELETE FROM requests WHERE title LIKE '[UAT test data]%';  -- DELETE 8
```

Cascaded cleanly to their comments/activity/attachments per existing FK `ON DELETE CASCADE`. One `service_sub_categories.is_active` toggle (§15, Test F) was flipped false then immediately reverted true — confirmed back to its original state. **Nothing else was touched**: `requests` is back to 0 rows (the same as before this task started), `services` still 14, `profiles` still 527. The ticket-number sequence was **not** reset — it naturally advanced through the UAT tickets' numbers, which is normal usage, not something requiring cleanup per the explicit instruction.

**Self-inflicted incident, disclosed:** partway through, I deleted the `.next` build directory while the dev server was still running and mid-write to its Turbopack cache, which corrupted that cache and briefly produced an Internal Server Error. Fixed by stopping the dev server, clearing `.next` fully, and restarting cleanly — no data loss, no code loss, confirmed via a fresh `tsc`/`vitest`/`build` pass afterward that everything was still correct. Noting this plainly rather than glossing over it — it's a process mistake on my part, not a defect in the implementation.

---

## 22. Preview Route Cleanup

`app/(app)/preview-redesign/` (the entire temporary route from the design-review phase, including `page.tsx`, `PreviewPanels.tsx`, `sampleShortcuts.ts`) has been deleted. Confirmed via `Glob` — zero matching files remain. Confirmed the app still builds and typechecks cleanly without it.

---

## 23. Git Status

```
On branch main, up to date with origin/main.

Modified (this task):
  app/(app)/services/[slug]/page.tsx
  components/forms/DynamicForm.tsx
  lib/queries/requests.ts

Untracked (this task, new files):
  components/requests/ServiceRequestWorkspace.tsx
  components/requests/ServiceContextPanel.tsx
  components/requests/RequestShortcutPanel.tsx

Untouched (pre-existing, unrelated — left exactly as found):
  .claude/settings.local.json
  components/reports/PivotBuilder.tsx, lib/actions/reporting.ts, lib/reporting/pivot-engine.ts,
    types/database.ts, types/index.ts, tsconfig.json  (Saved Reports work, on hold)
  CITYKART-DESK-*.md audit/proposal/review docs, main-server-configuration/,
    supabase/migrations/20240101000146_saved_reports.sql, supabase/snippets/,
    design-review-screenshots/  (earlier session material)
```

**No `git add`, no commit, no push.** Verified with a plain `git status` as the last step before writing this report.

---

## 24. Remaining Issues

1. **No automated unit test for `getRequesterServiceShortcuts()`'s grouping/sorting logic** — verified live instead (§19). A cheap, worthwhile follow-up, not blocking.
2. **Performance at production scale is unmeasured** (§17) — local data volume is too small to be meaningful. Not a known problem, just genuinely unknown; the existing `requester_id` index should carry it based on how the same index already serves "My Requests," but this is an inference, not a measurement.
3. **`services.description` is sparse in real current data** (e.g. IT's is literally "IT") — same observation as the design-review phase, not new, not a defect in this implementation; the About card handles it gracefully either way.
4. **320px width** shows the existing app topbar's search bar overflowing its own header bar visually (not a page-wide scroll — confirmed programmatically) — this is pre-existing `AppShell` topbar behavior at a width narrower than the app's typical target, not something this feature introduced or is in scope to fix.

None of these block local review.

---

## 25. Local Readiness Verdict

## LOCAL UNIVERSAL REQUEST FORM VERIFIED — READY FOR USER REVIEW

---

## UNIVERSAL REQUEST FORM LOCAL IMPLEMENTATION COMPLETE

**NO GIT PUSH MADE**

**NO MAIN DEPLOYMENT MADE**

**AWAITING USER REVIEW AND EXPLICIT GIT/MAIN APPROVAL**
