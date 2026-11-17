-- Removes the throw-away second organisation (and the rows the database created for it) from the DISPOSABLE audit database.
DO $$
DECLARE o uuid; r record;
BEGIN
  SELECT id INTO o FROM public.organizations WHERE slug = 'qa11-second-org';
  IF o IS NULL THEN RETURN; END IF;
  FOR r IN SELECT conrelid::regclass AS t, a.attname AS c FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1] WHERE k.contype = 'f' AND k.confrelid = 'public.organizations'::regclass LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', r.t, r.c) USING o;
  END LOOP;
  DELETE FROM public.organizations WHERE id = o;
END $$;
DELETE FROM auth.users WHERE email = 'qa11.org2@audit.test';
