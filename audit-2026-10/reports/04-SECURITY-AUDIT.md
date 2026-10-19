# 04 — Security Audit (OWASP ASVS / Top 10)

*Consolidated from four independent read-only reviews (requester-side actions = SEC-A, admin/report actions = SEC-B, database/RLS = DB, plus dynamic reproduction of the DB findings on the disposable audit stack) and cross-checked where they overlap. Confidence tags: **CONFIRMED-BY-CODE** (visible in source/policy text), **CONFIRMED-BY-CATALOG** (DB introspection), **EXPLOITABLE** (reproduced live on the audit stack, evidence in `audit-2026-10/evidence/db-dynamic-verification.json`), **NEEDS-DYNAMIC-TEST** (plausible from code, not yet run). Three more reviews (proxy/headers/sessions, attachments/XSS, webhooks/tokens) were still running when this report was written and will be appended as report 04b / folded into the register.*

**Per the environment's safety rules, this report describes each weakness, its evidence and its fix — it does not include runnable exploit code for the authentication-bypass finding (SEC-01 below); that finding's mechanism is described at the level needed to fix it, not to weaponize it.**

## Severity summary

| Severity | Count | Status |
|---|---|---|
| CRITICAL | 3 | 1 reproduced live (owner_delete_org); 2 confirmed-by-code (auth header, profiles self-escalation reproduced live under its DB id) |
| HIGH | 13 | 6 reproduced live; rest confirmed-by-code/catalog |
| MEDIUM | 19 | confirmed-by-code/catalog |
| LOW/INFO | 20+ | confirmed-by-code |

## CRITICAL

### SEC-01 · CRITICAL · Authentication can be bypassed on several routes via a forgeable header
**Found independently by two reviewers (SEC-A-01, SEC-B-01).** `lib/queries/profiles.ts` derives the signed-in user from the `x-verified-user-id` request header instead of re-verifying the session token on every request. `proxy.ts` sets this header correctly on the main, session-checked path, but several early-return branches (static assets, the public API allow-list, and the public `/csat/*` and `/approve/*` token pages) forward the request without first clearing a client-supplied copy of that same header name, because they `return NextResponse.next({ request })` before the header is normally set.
**Impact:** on a route that falls into one of those early-return branches, a request carrying a self-chosen `x-verified-user-id` can cause the app to treat the caller as a different user — profile reads and any logic keyed off `getCurrentProfile()` on that path trust the forged identity rather than the actual session.
**Fix:** derive identity only from a server-verified check (`supabase.auth.getClaims()` or `getUser()`) inside `getCurrentProfile()`, never from a client-controllable header; alternatively, explicitly strip any inbound `x-verified-user-id` header before the early-return branches so only the proxy's own, later-set value can ever reach the app.
**Confidence:** CONFIRMED-BY-CODE (both reviewers independently read the same code path). **Not dynamically exploited in this audit** — reproducing it would mean building and running the forged-identity request, which this audit declined to do; fix should be verified by a focused unit test on `proxy.ts`'s header handling instead of a live repro.

### SEC-02 · CRITICAL · `owner_delete_org(uuid)` callable by anyone holding the anon key — EXPLOITABLE (reproduced)
Function is `SECURITY DEFINER`, contains no caller/role check, and the migrations' `REVOKE EXECUTE … FROM anon, authenticated` never touched the default PUBLIC grant. **Reproduced live:** an anonymous request successfully deleted a throwaway organization end-to-end (`DB-01b`: `{"ok":true,"deleted":"AUDIT Throwaway"}`, org confirmed gone). On this audit Postgres the function's `SET LOCAL session_replication_role = replica` step is itself blocked by a permission the audit's non-superuser `postgres` role lacks for *some* calls, but the destructive path still succeeded in the direct repro above — this is not a reliable protection.
**Fix:**
```sql
REVOKE ALL ON FUNCTION public.owner_delete_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delete_org(uuid) TO service_role;
-- plus an explicit is_owner_org() check inside the function body
```
**Confidence:** EXPLOITABLE.

