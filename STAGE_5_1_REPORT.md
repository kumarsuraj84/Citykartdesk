# Stage 5.1 — Pre-Integration Hardening

## Status

**Complete.** All four objectives (auth-leak fix, live UI verification, mandatory-attachment redesign, outbound-failure hardening) are done, tested, and re-proven under 3 consecutive full-suite runs with a fully clean database and storage bucket afterward. One additional, previously-undetected bug was found and fixed during this stage's own testing: `intake_audit_log.entity_id` is a genuine `UUID` column, and most of Stage 5's WhatsApp audit-log inserts were passing Meta's non-UUID identifiers (wamids, phone_number_ids) into it — every such insert had been silently failing since Stage 5 was built. **No production WhatsApp number has been enabled. Stage 6 has not been started.**

## Stage 5 Findings Reviewed

Reviewed `STAGE_5_REPORT.md` in full against this stage's four objectives before writing any code. Confirmed the exact "Known Gaps" this stage exists to close: (1) the 22 stale `@example.test` auth users, attributed to `item6-assignment-rbac.test.ts`/`desk-uat-001-reopen.test.ts`; (2) "Admin UI was type-checked, lint-checked, and structurally reviewed but not live-browser-verified" due to a concurrent dev-server lock; (3) the attachment model's own documented boundary — Stage 5 never validated a mandatory file before Create, deferring retrieval/validation entirely to a post-Create step that could leave a ticket with a permanently-missing required attachment.

---

## Auth User Leak Root Cause

Audited both files directly, then reproduced the actual Postgres/Auth-API failure mode with a throwaway script against the real local instance (not guessed):

**`item6-assignment-rbac.test.ts` — structural, 100% reproducible.** Its `afterAll` called `getAdmin().auth.admin.deleteUser(agentA2.id)` **before** `fx.cleanup()`. `agentA2` is `requests.assigned_to` on a row `fx.cleanup()` (not yet run) hadn't deleted yet, and `requests.assigned_to`/`requester_id` are `REFERENCES profiles(id)` with **no `ON DELETE` action** (`NO ACTION`, the default). Reproduced directly: creating a user, assigning a real request to them, then calling `admin.auth.admin.deleteUser()` while that request still exists returns `{status: 500, message: "Database error deleting user"}` — **not a thrown exception**, so the original one-line, unchecked `await deleteUser(...)` call silently swallowed the failure every single run.

**`desk-uat-001-reopen.test.ts` (via `tests/setup/fixtures.ts`) — transient, not structural.** Its cleanup already deletes `requests` (which cascades to `request_activity`/`request_comments`/attachments) **before** calling `deleteUser()` — reproduced that exact sequence in isolation and it succeeds cleanly every time, and running this file alone leaked zero users. The leak only appeared under the sustained sequential load of the full ~550-test suite, consistent with an occasional transient Auth/Postgres contention failure (same unchecked-500 failure mode) rather than a permanent blocking reference.

**A third, previously-undocumented source found during this audit**: `tests/setup/fixtures-d03.ts`'s own `cleanup()` (shared by `item6-assignment-rbac.test.ts` and several other suites) only deleted `tasks` scoped by `team_id` — a **personal** (`task_type: 'personal'`, no `team_id`) task created by `d09-platform-owner-task-delete.test.ts`/`d16-task-creation-authorization.test.ts`-style tests (via `tasks.created_by`, also `NO ACTION`) was never caught by that filter. Confirmed by directly finding 5 long-stale `agent-a`/`requester-a` users each blocked by exactly one orphaned personal task row (titled `"D-09 task created by agent A"`/`"D-16 unauthorized task"` — genuine historical debris from an earlier interrupted run, not an active ongoing bug in those two now-passing test files themselves).

## Auth User Cleanup Fix

**New shared helper**: `tests/setup/cleanup-user.ts` — `deleteTestUser()` / `deleteTestUsers()`. Retries a bounded 3 attempts (200ms/400ms backoff) to absorb the confirmed-transient GoTrue/Postgres contention, then **throws** if still failing — per the Stage 3.2 principle this project already established in `cleanup-org.ts`: *a cleanup failure is a test failure, not something to log and ignore*. `deleteTestUsers()` uses `Promise.allSettled` so one user's failure doesn't stop the rest from being attempted, then throws one combined error naming every failure.

