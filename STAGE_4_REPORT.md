# STAGE 4 REPORT — Persistent Conversation State

## Status

**Complete.** A channel-neutral, DB-backed conversation state machine now persists the Stage 3/3.1 `RequestDraft` across independent process/request boundaries, with DB-enforced idempotency, optimistic concurrency, lazy expiry, and double-create protection — proven by 60 new tests (unit + real-DB integration + genuine parallel concurrency) and 3 consecutive full-suite runs with zero manual database intervention between them. **READY FOR STAGE 5: YES**, with one carried-forward (and now more visible) pre-existing test-hygiene gap documented below.

---

## Repository Audit Findings

Conducted before any code was written (Step 0), against the live schema and actual source, not assumptions:

**Intake schema** (`intake_threads`, `intake_messages`, `intake_channels`, `intake_reviews`, …): `intake_threads` groups **inbound emails** for a human reviewer (`participant_emails TEXT[]`, `subject`, `message_count`, `status: open/linked/closed`) — no `requester_id`, no draft/answer storage, no multi-state machine. `intake_reviews`' `pending/in_review/approved/rejected/converted` lifecycle is an asynchronous **human-approval** workflow, structurally incompatible with a real-time, machine-driven, 12-state bot dialogue. `intake_channel_type` (native enum: `email, portal, whatsapp, teams, slack, api`) has never been altered since creation and already covers every channel this stage needs — reused as-is.

