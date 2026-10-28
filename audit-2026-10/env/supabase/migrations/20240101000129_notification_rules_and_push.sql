-- Org-configurable notification rules (email / in-app / push per event type —
-- the admin-facing "Notification Rules" screen, modeled loosely on Zoho
-- Desk's matrix but scoped to the events this app actually fires) plus the
-- storage needed for real browser push delivery (Web Push / VAPID).
--
-- notify() (lib/notifications.ts) treats a missing (org_id, event_type) row
-- as "every channel on" — this table only lets an admin dial things DOWN
-- from today's always-on behavior, so rollout is non-breaking.

CREATE TABLE notification_rules (
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  email      BOOLEAN NOT NULL DEFAULT true,
  in_app     BOOLEAN NOT NULL DEFAULT true,
  push       BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, event_type)
);

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_rules_select" ON notification_rules
  FOR SELECT USING (org_id = current_org_id());

CREATE POLICY "notification_rules_admin" ON notification_rules
  FOR ALL USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager'));

GRANT SELECT ON notification_rules TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_rules TO authenticated;
GRANT ALL ON notification_rules TO service_role;

-- One row per browser/device a user has granted push permission on — a user
-- can have several (phone + laptop). endpoint is the push service's unique
-- delivery URL, so it doubles as the natural de-dupe key.
CREATE TABLE push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subscriptions_own" ON push_subscriptions
  FOR ALL USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;
GRANT ALL ON push_subscriptions TO service_role;
