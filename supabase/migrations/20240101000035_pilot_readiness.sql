-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 035a — Add new user_role enum values
-- Must be a separate migration from any statement that USES the new values.
-- Postgres requires ALTER TYPE ADD VALUE to commit before the value is usable.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'platform_owner';