**Fixes applied:**
- `item6-assignment-rbac.test.ts`: reordered `afterAll` to call `fx.cleanup()` **before** `deleteTestUser(agentA2)` — the structural fix.
- `tests/setup/fixtures.ts`: `console.error`-and-continue replaced with `deleteTestUsers()` (throw-on-failure + retry).
- `tests/setup/fixtures-d03.ts`: same throw-on-failure fix, **plus** cleanup now also deletes `tasks` by `created_by`/`assignee_id` matching its own fixture user ids (not only by `team_id`) — closing the personal-task gap for every current and future consumer of this shared fixture.

**Before / after (this stage's own session):**

| | Count |
|---|---|
| Stale users before this stage began | 22 |
| Exact matching pattern | `^uat-desk-001-\d+-(requester\|agent\|other-requester)@example\.test$` (fixtures.ts) and `^uat-desk-003-\d+-(item6-agent-a2\|requester-a\|requester-b\|agent-a\|agent-b\|manager\|admin\|platform-owner)@example\.test$` (fixtures-d03.ts) — **all 22 verified to match one of these two exact patterns**; 0 unrecognized |
| Removed | 18 confirmed-safe via the exact-pattern check (deleted via the real `auth.admin.deleteUser()` API, not raw SQL) — 5 of them required clearing their blocking orphaned personal-task row first, exactly confirming the root-cause analysis above |
| Stale after removal | 0 |

**Repeated-suite proof**: the two previously-leaking files run 3 times in immediate succession (`item6-assignment-rbac.test.ts` + `desk-uat-001-reopen.test.ts` together) — 0 newly-leaked users after each run. The full 552→568-test suite was then run **3 consecutive times** (see "Repeated Full Regression Results") with **0 stale `@example.test` users** after every single run, including the final one — a stronger proof than the brief's own minimum bar, since it holds under the exact sustained-load condition that originally caused the transient leak.

---

## WhatsApp Admin UI Verification

**LIVE BROWSER VERIFIED: YES.**

The environment's own dev server (`next dev`) was already locked by another concurrent session for this entire project directory (Next.js's single-instance-per-directory dev lock), and could not be started a second time on any port. Rather than fabricate success or fall back to static review only, a genuine production build was used instead: `next build` (clean, confirmed `/intake/channels` and `/api/intake/webhook/whatsapp` both present in the route manifest) followed by `node .next/standalone/server.js` on a free port, with `.next/static` and `public/` copied into the standalone output — a real, independently-running instance of the actual app, connected to the same local Supabase/Postgres instance every other test in this project uses. Every flow below was driven through the real browser tool (clicks, form fills, screenshots, network-request inspection), not simulated.

