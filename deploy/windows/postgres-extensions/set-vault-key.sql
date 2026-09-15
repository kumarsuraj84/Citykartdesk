CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE k text;
BEGIN
  k := encode(gen_random_bytes(32), 'hex');
  EXECUTE format('ALTER DATABASE citykart_desk SET app.vault_key = %L', k);
END $$;
