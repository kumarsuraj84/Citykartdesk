-- Who sent the ticket for approval — needed so that person (the technician, not
-- necessarily the requester) can be told when the approver decides, same as the
-- requester already is. Previously only recoverable (unreliably) from the activity log.

ALTER TABLE approvals ADD COLUMN requested_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
