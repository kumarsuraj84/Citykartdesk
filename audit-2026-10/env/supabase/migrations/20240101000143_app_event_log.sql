-- Application event log: what each signed-in user did and what went wrong, kept for 90 days.
-- Written by the app server only (service_role); read only from Admin > Event Log.
-- Records page views, clicks (label of the button/link only — never typed text or form
-- values), browser errors and server-side failures, so problems can be traced afterwards.

CREATE TABLE app_event_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id      UUID,
  user_id     UUID,
  session_id  TEXT,
  kind        TEXT        NOT NULL CHECK (kind IN ('pageview', 'click', 'js_error', 'render_error', 'server_error', 'system')),
  path        TEXT,
  target      TEXT,
  message     TEXT,
  detail      JSONB,
  user_agent  TEXT
);

CREATE INDEX app_event_log_created_idx ON app_event_log (created_at DESC);
CREATE INDEX app_event_log_user_idx    ON app_event_log (user_id, created_at DESC);
CREATE INDEX app_event_log_kind_idx    ON app_event_log (kind, created_at DESC);

ALTER TABLE app_event_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_event_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_event_log TO service_role;

-- Retention: called by the scheduled alerts job; default 90 days.
CREATE OR REPLACE FUNCTION purge_app_event_log(p_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM app_event_log WHERE created_at < now() - make_interval(days => GREATEST(p_days, 1));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION purge_app_event_log(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_app_event_log(INTEGER) TO service_role;

-- Make PostgREST pick up the new table immediately (otherwise inserts fail until it restarts).
NOTIFY pgrst, 'reload schema';
