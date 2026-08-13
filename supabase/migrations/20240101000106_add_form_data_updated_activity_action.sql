-- New activity_action value for editing the submitted-form values on a
-- request post-creation (e.g. a technician correcting a mistyped field) —
-- reclassify already has its own action ('reclassified') for service/category
-- changes; this is the equivalent for the actual form_data payload, kept
-- distinct so the activity feed reads correctly.

ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'form_data_updated';

NOTIFY pgrst, 'reload schema';
