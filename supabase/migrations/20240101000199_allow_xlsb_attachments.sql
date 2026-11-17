-- Excel binary workbooks (.xlsb) are allowed as attachments (owner's decision of 2026-11-17; Zoho tickets carry them).
-- The application's own list (lib/attachments/validate.ts) already allows the type and still refuses a workbook that carries a macro project;
-- the storage buckets keep a list of their own, so the type is added there too. Browsers and Zoho label it in lower case, so both spellings are added.
-- Safe to run twice. A bucket that has no list at all (anything goes) is left alone. Already applied by hand on the live server on 2026-11-17.
DO $$
DECLARE
  b text;
  t text;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  FOREACH b IN ARRAY ARRAY['request-attachments', 'task-attachments', 'intake-attachments'] LOOP
    FOREACH t IN ARRAY ARRAY['application/vnd.ms-excel.sheet.binary.macroEnabled.12', 'application/vnd.ms-excel.sheet.binary.macroenabled.12'] LOOP
      UPDATE storage.buckets SET allowed_mime_types = array_append(allowed_mime_types, t)
       WHERE id = b AND allowed_mime_types IS NOT NULL AND NOT (t = ANY (allowed_mime_types));
    END LOOP;
  END LOOP;
END $$;
