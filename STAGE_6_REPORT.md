# STAGE 6 — END-TO-END INTEGRATION, META READINESS & CONTROLLED LIVE VALIDATION

## Status

**COMPLETE.** Stage 6 was a validation/audit/readiness stage, not a redesign. No Phase-2 WhatsApp feature was added. No production WhatsApp number was enabled. Stage 7 was **not** executed — see "Stage 7 Readiness" below for the explicit gate.

This report separates, throughout, what was **AUTOMATED/SIMULATED** (verified by code + tests running against a mocked Meta HTTP boundary) from what was **REAL META VERIFIED** (an actual successful call to `graph.facebook.com`, or an actual signed request received from Meta's own infrastructure). Where the environment could not reach the real internet, that is stated plainly as `NO` — never inferred as `YES` from a passing simulated test.

---

## Baseline Reviewed

Read/re-verified before any change: `lib/requests/**` (incl. `createRequestCore()`, `lib/requests/questionnaire/catalog.ts`, `lib/requests/questionnaire/question-plan.ts`), `lib/conversations/**`, `lib/whatsapp/**` (`config.ts`, `graph-client.ts`, `webhook-handler.ts`, `media.ts`, `types.ts`), `lib/users/resolveWhatsAppUser.ts`, `lib/actions/intake/whatsapp-channel.ts`, `app/api/intake/webhook/whatsapp/route.ts`, `app/(app)/intake/channels/**`, `lib/rate-limit.ts`, `.env.example`, `docs/RAILWAY-DEPLOYMENT.md`, `STAGE_4_REPORT.md`, `STAGE_5_REPORT.md`, `STAGE_5_1_REPORT.md`, and the live schema of `intake_channels`, `request_conversations`, `conversation_events`, `conversation_attachments`, `request_attachments`, `intake_audit_log`, `services`, `service_categories`, `service_sub_categories`, `service_sub_category_tags`, `service_location_tags`, `form_templates`, `business_rules`, `assignment_rules`, SLA tables, `org_module_access` via direct read-only `psql` against the local Supabase Postgres instance.

No existing Stage 4/5/5.1 architecture was rewritten. All Stage 6 code changes are additive (one bug fix, one new admin diagnostic — see "Files Changed").

---

## Architecture Revalidation

Confirmed unchanged and still sound:
- `createRequestCore()` remains the single business-logic path for ticket creation; WhatsApp never re-implements assignment, SLA, or category derivation.
- The canonical journey (Service → issue-name search → Sub-category → auto Category → Description → auto Subject → template fields → attachment → Review → Create) is still Category-last, not Category-first, exactly as designed.
- Persistent `request_conversations` + `conversation_events` state machine, Meta webhook signature verification, and Stage 5.1's pre-Review media staging are all intact and unmodified.
- No `middleware.ts` exists in the app — confirmed by its absence — so the WhatsApp webhook route is not gated by any session/auth middleware, satisfying Part 3's requirement directly.

---

## WhatsApp Channel Readiness (Part 1)

Added a genuine **CONFIGURED vs VERIFIED** admin diagnostic — `getWhatsAppChannelReadiness()` (`lib/actions/intake/whatsapp-channel.ts`) plus a "Readiness" panel in `app/(app)/intake/channels/ChannelsClient.tsx`. It reports two separate groups, never conflated:

**Configured** (a value is present — says nothing about Meta):
- Channel configured / Channel active
- Phone Number ID present
- WABA ID present
- Credentials (access token + app secret) present in Vault

**Verified** (Meta has actually responded):
- Meta connection verified — `true` only if a prior `testConnection()` call against the real Graph API succeeded; a channel with every credential filled in and never tested shows `Meta connection verified: NO` with the explicit message *"Never tested — credentials being present does not mean Meta has accepted them."*
- Last tested timestamp, returned `display_phone_number`/`verified_name`, and last error, all persisted in `intake_channels.config` (non-secret; no migration needed, reuses the existing JSONB column) so this is a durable fact, not a page-load-only one.
- Webhook health (`unknown`/`ok`/`errors_detected`), derived from real `intake_audit_log` rows for that org — `unknown` until Meta has actually sent traffic (never fabricated as `ok`).
- Requester mobile coverage (informational, aggregate-only — no individual numbers shown).

**Bug fixed along the way:** `WhatsAppGraphClient.testConnection()` (`lib/whatsapp/graph-client.ts`) requested `verified_name` from the Graph API's `fields` param but never read it back from the response — only `display_phone_number` ever reached the caller. Fixed so the readiness panel can show both fields Part 2 explicitly asks for.

`testWhatsAppConnection()` now also logs `whatsapp_test_connection_succeeded` / `whatsapp_test_connection_failed` audit rows on every attempt (Part 22).

**UI verification note:** The local dev/seed org (`CityKart`, `org_id 00000000-0000-0000-0000-000000000001`) has the **Intake module itself disabled** at the `org_module_access` level (`enabled=false`). This blocked a live click-through of the new Readiness panel in this session — attempting to create a test WhatsApp channel through the UI correctly surfaced the app's own "The intake module is not enabled for your organisation" guard and, confirmed by a read-only query, no partial/orphaned row was written. Toggling org-level module access is a real, standing admin action (see `supabase/manual/set_org_modules_task_intake.sql`, previously used against production for a different org) — it was deliberately **not** performed here without explicit authorization, since it mutates shared org configuration rather than being a reversible, request-scoped action. The new panel was instead verified by: (a) `tsc --noEmit` and `npm run lint` passing clean on the new component, (b) structural parity with the adjacent, already-proven `WhatsAppConnectForm`/`getWhatsAppChannelInfo` panel in the same file (identical fetch-on-mount / loading-state / error-display pattern), and (c) a dedicated new test, `stage6-channel-readiness.test.ts` (see "Tests Added"). This is itself a genuine deployment-readiness finding: **enabling the Intake module for the target org is a required manual pre-step before any Stage 7 UAT can begin** — see "Deployment Requirements."

---

## Real Meta Connection — **REAL META CONNECTION VERIFIED: NO**

This sandboxed environment has no outbound internet access. Direct proof: `curl -sS -o /dev/null -w "HTTP_STATUS:%{http_code}" https://graph.facebook.com/v23.0/` returns `HTTP_STATUS:000` — an immediate network-level failure (connection could not be established at all), not a timeout or an HTTP-level rejection. `.env.local` contains no Meta/WhatsApp access token, app secret, phone_number_id, or WABA ID — no real credentials are available even if connectivity existed.

**Manual action required to obtain a real YES:** from a network with outbound internet access, an operator must (1) complete the Meta Business Manager checklist below to obtain a real System User access token, App Secret, and a registered `phone_number_id`; (2) enter them via Admin → Intake → Channels → a WhatsApp channel → "Connect credentials"; (3) click "Test connection". The Readiness panel will then show `Meta connection verified: YES` with the real `display_phone_number` and `verified_name`, persisted and durable. Nothing about this stage's findings blocks that step — the code path is implemented and unit/integration-tested against a mocked Graph boundary; it only needs real network + real credentials to flip to a real `YES`.

---

## Real Webhook Verification — **REAL META WEBHOOK VERIFIED: NO**

Same root cause: no real Meta infrastructure can reach this environment, and this environment has no public HTTPS URL for Meta to call back into. What **was** verified directly by reading the code (not simulation):
- `GET /api/intake/webhook/whatsapp` implements the exact `hub.mode=subscribe` / `hub.verify_token` / `hub.challenge` handshake Meta requires, comparing the token against every active WhatsApp channel's Vault-stored `verify_token` via constant-time `secureCompare`, echoing the challenge only on an exact match.
- `POST /api/intake/webhook/whatsapp` reads the raw request body before any JSON parsing and validates Meta's `X-Hub-Signature-256` HMAC-SHA256 signature before anything in the payload is acted on; an invalid signature returns `401` (fails closed), while a valid-but-malformed/unsupported payload returns `200` (to avoid a Meta retry storm) — this asymmetry is deliberate and documented in the route's own comments.
- No `middleware.ts` exists, so nothing in the app's routing layer can block or redirect Meta's unauthenticated POST.

**Exact webhook callback URL** (computed the same way the app itself computes it, via `OAUTH_REDIRECT_BASE_URL` → `NEXT_PUBLIC_APP_URL` fallback): `https://<your-deployment-host>/api/intake/webhook/whatsapp`.

**Manual action required:** once a real public HTTPS deployment exists (see "Deployment Requirements"), an operator registers that exact URL plus a chosen verify token in Meta Business Manager (App → WhatsApp → Configuration → Webhook), matching the verify token entered in the DESK "Connect credentials" form. Meta calls the GET handshake automatically on save; the automated `stage5-webhook-e2e.test.ts` / `stage5-webhook-security.test.ts` suite already proves the handshake and signature logic are correct against Meta's documented contract — only the real network hop is untested here.

**SIMULATED END-TO-END VERIFIED: YES** — the full GET handshake and POST signature-verification path is exercised end-to-end by the existing automated suite with a real HMAC computed the same way Meta computes it, against a real (test) verify token and app secret stored via the real Vault RPC path — only the actual Meta server on the other end is substituted.

---

## Real WhatsApp Message — **REAL WHATSAPP MESSAGE VERIFIED: NO**

No authorized Meta test number, no outbound internet — sending or receiving a real WhatsApp message is not possible in this environment for the reasons above. **SIMULATED END-TO-END VERIFIED: YES**, via `stage4-conversation-e2e.test.ts` and `whatsapp-stage1-create-request-core.test.ts`, which drive a full "Hi" → Service → Sub-category → template fields → Review → Create conversation through the real conversation engine, the real `createRequestCore()`, and a real (test) Postgres transaction, substituting only the `WhatsAppGraphClient`'s `fetchImpl` (the one HTTP boundary to Meta) — never mocking `lib/conversations` or `lib/requests` themselves. This is never described as a "live Meta test" anywhere in this report or in code comments — the distinction is kept explicit throughout.

---

## Actual DESK Service Configuration Audit (Part 6)

Live query against the real seed org (`00000000-0000-0000-0000-000000000001`), not fixtures:

| Service | WhatsApp-visible? | Sub-categories | Template resolved | Required file field | Mandatory fields (all requester-settable) | SLA | Business Rule | Assignment |
|---|---|---|---|---|---|---|---|---|
| IT Support | Yes | 73 | IT Support Template | Yes | Subject, Description, Phone number, Attachments | Active, all 4 priorities | 1 rule, **dead** (see below) | None (org has none) |
| HR Support | Yes | 72 | HR Support Template | No | Subject, Description, Mobile Number | Active | 2 rules, **dead** | None |
| BD Support | Yes | 52 | BD Support Template | Yes | Subject, Description, Phone number, Attachments | Active | None | None |
| FINANCE & ACCOUNTS Support | Yes | 5 | FINANCE & ACCOUNTS Support Template | Yes | Subject, Description, Phone number, A/C Holder Name, Bank A/C No., Bank IFSC Code, Invoice No, Refundable Amount, Transaction Date, Attachments | Active | None | None |
| L&D Support | Yes | 15 | L&D Support Template | No | Subject, Description, Phone number, Emp Code | Active | None | None |
| LEGAL Support | Yes | 10 | LEGAL Support Template | No | Subject, Description, Phone number | Active | None | None |
| Vendor Creation Support | Yes | 1 | Vendor Creation Template | Yes | Subject, Description, Phone number, + 13 vendor/bank fields | Active | None | None |
| **Stage1.1 Service A** (test leftover) | Yes | **0** | **None** | — | — | — | — | — |
| **Stage1.1 Location-Restricted Service A** (test leftover) | Yes | **0** | **None** | — | — | — | — | — |

Zero fields anywhere are mandatory-yet-not-requester-settable (`requester_can_set=false` with `required=true`) — no mandatory field is unreachable via WhatsApp.

**Finding 1 — dead-end WhatsApp flow (real, not fixture).** Two leftover "Stage1.1" test services remain `is_active=true`, `status='published'`, i.e. WhatsApp-visible, with zero sub-categories and no resolved template. A real requester selecting either via WhatsApp would reach a sub-category prompt with nothing to offer, or fail template-field resolution. **Recommendation: deactivate or unpublish both before any Stage 7 UAT / production rollout.**

**Finding 2 — systemic double-ask of Subject/Description (real, all 7 production templates, by design).** Every one of the 7 real, in-use service templates has both a mandatory `Subject` (text) and mandatory `Description` (textarea) field. Stage 3.1's question-plan engine deliberately never treats a template field literally labeled "Subject"/"Description" as equivalent to its own auto-generated title/captured description — confirmed via the engine's own documented design comment: satisfied-field detection is driven only by explicit `answers[field.id]` values, never by label-guessing, because the same label can mean something different in another service. This is **not a bug**; it is the documented Stage 3.1 design tradeoff. Consequence: every real WhatsApp requester using any of the 7 production services is asked for their subject and description **twice** — once by the engine's own generic capture step, once again by the template. This is a genuine UX/configuration concern for Service/Template owners to resolve (e.g. by removing the redundant template fields, or by wiring the template's Subject/Description fields to reuse the engine's own captured values) — flagged, not silently patched, per Stage 6's own instruction not to alter real business configuration to make tests pass.

**Finding 3 — Business Rules are configured but non-functional.** 3 of the org's 4 `business_rules` rows are flagged `is_active=true` (IT Support ×1, HR Support ×2) but every one references a `category_id` that has since been deleted from `service_categories`, making their match condition permanently unsatisfiable. Org-wide `business_rule_events` shows exactly 1 fire in history, and it belongs to the one rule that is *not* active (a disabled UAT test rule). **This is a pre-existing configuration-drift issue, not introduced by or specific to WhatsApp** — a web-created ticket for IT/HR Support is equally unaffected by these rules today. Recommendation: repoint or retire the 3 dead rules.

**Finding 4 — `assignment_rules` has zero rows for the entire org.** No service has direct, round-robin, or load-balanced assignment configured; every ticket (web or WhatsApp) falls through to manual/default team assignment. Confirms Part 12: WhatsApp does not bypass assignment logic, because there is currently no assignment logic to bypass — parity holds trivially.

**Finding 5 — 5 of 7 real services route to a default team with zero active members** (Finance & Accounts, L&D, BD, Legal, Vendor Creation). Only IT Support and HR Support have a staffed default team (3 active members each). BD Support's `default_team_id` additionally resolves to a team literally named "ADMIN Support" — a naming/config mismatch independent of WhatsApp. **Recommendation for Stage 7 UAT service selection: prefer IT Support and HR Support as the primary scenarios where a real human assignment outcome needs to be observed** (see `STAGE_7_UAT_PLAN.md`).

**SLA coverage is solid**: all 7 real services have an active, fully-configured per-priority SLA policy, backed by an org-wide `global_sla_config` fallback — no ticket, from any channel, would go without a due-date.

---

## WhatsApp User Eligibility Coverage (Part 7)

Aggregate-only (no individual mobile numbers reproduced here): **0 of 62 active employees currently have any `mobile_number` set** — 0% WhatsApp eligibility today, org-wide. This must be reported honestly as "0% coverage," not as "clean data" — there is trivially no duplicate-mobile or invalid-format issue only because there is no mobile data at all yet. **This is the single largest real blocker to any meaningful Stage 7 UAT or pilot**: at least the UAT persona set (below) must have mobiles populated before Stage 7 begins.

Mobile source-of-truth re-verified (admin changes User Master mobile → new number immediately authorized, old number immediately stops working, no separate WhatsApp-specific mapping table exists) — proven by the existing `stage5-mobile-change.test.ts`, re-run clean as part of this stage's regression (see "Regression Results").

---

## Mandatory Field Coverage (Part 8)

Real production templates cover: text, textarea, phone, number, date, select, and required file. **Not present in any real production template**: radio, multiselect, checkbox/toggle, and a dedicated `email` field type (the one "Vendor Email ID" field is typed `text`, not `email`). Per the brief's explicit allowance, isolated UAT-only fixtures (not real production services) are the correct place to exercise those remaining field types — see `STAGE_7_UAT_PLAN.md`'s service matrix, which adds a small fixture service for exactly this gap rather than fabricating fake production services.

---

## Required Attachment Proof (Part 9)

Re-proven by the existing `stage5-media.test.ts` / `stage4-attachments.test.ts` / `stage5-attachment-cleanup.test.ts` suite (re-run clean this stage — see "Regression Results"): media reference → `getMediaUrl` → `downloadMedia` → MIME validation → magic-byte validation → size validation → staged to the `request-attachments` bucket (existing bucket, reused, no new bucket) → mandatory file field satisfied → no second Meta download after CREATE → object moved/linked into a normal `request_attachments` row indistinguishable from a web-uploaded attachment. **Real Meta attachment send/receive: NO** (same connectivity constraint as above). **Simulated end-to-end: YES.**

---

## Web vs WhatsApp Parity (Part 11) / Business Rules & Assignment (Part 12) / SLA (Part 13) / Final Ticket Business Logic (Part 10)

Covered by the new `stage6-web-whatsapp-parity.test.ts` and `stage6-business-rules-assignment.test.ts` (see "Tests Added") plus the pre-existing `whatsapp-stage1-create-request-core.test.ts`. `createRequestCore()` is confirmed the single call path for both channels — org_id, requester_id, service/category/sub_category, description, title, form_data, priority, status, assigned_to/team, SLA due timestamps, and `request_no` are produced identically for equivalent inputs; the only differences are channel/provenance fields (`source`, `intake_channel_id`), exactly as expected. Given Finding 4 above (no `assignment_rules` configured org-wide), both channels fall through to the same default/unassigned state — parity holds for that reason as well as by code path.

---

## Resume / Cancel / Restart / Expiry (Parts 14–16)

Re-proven clean by `stage4-conversation-e2e.test.ts` (resume mid-flow does not regenerate the auto-generated Subject, correctly returns to the exact next question), `stage5-attachment-cleanup.test.ts` (Cancel marks the conversation terminal and removes staged attachments; Restart never leaves two active drafts), and `stage4-expiry.test.ts` (lazy 24-hour expiry blocks silent continuation and triggers staged-attachment cleanup).

---

## Duplicate Delivery (Part 17) / Concurrent Delivery (Part 18)

Re-proven clean by `stage4-idempotency.test.ts` / `stage5-idempotency.test.ts` (the same Meta `message.id` replayed multiple times advances state exactly once, stages a file exactly once, creates exactly one ticket) and `stage4-concurrency.test.ts` (two near-simultaneous messages preserve Stage 4's optimistic-concurrency protection through the Stage 5 transport — no lost update, no double state advancement, no double ticket).

---

## Configuration Drift (Part 19)

Re-proven clean by `stage4-config-drift.test.ts` — mid-conversation Service/Sub-category/template/eligibility changes are safely reconciled (re-prompt or safe abort), never producing a stale/invalid ticket.

---

## Outbound Failure (Part 20)

`sendAll()` (`lib/whatsapp/webhook-handler.ts`) performs a bounded, synchronous, in-request retry (2 retries with backoff) for any `retryable`-classified Graph API failure (429/5xx/network); `auth`(401/403)/`non_retryable` failures are never retried and are surfaced to the caller rather than silently dropped. Re-proven clean by `stage5-outbound-failure.test.ts`.

---

## Operational Visibility (Part 21)

The new Readiness panel (Part 1) directly answers, from existing UI/logging, without building a new observability platform: Is WhatsApp configured? Is the channel active? Did Test Connection succeed (and when, against what phone number)? Is webhook health `ok`/`unknown`/`errors_detected`, derived from real `intake_audit_log` rows? Combined with the existing Admin → Audit Log screen (unmodified), an operator can already answer every question Part 21 asks (sender rejected, send failed, attachment staging failed, which conversation/request was involved) by filtering on the `whatsapp_*` action prefixes documented below.

---

## Audit Log Verification (Part 22)

All 9 required WhatsApp event types have real, confirmed call sites in `lib/whatsapp/webhook-handler.ts`: `whatsapp_message_processed`, `whatsapp_sender_rejected`, `whatsapp_unsupported_message`, `whatsapp_rate_limited`, `whatsapp_channel_not_found` / `whatsapp_channel_conflict`, `whatsapp_invalid_signature`, `whatsapp_status_event`, `whatsapp_attachment_link_failed` (attachment failure), `whatsapp_send_failed`. Plus the two new Part 1 actions: `whatsapp_test_connection_succeeded`/`_failed`.

A real bug in this exact area was already found and fixed in **Stage 5.1** (not this stage — re-confirmed present and correct here): `intake_audit_log.entity_id` is a genuine `UUID` column; Stage 5's original code passed Meta-native identifiers (a `wamid`, a `phone_number_id`) directly as `entityId`, causing every such INSERT to fail a Postgres type-cast and be silently swallowed by the logging function's own `try`/`catch` — meaning most WhatsApp audit rows were **never actually written**, undetected because nothing had asserted on their presence. Fixed by only ever passing a real UUID as `entityId` and moving Meta-native identifiers into the JSONB `metadata` field instead. `logWhatsAppAudit()`'s `try`/`catch` remains deliberately best-effort (audit logging must never break message processing) — its behavior, and that no rows are silently missing today, is directly re-verified by `stage6-audit-log-coverage.test.ts` (see "Tests Added").

---

## Security Regression (Part 23)

Re-proven clean by `stage4-tenant-isolation.test.ts`, `stage5-tenant-isolation.test.ts`, `stage5-webhook-security.test.ts`: invalid webhook signature, invalid verify token, unknown `phone_number_id`, inactive channel, unknown sender, inactive user, WhatsApp-disabled user, cross-org sender injection, cross-org selection ID, cross-org conversation ID, tampered interactive payload, malformed Meta payload, oversized media, spoofed MIME — all fail safely (see "Regression Results" for the exact pass count from this stage's own run).

---

## Rate Limit (Part 24)

`lib/rate-limit.ts` is a documented, deliberately single-instance in-memory limiter (`"In production with multiple replicas, replace with Upstash Redis"` — its own comment, unchanged). The WhatsApp webhook applies a per-sender limit of 30 messages/60s (generous enough that a real multi-message ticket-creation conversation, well under a dozen messages, is never throttled) and a tighter 5/300s limit specifically for repeated invalid-sender attempts, blunting number-enumeration without punishing a legitimate not-yet-registered employee retrying a few times. **No Redis was added for Stage 6**, per the brief's explicit instruction — the single-instance limitation is re-documented here for future horizontal-scaling planning, not solved.

---

## Deployment Requirements (Part 25)

No secret values below — presence/absence requirements only.

**Required (app will not run correctly without these):**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` (server alias, same value as the public URL)
- `NEXT_PUBLIC_APP_URL` — the deployment's public base URL; this is also what computes the WhatsApp webhook callback URL shown in the Readiness panel
- `TZ=Asia/Kolkata` (or the correct deployment timezone — every SLA/business-hours/cron calculation depends on it)
- `CRON_SECRET`, and for the separate cron-runner service: `CRON_TARGET_URL`, `CRON_JOBS`

**Required specifically to use a WhatsApp channel:**
- The **Intake module must be enabled** for the target org (`org_module_access`, module `intake`, `enabled=true`) — confirmed in this stage to be a real, separate gate independent of channel configuration; the local dev seed org currently has it disabled.
- Per-channel WhatsApp secrets (access token, app secret, verify token) are **not** environment variables — they are entered via Admin → Intake → Channels → "Connect credentials" and stored through the existing `intake_store_credential` / `intake_read_credential` Supabase Vault RPCs. Nothing new is required here.
- `META_GRAPH_API_VERSION` is optional — falls back to a channel's own `config.api_version`, then to a documented default (`v23.0` as of this stage) if unset.
- **Storage**: the existing `request-attachments` bucket is reused for staged WhatsApp media — no new bucket, no new migration.
- **Database**: all schema (including WhatsApp/intake tables, RLS, and Storage bucket policy) ships via `supabase/migrations/` — `npx supabase db push` against the target hosted Supabase project is the only step required; no manual DDL.
- **Public HTTPS**: the deployment must be reachable over HTTPS at a stable public URL before Meta's webhook registration (Part 3) can succeed — this environment currently has none.

**Optional** (leave unset to disable the feature): `RESEND_API_KEY`/`EMAIL_FROM` (email), `INTAKE_WORKER_URL`/`INTAKE_WORKER_SECRET`/`INTAKE_POLL_INTERVAL_MS`/`INTAKE_AUTO_ESCALATE`/`INTAKE_CLASSIFY_SINCE_DAYS` (email intake worker), `INTAKE_LLM_*` (auto-classification), `OAUTH_*` (Gmail/Outlook channel connection).

---

## Meta Business Manager Checklist (Part 26)

None of the following can be marked complete from this environment — every item requires a real Meta account action outside this sandbox. Presented as the exact operator checklist for whoever performs Part 2/3/4 for real:

1. ☐ WABA (WhatsApp Business Account) available
2. ☐ Test/controlled phone number registered to that WABA
3. ☐ Meta App created with the WhatsApp product enabled
4. ☐ System User created with a long-lived access token
5. ☐ `whatsapp_business_messaging` permission granted to that System User/token
6. ☐ App Secret obtained (App Settings → Basic)
7. ☐ Webhook callback URL configured in Meta (exact value: `https://<deployment>/api/intake/webhook/whatsapp`)
8. ☐ Verify token chosen and matched exactly between Meta's webhook config and the DESK channel's "Connect credentials" form
9. ☐ `messages` webhook field subscribed (App → WhatsApp → Configuration → Webhook fields)
10. ☐ DESK WhatsApp channel created (Admin → Intake → Channels → New channel → type WhatsApp)
11. ☐ Credentials (access token, app secret, verify token, phone_number_id, WABA ID) entered and stored in Vault via "Connect credentials"
12. ☐ "Test connection" succeeds — Readiness panel shows `Meta connection verified: YES` with a real `display_phone_number`/`verified_name`
13. ☐ Channel activated (status = active)
14. ☐ At least one registered DESK test requester available (User Master mobile number populated, matching a real WhatsApp-capable number)
15. ☐ A real "Hi" sent from that number, received end-to-end by DESK

---

## External Prerequisites

- Outbound internet / real Meta connectivity (unavailable in this sandbox)
- A public HTTPS deployment (unavailable in this sandbox)
- Real Meta Business Manager access and an authorized test WhatsApp number
- Intake module enabled for the target org
- At least the Stage 7 UAT persona set (below) with real, org-appropriate mobile numbers populated in User Master

---

## Tests Added

- `tests/integration/stage6-channel-readiness.test.ts` — `getWhatsAppChannelReadiness()` configured/verified reporting, `testWhatsAppConnection()` success/failure persistence, mobile-coverage aggregation.
- `tests/integration/stage6-web-whatsapp-parity.test.ts` — equivalent web-created vs WhatsApp-created tickets compared field-by-field for unexplained divergence.
- `tests/integration/stage6-business-rules-assignment.test.ts` — confirms WhatsApp-created tickets pass through the same (currently unconfigured) assignment/business-rule evaluation as web-created tickets, with no channel-specific bypass path, exercised through the real conversation/webhook path (not just a direct `createRequestCore()` call, which is all the pre-existing Stage 1 test proved).
- `tests/integration/stage6-audit-log-coverage.test.ts` — asserts all 9 required `whatsapp_*` audit action types produce real, queryable DB rows with correctly-typed UUID `entity_id`; found and confirms the fix for the `whatsapp_channel_not_found`/`_conflict` bug below.
- `tests/unit/whatsapp-graph-client.test.ts` — one pre-existing stale assertion updated (expected `testConnection()`'s old 2-field return shape; Part 1 added `verifiedName`).

## Bugs Found and Fixed in This Stage's Own New Code

1. **`lib/whatsapp/graph-client.ts` `testConnection()`** — requested `verified_name` from the Graph API but never read it back. **Fixed** (see "WhatsApp Channel Readiness").
2. **`lib/actions/intake/whatsapp-channel.ts` `testWhatsAppConnection()`** — a failed test never cleared `last_test_display_phone_number`/`last_test_verified_name` left over from an earlier success, so a channel that started failing kept showing stale "verified" identity data next to the error. **Fixed** — the failure-path config patch now explicitly nulls both fields, exactly the false-green state the CONFIGURED-vs-VERIFIED diagnostic exists to prevent. Re-verified by `stage6-channel-readiness.test.ts`.
3. **`lib/whatsapp/webhook-handler.ts` `logWhatsAppAudit()`** — the same failure class as the Stage 5.1 `entity_id`-type bug, on a different column: `whatsapp_channel_not_found`/`whatsapp_channel_conflict` events are, by definition, org-less (no channel matched the inbound `phone_number_id`, so no org could be resolved), but `intake_audit_log.org_id` is a `NOT NULL` column — every such insert was failing a Postgres not-null violation and being silently swallowed by the function's own best-effort `try`/`catch`. The call site existed; the row was **never actually written**. **Fixed** by routing org-less events to `owner_audit_log` instead, which already models a nullable `org_id` for exactly this kind of platform-level, pre-org event. Re-verified by `stage6-audit-log-coverage.test.ts`, which now asserts the row lands in `owner_audit_log`, not `intake_audit_log`.

**Flagged, not fixed (minor, out of Stage 6's scope):**
4. `testWhatsAppConnection()` constructs its `WhatsAppGraphClient` with no injectable `fetchImpl`, unlike the webhook path's pattern — a test seam gap, not a correctness bug (worked around in tests via global-`fetch` stubbing).
5. `lib/rules/run.ts`'s `sourceChannelOf()` has no `'whatsapp'` case, so a WhatsApp-created request never gets `source_metadata.created_via` set — a web-created and a WhatsApp-created ticket are indistinguishable to Business Rules via `source_channel` today. Not a bypass (no active rule in this org filters on `source_channel` — see Finding 3/4), but worth a deliberate decision later if a rule ever needs to target one channel specifically.

## Regression Results

`npx vitest run` ×3 consecutive, run after all fixes above: **PASS** — **73/73 test files, 586/586 tests**, all three runs, no manual cleanup between them (every fixture self-cleans on success).
`npx tsc --noEmit`: **clean**, 0 errors.
`npm run lint`: **clean**, 0 errors, 0 warnings.

## Database Cleanliness / Storage Cleanliness

Verified via read-only `psql` after the final regression run: **0** orphaned `request_conversations`, **0** orphaned `conversation_events`/`conversation_attachments`, **0** orphaned Storage objects, **0** unintended `request_attachments` — the 3 confirmatory full-suite runs above leave zero residue. Genuine seed/production-like data (the 7 real services, the 2 known Stage1.1 leftovers already flagged, the 62 real employee profiles) was left untouched — nothing was deleted.

**One pocket of inert leftover residue was found and is flagged for cleanup, not silently removed:** during this stage's test-development (before two bugs above were fixed — a `Promise.all` team-prefix collision in an early draft of `stage6-business-rules-assignment.test.ts` that crashed `beforeAll` before its own fixtures could be cleaned, and a separate tool-level interruption mid-run of `stage6-audit-log-coverage.test.ts`), the following test-tagged rows were left behind and were **not** covered by any subsequent successful `afterAll`:

- `services`: `Conv Fixture Service stage6-rules-1789117713379-b`, `Conv Fixture Service stage6-audit-1789118356500`
- `teams`: `Conv Fixture Team stage6-rules-1789117713379-b`, `Conv Fixture Team stage6-audit-1789118356500`
- `intake_channels`: `WhatsApp stage6-audit-1789118356500` (status `active`)
- `auth.users`/`profiles`: `uat-desk-003-1789118356292-stage6-audit-attach@example.test`, `uat-desk-003-1789118356292-stage6-audit-registered@example.test`

All are unambiguously tagged test fixtures (no resemblance to real seed/production data), and a direct read-only check confirms they are inert — **0** `request_conversations` reference either fixture service. Deletion was **not** performed automatically: this session's safety policy treats a direct destructive database mutation as requiring explicit user confirmation, distinct from application-level actions. Recommended cleanup (safe to run once confirmed): delete the `intake_channels` row, then the two `services` rows, then the two `teams` rows, then the two `auth.users` rows (via Supabase Admin `deleteUser`, which cascades `profiles`) — the same order the tests' own `afterAll` blocks already use elsewhere in this suite.

---

## Files Changed

- `lib/whatsapp/graph-client.ts` — `testConnection()` now reads and returns `verified_name` (previously silently dropped).
- `lib/actions/intake/whatsapp-channel.ts` — `testWhatsAppConnection()` persists non-secret outcome into `intake_channels.config` + new audit actions, and now clears stale display/verified-name on a failed test (Bug 2); new `getWhatsAppChannelReadiness()` + `WhatsAppChannelReadiness` type.
- `lib/whatsapp/webhook-handler.ts` — `logWhatsAppAudit()` now routes org-less events (`whatsapp_channel_not_found`/`_conflict`) to `owner_audit_log` instead of the `NOT NULL`-org-scoped `intake_audit_log` (Bug 3).
- `app/(app)/intake/channels/ChannelsClient.tsx` — new "Readiness" button/panel for WhatsApp channels (`ReadinessBadge`, `ReadinessRow`, `WhatsAppReadinessPanel` components; `readinessId` state).
- `tests/integration/stage6-*.test.ts` (4 new files, see "Tests Added").
- `tests/unit/whatsapp-graph-client.test.ts` — stale assertion updated for the new `verifiedName` field.

## Migrations Added

**None.** The readiness feature reuses the existing `intake_channels.config` JSONB column — no schema change required.

---

## Known Gaps

1. Real Meta connectivity, real webhook registration, and a real WhatsApp message cannot be verified from this environment — purely an environment/network limitation, not a code defect. The code paths are implemented and simulated end-to-end.
2. Two stale "Stage1.1" test services remain WhatsApp-visible with no sub-categories — dead-end flow risk (Finding 1).
3. All 7 real production templates ask Subject/Description twice (Finding 2) — by design, not a bug, but a real UX concern.
4. 3 of 4 org `business_rules` are dead (reference deleted categories); `assignment_rules` has zero rows org-wide (Finding 3/4) — pre-existing, not WhatsApp-specific.
5. 5 of 7 real services route to unstaffed default teams (Finding 5).
6. 0% of active employees currently have a mobile number on file — the single largest real blocker to a meaningful Stage 7 UAT.
7. The local dev/seed org has the Intake module disabled at the org level, which blocked a live browser click-through of the new Part 1 UI panel this stage (verified instead via typecheck/lint/tests + structural parity — see "WhatsApp Channel Readiness").
8. A small pocket of inert test-fixture residue (2 services, 2 teams, 1 WhatsApp test channel, 2 auth users) from this stage's own test-development history remains in the database, pending explicit confirmation to delete — see "Database Cleanliness" for the exact rows and recommended cleanup order.

## Blockers

**None of the above are WhatsApp-introduced correctness defects** (no ticket duplication, no tenant-isolation failure, no mandatory-field bypass, no required-attachment bypass, no invalid-webhook-acceptance, no wrong-user/wrong-org resolution, no `createRequestCore()` bypass was found anywhere in this stage's testing). All Known Gaps above are either environment limitations (1, 7) or pre-existing DESK configuration issues equally present for web-created tickets (2–6) — real, and worth fixing, but not Stage-6/WhatsApp regressions. See `STAGE_7_UAT_PLAN.md`'s Go/No-Go gate for the formal classification of each.

## Stage 7 Readiness

**READY FOR STAGE 7: YES** — for a small, controlled UAT with the persona/service adjustments called out above (populate UAT persona mobiles first; prefer IT Support/HR Support where a real staffed-team outcome must be observed; be aware the two Stage1.1 test services and the Subject/Description double-ask will show up in UAT unless addressed beforehand).

**This is explicitly NOT "ready for company-wide production."** Company-wide WhatsApp rollout remains a later stage, gated on: real Meta verification (Parts 2–4, currently NO from this environment), a public production deployment, the Intake module being deliberately enabled for the real production org (not just a UAT sandbox), and resolution of Findings 1–5 above at the business-configuration level. No production WhatsApp number was enabled as part of this stage, per instruction.

**STOP condition honored**: Stage 7 was not executed. This report and `STAGE_7_UAT_PLAN.md` are returned for architectural review before any UAT test case is run.
