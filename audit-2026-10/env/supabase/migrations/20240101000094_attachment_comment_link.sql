-- Attachments become part of the conversation instead of a separate top-of-page
-- block: each attachment can now belong to the specific reply it was sent with.
-- Nullable because (a) attachments uploaded at request-submission time (via a
-- file-type intake field) exist before any comment does, and (b) it keeps every
-- existing attachment row valid with no backfill needed — those show up in the
-- UI as part of the original "request submitted" entry instead of a comment.
ALTER TABLE request_attachments
  ADD COLUMN comment_id UUID REFERENCES request_comments(id) ON DELETE SET NULL;

CREATE INDEX idx_request_attachments_comment ON request_attachments (comment_id);

NOTIFY pgrst, 'reload schema';
