-- Add governance columns to services table
ALTER TABLE services ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','review','published','retired'));
ALTER TABLE services ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS backup_owner_id UUID REFERENCES profiles(id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT '1.0';
ALTER TABLE services ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all','agents_only','managers_only'));
