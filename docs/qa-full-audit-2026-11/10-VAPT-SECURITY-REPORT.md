# 10 — VAPT and Security Report

Scope: local only (audit copy, made-up accounts). No production system was probed. Method: SAST (code review + search), SCA (`npm audit`), local DAST/API/RLS probes, OWASP API Top 10 mapping, infrastructure configuration review (read-only, from the repository). **Not a certification.** Penetration testing of the live environment, network/firewall review, TLS review and physical/AD controls are **NOT RUN** (out of scope: no production access).

## Plain summary
- **No way was found to read or change another person's data, to become an administrator, or to run script through user-entered text.** 21 black-box probes ran (19 clean, 2 flagged as known design points); 136 database tables, 31 anonymous-callable functions, 4 storage buckets and 37 API routes were checked.
- The biggest open item is **software version risk**: the web framework in use (Next.js 16.3.8) has two critical published advisories. I checked whether this app can be reached by them: it does not appear to be (the vulnerable features are not used), but the fix (≥ 16.4.6) should be planned.
- A few **known design choices** weaken defence in depth (report-only browser security policy, session cookie readable by script, no TLS). They are owner decisions already documented in the repository.

## Method and coverage
| Technique | What | Result |
|---|---|---|
| SAST (manual + search) | all 37 API routes for an authentication gate; all server actions for a role check; search for `eval`, `dangerouslySetInnerHTML`, shell calls, admin key in browser code, committed secrets, file serving | **PASS** (details below) |
| SCA | `npm audit` (outbound to registry.npmjs.org, public package names only — the only deliberate outbound call of the audit) | 26 advisories: 3 critical, 6 high, 16 moderate, 1 low |
| DAST (black box) | `security/sec-dast.mjs`: anonymous API sweep, headers, cookies, open redirect, brute force, enumeration, token pages, cross-site request forgery, IDOR, vertical access, vendor isolation, stored XSS, hostile search text, path traversal | 21 checks: 18 PASS, 3 NOTE, 0 FAIL after fixing my own probe mistakes |
| RLS / data boundary | each person's own token through the data API: anonymous on 136 tables, store/vendor/technician matrices, hostile writes, function execution, second organisation, storage | all PASS except 1 NOTE (`app_settings`) |
| Config review | `next.config.ts`, `proxy.ts`, headers, cookies, startup warnings | see findings |
Evidence: `evidence/security/` (`dast-run-4.log` final, `dast-results.json`, `rls-visibility-matrix.json`, `anon-callable-functions.txt`, `npm-audit-2026-11-16.json`).
Four of my own probe scripts were wrong at first (wrong columns, a false "leak" from script file names, an inconclusive CSRF replay) and were corrected before the final run; CSRF is now proven with a real cross-site page and a positive control.

## What held up (evidence)
- **S01** all 37 API routes x GET/POST refuse anonymous callers (only health, version and the webhook handshakes answer by design).
- **S04** hostile `?next=` values never leave the site. **S05** brute force: after repeated wrong passwords the app locks sign-in ("Too many login attempts") and refuses even the right password for a while. **S06** no account enumeration on "forgot password".
- **S08** a page on another site cannot make the browser act as a signed-in user (cookie `SameSite=Lax`; positive control proves the test can see a real request).
- **S10–S12** a store user cannot open another person's ticket, PDF or attachments; store users and vendors are refused on admin, export and report endpoints; a vendor cannot open Citykart-only tickets.
- **S13** script in a ticket title/description is shown as text everywhere. **S14/S15** 27 hostile search requests and 7 path-traversal probes: no error, nothing leaked.
- **R01** anonymous sees zero rows in all 136 tables. **R03** a vendor reads only his company's 4 of 3,284 tickets. **R04** 8 hostile writes (self-promotion to admin, change organisation, edit others' profile/ticket, forge a ticket, create a team, write settings) all refused. **R05** 31 functions callable anonymously: none returned data. **R06** a second organisation sees 0 rows of the first across 12 tables and cannot write into it, and the reverse. **R07** private buckets are not listable.
- Server actions: every exported action reaches a role/ownership check through a helper (vendor actions via `vendorTechAndTicket`, reports via `authorizeReportAccess`, PO via `authorise`, public links via token). File downloads: content type comes from the file extension table, `nosniff`, only images/PDF/text open inline (HTML/SVG never), the path must belong to the ticket.
- No secret-looking strings in tracked source (one test fixture only) and none in 733k log entries (SOC02).

## Findings
Severity scale: P0 release blocker, P1 high, P2 medium, P3 low, P4 info. "Fix status" refers to this local audit.

