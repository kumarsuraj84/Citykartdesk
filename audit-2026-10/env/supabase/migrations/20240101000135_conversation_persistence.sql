-- Stage 4 — Persistent Conversation State
--
-- Persists the Stage 3/3.1 questionnaire engine's RequestDraft across
-- independent inbound messages, so a future channel (WhatsApp first, but
-- this schema is deliberately channel-neutral) can resume a multi-turn
-- ticket-creation conversation after a server restart, a duplicate webhook
-- delivery, or a multi-hour gap.
--
-- ── Persistence model decision (see STAGE_4_REPORT.md "Persistence Design
-- Decision" for the full reasoning) ─────────────────────────────────────────
-- NOT built on intake_threads/intake_messages. Audited both tables in full:
-- intake_threads groups INBOUND EMAILS for a human reviewer to read and
-- convert (participant_emails TEXT[], subject, message_count, status
-- open/linked/closed) — there is no requester_id, no draft/answer storage,
-- and no multi-state machine concept; intake_reviews' pending/in_review/
-- approved/rejected/converted lifecycle is a human-approval workflow, not a
-- machine-driven dialogue. Bolting a 12-state bot conversation, a
-- RequestDraft, expiry, and optimistic-concurrency versioning onto that
-- schema would overload it with two incompatible semantics on the same
-- table — exactly the "confusing or unsafe semantics" the brief warns
-- against. New, purpose-built tables below instead.
--
-- intake_channel_type IS reused for `channel_type` below — it already has
-- exactly the channel vocabulary this needs ('email','portal','whatsapp',
-- 'teams','slack','api') and has never been altered since it was created
-- (confirmed live), so there is no drift risk in sharing it.

-- ── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE conversation_state AS ENUM (
  'identified',
  'awaiting_service',
  'awaiting_issue_search',
  'awaiting_subcategory',
  'awaiting_description',
  'collecting_fields',
  'awaiting_file',
  'review',
  'submitting',
  'completed',
  'cancelled',
  'expired'
);

CREATE TYPE conversation_event_status AS ENUM ('processing', 'completed', 'failed');

CREATE TYPE conversation_attachment_status AS ENUM ('received_reference', 'persisted', 'failed');

-- ── request_conversations ────────────────────────────────────────────────
-- One row per in-progress-or-terminal ticket-creation conversation. Holds
-- the RequestDraft as normalized columns (mirroring how `requests` itself
-- splits service_id/sub_category_id/category_id/title/description out as
-- real columns and only the truly dynamic per-field answers into JSONB) —
-- NOT the resolved form schema itself, which stays authoritative in
-- services/form_templates and is always reloaded fresh (see Step 25 in
-- STAGE_4_REPORT.md: a persisted draft must never let a stale template
-- definition override today's DESK configuration).

CREATE TABLE request_conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  org_id            UUID NOT NULL REFERENCES organizations(id),
  requester_id      UUID NOT NULL REFERENCES profiles(id),

  -- Conversation identity (Step 2). channel_identity is whatever the caller
  -- has already normalized (e.g. Stage 2's bare 10-digit mobile for
  -- whatsapp) — this schema never normalizes or validates it itself.
  channel_type      intake_channel_type NOT NULL,
  channel_identity  TEXT NOT NULL,

  state             conversation_state NOT NULL DEFAULT 'identified',

  -- RequestDraft fields (Step 5). service_id/sub_category_id/category_id
  -- intentionally have no NOT NULL / drop-dead FK behavior beyond
  -- ON DELETE SET NULL — a service or sub-category disappearing out from
  -- under an active conversation must surface as "no longer valid" through
  -- the ordinary Step 25 config-drift revalidation, not as an FK violation
  -- blocking an unrelated admin action.
  service_id        UUID REFERENCES services(id) ON DELETE SET NULL,
  issue_search_text TEXT,
  -- Canonical sub-category ids presented at the most recent search (Step 6/
  -- 19's "search result integrity" rule) — a selection is only ever
  -- accepted against this exact set, never trusted by numeric position.
  search_result_ids UUID[],
  sub_category_id   UUID REFERENCES service_sub_categories(id) ON DELETE SET NULL,
  category_id       UUID REFERENCES service_categories(id) ON DELETE SET NULL,
  description       TEXT,
  -- Generated once by generateRequestTitle() and never regenerated on
  -- resume/retry (Step 7) — see STAGE_3_1_REPORT.md "Title Contract",
  -- preserved unchanged by this stage.
  title             TEXT,
  -- fieldId -> answer, exactly RequestDraft.answers / createRequestCore()'s
  -- formData shape. Never holds description/title (see adapter.ts).
  answers           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The field currently being asked in collecting_fields/awaiting_file, so
  -- a resumed conversation continues exactly where it stopped instead of
  -- re-deriving "the next question" and risking a different field if the
  -- template changed shape mid-conversation (Step 6).
  current_field_id  TEXT,

  -- Set once CREATE actually succeeds (Step 24). UNIQUE below: a request is
  -- linked from at most one conversation.
  request_id        UUID REFERENCES requests(id) ON DELETE SET NULL,
  -- Non-fatal failure detail from the most recent CREATE attempt (Step 24)
  -- — e.g. "Service not found" after a config-drift rejection. Cleared on
  -- the next successful transition.
  last_error        TEXT,

  -- Optimistic concurrency (Step 14) — every mutating transition goes
  -- through commit_conversation_transition() below, which requires the
  -- caller's in-memory `version` to still match the stored row and always
  -- increments it by exactly 1 on success.
  version           INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),

  -- Expiry (Step 12) — checked lazily against the server clock on the next
  -- inbound event for this scope; see resolveActiveConversation() in
  -- lib/conversations/repository.ts. No cron job.
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  expired_at        TIMESTAMPTZ
);

-- Step 11 / AC-4.4 — DB-backed "at most one active conversation per
-- (org, channel, identity)" invariant, the same partial-unique-index
-- pattern already used by approvals_one_pending_per_request and
-- idx_time_entries_one_open_per_user: a concurrent INSERT racing an
-- existing active row fails with 23505 rather than silently creating two.
CREATE UNIQUE INDEX idx_request_conversations_one_active
  ON request_conversations (org_id, channel_type, channel_identity)
  WHERE state IN (
    'identified', 'awaiting_service', 'awaiting_issue_search', 'awaiting_subcategory',
    'awaiting_description', 'collecting_fields', 'awaiting_file', 'review', 'submitting'
  );

CREATE INDEX idx_request_conversations_org_requester ON request_conversations (org_id, requester_id);
CREATE INDEX idx_request_conversations_org_state ON request_conversations (org_id, state);

-- Step 29 — a request is linked from at most one conversation.
CREATE UNIQUE INDEX idx_request_conversations_request_id
  ON request_conversations (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE request_conversations ENABLE ROW LEVEL SECURITY;

-- Every read/write in Stage 4 goes through the service-role admin client
-- (there is no requester-facing browser session for a WhatsApp/Slack/Teams
-- conversation — see createRequestCore()'s own "RLS provides no protection
-- for a service-role caller" precedent, which this table follows
-- identically: every application-layer query below explicitly filters
-- org_id itself). This SELECT-only policy exists purely so a future
-- admin/support screen could safely list conversations without bypassing
-- RLS, mirroring intake_threads' own read policy — no INSERT/UPDATE/DELETE
-- policy is granted to `authenticated`, so all writes stay service-role-only
-- by omission, exactly like intake_audit_log's write restriction.
CREATE POLICY "request_conversations_select" ON request_conversations FOR SELECT USING (
  org_id = current_org_id() AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
);

GRANT SELECT ON request_conversations TO authenticated;
GRANT ALL ON request_conversations TO service_role;

CREATE TRIGGER set_request_conversations_updated_at
  BEFORE UPDATE ON request_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── conversation_events ──────────────────────────────────────────────────
-- Message-idempotency ledger (Step 13 / AC-4.8). Mirrors intake_messages'
-- own UNIQUE(org_id, channel_id, external_message_id) precedent, with two
-- deliberate differences: external_message_id is NOT NULL here (this
-- table's only purpose is dedup, so a null id would defeat it — unlike
-- intake_messages, which stores every message whether or not the provider
-- supplied one), and channel_type substitutes for channel_id since Stage 4
-- has no configured "channel" row to reference (channel-neutral by design).

CREATE TABLE conversation_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id),
  channel_type          intake_channel_type NOT NULL,
  external_message_id   TEXT NOT NULL,
  conversation_id       UUID REFERENCES request_conversations(id) ON DELETE SET NULL,
  status                conversation_event_status NOT NULL DEFAULT 'processing',
  -- The exact ConversationResult (or an error summary) produced the first
  -- time this event was processed — replayed verbatim to a duplicate
  -- delivery instead of reprocessing. Deliberately never a raw transport
  -- payload (Step 27 — "avoid raw Meta payload storage in Stage 4").
  result                JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_conversation_events_dedup
  ON conversation_events (org_id, channel_type, external_message_id);

CREATE INDEX idx_conversation_events_conversation ON conversation_events (conversation_id);

ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON conversation_events TO service_role;

-- ── conversation_attachments ─────────────────────────────────────────────
-- Generic durable attachment REFERENCES (Step 22) — metadata only, never a
-- downloaded binary; Stage 5/6 will supply the actual transport-specific
-- retrieval. Deliberately no Meta-specific column names (no wamid,
-- media_id-as-such — `external_media_id` is a plain opaque string any
-- channel can populate).

CREATE TABLE conversation_attachments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID NOT NULL REFERENCES request_conversations(id) ON DELETE CASCADE,
  field_id            TEXT NOT NULL,
  external_media_id   TEXT,
  file_name           TEXT,
  mime_type           TEXT,
  size                BIGINT CHECK (size IS NULL OR size >= 0),
  status              conversation_attachment_status NOT NULL DEFAULT 'received_reference',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_attachments_conversation_field
  ON conversation_attachments (conversation_id, field_id);

ALTER TABLE conversation_attachments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON conversation_attachments TO service_role;

-- ── commit_conversation_transition() ────────────────────────────────────
-- The one atomic RPC this stage introduces (Step 14's "transactional
-- requirement" — claim + transition + persist must behave as one logical
-- operation, and Supabase-js has no client-exposed multi-statement
-- transaction, so the combined "advance the conversation" + "mark its
-- triggering event completed" write has to happen inside a single Postgres
-- function to be genuinely atomic). Modeled on the existing
-- merge_request_form_data/upsert_field_sla_override precedent: a plain
-- SECURITY DEFINER function, granted only to service_role, doing exactly
-- one UPDATE plus one conditional UPDATE — no business logic lives here,
-- every value is already fully computed by the caller (lib/conversations/
-- orchestrator.ts) using the real Stage 3 questionnaire functions.
--
-- Every parameter is the COMPLETE new value for its column (never a partial
-- patch) — the caller always holds the full current row in memory and
-- computes the full next row, so there is no ambiguity between "leave
-- unchanged" and "set to NULL" the way a JSONB-patch design would have.
--
-- Concurrency: the UPDATE's `WHERE version = p_expected_version` is the
-- entire optimistic-lock check — if another writer already advanced the
-- row, this UPDATE matches zero rows and the function raises, and the
-- caller (lib/conversations/repository.ts) reloads the fresh row and
-- retries its own business-logic computation against it, bounded to a few
-- attempts.
CREATE OR REPLACE FUNCTION commit_conversation_transition(
  p_conversation_id    UUID,
  p_expected_version   INTEGER,
  p_state              conversation_state,
  p_service_id         UUID,
  p_issue_search_text  TEXT,
  p_search_result_ids  UUID[],
  p_sub_category_id    UUID,
  p_category_id        UUID,
  p_description        TEXT,
  p_title              TEXT,
  p_answers            JSONB,
  p_current_field_id   TEXT,
  p_request_id         UUID,
  p_last_error         TEXT,
  p_last_activity_at   TIMESTAMPTZ,
  p_expires_at         TIMESTAMPTZ,
  p_completed_at       TIMESTAMPTZ,
  p_cancelled_at       TIMESTAMPTZ,
  p_expired_at         TIMESTAMPTZ,
  p_event_id           UUID,
  p_event_result       JSONB
)
RETURNS request_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row request_conversations;
BEGIN
  UPDATE request_conversations SET
    state             = p_state,
    service_id        = p_service_id,
    issue_search_text = p_issue_search_text,
    search_result_ids = p_search_result_ids,
    sub_category_id   = p_sub_category_id,
    category_id       = p_category_id,
    description       = p_description,
    title             = p_title,
    answers           = p_answers,
    current_field_id  = p_current_field_id,
    request_id        = p_request_id,
    last_error        = p_last_error,
    version           = version + 1,
    last_activity_at  = p_last_activity_at,
    expires_at        = p_expires_at,
    completed_at      = p_completed_at,
    cancelled_at      = p_cancelled_at,
    expired_at        = p_expired_at
  WHERE id = p_conversation_id AND version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_version_conflict: % expected version %', p_conversation_id, p_expected_version;
  END IF;

  IF p_event_id IS NOT NULL THEN
    UPDATE conversation_events
    SET status = 'completed', result = p_event_result, conversation_id = p_conversation_id, updated_at = now()
    WHERE id = p_event_id;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION commit_conversation_transition FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commit_conversation_transition TO service_role;
