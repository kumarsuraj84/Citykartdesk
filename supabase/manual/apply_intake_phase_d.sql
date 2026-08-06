-- ════════════════════════════════════════════════════════════════════════════
--  Intake Phase D + D.5 — IDEMPOTENT apply script
--  Safe to run multiple times. Paste into Supabase → SQL Editor → Run.
--  This is the same as migrations 056 + 057 + 058 but guarded so partial prior
--  runs won't error. Fixes: empty Inbox, broken Reply/Forward, Notes, Convert,
--  and the 'informational' classification type.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Migration 058: 'informational' work type (REQUIRED — the classifier emits
--    it for most mail; without it classification INSERTs fail). ───────────────
ALTER TYPE intake_work_type ADD VALUE IF NOT EXISTS 'informational';

-- ── Phase D: work-item linkage ──────────────────────────────────────────────
ALTER TABLE requests ADD COLUMN IF NOT EXISTS intake_message_id UUID REFERENCES intake_messages(id) ON DELETE SET NULL;
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS intake_message_id UUID REFERENCES intake_messages(id) ON DELETE SET NULL;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS source_metadata JSONB;
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS source_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_requests_intake_message ON requests(intake_message_id) WHERE intake_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_intake_message    ON tasks(intake_message_id)    WHERE intake_message_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_intake_reviews_created_request') THEN
    ALTER TABLE intake_reviews ADD CONSTRAINT fk_intake_reviews_created_request
      FOREIGN KEY (created_request_id) REFERENCES requests(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_intake_reviews_created_task') THEN
    ALTER TABLE intake_reviews ADD CONSTRAINT fk_intake_reviews_created_task
      FOREIGN KEY (created_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_intake_reviews_created_approval') THEN
    ALTER TABLE intake_reviews ADD CONSTRAINT fk_intake_reviews_created_approval
      FOREIGN KEY (created_approval_id) REFERENCES approvals(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Phase D.5: read/archive state + notes + outbound log ────────────────────
ALTER TABLE intake_messages
  ADD COLUMN IF NOT EXISTS is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_intake_messages_unread   ON intake_messages(org_id, is_read)    WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS idx_intake_messages_archived ON intake_messages(org_id, is_archived);

CREATE TABLE IF NOT EXISTS intake_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id  UUID        NOT NULL REFERENCES intake_messages(id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intake_notes_message ON intake_notes(message_id, created_at DESC);
ALTER TABLE intake_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intake_notes_org_read"      ON intake_notes;
DROP POLICY IF EXISTS "intake_notes_org_write"     ON intake_notes;
DROP POLICY IF EXISTS "intake_notes_author_delete" ON intake_notes;
CREATE POLICY "intake_notes_org_read"      ON intake_notes FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "intake_notes_org_write"     ON intake_notes FOR INSERT WITH CHECK (org_id = current_org_id());
CREATE POLICY "intake_notes_author_delete" ON intake_notes FOR DELETE USING (author_id = auth.uid());

-- updated_at trigger — uses the same set_updated_at() helper as the other
-- intake tables (migrations 053/055). DROP+CREATE keeps it idempotent.
DROP TRIGGER IF EXISTS set_intake_notes_updated_at ON intake_notes;
CREATE TRIGGER set_intake_notes_updated_at
  BEFORE UPDATE ON intake_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS intake_outbound (
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
CREATE INDEX IF NOT EXISTS idx_intake_outbound_message ON intake_outbound(in_reply_to_id) WHERE in_reply_to_id IS NOT NULL;
ALTER TABLE intake_outbound ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intake_outbound_org_read" ON intake_outbound;
CREATE POLICY "intake_outbound_org_read" ON intake_outbound FOR SELECT USING (org_id = current_org_id());

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Run this after the above to confirm everything landed:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'intake_messages' AND column_name IN ('is_read','is_archived');
