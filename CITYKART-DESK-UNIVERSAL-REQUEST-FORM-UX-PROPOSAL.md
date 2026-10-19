# Citykart Desk — Universal Request Form UX Redesign Proposal

**Phase 1: Study + Design Sample Only — No implementation, no database changes, no AI, no git/Main.**

Companion file: [`CITYKART-DESK-UNIVERSAL-REQUEST-FORM-MOCKUP.html`](./CITYKART-DESK-UNIVERSAL-REQUEST-FORM-MOCKUP.html) — an interactive, standalone prototype (open it directly in a browser; it is not wired into the app in any way). It lets you switch between three sample services (IT, Admin Repair, Finance — Vendor Creation), toggle an "empty history" state, and click a Recently Used / Frequent Issue shortcut to watch Category/Sub Category populate live.

---

## 1. Executive Summary

The current Create Request page (`app/(app)/services/[slug]/page.tsx`) is a single centered column (`max-w-3xl`) on an otherwise empty canvas — clean, but wasteful on large screens and offers no shortcuts back to a requester's own common issues.

The proposed redesign wraps the **existing, unmodified dynamic form** in a three-panel desktop workspace — Service Context (left) · Request Form (center) · Personalized Shortcuts (right) — built entirely from data the app already has: service configuration, SLA policy, and the requester's own request history. Nothing is hard-coded per service; the same layout renders correctly for IT, Admin Repair, Finance, or any other configured service, because it reads the same `service`, `form_sections`, and `sla_policy` objects the current page already resolves. No AI, no new tables required for the minimum version (one small addition is optional — see §9).

---

## 2. Current Implementation Findings

*(Traced directly from the repository — `D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate` — not assumed from the screenshot.)*

**Service Catalog** — [app/(app)/services/page.tsx](app/(app)/services/page.tsx) lists `ServiceCard`s from `lib/queries/services.ts`. A service row (`types/database.ts`) has `id, name, slug, icon, icon_image_url, description, status, is_active, sort_order, team_id, default_priority, sla_policy_id, template_id, approval_workflow_id, auto_oem_routing, visibility, keywords[]` — note there is **no `category_id`/`sub_category_id` column**; categories are tagged to a service many-to-many via `service_sub_category_tags`, resolved per-service by `getAllowedSubCategoriesForService(serviceId)`.

**Service detail = Create Request page.** There is no separate route — [app/(app)/services/[slug]/page.tsx](app/(app)/services/[slug]/page.tsx) fetches the service (`SERVICE_SELECT`, eagerly joining `team`, `sla_policy`, `template`), the requester's profile, allowed sub-categories, and their store address, then renders one component: `<DynamicForm service={...} canBookOnBehalf={...} allowedSubCategories={...} currentUserStoreAddress={...} />` inside `<div className="mx-auto max-w-3xl space-y-6">`.

**Dynamic form rendering** — [components/forms/DynamicForm.tsx](components/forms/DynamicForm.tsx) is the actual form. `lib/forms/sections.ts`'s `resolveServiceFormSections(service)` is the single source of truth for which fields render: if the service has a tagged Form Template, that template's `form_sections` (JSONB: `{id, title, order, fields: FormField[]}`) wins; otherwise legacy flat `form_fields` are migrated into one synthetic section. Each `FormField` carries `type, label, required, options?, validation?, requester_can_view?, requester_can_set?`. The Field Library (`lib/forms/library.ts`, table `form_field_library`) supplies reusable field definitions that templates reference. `DynamicForm` flattens sections → renders via `SectionBlock` → `FieldGrid` (pairs short fields into 2-column rows) → `FieldRenderer` (switches on field type).

**Category / Sub Category** — tables `service_categories` / `service_sub_categories`, both with `is_active`; linked to a service via the `service_sub_category_tags` join table. `getAllowedSubCategoriesForService()` returns only that service's tagged, active sub-categories. Picking a sub-category does **not** swap form fields — it drives `priority` (via `service_sub_categories.sla_priority`) and `category_id`, resolved authoritatively server-side in `resolveSubCategoryForService()`.

**"Requesting on behalf of"** — a picker inside `DynamicForm.tsx`, gated client-side by `canBookOnBehalf = role in (agent, manager, admin, platform_owner)` (computed in the page). On submit, `formData.set('requester_id', onBehalfOf.id)`; the server (`lib/actions/requests.ts#createRequest`) **re-checks the role independently** and only then overrides the requester, routing the insert through the admin client since RLS's `requests_insert` policy requires `requester_id = auth.uid()`.

