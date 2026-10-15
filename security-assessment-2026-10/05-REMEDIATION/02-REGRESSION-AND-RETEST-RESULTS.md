# 05 / 02 — Regression and retest results (actual runs, final local code)

Environment: disposable audit stack only, through `audit-2026-10/guard/run.ps1` (isolation gate 21/21 before every run). Raw logs: `05-REMEDIATION/final-*.log`.

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | **0 errors** |
| Lint (`npm run lint`) | **0 errors, 5 warnings** (earlier baseline: 6 warnings) — plain `eslint .` is not the project script and also scans build folders |
| Production-mode build (`next build --webpack`, Next.js 16.3.8) | **built**; `/api/health` ok; app started and used in the browser |
| Default suite (unit + integration, 238 files) | **234 passed, 4 skipped files; 1,760 tests passed, 18 skipped, 0 failed** |
| Remediation suite (post-audit, 33 files) | **182 tests passed, 0 failed**. One run showed a fixture-teardown error in `110-approval-hardening` (a background write raced the cleanup); on two clean re-runs the file passed 10/10 |
| VAPT suite (exploit + regression, 4 files) | **16 passed, 0 failed** |
| Earlier flaky tests | `stage5-outbound-failure` / `stage6` (5 s timeouts under load) failed once in an early full run and passed on re-run; `approval-email-link` passed 11/11 on the final code |
| Skipped / blocked | 18 integration tests are skipped by design (they need a real mailbox, WhatsApp or provider: blocked on the isolated stack); 4 files skipped |
| Not executed | scanners (Semgrep, Gitleaks, OSV-Scanner, ZAP, Nuclei, Burp: not installed); full multi-role browser UAT (see below); a real Gmail/Outlook/WhatsApp round trip; load tests beyond the bounded latency check |

## Exploit → fix → retest (each pair run on the isolated stack)
| Finding | Before the fix | After the fix |
|---|---|---|
| VA-DB-01/TKT-01 priority | technician and manager changed priority through the data API | refused (T11, 2 tests) |
| VA-DB-01 SLA dates | technician pushed deadline +365 days and paused-time to 999,999,999 ms | refused (T11) |
| VA-DB-02 forged ticket | requester inserted an "urgent" ticket into another group's queue | refused (T11) |
| VA-DB-03 config | manager changed services, SLA policies, SLA config | refused; admin still can (T11) |
| VA-INT-01 internal-note file | requester could list/download it | hidden (T10) |
| VA-INT-03 notifications | collaborator received the note text | no note text sent (T10) |
| VA-INT-13 mobile numbers | requester read a colleague's number; manager attached a number | refused (T10) |
| VA-INT-10 direct upload | requester uploaded into the task store | refused (T10) |
| VA-API-02 reset flag | user switched it off | stays on (T10); server clears it after a real password change (remediation test) |
| VA-INT-02 e-mail reply | any employee/OEM accepted | participants only (T12, logic level) |
| VA-DB-11 code guesses | 20 parallel guesses all counted as tries | ≤ 4 accepted, then locked (unit) |
| zip bomb | fully unpacked | refused at the size limit (unit) |
| log flood | 120 forged reports → 120 rows | 30 rows (HTTP probe) |
| login CSRF | cross-site POST processed | 403; same-origin works (HTTP probe) |

## Functional regression (existing business flows)
Covered by the existing suites that passed: employee ticket creation and mandatory fields, technician queues and assignment, SLA pause/resume and reopen (status races, SLA tests), approvals (portal and e-mail link), notifications, e-mail reply sync, attachments, reports/exports and dashboards (including the dashboard-number-equals-pop-up parity test), System Log, WhatsApp mock flows, the full multi-role UAT lifecycle (`tests/remediation/90-uat-lifecycle`), bulk actions. Browser UAT on the final build: signed in as a synthetic technician, opened a ticket, pressed "Start Working" (status → In Progress), priority shown as a plain badge, no console errors. A multi-role browser pass (requester creating a ticket, manager views) was **not** done in the browser (the pane is narrow and each sign-in is manual); the same flows are covered by the automated UAT suite above.

## Things found while retesting (disclosed)
- The dashboard parity test failed once because my own browser-UAT ticket was still in the database; after removing it the test passed (test contamination, not a defect). Two stale fixture users remain in the disposable audit database (referenced by old activity rows).
- A "300-second background command finished" notice came before the suite ended on two occasions; the final numbers above are from the finished logs.
