-- ============================================================
-- Projects — priority + relaxed milestone dates
-- ============================================================
-- Added while importing a legacy project tracker export: every project
-- there carries a P1/P2/P3 priority, and a meaningful share of its
-- sub-projects (→ our milestones) have only a start date, or no dates at
-- all, at time of creation. Milestones was built assuming both dates are
-- always known up front — real data says otherwise, so the NOT NULL
-- constraints are relaxed. The CHECK only applies when both are present.
-- ============================================================

CREATE TYPE project_priority AS ENUM ('P1', 'P2', 'P3');

ALTER TABLE projects ADD COLUMN priority project_priority NOT NULL DEFAULT 'P2';

ALTER TABLE milestones ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE milestones ALTER COLUMN end_date DROP NOT NULL;
ALTER TABLE milestones DROP CONSTRAINT IF EXISTS milestones_check;
ALTER TABLE milestones ADD CONSTRAINT milestones_check
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);
