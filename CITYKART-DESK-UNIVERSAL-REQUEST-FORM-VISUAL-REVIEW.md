# Citykart Desk — Universal Request Form: Visual Design Review

Companion to [`CITYKART-DESK-UNIVERSAL-REQUEST-FORM-UX-PROPOSAL.md`](./CITYKART-DESK-UNIVERSAL-REQUEST-FORM-UX-PROPOSAL.md). That document covers the architecture and reasoning; this one is the visual proof.

**These are not mockup graphics.** Every screenshot below is the real Citykart Desk application — real sidebar, real topbar, real breadcrumb, real `<DynamicForm>` component, real form controls — running on local dev, rendered via a temporary preview route and captured headlessly at exact viewport sizes. The only new code is the surrounding layout; the form itself is byte-for-byte the same component that's live today.

All screenshots are in [`design-review-screenshots/`](./design-review-screenshots/).

## How this was built (so you can verify it yourself)

A temporary route at `app/(app)/preview-redesign/[slug]/` — not linked from any nav, reachable only by typing the URL directly — fetches the service exactly the way `app/(app)/services/[slug]/page.tsx` does and renders the same, unmodified `<DynamicForm>` in a new 3-panel wrapper. It's still running on your local dev server right now if you want to click through it yourself:

- `http://localhost:3210/preview-redesign/it`
- `http://localhost:3210/preview-redesign/admin`
- `http://localhost:3210/preview-redesign/hr`
- add `?counts=0` to any of those to see Frequent Issues without the count badges

