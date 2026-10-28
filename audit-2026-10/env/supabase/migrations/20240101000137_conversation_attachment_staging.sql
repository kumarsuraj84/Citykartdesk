-- ============================================================
-- STAGE 5.1 — required-attachment staging model
-- ============================================================
-- Stage 5's original flow let a `received_reference` alone (a bare Meta
-- media id, never downloaded or validated) satisfy a requester-mandatory
-- file field's readiness — see lib/conversations/file-progress.ts's
-- fieldIdsWithAttachments(), which previously counted ANY attachment row
-- regardless of status. STAGE_5_1_REPORT.md "Mandatory Attachment
-- Architecture" documents the audit that found this insufficient for a
-- MANDATORY field and the redesign this migration/the accompanying code
-- change implements.
--
-- New model (still the one generic, channel-neutral conversation_attachments
-- table — not a second, WhatsApp-only attachment system):
--
--   received_reference  -- a transport handed us a media id; NOT yet
--                           downloaded/validated; NEVER satisfies a
--                           mandatory file field's readiness on its own.
--   staged               -- downloaded, MIME/magic-byte/size validated, and
--                           durably stored at `storage_path` BEFORE Review/
--                           Create. Only a 'staged' (or later 'linked')
--                           attachment satisfies mandatory-field readiness.
--   linked                -- promoted into the normal request_attachments
--                           model after createRequestCore() succeeded, by
--                           copying the ALREADY-staged object (never a
--                           second download from the transport — Meta media
--                           URLs/references may be temporary).
--   failed                -- retrieval/validation/storage genuinely failed;
--                           re-asks the field; never silently counted ready.
--
-- 'persisted' (Stage 5's original terminal status) is left in the enum for
-- backward compatibility with any already-written row, but no code path
-- writes it going forward — 'linked' is its replacement, matching the
-- brief's own suggested RECEIVED_REFERENCE/STAGED/LINKED/FAILED vocabulary.
ALTER TYPE conversation_attachment_status ADD VALUE IF NOT EXISTS 'staged';
ALTER TYPE conversation_attachment_status ADD VALUE IF NOT EXISTS 'linked';

-- Where the validated binary durably lives before (and, until copied, even
-- after) promotion — reuses the existing request-attachments bucket under a
-- `staging/<org>/<conversation>/...` prefix (Part 3's "prefer existing
-- storage infrastructure" instruction) rather than a new bucket. NULL until
-- staging succeeds.
ALTER TABLE conversation_attachments ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- The confirmed MIME type after magic-byte validation (may be read back
-- without re-inspecting the binary) and the confirmed byte size — both NULL
-- until staging succeeds. Kept separate from the transport-declared
-- mime_type/size columns (attacker-influenced, never trusted alone).
ALTER TABLE conversation_attachments ADD COLUMN IF NOT EXISTS staged_mime_type TEXT;
ALTER TABLE conversation_attachments ADD COLUMN IF NOT EXISTS staged_size BIGINT;

-- Why staging or promotion last failed — for the audit trail / manual
-- reconciliation Part 3 requires ("recoverable staged media... enough
-- persisted information for later reconciliation"), never a raw
-- transport payload.
ALTER TABLE conversation_attachments ADD COLUMN IF NOT EXISTS last_error TEXT;

NOTIFY pgrst, 'reload schema';
