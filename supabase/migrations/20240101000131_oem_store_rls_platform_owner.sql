-- oems_admin/stores_admin (migration 128) omitted platform_owner, unlike
-- every sibling org-scoped table's admin policy and the app-layer
-- requireAdminOrManager() guard (which does include it). Not currently
-- exploitable — every store/OEM mutation goes through the admin client,
-- which bypasses RLS entirely — but wrong if a direct RLS-client write
-- path is ever added for a platform_owner.
DROP POLICY "oems_admin" ON oems;
CREATE POLICY "oems_admin" ON oems FOR ALL USING (org_id = current_org_id() AND current_user_role() IN ('admin','manager','platform_owner'));

DROP POLICY "stores_admin" ON stores;
CREATE POLICY "stores_admin" ON stores FOR ALL USING (org_id = current_org_id() AND current_user_role() IN ('admin','manager','platform_owner'));

-- Same gap, same fix, on notification_rules (migration 129).
DROP POLICY "notification_rules_admin" ON notification_rules;
CREATE POLICY "notification_rules_admin" ON notification_rules FOR ALL USING (org_id = current_org_id() AND current_user_role() IN ('admin','manager','platform_owner'));
