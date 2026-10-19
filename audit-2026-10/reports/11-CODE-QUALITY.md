# 11 — Code Quality, Reliability & Performance Review

*Consolidated from the code-quality/reliability/performance agent (37 findings, CQ-01..CQ-37). Read-only; no server, no tsc, no network run by the reviewer. The audit DB is near-empty so volume claims are code-derived, not measured — those needing real scale are deferred to report 08.*

**[cap]** marks a finding whose severity depends on PostgREST's `max_rows = 1000` cap (true of the dev stack, the audit stack, and hosted Supabase; "Main"/production's `postgrest.conf` sets no cap at all per `deploy/windows/config/postgrest.conf.example`, so those specific items do not bite the same way in production — but the *code* is still fragile and will bite the moment anyone enables a cap or a Supabase migration).

## HIGH

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| CQ-01 | Five near-identical offset-paging loops (`analytics.ts`, `fixed-reports.ts`, `store-ac-stats.ts`, `store-dims.ts`, `store-snapshot.ts`) drop `error` and silently truncate at 50,000 rows with no `truncated` flag surfaced to the UI. Only `executive-dashboard.ts`'s copy does it right (throws on error, flags truncation). | `if (error || !data) break` with no re-throw | One shared `fetchAllPages()` throwing on error, returning `{rows, truncated}`; surface `truncated` in the UI. |
| CQ-02 | Inbound email reply: the dedupe row (`processed_inbound_emails`) is written *after* the comment append, and is written as `'matched'` even when the append failed — a transient DB error permanently loses that reply (marked processed, never retried); concurrent runs can also double-post. | `lib/email/inbound.ts:123, 175-179` | Insert the dedupe row first as a claim (unique-violation = skip); only mark `'matched'` once the append actually succeeded. |
| CQ-03 | CSV/Report-Builder: approvals export does `.in('approval_id', ids)` with up to 10,000 UUIDs (~370KB URL) and drops the error on overflow — the "Decisions" column silently goes blank past a few hundred rows (same bug class as the already-fixed WhatsApp `.in()` issue). `selectInBatches` also ignores per-batch errors. | `lib/export/reports.ts`, `lib/queries/reporting.ts:370` | Batch the `.in()` (reuse the existing 200-id batching pattern from `reporting.ts:344`), throw on batch errors, add a deterministic `.order()`. |

