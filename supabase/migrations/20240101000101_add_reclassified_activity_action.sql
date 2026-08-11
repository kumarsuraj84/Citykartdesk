-- New activity_action value for the "agent corrects the submitted service
-- classification" feature — a requester can pick the wrong Category / Sub
-- Category / Service (item) when filing a ticket; an agent needs a way to
-- fix it post-creation, and that correction needs its own audit-trail entry
-- distinct from 'status_changed'/'priority_changed'.

ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'reclassified';

NOTIFY pgrst, 'reload schema';
