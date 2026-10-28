-- ============================================================
-- Projects/Milestones — functional owner, and milestone parity fields
-- ============================================================
-- Projects already track a single "owner" (tech owner). The legacy tracker
-- import folded functional_owner into free-text description because there
-- was no column for it — this promotes it to a real, joinable field.
--
-- Milestones only tracked name/status/dates. To let a milestone carry the
-- same fields as its parent project (priority, tech owner, functional
-- owner) plus a self-reported progress %, add them here. percent_complete
-- is deliberately a stored, manually-set field — distinct from the live
-- task-derived burndown — mirroring how project_updates.percent_snapshot
-- is a self-reported number alongside the live-computed project progress.
-- ============================================================

ALTER TABLE projects ADD COLUMN functional_owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE milestones ADD COLUMN owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE milestones ADD COLUMN functional_owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE milestones ADD COLUMN priority project_priority NOT NULL DEFAULT 'P2';
ALTER TABLE milestones ADD COLUMN percent_complete SMALLINT NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100);