**Requester vs. technician fields** — driven by `requester_can_view` / `requester_can_set` booleans on each `FormField` (absent = fully visible/settable). `filterFieldsForRequester()` strips technician-only fields before they ever reach the client.

**Attachments** — `type: 'file'` fields stage locally (`PendingFileField`) since no request row exists yet; uploaded via `uploadAttachment()` only after `createRequest()` returns an id.

**Validation** — shared `lib/validation/formFields.ts` runs identically client-side (UX) and server-side (`validateRequesterFormCompletion()`, the real gate) — same functions, same rules, different audience.

**Ticket creation** — `lib/requests/create-request-core.ts#createRequestCore()` is the shared server core (web, email-intake, WhatsApp, API all funnel through it): re-resolves service/sub-category/form fields, re-validates, derives title, resolves priority → SLA due dates (`lib/sla/resolve.ts`), inserts the row — `request_no` is allocated by a Postgres function (`generate_request_no()`) via the `request_sequences` counter table, format `CKSD-000001`.

**Request history query pattern** ("My Requests") — [lib/queries/requests.ts](lib/queries/requests.ts)`#getRequests()`, `view: 'mine'` branch: `query.eq('requester_id', userId).order(...)`, lean explicit column list, `{count:'exact'}` + `.range()` pagination. This is the pattern §8/§14 below build on for "recently/frequently used."

**SLA policy model** — `SlaPolicy.config: {low?, medium?, high?, urgent?} → {response_hours, resolution_hours}` (JSONB). No existing reusable "SLA summary" component beyond the single-line badge already on the service-detail page (`{defaultSla.resolution_hours}h resolution target`) and the per-ticket `SLABadge`/`SLACountdownClocks`. A 4-row table (§8) is new but trivial — pure display of data already fetched.

**Existing multi-panel convention** — the create-request page itself has none, but the **Request Detail page** (`app/(app)/requests/[id]/page.tsx` → `RequestDetailTabs`) already does `flex flex-col gap-5 lg:flex-row lg:items-start` — a flexible left content column + a `sidebar` prop slot on the right, collapsing to one column below `lg`. This is the strongest in-repo precedent and the responsive convention this proposal follows.

**RLS** — `requests_select` already allows `requester_id = auth.uid() OR team_id = ANY(current_user_team_ids()) OR role IN (manager,admin,platform_owner) OR ...`. A "recently/frequently used" query scoped explicitly to `.eq('requester_id', <the specific requester>)` is safe under this policy and returns only that person's own rows, regardless of who is running the session — confirmed safe for §17's "personal shortcuts" requirement.

---

## 3. Current UX Problem

On desktop (1440px+), a 768px-wide form centered in the page leaves roughly 40–45% of the content area as dead space either side. The form itself doesn't need to be wider — stretching every input full-width would hurt scannability, not help it. The opportunity is to use the freed space for **context** (what is this service, what's the SLA) and **shortcuts** (what do I usually raise here), not to enlarge the form.

---

## 4. Universal Design Principles

1. **Zero service-specific code.** The workspace renders from `service`, `resolveServiceFormSections(service)`, and `sla_policy` — the same three inputs the page already has. No `if (service.slug === 'it')` anywhere.
2. **The center form's business logic is untouched.** This is a layout/wrapper change, not a form rewrite.
3. **Shortcuts feed the existing form state, they don't bypass it.** Clicking a shortcut sets Category/Sub Category through the same state `DynamicForm` already manages — same validation, same conditional-field behavior, same submit path.
4. **Personal, not popular.** Recently Used / Frequent Issues are always `requester_id = current user AND service_id = current service` — never org-wide aggregates.
5. **Graceful nothing.** No history → hide or subtly empty, never fabricated suggestions.

---

## 5. Proposed Desktop Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  existing DESK sidebar (unchanged)  │        workspace content area      │
│                                      │  ┌───────────────────────────────┐│
│                                      │  │ Compact Service Header         ││
│                                      │  └───────────────────────────────┘│
│                                      │  ┌───────┬───────────────┬───────┐│
│                                      │  │ LEFT  │    CENTER      │ RIGHT ││
│                                      │  │ 22%   │  Request Form  │ 23%   ││
│                                      │  │       │     55%        │       ││
│                                      │  │About  │                │Your   ││
│                                      │  │SLA    │  (existing     │Freq-  ││
│                                      │  │Recent │  DynamicForm,  │uent   ││
│                                      │  │Used   │  untouched)    │Issues ││
│                                      │  └───────┴───────────────┴───────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

