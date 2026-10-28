-- Fix missing write grants on `services` and `service_categories`.
--
-- `20240101000000_initial_schema.sql` granted `authenticated` only SELECT on
-- these two tables ("GRANT SELECT ON departments, teams, service_categories,
-- services TO authenticated") — INSERT/UPDATE/DELETE were never granted.
-- Postgres checks table-level GRANTs before RLS is ever evaluated, so every
-- admin action that writes through the RLS-respecting client (createService,
-- updateService, archiveService, deleteService, createCategory, updateCategory,
-- toggleCategoryActive, deleteCategory — all in lib/actions/admin/services.ts
-- and lib/actions/admin/categories.ts) has been failing with "permission
-- denied for table services" / "...service_categories", regardless of role,
-- since this table was created. The `services_admin` / `categories_admin` RLS
-- policies already correctly scope writes to admin/manager/platform_owner —
-- this migration only unblocks the Postgres-level precondition for those
-- policies to run at all.
--
-- `service_sub_categories` already has `GRANT ALL ... TO authenticated`
-- (20240101000005_sub_categories.sql), so it isn't affected.

GRANT INSERT, UPDATE, DELETE ON services           TO authenticated;
GRANT INSERT, UPDATE, DELETE ON service_categories TO authenticated;
