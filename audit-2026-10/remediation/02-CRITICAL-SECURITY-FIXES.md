# 02 — Critical Security Fixes

*All work local, branch `remediation/post-audit-2026-10`. Every test runs only against the isolated audit stack. Nothing here is applied to production.*

**Status vocabulary used in this and every following report:** **Implemented** (code or migration written) · **Tested** (a regression test fails before and passes after, or passes before and after for a behaviour-preservation test) · **Verified** (the result was checked a second way: independent SQL, the running app, or a re-run of the full suite) · **Blocked** (cannot be exercised in an isolated environment) · **Deferred** (not done, reason given) · **Requires user approval** (a decision that is the user's to make).

## Summary

| ID | Finding | Severity | Status |
|---|---|---|---|
| D-001 | Forged "who is the user" header trusted on several proxy paths | Critical | Implemented · Tested · Verified (unit level — see note) |
| D-002 | Anyone could call `owner_delete_org()` and delete a whole organization | Critical | Implemented · Tested · Verified |
| D-003 | A signed-in user could rewrite their own organization, role, active flag, manager, employee id | Critical | Implemented · Tested · Verified |
| D-007 | Internal helper functions callable by anyone (burn ticket numbers, seed SLA settings) | High (grouped here with the migration) | Implemented · Tested · Verified |
| D-051 | Public file route validated only the bucket, not the path | Critical (unconfirmed at audit) | Implemented · Tested · **component-level confirmation only** (see note) |

Database changes: migration `20240101000156_post_audit_critical_security.sql` with rollback `supabase/rollback/20240101000156_rollback.sql` (written in this pass; the rollback was syntax-checked against the disposable database). Neither is applied to production.

## D-001 — Forged trusted-user header

| | |
|---|---|
| **Original** | The proxy forwards the verified user's id to pages in the header `x-verified-user-id`. On several fast paths (static assets, the public-API allow-list, `/csat/*`, `/approve/*`) the proxy passed the request through **without removing a client-supplied copy**, and `getCurrentProfile()` believed whatever the header said. A signed-in or anonymous caller could therefore claim to be any user on those paths. (The approval e-mail's identity check was one consumer.) |
| **Files** | `lib/auth/verified-user.ts` (new), `proxy.ts`, `lib/queries/profiles.ts`, `app/api/events/route.ts` |
| **Fix** | The proxy now **deletes** any client-supplied copy of the headers on every path it lets through. The value it sets itself is **signed** (HMAC-SHA256 with a server-only key). `getCurrentProfile()` and the events route believe the header only if the signature verifies; a missing, unsigned, wrongly signed or another user's signature is treated as "nothing vouched for", and the code falls back to checking the real session. A signed "signed out" marker is also supported. |
| **Tests** | `tests/unit/header-trust.test.ts` — 10 tests: the forged id and signature are not forwarded on each fast path; a signed-out visitor is still sent to `/login` and nothing forged reaches the page; the legitimate public routes still work; a forged id with no / made-up signature is ignored; a real signature for a different user cannot be reused for the victim; the proxy-signed header is believed; a signed-out marker is not accepted with a real user's signature; no headers means nothing is trusted. |
| **Before / after** | Before: header trusted on fast paths. After: all forged variants ignored; legitimate flows unchanged (integration and UAT suites green). |
| **How it was confirmed** | **By code and by the proxy-level unit test, not by a live attack.** A live forged-header script against the running local app was stopped by the safety classifier, so the finding is recorded as *confirmed by code* (three independent reviewers in the audit) and the test exercises the real proxy function. It is not described as "reproduced live". |
| **Residual risk** | The signing key is `SUPABASE_SERVICE_ROLE_KEY` (falling back to `CRON_SECRET`); if neither is configured nothing is forwarded and every page checks the session itself (safe, slightly slower). Deployment note: no new environment variable is required. |

## D-002 — `owner_delete_org()` callable by anyone

| | |
|---|---|
| **Original** | Reproduced live in the audit: with only the public API key, the function deleted a whole organization (a throwaway one) end to end. |
| **Files** | `supabase/migrations/…156_post_audit_critical_security.sql` |
| **Fix** | `EXECUTE` revoked from `PUBLIC`, `anon` and `authenticated`, granted only to `service_role`. The function also checks its caller itself (defence in depth): a request arriving as a client role must be the owner organization's administrator. |
| **Tests** | `tests/remediation/20-db-critical.test.ts` — an anonymous caller cannot delete an organization (the original attack); signed-in users of every role cannot; the server (service role) still can (positive). Test organizations are created and deleted by the test itself. |
| **Before / after** | Before: organization deleted. After: HTTP error, organization still present. |
| **Residual risk** | None known for this path. The earlier `REVOKE` statements named `anon` and `authenticated` but left the default `PUBLIC` grant in place; that is why it stayed open and why the new migration revokes `PUBLIC` explicitly. |

