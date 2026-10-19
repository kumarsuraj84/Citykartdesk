-- OEM by type (LOCAL; separate release, after the security release 164-171). Rollback: supabase/rollback/172_oem_by_type_rollback.sql
--
-- Until now a store had ONE OEM (stores.oem_id) and that was the AC OEM. A store can now have one OEM of each TYPE:
--   * every OEM has a type, "ac" or "genset" (all existing OEMs become "ac": nothing changes for them);
--   * a store has exactly one slot per type: stores.oem_id = its AC OEM (unchanged), stores.genset_oem_id = its Genset OEM (new);
--   * the database refuses an OEM of the wrong type in a slot, so a store can never have two AC OEMs or a Genset OEM in the AC slot;
--   * a category can say "send tickets of this category to the store's OEM of type X" (service_categories.auto_oem_kind).
-- No existing row changes. No data is created.

BEGIN;

ALTER TABLE public.oems ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'ac';
ALTER TABLE public.oems DROP CONSTRAINT IF EXISTS oems_kind_check;
ALTER TABLE public.oems ADD CONSTRAINT oems_kind_check CHECK (kind IN ('ac', 'genset'));

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS genset_oem_id uuid REFERENCES public.oems(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stores_genset_oem ON public.stores (genset_oem_id) WHERE genset_oem_id IS NOT NULL;

ALTER TABLE public.service_categories ADD COLUMN IF NOT EXISTS auto_oem_kind text;
ALTER TABLE public.service_categories DROP CONSTRAINT IF EXISTS service_categories_auto_oem_kind_check;
ALTER TABLE public.service_categories ADD CONSTRAINT service_categories_auto_oem_kind_check CHECK (auto_oem_kind IS NULL OR auto_oem_kind IN ('ac', 'genset'));

-- A store's AC slot takes only an OEM of type "ac", its Genset slot only one of type "genset", and both must belong to the store's own organisation.
CREATE OR REPLACE FUNCTION public.stores_oem_kind_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text;
  v_org uuid;
BEGIN
  IF NEW.oem_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.oem_id IS DISTINCT FROM OLD.oem_id) THEN
    SELECT kind, org_id INTO v_kind, v_org FROM public.oems WHERE id = NEW.oem_id;
    IF v_kind IS DISTINCT FROM 'ac' THEN
      RAISE EXCEPTION 'The AC OEM of a store must be an OEM of type AC.' USING ERRCODE = '23514';
    END IF;
    IF v_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'The OEM belongs to another organisation.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.genset_oem_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.genset_oem_id IS DISTINCT FROM OLD.genset_oem_id) THEN
    SELECT kind, org_id INTO v_kind, v_org FROM public.oems WHERE id = NEW.genset_oem_id;
    IF v_kind IS DISTINCT FROM 'genset' THEN
      RAISE EXCEPTION 'The Genset OEM of a store must be an OEM of type Genset.' USING ERRCODE = '23514';
    END IF;
    IF v_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'The OEM belongs to another organisation.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stores_oem_kind_guard ON public.stores;
CREATE TRIGGER trg_stores_oem_kind_guard BEFORE INSERT OR UPDATE OF oem_id, genset_oem_id ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.stores_oem_kind_guard();

-- An OEM that is mapped to stores cannot change type (the stores would then hold an OEM of the wrong type).
CREATE OR REPLACE FUNCTION public.oems_kind_change_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     AND EXISTS (SELECT 1 FROM public.stores s WHERE s.oem_id = OLD.id OR s.genset_oem_id = OLD.id) THEN
    RAISE EXCEPTION 'Remove this OEM from its stores before changing its type.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_oems_kind_change_guard ON public.oems;
CREATE TRIGGER trg_oems_kind_change_guard BEFORE UPDATE OF kind ON public.oems
  FOR EACH ROW EXECUTE FUNCTION public.oems_kind_change_guard();

-- The guard functions are trigger functions only; nobody calls them directly.
REVOKE ALL ON FUNCTION public.stores_oem_kind_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oems_kind_change_guard() FROM PUBLIC, anon, authenticated;

COMMIT;
