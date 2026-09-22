-- Lets a reply to one of our OUTBOUND emails (ticket logged, assigned, a comment,
-- sent-for-approval, approved/rejected, resolved — anything) land back in that same
-- ticket's conversation, instead of being lost or turning into a duplicate new ticket.
-- See lib/email/inbound.ts for the matching + polling logic this supports.

-- request_comments.author_id was NOT NULL — correct for anyone typing in the portal,
-- but an emailed reply can come from someone with no Citykart Desk account at all (an
-- OEM contact, most commonly). Nullable + three new columns let such a comment still be
-- stored and clearly attributed, without inventing a fake "system" profile to own it.
ALTER TABLE request_comments ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE request_comments ADD COLUMN source TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'email'));
ALTER TABLE request_comments ADD COLUMN external_name  TEXT;
ALTER TABLE request_comments ADD COLUMN external_email TEXT;
-- Every comment must be attributable to someone — a real profile (source='portal', or
-- source='email' from someone who happens to also have a Citykart Desk account), or, when
-- there's no profile at all (an OEM contact), the name/email captured from the email itself.
ALTER TABLE request_comments ADD CONSTRAINT request_comments_author_check CHECK (
  author_id IS NOT NULL OR external_email IS NOT NULL
);

-- Dedupe table: one email is never applied to a ticket's conversation twice, even if the
-- mailbox poll re-reads it (crash mid-run, IMAP UID re-delivered, etc.) — the same
-- protection business_rule_events already gives scheduled rules.
CREATE TABLE processed_inbound_emails (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   TEXT NOT NULL UNIQUE, -- the email's own Message-ID header
  request_id   UUID REFERENCES requests(id) ON DELETE CASCADE,
  outcome      TEXT NOT NULL CHECK (outcome IN ('matched', 'no_match', 'sender_not_recognized')),
  from_address TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_processed_inbound_emails_request ON processed_inbound_emails(request_id);

ALTER TABLE processed_inbound_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON processed_inbound_emails FROM PUBLIC, anon, authenticated;
GRANT ALL ON processed_inbound_emails TO service_role;
