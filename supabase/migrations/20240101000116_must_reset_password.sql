-- A user must change their password before they can use the portal whenever
-- an admin/owner sets it for them directly (bulk import or single reset) —
-- they never chose that password themselves, unlike the email-invite flow
-- where they set their own on first login.
ALTER TABLE profiles
  ADD COLUMN must_reset_password BOOLEAN NOT NULL DEFAULT false;
