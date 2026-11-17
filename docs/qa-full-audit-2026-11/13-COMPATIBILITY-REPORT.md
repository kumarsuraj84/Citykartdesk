# 13 — Compatibility Report

## Plain summary
The app was run in **Chrome 157 and Edge 157** (both Chromium) and in a phone-sized Chrome (touch emulation). Firefox, Safari, iPhone/iPad and real Android devices were **not available and were not tested**.

| Browser / device | Version | Method | Scope | Result |
|---|---|---|---|---|
| Chrome (desktop) | 157.0.8103.78 | automated, real browser | full matrix: 9 personas x 63 pages x 6 widths = 564 page views; keyboard pack K01–K11; 28 screenshots | **PASS** (no load failure, no sideways scroll, accessibility findings fixed locally; see 05) |
| Edge (desktop) | 157.0.4341.60 | automated, real browser | reduced matrix 201 page views (360/1024/1366 wide, every 2nd admin page); keyboard pack K01–K11 | **PASS** — same results as Chrome |
| Mobile Chromium (phone widths 360/390, touch + mobile user agent) | Chrome 157 **emulation** | automated | all page views at 360 and 390 wide, 320 px reflow on 4 pages | **PASS (emulation, not a real phone)** |
| Tablet width 768 | Chrome emulation | automated | all pages | **PASS (emulation)** |
| Firefox | not installed | — | — | **NOT TESTED** |
| Safari (macOS/iOS), iPhone, iPad | not available | — | — | **NOT TESTED** |
| Real Android phone / tablet | not available | — | — | **NOT TESTED** |
| Production build console check | Chrome 157 | the production-mode app (:3311) was exercised by the load and recovery tests; the development-only React warnings seen in development mode (duplicate keys, theme `<script>`) were not separately re-collected | **PARTIAL** |

Notes
- Chrome and Edge share one engine, so Edge adds little independent assurance; Firefox and Safari (different engines) are where layout and `date`/`file` input differences usually appear. The paste-to-attach and template menu fixes (report 15, UX-001/002) use standard events (`paste`, `pointerdown`) available in all current browsers; Safari behaviour on pasting copied Finder files is the most likely difference.
- Printing, PDF export rendering, and the Windows "Add to Home Screen" install were not tested.
- Recommended before release: a 30-minute manual pass on a real iPhone and an Android phone for sign-in, new request, ticket view, approval, plus Firefox for the same on desktop.
