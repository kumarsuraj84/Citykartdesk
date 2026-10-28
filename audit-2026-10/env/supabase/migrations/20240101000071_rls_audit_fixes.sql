-- Fixes for 4 confirmed RLS issues found in a read-only audit pass.

-- ---------------------------------------------------------------------------
-- Fix 1: intake_messages has SELECT but no UPDATE policy, so markMessageRead,
-- archiveMessage, and rejectReview's follow-up update all silently affect 0
-- rows under RLS. Add an UPDATE policy with the same org_id + role scoping
-- as intake_messages_select (and matching the style of the sibling,
-- recently-correct intake_reviews_update policy).
-- ---------------------------------------------------------------------------
CREATE POLICY intake_messages_update ON intake_messages
  FOR UPDATE
  USING (
    (org_id = current_org_id())
    AND (current_user_role() = ANY (ARRAY['agent'::user_role, 'manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))
  )
  WITH CHECK (org_id = current_org_id());

-- ---------------------------------------------------------------------------
-- Fix 2: org_signup_requests exposes a public, unauthenticated INSERT policy
-- (actual name in DB: signup_requests_insert; roles {public}, WITH CHECK
-- true) for a signup flow that has been fully removed from the app (no
-- references in app/, lib/, or components/). Close the write hole via RLS
-- without dropping the orphaned table itself.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS signup_requests_insert ON org_signup_requests;
DROP POLICY IF EXISTS org_signup_requests_insert ON org_signup_requests;

-- ---------------------------------------------------------------------------
-- Fix 3: platform_owner gaps missed by the prior regex-based fix because
-- these use a `profiles.role` EXISTS-subquery shape rather than the
-- `current_user_role() = ANY(ARRAY[...])` shape the prior fix matched.
-- ---------------------------------------------------------------------------

-- service_sub_categories.sub_categories_admin_write: was admin-only.
-- Sibling admin-write policies on service_categories/services are split
-- between an "_admin" variant (admin+manager+platform_owner) and a "_write"
-- variant (admin+platform_owner only). This policy's own name
-- ("_admin_write") most closely mirrors the "_write" siblings
-- (service_categories_write / services_write), so match that role set:
-- admin + platform_owner (the must-have fix), manager intentionally not
-- added for consistency with the "_write" sibling policies.
DROP POLICY IF EXISTS sub_categories_admin_write ON service_sub_categories;
CREATE POLICY sub_categories_admin_write ON service_sub_categories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])
    )
  );

-- request_time_entries.time_entries_select (SELECT): add platform_owner.
DROP POLICY IF EXISTS time_entries_select ON request_time_entries;
CREATE POLICY time_entries_select ON request_time_entries
  FOR SELECT
  USING (
    (user_id = auth.uid())
    OR (EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_time_entries.request_id
        AND (
          (r.requester_id = auth.uid())
          OR (EXISTS (
            SELECT 1 FROM team_members
            WHERE team_members.team_id = r.team_id
              AND team_members.user_id = auth.uid()
          ))
          OR (EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
          ))
        )
    ))
  );

-- request_time_entries.time_entries_insert (INSERT): add platform_owner.
DROP POLICY IF EXISTS time_entries_insert ON request_time_entries;
CREATE POLICY time_entries_insert ON request_time_entries
  FOR INSERT
  WITH CHECK (
    (user_id = auth.uid())
    AND (EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_time_entries.request_id
        AND (
          (EXISTS (
            SELECT 1 FROM team_members
            WHERE team_members.team_id = r.team_id
              AND team_members.user_id = auth.uid()
          ))
          OR (EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
          ))
        )
    ))
  );

-- request_time_entries.time_entries_delete (DELETE): add platform_owner.
DROP POLICY IF EXISTS time_entries_delete ON request_time_entries;
CREATE POLICY time_entries_delete ON request_time_entries
  FOR DELETE
  USING (
    (user_id = auth.uid())
    OR (EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    ))
  );

-- tasks.tasks_delete (DELETE): add platform_owner.
DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_delete ON tasks
  FOR DELETE
  TO authenticated
  USING (
    (created_by = auth.uid())
    OR (EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    ))
  );

-- ---------------------------------------------------------------------------
-- Fix 4: is_owner_org() hardcodes role='admin', excluding platform_owner,
-- even though platform_owner is meant to be a strict superset of admin.
-- This gates license_keys, owner_audit_log, org_module_access (all
-- confirmed-orphaned owner-portal remnants with no app references).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_owner_org()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN organizations o ON o.id = p.org_id
    WHERE p.id = auth.uid()
      AND o.is_owner = true
      AND p.role = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])
  )
$function$;
