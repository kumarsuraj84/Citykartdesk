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
    (org_id = (SELECT r.org_id FROM public.requests r WHERE r.id = requests.id))
    AND (
      team_id = ANY ((SELECT current_user_team_ids())::uuid[])
      OR (SELECT current_user_role()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    )
    AND (requester_id = (SELECT r.requester_id FROM public.requests r WHERE r.id = requests.id))
    AND (service_id = (SELECT r.service_id FROM public.requests r WHERE r.id = requests.id))
    AND (team_id = (SELECT r.team_id FROM public.requests r WHERE r.id = requests.id))
  );

-- ── the manager / admin "latest tickets" list ───────────────────────────────────────────────────────────────────────────────────
-- (a plain CREATE INDEX: on the production table, a few hundred tickets today, it is instant; on a very large table build it with
--  CREATE INDEX CONCURRENTLY outside a transaction)
CREATE INDEX IF NOT EXISTS idx_requests_org_updated ON public.requests (org_id, updated_at DESC);
ANALYZE public.requests;
