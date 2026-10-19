# 07 — UI / UX / Accessibility Audit

*Real pages of the audit app (`localhost:3310`) in the built-in browser, at phone (375 and 640 px), tablet (768 px) and desktop (1280 px and the pane's native width). Screenshots are in `audit-2026-10/evidence/remediation/uat/`. Scope rule followed: **no wholesale redesign** — only small, low-risk fixes were made; everything larger is reported for approval.*

## 1. Method

* Visual review of the key screens per size (requester home, service form and its validation, ticket detail as requester and technician, request list, Smart Dashboard, SLA policy admin).
* A scripted accessibility check run on the live pages: page language, a single `h1`, landmarks, images without alternative text, buttons/links without an accessible name, inputs without a programmatic label, heading-level skips, positive `tabindex`, duplicate ids, zoom blocked by the viewport tag, interactive targets smaller than 24 × 24 px (WCAG 2.2 AA 2.5.8), text contrast against the nearest solid background (WCAG AA: 4.5:1 normal, 3:1 large), and horizontal page scroll.
* Pages scanned: Smart Dashboard, Requests list, service request form, Approvals, Notifications, Profile, ticket detail.

## 2. What is good

* Language is set, each page has one `h1` and a `main` landmark; no images lacking alternative text; **no unnamed buttons or links on any scanned page**; no duplicate ids; no positive `tabindex`; browser zoom is **not** blocked; no horizontal page scroll at any tested width.
* Form errors are inline, specific and next to the field ("Asset tag is required.", "Asset tag must be at least 3 characters.") and the technician's rule message is explicit ("Fill in the required field before changing status: Technician note.").
* Hostile text is displayed as plain text; layouts reflow cleanly: the phone layout switches to a bottom navigation bar, the request table scrolls inside its own container on tablet (the page itself does not scroll sideways).

## 3. Fixed in this pass (small, low-risk; verified live)

| # | Finding | Where | Fix | Verified |
|---|---|---|---|---|
| UI-1 | **Header overflowed on phones.** At 375 px the search field was a fixed 256 px and the logo box 196 px, so the theme switch, approvals, notifications and avatar were pushed off the right edge and unreachable | `components/layout/AppShell.tsx`, `GlobalSearch.tsx`, `BrandLogo.tsx` | Header spacing and logo shrink on phones (the image class is applied only below the `sm` breakpoint), the search field takes the remaining width. Desktop header is unchanged | Before/after screenshots `mobile-375-header-overflow-BEFORE.jpg` / `…-AFTER.jpg`; desktop re-checked at 1280 |
| UI-2 | Request-list search box had no accessible name (placeholder only) | `app/(app)/requests/page.tsx`, `requests/queue/page.tsx` | `aria-label="Search tickets"` | scan re-run: 0 unlabeled inputs |
| UI-3 | The comment box had no accessible name | `components/requests/CommentForm.tsx` | `aria-label` "Public comment" / "Internal note" | scan |
| UI-4 | The global search input was only 20 px tall (target size) | `components/layout/GlobalSearch.tsx` | The input fills its 36 px pill | scan: the approvals page now reports 0 targets under 24 px |
| UI-5 | Empty-state helper text (e.g. "All requests have been reviewed.") had contrast **3.34:1** | `components/ui/EmptyState.tsx` | `#8A8AA8` → `#6B6B88` (≈ 5.1:1) | scan |

## 4. Reported, **not** changed (so it can be decided)

| # | Finding | Severity | Why not changed / recommended next step |
|---|---|---|---|
| UI-6 | **Muted small text sits just under AA** on tinted backgrounds: 10–12 px text at **4.46:1** (e.g. the period buttons 60d / 90d, the group chip "IT SUPPORT", "Public" labels) | Low | It comes from the theme's `--muted-foreground` token used across the whole application; changing a token is a visual change everywhere, which this pass was told not to do without approval. Recommended: darken the token slightly (≈ 4.6:1) |
| UI-7 | **Small interactive targets**: status and priority chips and the "Any category…" filters are 22 px high; "Edit name" is 22 × 22; breadcrumb links 16–20 px; the profile page check box is 13 × 13. 66 of 202 targets on the Smart Dashboard are under 24 px | Low–Medium | Density is a deliberate design choice; recommended: 24 px minimum hit areas (padding without changing the visual size) |
| UI-8 | Heading level skips on the service form page (h1 → h3) | Low | Cosmetic for screen-reader navigation |
| UI-9 | The inline "Severity is required." message sits behind the open dropdown on the form | Low | Visual overlap only |
| UI-10 | Keyboard-only walk-through, screen-reader test, 200 % text zoom, high-contrast mode, print styles, right-to-left and every theme variant were **not** audited | — | Out of reach of this method; a manual accessibility review is recommended before any formal accessibility statement |

## 5. Tool limitations and false alarms (so they are not mistaken for defects)

* The contrast check cannot read gradient backgrounds: white text on the dark-blue gradient buttons and the avatar initials "AS" were measured as 1.0–1.09:1 and are **not** real failures (white on dark navy). They were excluded from the counts above.
* The first scan of Home reported "no `h1`": it ran while the page was still on its loading skeleton. The page does have an `h1` (the greeting); no change was made.
* Contrast was computed for the default theme only (the application has several colour themes).

## 6. Responsive checks

| Width | Pages | Result |
|---|---|---|
| 375 px | Smart Dashboard, request form | After UI-1 everything in the header is reachable; no horizontal page scroll; filters wrap |
| 640 px (native pane) | Request form and validation, ticket detail, technician messages | Bottom navigation, readable, no overflow |
| 768 px | Requests list | Table scrolls horizontally inside its container; page does not |
| 1280 px | Requests list, home | Full sidebar and header, unchanged by UI-1 |

Evidence files: `desktop-1280-requests-list.jpg`, `desktop-requester-home.jpg`, `tablet-requests-list.jpg`, `mobile-request-form.jpg`, `mobile-form-validation-errors.jpg`, `mobile-ticket-detail-script-text-escaped.jpg`, `mobile-technician-required-field-message.jpg`, `mobile-375-header-overflow-BEFORE.jpg`, `mobile-375-header-AFTER.jpg`.