CSS grid: `grid-template-columns: 22% 1fr 23%` with `gap: 18–20px`, inside the existing content padding — the DESK sidebar is completely unaffected (this grid lives entirely inside the page's own `<main>` content, exactly where the current `max-w-3xl` div sits today). Panels use `align-items: start` so a short right panel doesn't stretch to match a tall form.

At **≥1920px**, cap the whole grid at a `max-width` (e.g. 1680px, centered) rather than letting the form panel grow unbounded — verified in the mockup: an ultra-wide form starts to hurt scannability past roughly 640–680px of input width.

---

## 6. Proposed Tablet Layout

**1024×768 down to ~768px:** grid collapses to a single column via `grid-template-columns: 1fr` with CSS `order`: **Form first** (order 1), then Left panel content (order 2), then Right panel (order 3). Rationale: on a tablet, the task the user came to do (fill the form) shouldn't require scrolling past two side panels first. Verified in the mockup at 1024×768 — confirmed correct stacking order.

**768×1024 (portrait tablet):** same single-column order; cards keep their desktop padding since there's still room.

---

## 7. Proposed Mobile Layout

**≤480px:** single column, same order as tablet (Compact Header → Form → About/SLA/Recently Used → Frequent Issues). Field pairs that are side-by-side on desktop (`FieldGrid`'s 2-column pairing) drop to one field per row below ~560px — this already matches `DynamicForm`'s existing responsive behavior and needs no change. Verified in the mockup at 390×844 and conceptually applies identically at 430×932 / 360×800 (same breakpoint logic, no fixed pixel assumptions).

---

## 8. Service Header Design

Compact, single row: icon (from `service.icon` or `icon_image_url`) · `service.name` · small subtitle (`team.name`, and `service.description` if short enough to fit inline, else omitted here and shown in full in the left panel's About card) · right-aligned chips for SLA headline (`{defaultSla.resolution_hours}h resolution target` — already computed today, just relocated/restyled) and publish status. Replaces whatever larger header exists today; all values come from the already-fetched `service` object — nothing new to query.

---

## 9. Service Overview Design

**Finding:** `services.description` already exists as a column and is already fetched (`SERVICE_SELECT`). Use it directly — **no new field needed** for the common case. If a service's `description` is empty (some rows may not have one filled in), show the card with a neutral fallback ("No description configured for this service yet.") rather than hiding the card, so the layout doesn't visibly shift service-to-service. If in practice most services turn out to have no description populated, that's a content/data task for admins (Services config already has a description field to fill in), not a reason to invent a second, redesign-specific field — I'd avoid adding a parallel "workspace description" column unless real usage shows `description` is being used for something else entirely.

---

## 10. SLA Display

Read `service.sla_policy.config` (already fetched) and render one row per priority tier that has a value configured — `Urgent / High / Medium / Low`, each as `{response_hours}h / {resolution_hours}h`-style pair (mockup shows `"30 min / 2 hours"` formatting — sub-60-minute values should be shown in minutes for readability, everything else in hours). If `service.sla_policy` is null, omit the SLA card entirely rather than showing an empty table — confirmed via `resolveSlaDeadlines()` that a null policy is a valid, handled state today, not an error case.

---

## 11. Recently Used Logic

**Source:** the requester's own `requests` rows for the current service, most recent first, de-duplicated by `sub_category_id`, resolved to the sub-category's current name and its active parent category.

**Recommended query shape** (mirrors the existing `view: 'mine'` pattern in `lib/queries/requests.ts` — same RLS-safe `.eq('requester_id', userId)` filter, just scoped further):

```sql
select sub_category_id, max(created_at) as last_used
from requests
where requester_id = :userId and service_id = :serviceId and sub_category_id is not null
group by sub_category_id
order by last_used desc
limit 5   -- see recommendation in §28
```

Then a small join/lookup against `service_sub_categories` to resolve name + `category_id`, filtered to `is_active = true` and still tagged to this service (§16). This is a handful of rows in, not the full request objects — matches §23's performance requirement.

---

## 12. Frequent Issues Logic

Same base query, changing the ordering:

```sql
select sub_category_id, count(*) as uses, max(created_at) as last_used
from requests
where requester_id = :userId and service_id = :serviceId and sub_category_id is not null
group by sub_category_id
order by uses desc, last_used desc
limit 5   -- see recommendation in §28
```

`uses` is optionally displayed as the small count badge shown in the mockup (`Mouse Issue · 8`) — recommended as a nice-to-have, not required; call out as a decision point (§28.4).

---

## 13. Shortcut Interaction

Clicking any Recently Used or Frequent Issue item:

1. Resolves the item's `category_id` (already known — never re-derived from a name string).
2. Sets the form's existing `categoryId` state → the existing Category `<select>` updates.
3. Sets the form's existing `subCategoryId` state → the existing Sub Category `<select>` updates, using the **same** `subCategoriesInCategory` filtering `DynamicForm` already does for manual selection.
4. This is the exact same state `DynamicForm` reads for its `resolveSubCategoryForService()`-driven priority/SLA behavior on submit — no parallel logic, no second form state, nothing to keep in sync.
5. No dynamic fields currently change based on sub-category selection (confirmed in §2 — sub-category drives priority/SLA, not field visibility), so there's no "wait for fields to appear" step today; if that ever changes, the shortcut still goes through the same state and would pick it up automatically.
6. Smooth-scrolls the form into view (useful mainly on tablet/mobile where the form may be off-screen) — no field is force-focused, since which field the user needs next varies per template.
7. Normal validation still runs only on submit, unchanged.

Demonstrated live in the mockup: clicking "Network Issue" under Recently Used sets Category → "Network", Sub Category → "Network Issue", with a brief highlight flash on both fields.

---

## 14. Empty States

- **No history at all for this service:** hide Recently Used and Frequent Issues individually (each collapses independently — a user might have recent-but-not-frequent history, or vice versa in edge cases like exactly one past ticket).
- **Both panels empty:** collapse the entire right panel and let the grid become `22% / 1fr` (left + wider form) — demonstrated in the mockup via the "Simulate new user" toggle switching to Finance (a service with zero sample history).
- **No SLA policy:** omit the SLA card (§10).
- **Long list of dynamic fields:** no special handling needed — the form card simply grows taller; side panels use `align-items: start` so they don't stretch to match, and on scroll they scroll away naturally with the page (not pinned/sticky, to avoid additional complexity in Phase 1).

---

## 15. Requesting on Behalf Of Behavior

**Recommendation: personal shortcuts stay the logged-in operator's own history, unaffected by who's selected in "Requesting on behalf of."**

Reasoning from the actual code: `canBookOnBehalf` is a permission on the **acting user** (agent/manager/admin), not a mode the requester enters — the picker exists so an agent can file a ticket *for* someone else while the agent is the one operating the UI. The shortcuts are a personal productivity aid for whoever is clicking through the form. If shortcuts switched to the selected person's history, an agent filing tickets on behalf of many different people all day would see the panels reshuffle on every selection, which is more disorienting than helpful, and would require an extra query (the target person's history) on every "on behalf of" change — a cost with no clear benefit, since the agent isn't the one who'll reuse the shortcut next time anyway. This matches the stated preference in the brief; flagging it as a recommendation rather than an assumption since it's a real product decision, not purely technical.

---

## 16. Dynamic Form Compatibility

No changes to: `DynamicForm.tsx`'s internal state, `resolveServiceFormSections()`, `FieldRenderer`, `PendingFileField`, `validateFieldValue()`/`validateRequesterFormCompletion()`, `createRequestCore()`, RLS policies, `generate_request_no()`, activity logging, notifications, SLA calculation, routing, or business rules. The redesign is a **new outer layout component** that renders the *existing* `<DynamicForm>` unchanged in its center slot, plus two new read-only side panels that only ever *write into* `DynamicForm`'s existing category/sub-category state via whatever prop/callback interface is chosen at implementation time (e.g. lifting `categoryId`/`subCategoryId` state up, or a small imperative setter passed down — an implementation-phase decision, not a Phase 1 one).

---

## 17. Security / RLS Considerations

- Recently Used / Frequent Issues queries must always include `requester_id = <the specific person whose panel this is>` explicitly — never rely on "current session" alone, since a manager/agent session's RLS grant is broader (team/subordinate visibility) than a plain requester's. Confirmed in §2/§17 of the findings above.
- Only aggregated `sub_category_id` + count/last-used need to reach the client — never full request rows, never another user's data. The browser should receive at most ~10 small rows for this feature, not request history.
- Sub-categories shown as shortcuts must be re-validated as currently active + still tagged to this service before rendering (§16 below) — RLS scopes *whose data* is visible, this is a separate *is this configuration still valid* check.

---

## 18. Performance / Query Strategy

- Two small `group by` queries (or one query producing both orderings client-side, given the row count is tiny — a handful of distinct sub-categories per requester per service in virtually all real cases) — not a scan of full ticket history.
- Recommend a composite index if this becomes a hot path: `(requester_id, service_id, sub_category_id)` on `requests` — call this out to whoever implements Phase 2 as a "check query plan first" item rather than a guaranteed requirement, since `requester_id` is likely already indexed for the existing "My Requests" view and the added filter may not need a new index at all.
- No N+1: the sub-category name/category lookup is a single `IN (...)` against `service_sub_categories`, not one query per shortcut.
- If a server-side aggregation turns out to be awkward to express safely with the RLS-scoped client, a small `SECURITY INVOKER` Postgres RPC (so it still runs as the caller, respecting RLS) is preferable to widening what the client can query directly — flagged as an implementation-phase decision (§28.10).

---

## 19. Existing Components to Reuse

- `DynamicForm`, `SectionBlock`, `FieldGrid`, `FieldRenderer`, `PendingFileField` — entirely as-is, just relocated into a new center slot.
- `SLABadge`-style badge treatment (visual language, not the component itself — that one is per-ticket, this is per-service).
- The `RequestDetailTabs` responsive convention (`flex ... lg:flex-row`, collapsing below `lg`) as the pattern precedent for the grid's own breakpoint behavior.
- `getAllowedSubCategoriesForService()` — already returns exactly the "active + tagged to this service" set needed to validate shortcuts (§16).

## 20. Components That May Need to Be Added

- `ServiceRequestWorkspace` (new outer layout, replacing the current page's bare `<div className="mx-auto max-w-3xl">` wrapper)
- `ServiceContextPanel` → `ServiceOverview`, `ServiceSlaSummary`, `RecentlyUsedIssues` (left column)
- `RequestShortcutPanel` → `FrequentIssues` (right column)
- One small query function, e.g. `getRequesterServiceShortcuts(userId, serviceId)` in `lib/queries/requests.ts`, returning both the recency-ordered and frequency-ordered lists in one round trip.

No new database tables are required for the core feature. The only optional schema touch is a `services.description`-adjacent decision already resolved as "not needed" in §9.

---

## 21. IT Example

Service: **IT** · Team: IT Group · SLA: 30m/2h – 2h/8h – 4h/24h – 6h/48h. Fields: Contact Number (Requester Detail), Serial Number + Subject (Ticket Detail), Description, Attachments — matches the example in the original brief exactly, and is the only one of the three samples that does. See mockup, default view.

## 22. Admin Repair Example

Service: **Admin Repair** · Team: Admin Group · SLA: 1h/4h – 2h/12h – 4h/24h – 8h/72h. Fields: Store/Location + Floor/Area (Location Detail), Urgency Reason + Vendor Visit Needed (Repair Detail) — deliberately different field set and section names from IT, proving the layout doesn't assume "Serial Number"/"Contact Number" exist. See mockup, "Admin Repair" tab.

## 23. Finance Example

Service: **Finance — Vendor Creation** · Team: Finance Group · SLA: 4h/24h – 8h/48h – 24h/72h – 48h/120h. Fields: Vendor Name, GSTIN, PAN, Bank Account Number, IFSC Code (Vendor Detail), Cost Center + Approving Manager (Approval Detail) — five+ fields across two sections, substantially larger form than IT, with zero Frequent Issues (demonstrates the right-panel-collapses empty state). See mockup, "Finance — Vendor Creation" tab, with "Simulate new user" checked.

---

## 24. Screens / Mockups

Open [`CITYKART-DESK-UNIVERSAL-REQUEST-FORM-MOCKUP.html`](./CITYKART-DESK-UNIVERSAL-REQUEST-FORM-MOCKUP.html) directly in any browser (double-click it, or drag it into a browser tab — it's a single self-contained file, no server needed). It is **not** linked into the running app and makes no network calls.

Verified live during this phase, in the actual browser pane:

| Breakpoint | Result |
|---|---|
| 1600×900 (desktop) | 3-panel grid renders correctly, all content present and correctly laid out |
| 1024×768 (tablet) | Collapses to single column, **Form → Left panel content → Right panel** order confirmed |
| 390×844 (mobile) | Single column, readable card sizing, no cramped multi-column squeeze |
| Service switch (IT → Finance) | Header, About text, SLA table, form fields, and both shortcut panels all change together — proving no service-specific hard-coding |
| Empty state (Finance, no history) | Both shortcut panels collapse; right panel disappears entirely; grid reflows to left+form only |
| Shortcut click ("Network Issue") | Category → "Network", Sub Category → "Network Issue" populated correctly with a highlight flash, confirmed via direct inspection of the resulting form state |

All sample data in the mockup is clearly labeled illustrative (banner at the top of the file) and does not reflect real user history.

---

## 25. Risks

1. **Shortcut/form state wiring is an implementation-time design choice**, not fully specified here (lift state up vs. callback vs. context) — low risk, but worth a short technical spike before coding.
2. **`services.description` may be empty for many/most currently configured services** — the layout handles it gracefully (§9), but the *value* of the About card depends on admins actually filling it in; worth a quick audit of current data before implementation, not blocking the design itself.
3. **SLA card omission logic** depends on `sla_policy_id` being null vs. an empty `config` object — worth confirming both states are handled the same way (treated as "no policy") when this is implemented, since the mockup can't verify real data shapes.
4. **Composite index** (§18) is a "measure first" item — adding an unnecessary index has its own cost; don't add speculatively.

---

## 26. Recommended Final Design

Three-panel desktop workspace (≈22% / 55% / 23%), collapsing to Form-first single column on tablet and mobile, built entirely from `service`, `resolveServiceFormSections(service)`, and two small requester+service-scoped history queries. Center form is the existing `DynamicForm`, untouched. Shortcuts write into the form's existing category/sub-category state rather than bypassing it. No AI, no new required tables, one optional small index to evaluate under real load.

---

## 27. Exact Implementation Scope — For Next Phase Only

*(Not started. Listed here only so approval can be scoped precisely.)*

1. New `getRequesterServiceShortcuts(userId, serviceId)` query in `lib/queries/requests.ts`.
2. New components: `ServiceRequestWorkspace`, `ServiceContextPanel` (+ `ServiceOverview`, `ServiceSlaSummary`, `RecentlyUsedIssues`), `RequestShortcutPanel` (+ `FrequentIssues`).
3. Modify `app/(app)/services/[slug]/page.tsx` to fetch the shortcut data and render `ServiceRequestWorkspace` instead of the current bare wrapper div — `DynamicForm` itself receives no prop changes beyond however shortcut-click state gets wired in.
4. Wire shortcut clicks into `DynamicForm`'s existing category/sub-category state (exact mechanism TBD at implementation time — see Risk #1).
5. No migrations required for the base feature.

---

## 28. Design Decisions to Call Out

1. **Desktop column proportions:** 22% / 55% / 23%, capped to a centered max-width (~1680px) above ~1920px viewports.
2. **Max Recently Used items:** 5 (spec suggested 3–5; the mockup uses 3 for IT to match the brief's example exactly, but 5 reads fine in the layout — recommend 5 as the general cap).
3. **Max Frequent Issues items:** 5 (spec suggested 4–6; 5 keeps both panels visually balanced against each other).
4. **Request counts displayed?** Yes, as a small muted badge next to each Frequent Issue (shown in mockup) — adds useful context at negligible visual cost.
5. **Right panel collapses when no history exists?** Yes — confirmed working in the mockup; grid reflows to left+form.
6. **Tablet stacking order:** Form → Left panel content → Right panel (confirmed live in the mockup at 1024×768).
7. **Mobile stacking order:** same as tablet (confirmed live at 390×844).
8. **Shortcuts auto-scroll/focus?** Scroll the form into view, yes; auto-focus a specific field, no (which field is "next" varies too much per template).
9. **Requesting on behalf of:** shortcuts always reflect the logged-in operator's own history, never the selected on-behalf-of person's (§15) — recommendation, following the brief's stated preference and consistent with the code's actual permission model.
10. **Query strategy:** two small `group by`-style aggregate queries (or one combined), RLS-scoped exactly as `getRequests('mine')` already is today; a `SECURITY INVOKER` RPC as a fallback if the plain client can't express it cleanly.
11. **Database/index requirement:** none required to ship; a composite `(requester_id, service_id, sub_category_id)` index on `requests` is a "measure, then maybe add" item, not a prerequisite.

---

## UNIVERSAL REQUEST FORM UX SAMPLE READY FOR USER REVIEW

**NO APPLICATION CHANGES MADE**
**NO DATABASE CHANGES MADE**
**NO GIT PUSH MADE**
**NO MAIN DEPLOYMENT MADE**

**AWAITING USER DESIGN APPROVAL BEFORE LOCAL IMPLEMENTATION**