**Transaction/RPC patterns**: no `SELECT … FOR UPDATE` exists anywhere (every `FOR UPDATE` hit in the migrations is RLS policy syntax, not a lock statement). No pre-existing `version` integer optimistic-locking column exists on any table (`services.version` is an unrelated semver display string). The established pattern for "avoid a racy read-then-write" is a **single atomic SQL/plpgsql function**, `SECURITY DEFINER`, granted only to `service_role`, called via `.rpc()` — e.g. `merge_request_form_data()` (one `UPDATE … SET x = x || patch`) and `upsert_field_sla_override()` (`INSERT … ON CONFLICT DO UPDATE`). A second, equally-established pattern is a **partial unique index** used as a race-safety net for an "at most one X" invariant, with the app treating the resulting `23505` as "already exists" — e.g. `approvals_one_pending_per_request`, `idx_time_entries_one_open_per_user`, and (from this very project's Stage 2) `idx_profiles_org_mobile_number_unique`.

**Idempotency precedent**: `intake_messages.external_message_id` with `UNIQUE (org_id, channel_id, external_message_id)`, used by the Email Intake worker's check-then-insert-then-catch-`23505` dedup (`api/src/intake/store.ts`).

**Cron/scheduled jobs**: no `pg_cron`, no generic scheduled-task abstraction — `scripts/cron-tick.mjs` (Railway-native cron) hits a small hardcoded map of `app/api/<feature>/run` routes, each independently authenticated via `verifyCronSecret`. The closest existing "expiry" precedent is `has_module_access()`'s **lazy, checked-on-read** `valid_until > now()` — no row is ever proactively swept to an "expired" status by a job.

**Enum convention**: native Postgres enums are the default for stable, cross-cutting vocabularies (`request_priority`, `user_role`, `intake_channel_type`, …); `TEXT + CHECK` is reserved for narrower/volatile per-feature vocabularies. Followed the native-enum convention for `conversation_state`, `conversation_event_status`, `conversation_attachment_status`.

**Existing conversation-like abstraction**: none, inside or outside `lib/intake/`. The one relevant prior art is this same project's own Stage 3 `RequestDraft` (`lib/requests/questionnaire/types.ts`), explicitly documented as **not persisted** — exactly the gap this stage closes.

---

## Persistence Design Decision

**Reused `intake_threads`? NO.**

**Why:** evaluated against every criterion in the brief —

| Criterion | `intake_threads` | Verdict |
|---|---|---|
| Tenant isolation | `org_id` present | ✅ reusable |
| Requester identity | **no `requester_id` column at all** | ❌ |
| RequestDraft storage | no draft/answer columns, no JSONB for this purpose | ❌ |
| Current state / question | `status` is a 3-value email-thread lifecycle (`open/linked/closed`), not a 12-state ticket-creation machine | ❌ |
| Expiry / version / concurrency | none of these exist on the table | ❌ |
| Completion / cancellation | no concept of either — `intake_reviews` (a *different* table) owns conversion, via human review | ❌ |
| Future Email/Slack/Teams reuse | plausible in the abstract, but only by fundamentally repurposing a table whose current, real, heavily-used meaning is "grouped inbound email awaiting a human reviewer" | ❌ |

Retrofitting a real-time bot dialogue's state machine onto a table whose entire existing meaning is "an email thread queued for a human to read and convert" would require adding a requester, a draft, 12 new states that have no relationship to `open/linked/closed`, version/expiry columns, and would leave two live callers (Email Intake's reviewer UI and this stage's bot) reading fundamentally different semantics out of the same `status` column — exactly the "confusing or unsafe semantics" the brief warns against. **New tables were the correct choice, not a fallback.**

---

## Database Schema

One migration: **`supabase/migrations/20240101000135_conversation_persistence.sql`**.

**Enums** (native, per the audited convention):
- `conversation_state`: `identified, awaiting_service, awaiting_issue_search, awaiting_subcategory, awaiting_description, collecting_fields, awaiting_file, review, submitting, completed, cancelled, expired`
- `conversation_event_status`: `processing, completed, failed`
- `conversation_attachment_status`: `received_reference, persisted, failed`

**`request_conversations`** — one row per conversation:
- `org_id UUID NOT NULL REFERENCES organizations(id)`, `requester_id UUID NOT NULL REFERENCES profiles(id)` — no `ON DELETE` action (business-record convention, matching `requests.org_id`/`requests.requester_id`).
- `channel_type intake_channel_type NOT NULL`, `channel_identity TEXT NOT NULL` — conversation identity (see below).
- `state conversation_state NOT NULL DEFAULT 'identified'`.
- `service_id`, `sub_category_id`, `category_id` — each `REFERENCES … ON DELETE SET NULL` (a hard-deleted service/sub-category should surface as "no longer valid" through ordinary Step 25 revalidation, not block an unrelated admin action or leave a dangling reference).
- `issue_search_text TEXT`, `search_result_ids UUID[]` — canonical Step 6/19 search-result integrity.
- `description TEXT`, `title TEXT`, `answers JSONB NOT NULL DEFAULT '{}'`, `current_field_id TEXT` — the RequestDraft, split the same way `requests` itself splits `service_id`/`title`/`description` as real columns and only the truly dynamic per-field data into JSONB.
- `request_id UUID REFERENCES requests(id) ON DELETE SET NULL` — set once CREATE succeeds.
- `last_error TEXT` — most recent non-fatal CREATE failure.
- `version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)` — optimistic concurrency.
- `last_activity_at`, `expires_at TIMESTAMPTZ NOT NULL` — lazy expiry.
- `created_at, updated_at` (trigger-maintained), `completed_at, cancelled_at, expired_at`.

**Indexes/constraints:**
- `idx_request_conversations_one_active` — **partial UNIQUE** `(org_id, channel_type, channel_identity) WHERE state IN (<9 active states>)` — the DB-backed "at most one active conversation" invariant (AC-4.4), same pattern as `approvals_one_pending_per_request`.
- `idx_request_conversations_request_id` — partial UNIQUE `(request_id) WHERE request_id IS NOT NULL` — a request is linked from at most one conversation.
- `idx_request_conversations_org_requester`, `idx_request_conversations_org_state` — plain lookup indexes.
- RLS enabled; a `SELECT`-only policy for `agent/manager/admin/platform_owner` (mirrors `intake_threads`' own read policy, for a possible future admin screen) — no `INSERT/UPDATE/DELETE` policy granted to `authenticated`, so all writes stay service-role-only by omission (same pattern as `intake_audit_log`).

**`conversation_events`** — the idempotency ledger: `org_id`, `channel_type`, `external_message_id TEXT NOT NULL`, `conversation_id REFERENCES … ON DELETE SET NULL`, `status conversation_event_status`, `result JSONB` (the actual `ConversationResult` replayed to a duplicate — never a raw transport payload), timestamps. **UNIQUE `(org_id, channel_type, external_message_id)`** — same shape as `intake_messages`' own dedup constraint, but `external_message_id` is `NOT NULL` here (this table's only purpose is dedup, so a null id would defeat it, unlike `intake_messages` which stores every message regardless).

**`conversation_attachments`** — generic durable file references: `conversation_id REFERENCES … ON DELETE CASCADE` (harmless without its conversation, unlike the business-record tables above), `field_id`, `external_media_id`, `file_name`, `mime_type`, `size CHECK (size IS NULL OR size >= 0)`, `status`. No Meta-specific column names anywhere.

**One RPC**: `commit_conversation_transition(...)` — see "Concurrency Design."

**Invariant enforcement summary** (Step 29):

| Invariant | Enforced by |
|---|---|
| One active conversation per (org, channel, identity) | **DB** (partial unique index) |
| Unique external message id per (org, channel) | **DB** (unique index) |
| One request per conversation | **DB** (partial unique index) |
| `version >= 0` | **DB** (check constraint) |
| Legal state transitions | **Application** (`lib/conversations/state-machine.ts`, centralized, throws on violation) |
| Config-drift revalidation before CREATE | **Application** (`handleCreate()`, reloads current service/sub-category/fields) |
| Requester eligibility before CREATE | **Application** (`isRequesterStillEligible()`) |

---

## Conversation Identity

Exact uniqueness scope: **`(org_id, channel_type, channel_identity)`**, always org-first. Every lookup function in `lib/conversations/repository.ts` takes `orgId` as a required parameter and filters on it explicitly — this stage's repository always runs under the service-role admin client (no browser session exists for a WhatsApp/Slack/Teams conversation), so, exactly like `createRequestCore()`'s own precedent, RLS provides no protection and every read/write is explicitly org-scoped in application code. Proven directly: `tests/integration/stage4-tenant-isolation.test.ts`'s second test creates Org A and Org B conversations using the **identical** `channel_identity` and asserts they resolve to two entirely distinct rows, each correctly scoped to its own org — the exact "Org A + 9876543210 must never resume Org B + 9876543210" rule from the brief.

Requester identity is accepted pre-resolved (`requesterId` on every call) — Stage 4 never re-resolves phone/WhatsApp identity itself; that stays Stage 2's `resolveUserByWhatsAppNumber()`, invoked by whatever calls into Stage 4 (Stage 5, eventually).

---

## State Machine

12 states, exactly as specified in the brief (lowercase snake_case to match this schema's enum convention — `intake_message_status`/`intake_thread_status` use the same casing). Centralized in `lib/conversations/state-machine.ts`: a `FORWARD_TRANSITIONS` adjacency map plus two universal escapes (`→ cancelled`, `→ expired`, legal from every active state **except** `submitting`, which is deliberately neither cancellable nor expirable while a creation is in flight). `transitionConversation(from, to)` throws on anything not listed — the orchestrator never assigns `conversation.state = arbitraryString`.

Legal transitions (▸ = normal forward path, ◂ = config-drift backward path, both centrally listed, no special-casing):

```
identified              ▸ awaiting_service
awaiting_service        ▸ awaiting_issue_search
awaiting_issue_search   ▸ awaiting_issue_search (no results) | awaiting_subcategory ◂ awaiting_service
awaiting_subcategory    ▸ awaiting_description ◂ awaiting_issue_search | awaiting_service
awaiting_description    ▸ collecting_fields | awaiting_file | review
collecting_fields       ▸ collecting_fields (next field) | awaiting_file | review ◂ awaiting_service | awaiting_subcategory
awaiting_file           ▸ collecting_fields | awaiting_file | review ◂ awaiting_service | awaiting_subcategory
review                  ▸ submitting ◂ collecting_fields | awaiting_file | awaiting_service | awaiting_subcategory
submitting              ▸ completed | review (creation failure)
completed / cancelled / expired   (terminal — no outbound transitions)
```
Any active state (except `submitting`) → `cancelled` (CANCEL command) or `expired` (lazy expiry).

26 pure unit tests (`tests/unit/conversation-state-machine.test.ts`) cover every listed legal transition, every illegal skip-ahead (`awaiting_service → review`, `identified → collecting_fields`, `awaiting_service → completed`), and that no terminal state has any outbound transition.

---

## RequestDraft Persistence

Persisted as the normalized columns listed under "Database Schema" — `service_id`/`sub_category_id`/`category_id`/`description`/`title` as real columns, `answers` as JSONB, exactly mirroring `RequestDraft`'s own shape (`lib/requests/questionnaire/types.ts`). **The resolved form schema itself is never persisted or trusted from storage** — `handleAwaitingDescription()`, `handleFieldAnswer()`, and `handleCreate()` all call `loadService()` (a fresh, explicitly org+active+published-scoped query) every single time, then `resolveDraftFormFields()` (Stage 3's own function) on that fresh row. A week-old persisted draft can never silently override today's DESK configuration — this is also exactly what Step 36's config-drift tests prove.

---

## Current Question Persistence

`current_field_id TEXT` — the exact field id (not a position) currently being asked in `collecting_fields`/`awaiting_file`. On every resume, `handleFieldAnswer()` re-resolves the form fresh and looks up `current_field_id` in the **current** field list; if that field was removed since it was asked (Step 25), it falls through to recomputing the true next requirement from scratch rather than erroring.

## Search Result Integrity

`search_result_ids UUID[]` stores the canonical sub-category ids actually presented at the most recent search. `handleAwaitingSubcategory()` rejects any `selectionId` not present in that exact set — **never** trusts a bare position — and, on an invalid selection, re-runs the search fresh (also self-healing config drift: if a shown option went inactive between presentation and selection, the re-run naturally excludes it). `selectSubCategoryForDraft()` (Stage 3's own function) is then still called as a second, independent revalidation before the id is ever written to the draft.

---

## Inbound Event Model

`ConversationInbound` (`lib/conversations/types.ts`): `externalMessageId` (required, non-empty — the idempotency key), `orgId`, `requesterId`, `channelType: ConversationChannelType`, `channelIdentity`, `kind: 'text'|'selection'|'file'|'command'`, optional `text`/`selectionId`/`attachment{externalMediaId,fileName,mimeType,size}`, `receivedAt` (audit-only — grepped confirmed nowhere used for any expiry/security decision; every expiry check uses `new Date()`/DB timestamps). No `wamid`, no `phone_number_id`, no Meta payload shape anywhere in the type or its consumers.

## Outbound Result Model

`ConversationResult`: `conversationId`, `state`, `prompt?: {type, message?, options?, review?}`, `duplicate?`. `prompt.type` is a closed, transport-neutral union (`service_selection | issue_search | subcategory_selection | text | select | multiselect | date | number | file | review | completed | cancelled | expired | active_draft_exists | error`). When `type === 'review'`, `prompt.review` carries the **actual** Stage 3 `RequestReviewModel` content (title/description/fields/readiness) — not a placeholder message — reconciled for attachments (see below) but otherwise exactly what `buildReviewModel()` produced.

## Commands

`parseCommand()` (`lib/conversations/types.ts`): `new|cancel|restart|create|edit`, case-insensitive and whitespace-trimmed (`'NEW'`, `' New '`, `'new'` all normalize identically — 5 unit tests). Deliberately no synonym table (`'hi'`, `'hello'`, `'start'` all return `null`) — left for a future Stage 5 renderer to map onto `NEW`, per the brief's own instruction. **NEW** with an existing active conversation returns `active_draft_exists` (never silently destroys it); **CANCEL** transitions to `cancelled` (retained, never deleted) and is refused while `submitting`.

---

## Idempotency Design

**Exact unique key**: `conversation_events (org_id, channel_type, external_message_id)`, `UNIQUE`. **Claim**: a single `INSERT`, catching `23505` exactly like the Email Intake worker's own precedent — no in-memory Set/cache anywhere. Three possible outcomes, each handled distinctly (`ClaimOutcome` in `repository.ts`): `'new'` (proceed), `'completed'` (replay the stored `result` verbatim, `duplicate: true`, **zero** business logic re-run), `'in_flight'` (a prior attempt claimed the event but crashed before committing — safe to reprocess from scratch, since a conversation is only ever mutated **atomically together with** marking its event completed — see below — so "still processing" can only mean the conversation was never actually touched by the crashed attempt).

**Transaction boundary** (the brief's own "most important requirement"): Supabase-js has no client-exposed multi-statement transaction, so the combined "advance the conversation" + "mark its event completed" write is done by the one RPC this stage introduces, `commit_conversation_transition(...)` — a single Postgres function (one implicit transaction) that (a) `UPDATE`s `request_conversations` with the caller's fully-computed next state, gated by `WHERE version = p_expected_version`, raising on zero rows affected, then (b) `UPDATE`s `conversation_events` to `'completed'` with the result — **both or neither**. A crash between claiming the event and calling this function leaves the conversation completely untouched (safe to redo); a crash *inside* the function is rolled back atomically by Postgres itself; a crash *after* it returns successfully means both writes are already durably committed, so a redelivered duplicate finds `'completed'` and replays instead of reprocessing. Proven directly: **TEST 33 "critical example"** — a duplicate description message with the same `externalMessageId` never gets applied as an answer to the next field (`tests/integration/stage4-idempotency.test.ts`).

---

## Concurrency Design

**Strategy**: optimistic locking via the `version` integer, chosen deliberately over pessimistic `SELECT … FOR UPDATE` because Postgres row locks cannot span multiple independent Supabase-js round trips in a serverless architecture (there is no way to hold a lock open across the business-logic computation, which may itself await Stage 3's async functions) — this is exactly the situation the brief's own "optimistic locking with version integer" option is for, and it matches this codebase's own established idiom of letting a single atomic UPDATE's `WHERE` clause do the serialization rather than an explicit lock.

**Retry behavior**: `processConversationInbound()` retries up to `MAX_COMMIT_ATTEMPTS = 5` on a version conflict, **reloading the specific conversation by id** on each retry (not "the current active conversation for this scope", which would find nothing once a concurrent winner has already driven it to a terminal state — a real bug caught and fixed during this stage's own concurrency testing, see "Known Gaps" for how it was found). The one exception is the **post-creation** completion commit: since `createRequestCore()` must never be called twice, a version conflict on marking `submitting → completed` (after the ticket already exists) is retried **locally**, in a tight loop that only re-attempts the same already-decided write — never re-entering the full CREATE handler.

**Race resolution**: deterministic by construction — two concurrent writers to the same conversation can never both succeed; the loser's optimistic check fails, it reloads the *already-advanced* state, and recomputes its own business logic against that fresh state (for two answers to the same field, this is equivalent to the two messages having arrived in whatever order the database happened to serialize their commits — never a corrupted/merged value). Proven directly under **genuine `Promise.all()` parallelism** (not simulated sequential staleness) in `tests/integration/stage4-concurrency.test.ts`: concurrent `NEW` → exactly one active conversation (DB partial-unique-index race); concurrent distinct field answers → no lost update, exactly one deterministic winner for the contested field; concurrent `CREATE` confirmations → exactly one ticket.

---

## One-Active-Conversation Enforcement

DB-backed (Step 11/AC-4.4): the partial unique index described above. `createConversation()` inserts optimistically and, on `23505`, re-selects the winner's row rather than erroring — "concurrent start → one active conversation" holds at the database level regardless of application-code races, proven under real `Promise.all()` concurrency.

## Expiry

**Default**: 24 hours of inactivity (`CONVERSATION_INACTIVITY_HOURS` in `orchestrator.ts`) — the brief's own recommended Phase-1 default; nothing in the existing Intake schema suggested a different value strongly enough to override it. `expires_at` is recomputed to `now + 24h` on every mutating transition (extended by activity, not fixed at creation).

**Mechanism**: lazy, checked on the next inbound event — `expireIfStale()` compares `expires_at` against the **server's own clock** (`new Date()`, never `receivedAt`) and, if stale, atomically transitions to `expired` (version-checked, same optimistic pattern as everything else). Explicitly guarded to only run against a conversation that is currently in an *active* state — a terminal conversation's `expires_at` is normally in the past too (it simply stopped mattering once it finished) and must never be relabeled `expired` after the fact; this guard was added specifically to keep the concurrency retry-by-id fix (above) from mis-firing against an already-completed conversation. No cron job was introduced.

3 tests (`tests/integration/stage4-expiry.test.ts`): a stale active conversation is expired on the next event; the requester can then start a genuinely fresh conversation (the expired draft's own data is left untouched, just inert); a non-expired conversation resumes completely normally. Timestamps are set directly via fixture updates — no test waits real hours.

## Resume

Every handler reloads its conversation, service, and (where relevant) sub-category name fresh from the database on every call — there is no in-process cache or held object across invocations. Proven directly by discarding all in-memory references mid-flow and reloading purely via `findConversationById()` in `tests/integration/stage4-conversation-e2e.test.ts`, confirming `description`, `title`, and `state` all survive intact and the next question is computed correctly from the persisted `current_field_id`.

## Title Stability

`handleAwaitingDescription()` generates the title via `generateRequestTitle()` **only when `conversation.title == null`** — the one place it's ever computed. Every other code path (resume, duplicate delivery, review reconstruction, retry) reads the persisted `title` unchanged. Proven in the E2E test (title identical before/after a mid-flow reload) and the idempotency test (a duplicate description delivery does not regenerate it).

## Required Attachment References

`insertAttachment()` persists `{conversation_id, field_id, external_media_id, file_name, mime_type, size, status: 'received_reference'}` — metadata only, **no binary content ever downloaded** (grepped: no download/fetch-media code exists anywhere in `lib/conversations/`). A required `file` field is reconciled as satisfied via `lib/conversations/file-progress.ts`'s `buildLogicalAnswers()`/`reconcileReviewForAttachments()` — a **throwaway** answers copy used only to drive Stage 3's `getNextQuestion()`/`checkDraftReadiness()`, never written into the real, persisted `answers`, and never passed to `buildCreateRequestInputFromDraft()`. `applyQuestionAnswer()` (Stage 3, unmodified) still flatly rejects any direct answer to a `file`-type field — the orchestrator's file branch never calls it, using `insertAttachment()` instead. **Hand-off to Stage 5/6**: `conversation_attachments` rows (keyed by `conversation_id` + `field_id`, holding `external_media_id`) are the complete, durable record of "which file was referenced for which field" that a future stage can join against once it implements actual transport-specific download and links the binary to the created `request_attachments` row — Stage 4 deliberately stops at the reference.

2 tests (`tests/integration/stage4-attachments.test.ts`): a required file field surfaces `awaiting_file`, a reference persists and survives reload, the draft becomes provisionally review-ready, `form_data` never contains the file field at CREATE time; a text/selection answer while `awaiting_file` is rejected outright (re-prompts for the file, no attachment created).

## Review

`buildReviewPrompt()` calls Stage 3's real `buildReviewModel()` (never a placeholder), reconciled for attachments, and is used consistently everywhere REVIEW is entered or re-displayed (description completion, field completion, `EDIT`, and a bare re-visit of `review` state). `CREATE`/`CANCEL` are the only real actions; `EDIT` is deliberately conservative (Step 23) — it returns the collected-fields list with a message pointing back to `CREATE`/`CANCEL`, with no in-place field-editing subsystem built. This is explicitly documented here as a Stage 6/UAT enhancement, not started.

## CREATE / Double-Create Protection

`review → submitting` is the exclusive gate: it can only ever succeed once per conversation version. A second concurrent/duplicate `CREATE` either loses that optimistic race (retried by the outer loop, which reloads by id and finds `submitting`/`completed` already, refusing to call `createRequestCore()` again) or, if `state === 'submitting'`/`'completed'` is already visible on initial load, is refused immediately by an explicit check at the top of `handleCreate()` — `createRequestCore()` is *only ever* reachable through the single `review → submitting` transition succeeding. Proven under genuine parallel `CREATE` confirmations in `stage4-concurrency.test.ts` and duplicate-message `CREATE` in `stage4-idempotency.test.ts`: exactly one `requests` row, `conversation.request_id` set, a second/duplicate `CREATE` returns `already_completed` semantics with the same `requestId`.

**Failure semantics** (documented, deliberate): `createRequestCore()` returning `{error}` (a normal, expected outcome — e.g. a config-drift rejection) is handled synchronously — `submitting → review` with `last_error` set, no ambiguity, immediately retryable. A genuine *exception* thrown during the `createRequestCore()` call (a real crash, not its own returned error) is deliberately **not** auto-recovered: the conversation is left in `submitting` and the exception is re-thrown for operator visibility, because automatically retrying at that point risks calling `createRequestCore()` a second time if it had actually partially succeeded — Phase 1 fails safe (a stuck conversation, requiring manual follow-up) rather than risking a duplicate ticket. This is the one place in the design where "safe" was chosen over "self-healing," and it is called out explicitly rather than left implicit.

## Configuration Drift Handling

Before `CREATE`, `handleCreate()` always reloads the service (`is_active`+`published`, fresh) and revalidates the sub-category via the same `selectSubCategoryForDraft()` Stage 3 uses. If either is now invalid, the conversation is sent back to the correct earlier state — **never** creates. Readiness is then re-checked against the **current** form; if a new mandatory field appeared or a previously-picked answer is no longer a valid option, the conversation is sent back to collect it. A key correctness fix made during this stage's own testing: an **invalidated** (not merely missing) answer — e.g. an option genuinely removed from the field's list since it was picked — is now explicitly **cleared** from the persisted answers before recomputing the next question, because `getNextQuestion()`'s plain "is this field empty" check alone would never re-ask a field that still holds a non-empty (but now invalid) value, leaving the conversation permanently stuck. 2 tests in `tests/integration/stage4-config-drift.test.ts` cover both scenarios end-to-end, including that the conversation can still be completed once the drift is resolved.

## Tenant Isolation

Every conversation table read/write is explicitly org-scoped (never relying on RLS, since the admin client bypasses it). 5 dedicated tests in `tests/integration/stage4-tenant-isolation.test.ts`: Org A cannot load Org B's conversation by id; identical `channel_identity` in two different orgs never collide (two distinct conversations); the same `external_message_id` in two different orgs is not treated as a duplicate; an attachment reference stays correctly scoped to its own org's conversation; a request created via Org B's conversation is stored with `org_id = orgB`, never Org A.

## createRequestCore Integration

`buildCreateRequestInputFromDraft()` (Stage 3, unmodified) is called with the reconstructed `RequestDraft`, then `createRequestCore()` (Stage 1, unmodified) directly — **no direct `INSERT` into `requests` anywhere in this stage's code** (grepped and confirmed). Priority, SLA due dates, category derivation, and Business Rules all remain exactly as DESK-controlled as any other channel — proven end-to-end: the created ticket's `priority` matches the matched sub-category's own `sla_priority` (never anything the conversation set directly), and `response_due_at`/`resolution_due_at` are both resolved (SLA machinery ran normally).

---

## Tests Added

| Category | File | Count |
|---|---|---|
| Unit — state machine | `tests/unit/conversation-state-machine.test.ts` | 26 |
| Unit — commands | `tests/unit/conversation-commands.test.ts` | 5 |
| Unit — file-progress | `tests/unit/conversation-file-progress.test.ts` | 10 |
| Integration — end-to-end + resume | `tests/integration/stage4-conversation-e2e.test.ts` | 1 |
| Integration — idempotency | `tests/integration/stage4-idempotency.test.ts` | 3 |
| Integration — concurrency (genuine `Promise.all`) | `tests/integration/stage4-concurrency.test.ts` | 3 |
| Integration — expiry | `tests/integration/stage4-expiry.test.ts` | 3 |
| Integration — config drift | `tests/integration/stage4-config-drift.test.ts` | 2 |
| Integration — required-file attachments | `tests/integration/stage4-attachments.test.ts` | 2 |
| Integration — tenant isolation | `tests/integration/stage4-tenant-isolation.test.ts` | 5 |
| **Total new** | | **60** |

Shared test-only fixture helper: `tests/setup/conversation-fixtures.ts` (team/service/SLA-policy/sub-category builder, reused across all Stage 4 integration files, following Stage 3.2's own "shared helper over copy-paste" precedent).

---

## Repeated Regression Results

```
npx vitest run   # Run 1: 54 files, 450 tests, 0 failures
npx vitest run   # Run 2: 54 files, 450 tests, 0 failures
npx vitest run   # Run 3: 54 files, 450 tests, 0 failures
```
Three consecutive runs, **zero manual database cleanup between them** — this is the direct, repeatable proof of AC-4.18, and (together with the DB-cleanliness results below) the strongest evidence that the concurrency/idempotency/expiry machinery is genuinely self-consistent rather than merely passing once by chance.

```
node node_modules/typescript/lib/tsc.js --noEmit   # clean, 0 errors
npm run lint                                        # 0 errors, 3 pre-existing warnings (unrelated files)
```

---

## Database Cleanliness After Tests

After the 3 consecutive runs above:
- **`organizations`**: 1 row (the real seed org) — no leaked orgs (Stage 3.2's own fix holds).
- **`request_conversations`**: **0** rows remaining.
- **`conversation_events`**: **0** rows remaining.
- **`conversation_attachments`**: **0** rows remaining.
- **`global_sla_config`** outside the seed org: **0** rows.
- **`profiles`** outside the seed org: **0** rows.
- **Stage-4-created auth users** (`*stage4-*@example.test`): **0** remaining.

All of the above required one correctness fix discovered mid-stage: several Stage 4 fixtures' cleanup deleted `requests`/`request_conversations` *after* calling `admin.auth.admin.deleteUser()`, but both tables have `requester_id` FKs with no cascade (business-record convention) — the delete-user call was silently failing (Supabase's admin API doesn't surface that failure loudly by default, and none of the affected `afterAll` blocks checked its result) whenever a test had actually created a ticket or a conversation with no service selected. Fixed by reordering every affected file to delete `request_conversations`/`requests` by `requester_id` **before** deleting the user — verified with a dedicated before/after auth-user count check, not just "the delete call didn't throw."

---

## TypeScript

Clean — `node node_modules/typescript/lib/tsc.js --noEmit` produces zero output.

## ESLint

`npm run lint` (project script, `app lib components types proxy.ts`): 0 errors, 3 pre-existing warnings, all in files untouched by this stage. Every new/changed file individually linted clean (0 errors, 0 warnings) before the full-repo pass.

---

## Files Changed

**New:**
- `supabase/migrations/20240101000135_conversation_persistence.sql`
- `lib/conversations/types.ts`
- `lib/conversations/state-machine.ts`
- `lib/conversations/repository.ts`
- `lib/conversations/file-progress.ts`
- `lib/conversations/orchestrator.ts`
- `lib/conversations/index.ts`
- `tests/setup/conversation-fixtures.ts`
- `tests/unit/conversation-state-machine.test.ts`
- `tests/unit/conversation-commands.test.ts`
- `tests/unit/conversation-file-progress.test.ts`
- `tests/integration/stage4-conversation-e2e.test.ts`
- `tests/integration/stage4-idempotency.test.ts`
- `tests/integration/stage4-concurrency.test.ts`
- `tests/integration/stage4-expiry.test.ts`
- `tests/integration/stage4-config-drift.test.ts`
- `tests/integration/stage4-attachments.test.ts`
- `tests/integration/stage4-tenant-isolation.test.ts`

**Modified:**
- `types/database.ts` — hand-added `request_conversations`/`conversation_events`/`conversation_attachments` table types, the three new enums, and the `commit_conversation_transition` RPC signature (following Stage 2's own established precedent of targeted hand-edits over full regeneration, since this generated file is known-stale elsewhere).

No file under `lib/requests/questionnaire/`, `lib/requests/create-request-core.ts`, `lib/requests/validate-requester-form-completion.ts`, `lib/users/`, or any existing route/action was modified. No Meta/WhatsApp transport code exists anywhere (grepped `lib/conversations/` for `whatsapp|meta|wamid|phone_number_id|graph\.facebook|access_token` — the only hits are doc-comment prose referencing "a future WhatsApp channel," identical in nature to the same check performed in the Stage 3 report).

## Migrations Added

**One**, as expected: `20240101000135_conversation_persistence.sql` (3 enums, 3 tables, 1 function). No existing ticket table (`requests`, `services`, etc.) was altered.

---

## Known Gaps

1. **CREATE-time exception recovery is intentionally manual (Phase 1).** A genuine process crash *during* `createRequestCore()` (as opposed to its own returned `{error}`) leaves the conversation stuck in `submitting` with no automatic retry, by design (see "CREATE / Double-Create Protection"). This trades a small, documented operational gap (a stuck conversation needing manual/admin attention) for the much larger risk of a duplicate ticket. A future stage could add a reconciliation job that checks whether a `submitting` conversation's presumed ticket actually exists before deciding how to proceed, but this was deliberately not built now to avoid the exact "overcomplicated" scope the brief cautions against.

2. **`EDIT` is deliberately minimal** (Step 23) — lists collected fields, does not support in-place field editing. Documented as a Stage 6/UAT enhancement.

3. **Carried-forward, and now larger, unrelated auth-user leak** (first flagged in `STAGE_3_2_REPORT.md`): `item6-assignment-rbac.test.ts` and `desk-uat-001-reopen.test.ts` (both pre-existing, untouched by any stage of this project) leak a handful of `@example.test` auth users per run via a `deleteUser()` call whose result is never checked, blocked by deeper FK chains their own cleanup doesn't clear. Stage 3.2 observed 5 such stale users; after the repeated regression runs in this stage, the count has grown to **14** (still confined entirely to those same two files — confirmed zero Stage-4-created users remain, see "Database Cleanliness"). This does not affect org/conversation/tenant-safety cleanliness and was not expanded into Stage 4's scope per the brief's explicit instruction, but given it now grows unboundedly with every full-suite run, it is worth prioritizing as a small, standalone follow-up before it accumulates further.

---

## Stage 5 Readiness

**READY FOR STAGE 5: YES.**

The generic `processConversationInbound(ConversationInbound): Promise<ConversationResult>` entry point (`lib/conversations/index.ts`) is the complete, channel-neutral surface Stage 5 needs to call. It has no Meta/WhatsApp dependency, no persisted conversation state gap, DB-backed idempotency and concurrency protection proven under genuine parallel load, lazy expiry, config-drift safety, and double-create protection proven under both duplicate-message and genuine-concurrent-confirmation scenarios — all backed by 3 consecutive clean full-suite runs and a fully-clean database afterward.

No conversation-persistence work beyond what's described here was left undone relative to the brief's 39 steps. No Meta webhook route, access-token config, `phone_number_id` config, Graph API client, WhatsApp message renderer, interactive list/button code, or media-download-from-Meta code was created or started, per the stop condition.