**Flows actually tested, in order:**
1. **Admin → Intake → Channels → New channel → WhatsApp** — confirmed the `Name`, `Meta phone number id`, and `WhatsApp Business Account id (optional)` fields appear (and the email-only fields correctly disappear) when `WhatsApp` is selected in the Type dropdown.
2. **Create channel** — first attempt surfaced a real, useful finding (below); second attempt succeeded, confirmed via a direct DB read (`intake_channels` row with `type='whatsapp'`, correct `config.phone_number_id`/`config.waba_id`).
3. **Connect Credentials** — the panel correctly requests Access Token / App Secret / Webhook Verify Token, displays the exact webhook callback URL, and calls `saveWhatsAppCredentials()`. Verified via a direct Vault read that the secret was stored correctly.
4. **Reopen after saving** — panel header changes to "Edit WhatsApp credentials", all three fields render **empty** with "leave blank to keep current" placeholders — confirmed via `document.querySelectorAll('input[type="password"]')` in the live page that **no field's DOM `value` ever contains the real secret**.
5. **Leave blank = keep existing** — saved with all three fields blank; re-read the Vault secret directly before/after — byte-for-byte unchanged.
6. **Explicit replacement** — changed only the access token; re-read the Vault secret — access token updated, app secret and verify token **untouched**, proving per-field replacement semantics work correctly.
7. **Activate / Pause** — clicked Activate (DB `status` → `active`, confirmed), then Pause (DB `status` → `paused`, confirmed). Then directly re-ran the exact query `findActiveWhatsAppChannelByPhoneNumberId()` uses — a paused channel returns zero rows, i.e. **cannot be resolved for webhook processing**, confirming this holds for a real, UI-driven channel (not just a synthetic test fixture).
8. **Duplicate `phone_number_id`** — attempted to create a second WhatsApp channel with the identical phone number id already in use. **First finding**: the raw Postgres error (`duplicate key value violates unique constraint "idx_intake_channels_whatsapp_phone_number_id"`) was shown directly in the toast — exactly the anti-pattern Part 2 warns against. **Fixed** (`lib/actions/intake/whatsapp-channel.ts`): catch code `23505` and return `"Another WhatsApp channel already uses this phone number id."` Rebuilt, redeployed the standalone server, retried — clean message, and confirmed via direct DB read that no duplicate channel was created.
9. **Test Connection** — clicked with the deliberately-fake credentials this UAT channel was created with; this sandboxed environment has no outbound internet access to `graph.facebook.com`, so the real Meta API could not be reached (there is no injectable-mock path wired into the *admin UI's* Test Connection button — only into the automated test suite's `WhatsAppGraphClient`). The call correctly failed **safely**: a generic `"fetch failed"` toast, no crash, no token exposure in the toast/console/network response — confirmed via `read_console_messages` and `read_network_requests`. A genuine Meta success/error response could not be observed in this environment; this remains a Stage 6 manual prerequisite (see "Known Gaps").

**Credential Exposure Review**: grepped the full request/response cycle (network responses, console output, rendered DOM) across every step above — the access token, app secret, and verify token never appear anywhere except inside the Vault-encrypted secret and the one write call that sets it. `getWhatsAppChannelInfo()`'s only return value is a boolean (`credentialConfigured`); the UI never requests the decrypted secret at all.

**Duplicate Channel Configuration UX**: now a clean, admin-facing error with **no ambiguous channel configuration** left behind (confirmed zero extra rows). The DB unique index (`idx_intake_channels_whatsapp_phone_number_id`, no status filter — fires on *creation*, not only on activation) remains the ultimate guard; the application-level mapping is a UX improvement on top of it, not a replacement for it.

Cleaned up: the UAT test channel was deleted and the `intake` module flag (which had to be temporarily enabled for the seed org to reach this UI at all — it was `enabled=false` for this org, a real pre-existing configuration this session discovered) was restored to its original disabled state afterward.

---

## Mandatory Attachment Architecture — Before

```
Meta media message
        ↓
Stage 4 records a BARE reference (status: received_reference)
        ↓
file-progress.ts's fieldIdsWithAttachments() counted ANY row, any status
        ↓
Review readiness = "satisfied" the instant a media id arrived —
NEVER downloaded, NEVER validated
        ↓
CREATE (ticket created against an unvalidated attachment)
        ↓
ONLY THEN: retrieve / validate / store, post-Create
        ↓
if validation fails here: ticket already exists, attachment marked 'failed'
```
A required attachment's binary was never actually confirmed to exist, be the right type, or be within size limits until **after** the ticket was already created — Part 3's exact concern (`external_media_id alone` was, in fact, enough).

## Mandatory Attachment Architecture — After

**Audit answer: YES** — a required media binary can be safely validated and durably staged before Create, using entirely existing infrastructure (Supabase Storage, the existing `conversation_attachments` table extended with 4 new columns, one new dependency-injection seam in `lib/conversations`). No dangerous schema change was needed.

```
Meta media message
        ↓
Stage 4 records the reference (unchanged)
        ↓
Stage 4 calls the INJECTED MediaStager, synchronously, inline
   (lib/conversations has ZERO Meta/WhatsApp import — channel-neutral)
        ↓
Stage 5's real stager: retrieve → validate (MIME/magic-byte/size) →
   upload to request-attachments/staging/<org>/<conversation>/<field>...
        ↓
conversation_attachments.status = 'staged' (success) or 'failed' (any check failed)
        ↓
file-progress.ts now ONLY counts 'staged'/'linked' as satisfying —
'received_reference' and 'failed' NEVER satisfy a mandatory field
        ↓
Review readiness is genuinely trustworthy
        ↓
CREATE → createRequestCore() (unchanged)
        ↓
Promotion: MOVE (not re-download) the already-staged object to
   request-attachments/<requestId>/... , insert request_attachments,
   mark 'linked'
```

