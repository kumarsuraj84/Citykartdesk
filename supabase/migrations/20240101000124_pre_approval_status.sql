-- approveApproval() hardcoded the resumed status to 'in_progress' on full
-- approval regardless of what the request actually was before being sent —
-- a ticket genuinely in 'waiting_user' when "Send for Approval" was clicked
-- (a legal transition; sendAdHocApproval only blocks open/assigned/terminal/
-- already-pending states) would come back looking ready for the technician
-- to act, silently losing the fact that it's still waiting on the requester.
ALTER TABLE requests
  ADD COLUMN pre_approval_status request_status;
