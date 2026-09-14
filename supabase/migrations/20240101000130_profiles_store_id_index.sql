-- Missing from migration 128 — every other FK it added got a covering
-- index (idx_stores_org, idx_stores_oem, idx_oems_org) except this one.
CREATE INDEX idx_profiles_store ON profiles(store_id) WHERE store_id IS NOT NULL;