## D-003 — Profile self-update (tenant hop, role self-promotion, re-activation)

| | |
|---|---|
| **Original** | Reproduced live (four separate repros): a technician moved themselves into another organization; an administrator made themselves `platform_owner`; a deactivated user re-activated themselves; a manager rewrote their own employee id and manager. |
| **Fix** | Column-level privileges: a signed-in user may now update only `full_name`, `avatar_url` and `must_reset_password`. A trigger (`guard_profile_client_update`) adds a second lock: a client role cannot change organization, role, active flag, manager, store, department, location, cost centre, function, designation, employee id, job title or WhatsApp flag, and can only *clear* (never set) the must-reset flag. Every admin screen already writes through the server's service-role client, so no admin capability is lost. |
| **Tests** | Five negative tests (each original attack) and four positive tests: a user can still change their own name and avatar; after setting a new password a user can still clear their own forced-reset flag; the server can still change role, active flag and organization fields; reading profiles is unchanged. |
| **Before / after** | Before: each attack succeeded. After: each refused, the profile row unchanged (the test snapshots and restores the synthetic accounts). |
| **Residual risk** | Any future screen that updates another profile column through the **user** client will now be refused; it must use the server action path like the existing admin screens. |

## D-007 — Internal functions callable by anyone

`generate_request_no()` and `seed_default_sla_config(uuid)` (and the two trigger functions) were `PUBLIC`-executable `SECURITY DEFINER` functions: anyone could burn ticket numbers or seed another organization's SLA settings (two live repros in the audit). Revoked from clients, granted to `service_role`; the ticket-number trigger was made `SECURITY DEFINER` first so ordinary ticket creation by a requester keeps working. Tests: anonymous and signed-in users cannot burn numbers or seed SLA settings; **a requester can still create a ticket and gets its number** (positive); the server can still call the helpers. Status: Implemented · Tested · Verified.

## D-051 — Public file route validated only the bucket

| | |
|---|---|
| **Original** | `/api/storage/public/[bucket]/[...path]` checked the bucket name but passed the path segments straight to a service-role storage call. The audit rated it Critical **without** a live reproduction and asked for a safe unit test first. |
| **Files** | `lib/storage/publicPath.ts` (new), `app/api/storage/public/[bucket]/[...path]/route.ts` |
| **Fix** | The route serves **only** the exact file shapes the app itself uploads (an icon `<uuid>.<ext>` and an avatar `<uuid>/<file>.<ext>`, extension case-insensitive) and refuses everything else before touching storage. The content type comes from the extension, with `nosniff`. |
| **Tests** | `tests/unit/public-storage-route.test.ts` — the route serves a real icon and avatar with the right type and `nosniff`; every hostile path is refused **without touching storage**; and a **no-network analysis test** shows why validation was needed: the storage client places a path containing dot-segments into the request URL **unencoded**, so it resolves outside the bucket folder. |
| **How it was confirmed** | **At component level only.** The unit test proves the storage client does not protect the path; it does **not** prove that the running storage service would have served a file outside the bucket. So the finding is *confirmed as a weakness in the component, not as an end-to-end exploit*, and it is fixed defensively. It is not labelled "exploited". |
| **Side effect found and fixed** | One existing integration test (`desk-storage-001`) uploaded an icon with a name that does not match the real shape; its fixture was updated to the real shape (a UUID). |
| **Residual risk** | If a future feature stores public files under a new shape, the allow-list in `publicPath.ts` must be extended. |

## Deployment notes for these changes (for a later, separately authorized release)

1. Migration 156 must be run on the production database by the user, then `CkDeskPostgrest` restarted on the app server (schema cache), per the project's standing procedure.
2. The app build must be deployed with migration 156 applied; the code works with or without it, the migration closes the database side.
3. No new environment variable is required for D-001, D-002, D-003, D-007 or D-051.
4. Rollback: `supabase/rollback/20240101000156_rollback.sql` (restores the vulnerable behaviour on purpose; use only to undo a broken deployment).
