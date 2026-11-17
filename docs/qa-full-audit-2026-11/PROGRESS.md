# QA full audit 2026-11 — progress file (resume from here)

Scope: LOCAL only. No commit, push, merge, deploy, live access, or real e-mail/WhatsApp. Stop after the final local report.
Test environment: the isolated AUDIT stack (Docker `*_ckdesk_audit`, Supabase 127.0.0.1:55421, app :3310), synthetic data only.
Run everything through `powershell -NoProfile -File audit-2026-10\guard\run.ps1 -- <command>` (loads audit env, preloads egress guard, gate must pass).

## Phase checklist
- [x] A0 Baseline recorded (main 6a160dd == origin/main, tree clean, live = 70906f4)
- [ ] A1 Audit DB schema level vs main migrations
- [ ] A2 Fix isolation gap C6 (ZOHO_DB_* fall through from dev .env.local)
- [ ] A3 Isolation gate passes via run.ps1
- [ ] B  Baseline: full existing test suite (unit + integration), tsc, eslint
- [ ] C  Feature inventory
- [ ] D  Smoke + system + UAT personas (browser)
- [ ] E  UI/UX/accessibility/responsive
- [ ] F  Security (SAST/SCA/DAST/API/RLS)
- [ ] G  Workflow engine + concurrency
- [ ] H  Failure recovery
- [ ] I  Performance
- [ ] J  SOC readiness
- [ ] K  Compatibility
- [ ] L  Defect fixes + regression
- [ ] M  Final reports 01..18 + verdict

