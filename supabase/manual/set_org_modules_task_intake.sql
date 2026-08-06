-- One-time: restrict a specific org to the Task + Intake modules only.
--
-- Disables the Request bundle (requests / approvals / services) and enables
-- Task + Intake. analytics / integrations / time_tracking are left enabled
-- (shared dashboards, no dedicated nav).
--
-- Edit the slug below to match your org, then run in the Supabase SQL editor
-- against the CognixDesk project (jhdzjzrimjjtqwnkrwha).
-- To find the slug:  select id, name, slug from organizations order by created_at desc;

do $$
declare
  v_org_id uuid;
  v_slug   text := 'suraj-and-co';   -- Suraj and Co.
begin
  select id into v_org_id from organizations where slug = v_slug;
  if v_org_id is null then
    raise exception 'No organization found with slug %', v_slug;
  end if;

  -- Upsert all eight module rows with the desired enabled state so the
  -- Licensing / Org Detail pages stay consistent.
  insert into org_module_access (org_id, module, enabled)
  select v_org_id, m.slug, m.enabled
  from (
    values
      ('requests'::module_slug,      false),
      ('approvals'::module_slug,     false),
      ('services'::module_slug,      false),
      ('tasks'::module_slug,         true),
      ('intake'::module_slug,        true),
      ('analytics'::module_slug,     true),
      ('integrations'::module_slug,  true),
      ('time_tracking'::module_slug, true)
  ) as m(slug, enabled)
  on conflict (org_id, module) do update set enabled = excluded.enabled;

  raise notice 'Org % set to Task + Intake only.', v_slug;
end $$;
