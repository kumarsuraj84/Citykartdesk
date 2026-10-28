-- ============================================================
-- MIGRATION: Harden RLS policies
-- ============================================================

-- ── requests UPDATE: add WITH CHECK to prevent immutable field changes ──────
-- Agents and managers may update status, assigned_to, priority, resolution
-- fields, but MUST NOT change requester_id, service_id, or team_id.
-- The subquery compares the proposed new values against the current stored
-- values, rejecting any attempt to move a request to a different
-- requester/service/team.

DROP POLICY IF EXISTS "requests_update" ON requests;

CREATE POLICY "requests_update" ON requests
  FOR UPDATE TO authenticated
  USING (
    is_team_member(team_id)
    OR current_user_role() IN ('manager', 'admin')
  )
  WITH CHECK (
    -- Authorized updater (re-checked against new row's team_id)
    (is_team_member(team_id) OR current_user_role() IN ('manager', 'admin'))
    -- Immutable fields must not change
    AND requester_id = (SELECT r.requester_id FROM requests r WHERE r.id = requests.id)
    AND service_id   = (SELECT r.service_id   FROM requests r WHERE r.id = requests.id)
    AND team_id      = (SELECT r.team_id      FROM requests r WHERE r.id = requests.id)
  );

-- ── request_activity INSERT: explicit deny for authenticated role ─────────────
-- Writes must go through the service-role admin client only.
-- RLS deny-by-default already covers this when no INSERT policy exists, but
-- an explicit policy makes the intent enforceable and visible.

CREATE POLICY "request_activity_insert_deny" ON request_activity
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- ── approvals INSERT: explicit deny for authenticated role ───────────────────

CREATE POLICY "approvals_insert_deny" ON approvals
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- ── approval_decisions INSERT: explicit deny for authenticated role ──────────

CREATE POLICY "approval_decisions_insert_deny" ON approval_decisions
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (false);
