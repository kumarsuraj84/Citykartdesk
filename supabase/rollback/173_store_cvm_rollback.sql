-- Rollback of 20240101000173_store_cvm.sql. DATA NOTE: dropping the column removes the CVM tags of the stores made after the migration (note them first if needed).
BEGIN;
DROP TRIGGER IF EXISTS trg_stores_cvm_guard ON public.stores;
DROP FUNCTION IF EXISTS public.stores_cvm_guard();
DROP INDEX IF EXISTS public.idx_stores_cvm;
ALTER TABLE public.stores DROP COLUMN IF EXISTS cvm_id;
DELETE FROM auth.schema_migrations WHERE version = '20240101000173';
COMMIT;
