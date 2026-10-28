-- When an admin changes a person's sign-in e-mail, every copy of the old address kept elsewhere in the organisation's data must
-- become the new one, so nothing keeps pointing at an address the person no longer has. This function does it in one step and says
-- how many rows it changed in each place:
--   OEM contact lists and OEM e-mail templates, a technician group's notification address, scheduled-report recipients,
--   e-mail conversation participants, e-mail replies received from an outsider (comments), DeskTime logs, and the rules
--   (business rules, escalation policies) that mention the address.
-- Records of what happened (the admin audit log, the inbound-mail log, a ticket's original source) are history and are not rewritten.
-- Only the server (service_role) can call it.

-- Replace one address inside a list of addresses (matching ignores capitals), without leaving the new one twice, keeping the order.
CREATE OR REPLACE FUNCTION replace_email_in_list(p_list text[], p_old text, p_new text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(e ORDER BY first_pos), '{}'::text[])
  FROM (
    SELECT e, min(pos) AS first_pos
    FROM (
      SELECT CASE WHEN lower(x) = lower(p_old) THEN p_new ELSE x END AS e, pos
      FROM unnest(p_list) WITH ORDINALITY AS t(x, pos)
    ) mapped
    GROUP BY e
  ) dedup
$$;

CREATE OR REPLACE FUNCTION replace_user_email(p_org_id uuid, p_old text, p_new text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := lower(btrim(p_old));
  v_new text := lower(btrim(p_new));
  -- the old address as a pattern (its dots and so on are plain characters) and the new one as a replacement (no backslashes)
  v_pat text;
  v_rep text;
  v_counts jsonb := '{}'::jsonb;
  n integer;
BEGIN
  IF v_old = '' OR v_new = '' OR v_old = v_new THEN
    RAISE EXCEPTION 'replace_user_email: both addresses are needed and they must differ';
  END IF;
  v_pat := regexp_replace(v_old, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g');
  v_rep := replace(v_new, '\', '\\');

  -- OEM contact lists and templates
  UPDATE oems SET
    emails = replace_email_in_list(emails, v_old, v_new),
    email_subject_template = CASE WHEN email_subject_template ~* v_pat THEN regexp_replace(email_subject_template, v_pat, v_rep, 'gi') ELSE email_subject_template END,
    email_body_template = CASE WHEN email_body_template ~* v_pat THEN regexp_replace(email_body_template, v_pat, v_rep, 'gi') ELSE email_body_template END
  WHERE org_id = p_org_id
    AND (EXISTS (SELECT 1 FROM unnest(emails) x WHERE lower(x) = v_old) OR email_subject_template ~* v_pat OR email_body_template ~* v_pat);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('oems', n);

  -- a technician group's notification address
  UPDATE teams SET notification_email = v_new WHERE org_id = p_org_id AND lower(notification_email) = v_old;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('teams', n);

  -- scheduled report recipients
  UPDATE scheduled_reports SET recipients = replace_email_in_list(recipients, v_old, v_new)
  WHERE org_id = p_org_id AND EXISTS (SELECT 1 FROM unnest(recipients) x WHERE lower(x) = v_old);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('scheduled_reports', n);

  -- e-mail conversations the person takes part in
  UPDATE intake_threads SET participant_emails = replace_email_in_list(participant_emails, v_old, v_new)
  WHERE org_id = p_org_id AND EXISTS (SELECT 1 FROM unnest(participant_emails) x WHERE lower(x) = v_old);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('intake_threads', n);

  -- replies that arrived by e-mail from this address before it was linked to the person
  UPDATE request_comments c SET external_email = v_new
  FROM requests r
  WHERE r.id = c.request_id AND r.org_id = p_org_id AND lower(c.external_email) = v_old;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('request_comments', n);

  -- DeskTime logs are matched to people by e-mail
  UPDATE desktime_time_logs SET member_email = v_new WHERE org_id = p_org_id AND lower(member_email) = v_old;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('desktime_time_logs', n);
  UPDATE desktime_app_logs SET member_email = v_new WHERE org_id = p_org_id AND lower(member_email) = v_old;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('desktime_app_logs', n);

  -- rules that mention the address (the new address is checked by the caller to hold no characters that are special in JSON)
  UPDATE business_rules SET
    conditions = CASE WHEN conditions::text ~* v_pat THEN regexp_replace(conditions::text, v_pat, v_rep, 'gi')::jsonb ELSE conditions END,
    actions = CASE WHEN actions::text ~* v_pat THEN regexp_replace(actions::text, v_pat, v_rep, 'gi')::jsonb ELSE actions END
  WHERE org_id = p_org_id AND (conditions::text ~* v_pat OR actions::text ~* v_pat);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('business_rules', n);

  UPDATE escalation_policies SET rules = regexp_replace(rules::text, v_pat, v_rep, 'gi')::jsonb
  WHERE org_id = p_org_id AND rules::text ~* v_pat;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('escalation_policies', n);

  RETURN v_counts;
END;
$$;

REVOKE ALL ON FUNCTION replace_email_in_list(text[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION replace_user_email(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_email_in_list(text[], text, text) TO service_role;
GRANT EXECUTE ON FUNCTION replace_user_email(uuid, text, text) TO service_role;