## MEDIUM (selected — full list of 24 items in the agent transcript, folded into report 13 per-finding)
- **CQ-04/05**: Executive Dashboard and Report Builder ship up to 30,000/20,000 full ticket rows to the browser per view, uncached, re-queried on every load — fine today, a real problem at 100k+ tickets (feeds report 08's load-test plan).
- **CQ-06**: Home dashboard re-scans all open tickets + 30 days of history + all store-linked profiles on every manager/admin page view, no caching.
- **CQ-07/08**: Business-rules and alerts cron jobs: dedupe-after-act ordering (claim should come before executing actions, not after), so an overlapping/duplicate cron tick can double-fire notifications and assignments.
- **CQ-09**: The shared Supabase fetch wrapper (`resilient-fetch.ts`) retries non-idempotent POST/PATCH requests on any `AbortError`/`ECONNRESET`, which can duplicate a ticket creation if the original request actually succeeded server-side but the response was lost.
- **CQ-10/11/12/13/14/15**: A cluster of status-change race conditions — `assignRequest`'s optimistic lock only covers `assigned_to` not `status`; the Waiting-on-User auto-resume path (3 separate implementations) lacks a `.eq('status','waiting_user')` guard; `applyStatusChange` logs failure *after* the status row is already committed, skipping the mandatory-comment/notification steps that should follow; priority/category changes recompute SLA even on closed tickets; Business Rules' own status/assignment logic is a third, drifted copy of the same bookkeeping.
- **CQ-16/17/18**: Intake "approve and create" is multi-step with no rollback and a non-unique index (can create duplicate tickets from one email); `submitForApproval` can strand a ticket in `pending_approval` if the later status-update step fails; OEM auto-routing reports "sent to OEM" even when the underlying email send failed.
- **CQ-19/20/21/22/23**: Outbound email/push/WhatsApp/DeskTime/OAuth calls mostly lack any abort timeout; email/push dispatch inside `notify()` runs unawaited (lost on process restart); DeskTime sync is fully sequential with no per-employee isolation (one failure drops the whole org's sync); cron jobs have no overlap lock; IMAP reply-sync re-downloads and re-parses the full 3-day mailbox window on every tick before checking dedupe.
- **CQ-24/25/26**: Rate limiter keyed on spoofable `X-Forwarded-For`; several more `.in()`/`.or()` calls with unbounded id arrays (same URL-length failure class as CQ-03); several more unpaged reads feeding dashboards/admin lists that silently undercount past the 1000-row cap.
- **CQ-27**: Admin "invite user" is multi-step (auth user → profile → mobile number → team) with no compensation/rollback on a later-step failure.
- **CQ-28**: Business logic duplicated 3-5× across the codebase with **confirmed drift** — four different copies of status labels (one missing `assigned`/`waiting_user`, with stale `on_hold`/`pending` literals that leak raw enum values into CSV exports), five different copies of SLA-breach math that disagree with each other for cancelled/no-timestamp tickets.
- **CQ-29**: Weak runtime validation at the server-action boundary — 209 `as unknown as` casts, 33 `as any`, `typescript.ignoreBuildErrors: true` in `next.config.ts` (type errors never fail the production build), unbounded array sizes accepted by several bulk actions, unknown `form_data` keys stored verbatim (ties to SEC-A-06).

## LOW / INFO (selected)
- 10 exported server actions have zero callers in the app but remain live, callable endpoints (`duplicateRequest`, `claimReview`, `assignReviewer`, `approveReview`, `deleteNote`, `setNotificationPreference`, `updateUserOrgFields`, `tagServiceTemplate`, `convertServiceFormToTemplate`, `linkDuplicateFieldGroup`).
- "Data Retention" admin settings are stored but only `app_event_log` is ever actually purged (the promised nightly purge of `notifications`/`request_activity`/`conversation_events` does not exist).
- No idempotency key on ticket creation; a lost response + CQ-09's retry can duplicate a ticket.
- Attachment download route buffers the whole blob with no HTTP Range support; soft-deleted attachments whose storage removal fails are never garbage-collected.
- A handful of hard-coded config literals (a demo-user UUID in `app/(app)/layout.tsx`, `imap.gmail.com`, default sender address) — low risk, flagged for cleanup.
- `console.log('[EMAIL DISABLED] To: …')` logs recipient + subject when email is unconfigured — low-sensitivity but worth routing through the existing redacting logger.
- All significant in-memory state (rate limiter, alert dedupe, CC address-book cache) resets on every process restart — acceptable for a single-instance deployment, worth noting for any future horizontal scale-out.

## Test coverage gaps (feeds report 15)
Cron routes (`csat/run`, `desktime/sync`, `email/inbound-sync`, `intake/cron/classify`) have no concurrency/double-run test; `applyStatusChange` is only exercised indirectly; no test injects a failing Supabase response to exercise the CQ-01/03/12/18 error paths; `lib/desktime/*`, `lib/actions/export.ts`, several admin actions (`categories`, `services`, `teams`, `workflows`, `business-rules`, `sla-*`), and `lib/push/send.ts` have no direct tests at all.

## Checked and found OK
- `createRequestCore`'s request-number generation is atomic (`INSERT … ON CONFLICT DO UPDATE … RETURNING`); org/team/sub-category/location checks are present and correct.
- `applyStatusChange`'s optimistic lock, pause-credit math, and mandatory-remark enforcement are all correct in the primary path.
- `autoCloseDueRequests` is correctly guarded and idempotent across concurrent runs.
- Attachment validation order (storage write → DB row → compensating remove on DB failure) is correct; size/extension/MIME/magic-byte checks are present.
- SMTP transport has pool + timeouts; `getCurrentProfile` correctly retries transient errors rather than bouncing to login; WhatsApp webhook handling (signature check, per-sender rate limit, bounded retries, audited failures) is solid.
- `reporting.ts`'s own 200-id `.in()` batching is the *correct* pattern the other unbounded sites should copy.
- No unused runtime dependencies found; heavy server-only libraries (`exceljs`, `pdfkit`, `nodemailer`, `imapflow`, `web-push`) are never imported from client code.
