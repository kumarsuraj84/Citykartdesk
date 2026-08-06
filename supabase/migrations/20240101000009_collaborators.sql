-- ── Extend activity_action enum ───────────────────────────────────────────────
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'collaborator_added';
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'collaborator_removed';

-- ── request_collaborators table ───────────────────────────────────────────────
CREATE TABLE request_collaborators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by    UUID NOT NULL REFERENCES profiles(id),
  added_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (request_id, user_id)
);
ALTER TABLE request_collaborators ENABLE ROW LEVEL SECURITY;

-- ── SECURITY DEFINER helper — bypasses collab RLS to avoid recursion ──────────
-- requests_select references request_collaborators; collab_select would normally
-- reference requests, creating a cycle (42P17). We break it with this function
-- that queries request_collaborators without going through its RLS policy.
CREATE OR REPLACE FUNCTION is_request_collaborator(p_request_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM request_collaborators
    WHERE request_id = p_request_id AND user_id = auth.uid()
  )
$$;

-- SELECT: no cross-reference to requests — avoids the recursion cycle.
-- Any agent/manager/admin can see collaborator records (they only contain UUIDs).
-- The collaborator themselves can also see their own record.
CREATE POLICY "collab_select" ON request_collaborators FOR SELECT USING (
  user_id = auth.uid()
  OR added_by = auth.uid()
  OR is_agent()
  OR current_user_role() IN ('manager','admin')
);

-- INSERT: agents on the request's team, managers, admins
CREATE POLICY "collab_insert" ON request_collaborators FOR INSERT WITH CHECK (
  is_team_member((SELECT team_id FROM requests WHERE id = request_id))
  OR current_user_role() IN ('manager','admin')
);

-- DELETE: adder, manager, admin
CREATE POLICY "collab_delete" ON request_collaborators FOR DELETE USING (
  added_by = auth.uid()
  OR current_user_role() IN ('manager','admin')
);

-- ── Extend requests_select to include collaborators ────────────────────────────
-- Uses is_request_collaborator() (SECURITY DEFINER) instead of an inline
-- subquery to prevent the RLS recursion cycle with request_collaborators.
DROP POLICY IF EXISTS "requests_select" ON requests;
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  requester_id = auth.uid()
  OR is_team_member(team_id)
  OR current_user_role() IN ('manager','admin')
  OR is_request_collaborator(id)
);

-- ── Grant table privileges to authenticated role ─────────────────────────────
GRANT SELECT, INSERT, DELETE ON request_collaborators TO authenticated;

-- ── Extend request_comments select to include collaborators ───────────────────
DROP POLICY IF EXISTS "comments_select" ON request_comments;
CREATE POLICY "comments_select" ON request_comments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_id
    AND (
      r.requester_id = auth.uid()
      OR is_team_member(r.team_id)
      OR current_user_role() IN ('manager','admin')
      OR is_request_collaborator(r.id)
    )
  )
  AND (
    NOT is_internal
    OR is_agent()
    OR current_user_role() IN ('manager','admin')
  )
);
