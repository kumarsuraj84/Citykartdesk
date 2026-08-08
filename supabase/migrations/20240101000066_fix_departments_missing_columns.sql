-- ============================================================
-- Fix: departments table is missing columns migration 21 intended.
-- Migration 20240101000021_org_structure.sql used
-- `CREATE TABLE IF NOT EXISTS departments (...)` to add code, parent_id,
-- head_user_id, and is_active — but `departments` already existed from the
-- initial schema (id, name, created_at only), so IF NOT EXISTS silently
-- skipped the whole statement and those columns were never actually added.
-- ============================================================

ALTER TABLE departments ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES departments(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS head_user_id UUID REFERENCES profiles(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
