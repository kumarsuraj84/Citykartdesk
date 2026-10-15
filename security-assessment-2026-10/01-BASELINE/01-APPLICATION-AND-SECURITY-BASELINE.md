# 01 — Application and Security Baseline (CKDesk, 2026-10-15)

## 1. Code state at the start of this assessment
| Item | Fact (checked, not assumed) |
|---|---|
| Working branch | `security/vapt-iso27001-soc2-local` (created from `main`; nothing pushed) |
| Base commit | `717e5c6` = `main` = `origin/main` at the time (the "no manual priority change" release) |
| Production build running | `20261015-145217` on 10.0.1.98 = this same commit (deployed earlier on 2026-10-15 by the normal release procedure, before the assessment began) |
| Tracked changes in working tree | `.claude/settings.local.json` (developer's local tool settings, never committed) and `vitest.config.ts` (exclude `tests/vapt/**` from the default run — added by this assessment) |
| Untracked | 28 earlier audit / design / report files and folders (e.g. `audit-2026-10/`, deploy bundles); not touched |
| Recent LOCAL changes confirmed present in the checkout | no manual priority change (`changePriority`/`bulkChangePriority` removed), no service change (`reclassifyRequest` removed), "Catch me up" ticket summary, System Log (+ Logs screen, log shipper), approval e-mail link with code, approval reminders, resolution-note rules, e-mail reply sync with short timeouts, India-time display |
| Total commits in history | 271; many `feature/*` branches exist locally |
| Runtime | Next.js **16.2.9** (App Router, Server Actions, `proxy.ts`), React 19.2.4, Node 24.14, self-hosted Supabase (Postgres + PostgREST + GoTrue + Storage). A second, older component `api/` (own Dockerfile + `railway.toml`) is in the repository; its role is part of this review. |
| Database | 164 migration files (up to `…163`). Disposable audit DB has them all (verified); 222 RLS policies; 39 `SECURITY DEFINER` functions in `public` |

## 2. Module inventory (60 pages, 27 API routes, 54 server-action files with 295 exported actions, 19 RPCs called from code)
- **Service desk:** Home, Services catalogue and per-service request forms, Requests (my requests, agent queue/board, ticket page with conversation, tasks, details, time, history, "Catch me up"), Approvals (+ public approve link `approve/[token]`), Tasks, Projects, Notifications, Profile, public CSAT page `csat/[token]`.
- **Analytics:** Dashboards (normal + Interactive/Smart), Report Builder, Predefined Reports, pivot reports, Logs.
- **Intake intelligence:** Dashboard, Inbox, Queue, Review, Channels (Gmail/Outlook/WhatsApp), Rules, Settings.
- **Administration:** Users, Technician Groups, Roles & Permissions, Service Catalog, Form Templates, Field Library, SLA Policies, Categories, Business Rules, Approval Flows, Request Config, Task Configuration, Org Settings, Platform Settings, Master Data, Knowledge Base, Runbooks, System Log, Event Log, Monitoring, DeskTime.
- **API routes:** health, version, cron-style jobs (alerts, business rules, CSAT, approval reminders, DeskTime sync, intake classify, e-mail inbound sync, system-log archive/ingest), webhooks (Gmail, Outlook, WhatsApp), OAuth start/callback, storage (attachments, previews, public bucket), PDF, events, notifications, CSP report, auth callback/confirm.
- **Background jobs:** Windows scheduled tasks `CitykartDesk-Cron-*` calling the cron routes with a shared secret, plus the log shipper.

## 3. Roles and security boundaries
Roles: `user` (requester), `agent` (technician), `manager`, `admin`, `platform_owner` (audit DB sample: 300 / 24 / 5 / 5 / 2). Boundaries, from outermost to innermost:
1. **Network edge:** the app is served over plain HTTP on a public address (known open item D-018: HTTPS is a deployment decision).
2. **`proxy.ts`:** session check for every page/route except an exact allowlist; verified-user header is signed; cron/webhook routes authenticate themselves.
3. **Server Actions / route handlers:** role and ownership checks in code (`getCurrentProfile()`).
4. **PostgreSQL:** RLS policies on every table, triggers (status-transition guard, immutability), column grants; the app calls the database as the signed-in user (not the service role) for normal work.
5. **Storage:** attachments go through app routes that check access; local file volume / NAS.

## 4. Where documents and reality differ (recorded, not hidden)
- Older documents still mention the retired server 10.0.1.12; the current production is 10.0.1.98 / 10.0.0.205 / NAS 10.0.0.25.
- `AUDIT-STATE.md` says the earlier remediation branch was "local only, not pushed"; later it was merged and deployed (build `20261014-095639`). The October remediation reports therefore describe code that is now live.
- Migration history on the disposable audit DB is not tracked in a history table (objects exist, version table stops at 155). Production tracks history in `auth.schema_migrations`.
- `types/database.ts` is maintained by hand.

## 5. Existing audit status
See `03-EXISTING-AUDIT-RECONCILIATION.md` (every earlier finding classified against current code) and `04-CONTROL-EVIDENCE-INVENTORY.md` (what the repository shows about management controls).

## 6. Evidence classes used throughout this assessment
A = verified LOCAL technical evidence (our own tests on the isolated stack) · B = repository evidence · C = authorised organisational evidence (none supplied so far) · D = documentation-only · E = missing/unverified.