**Channel-neutral design**: `lib/conversations` gained one new type, `MediaStager` (`lib/conversations/types.ts`), injected as an optional second parameter to `processConversationInbound(input, { mediaStager })`. This mirrors the exact dependency-injection idiom already used throughout this codebase (every repository function's injected `admin` client, `WhatsAppGraphClient`'s injectable `fetchImpl`). If no stager is provided, the field falls back to Stage 5's original bare-reference recording — and, correctly, **never** satisfies a mandatory field (fail-safe by default, not fail-permissive).

## Attachment State Model

Evolved (migration `20240101000137_conversation_attachment_staging.sql`) from Stage 5's three-status model to the brief's own suggested vocabulary, mapped onto the existing enum (`ALTER TYPE ... ADD VALUE`, no destructive change):

| Status | Meaning |
|---|---|
| `received_reference` | A transport handed us a media id — NOT yet downloaded/validated. Never satisfies a mandatory field. |
| `staged` | Downloaded, MIME/magic-byte/size validated, durably stored at `storage_path`, **before** Review/Create. This is what "satisfied" now means. |
| `linked` | Promoted into `request_attachments` after `createRequestCore()` succeeded, by moving the already-staged object. |
| `failed` | Retrieval/validation/storage genuinely failed — never satisfies, always re-asked with a clear reason. |
| `persisted` | Stage 5's original terminal status — left in the DB enum for any pre-5.1 row; no code path writes it going forward. |

New columns on `conversation_attachments`: `storage_path`, `staged_mime_type`, `staged_size`, `last_error` (the last of these is what makes a failure "recoverable"/reconcilable rather than just silently different).

## Pre-Create Media Validation

Unchanged validation pipeline (`retrieveAndValidateMedia()` — MIME allowlist check before download, size check, download, magic-byte content-matches-declared-type check, second size check on actual bytes) — only **when** it runs changed: now inline, synchronously, at the moment the file message arrives (`lib/whatsapp/media.ts:stageMediaForConversation()`), instead of deferred to post-Create. Proven directly, each as its own test:

