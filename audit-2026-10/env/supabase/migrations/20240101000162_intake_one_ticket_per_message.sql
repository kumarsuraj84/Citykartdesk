-- D-045: one e-mail makes at most one ticket. The existing index on requests.intake_message_id is not unique, so two reviewers converting the same
-- message at the same moment could each create a ticket. This makes it unique, BUT ONLY WHEN THE DATA ALLOWS IT: if a message already has more than
-- one ticket (the very duplicates this guards against), nothing is changed and a notice says how many messages are affected, so that no migration
-- ever fails or deletes anything because of old data. The application also checks before creating (lib/actions/intake/work.ts), so the
-- protection works either way; the index closes the last tiny race.

DO $$
DECLARE
  dup_messages integer;
BEGIN
  SELECT count(*) INTO dup_messages FROM (
    SELECT intake_message_id FROM public.requests WHERE intake_message_id IS NOT NULL GROUP BY intake_message_id HAVING count(*) > 1
  ) d;

  IF dup_messages > 0 THEN
    RAISE NOTICE 'requests_one_per_intake_message NOT created: % intake message(s) already have more than one ticket. Review them, then create the index by hand: CREATE UNIQUE INDEX requests_one_per_intake_message ON public.requests (intake_message_id) WHERE intake_message_id IS NOT NULL;', dup_messages;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS requests_one_per_intake_message ON public.requests (intake_message_id) WHERE intake_message_id IS NOT NULL;
  END IF;
END $$;
