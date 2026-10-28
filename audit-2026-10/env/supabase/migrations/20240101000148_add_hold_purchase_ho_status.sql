-- New request status: "Hold due to Purchase from HO" — a technician-only hold
-- state, parallel to 'waiting_user' (pauses the SLA clock, requires a remark)
-- but the requester cannot set or leave it themselves (see
-- lib/constants/request-transitions.ts).
--
-- Non-transactional: ADD VALUE must commit before the value can be referenced
-- by name elsewhere, so this stays its own migration file/statement — same
-- pattern as 20240101000035_pilot_readiness.sql and
-- 20240101000052_intake_module.sql extending their own enums.
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'hold_purchase_ho';

NOTIFY pgrst, 'reload schema';