### SEC-03 · CRITICAL · `profiles` self-update allows tenant hop, role self-escalation, self-reactivation — EXPLOITABLE (reproduced)
`profiles_update_own` only pins the `role` column (and only for non-admins); `org_id`, `is_active`, `manager_id`, `store_id`, `employee_id`, `must_reset_password` are all writable by the row's own owner with no further check, and `authenticated` holds table-level UPDATE on every column.
**Reproduced live:**
- `DB-03a`: a technician moved their own profile's `org_id` into a second tenant — **EXPLOITABLE**.
- `DB-03b`: an admin promoted their own `role` to `platform_owner` directly via PostgREST — **EXPLOITABLE**.
- `DB-03c`: a manager rewrote their own `employee_id`/`manager_id` — **EXPLOITABLE**.
- `DB-09b`: a user flagged `is_active=false` re-activated themselves — **EXPLOITABLE**.
**Fix:** column-level `REVOKE UPDATE` for sensitive columns from `authenticated` (grant only `full_name`/`avatar_url`/`whatsapp_enabled`), or a `BEFORE UPDATE` trigger rejecting any change to `org_id`/`role`/`is_active`/`manager_id`/`store_id`/`must_reset_password` unless the caller is `service_role`.
**Confidence:** EXPLOITABLE.

## HIGH

| ID | Area | Finding | Confidence |
|---|---|---|---|
| SEC-04 | Storage | `storage.objects` has a permissive `"Authenticated download only"` policy (`bucket_id='request-attachments'`, no other predicate) that OR-combines with the correct per-request policy, so **any authenticated user can list and upload into any request's attachment folder** regardless of visibility. Reproduced: `DB-02c` — unrelated requester uploaded a file into another request's attachment folder (EXPLOITABLE). The matching *download* repro (`DB-02a/b`) was blocked on the audit stack's exact bucket config, but the upload/list gap confirms the policy problem. | EXPLOITABLE (write side) |
| SEC-05 | RLS / design | No confidentiality tier exists for HR/Finance-style teams; any manager/admin/platform_owner in the org sees every team's requests, comments, attachments and exports. Not a bug in any one line — a missing control. | CONFIRMED-BY-CODE |
| SEC-06 | RLS | Global (non-tenant) config tables (`business_hours`, `holidays`, `sla_escalation_rules`, `task_statuses`, `task_priorities`, `request_priorities`, `app_settings`) have **no `org_id` column**; write policies allow admin/manager of *any* org, read policies are `USING (true)` and anon-readable. Reproduced: `DB-04a` (anon reads SLA escalation rules), `DB-04b` (a manager flips global business-hours), `DB-04c` (an admin edits the global `app_settings` row) — all three **EXPLOITABLE**. | EXPLOITABLE |
| SEC-07 | Function grants | Several more `SECURITY DEFINER` functions are PUBLIC-executable: `generate_request_no()` (burns the ticket-number sequence — reproduced, **EXPLOITABLE**, `DB-06a`), `seed_default_sla_config(org)` (seeds SLA rows for an arbitrary org id — reproduced, **EXPLOITABLE**, `DB-06b`). | EXPLOITABLE |
| SEC-08 | `requests` insert/update | `requests_insert`/`requests_update` RLS only pins `org_id`/`requester_id`/`service_id`/`team_id`; a requester can insert a ticket directly as `status='closed'` with a 2099 SLA due date (reproduced, **EXPLOITABLE**, `DB-07a`), and a technician can rewrite `request_no` to collide with another ticket (reproduced, **EXPLOITABLE**, `DB-07b`). | EXPLOITABLE |
| SEC-09 | Admin actions | `adminSetPassword`/`updateUserRole`/`toggleUserActive` have no target-role guard — an admin can set a platform_owner's password or demote/deactivate them (unlike the sibling `updateUserEmail`, which correctly blocks this). | CONFIRMED-BY-CODE |
| SEC-10 | User lifecycle | **Deactivating a user does not revoke access.** `is_active` is referenced by no RLS policy, no helper function, and no middleware check — a deactivated account's existing session keeps working. | CONFIRMED-BY-CODE |
| SEC-11 | Bulk import | Bulk-created users get a hard-coded default password (`Welcome@123`) if none is supplied, enforced only by a UI redirect (`must_reset_password`), not server-side. | CONFIRMED-BY-CODE |
| SEC-12 | Reports | Scheduled reports (`sendScheduledReport`) let any manager export org-wide requests/tasks/approvals (bypassing the per-report scoping used elsewhere) to **any e-mail address**, with no recipient validation or domain allow-list. | CONFIRMED-BY-CODE |
| SEC-13 | Mass assignment | `updateScheduledReport`/`updateAlertRule`/similar admin actions spread the client payload (`{...data}`) directly into a service-role update with no column whitelist — a payload containing `org_id` can move a row into another tenant. | CONFIRMED-BY-CODE |
| SEC-14 | RLS | `tasks_delete` policy has no `org_id` predicate; an unfiltered `DELETE /tasks` by a manager is defended only by PostgREST's own "DELETE requires a WHERE clause" rule, not by RLS — reproduced attempt was **BLOCKED** by that generic rule, not by tenant scoping (`DB-05`). | CONFIRMED-BY-CATALOG, partially tested |
| SEC-15 | Internal notes | `request_comments` internal-note visibility is gated by "is the caller a member of **any** team", not the ticket's own team — an agent on Team A who raises a ticket to Team B (e.g. HR) can read Team B's internal notes on their own ticket. | CONFIRMED-BY-CODE |
| SEC-16 | Approvals | `delegateApproval` mutates the **shared workflow step definition** rather than a per-approval copy — delegating one pending approval silently re-points every other pending/future approval on that workflow to the new approver. | CONFIRMED-BY-CODE |

