// The permission matrix for company-wide configuration: WHO may change WHAT, in one table (VAPT-006/007/008/009/010).
// Before this, each admin action carried its own list of roles, the screens showed other things, and the database allowed yet another set. Now the server-side
// check of every configuration action reads this table, the database does not allow signed-in users to write these tables at all (migration 165), and the
// screens can ask the same table what to show.
//
// Four entries are business-policy questions that the approved design does not settle. Each has a DEFAULT equal to today's behaviour (nothing is taken away from
// anyone silently) and a switch the platform owner can change (Platform Settings > Who may change what). The alternatives are documented in
// security-assessment-2026-10/07-FINAL-REMEDIATION/09-OPEN-MANAGEMENT-DECISIONS.md.

export type Role = 'user' | 'agent' | 'manager' | 'admin' | 'platform_owner'

const ORDER: Role[] = ['user', 'agent', 'manager', 'admin', 'platform_owner']
export const roleAtLeast = (role: string, min: Role) => ORDER.indexOf(role as Role) >= ORDER.indexOf(min)

/** The switches (stored in app_settings as policy.<key>). The FIRST value of each list is the default = today's behaviour. */
export const POLICY_OPTIONS = {
  global_settings_write: ['manager_up', 'admin_up', 'owner_only'],
  business_rules_write: ['manager_up', 'admin_up'],
  workflow_edit: ['manager_up', 'admin_up'],
  intake_priority_override: ['allowed', 'denied'],
  // VAPT-052: may an administrator invite an address outside the organisation's own mail domain(s)? (default: yes, as today)
  external_invites: ['allowed', 'org_domains_only'],
  // VAPT-053: may a scheduled report go to an OEM contact kept in Master Data? (default: yes, as today)
  report_recipients: ['users_and_oem', 'users_only'],
} as const
export type PolicyKey = keyof typeof POLICY_OPTIONS
export type PolicyValues = { [K in PolicyKey]: (typeof POLICY_OPTIONS)[K][number] }
export const DEFAULT_POLICIES: PolicyValues = {
  global_settings_write: 'manager_up', business_rules_write: 'manager_up', workflow_edit: 'manager_up', intake_priority_override: 'allowed',
  external_invites: 'allowed', report_recipients: 'users_and_oem',
}

export const POLICY_LABELS: Record<PolicyKey, { title: string; help: string; options: Record<string, string> }> = {
  global_settings_write: {
    title: 'Company-wide settings (working hours, holidays, priorities, e-mail sender, auto-close, retention)',
    help: 'These change every ticket\'s deadlines and every system e-mail.',
    options: { manager_up: 'Managers, administrators and platform owners (today)', admin_up: 'Administrators and platform owners', owner_only: 'Platform owners only (as the database rule says)' },
  },
  business_rules_write: {
    title: 'Business Rules (automatic assignment, priority, status, notifications)',
    help: 'A rule can change priority, status and group of many tickets.',
    options: { manager_up: 'Managers, administrators and platform owners (today)', admin_up: 'Administrators and platform owners' },
  },
  workflow_edit: {
    title: 'Approval workflows and their steps',
    help: 'Whoever edits a step decides who approves.',
    options: { manager_up: 'Managers, administrators and platform owners (today)', admin_up: 'Administrators and platform owners' },
  },
  external_invites: {
    title: 'Inviting people whose e-mail address is not at the company\'s own mail domain',
    help: 'The invitation e-mail carries a sign-in link. The domain is taken from the company mailbox (and ORG_MAIL_DOMAINS, if set); if none is known nothing is refused.',
    options: { allowed: 'Any address may be invited (today)', org_domains_only: 'Only addresses at the company\'s own mail domain' },
  },
  report_recipients: {
    title: 'Who a scheduled report may be e-mailed to',
    help: 'Reports hold the organisation\'s tickets. A manager can add or change OEM contact addresses, so OEM contacts may or may not count.',
    options: { users_and_oem: 'Active users and OEM contacts (today)', users_only: 'Active users only' },
  },
  intake_priority_override: {
    title: 'Priority chosen by the reviewer when an e-mail becomes a ticket',
    help: 'Otherwise the priority comes from the sub-category and its SLA only.',
    options: { allowed: 'Reviewer may choose (today)', denied: 'Not allowed: priority comes from the sub-category' },
  },
}

