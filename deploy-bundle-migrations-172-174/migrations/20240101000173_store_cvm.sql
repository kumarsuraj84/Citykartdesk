-- Store CVM (LOCAL; separate release, after 164-172). Rollback: supabase/rollback/173_store_cvm_rollback.sql
--
-- Every store can be tagged with ONE CVM (Citykart's own name for the person who approves for that store). One CVM can look after many stores (10-15).
-- stores.cvm_id points at an existing CKDesk user. The database refuses a CVM who is not an active staff member (technician, manager, admin, owner) of the
-- store's own organisation. It is used to pre-fill the approver when a technician sends a ticket of that store for approval; the technician can still change it.
-- No existing row changes. No data is created.

BEGIN;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS cvm_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stores_cvm ON public.stores (cvm_id) WHERE cvm_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.stores_cvm_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_role text;
  v_active boolean;
BEGIN
  IF NEW.cvm_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.cvm_id IS DISTINCT FROM OLD.cvm_id) THEN
    SELECT org_id, role::text, is_active INTO v_org, v_role, v_active FROM public.profiles WHERE id = NEW.cvm_id;
    IF v_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'The CVM must be a user of the store''s own organisation.' USING ERRCODE = '23514';
    END IF;
    IF v_active IS NOT TRUE THEN
      RAISE EXCEPTION 'The CVM must be an active user.' USING ERRCODE = '23514';
    END IF;
    IF v_role NOT IN ('agent', 'manager', 'admin', 'platform_owner') THEN
      RAISE EXCEPTION 'The CVM must be a staff member (technician, manager or admin), not a requester.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stores_cvm_guard ON public.stores;
CREATE TRIGGER trg_stores_cvm_guard BEFORE INSERT OR UPDATE OF cvm_id ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.stores_cvm_guard();

REVOKE ALL ON FUNCTION public.stores_cvm_guard() FROM PUBLIC, anon, authenticated;

COMMIT;