## MEDIUM (selected; full list in the source agent transcripts, folded into report 13)
- SEC-17: request-number sequence is global across tenants (one hot row), gap-prone once SEC-07 is fixed only partially.
- SEC-18: no DB-level status transition machine — `hold_purchase_ho`/other transitions enforced only in app code, bypassable via direct PostgREST update.
- SEC-19: RLS helper functions (`current_org_id()`, `current_user_role()`, etc.) are evaluated per-row, not cached per-statement — a real performance/security-adjacent issue at scale (feeds report 08).
- SEC-20: push-subscription `endpoint` accepted with no host allow-list (blind SSRF primitive via web-push).
- SEC-21: SMTP/IMAP host fields accept private/loopback addresses with no block-list; a blank password on settings change silently reuses the previously stored Vault secret against a *new* host.
- SEC-22: `generateEmailBrief` (LLM relay) has no role gate — any requester can use it as a free, org-billed LLM relay.
- SEC-23: inbound-email reply attribution trusts the `From:` header alone (no SPF/DKIM check) — a forged sender address can post as another user.
- SEC-24: approval e-mail links never expire (only consumed by decision); the 6-digit code's secret (`CSAT_LINK_SECRET`/fallback `CRON_SECRET`) is shared across CSAT and approval purposes.
- SEC-25: no separation of duties in approvals — a requester who is also a manager can approve their own ticket.
- SEC-26: numerous unchecked foreign-id writes in service-role actions (team/approver/project ids not verified to belong to the caller's org) — listed per-action in the SEC-B agent transcript.
- SEC-27: audit coverage gaps — role changes, deactivation, invites, bulk password reset details, org-structure CRUD, SLA/business-hours/holiday/alert-rule changes, and most of Projects/Tasks are not written to `admin_audit_log`.

## LOW / INFO (selected)
- Rate limiting is in-process memory, keyed on the first `X-Forwarded-For` value (spoofable without a trusted proxy in front), and resets on every restart.
- No CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` or HSTS header set anywhere in the app.
- `.or()`/`ilike` string interpolation in a few lesser-used search paths (`lib/queries/projects.ts`, `lib/actions/search.ts`) is unescaped for `,()`, but all are RLS-bound so impact is "widen my own visible results," not cross-tenant.
- Raw `error.message` surfaced to the client in several actions (`profile.ts`, `notifications.ts`, `activity.ts`) instead of the existing `sanitizeError()` helper.
- Open-redirect-shaped `next=` parameter handling exists in a couple of auth/callback routes; `signInWithPassword`'s own redirect correctly restricts to `/approve/<token>` only.
- `getAuditLogs` mislabels most non-catalog admin event types as `"service"` in the `/admin/audit` UI.

## Checked and found OK (do not re-flag)
- RLS is enabled on all 102 public tables; no SECURITY DEFINER views; no recursive policies; 6 tables are correctly deny-all (`org_signup_requests`, `conversation_events`, `conversation_attachments`, `email_smtp_settings`, `app_event_log`, `processed_inbound_emails`).
- All SMTP/IMAP/WhatsApp/DeskTime secrets live only in Supabase Vault behind `service_role`-only RPCs; no function returns a plaintext secret to a client role.
- CSV export already neutralizes formula-injection prefixes (`= + - @ tab CR`) via a shared `toCSV()` helper.
- Attachment uploads are validated for size (25 MB), extension and MIME allow-list, with magic-byte checks on binary types; SVG is correctly rejected from the request-attachments path.
- `applyStatusChange` correctly enforces the agent/requester transition matrix, optimistic-locks on `status`, and requires mandatory remarks for every guarded transition.
- Approval decision core guards `pending → approved/rejected` with `.eq('status','pending')`; `approvals_one_pending_per_request` unique index backs `submitForApproval`.
- WhatsApp webhook correctly verifies `X-Hub-Signature-256`, dedupes by `(org_id, channel_type, external_message_id)`, and rate-limits per sender.
- CSAT/approval public links use HMAC signing with `timingSafeEqual`, not naive string comparison.
- No SECURITY DEFINER function with dynamic SQL other than `owner_delete_org` (already flagged) and the service-role-only `replace_user_email` (properly escaped, properly scoped).

## D. Proxy / headers / sessions / transport (fourth independent review, SEC-C)
*This reviewer confirmed SEC-01 from a different angle (Next 16 docs for `action-handler.js`/Server Action CSRF) and added transport/header/session findings the others didn't cover.*

### HIGH
- **SEC-28 (= SEC-01 confirmed again):** `/approve/<token>` — because it's one of proxy.ts's unstripped fast paths, the forged-header issue also lets a visitor skip straight past the e-mailed 6-digit code meant to prove they are the named approver. Same root cause and same fix as SEC-01.
- **SEC-29:** Login/forgot-password rate limiting is keyed on the first `X-Forwarded-For` value with no trusted-proxy enforcement — if the app is exposed directly (as the public-URL docs suggest), an attacker rotates the header for unlimited password-guessing attempts; conversely with *no* header present every client collapses onto one shared bucket, so 11 requests from anywhere locks out every user sharing that bucket for a chosen email.
- **SEC-30:** Bulk-imported users without a sheet-supplied password get the **hard-coded, repo-visible** default `Welcome@123`; enforcement of "must change it" is a client-side page redirect only, never checked by any Server Action or route handler.
- **SEC-31:** The deployment appears to run over **plain HTTP** (both `NEXT_PUBLIC_APP_URL` and the Supabase URL use `http://`), so passwords, session tokens and approval links cross the network unencrypted, and auth cookies carry no `Secure` flag as a result.

### MEDIUM
- **SEC-32:** No security response headers anywhere in the app — no CSP, `X-Frame-Options`/`frame-ancestors` (the one-click Approve/Reject buttons are click-jackable), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or HSTS.
- **SEC-33:** Open redirect in `/auth/callback` — its `next` query parameter is appended to `origin` with no validation (unlike the sibling `/auth/confirm`, which does this correctly), so a crafted `next` value can redirect a victim's browser off-domain.
- **SEC-34:** `forgotPassword`'s rate limit is IP-keyed only, with no per-email cooldown — usable to mail-bomb a target employee's inbox.
- **SEC-35:** Password policy (min length, complexity, "must prove old password") is enforced only in app code; a caller holding the anon key can call GoTrue's `updateUser` directly and bypass all of it. `secure_password_change` is off in the local config.
- **SEC-36:** Auth cookies are not `httpOnly`-restricted beyond the library default, not marked `Secure` (ties to SEC-31), and live for 400 days by default.
- **SEC-37:** The Docker image runs Node 20, which reached end-of-life before this audit date — no further security patches for the runtime itself.
- **SEC-38:** The global 30MB server-action body-size limit applies even to unauthenticated actions (login, forgot-password, approval-code endpoints), permitting resource-exhaustion-shaped abuse.

### LOW / INFO (SEC-C)
- One signing secret (`CSAT_LINK_SECRET`, falling back to `CRON_SECRET`) covers both CSAT tokens and approval links/codes, with no separation between purposes.
- Approval links never expire (only consumed by decision); the 6-digit code's attempt counter is in-process memory and resets on restart.
- `/api/health` runs a real DB query with the service-role client for any unauthenticated caller (cheap amplification/latency-probe vector); `/api/events` reads the full body before its size check and keeps an unpruned in-memory rate-limit map.
- `typescript.ignoreBuildErrors: true` in `next.config.ts` means a type error in authorization-relevant code would not fail a production build.
- `components/admin/RichEmailEditor.tsx` renders `previewHtml` via `dangerouslySetInnerHTML` — **not independently confirmed sanitized in this pass**; verify it goes through the existing `sanitize-html` pipeline before shipping.

### Checked and found fine (SEC-C)
- Next 16.2.9's built-in Server Action CSRF protection (Origin vs Host/X-Forwarded-Host comparison in `action-handler.js`) is active and correctly configured for this app's default (same-origin) setup.
- All cron/webhook routes in the public allow-list correctly self-authenticate (constant-time cron-secret compare, WhatsApp HMAC, Gmail/Outlook secret checks) and none are a bare prefix match.
- Login/reset `next=` handling in the login form itself (not the `/auth/callback` route) correctly restricts redirects to `/approve/<token>`-shaped paths only.
- Secrets are correctly gitignored; no secret values found committed anywhere in the repo.
- The service-role Supabase client is never imported from client-side code.

## E. Attachments / rendering / PDF (fifth review, SEC-D)

### CRITICAL (verify — framework behavior read from code, not dynamically confirmed)
- **SEC-39 (SEC-D-01):** The public storage proxy route (`/api/storage/public/[bucket]/[...path]`) only validates the bucket name, not the path segments, before handing them to a **service-role** Supabase Storage client. Reading how Next decodes catch-all route segments and how the Storage client builds its URL (both read from the installed library source, not run), a path-traversal-shaped input could in principle cause the server to issue a service-role request outside the intended bucket. **Not dynamically exploited in this audit** — flagged as needing a unit test (feed deliberately malformed path segments to the route handler in isolation, assert it 404s before any Storage call) rather than a live traversal attempt. If confirmed, impact would be severe (service-role reach is broad) — treat as CRITICAL until the unit test clears it.
- **Fix:** validate path segments against a strict allow-list per bucket (e.g. `^[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$` for icons) before any Storage call; stop using the service-role client for public-bucket reads.

### HIGH
- **SEC-40:** An inbound-email attachment's filename (attacker-controlled, from a stranger's MIME headers) is used directly as part of the storage object key, with `upsert: true` — same class of concern as SEC-39, this time on the **write** side and confirmed reachable by an unauthenticated external sender (anyone who can email the intake address). **Fix:** key objects on a generated UUID, never the sender-supplied filename; keep the original filename only in a DB column; `upsert: false`.
- **SEC-41:** The authenticated attachment-download route trusts the `mime_type` DB column (which an uploader can modify via RLS update grants — ties to SEC-04) and serves it `inline` with no `nosniff` — a crafted upload followed by a RLS-permitted `mime_type` rewrite to `text/html` could serve attacker HTML inline in an agent's session. **Fix:** derive content-type server-side from a fixed extension map, never the stored value; force `attachment` disposition for non-image/PDF types; add `nosniff`.

