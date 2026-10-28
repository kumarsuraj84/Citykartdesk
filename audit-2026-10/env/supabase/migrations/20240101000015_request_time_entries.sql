-- ── Request time entries (timer feature) ─────────────────────────────────────

CREATE TABLE request_time_entries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES profiles(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at  TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_time_entries_request ON request_time_entries(request_id);
CREATE INDEX idx_time_entries_user    ON request_time_entries(user_id);

ALTER TABLE request_time_entries ENABLE ROW LEVEL SECURITY;

-- Agents on the request's team can manage time entries
CREATE POLICY "time_entries_select" ON request_time_entries FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_id
    AND (
      r.requester_id = auth.uid()
      OR EXISTS (SELECT 1 FROM team_members WHERE team_id = r.team_id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
    )
  )
);

CREATE POLICY "time_entries_insert" ON request_time_entries FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_id
    AND (
      EXISTS (SELECT 1 FROM team_members WHERE team_id = r.team_id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
    )
  )
);

CREATE POLICY "time_entries_update" ON request_time_entries FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "time_entries_delete" ON request_time_entries FOR DELETE USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
);

GRANT ALL ON TABLE request_time_entries TO anon, authenticated, service_role;
