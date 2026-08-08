-- Single-round-trip module gating helper (perf: middleware was doing 2 queries per
-- gated navigation — profiles for org_id, then org_module_access).
--
-- has_module_access() resolves the caller's org from their profile and checks the module
-- in one SECURITY DEFINER call. Returns TRUE when the module is enabled and unexpired for
-- the caller's org, OR when the caller has no org_id (preserves the prior middleware
-- behaviour of letting org-less users through). The middleware falls back to the legacy
-- two-query path if this function is absent, so deploy order does not matter.
--
-- Scope: Citykart Desk-owned tables only.

CREATE OR REPLACE FUNCTION has_module_access(p_module module_slug)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN (SELECT org_id FROM profiles WHERE id = auth.uid()) IS NULL THEN true
    ELSE EXISTS (
      SELECT 1
      FROM org_module_access oma
      WHERE oma.org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
        AND oma.module = p_module
        AND oma.enabled = true
        AND (oma.valid_until IS NULL OR oma.valid_until > now())
    )
  END
$$;

GRANT EXECUTE ON FUNCTION has_module_access(module_slug) TO authenticated;