### MEDIUM
- **SEC-42:** `request_attachments.storage_path` is not validated to actually belong to the row's own `request_id` — combined with the broad storage-list policy (SEC-04), a crafted row could point at another ticket's file.
- **SEC-43 (= SEC-01, confirmed independently a fourth time):** this reviewer reached the same `x-verified-user-id`/proxy-fast-path conclusion from the attachments angle (the image-extension bypass is also how an unauthenticated request can reach the public storage route above).
- **SEC-44:** No security response headers (ties to SEC-32) — specifically relevant here because it's what would contain any of the above if a content-type confusion did occur.
- **SEC-45:** Upload validation is inconsistent across the ~5 places it's duplicated (web upload, task attachments, WhatsApp media, intake worker) — extensions/MIME allow-lists have already drifted between copies; some binary types (legacy Office formats, some video) have no magic-byte check.
- **SEC-46:** The Admin Audit Log's own CSV export has a **separate, hand-rolled** CSV builder that does not go through the shared `toCSV()` helper (report 11's formula-injection protection) — user-controlled ticket/entity titles could land as live formulas in an admin's spreadsheet.

### LOW / INFO
- Inbound email-viewer's "remote images blocked" protection is regex-based and incomplete (misses CSS `url()`, `<link>`, SVG `<image>`) — a CSP on the iframe's `srcDoc` would close this properly.
- XLSX-preview trusts the zip's own declared (attacker-controlled) size fields before fully validating — a crafted file could cause excess memory use during preview.
- Attachment delete/cleanup: storage-removal failures are not checked, so a soft-deleted row's underlying object can be orphaned (stays reachable via the broad list policy until SEC-04 is fixed).
- OEM email template allows a `{{placeholder}}` inside an `href` attribute, so attacker-controlled description text could become a malicious link after substitution if not re-sanitized post-substitution.
- `profile.avatar_url` accepts any string including a remote tracking-pixel-shaped URL.
- PDF generation (ticket export) uses PDFKit's text-drawing API only — no injection path; correctly excludes internal comments/attachments from the requester-visible PDF.
- `avatars` storage bucket is not declared in any migration (its size/MIME limits are therefore undocumented in code).