## Log
- 2026-11-16 A0 baseline: main 6a160dd == origin/main, clean tree, live app = 70906f4 (health read-only).
- A1 audit DB was at migration 163 (main = 195): snapshot taken (evidence/db/audit-db-before-migrations.dump, 76 MB), 31 migrations applied (164..195, 176 does not exist on main), PostgREST restarted.
- A2 isolation gap C6 found and fixed: the dev .env.local ZOHO_DB_* fell through into audit runs. Added ZOHO_DB_* to audit env -> disposable DB `zohoaudit` (61 synthetic Zoho tickets, read-only login).
- A3 isolation gate via run.ps1: PASSED 21/21.
- B baseline (audit mode): tsc 0 errors; eslint 0; unit 2400 tests (2398 pass, 2 skipped opt-in CKOneAI bench); integration 420 (402 pass, 18 skipped = WhatsApp "production catalog" UAT needs real catalogue); remediation 181/181; vapt 410 (405 pass, 5 FAIL).
- B triage: all 5 vapt failures = tests stale vs deliberate behaviour changes (F-001..F-005), 4 test files corrected, re-run 410/410 expected (4 files re-run: 34/36/70/72 = 63 pass). Hygiene finding H-1: suites + dev server rewrite tracked files (AGENTS.md, evidence jsons) - restore with git checkout after each run.
- Personas seeded (docs/qa-full-audit-2026-11/seed/seed-personas.mjs): qa11.* @audit.test, password in script. Audit app running dev mode on :3310 (log in evidence/audit-app-dev.log).
- 2026-11-16 D smoke suite (smoke/smoke.mjs) 13/13 PASS after 3 script bugs of my own were fixed (promise index, timing, %20 path). Stray folder D:\ANKUR%20AI%20PROJECTS (my smoke screenshots only) could not be removed: safety check refused rm -rf; owner may delete it.
- [2026-11-16] Egress evidence preserved (31 refused outbound attempts, 14 distinct targets incl. graph.facebook.com, smtp.gmail.com, api.resend.com, 10.0.0.205:5432, 10.0.1.98/10.0.1.12:3210); tool side-effects reverted.
- [2026-11-16] UAT A (store AC complaint) + B (fixture -> CVM approval): 11/11 PASS (evidence/uat/uat-ab-results.json). Setup note: demo service is location-restricted (QA STORES/QA HEAD OFFICE); demo store users had no location -> service correctly hidden (404) -> gave them QA STORES in the audit DB.
- [2026-11-16] F-006 found+fixed: demo sheets held real-looking staff e-mails (one with a mistyped domain). F-007 observed: stale local .next/standalone bundles local-testing/*.csv (555 staff e-mails); deploy script has no content guard.
- [2026-11-16] UAT C (SLA escalation) 11/11 PASS; D (vendor parts/PO, 12 steps through the UI) 12/12 PASS; E (Zoho read-only, 10) 10/10 PASS; F (CKOneAI bridge + data API vs signature-checking stub, 2 off-phase + 16 on-phase) PASS; G (WhatsApp webhook black-box, 12) 12/12 PASS. Audit app is currently running via evidence/start-audit-f.cjs (assistant+data API ON with synthetic secrets, stub on 127.0.0.1:8100 only while a test runs).
- Observations: Zoho "not connected" message shows server path app\standalone\.env.local to managers (P3); keep-alive ECONNRESET seen once in F10 (0/36 on repeat) - watch in load test; "notify managers" rule reaches ALL managers of the org.
- [2026-11-16 15:10] E UI/UX/a11y DONE (E1 sweep): Chrome 157 full matrix 564 checks (9 personas x pages x 6 widths 360/390/768/1024/1366/1920): 0 load failures, 0 sideways-scroll, axe WCAG2.0-2.2 A/AA + best-practice. Edge sweep (reduced matrix 201 checks, 3 widths): 0 failures. Keyboard/focus pack K01-K11 (Chrome+Edge) 11/11 not failing. Firefox / Safari NOT TESTED (not installed).
  Defects: UI-001..UI-011 (see 15 register). Fixed locally: a11y names/labels on 10 admin screens, public-page main landmark, skip link, login error role=alert, scrolling tables keyboard-reachable, run-books/tasks headings, drawer inert, report field duplicate key (UI-006), modal focus return with autoFocus (UI-010). Regression: ui-a11y-regress.mjs 20/21 FAIL -> 21/21 PASS; unit tests added: accessibility-names (+7), report-form-field-keys (4), modal-focus-return (2).
  Open (design decisions, P3): contrast near-misses on small tinted badges, 24px target size on small controls, nested-interactive on executive calendar day cell, assistant dock has no Escape-to-close, React dev warning for the layout theme <script>.
  Test-artifact learned: 'color-contrast' at 1920 on many pages was the mouse resting on a sidebar heading mid hover transition - not a defect.
- [2026-11-16 15:10] F SAST/SCA started: npm audit (outbound to registry.npmjs.org, public package names only) 26 advisories: next 16.3.8 critical x2 (not reachable here: no `use cache`, SVG optimisation refused 400), zod 4.4.3 high DoS, nodemailer/mailparser/sanitize-html moderate, vitest/tinypool critical = dev only. Not upgraded (owner decision, needs full regression). Server actions + 37 API routes reviewed: all guarded.
- [2026-11-17] Later phases done: G performance (3k/100k/500k tickets x 1-100 users, soak 15 min, stress 100/200), H workflow engine 5/5, I failure recovery 7/7, J SOC readiness 13 checks, K compatibility (Chrome/Edge only). Reports 01-18 written.
- [2026-11-17] Final regression after last code change: tsc 0, eslint 0, unit 2424 pass/2 skipped, integration 402 pass/18 BLOCKED, remediation 181/181, vapt 410/410. First pass had 6 failures caused by my 100k synthetic tickets left in the audit DB (above the 30k dashboard cap); removed them, re-ran, all pass.
- [2026-11-17] Clean-up: synthetic tickets removed (3,284 left), audit apps on 3310/3311 stopped, tool-rewritten tracked files restored (egress summaries copied to evidence/egress-final). STOP: waiting for owner review. Nothing committed/pushed/deployed.

- [2026-11-17] Zoho transfer stage 4 local QA done (report 19): hard cases 8/8, Zoho-unreachable 4/4, authorisation 6, browser 53x2 PASS, 10,000 tickets moved for real in 6.8 min (1,470/min, 0 notifications), scheduled-job silence proved (0 vs 4,000). 4 defects fixed (QA-001..004), H-4 test hygiene noted. Full regression: unit+integration 2,916 (2,895 pass, 1 fail = H-4, 20 skipped), remediation 181/181, vapt 410/410. Nothing committed/pushed/deployed.
