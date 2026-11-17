# 07 — System, Smoke and Regression Results

## Plain summary
A 13-step smoke test through the real screens (as real browser users) passes 13/13. The much larger regression pack (existing 3,400+ automated tests plus the new browser sweeps) is green after fixes. Everything ran against the isolated audit copy.

## Smoke suite (`smoke/smoke.mjs`) — 13/13 PASS
| # | Check | Result |
|---|---|---|
| S01 | Application starts and reports healthy | PASS |
| S02 | Requester can sign in | PASS |
| S03 | Requester dashboard (Home) loads | PASS |
| S04 | Ticket creation: form → submit → ticket page | PASS |
| S05 | Technician sees the new ticket and picks it up | PASS |
| S06 | Status update: Start Working → In Progress | PASS |
| S07 | Approval: send → approver approves → back to In Progress | PASS |
| S08 | Attachment upload and download | PASS |
| S09 | Search finds the ticket | PASS |
| S10 | Administrator configuration pages load | PASS |
| S11 | Vendor login is restricted to the vendor area | PASS |
| S12 | Critical dashboards load | PASS |
| S13 | Logout ends the session | PASS |
Screenshots: `evidence/smoke/`. Three script errors of my own were found and fixed while building the smoke (promise index, timing, a `%20` folder) — they were test-script mistakes, not product defects.

## System-level checks added in this audit
| Area | Checks | Result |
|---|---|---|
| Whole-app page sweep (63 pages, 9 personas, 6 widths) | 564 Chrome + 201 Edge | PASS (no load failure, no sideways scroll, no error page) |
| Unauthenticated API sweep | all 37 API routes x GET/POST | PASS |
| Production build compiles and starts | `next build` + `next start` on the audit stack | PASS (build log `evidence/perf-build.log`) |
| Health, version, public asset routes | `/api/health`, `/api/version` | PASS |

## Regression
- Re-ran the full existing suites in audit mode (06). After the accessibility and report fixes, the affected suites (accessibility-names, ui-resilience, ui-helpers, modal-focus-return, report-form-field-keys, reporting-related units) all pass.
- Page behaviour regression: `ui/ui-a11y-regress.mjs` 21/21 pages clean; `ui/ui-keyboard.mjs` 11/11 not failing in both browsers.
- **A final full four-layer regression run is recorded in 17.**

## Not run
- Tests that need the real outside world: live mail (SMTP/Resend), live WhatsApp send, mailbox sync (Google/Microsoft), DeskTime, Google Sheet API sync, Web Push delivery to real devices. They are **NOT RUN (outside the isolation)** and need a staged check in a controlled environment before release.
