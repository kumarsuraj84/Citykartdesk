-- Per-org SLA configuration (perf-audit follow-up / tenant isolation)
--
-- BUG: global_sla_config.priority was globally UNIQUE, so the table could hold only 4
-- rows for the ENTIRE platform. Every org shared the same SLA tiers, and because the read
-- (getGlobalSLAConfig) and write (updateSLATier) used the service-role client with no org
-- filter, any org admin editing "their" SLA actually overwrote the single shared row for
-- ALL orgs.
--
-- FIX: make SLA config per-org — UNIQUE (org_id, priority) — backfill default tiers for
-- every existing org, and seed defaults automatically whenever a new org is created (via a
-- trigger, so all creation paths are covered, incl. owner-portal-created orgs).
--
-- Scope: Citykart Desk-owned table only (dedicated Supabase project, no HRMS).

-- 1. Ensure every existing row has an org_id (migration 033 backfilled to the owner org).
UPDATE global_sla_config
  SET org_id = '00000000-0000-0000-0000-000000000001'
  WHERE org_id IS NULL;

-- 2. Replace the global UNIQUE(priority) with a per-org UNIQUE(org_id, priority).
ALTER TABLE global_sla_config DROP CONSTRAINT IF EXISTS global_sla_config_priority_key;
ALTER TABLE global_sla_config
  ADD CONSTRAINT global_sla_config_org_priority_key UNIQUE (org_id, priority);
ALTER TABLE global_sla_config ALTER COLUMN org_id SET NOT NULL;

-- 3. Idempotent seeder: default SLA tiers for one org.
CREATE OR REPLACE FUNCTION seed_default_sla_config(p_org_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO global_sla_config (org_id, priority, response_hours, resolution_hours, escalation_pct)
  VALUES
    (p_org_id, 'urgent', 0.25, 4,  80),
    (p_org_id, 'high',   1,    8,  80),
    (p_org_id, 'medium', 4,    24, 80),
    (p_org_id, 'low',    8,    72, 80)
  ON CONFLICT (org_id, priority) DO NOTHING;
$$;

-- 4. Backfill defaults for every org that is missing tiers.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organizations LOOP
    PERFORM seed_default_sla_config(r.id);
  END LOOP;
END $$;

-- 5. Seed defaults automatically on new org creation.
CREATE OR REPLACE FUNCTION trg_seed_org_sla_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_default_sla_config(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS seed_org_sla_config ON organizations;
CREATE TRIGGER seed_org_sla_config
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION trg_seed_org_sla_config();
