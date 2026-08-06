-- ============================================================
-- MIGRATION: Phase 1 — Request Attachments
-- ============================================================

-- ── 1. Extend activity_action enum ───────────────────────────────────────────
-- IF NOT EXISTS guards against re-runs during local dev resets
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'attachment_added';

-- ── 2. Storage bucket ────────────────────────────────────────────────────────
-- Private bucket; 10 MB per file; explicit MIME allowlist.
-- Signed URLs (generated server-side by admin client) are the only access path.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'request-attachments',
  'request-attachments',
  false,
  10485760,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
) ON CONFLICT (id) DO NOTHING;

-- ── 3. request_attachments table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS request_attachments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID        NOT NULL REFERENCES requests(id)  ON DELETE CASCADE,
  uploaded_by  UUID        NOT NULL REFERENCES profiles(id)  ON DELETE RESTRICT,
  file_name    TEXT        NOT NULL,
  file_size    INTEGER     NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  mime_type    TEXT        NOT NULL,
  storage_path TEXT        NOT NULL UNIQUE,
  is_internal  BOOLEAN     NOT NULL DEFAULT false,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

-- Partial indexes — only non-deleted rows appear in normal queries
CREATE INDEX IF NOT EXISTS idx_request_attachments_request
  ON request_attachments(request_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_request_attachments_uploader
  ON request_attachments(uploaded_by);

-- ── 4. Table grants (PostgREST needs explicit grants even with service_role) ──
GRANT ALL ON TABLE request_attachments TO anon, authenticated, service_role;

-- ── 5. RLS on request_attachments ────────────────────────────────────────────
ALTER TABLE request_attachments ENABLE ROW LEVEL SECURITY;

-- SELECT: requester or team member of the request's team; respects is_internal
CREATE POLICY "request_attachments_select" ON request_attachments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
        AND (
          r.requester_id = auth.uid()
          OR is_team_member(r.team_id)
          OR current_user_role() IN ('manager', 'admin')
        )
    )
    AND (
      is_internal = false
      OR is_team_member((SELECT team_id FROM requests WHERE id = request_id))
      OR current_user_role() IN ('manager', 'admin')
    )
  );

-- INSERT: authenticated user with request access; must self-identify as uploader
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
        )
    )
  );

-- UPDATE (soft-delete only): uploader or agent/manager on the request's team
CREATE POLICY "request_attachments_update" ON request_attachments
  FOR UPDATE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR is_team_member((SELECT team_id FROM requests WHERE id = request_id))
    OR current_user_role() IN ('manager', 'admin')
  )
  WITH CHECK (
    uploaded_by = auth.uid()
    OR is_team_member((SELECT team_id FROM requests WHERE id = request_id))
    OR current_user_role() IN ('manager', 'admin')
  );

-- ── 5. Storage object RLS (defense-in-depth) ──────────────────────────────────
-- All storage I/O (upload, signed URL, delete) is done via the admin client
-- which bypasses RLS. These policies prevent direct authenticated client access.

-- SELECT via signed URL bypasses RLS — this blocks unauthenticated raw access.
-- Authenticated requests for objects must come through server-generated URLs.
CREATE POLICY "storage_request_attachments_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'request-attachments'
    AND EXISTS (
      SELECT 1 FROM request_attachments ra
      WHERE ra.storage_path = name
        AND ra.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM requests r
          WHERE r.id = ra.request_id
            AND (
              r.requester_id = auth.uid()
              OR is_team_member(r.team_id)
              OR current_user_role() IN ('manager', 'admin')
            )
        )
    )
  );

-- INSERT: restricted to authenticated users; fine-grained check is in server action
CREATE POLICY "storage_request_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'request-attachments'
    AND auth.uid() IS NOT NULL
  );

-- DELETE: only the owner of the storage object (matches uploader)
CREATE POLICY "storage_request_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'request-attachments'
    AND (owner)::uuid = auth.uid()
  );
