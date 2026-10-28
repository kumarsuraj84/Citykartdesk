-- D-17: oems_select and notification_rules_select had no role gate at all
-- (org_id = current_org_id() only) — any authenticated org member, including
-- a plain 'user'/requester, could read the full OEM vendor email list
-- (emails, email templates) and the org's internal escalation/alert
-- notification_rules configuration directly via the REST API, even though
-- no UI ever exposes either to that role and every write to both tables is
-- already admin/manager/platform_owner-only (oems_admin/notification_rules_admin,
-- migrations 128/129/131). Neither table has any plausible end-user read
-- case — this is vendor-sensitive/administrative configuration, not
-- something a requester or agent legitimately needs.
--
-- stores_select is deliberately NOT touched here: a requester's own store
-- address is used for form auto-fill (see the store_address field type),
-- so unlike oems/notification_rules there's a plausible legitimate
-- end-user read case there — narrowing it needs a product-intent
-- confirmation first, not a blanket lock (see the D-17 remediation report).

DROP POLICY "oems_select" ON oems;
CREATE POLICY "oems_select" ON oems FOR SELECT USING (
  org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner')
);

DROP POLICY "notification_rules_select" ON notification_rules;
CREATE POLICY "notification_rules_select" ON notification_rules FOR SELECT USING (
  org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner')
);