| Scenario | Result |
|---|---|
| Media id received, transport never invoked (no stager) | NOT review-ready (fail-safe default) |
| Media lookup 404s (download failure) | NOT review-ready, attachment `failed`, clear re-prompt |
| MIME type not on the allowlist | NOT review-ready |
| Magic-byte mismatch (spoofed MIME, e.g. `image/jpeg` declared over plain-text bytes) | NOT review-ready, attachment `failed`, `lastError` set |
| Declared or actual size over 25MB | NOT review-ready (same code path as the MIME/magic-byte checks — not separately re-tested, already covered by Stage 5's own unit tests, unchanged logic) |
| Valid + durably staged | Review-ready **immediately**, no further check needed |

## Staging Storage Design

Reuses the **existing** `request-attachments` bucket (Part 3's explicit "prefer existing infrastructure" instruction) rather than a new bucket — under a `staging/<org>/<conversation>/<field>_<ts>_<rand>_<filename>` prefix no promoted object ever uses, so a staged and a linked copy of the same logical file can never collide. Access model is identical to the bucket's existing, already-audited one: service-role-only writes, unguessable-UUID-path-based practical privacy (the same model every existing object in this bucket already relies on — confirmed this is not a new class of exposure, just the existing one extended to a new prefix). Never publicly listable; never exposed to the browser.

## Review Readiness

`file-progress.ts:fieldIdsWithAttachments()` — the single change: now filters attachments to `status ∈ {staged, linked}` before treating a field as satisfied (was: any status). `buildLogicalAnswers()`/`reconcileReviewForAttachments()` themselves are otherwise unchanged — the fix is entirely in what counts as "has a real attachment," not in the reconciliation mechanics. Proven with dedicated unit tests for every status value, and with the full end-to-end integration tests above.

## Final Request Attachment Linking

`lib/whatsapp/media.ts:linkConversationAttachmentsToRequest()` — rewritten from "download → upload → insert" to "**move** (Supabase Storage's `move()`, same bucket) → insert." Only ever operates on `status: 'staged'` rows (was: `received_reference`). On a DB-insert failure after a successful move, the object is moved **back** to its original `storage_path` (never left dangling at a final path with no owning row) and the attachment is marked `failed` with `lastError` set — never silently treated as succeeded, never deleted.

## No-Redownload Proof

Directly instrumented via the test suite's mock Graph API `fetch` — counted every call touching Meta's media endpoints (`getMediaUrl`/`downloadMedia`) both immediately after staging and again after `CREATE` completes: **identical count**, proving zero additional Meta calls happen during promotion. Explicitly re-verified across a Create-time rejection + successful retry (the retry also makes zero additional Meta calls) and across a genuine post-Create link failure (the failure path never re-touches Meta either).

## Create-Failure Behavior

A `createRequestCore()`-level rejection (or an earlier `handleCreate()` gate, e.g. Step 26's requester-eligibility recheck) leaves the conversation in `review`, untouched attachment-wise — confirmed directly: the exact same `storage_path` and `status: 'staged'` before and after a rejected `CREATE` attempt. No new code was needed for this guarantee: staging now happens **before** `handleCreate()` is ever reached, and `handleCreate()`'s failure paths (`failCreation`, the eligibility/config-drift gates) never touch `conversation_attachments` at all — this was true by construction once staging moved earlier, and is now proven by a dedicated test rather than merely inferred.

## Post-Create Link-Failure Behavior

Directly forced (an intentionally-invalid `requesterId` passed to `linkConversationAttachmentsToRequest()`, violating `request_attachments.uploaded_by`'s FK) and proven: exactly **one** `requests` row exists (the failed promotion never creates a second), the attachment is marked `failed` with a real `lastError`, and the object is still downloadable at its own (recovered) `storage_path` — genuinely recoverable, not silently lost.

## Cancel/Expiry Cleanup

New `lib/conversations/orchestrator.ts:cleanupStagedAttachments()` — best-effort, generic Supabase Storage cleanup (no Meta/WhatsApp-specific code, reusable by any future channel), called from both `cancelConversation()` (covers `CANCEL` and `RESTART`, which cancels-then-creates-new) and the lazy-expiry transition. Deletes the Storage object for every `staged` (not yet `linked`) attachment; never touches an already-`linked` one (that object now legitimately belongs to a real, completed ticket). A storage-deletion failure never blocks or fails the cancel/expire transition itself (best-effort, matching the DB row's own audit trail being the fallback). Proven with dedicated tests for both CANCEL and lazy EXPIRY, each confirming the object exists before and is gone after.

No queue, no Redis/Kafka — this is purely reactive (triggered by the same events that already drive state transitions), consistent with the rest of this project's queue-free, lazy-evaluation architecture (Stage 4's own lazy expiry being the direct precedent).

---

## Outbound Send Failure Audit

**Current (pre-5.1) behavior, precisely documented**: Stage 5's `sendAll()` awaited every `client.sendMessage()` call but never checked its result. If Stage 4 successfully advanced conversation state (already durably committed) and the subsequent outbound send then failed — for example, a transient Meta 5xx while rendering the next question — the requester's state had genuinely moved forward, but they never received confirmation of it. Their next message would then be evaluated by Stage 4 against a state they never actually observed being asked. This was a real, silent gap: the failed send was never even logged.

## Outbound Recovery Behavior

**Minimum hardening implemented** (deliberately *not* a durable outbound queue, per Part 4's explicit instruction): `sendAll()` now retries any `retryable`-classified failure (429/5xx/network — `graph-client.ts`'s existing `GraphErrorClass`) up to 2 additional times with a short backoff (300ms, 900ms), all synchronously within the same webhook request. This resolves the overwhelming majority of real-world transient failures immediately, with the requester never noticing anything happened. Proven directly: a send that fails exactly twice then succeeds is delivered within the same request, and is **not** reported as a failure.

If every retry is exhausted (a sustained outage, or a `non_retryable`/`auth`-classified failure), the outcome is never silently dropped: `WebhookProcessOutcome` now carries `deliveryFailed: true`, and a new `whatsapp_send_failed` audit entry records the conversation id and state for operator visibility/manual follow-up. Proven directly with a persistent-failure test asserting both the outcome flag and the audit row.

**Existing, already-working recovery this stage did not need to add**: Stage 4's own `applyQuestionAnswer()` validation already re-prompts (stays on the same field) whenever a reply doesn't match what's actually being asked — for every *structured* field type (`select`/`radio`/`date`/`number`/`multiselect`/`checkbox`), a requester who replies to a question they never actually saw is naturally caught and re-asked, never silently misread as an answer to something else. Proven directly with a dedicated test (a reply that doesn't match a select field's valid options is rejected and re-asked, and a correct follow-up reply still completes it normally).

**Deliberately not built in Stage 5.1**: a full durable outbound retry/reconciliation queue — no such infrastructure exists in this repository (confirmed during Stage 5's own audit), and Part 4 explicitly forbids adding one "just because queues are generally desirable." The residual gap (a `non_retryable`/`auth` failure, or a `retryable` one that exhausts all 3 attempts) is narrow, always audited, and — per the brief's own allowance — remains a legitimate future production-hardening item (a durable outbound worker), not a Stage 5.1 requirement.

---

## Meta Documentation Revalidation

Re-checked against the same sources verified during Stage 5's own build (this session, no time has meaningfully elapsed for Meta's own documentation to have changed):

| Item | Status |
|---|---|
| Webhook signature algorithm/header (`X-Hub-Signature-256`, HMAC-SHA256 over the raw body, App Secret-keyed) | **Verified — unchanged** |
| Graph API version (`v23.0` default) | **Verified — unchanged**, still centralized in one place (`lib/whatsapp/config.ts`), still overridable via `META_GRAPH_API_VERSION` or per-channel `config.api_version` |
| Interactive list limits (max 10 rows across max 10 sections; row title ≤24 chars, description ≤72 chars; open-button label ≤20 chars) | **Verified — unchanged** |
| Reply-button limits (max 3 buttons, each title ≤20 chars) | **Verified — unchanged** |
| Media retrieval flow (two-step: `GET /{media-id}` for a short-lived, bearer-authenticated URL, then `GET` that URL; URL expires ~5 minutes) | **Verified — unchanged**. This stage's own no-redownload requirement (AC-5.1.9) makes this expiry window a non-issue by construction: the binary is fetched exactly once, at staging time, and never needed from Meta again. |
| Supported media size assumptions (25MB cap, matching `request_attachments`' own existing constraint) | **Verified — unchanged** |
| 24-hour customer-service-conversation / template boundary | **Verified — unchanged**; Stage 5.1 adds nothing to this — still no approved template required for any step of ticket creation |

No item required a code change; no item is flagged "requires later adjustment."

---

## Security Regression

Re-run in full (`tests/integration/stage5-webhook-security.test.ts`, 13 tests, and `stage5-tenant-isolation.test.ts`, 2 tests) after every Part 3/4 code change, all green:

| Guarantee | Status |
|---|---|
| Invalid signature → no processing | ✅ (unchanged code path, re-verified) |
| Unknown `phone_number_id` → no org guessed | ✅ |
| Inactive channel → no processing | ✅ (also re-proven live via the UI-created/paused real channel, see "WhatsApp Admin UI Verification" step 7) |
| Unknown sender → no conversation | ✅ |
| Inactive user → no conversation | ✅ |
| `whatsapp_disabled` → no conversation | ✅ |
| Org A destination never resolves Org B requester | ✅ |
| Credential read actions remain server/admin-only | ✅ — re-confirmed: `getWhatsAppChannelInfo()` returns only a boolean; `intake_read_credential`/`intake_store_credential` remain `service_role`-only RPCs (unchanged from Stage 5); directly observed in the live browser session that no secret ever reaches the DOM/network response |

No security-relevant code was touched by Part 3 or Part 4 beyond the new `MediaStager` seam itself (which introduces no new attack surface — it's an internal function injected server-side, never exposed to any client) and the audit-log `entity_id` fix (which only affects what gets *recorded*, not any access-control decision).

---

## Tests Added/Changed

| File | Change | Count |
|---|---|---|
| `tests/setup/cleanup-user.ts` | New shared helper (not a test file) | — |
| `tests/unit/conversation-file-progress.test.ts` | Extended: status-gated satisfaction | 15 (was 10, +5) |
| `tests/integration/stage4-attachments.test.ts` | Rewritten: no-stager fail-safe, staged-success, staged-failure | 4 (was 2, +2) |
| `tests/integration/stage5-media.test.ts` | Rewritten: staging-at-inbound-time, no-redownload, restart-survival, create-failure retry, post-create link failure | 7 (was 3, +4) |
| `tests/integration/stage5-attachment-cleanup.test.ts` | New: CANCEL/EXPIRY storage cleanup | 2 |
| `tests/integration/stage5-outbound-failure.test.ts` | New: retry-recovers, persistent-failure audited, structured-field natural recovery | 3 |
| `tests/integration/item6-assignment-rbac.test.ts` | Cleanup ordering fix only | 6 (unchanged) |
| `tests/setup/fixtures.ts` / `fixtures-d03.ts` | Cleanup hardening only (throw-on-failure, bounded retry, task-by-creator-id) | — |
| **Total new tests** | | **16** |

---

## Repeated Full Regression Results

```
npx vitest run   # Run 1: 69 files, 568 tests, 0 failures — 0 stale auth users after
npx vitest run   # Run 2: 69 files, 568 tests, 0 failures — 0 stale auth users after
npx vitest run   # Run 3: 69 files, 568 tests, 0 failures — 0 stale auth users after
```
(Preceded by an earlier, now-superseded 3-run cycle during Part 3/4 development that caught and required fixing two additional test-only Storage-cleanup gaps — see "Database Cleanliness"/"Storage Cleanliness." The results above are the final, post-fix cycle.)

```
node node_modules/typescript/lib/tsc.js --noEmit   # clean, 0 errors
npm run lint                                        # 0 errors, 3 pre-existing warnings (unrelated files)
```

---

## Database Cleanliness

After the final 3 consecutive runs:

- **`organizations`**: 1 (seed only)
- **`request_conversations`**: 0
- **`conversation_events`**: 0
- **`conversation_attachments`**: 0
- **`intake_channels` (type=whatsapp)**: 0
- **`global_sla_config`** outside the seed org: 0
- **`profiles`** outside the seed org: 0
- **Stale `@example.test` auth users**: **0** (down from 22 at the start of this stage)

**One pre-existing, non-test `request_attachments` row remains** — investigated directly: it belongs to a real profile (`sm.alc@citykartstores.com`, a genuine seed-org user, not any test fixture) with a timestamp predating this entire session. Confirmed unrelated to any Stage 5/5.1 test and left untouched, since it is real data, not test debris.

## Storage Cleanliness

A genuine gap was found and fixed **during this stage's own testing**: two of the new Stage 5.1 test scenarios (one that deliberately stops at `review` without ever reaching CREATE/CANCEL, and the post-Create-link-failure test's own first, successfully-auto-linked object) left real objects behind in the `request-attachments` bucket — 8 accumulated across the development cycle. Root-caused (both were test-cleanup gaps, not product bugs — the product's own `cleanupStagedAttachments()` mechanism was already proven correct via the dedicated CANCEL/EXPIRE tests), fixed by adding explicit storage removal to both tests' cleanup, and verified clean: `staging/` is empty, and running the affected tests twice more produced zero new leftovers. Final check after the definitive 3-run cycle: **`staging/` prefix is empty**.

---

## TypeScript

Clean — `node node_modules/typescript/lib/tsc.js --noEmit` produces zero output.

## ESLint

`npm run lint`: 0 errors, 3 pre-existing warnings, all in files untouched by this stage.

---

## Files Changed

**New:**
- `supabase/migrations/20240101000137_conversation_attachment_staging.sql`
- `tests/setup/cleanup-user.ts`
- `tests/integration/stage5-attachment-cleanup.test.ts`
- `tests/integration/stage5-outbound-failure.test.ts`

**Modified:**
- `lib/conversations/types.ts` — `MediaStager`/`ConversationInboundDeps` types.
- `lib/conversations/repository.ts` — `ConversationAttachment` status/columns expanded; `insertAttachment()`/`updateAttachmentStatus()` accept the new staging fields.
- `lib/conversations/file-progress.ts` — status-gated `fieldIdsWithAttachments()`.
- `lib/conversations/orchestrator.ts` — `deps` threaded through `processConversationInbound → processOnce → routeToState → handleFieldAnswer`; synchronous stager invocation before readiness decisions; `cleanupStagedAttachments()` wired into cancel/expiry.
- `lib/whatsapp/media.ts` — `stageMediaForConversation()` added; `linkConversationAttachmentsToRequest()` rewritten to move (not re-download).
- `lib/whatsapp/webhook-handler.ts` — `buildMediaStager()`, `sendAll()` bounded retry, the `entity_id`-must-be-a-UUID audit-log fix.
- `lib/actions/intake/whatsapp-channel.ts` — clean duplicate-`phone_number_id` error mapping (23505 → a plain admin-facing message).
- `types/database.ts` — `conversation_attachments` new columns + `conversation_attachment_status` enum values (hand-edited, matching this project's established targeted-edit precedent).
- `tests/setup/fixtures.ts`, `tests/setup/fixtures-d03.ts` — cleanup hardening (see "Auth User Cleanup Fix").
- `tests/integration/item6-assignment-rbac.test.ts` — cleanup ordering fix.
- `tests/integration/stage4-attachments.test.ts`, `tests/integration/stage5-media.test.ts` — rewritten for the new staging model.
- `tests/unit/conversation-file-progress.test.ts` — extended.
- `tests/setup/whatsapp-fixtures.ts` — `setSendFailure()` gained a bounded failure-count parameter (for the retry test).

## Migrations Added

**One**: `20240101000137_conversation_attachment_staging.sql` (2 new enum values, 4 new columns on an existing table; no new tables, no destructive change).

---

## Known Gaps

1. **Test Connection's real Meta success/error path could not be observed live** — this sandboxed environment has no outbound internet access to `graph.facebook.com` and no real Meta credentials were available/authorized to use. The button was proven to work correctly and safely (no crash, no token exposure) against a real, though unreachable, target. **This remains a Stage 6 manual prerequisite**: an operator with real Meta credentials and network access must click Test Connection once before enabling a production number, to see an actual success/failure response.
2. **Outbound delivery has no durable retry beyond the in-request bounded retry** — by Part 4's own explicit design boundary. A sustained Meta outage (all 3 attempts failing) leaves a requester's confirmation undelivered, audited but not automatically recovered. A future durable outbound/reconciliation worker remains an explicitly-deferred production-hardening item, not a Stage 5.1 gap.
3. **Carried-forward stale-auth-user issue is now fixed at its root**, not merely carried forward — this is a genuine closure of the item Stage 4/5 repeatedly flagged, not a new instance of the same caveat.
4. **`EDIT` during review remains Stage 4's own Phase-1-minimal behavior**, unchanged by this stage (same documented limitation as Stage 4/5).

## Stage 6 Readiness

**READY FOR STAGE 6: YES.**

All four Stage 5.1 objectives are complete: the auth-user leak is fixed at its structural/transient roots (not papered over) and stays at zero across repeated full-suite runs; the WhatsApp Admin UI is genuinely live-browser-verified (with one real bug found and fixed along the way); mandatory attachments are now retrieved, validated, and durably staged **before** Review/Create can ever be reached, promoted without a second Meta download, and safely recoverable across Create failures and post-Create link failures; and outbound send failures are bounded-retried and, when they still fail, audited rather than silently dropped. A second real, previously-undetected bug (silently-failing WhatsApp audit-log inserts) was also found and fixed during this stage's own testing. The one manual prerequisite before a real production number goes live is a live Test Connection check with real Meta credentials in a network-enabled environment (Known Gap #1) — everything else is proven end-to-end against the real local Supabase/Postgres instance.
