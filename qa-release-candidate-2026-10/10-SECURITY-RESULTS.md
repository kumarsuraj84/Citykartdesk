# 10 — Security results

Scope: re-validate the earlier VAPT / ISO-27001 / SOC-2 work, attack the new features (AC PMS, approval history, Sheet Masters, vendor module), and probe the running QA app. Done only on the isolated stack. Authorised testing of the owner's own system.

## 1. Re-validation of earlier findings

The earlier assessment (`security-assessment-2026-10/`) left security tests for each fixed finding. All were run again in the final regression:

* `tests/vapt/*` — 23 files, 205 tests, **205 passed** (confidentiality, integrity, ticket-action authorisation, approvals separation of duties, projects/tasks privacy, permission matrix, auth and integrations, admin exports and files, concurrency and idempotency, multi-organisation isolation, onboarding / password enforcement, vendor module and mail journey…).
* `tests/remediation/*` — 32 files, 181 tests, **181 passed** (approval hardening and compensation, delegate, status races, system log, mailbox settings, reliability simulations…).

**Reopened vulnerabilities: none.** No earlier fix was found to be exploitable again.

## 2. New findings in this QA

| ID | Sev | Finding | Status |
|---|---|---|---|
| QA-D002 | **P1** | A **manager** could change categories (and their switches AC PMS / auto-CVM-approval / approval-history), form templates and technician groups through the data API (row rules allowed `manager`). A manager could therefore switch off the CVM approval of a category. | **Fixed** (migration 185). Apply to dev and live. |
| QA-D003 | P2 | Sign-in, forgot-password and reset-password forms sent the **password in the web address** when submitted before the page had finished loading. | **Fixed** (`method="post"`) |
| QA-D019 | P2 | The System Log **integrity check silently verified only the first 500,000 rows** and reported the whole log as intact. Tampering with newer records would not have been reported. | **Fixed** |
| QA-D005 | P2 | **Dependencies:** `npm audit` = 3 critical, 6 high, 5 moderate. The one that matters for the running app: **Next.js 16.3.8** (critical: unauthenticated remote code execution in the image optimiser when SVG files are used; denial of service through Server Actions). Fix is **Next 16.4.3 (minor step)**. vitest / tinypool (critical) and vite are test and build tooling only. | **OPEN — needs your OK** |
| QA-D014 | P3 | Same approval decided twice at once stores two decision rows. | open |
| QA-D016 | P2 | Outage of the sign-in service was reported as "Invalid login credentials" and counted toward the lockout. | Fixed |

## 3. Dynamic probes of the running QA app

| Probe | Result |
|---|---|
| Security headers on `/login` | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` present; no `X-Powered-By`. **Content-Security-Policy is report-only (known).** HSTS not sent over plain http (expected on this local copy). |
| Stored XSS / HTML / SQL text in subject and description (img onerror, script, svg onload, javascript: link, iframe, `' OR 1=1 --`, `DROP TABLE`, `{{ticket_no}}`, `${7*7}`) | stored as text; shown literally on the ticket page and in the list; nothing executed; mail has it escaped; tables intact — **PASS** |
| Role access: requester, technician, vendor pushed at admin pages, queue pages, exports and admin APIs | all redirected or 403 — **PASS** |
| Another user opening someone's approval link | "You are not authorised" — **PASS**; the used link says "already decided" (replay safe) |
| Vendor opening another company's or a CVM ticket | 404 — **PASS** |
| Job routes (`alerts`, `csat`, `masters/sync`, `pms/daily`, `email/inbound-sync`, `system-log/*`) without the secret | 401 — **PASS** |
| Webhooks without a valid signature (Gmail, Outlook → 401; WhatsApp unsigned payload for an unknown number: ignored, nothing stored; verify handshake with a wrong token 403) | **PASS** |
| Files: unauthenticated attachment / storage paths, path-traversal text in the public storage path | redirected to sign-in — **PASS** |
| Open redirect via `?next=https://evil…` on login, `/auth/callback`, `/auth/confirm` | ignored, sent to Home — **PASS** |
| Data API as nobody (signed out) on the new tables | cannot read or write — **PASS** (`qa-security-new-features`) |
| Data API as manager / requester / technician / vendor on category switches, form templates, groups | cannot change (after 185) — **PASS** |
| Tenant isolation (another organisation's admin sees nothing) | `tests/vapt/29` and the System Log screen tests — **PASS** |
| Approval history leaks | store 1 sees only store 1; only people who can decide see the box — **PASS** |

## 4. Not done

Credentials attacks against the live sign-in (only unit-level throttling tests), CSRF beyond the framework's own origin check, fuzzing of file uploads and of the sheet parser, denial-of-service load, penetration of the NAS / servers / network (out of bounds), source-code secrets scan of git history. See report 18.

## 5. Verdict

No reopened vulnerability; two real security defects found and fixed (D002 P1, D003 P2) plus an audit-trail defect (D019). **One security item still open and important: the Next.js upgrade (D005)** — recommended before any release. **CONDITIONAL on D005 and on applying migration 185.**
