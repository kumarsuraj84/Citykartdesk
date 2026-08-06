-- ============================================================
-- MIGRATION: Attachment Security Hardening
-- ============================================================

-- Enforce file size limit at storage level (25MB)
-- Note: Supabase storage policies use file_size_limit option on bucket, not RLS
-- This migration documents the bucket config that should be applied via Supabase dashboard:
-- request-attachments bucket: file_size_limit = 26214400 (25MB), allowed_mime_types per ALLOWED_MIME_TYPES above

UPDATE storage.buckets
SET
  file_size_limit = 26214400,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav'
  ]
WHERE id = 'request-attachments';

-- Update the file_size constraint on the request_attachments table to match new 25MB limit
ALTER TABLE request_attachments
  DROP CONSTRAINT IF EXISTS request_attachments_file_size_check;

ALTER TABLE request_attachments
  ADD CONSTRAINT request_attachments_file_size_check
  CHECK (file_size > 0 AND file_size <= 26214400);

-- Ensure download is restricted to authenticated users only
DROP POLICY IF EXISTS "Authenticated users can view attachments" ON storage.objects;
CREATE POLICY "Authenticated download only" ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'request-attachments');

-- Service role only for insert (already set in migration 16, but ensure it)
DROP POLICY IF EXISTS "Service role only upload" ON storage.objects;
CREATE POLICY "Service role only upload v2" ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'request-attachments');
