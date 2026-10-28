-- ============================================================
-- Intake Intelligence — Phase A (1/2): module slug
-- ============================================================
-- Adds the 'intake' module to the module_slug enum so the module can be
-- licensed per-org via org_module_access and gated in proxy.ts + the sidebar.
--
-- IMPORTANT: `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction
-- that later references the new value. The org_module_access seed that USES
-- 'intake' therefore lives in the next migration (053), not here. This mirrors
-- how 'agent'/'platform_owner' were added in migration 035.
--
-- Scope: Citykart Desk-owned schema only.
-- ============================================================

ALTER TYPE module_slug ADD VALUE IF NOT EXISTS 'intake';
