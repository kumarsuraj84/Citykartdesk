# Executive Audit Summary — Citykart Desk

**Date:** 2026-10-13 · **Scope:** local, read-only + one disposable isolated environment · **Branch audited:** `main` @ `e215ebd` · **Production:** 10.0.1.98 / 10.0.0.205 / 10.0.0.25 — **never contacted**

## Classification

**LOCAL AUDIT VERIFIED WITH CONDITIONS — USER REVIEW REQUIRED**

Phase 0 (architecture) and Phase 1 (isolation gate, 21/21 checks) are complete and certified. The functional inventory (16 + 14 modules) and a six-angle security/quality review are complete, with 2 of the 4 Critical findings reproduced live against a disposable, synthetic-data copy of the database. Performance/scale load-testing, full end-to-end UAT walkthroughs, and the remediation/regression cycle were **not** run in this pass — see "Not done in this pass" below. This is an intermediate checkpoint, not a release-readiness certificate.

## What was built to do this safely
- A second, fully disposable Supabase stack (`ckdesk_audit`, ports 554xx, app on `localhost:3310`) built from the repo's own 156 migrations — no production or dev data touched it.
- A synthetic dataset (329 fake users, 200 fake stores, 3,000 fake tickets, all `@audit.test`) for anything needing realistic volume.
- An in-process network guard that refuses any connection to the three production machines (and the retired server) **before** a socket opens — tested live, 6/6 refusals confirmed, zero packets sent.
- A 21-point isolation gate that must pass before any dynamic test runs; it passed every time it was run.
- Full detail: [`02-LOCAL-ISOLATION-CERTIFICATION.md`](02-LOCAL-ISOLATION-CERTIFICATION.md).

## Headline numbers

| | |
|---|---|
| Modules inventoried | 30 (16 ticket-flow + 14 admin/reporting) |
| Security findings | 4 Critical, 24 High, 31 Medium, ~45 Low/Info |
| Code-quality findings | 3 High, 24 Medium, ~10 Low/Info |
| Unit tests | **961 / 961 pass** |
| Integration tests | 389 / 419 pass on first run; **all 6 failures were test-environment artifacts** (stale hard-coded container name, missing synthetic fixture data) — fixed in the test harness itself, then 100% pass. No application code bug caused a test failure. |
| Typecheck | passes | Lint | 1 pre-existing error, 5 warnings (none introduced by this audit) |

## The one fix that matters most
**`x-verified-user-id` request-header trust.** Five of six independent reviewers — looking at completely different parts of the app (admin actions, requester actions, the proxy itself, attachments, webhooks/approvals) — separately flagged the same root cause: a few request paths (static-asset-shaped URLs, public API routes, the e-mailed approval and CSAT links) forward a client-settable header that the app treats as a verified identity, instead of re-checking the session on every request. That five-for-five convergence from independent angles is unusually strong signal. It is a **code-level fix in two files** (`proxy.ts`, `lib/queries/profiles.ts`) — not a redesign — and should be the very first thing fixed.

## Other Critical/High findings reproduced live (not hypothetical)
Working directly against the disposable database (synthetic data, throwaway test organization, nothing production-adjacent):
- An unauthenticated caller deleted a whole organization via a database function that should require ownership.
- A technician moved their own account into a different tenant; an admin promoted themselves to the top role; a deactivated account reactivated itself — all through direct, ordinary API calls the app itself never makes, but which the database currently allows.
- Company-wide configuration (business hours, SLA escalation rules) was readable with no login at all, and writable by any manager — of *any* tenant, not just their own.
- A requester inserted a ticket already marked resolved with a due date in the far future; a technician renumbered a ticket to collide with another one.

All of these are **database permission gaps**, fixable with small, targeted SQL migrations plus regression tests — not architectural rewrites. None require touching the `requests`/`profiles` tables' *shape*, only their access-control policies.

## What wasn't done in this pass (and why)
- **Remediation.** Per your own embedded instructions ("stop for user approval before... significant authentication/RLS changes"), and because all four Critical findings are exactly that, **no fix has been applied yet.** The findings are fully written up with evidence and a recommended fix each; I'm waiting for your go-ahead before writing the migrations and regression tests.
- **Load/scale testing** (50–1000 concurrent users, 100k–500k historical tickets) — not run this pass; the audit stack is ready for it, this is a separate, longer session.
- **Full manual UAT walkthroughs** per role (requester/technician/manager/admin journeys end-to-end in the browser) — the module inventory and code review substitute for this today; a dedicated pass would add confidence on the UX side specifically.
- **UI/UX & accessibility audit, NAS/storage-substitute failure-injection testing, reliability/chaos testing** — deferred; none of these change the security picture above.
- One Critical finding (public storage proxy route) was **not dynamically exploited** — it's flagged for a safe unit test (feeding malformed inputs to the route handler in isolation) rather than a live traversal attempt, pending your go-ahead.

## Safety confirmation
- No connection was made to 10.0.1.98, 10.0.0.205, or 10.0.0.25. No production NAS file was accessed. No production email/WhatsApp message was sent. No live configuration was changed. No production service was restarted.
- No git push was performed. No MAIN deployment occurred.
- Working-tree changes from this session: 3 test files patched so they target whichever local stack they're actually run against (was hard-coded to the dev stack's container name — a latent bug, now fixed, that would have made them silently test the wrong database); `.claude/settings.local.json` modified (pre-existing, unrelated to this audit). Nothing else touched.
- Full reports: [`01`](01-CURRENT-ARCHITECTURE.md) · [`02`](02-LOCAL-ISOLATION-CERTIFICATION.md) · [`03`](03-MODULE-INVENTORY.md) · [`04`](04-SECURITY-AUDIT.md) · [`06`](06-DATABASE-INTEGRITY.md) · [`11`](11-CODE-QUALITY.md) · [`13`](13-MASTER-DEFECT-REGISTER.md).

## Recommended next step
Tell me to proceed with remediation and I will, in this order, each with its own regression test and a before/after check:
1. The header-trust fix (SEC-01) — small code change, highest leverage.
2. The three database permission gaps reproduced above (owner_delete_org, profiles self-update, global config tables) — one combined migration + tests.
3. The storage-path validation unit test (confirms or clears the one unverified Critical).

I will stop and ask again before anything beyond that (e.g. the broader RLS/status-machine hardening in report 06, or the mass-assignment fixes in reports 04/11) since those touch more surface area.

---
**CKDESK LOCAL AUDIT COMPLETED (this pass)**
**PRODUCTION APP, DB AND NAS REMAIN OUT OF SCOPE**
**NO GIT PUSH**
**NO MAIN DEPLOYMENT**
**AWAITING USER REVIEW AND EXPLICIT APPROVAL**