| ID | Sev | Finding | Evidence / root cause | Fix status / residual risk |
|---|---|---|---|---|
| V-001 | **P1** (scan: critical) | Next.js 16.3.8 has advisories GHSA-2464-fhr4-w9xw (RCE in the image optimiser with SVG), GHSA-673q-mjm6-r5xr (RCE in `use cache` returning typed arrays), GHSA-p3m5-59mp-jv5r (DoS in Server Actions). Fixed in ≥ 16.4.6. | `npm audit`. **Reachability checked:** the app does not use `use cache`; the image optimiser refuses SVG (HTTP 400 "image type is not allowed") and remote URLs; the Server Actions DoS advisory cannot be ruled out (the app uses Server Actions everywhere; it was not exploited or tested here). | **OPEN — owner decision / next release.** Upgrade on its own branch with the full four-layer regression + load smoke. Residual: DoS advisory applies. |
| V-002 | P2 | `zod` 4.4.3: memory exhaustion validating oversized collections (high). Fixed ≥ 4.6.6. | npm audit; request bodies are capped (256 KB–30 MB) which limits but does not remove it | OPEN — upgrade |
| V-003 | P2 | `nodemailer` 10.0.10 / `mailparser` 3.9.28: 5 address-parsing flaws (recipient injection through odd quoting), a slow-regex DoS | npm audit; the app builds recipients from its database and parses inbound mail | OPEN — upgrade (fixed in newer 10.x/11.x) |
| V-004 | P3 | `sanitize-html` 2.18.0 unbounded recursion with a discarded iframe | npm audit | OPEN — upgrade |
| V-005 | P3 | Transitive/dev-only: undici, body-parser, hono, fast-uri, vitest/tinypool (critical, test tool only), shadcn tooling (high) | npm audit; none runs in the live app except undici inside Node tooling | OPEN — `npm audit fix` on the upgrade branch; dev-only items are not live exposure |
| V-006 | P2 | Content-Security-Policy is **report-only** and allows `'unsafe-inline'` and `'unsafe-eval'` for scripts | S02; `next.config.ts` (owner decision D-033) | OPEN — design decision. Without it, an injected script would not be blocked (none was found). |
| V-007 | P3 | Session cookie `sb-…-auth-token` is not HttpOnly (readable by page script) | S03; documented in `docs/HTTPS-AND-CSP-PLAN.md`: the browser Supabase client reads it (used on 2 screens) | OPEN — design decision; becomes more important if V-006 stays open |
| V-008 | P2 | The site is served over plain HTTP (no TLS, no HSTS, cookie without `Secure`) | S02/S03; owner decision (HTTP only for now) | OPEN — known residual risk R-HTTP: sign-in passwords travel unencrypted on the LAN/WAN path |
| V-009 | P3 | `app_settings` (retention days, `policy.*`, PO approver id) is readable by every signed-in user including vendors | R02, policy `app_settings_read … authenticated true` | OPEN — low; nothing secret today; never store a secret there. Restricting read to staff is a one-line migration (owner decision) |
| V-010 | **P2** | `TRUSTED_PROXY_HOPS` is not set (startup warning): the caller's address is unknown, per-address rate limits are off and log entries carry no IP | start-up log; SOC06 (address on 0/6 entries) | **OPEN — owner/ops check on live**: whether it is set there (not verified: no production access). |
| V-011 | P3 | The Zoho tab's "not connected" message shows the server file path `app\standalone\.env.local` and setting names to managers | UAT E | OPEN — small text change |
| V-012 | P4 | Unused default image files (`next.svg`, `vercel.svg`, `globe.svg`, `file.svg`, `window.svg`) are served from `/public` | file list | OPEN — cosmetic cleanup |
| V-013 | P3 | Role changes through the data API are refused by column grants (good); but SOC09 shows that few profile-change log rows name the person (see 14) | SOC09 | see SOC-G4 |

## OWASP API Security Top 10 (2023) mapping
| Risk | Assessment |
|---|---|
| API1 Broken object-level authorisation | PASS (S10, S12, R03, R06) |
| API2 Broken authentication | PASS with notes (lock-out works; no TLS V-008; cookie V-007) |
| API3 Broken object property-level authorisation | PASS (R04 mass-assignment writes refused; data API hides secret-looking columns) |
| API4 Unrestricted resource consumption | PARTIAL: body caps, rate limits and page caps exist; heavy pages scale poorly (see 09: PERF-001/002/004) |
| API5 Broken function-level authorisation | PASS (S11, server-action review) |
| API6 Unrestricted access to sensitive business flows | PASS for tested flows (webhook replay idempotent, scheduler claims) |
| API7 Server-side request forgery | PASS by design: no user-supplied URL is fetched; image optimiser refuses remote URLs |
| API8 Security misconfiguration | PARTIAL: V-006, V-008, V-010 |
| API9 Improper inventory management | PASS: 37 routes enumerated (report 03) and each gated or public by design |
| API10 Unsafe consumption of APIs | PASS for tested inbound webhooks (signed, size-capped) |

## Not tested
Live firewall/proxy/TLS configuration; the NAS share permissions; SQL Server/AD; mobile apps; social engineering; DoS of the live host; real third-party integrations (Meta, Google, Microsoft, DeskTime, CKOneAI machine); authenticated scanning with a commercial DAST tool (none available).

## Retest
All fixes in this audit are local code changes with tests (see 15). The dependency findings need a dedicated upgrade branch; **re-run `npm audit` and `sec-dast.mjs` after upgrading**.
