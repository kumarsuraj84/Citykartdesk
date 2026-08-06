-- ── Intake Phase D.5: Communication Actions ──────────────────────────────────
-- Adds per-message read/archive state and internal notes.
-- Reply/Forward/Send is handled by the worker; this migration covers the DB side.

-- 1. Read + archive state on intake_messages (replaces status-based tracking).
ALTER TABLE intake_messages
  ADD COLUMN IF NOT EXISTS is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_intake_messages_unread    ON intake_messages(org_id, is_read)    WHERE NOT is_read;
CREATE INDEX idx_intake_messages_archived  ON intake_messages(org_id, is_archived);

-- 2. Internal notes — reviewer annotations visible only inside the platform.
--    Never sent externally. One thread of notes per message, ordered by created_at.
CREATE TABLE intake_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id  UUID        NOT NULL REFERENCES intake_messages(id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_intake_notes_message ON intake_notes(message_id, created_at DESC);

ALTER TABLE intake_notes ENABLE ROW LEVEL SECURITY;

-- Members of the org can read and write notes for their org's messages.
CREATE POLICY "intake_notes_org_read"  ON intake_notes FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "intake_notes_org_write" ON intake_notes FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "intake_notes_author_delete" ON intake_notes FOR DELETE USING (author_id = auth.uid());

CREATE TRIGGER set_intake_notes_updated_at
  BEFORE UPDATE ON intake_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Outbound email log — tracks every reply/forward sent from the platform.
--    Lightweight record; the actual SMTP delivery is fire-and-forget in the worker.
CREATE TABLE intake_outbound (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id      UUID        NOT NULL REFERENCES intake_channels(id) ON DELETE CASCADE,
  in_reply_to_id  UUID        REFERENCES intake_messages(id) ON DELETE SET NULL,
  action          TEXT        NOT NULL CHECK (action IN ('reply', 'reply_all', 'forward')),
  to_addresses    TEXT[]      NOT NULL DEFAULT '{}',
  cc_addresses    TEXT[]      NOT NULL DEFAULT '{}',
  subject         TEXT        NOT NULL,
  body_text       TEXT,
  body_html       TEXT,
  sent_by         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  error           TEXT,
  status          TEXT        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed'))
);

CREATE INDEX idx_intake_outbound_message ON intake_outbound(in_reply_to_id) WHERE in_reply_to_id IS NOT NULL;

ALTER TABLE intake_outbound ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_outbound_org_read" ON intake_outbound FOR SELECT USING (org_id = current_org_id());