**Recently Used / Frequent Issues are sample data** (there's no real request history to draw from right now — local data was reset earlier in this session). But the category/sub-category names and their parent-category relationships are **real**, pulled directly from this org's configured `service_sub_category_tags` — not invented. That was a specific correction from the last round: IT's "Network Issue," "Mouse Issue," and "Laptop Issue" all actually live under one real category, **IT SUPPORT** — not split across invented "Hardware"/"Network"/"Software" categories like the first mockup showed. I checked the actual data this time before building anything.

I'll leave the preview route in place until you're done reviewing — say the word and I'll delete the whole `app/(app)/preview-redesign/` folder.

---

## 01 — IT, Desktop (1600×900)

**[design-review-screenshots/01-IT-DESKTOP.png](design-review-screenshots/01-IT-DESKTOP.png)**

The primary approval view. Real DESK sidebar and topbar on the left/top, breadcrumb (`Services > IT > Create Request`), compact service header with team + SLA chip, then the 3-panel workspace: About/SLA/Recently Used on the left, the real Ticket Description form in the center, Your Frequent Issues on the right. Recently Used shows Network Issue / Mouse Issue / Laptop Issue — the exact example from the original brief, and all three really are IT Support sub-categories.

## 02 — Admin Repair, Desktop

**[design-review-screenshots/02-ADMIN-REPAIR-DESKTOP.png](design-review-screenshots/02-ADMIN-REPAIR-DESKTOP.png)**

Different service, different everything: SLA numbers change (1h/6h urgent vs. IT's 30min/2h), Recently Used shows real Admin categories (Tap Replacement under Washroom, Earthing under Electrical Problem), and the center form is visibly longer — Admin Repair's real Form Template has two extra fields technicians fill in after the fact (Repaired Item Qty, Vendor Ticket Creation Date, Vendor Ticket Number), shown here read-only/disabled exactly as the real requester-facing form already renders them. Nothing about the layout assumes IT's field set.

## 03 — HR, Desktop

**[design-review-screenshots/03-HR-DESKTOP.png](design-review-screenshots/03-HR-DESKTOP.png)**

A third, again-different service. This one shows **Recently Used populated but Frequent Issues empty** — a real, plausible state (someone with a couple of recent HR tickets but not enough volume yet to have a "frequent" pattern) — and demonstrates that the two shortcut panels collapse *independently*, not as a single all-or-nothing unit.

## 04 — IT, Tablet (1024×768, full page)

**[design-review-screenshots/04-IT-TABLET.png](design-review-screenshots/04-IT-TABLET.png)**

Full-page capture so you can see the whole stack, not just what fits above the fold. Confirms the recommended order: compact header → full form → About/SLA/Recently Used → Frequent Issues, single column, no cramped 3-column squeeze.

## 05 — IT, Mobile (390×844, full page)

**[design-review-screenshots/05-IT-MOBILE.png](design-review-screenshots/05-IT-MOBILE.png)**

Same order as tablet. Real DESK bottom nav bar visible, confirming this is genuinely the mobile app shell, not a desktop page just narrowed. One honest observation: Category and Sub Category sit side-by-side even at this width and their labels truncate ("Search cate…" / "Pick a cate…") — that's the *existing* `DynamicForm` layout behavior (it pairs short fields into 2-column rows regardless of screen width), not something this redesign introduced or changed. Worth a look independent of this project, but out of scope here since it's pre-existing.

## 06 — New User / No History

**[design-review-screenshots/06-NEW-USER-NO-HISTORY.png](design-review-screenshots/06-NEW-USER-NO-HISTORY.png)**

Used a real, currently-configured service (Legal) that has no sample shortcut data at all, to show the genuine empty state rather than staging a fake one. Right panel disappears entirely, the grid reflows to left+form only (26%/74% instead of 22%/55%/23%), and Recently Used shows a quiet "No recent requests yet for this service" line instead of vanishing awkwardly or showing fake suggestions.

## 07 — Shortcut Interaction

**[design-review-screenshots/07-SHORTCUT-SELECTED.png](design-review-screenshots/07-SHORTCUT-SELECTED.png)**

This is the real `DynamicForm` category/sub-category picker, actually clicked through programmatically (not simulated with a screenshot edit) — Category now reads **IT SUPPORT**, Sub Category reads **MOUSE ISSUE**, both populated via the same real dropdown component a user would click, with a small green "✓ Mouse Issue selected" confirmation shown beneath. Focus lands naturally on the next field (Subject). No request was created — this is exactly as far as a shortcut click should go per the spec: fill the form's existing fields, then get out of the way.

## 08 vs. 09 — Counts or No Counts on Frequent Issues

**[08-FREQUENT-WITH-COUNTS.png](design-review-screenshots/08-FREQUENT-WITH-COUNTS.png)** · **[09-FREQUENT-WITHOUT-COUNTS.png](design-review-screenshots/09-FREQUENT-WITHOUT-COUNTS.png)**

Same page, only the count badges (`8`, `5`, `3`, `2`) toggled off in 09.

---

## Recommendations

**Desktop target: 01-IT-DESKTOP.png.** It's the cleanest demonstration of the full concept and matches the brief's own example content most closely.

**Counts: keep them (08, with counts).** Side by side, the bare list without counts (09) reads slightly emptier and loses a small but genuinely useful signal — "8" next to Mouse Issue tells you at a glance this is a well-worn path, not just a recent one. The badge is small and muted enough that it doesn't compete with the row label for attention. I'd keep it.

**Visual concerns worth flagging:**
- The Category/Sub Category side-by-side pairing gets tight on mobile (see #05) — pre-existing `DynamicForm` behavior, not part of this redesign, but you'll see it in the same screenshot so it seemed dishonest not to mention it.
- Both "About [Service]" cards in these screenshots show sparse real descriptions (IT's is literally just the word "IT") — this is real current data, not a rendering bug. Confirms the Risk #2 already called out in the proposal doc: the About card's usefulness depends on someone eventually filling in fuller `services.description` values for each service. The layout itself handles it gracefully either way.
- Nothing else stood out as a problem — spacing, borders, and typography all read as consistent with the rest of DESK because they *are* the rest of DESK (same Tailwind classes, same component library, same cards).

---

## UNIVERSAL REQUEST FORM VISUAL MOCKUP READY FOR REVIEW

**REAL APPLICATION REMAINS UNCHANGED**

**NO DATABASE CHANGES MADE**

**NO GIT PUSH MADE**

**NO MAIN DEPLOYMENT MADE**

**AWAITING USER VISUAL APPROVAL BEFORE LOCAL IMPLEMENTATION**
