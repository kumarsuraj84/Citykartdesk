-- Sprint 5C: Operational Hardening
-- 1. SLA pause column
-- 2. Fix comments INSERT to include collaborators
-- 3. Fix attachments INSERT to include collaborators

-- ── 1. SLA pause tracking ──────────────────────────────────────────────────────
ALTER TABLE requests ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ;

-- ── 2. Fix request_comments INSERT (add collaborator access) ─────────────────
DROP POLICY IF EXISTS "request_comments_insert" ON request_comments;
CREATE POLICY "request_comments_insert" ON request_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
        AND (
          r.requester_id = auth.uid()
          OR is_team_member(r.team_id)
          OR current_user_role() IN ('manager', 'admin')
          OR is_request_collaborator(r.id)
        )
    )
  );

-- ── 3. Fix request_attachments INSERT (add collaborator access) ───────────────
DROP POLICY IF EXISTS "request_attachments_insert" ON request_attachments;
CREATE POLICY "request_attachments_insert" ON request_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
        AND (
          r.requester_id = auth.uid()
          OR is_team_member(r.team_id)
          OR current_user_role() IN ('manager', 'admin')
          OR is_request_collaborator(r.id)
        )
    )
  );
