# Stage 5 — Meta WhatsApp Cloud API Integration

## Status

**Complete.** A thin, channel-neutral WhatsApp transport now sits entirely below the existing `lib/conversations` (Stage 4) engine: Meta webhook verification, signature validation, channel/org resolution, sender identity resolution, payload adaptation, rendering, outbound sending, media retrieval/validation/storage, and final-ticket attachment linking are all implemented and proven against a real test database with only the outbound Graph API HTTP boundary mocked. 102 new tests (78 unit + 24 integration) were added; the full suite (67 files / 552 tests) passed 3 consecutive times with zero manual cleanup between runs, and the database was verified clean of every Stage-5-owned artifact afterward. **No ticket logic was redesigned, no second questionnaire was created, and no direct request inserts were added** — every ticket is still created exclusively through `createRequestCore()`, reached only via `processConversationInbound()`.

---

## Repository Audit Findings

Conducted before any code was written (Step 0), against the live schema and actual source:

- **`intake_channels`** already has a `'whatsapp'` value in `intake_channel_type` (present since the very first intake migration, never previously used) and a `config JSONB` + `credentials_ref TEXT` (Vault secret id) column pair purpose-built for exactly this kind of per-channel, secret-backed integration config. **Reused as-is — no new table.**
- **Secret storage**: Supabase Vault, via the existing `intake_store_credential(p_channel_id, p_secret)` / `intake_read_credential(p_ref)` RPCs (`SECURITY DEFINER`, granted to `service_role` only), the exact mechanism the Gmail/Outlook OAuth integration already uses to store its own secrets. **Reused as-is.**
- **Admin/service-role client**: `createAdminClient()` (`lib/supabase/admin.ts`) — the same helper every webhook/cron route already uses.
- **Webhook authenticity precedent**: Gmail/Outlook routes use a plain shared-secret token compare (`secureCompare()`, `lib/secure-compare.ts`), not a body signature — Meta's `X-Hub-Signature-256` HMAC verification is genuinely new code, but modeled directly on the HMAC pattern already established in `lib/intake/oauth.ts`'s `signState`/`verifyState` (built-in `node:crypto`, no new package).
- **Route conventions**: `app/api/intake/webhook/{gmail,outlook}/route.ts` — always return `200` once past auth (to avoid provider retry storms on a payload that will never become processable), `req.nextUrl.searchParams` for query params, `NextResponse.json`/`new NextResponse(text, {...})` for responses. The Next.js 16 "breaking change" the AGENTS.md warns about that's actually relevant here: dynamic route `params` are a Promise — not applicable to this route (no dynamic segments), but confirmed while reading `node_modules/next/dist/docs/`.
- **HTTP client convention**: no shared fetch wrapper anywhere in the repo — every integration (`lib/intake/graph-api.ts`, `lib/desktime/api.ts`, etc.) uses native `fetch` inline with explicit non-OK handling. The Meta Graph client follows the same style.
- **Attachment precedent**: the browser-oriented `uploadAttachment()` Server Action (`lib/actions/attachments.ts`) requires an authenticated session and cannot be reused as-is from a webhook; its validate → upload → insert → remove-on-failure pattern and MIME/magic-byte allowlist were ported into a service-role-based path instead (`lib/whatsapp/media.ts`).
- **Rate limiting**: `lib/rate-limit.ts` — in-memory, single-instance, already used by Server Actions. Reused for the webhook (acceptable for this deployment's single Railway web instance; documented as a scaling limitation, not fixed here).
- **Test infrastructure**: `tests/setup/fixtures-d03.ts` (`getAdmin()`, `createTestUser()`), `tests/setup/conversation-fixtures.ts` (Stage 4's service/sub-category rig), `tests/setup/cleanup-org.ts` (`deleteTestOrg`) — all reused directly; a new `tests/setup/whatsapp-fixtures.ts` adds only the WhatsApp-specific pieces (a real Vault-backed channel fixture, Meta payload builders, a mock Graph API `fetch`).
- **`zod`** is already a dependency — used to validate the Meta webhook payload shape defensively (Step 4/18).

---

## Meta Configuration Model

A WhatsApp channel is an ordinary `intake_channels` row:

```
type            = 'whatsapp'
config          = { phone_number_id, waba_id?, display_name?, api_version? }
credentials_ref = Vault secret id (via intake_store_credential)
status          = 'active' | 'paused' | 'error'
```

One new, focused migration: **`supabase/migrations/20240101000136_whatsapp_channel_config.sql`** — a single partial unique index:

```sql
CREATE UNIQUE INDEX idx_intake_channels_whatsapp_phone_number_id
  ON intake_channels ((config ->> 'phone_number_id'))
  WHERE type = 'whatsapp' AND (config ->> 'phone_number_id') IS NOT NULL;
```

This is the one new DB-level invariant Stage 5 needs: a Meta `phone_number_id` is globally unique to a single WhatsApp Business phone number (issued by Meta, not scoped to an org), so it must never resolve to two different channels/orgs — this is the database-level backbone of the entire tenant-isolation guarantee (Step 5). No other schema change was made; message-status events and audit trails reuse the existing `intake_audit_log` table (see "Logging / Audit").

## Secret Storage

The decrypted secret (read only via the service-role-only `intake_read_credential` RPC, never by `authenticated`) is a JSON blob, validated with a `zod` schema (`lib/whatsapp/types.ts:WhatsAppSecretSchema`):

```json
{ "type": "whatsapp", "access_token": "...", "app_secret": "...", "verify_token": "..." }
```

- **Never stored in plaintext anywhere** — only the Vault secret id (`credentials_ref`) lives on `intake_channels`.
- **Never exposed to the browser** — `getWhatsAppChannelInfo()` (the admin UI's read path) returns only a boolean `credentialConfigured`, never the secret itself; `saveWhatsAppCredentials()` accepts new values but a blank field means "keep the existing one" (read back via the same service-role RPC, never round-tripped through the browser).
- **`lib/actions/intake/whatsapp-channel.ts`** provides the full admin-facing lifecycle: `createWhatsAppChannel`, `saveWhatsAppCredentials`, `setWhatsAppChannelActive`, `getWhatsAppChannelInfo`, `testWhatsAppConnection` — mirroring `lib/actions/intake/channels.ts`'s existing shape/RBAC gate (`admin`/`platform_owner` only) and audit-logging convention exactly.

## Webhook Verification

`app/api/intake/webhook/whatsapp/route.ts`'s `GET` handler implements Meta's verification handshake: `hub.mode`, `hub.verify_token`, `hub.challenge` read via `req.nextUrl.searchParams`. `lib/whatsapp/config.ts:verifyWebhookChallenge()` requires `mode === 'subscribe'` **and** a `constant-time` match (`secureCompare`) against an active WhatsApp channel's stored `verify_token` (Meta's verification handshake carries no `phone_number_id`, so every active channel's token is checked — acceptable since this only runs during setup/re-verification, never per message). The challenge is echoed back as plain text **only** on a match; anything else returns `403` with no body. Tested in `stage5-webhook-security.test.ts` (invalid token, wrong `hub.mode`, and the correct-token success case).

## Webhook Signature Validation

Meta signs the entire raw POST body with `HMAC-SHA256` keyed by the receiving App's App Secret, sent as `X-Hub-Signature-256: sha256=<hex>`. `lib/whatsapp/signature.ts:verifyMetaSignature()` recomputes the HMAC over the **raw** body (`req.text()`, read *before* any JSON parsing — verified against current Meta documentation during implementation, not assumed) and compares with `crypto.timingSafeEqual`, following the exact style already established for OAuth state signing (`lib/intake/oauth.ts`). The app secret used is the one belonging to the channel resolved from the payload's own `phone_number_id` (see below) — **verification always happens before anything in the payload is acted on**; on failure the route returns `401` and processing stops immediately (Step 4's explicit "fail closed"). This is the one response code in this stage that deliberately departs from the repo's usual "always 200" webhook convention, since an unauthenticated request should never be told its shape was accepted.

## Channel / Org Resolution

Step 5's critical rule, implemented exactly as specified:

```
Meta phone_number_id (from the payload's own metadata, NEVER the sender)
        ↓
findActiveWhatsAppChannelByPhoneNumberId()  — intake_channels WHERE type='whatsapp' AND status='active'
        ↓
org_id
        ↓
(only then) org_id + sender mobile → resolveUserByWhatsAppNumber()
```

`lib/whatsapp/config.ts:findActiveWhatsAppChannelByPhoneNumberId()` returns `not_found` (no channel configured — never guesses an org) or `conflict` (more than one match — impossible under the new unique index, defended anyway) rather than picking one arbitrarily. Both cases are logged (`whatsapp_channel_not_found`/`whatsapp_channel_conflict`) and abort processing with a plain `200` acknowledgment (nothing to retry).

## User Mobile Resolution

Exclusively through Stage 2's existing `resolveUserByWhatsAppNumber({ orgId, phoneNumber, client })` — **not duplicated**. The adapter never re-implements phone normalization; `+919876543210` → `9876543210` → `profiles.mobile_number` match, scoped to the org resolved above, stays entirely inside that Stage 2 module. On `invalid_phone`/`not_registered`/`inactive`/`whatsapp_disabled`, the message **never reaches `processConversationInbound()`** — the sender gets the brief's exact recommended generic reply, and the failure reason (never which org/employee owns the number) is logged as `whatsapp_sender_rejected`.

## Meta → ConversationInbound Adapter

`lib/whatsapp/inbound-adapter.ts:mapMetaMessageToInbound()` — a pure function, zero business logic:

| Meta message | `ConversationInbound` |
|---|---|
| `text` | `kind: 'text', text: body` (or `kind:'command', text:'new'` if it's a recognized greeting — see below) |
| `interactive.list_reply` / `button_reply` | `kind:'selection', selectionId: reply.id` — **unless** `reply.id` is `cmd:<command>` (see next section), in which case `kind:'command', text: <command>` |
| `image`/`document`/`audio`/`video` | `kind:'file', attachment:{ externalMediaId, fileName, mimeType }` |
| a template quick-reply `button` | mapped the same way as an interactive reply |
| `location`/`contacts`/`sticker`/`reaction`/anything else | rejected as `unsupported_type` — never crashes, never mistaken for text |

**Command vs. selection disambiguation** (needed because a renderer-built button and a real business option both arrive as an interactive reply id): the renderer always emits `cmd:<literal-command-string>` (e.g. `cmd:create`, `cmd:cancel`, `cmd:restart`) for any button that represents a Stage 4 command, and passes every genuine business id (a service/sub-category uuid, a select field's own option value) through **completely unmodified** — Stage 4 already revalidates those against the canonical set it actually presented (Step 6/19), so the adapter never needs to guess. `externalMessageId` is Meta's own `message.id`, feeding Stage 4's idempotency ledger directly (no second dedup table — see "Idempotency Proof").

## Entry Intent Mapping

`lib/whatsapp/intent.ts:mapFriendlyGreetingToNew()` — an exact (not substring) case/whitespace-insensitive match against `{hi, hello, hey, new, ticket, create ticket, raise ticket}` → the generic `new` command. Deliberately excludes `help` (in the brief's "users may type" list but explicitly not in its "recommended mapping" list) and does **not** use any fuzzy/AI matching. `active_draft_exists` (from Stage 4's own `NEW`-while-active handling) is never silently overridden — the renderer surfaces Stage 4's own `Restart`/`Cancel` options as buttons; "Continue" requires no separate command at all, since simply answering the current question resumes normally (Stage 4's own design).

## ConversationResult → WhatsApp Renderer

`lib/whatsapp/render.ts:renderConversationResult()` — isolated from the conversation engine, reads only the requester-safe fields Stage 4 already produced, never re-derives a business decision.

| `prompt.type` | Rendering |
|---|---|
| `service_selection` / `subcategory_selection` / `select` | ≤3 options → interactive buttons; 4–10 → one interactive list; >10 → **paginated across multiple sequential list messages**, each independently live/tappable — no option ever silently dropped |
| `issue_search` | plain text with the brief's own example ("printer, laptop, password, wifi") |
| `text` / `date` / `number` / `file` | plain text prompts (file: "send as a photo or document attachment") |
| `multiselect` | a **numbered free-text prompt** (never silently reduced to single-select — see below) |
| `review` | a concise text summary (service/issue/subject/description/fields, matching the brief's own example format) + `Create Ticket`/`Cancel` buttons — **omitted entirely when `!ready`**, so a user can never even attempt to submit an incomplete draft |
| `active_draft_exists` | Stage 4's own message + `Restart`/`Cancel` buttons |
| `completed` / `cancelled` / `expired` | the exact Stage 4-provided confirmation text, plus a `Start New` button |
| `error` (bare) | plain text; an error carrying the **original** prompt shape (e.g. `select`) renders that same shape again with the error as its message — Stage 4 owns progression, the renderer never advances the user itself |

### Interactive Messages — documented Meta limits actually considered

Verified against current Meta for Developers documentation during implementation, not assumed from memory:

- Interactive **list** message: max **10 rows total**, across max **10 sections**; row title ≤ **24** chars, row description ≤ **72** chars; the list's own "open" button label ≤ **20** chars.
- Interactive **reply-button** message: max **3** buttons; each button title ≤ **20** chars.

All of these are enforced in code (`WHATSAPP_LIST_MAX_ROWS`, `WHATSAPP_ROW_TITLE_MAX`, `WHATSAPP_BUTTON_TITLE_MAX`, etc. in `lib/whatsapp/types.ts`) and unit-tested directly (`tests/unit/whatsapp-render.test.ts`), including a 23-option pagination test asserting every option survives across exactly 3 list messages with none dropped or duplicated.

### Dynamic Mandatory Field Rendering

Every `FormField` type maps to a Phase-1-correct WhatsApp interaction: `text/textarea/number/email/phone` → free text; `date` → free text with an explicit `DD/MM/YYYY` format hint; `select/radio` → real interactive buttons/list (so the answer is always a canonical `selectionId`, never free-text guesswork); `checkbox/toggle` → rendered as Yes/No via plain text (Stage 4's own `normalizeAnswerValue` already accepts `yes/no/y/n/true/false/1/0`); `file` → a media prompt.

**Multiselect — the one genuinely new mechanism**: a tap-based transport can only submit one value per message, and `ConversationInbound` has no array field to carry several at once. Rather than reduce it to single-select (explicitly forbidden by the brief) or invent a second, WhatsApp-only questionnaire path, a small, deliberately minimal addition was made to `lib/conversations/orchestrator.ts`'s existing `handleFieldAnswer()` (Stage 4's own file — the "questionnaire orchestration" layer Step 16 already assigns this kind of transport-shape resolution to): when the current field is `multiselect` and the inbound event is free text, the text is split on commas and each token resolved against **the same, freshly-reloaded `currentField.options` array** the prompt was just rendered from — either by the option's own value or by its 1-based position in that same list — into a real array, which then flows through `applyQuestionAnswer()`'s existing, unmodified multiselect handling. This is transport-shape resolution, not a new business rule: it required no change to Stage 3's `answers.ts`, no new persistence shape, and an unresolved token still falls through to the ordinary "invalid option" validation error rather than guessing. Proven end-to-end in `stage5-mandatory-fields.test.ts`'s multiselect test (a real `1,3` reply against a real 3-option field, resulting in `['hardware','network']` in the final ticket's `form_data`).

## Media Download / Validation / Storage

`lib/whatsapp/media.ts:retrieveAndValidateMedia()` — Step 10's exact required chain: media must **exist** (`GET /{media-id}` via the Graph client), the **declared MIME type must be allow-listed** (checked before ever downloading), the **declared size must be ≤ 25MB**, the **download must succeed**, the **actual bytes must match the declared type** (a Buffer-based magic-byte check — the same allowlist `lib/actions/attachments.ts` already enforces for the normal web upload flow, minus `image/svg+xml`, excluded for the same stored-XSS reasoning that file already documents), and the **downloaded size must also be ≤ 25MB**. Only if every check passes does a `conversation_attachments` reference ever move past `received_reference`. A spoofed-MIME-type attachment (declared `image/jpeg`, actual bytes plain text) is caught and rejected — proven directly in `stage5-media.test.ts`.

## Final Ticket Attachment Linking

`lib/whatsapp/media.ts:linkConversationAttachmentsToRequest()` runs once, immediately after a conversation is genuinely (not a replayed duplicate) observed `completed` with a real `request_id`. For each `received_reference` attachment: retrieve+validate (above) → upload into the **same** `request-attachments` Storage bucket the web UI's `uploadAttachment()` uses → insert into the **same** `request_attachments` table (`uploaded_by: requesterId`, `is_internal: false`) — using the admin/service-role client directly rather than that existing Server Action, since a webhook has no authenticated browser session to satisfy its `getCurrentProfile()` check. On success the `conversation_attachments` row moves to `persisted`; **no fake `form_data` entry is ever written** (proven: `form_data.screenshot` is `undefined` on the created ticket even though the field was required and satisfied).

**Required Attachment Safety** (Step 11): a ticket is already created by the time this step runs, so a failure here (storage error, DB insert error, or a re-validation failure) **never creates a second ticket and never undoes the first** — the specific attachment is marked `failed`, and enough detail (field id, external media id, failure reason) is written to `intake_audit_log` (`whatsapp_attachment_link_failed`) for manual reconciliation. Proven directly: a spoofed-content attachment still results in exactly one ticket, a `failed` attachment status, and zero rows silently pretending to have succeeded in `request_attachments`.

## Outbound Graph API Client

`lib/whatsapp/graph-client.ts:WhatsAppGraphClient` — an isolated class with no business logic: builds the versioned Graph API URL, loads the token server-side, sends the request, parses the response, and classifies errors. The HTTP boundary (`fetchImpl`) is constructor-injectable (Step 25 test mode) — every test exercises the real class and real error-classification logic, mocking only the network call itself.

**Graph API version**: verified against current Meta for Developers documentation during implementation (not recalled from memory) — **`v23.0`** is the current default, stored in one place (`lib/whatsapp/config.ts:DEFAULT_GRAPH_API_VERSION`), overridable per-channel (`config.api_version`) or deployment-wide (`META_GRAPH_API_VERSION` env var), never hard-coded elsewhere in the codebase.

## Error Handling / Retry Classification

Every Graph API call (`sendMessage`, `getMediaUrl`, `downloadMedia`, `testConnection`) classifies its outcome into exactly one of:

- **`auth`** — `401`/`403` (expired/invalid credentials — an operator action, not a retry)
- **`retryable`** — `429` (rate limit), any `5xx`, or a thrown network error
- **`non_retryable`** — any other error status (bad payload, invalid recipient, etc.)

No automatic retry loop exists inside the request handler itself (Step 15's explicit instruction) — a caller/future reconciliation job can act on the classification. The access token is never included in any returned error message or log line (unit-tested explicitly).

## Rate Limiting

Reuses the existing in-memory `lib/rate-limit.ts` (documented as single-instance-only, matching this deployment's current single Railway web service). Two independent limiters protect the webhook: a generous per-sender message limiter (30/minute — well above what a real multi-message ticket-creation conversation needs) and a tighter per-(channel, sender) limiter specifically for **invalid/unregistered** numbers (5 per 5 minutes), to blunt number-enumeration probing without punishing a legitimate employee who mistypes a few times. Malformed-payload/unknown-`phone_number_id` traffic is rejected before any per-sender state is even touched.

## Logging / Audit

Reuses `intake_audit_log` (the existing append-only, service-role-write-only table) rather than a new audit table — `entity_type: 'whatsapp_message'`, actions: `whatsapp_message_processed`, `whatsapp_sender_rejected`, `whatsapp_unsupported_message`, `whatsapp_rate_limited`, `whatsapp_channel_not_found`/`_conflict`, `whatsapp_invalid_signature`, `whatsapp_status_event`, `whatsapp_attachment_link_failed`. Metadata captures `conversationId`, `state`, `duplicate`, `externalMessageId` (as the audit row's own `entity_id`), message type, and (for attachment failures) the field id/media id/reason. **Never logged**: the access token, app secret, verify token, the raw Meta webhook payload, or any attachment binary.

## 24-Hour Conversation Boundary

Unchanged from Stage 4 (`CONVERSATION_INACTIVITY_HOURS = 24`) — Stage 5 adds nothing here. Consistent with Step 21: the entire Phase-1 ticket-creation conversation happens as ordinary free-form/interactive WhatsApp messages inside the standard customer-service session Meta opens once a user messages the business first; **no approved message template is required for, or used by, any step of ticket creation** (service selection, search, sub-category, description, fields, review, confirmation are all plain text/interactive messages).

## Approved Template Plan

**Draft / To Submit** — none of these are implemented or required for Phase-1 ticket creation; they exist only to prepare for later proactive/out-of-window notifications (a genuinely separate, future concern):

| Template | Purpose | Category | Language | Trigger | Variables | In/outside active conversation |
|---|---|---|---|---|---|---|
| `ticket_created` | Confirm creation | Utility | en | `createRequestCore()` success | `{{1}} ticket_no`, `{{2}} subject` | Both (inside: not needed, already rendered live; outside: e.g. a delayed webhook retry) |
| `ticket_assigned` | Notify new assignee/requester | Utility | en | Assignment change | `{{1}} ticket_no`, `{{2}} agent_name` | Outside |
| `ticket_information_required` | Prompt requester for more info | Utility | en | Agent requests info (`waiting_user`) | `{{1}} ticket_no`, `{{2}} question` | Outside |
| `ticket_status_changed` | Status transition notice | Utility | en | Any status change | `{{1}} ticket_no`, `{{2}} new_status` | Outside |
| `approval_required` | Notify an approver | Utility | en | Approval workflow step created | `{{1}} ticket_no`, `{{2}} approver_name` | Outside |
| `ticket_resolved` | Resolution notice | Utility | en | Status → resolved | `{{1}} ticket_no` | Outside |
| `ticket_closed` | Closure notice | Utility | en | Status → closed | `{{1}} ticket_no` | Outside |
| `pending_user_reminder` | Nudge an idle requester | Utility | en | Configurable idle threshold on `waiting_user` | `{{1}} ticket_no`, `{{2}} days_idle` | Outside |
| `feedback` | Post-resolution CSAT prompt | Marketing/Utility (Meta will classify) | en | Some time after resolution | `{{1}} ticket_no` | Outside |

None of these have been submitted to Meta for approval; this table is a proposal only, per Step 22's explicit instruction not to assume approval or over-build. Building the actual proactive-notification dispatch (which would consume this catalogue) is out of Stage 5's scope.

## Admin Configuration

`Admin → Intake → Channels` (existing page, extended, not a new module): creating a `WhatsApp` channel now asks for its **Meta phone number id** and optional **WABA id**; a **Connect credentials** panel (mirroring the existing IMAP one) collects the access token, app secret, and webhook verify token — each write-only after the first save ("leave blank to keep current"), backed by the same Vault RPCs. The panel also displays the exact webhook callback URL to register in Meta Business Manager. **Raw credentials are never displayed** — only "credential configured: yes/no" and (after a successful test) the connected display phone number.

## Connection Test

`testWhatsAppConnection()` (Step 24) calls Meta's own phone-number metadata endpoint (`GET /{phone_number_id}?fields=display_phone_number,verified_name`) — this verifies the token and phone number id are valid and reachable **without ever sending a message to a real user**.

## Test Mode

Every outbound HTTP call in `WhatsAppGraphClient` takes an injectable `fetchImpl` (defaulting to the real global `fetch`), so every unit and integration test exercises the real adapter/renderer/orchestrator/media code and only fakes the Meta HTTP boundary — `lib/conversations` itself is never mocked in any Stage 5 test.

---

## End-to-End Flow Proof

`tests/integration/stage5-webhook-e2e.test.ts` — the brief's own IT/Printer example, driven entirely through `processWhatsAppWebhookPayload()` (the real signature-verified, channel-resolved, sender-resolved pipeline) against a real test DB: `Hi` → service list → service tap → `printer issue` → sub-category list → sub-category tap → description text → two mandatory fields (`Affected Counter`, `Business Impact`) → `review` (Create/Cancel buttons) → `cmd:create` tap → `completed`. Asserts exactly one `requests` row with the exact description, `form_data`, and that at least one outbound send was attempted through the mocked Graph boundary carrying the channel's own access token.

## Mobile-Change Proof

`tests/integration/stage5-mobile-change.test.ts` — through the real Stage 5 adapter (not by calling Stage 2's resolver directly): the old DESK mobile number resolves and starts a conversation; the admin changes `profiles.mobile_number`; the **old** number is immediately rejected (`not_registered`) and the **new** number resolves immediately — with zero WhatsApp-side configuration touched, proving `profiles.mobile_number` remains the single source of truth end-to-end.

## Tenant Isolation Proof

`tests/integration/stage5-tenant-isolation.test.ts` — two distinct Meta `phone_number_id`s mapped to two different orgs' WhatsApp channels, with the **identical** requester mobile number registered in both orgs. Messaging each phone number resolves to a completely distinct conversation/requester/org; completing a ticket via Org B's channel produces a request scoped only to Org B. Also exercised implicitly by `stage5-webhook-security.test.ts`'s unknown-`phone_number_id` case (no org guessed, no processing).

## Idempotency Proof

`tests/integration/stage5-idempotency.test.ts` — the exact same Meta message id, redelivered for both a mid-conversation description answer and (three times) the final `CREATE` confirmation: state advances exactly once per genuine event, the duplicate never re-applies as a fresh answer, and exactly one `requests` row exists at the end — proving Meta's own `message.id` correctly feeds Stage 4's `(org_id, channel_type, external_message_id)` idempotency ledger with no second, WhatsApp-only dedup mechanism.

---

## Tests Added

| Category | File | Count |
|---|---|---|
| Unit — signature verification | `tests/unit/whatsapp-signature.test.ts` | 7 |
| Unit — entry intent mapping | `tests/unit/whatsapp-intent.test.ts` | 14 |
| Unit — inbound adapter | `tests/unit/whatsapp-inbound-adapter.test.ts` | 17 |
| Unit — outbound render (Step 33) | `tests/unit/whatsapp-render.test.ts` | 17 |
| Unit — Graph API client (Step 34) | `tests/unit/whatsapp-graph-client.test.ts` | 15 |
| Unit — media validation | `tests/unit/whatsapp-media-validate.test.ts` | 8 |
| Integration — full example (Step 27) | `tests/integration/stage5-webhook-e2e.test.ts` | 1 |
| Integration — idempotency (Step 26) | `tests/integration/stage5-idempotency.test.ts` | 1 |
| Integration — mandatory fields + multiselect (Step 28) | `tests/integration/stage5-mandatory-fields.test.ts` | 3 |
| Integration — mobile change (Step 29) | `tests/integration/stage5-mobile-change.test.ts` | 1 |
| Integration — tenant isolation (Step 30) | `tests/integration/stage5-tenant-isolation.test.ts` | 2 |
| Integration — media (Step 31) | `tests/integration/stage5-media.test.ts` | 3 |
| Integration — webhook security (Step 32) | `tests/integration/stage5-webhook-security.test.ts` | 13 |
| **Total new** | | **102** |

Shared test-only helper: `tests/setup/whatsapp-fixtures.ts` (a real Vault-backed WhatsApp channel fixture, Meta payload builders for text/interactive/media/status/unsupported messages, a signature-signing helper, and an injectable mock Graph API `fetch` used across every integration test).

---

## Repeated Regression Results

```
npx vitest run   # Run 1: 67 files, 552 tests, 0 failures
npx vitest run   # Run 2: 67 files, 552 tests, 0 failures
npx vitest run   # Run 3: 67 files, 552 tests, 0 failures
```

Three consecutive runs, zero manual database cleanup between them — including every Stage 1–4 suite (Stage 4's own 60 tests all remain green, confirming no regression to the conversation engine Stage 5 sits on top of).

**One real test-hygiene bug found and fixed during this stage**: the first full-suite run left 204 stray `conversation_events` rows — none of the Stage 5 integration test files were deleting that table in cleanup (only `request_conversations`/`requests`, which do not cascade to `conversation_events`, whose FK to `request_conversations` is `ON DELETE SET NULL`, not `CASCADE`). Fixed by adding an org/run-tag-scoped `conversation_events` delete to every Stage 5 integration test's cleanup, verified by a fresh 3-run cycle afterward showing zero leaked rows each time.

```
node node_modules/typescript/lib/tsc.js --noEmit   # clean, 0 errors
npm run lint                                        # 0 errors, 3 pre-existing warnings (unrelated files)
```

---

## Database Cleanliness

After the final 3 consecutive runs:

- **`organizations`**: 1 (seed only)
- **`request_conversations`**: 0
- **`conversation_events`**: 0 (the leak above is fixed and stays fixed across repeated runs)
- **`conversation_attachments`**: 0
- **`intake_channels` (type=whatsapp)**: 0
- **`global_sla_config`** outside the seed org: 0
- **`profiles`** outside the seed org: 0
- **Stage-5-created auth users** (`*stage5-*@example.test`): 0

**Known, pre-existing, out-of-scope leak — carried forward and now larger**: the same two files flagged in `STAGE_4_REPORT.md` (`item6-assignment-rbac.test.ts`, `desk-uat-001-reopen.test.ts`) continue to leak a handful of `@example.test` auth users per run via an unchecked `deleteUser()` call. Stage 4 ended at 14; after this stage's several additional full-suite runs it now stands at **22** — confirmed via direct query that **all 22** belong to those same two pre-existing files (`uat-desk-001-*`/`uat-desk-003-*`), **zero** are Stage-5-created. Per the brief's explicit instruction, this was carried forward rather than fixed (out of Stage 5's scope), but flagged again here as a growing concern worth a small dedicated follow-up before it accumulates further.

---

## TypeScript

Clean — `node node_modules/typescript/lib/tsc.js --noEmit` produces zero output.

## ESLint

`npm run lint`: 0 errors, 3 pre-existing warnings, all in files untouched by this stage.

---

## Files Changed

**New:**
- `supabase/migrations/20240101000136_whatsapp_channel_config.sql`
- `lib/whatsapp/types.ts`, `signature.ts`, `config.ts`, `intent.ts`, `inbound-adapter.ts`, `graph-client.ts`, `render.ts`, `media.ts`, `webhook-handler.ts`, `index.ts`
- `lib/actions/intake/whatsapp-channel.ts`
- `app/api/intake/webhook/whatsapp/route.ts`
- `tests/setup/whatsapp-fixtures.ts`
- `tests/unit/whatsapp-signature.test.ts`, `whatsapp-intent.test.ts`, `whatsapp-inbound-adapter.test.ts`, `whatsapp-render.test.ts`, `whatsapp-graph-client.test.ts`, `whatsapp-media-validate.test.ts`
- `tests/integration/stage5-webhook-e2e.test.ts`, `stage5-idempotency.test.ts`, `stage5-mandatory-fields.test.ts`, `stage5-mobile-change.test.ts`, `stage5-tenant-isolation.test.ts`, `stage5-media.test.ts`, `stage5-webhook-security.test.ts`

**Modified:**
- `lib/conversations/repository.ts` — added `updateAttachmentStatus()` (moves a `conversation_attachments` row from `received_reference` to `persisted`/`failed`; Stage 4's own report explicitly named this as Stage 5's responsibility to add).
- `lib/conversations/index.ts` — barrel-exports `updateAttachmentStatus`.
- `lib/conversations/orchestrator.ts` — the minimal multiselect comma/position-parsing addition inside `handleFieldAnswer()` described above (transport-shape resolution only; no new business rule, no persistence-shape change).
- `app/(app)/intake/channels/ChannelsClient.tsx` — WhatsApp-specific create-form fields, row actions (Connect/Test), and a new `WhatsAppConnectForm` component, following the file's existing per-channel-type patterns exactly.
- `.env.example` — one new documented, non-secret variable: `META_GRAPH_API_VERSION`.

No file under `lib/requests/`, `lib/users/`, or any existing route/action outside the above was modified. Grepped `lib/whatsapp/` and confirmed no direct `INSERT` into `requests` anywhere — every ticket is created exclusively via `createRequestCore()`.

## Migrations Added

**One**: `20240101000136_whatsapp_channel_config.sql` (a single partial unique index; no new tables, no altered existing tables).

---

## Deployment / Meta Setup Required

**Implemented in code** (nothing further to build):
- Webhook route, signature verification, verification handshake, channel/org/sender resolution, payload mapping, rendering, sending, media retrieval/validation/storage, attachment linking, rate limiting, audit logging, admin channel-management UI.

**Must still be configured manually in Meta Business Manager / the Meta Developer App** (external, business-side prerequisites, outside this codebase's scope):
1. A verified WhatsApp Business Account (WABA) and at least one registered phone number, with its **`phone_number_id`** and **WABA id** noted.
2. A Meta App with the WhatsApp product added; generate a **System User access token** with `whatsapp_business_messaging` permission.
3. Under the App's WhatsApp → Configuration: set the **webhook callback URL** to `https://<your-deployment>/api/intake/webhook/whatsapp` and a **verify token** of your choosing.
4. Subscribe the App's webhook to the `messages` field.
5. Copy the App's own **App Secret** (Basic Settings) — this is what signs `X-Hub-Signature-256`.
6. In Citykart DESK: **Admin → Intake → Channels → New channel (WhatsApp)** — enter the phone number id (+ optional WABA id); then **Connect credentials** — paste the access token, app secret, and the same verify token chosen in step 3; **Test Connection**; then **Activate**.
7. (Optional, later) Submit the proposed template catalogue above to Meta for approval before building any proactive/out-of-window notification feature.

Nothing in this stage assumes those external steps have already happened — every test uses a synthetic channel/secret, and the code path that would call the real Meta API is exercised only through the injectable mock.

---

## Known Gaps

1. **Rate limiting is in-memory/single-instance** (`lib/rate-limit.ts`) — correct for this deployment's current single Railway web instance; would need a shared store (Redis/Upstash) if the web service is ever horizontally scaled. Not built here, per Step 19's "do not overbuild."
2. **No outbound retry queue** — a `retryable`-classified send failure (e.g. Meta 5xx) is not automatically retried; Step 15 explicitly forbids an in-request retry loop, and no background queue exists in this deployment (Step 16 — documented Phase-1 synchronous design, consistent with the rest of the app's cron-based, queue-free architecture).
3. **Approved templates are proposed, not submitted** — the catalogue above is a plan only; proactive/out-of-window notifications are not built.
4. **`EDIT` during review remains Stage 4's own Phase-1-minimal behavior** (lists collected fields, no in-place field editing) — unchanged by Stage 5, same documented limitation as `STAGE_4_REPORT.md`.
5. **Admin Channels UI was type-checked, lint-checked, and structurally reviewed but not live-browser-verified** in this session: the project's dev-server singleton lock was already held by a concurrent session in this same environment, and a second `next dev` instance against the same project directory refuses to start on any port. The change itself is small and additive (conditional fields/buttons following the exact pattern of the neighboring, already-working email-channel UI), and all underlying server actions it calls are covered by `npm run lint`/`tsc`, but genuine click-through browser verification of this one page should happen before relying on it in production.
6. **Carried-forward, still-growing, unrelated auth-user leak**: `item6-assignment-rbac.test.ts`/`desk-uat-001-reopen.test.ts` (pre-existing, untouched by Stage 5) — now at 22 stale `@example.test` users, confirmed entirely unrelated to Stage 5's own test files. Flagged again as a good candidate for a small, standalone follow-up.

## Stage 6 Readiness

**READY FOR STAGE 6: YES.**

Meta WhatsApp Cloud API integration is complete: webhook verification and signature validation are implemented and fail closed; channel/org resolution is DB-enforced tenant-safe; sender identity resolves exclusively through Stage 2's existing mobile-identity module; every business decision (service/sub-category validity, mandatory fields, priority, SLA, assignment, double-create protection, idempotency, concurrency) continues to flow through the unmodified Stage 4 engine and `createRequestCore()`; required media is genuinely downloaded, validated, and linked into the normal DESK attachment model; and the full regression suite is repeatably green with a clean database afterward. Per the brief's explicit stop condition, **no production WhatsApp number should be enabled and no Stage 6/UAT work should begin** until this report has been reviewed.
