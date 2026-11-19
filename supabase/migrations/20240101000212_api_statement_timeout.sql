-- 212: a time limit of 20 seconds for every single database statement sent by signed-in people (role authenticated) and by anonymous visitors (role anon).
--
-- Why: on 19 Nov 2026 the ticket search read the text of every message (64,000+ messages) and one search kept the database busy for minutes. Searches piled up, used all
-- the connections of the data service and the whole system stalled (answers of up to 249 s, database CPU 76%). The search is fixed in the app, but nothing in the database
-- stopped a runaway statement: any future slow statement from a screen could do the same. With this limit such a statement is cancelled after 20 seconds (error 57014,
-- "canceling statement due to statement timeout") and frees its connection; the person sees an error and can try again.
--
-- What it does NOT limit: the server's own key (role service_role: scheduled jobs, the Zoho move, reports, e-mail sync), which keeps its current behaviour. The limit is per
-- statement, not per page: a page that makes many short statements is not affected. Checked against the real request times of the last day: nothing a person does needs
-- a single statement longer than a few seconds.
--
-- How it is applied: the data service (PostgREST) switches to the role of the signed-in person for each request and applies that role's settings. Tested for real on the local
-- stack (PostgREST 14.15): with this setting a 25 s statement as a signed-in user is cancelled at 20.0 s, a 3 s one is untouched, the server key is not limited. The setting must be
-- a plain role setting (a "... IN DATABASE ..." setting is stored but NOT picked up by the data service). The roles authenticated and anon belong to this application only.
-- No table, row, user or setting of the application is changed. Safe while the app is live; no restart is needed (the NOTIFYs below make the data service re-read it).
-- Undo any time:  ALTER ROLE authenticated RESET statement_timeout;  ALTER ROLE anon RESET statement_timeout;  NOTIFY pgrst, 'reload schema';  NOTIFY pgrst, 'reload config';

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r, '20s');
    END IF;
  END LOOP;
END $$;

-- The data service reads the settings of a role together with its table list ("schema cache"), so both are reloaded (about 0.2 s, requests are not interrupted).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
