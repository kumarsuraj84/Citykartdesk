-- service_categories_slug_key was UNIQUE(slug) with no org_id — a *global*
-- constraint in a multi-tenant table. Two different orgs both naming a
-- category "Hardware" collide even though RLS (categories_select: org_id =
-- current_org_id()) hides the other org's row from each other, so the
-- second org's admin sees createCategory()'s slug pre-check report no
-- conflict, then the insert fails anyway with no visible cause. Scoping the
-- constraint to (org_id, slug) fixes the cross-tenant collision while still
-- fully closing the same-org TOCTOU race (two concurrent creates of the same
-- name within one org) the way the global constraint always did.
ALTER TABLE service_categories DROP CONSTRAINT service_categories_slug_key;
ALTER TABLE service_categories ADD CONSTRAINT service_categories_org_id_slug_key UNIQUE (org_id, slug);
