-- ============================================================
-- Projects — Phase A (1/2): module slug
-- ============================================================
-- Adds the 'projects' module to the module_slug enum so the module can be
-- licensed per-org via org_module_access and gated in the sidebar (has()).
--
-- IMPORTANT: `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction
-- that later references the new value. The org_module_access seed that USES
-- 'projects' therefore lives in seed.sql, applied after this migration commits.
-- This mirrors how 'intake' was added in migration 052.
-- ============================================================

ALTER TYPE module_slug ADD VALUE IF NOT EXISTS 'projects';
