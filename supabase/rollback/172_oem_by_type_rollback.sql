-- Rollback of 20240101000172_oem_by_type.sql.
-- DATA NOTE: dropping the columns removes the Genset OEM mappings of stores, the OEM types and the category settings made after the migration. The AC mapping
-- (stores.oem_id) is untouched. Take a note of the Genset mappings first if they must be kept.
BEGIN;
DROP TRIGGER IF EXISTS trg_stores_oem_kind_guard ON public.stores;
DROP TRIGGER IF EXISTS trg_oems_kind_change_guard ON public.oems;
DROP FUNCTION IF EXISTS public.stores_oem_kind_guard();
DROP FUNCTION IF EXISTS public.oems_kind_change_guard();
ALTER TABLE public.service_categories DROP CONSTRAINT IF EXISTS service_categories_auto_oem_kind_check;
ALTER TABLE public.service_categories DROP COLUMN IF EXISTS auto_oem_kind;
DROP INDEX IF EXISTS public.idx_stores_genset_oem;
ALTER TABLE public.stores DROP COLUMN IF EXISTS genset_oem_id;
ALTER TABLE public.oems DROP CONSTRAINT IF EXISTS oems_kind_check;
ALTER TABLE public.oems DROP COLUMN IF EXISTS kind;
DELETE FROM auth.schema_migrations WHERE version = '20240101000172';
COMMIT;
