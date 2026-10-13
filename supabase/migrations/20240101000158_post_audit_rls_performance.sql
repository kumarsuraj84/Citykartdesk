-- Post-audit remediation, database performance (audit report 2026-10-13: D-064, D-065, D-066, D-024). LOCAL migration; NOT applied to production.
--
-- Problem measured in the audit: the tickets table's row-security rule called its helper functions (who am I, which teams, which role, my reports)
-- once for EVERY row, before the page limit could be applied. A manager's "latest 25 tickets" took 5.6 s at 100,000 tickets and 28 s at 500,000
-- (against an 8 s database limit), and a technician's exact count was ~1,600x slower than the same count without the rule.
--
-- Fix: the helper calls are wrapped as (SELECT fn()) so PostgreSQL evaluates each ONCE per query and can then use indexes; and an index for the
-- manager's "latest first" list is added. The rule says exactly what it said before (same people, same tickets): only how often the answers are
-- looked up changes. tests/remediation/70-rls-equivalence.test.ts proves identical visibility for every kind of user.

-- ── who can see a ticket (same conditions as before, helpers evaluated once per query) ───────────────────────────────────────────
DROP POLICY IF EXISTS "requests_select" ON public.requests;
CREATE POLICY "requests_select" ON public.requests FOR SELECT
  USING (
    org_id = (SELECT current_org_id())
    AND (
      requester_id = (SELECT auth.uid())
      OR team_id = ANY ((SELECT current_user_team_ids())::uuid[])
      OR (SELECT current_user_role()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
      OR is_request_collaborator(id)
      OR is_request_approver(id)
      OR requester_id = ANY ((SELECT current_user_subordinate_ids())::uuid[])
      OR assigned_to = ANY ((SELECT current_user_subordinate_ids())::uuid[])
    )
  );

-- ── helper for the update rule: "this update does not change who the ticket belongs to" ───────────────────────────────────────────
-- The update rule used to compare the new row with the stored row by reading the tickets table inside the rule itself. PostgreSQL refuses a
-- rule that reads its own table once the select rule above contains sub-selects ("infinite recursion detected in policy"), so the stored row
-- is read by a SECURITY DEFINER function instead. Same answer: the function sees the row as it was before the update, exactly like the
-- sub-selects did, and a changed organization / requester / service / team still fails the check.
CREATE OR REPLACE FUNCTION public.request_identity_unchanged(p_id uuid, p_org uuid, p_requester uuid, p_service uuid, p_team uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.requests r
    WHERE r.id = p_id AND r.org_id = p_org AND r.requester_id = p_requester AND r.service_id = p_service AND r.team_id = p_team
  )
$$;

-- ── who can update a ticket: the same wrapping on the part that does not look at other rows ──────────────────────────────────────
DROP POLICY IF EXISTS "requests_update" ON public.requests;
CREATE POLICY "requests_update" ON public.requests FOR UPDATE
  USING (
    org_id = (SELECT current_org_id())
    AND (
      team_id = ANY ((SELECT current_user_team_ids())::uuid[])
      OR (SELECT current_user_role()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    )
  )
  WITH CHECK (
    public.request_identity_unchanged(id, org_id, requester_id, service_id, team_id)
    AND (
      team_id = ANY ((SELECT current_user_team_ids())::uuid[])
      OR (SELECT current_user_role()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    )
  );

-- ── the manager / admin "latest tickets" list ───────────────────────────────────────────────────────────────────────────────────
-- (a plain CREATE INDEX: on the production table, a few hundred tickets today, it is instant; on a very large table build it with
--  CREATE INDEX CONCURRENTLY outside a transaction)
CREATE INDEX IF NOT EXISTS idx_requests_org_updated ON public.requests (org_id, updated_at DESC);
ANALYZE public.requests;
