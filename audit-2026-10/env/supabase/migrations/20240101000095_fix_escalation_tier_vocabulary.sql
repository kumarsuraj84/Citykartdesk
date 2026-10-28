-- sla_escalation_rules.tier was seeded with ('critical','high','medium','low'), but
-- requests.priority is the enum ('low','medium','high','urgent') — there is no
-- 'critical' priority and no 'urgent' tier. Runtime matching in
-- app/api/escalation/run/route.ts is a strict `rule.tier === request.priority`
-- string compare, so the seeded "Critical Warning" rule could never fire (no request
-- is ever priority 'critical'), and every 'urgent'-priority request — the highest
-- priority tier — silently got ZERO escalation coverage.
UPDATE sla_escalation_rules
  SET tier = 'urgent', name = 'Urgent Warning'
  WHERE tier = 'critical';

-- Lock the vocabulary to the actual priority enum going forward so this can't
-- silently drift again — mirrors app-level validation added in
-- lib/actions/admin/config.ts.
ALTER TABLE sla_escalation_rules
  ADD CONSTRAINT sla_escalation_rules_tier_check
  CHECK (tier IN ('low', 'medium', 'high', 'urgent'));

NOTIFY pgrst, 'reload schema';