## F. Webhooks / tokens / external entry points (sixth review, SEC-E)

### HIGH
- **SEC-47 (= SEC-01, confirmed a fifth time, from the approval-flow angle):** the same unstripped-header issue lets a signed-in user bypass the approval e-mail's 6-digit-code identity gate by setting the header to the real approver's id on the `/approve/*` fast path.
- **SEC-48:** Inbound reply-by-email's sender-matching regex can be fooled by a crafted `From:` display name (e.g. a name containing a second, different angle-bracketed address) — the wrong address can be extracted and trusted, independent of the already-flagged "no SPF/DKIM check" issue (SEC-23). Confirmed-by-code as a parsing bug, not just a missing-check gap.
- **SEC-49:** The Gmail/Outlook OAuth `state` signing key silently falls back through `OAUTH_STATE_SECRET → INTAKE_WORKER_SECRET → CRON_SECRET → ''` — an **empty string** is a valid fallback value, meaning a blank env var (not just a missing one) produces a forgeable, zero-length HMAC key.

### MEDIUM
- **SEC-50:** The OAuth callback route has no re-check that the completing user still holds the admin role, no binding to the session that started the flow, and the state value is not single-use within its validity window.
- **SEC-51 (= SEC-13, confirmed again):** `CRON_SECRET` is reused as a fallback signing/auth secret across webhooks, OAuth state and (via `CSAT_LINK_SECRET` fallback) approval links/codes — a single leaked value compromises several independent protections at once.
- **SEC-52:** The approval email's 6-digit code is deterministic (an HMAC of a 5-minute time window) and reusable within its ~10-15 minute acceptance window rather than being randomly generated and single-use; combined with an in-process (non-persistent, per-replica) attempt limiter.
- **SEC-53 (= SEC-20, confirmed again):** push-subscription `endpoint` URLs are stored with no host/scheme allow-list, confirmed as a blind-SSRF-shaped primitive from this angle too.
- **SEC-54:** The WhatsApp webhook does meaningful work (JSON/schema parsing, a DB channel lookup, a Vault secret read, an audit-log insert) **before** verifying the HMAC signature — a resource-exhaustion/log-flood vector against an endpoint that must stay public by design.
- **SEC-55:** A batched WhatsApp webhook payload resolves its channel/credentials from only the **first** entry in the batch; if Meta ever batches multiple phone numbers under one shared app, later entries would be processed under the wrong tenant's channel.
- **SEC-56:** Reply-by-email sync is not safely re-entrant under overlapping runs (same dedupe-after-action-not-before ordering issue as report 11's CQ-02, confirmed independently here) and re-downloads/re-parses the full mailbox window before checking for duplicates.
- **SEC-57 (ties to CQ-07/08/D-042):** Business-rules and CSAT-reminder cron jobs follow the same "check → act → record" (rather than "claim → act") ordering, so an overlapping/retried cron tick can double-fire.

### LOW / INFO
- The approval code's value is written into the email *subject line* and into the Event Log (90-day retention) — the code is visible in an auxiliary place it doesn't need to be.
- `/api/events` lets any authenticated caller submit a `kind: 'system'`/`'server_error'` row with an arbitrary message, polluting the admin-facing event log with attacker-chosen text.
- DeskTime sync's upsert unique keys omit `org_id` (same finding as report 06's integrity section); its API key travels in a query string (required by that third-party API) with no fetch timeout on the calls.
- Cron health-check responses are inconsistent — some routes return HTTP 200 even when every item inside them failed, making automated monitoring of cron health unreliable.
- Gmail/Outlook webhook authentication is a static token carried in the URL query string (logged by intermediaries) rather than a header or a verified provider-signed token (e.g. Pub/Sub's OIDC push token, which exists but isn't used here).
- Approval links have no expiry beyond "until decided"; the approve page shows request number/approver names before identity is proven (acceptable given the token is unguessable, but worth a `Referrer-Policy: no-referrer` + `Cache-Control: no-store` on that page).

