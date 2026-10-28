-- Task attachments: store files attached to tasks/comments

CREATE TABLE task_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by  UUID NOT NULL REFERENCES profiles(id),
  file_name    TEXT NOT NULL,
  file_size    BIGINT NOT NULL,
  mime_type    TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- Visible to: task assignee, task creator, team members, managers, admins
CREATE POLICY "task_attachments_select" ON task_attachments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_id
    AND (
      t.created_by = auth.uid()
      OR t.assignee_id = auth.uid()
      OR current_user_role() IN ('manager', 'admin')
      OR (t.team_id IS NOT NULL AND is_team_member(t.team_id))
    )
  )
);

-- Upload: anyone who can see the task
CREATE POLICY "task_attachments_insert" ON task_attachments FOR INSERT WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_id
    AND (
      t.created_by = auth.uid()
      OR t.assignee_id = auth.uid()
      OR current_user_role() IN ('manager', 'admin')
      OR (t.team_id IS NOT NULL AND is_team_member(t.team_id))
    )
  )
);

-- Delete: uploader, manager, admin
CREATE POLICY "task_attachments_delete" ON task_attachments FOR DELETE USING (
  uploaded_by = auth.uid()
  OR current_user_role() IN ('manager', 'admin')
);

-- Storage bucket for task attachments (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  false,
  26214400, -- 25 MB
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv',
    'application/zip','application/x-zip-compressed',
    'video/mp4'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS on storage objects
CREATE POLICY "task_attach_storage_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'task-attachments' AND auth.role() = 'authenticated');

CREATE POLICY "task_attach_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'task-attachments' AND auth.role() = 'authenticated');

CREATE POLICY "task_attach_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'task-attachments' AND auth.role() = 'authenticated');
