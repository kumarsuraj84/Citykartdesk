-- A requester rated a resolved ticket 1 or 2 stars: the technician group's lead and the technician are told.
-- Non-transactional: ADD VALUE must commit before the value can be used, so this stays its own file/statement
-- (same pattern as 20240101000148_add_hold_purchase_ho_status.sql).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'csat_low_rating';