### Checked and found fine (SEC-D/E, not to re-flag)
- WhatsApp: signature verification is correct and fails closed when the secret is missing; GET handshake token comparison is constant-time; replay/duplicate-delivery handling via a real unique index is solid; sender resolution is strictly by destination `phone_number_id`, never by claimed sender identity.
- OAuth: `/start` correctly requires admin role and org-scoped channel; refresh tokens go through the Vault RPC, never stored in plain config; the route is correctly session-gated (not in the public allow-list).
- Cron secret verification (`lib/cron-auth.ts`) fails closed and uses a constant-time compare on every route.
- Approval token itself (the link token, as opposed to the 6-digit code above) is a sound 3-part signed structure with a correctly-scoped, correctly-flagged verified-session cookie.
- Outbound email templates consistently escape dynamic text through the existing helpers; admin-authored rich-text templates go through `sanitize-html` with a tight allow-list.
- Attachment *download* routes (as opposed to the upload/public-proxy paths flagged above) correctly check the caller's RLS-scoped access before using the admin client to stream the file.
- PDF ticket export has no injection surface (text-drawing API only) and correctly excludes internal-only content from requester-visible exports.

## Suggested fix order
1. SEC-02, SEC-03 (DB grant/RLS fixes — small, surgical SQL migrations with a regression test each).
2. SEC-01 / SEC-28 (auth header trust — code fix in `getCurrentProfile`/`proxy.ts`; this is the single highest-leverage fix in the whole audit, found independently by three reviewers).
3. SEC-04, SEC-06, SEC-07, SEC-08 (RLS/grant hardening — one combined migration).
4. SEC-09, SEC-10, SEC-11, SEC-30 (user lifecycle & default-password).
5. SEC-29, SEC-31, SEC-32, SEC-36 (rate limiting, transport, headers, cookies) — mostly config/infra changes, worth bundling with the production HTTPS decision.
6. SEC-12, SEC-13, SEC-33, SEC-34, SEC-35, SEC-37, SEC-38 and the remaining MEDIUM items, in whatever order best matches the user's deployment timeline.
7. SEC-39 (public storage route — write the unit test first; this is the one finding in the whole audit rated CRITICAL without a live reproduction, specifically because confirming it safely needs a crafted-path unit test rather than a real traversal attempt).
8. SEC-40, SEC-41, SEC-48, SEC-49, SEC-54 (attachment/webhook hardening — bundle with the storage RLS migration since several share root causes with SEC-04).

## Final severity summary (all six reviews combined)

| Severity | Count | Notes |
|---|---|---|
| CRITICAL | 4 | 2 reproduced live (SEC-02/D-002, SEC-03/D-003); 1 confirmed-by-code across 3 independent reviewers (SEC-01); 1 flagged for a unit test, not live-confirmed (SEC-39) |
| HIGH | 24 | mix of live-reproduced and confirmed-by-code |
| MEDIUM | 31 | confirmed-by-code/catalog |
| LOW/INFO | ~45 | itemized per section above |

*The same `x-verified-user-id` trust issue (SEC-01) was independently rediscovered by five of the six review agents from completely different angles (admin actions, requester actions, proxy/headers, attachments, webhooks) — that convergence is itself strong evidence this is the single highest-priority fix in the application.*
