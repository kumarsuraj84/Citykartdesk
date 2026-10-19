---

# Part 15 — Audit trail and error capture: what exists and what is missing

*Questions from the user: are the audit logs and event logs a real audit trail, can they be combined into one, and does the app capture all errors (from clicks and without clicks, app side, database side, storage side, user side, admin side, internal or external)? The assessment below comes from the code and database as audited. **Nothing has been built yet for this**; the design is proposed and waiting for the user's go-ahead.*

## 15.1 What exists today

| Record | Where | Captures | Limits |
|---|---|---|---|
| Admin audit log | `admin_audit_log` | catalog/service/SLA/business-rule/OEM/store-master/mailbox changes made through some admin actions | best-effort writer that swallows its own errors; most admin actions never call it; entity types mislabelled "service" in the viewer |
| Ticket activity | `request_activity` | created/assigned/status/priority/comment/attachment etc. | written by app code only; direct database writes leave no row |
| Task / project activity | `task_activity`, `project_activity` | task and project events | partial |
| Intake audit | `intake_audit_log` | WhatsApp/intake events | good coverage for that module only |
| Owner audit | `owner_audit_log` | owner-org events | one writer (WhatsApp channel-not-found) |
| Business-rule events | `business_rule_events` | which rule fired on which ticket | for de-duplication, not audit |
| Event log | `app_event_log` | pageviews, clicks, browser JS errors, render errors, "server_error", "system" (e.g. email sent) | **deleted after 90 days**; any logged-in user can add rows of any kind |
| Error reports | `error_reports` | browser crashes/feedback | browser side only |
| Console logs | server console | everything else | not stored anywhere queryable |

**Eight separate places, none complete.** Verdict: **not a complete audit trail**.

## 15.2 Gaps against normal audit expectations

- **Missing actions:** role changes, user deactivation/reactivation, invitations, password resets, bulk imports, team membership, org-structure changes, business-hours/holiday/alert-rule changes, global settings, retention changes, exports and report sends, scheduled-report changes, most project/task configuration.
- **No who/what/before/after/where:** no actor IP/user agent, no before-and-after values for most changes.
- **Not guaranteed:** logging is done by application code after the fact; a failure to log is silent; changes made directly in the database or by the service account bypass it.
- **Not tamper-evident:** nothing prevents the service account from editing or deleting rows; no hash chain; no separate compliance retention.
- **Retention:** event log purged at 90 days; others never purged (unbounded growth).
- **Reading it:** audit, event, error and activity views are separate screens with different filters.

## 15.3 Error capture gaps

Captured today: browser JavaScript errors, unhandled promise rejections and render errors (via the event tracker and the error boundary), and some server errors written as "server_error" events.

**Not captured:**
- **Server-side exceptions in the app** are not hooked at framework level (there is no `instrumentation.ts` / request-error hook), so unhandled errors in pages, route handlers and server actions only reach the console.
- **Silently swallowed errors:** many database calls ignore their error value (code-quality findings CQ-01, 03, 12, 18 and others), so a failure is never logged at all.
- **Database-side errors** (PostgreSQL, PostgREST statement and pool timeouts, auth service, storage service) exist only in each service's own log files on the server, not in anything the app or Claude can query. The performance test showed these (code 57014 timeouts, PGRST003) appear only in the PostgREST log.
- **Cron/scheduled job failures:** several jobs return HTTP 200 even when everything failed.
- **Outbound integration failures** (email, WhatsApp, push, OAuth, time-tracking): partly logged as events, not as errors with context, and not retried or queued.
- **Process-level crashes** (uncaught exception, unhandled rejection in Node) are not captured.
- **Storage/file errors** (upload/download/NAS availability) only logged to the console.
- No single place to filter all of the above by source (browser / app server / database / storage / cron / integration), severity, user, request, or whether a click caused it.

## 15.4 Proposed design (not built; needs the user's approval)

**One table, `system_log`**, append-only, for audit trail, events and errors together:
- Fields: time, org, **actor** (user id, role), **category** (audit / error / event / security), **source** (browser / app-server / server-action / api-route / cron / database / storage / auth / integration / admin), **action**, **entity** (type, id, label), **before / after** (changed fields only), **outcome**, **severity**, error message + stack + code, request id, path, IP, user agent, whether it came from a click (and which control) or not, correlation id, hash of the previous row.
- **Database triggers** on the important tables (profiles role/active changes, teams, services, SLA, settings, business rules, org structure, approvals, ticket status/assignment, storage metadata) so the trail is guaranteed even for direct database writes; the service account can insert but nothing can update or delete rows (permissions revoked plus trigger), with a hash chain for tamper evidence.
- **App-level capture:** one logging helper, a framework request-error hook, and a wrapper for server actions and route handlers so every unhandled exception is recorded; swallowed-error call sites changed to log; Node process-level handlers; the browser tracker kept.
- **Database/storage/auth errors:** a small log shipper (scheduled job on the app server) that reads the PostgREST, auth and storage service logs and PostgreSQL's error log and inserts them into `system_log`; plus the health check recording failures.
- **One admin screen** ("System Log") with filters (category, source, severity, user, entity, date, click vs non-click), CSV/JSON export, and a "copy for Claude" button that produces a compact, redacted error bundle (no passwords, tokens or personal data).
- **Retention:** errors/events 90-365 days (configurable), audit rows kept for years; old rows archived, never silently dropped.
- Existing tables kept and back-filled into the new one, then viewers switched over (no data loss).

Decisions needed from the user: required audit retention period; whether hash-chain tamper evidence is wanted; whether a log shipper may be installed on the app server (a production change, run by the user); and whether personal data (e.g. IP address) may be stored.
