-- 189: Services - a service with NO location ticked is now shown to NO requester (before: to every requester). Data only, additive (no column or table changes).
-- So that nothing changes for anyone on the day of this release, every service that has no location ticked today gets every active location of its organisation
-- ticked (Head Office and Stores), EXCEPT a service that carries an AC PMS category: that one stays unticked on purpose, so only administrators and platform owners see it.
-- A service an administrator leaves unticked from now on is hidden from requesters until a location is ticked; technicians, managers and administrators always see every service.
BEGIN;

INSERT INTO public.service_location_tags (service_id, location_id)
SELECT s.id, l.id
FROM public.services s
JOIN public.locations l ON l.org_id = s.org_id AND l.is_active = true
WHERE NOT EXISTS (SELECT 1 FROM public.service_location_tags t WHERE t.service_id = s.id)
  AND NOT EXISTS (
    SELECT 1
    FROM public.service_sub_category_tags st
    JOIN public.service_sub_categories sc ON sc.id = st.sub_category_id
    JOIN public.service_categories c ON c.id = sc.category_id
    WHERE st.service_id = s.id AND c.is_pms = true
  )
ON CONFLICT DO NOTHING;

COMMIT;
