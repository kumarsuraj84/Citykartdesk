-- A category (via its sub-categories) belongs to exactly one Service,
-- permanently, once tagged — e.g. a "Fire" category tagged to the Admin
-- service can never also be tagged to Legal or BD. The admin UI already
-- enforced this client-side (ServicesAdminClient.tsx's `takenBy` check
-- disables an already-tagged sub-category), but nothing stopped a direct
-- write from creating a conflict. This makes it a real guarantee.
ALTER TABLE service_sub_category_tags
  ADD CONSTRAINT service_sub_category_tags_sub_category_id_key UNIQUE (sub_category_id);