export type Capability =
  | 'settings.global.write' | 'business_rules.write' | 'workflows.write' | 'intake.priority_override'
  | 'services.write' | 'sla_policies.write' | 'users.admin' | 'mailbox.write' | 'org_structure.write' | 'alert_rules.write' | 'task_config.write' | 'platform.policies.write'

type Entry = { description: string; roles: Role[] | ((p: PolicyValues) => Role[]); pending?: PolicyKey }

export const CAPABILITIES: Record<Capability, Entry> = {
  'settings.global.write': {
    description: 'Change company-wide settings', pending: 'global_settings_write',
    roles: (p) => (p.global_settings_write === 'owner_only' ? ['platform_owner'] : p.global_settings_write === 'admin_up' ? ['admin', 'platform_owner'] : ['manager', 'admin', 'platform_owner']),
  },
  'business_rules.write': { description: 'Create, change, switch on/off or delete Business Rules', pending: 'business_rules_write', roles: (p) => (p.business_rules_write === 'admin_up' ? ['admin', 'platform_owner'] : ['manager', 'admin', 'platform_owner']) },
  'workflows.write': { description: 'Edit approval workflows and steps', pending: 'workflow_edit', roles: (p) => (p.workflow_edit === 'admin_up' ? ['admin', 'platform_owner'] : ['manager', 'admin', 'platform_owner']) },
  'intake.priority_override': { description: 'Choose the priority when an e-mail becomes a ticket', pending: 'intake_priority_override', roles: (p) => (p.intake_priority_override === 'denied' ? [] : ['agent', 'manager', 'admin', 'platform_owner']) },
  'services.write': { description: 'Create or change services and SLA policies of services', roles: ['admin', 'platform_owner'] },
  'sla_policies.write': { description: 'Change SLA policies and SLA configuration', roles: ['admin', 'platform_owner'] },
  'users.admin': { description: 'Create users, change roles, passwords and activation', roles: ['admin', 'platform_owner'] },
  'mailbox.write': { description: 'Set the mailbox the system sends and reads mail with', roles: ['admin', 'platform_owner'] },
  'org_structure.write': { description: 'Maintain departments, locations, stores, OEMs', roles: ['manager', 'admin', 'platform_owner'] },
  'alert_rules.write': { description: 'Maintain alert / escalation rules', roles: ['manager', 'admin', 'platform_owner'] },
  'task_config.write': { description: 'Maintain task statuses, priorities and templates', roles: ['manager', 'admin', 'platform_owner'] },
  'platform.policies.write': { description: 'Change the switches in this table', roles: ['platform_owner'] },
}

export function rolesFor(capability: Capability, policies: PolicyValues = DEFAULT_POLICIES): Role[] {
  const r = CAPABILITIES[capability].roles
  return typeof r === 'function' ? r(policies) : r
}

export function can(role: string, capability: Capability, policies: PolicyValues = DEFAULT_POLICIES): boolean {
  return rolesFor(capability, policies).includes(role as Role)
}

/** The keys an administrator may change through updateAppSetting (everything else is refused), with a check of the value. Other settings have their own actions. */
export const APP_SETTING_RULES: Record<string, (value: string) => boolean> = {
  email_from_name: (v) => v.length >= 1 && v.length <= 80 && !/[\r\n<>]/.test(v),
  email_from_address: (v) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) && v.length <= 200,
  csat_enabled: (v) => v === 'true' || v === 'false',
  csat_reminder_days: (v) => /^\d{1,3}$/.test(v) && Number(v) <= 365,
  auto_close_days: (v) => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 365,
}
