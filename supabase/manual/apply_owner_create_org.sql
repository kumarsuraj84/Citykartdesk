-- owner_create_org — create a Citykart Desk organization directly from the
-- operator portal's "New Organization" form.
--
-- The owner portal talks to this project with the ANON key (no per-user auth),
-- so all writes go through SECURITY DEFINER functions that bypass RLS — the
-- same pattern as owner_update_org / owner_update_org_billing /
-- owner_create_cognix_user. A plain INSERT from the anon client is rejected by
-- RLS (the original 401), which is why direct .insert() did not work.
--
-- Apply via the Supabase SQL editor (or `supabase db execute`) against the
-- Citykart Desk project (jhdzjzrimjjtqwnkrwha).

-- The signature changed (added p_modules), so drop the old overloads first to
-- avoid an ambiguous-function error at call time.
drop function if exists public.owner_create_org(text, text, integer, text, numeric, text);
drop function if exists public.owner_create_org(text, text, integer, text, numeric, text, text[]);

create or replace function public.owner_create_org(
  p_name          text,
  p_slug          text,
  p_seat_limit    integer default 10,
  p_billing_email text    default null,
  p_per_seat_rate numeric default 0,
  p_plan          text    default 'standard',
  -- High-level modules picked in the create form. Valid values: 'request',
  -- 'task', 'intake'. Defaults to all three (a full-feature org).
  p_modules       text[]  default array['request','task','intake']
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id  uuid;
  v_modules text[] := coalesce(p_modules, array['request','task','intake']);
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;
  if p_slug is null or length(trim(p_slug)) = 0 then
    raise exception 'slug is required';
  end if;

  insert into organizations (name, slug, status, seat_limit, billing_email, per_seat_rate, plan)
  values (
    p_name,
    p_slug,
    'active',
    coalesce(p_seat_limit, 10),
    p_billing_email,
    coalesce(p_per_seat_rate, 0),
    coalesce(p_plan, 'standard')
  )
  returning id into v_org_id;

  -- Map the operator's 3 high-level module choices to the fine-grained
  -- module_slug rows the app's gating actually reads (proxy.ts /
  -- has_module_access / getEnabledModules):
  --   request → requests, approvals, services
  --   task    → tasks
  --   intake  → intake
  -- analytics / integrations / time_tracking have no dedicated navigation and
  -- back shared dashboards, so they stay enabled regardless of the selection.
  --
  -- All eight rows are written every time (enabled = true/false) so the
  -- Licensing and Org Detail pages can toggle any module later.
  insert into org_module_access (org_id, module, enabled)
  select v_org_id, m.slug, m.enabled
  from (
    values
      ('requests'::module_slug,      'request' = any(v_modules)),
      ('approvals'::module_slug,     'request' = any(v_modules)),
      ('services'::module_slug,      'request' = any(v_modules)),
      ('tasks'::module_slug,         'task'    = any(v_modules)),
      ('intake'::module_slug,        'intake'  = any(v_modules)),
      ('analytics'::module_slug,     true),
      ('integrations'::module_slug,  true),
      ('time_tracking'::module_slug, true)
  ) as m(slug, enabled)
  on conflict (org_id, module) do update set enabled = excluded.enabled;

  return v_org_id;
end;
$$;

grant execute on function public.owner_create_org(text, text, integer, text, numeric, text, text[])
  to anon, authenticated;
