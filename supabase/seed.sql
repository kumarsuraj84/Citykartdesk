-- ============================================================
-- Citykart Desk — Seed Data (local development)
-- Single admin account only. No demo/onboarded users.
-- ============================================================

-- ============================================================
-- DEPARTMENTS
-- ============================================================
-- Migration 20240101000121 made org_id NOT NULL on this and several other
-- tables below with no default and no insert-time trigger — the old
-- "insert, then backfill org_id in bulk at the end" pattern (still present
-- further down for defense-in-depth) no longer works on its own, so org_id
-- is set directly on insert here too.
INSERT INTO departments (id, name, org_id) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Information Technology', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'Human Resources', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000003', 'Operations', '00000000-0000-0000-0000-000000000001');

-- ============================================================
-- TEAMS
-- ============================================================
INSERT INTO teams (id, name, slug, prefix, department_id, notification_email, is_active, org_id) VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    'IT Support',
    'it-support',
    'IT',
    '10000000-0000-0000-0000-000000000001',
    'it-support@citykart.org',
    true,
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'HR Operations',
    'hr-operations',
    'HR',
    '10000000-0000-0000-0000-000000000002',
    'hr@citykart.org',
    true,
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'Facilities',
    'facilities',
    'FAC',
    '10000000-0000-0000-0000-000000000003',
    'facilities@citykart.org',
    true,
    '00000000-0000-0000-0000-000000000001'
  );

-- ============================================================
-- ADMIN ACCOUNT
-- Trigger handle_new_user creates the profile automatically.
-- We then elevate the role to platform_owner (full access).
-- ============================================================
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES (
  '30000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'suraj@citykart.org',
  crypt('Password!!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Suraj"}',
  now(), now(),
  '', '', '', ''
);

UPDATE profiles SET role = 'platform_owner' WHERE id = '30000000-0000-0000-0000-000000000004';

-- ============================================================
-- SERVICE CATEGORIES
-- ============================================================
INSERT INTO service_categories (id, name, slug, icon, description, sort_order, is_active, org_id) VALUES
  ('40000000-0000-0000-0000-000000000001', 'Hardware',          'hardware',        '💻', 'Laptops, monitors, peripherals, and device repair.',             1, true, '00000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', 'Software & Access', 'software-access', '🔐', 'Software installation, system access, and license management.',  2, true, '00000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000003', 'People & HR',       'people-hr',       '👥', 'Onboarding, offboarding, benefits, and HR inquiries.',           3, true, '00000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000004', 'Facilities',        'facilities',      '🏢', 'Office supplies, building maintenance, and facility requests.',  4, true, '00000000-0000-0000-0000-000000000001');

-- ============================================================
-- APPROVAL WORKFLOWS
-- ============================================================
INSERT INTO approval_workflows (id, name, description, org_id) VALUES
  (
    '50000000-0000-0000-0000-000000000001',
    'Manager Approval',
    'Single-step approval by any manager',
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    'HR Manager Approval',
    'Single-step approval by any manager, used for HR requests',
    '00000000-0000-0000-0000-000000000001'
  );

INSERT INTO approval_workflow_steps (workflow_id, step_order, approver_type, approver_user_id) VALUES
  ('50000000-0000-0000-0000-000000000001', 1, 'any_manager', NULL),
  ('50000000-0000-0000-0000-000000000002', 1, 'any_manager', NULL);

-- ============================================================
-- SERVICES
-- ============================================================
-- Migration 20240101000109 dropped services.category_id entirely (category
-- became a submission-time field on the sub-category, not the service) and
-- also dropped sla_config (SLA now lives on service_sub_categories) —
-- neither is in this list. org_id (NOT NULL as of migration 121, no
-- insert-time default) is set directly here instead of relying only on the
-- later bulk backfill.
INSERT INTO services (
  id, name, slug, description, icon, keywords,
  team_id,
  form_fields, default_priority, approval_workflow_id,
  is_active, sort_order, org_id
) VALUES

-- Hardware: Laptop Request
(
  '60000000-0000-0000-0000-000000000001',
  'Laptop Request',
  'laptop-request',
  'Request a new laptop or replacement for your work.',
  '💻',
  ARRAY['laptop', 'computer', 'hardware', 'equipment', 'macbook', 'windows'],
  '20000000-0000-0000-0000-000000000001',
  '[
    {"id":"reason","type":"select","label":"Reason for request","required":true,"order":1,
     "options":[
       {"value":"new_hire","label":"New hire"},
       {"value":"replacement","label":"Replacement (broken/lost)"},
       {"value":"upgrade","label":"Upgrade request"}
     ]},
    {"id":"os_preference","type":"select","label":"Operating system preference","required":true,"order":2,
     "options":[
       {"value":"macos","label":"macOS"},
       {"value":"windows","label":"Windows"}
     ]},
    {"id":"additional_notes","type":"textarea","label":"Additional notes","required":false,"order":3,
     "placeholder":"Any specific requirements or context..."}
  ]'::jsonb,
  'medium',
  '50000000-0000-0000-0000-000000000001',
  true, 1, '00000000-0000-0000-0000-000000000001'
),

-- Hardware: Equipment Repair
(
  '60000000-0000-0000-0000-000000000002',
  'Equipment Repair',
  'equipment-repair',
  'Report a broken or malfunctioning device for repair.',
  '🔧',
  ARRAY['repair', 'broken', 'hardware', 'fix', 'monitor', 'keyboard', 'mouse'],
  '20000000-0000-0000-0000-000000000001',
  '[
    {"id":"device_type","type":"select","label":"Device type","required":true,"order":1,
     "options":[
       {"value":"laptop","label":"Laptop"},
       {"value":"monitor","label":"Monitor"},
       {"value":"keyboard","label":"Keyboard / Mouse"},
       {"value":"other","label":"Other peripheral"}
     ]},
    {"id":"issue_description","type":"textarea","label":"Describe the issue","required":true,"order":2,
     "placeholder":"What is wrong with the device?"},
    {"id":"asset_tag","type":"text","label":"Asset tag / Serial number","required":false,"order":3,
     "placeholder":"e.g. AST-00142"}
  ]'::jsonb,
  'high',
  NULL,
  true, 2, '00000000-0000-0000-0000-000000000001'
),

-- Software & Access: Software Installation
(
  '60000000-0000-0000-0000-000000000003',
  'Software Installation',
  'software-installation',
  'Request installation of software or tools on your device.',
  '📦',
  ARRAY['software', 'install', 'application', 'tool', 'license', 'app'],
  '20000000-0000-0000-0000-000000000001',
  '[
    {"id":"software_name","type":"text","label":"Software name","required":true,"order":1,
     "placeholder":"e.g. Adobe Acrobat, Slack, Figma"},
    {"id":"business_justification","type":"textarea","label":"Business justification","required":true,"order":2,
     "placeholder":"Why do you need this software?"},
    {"id":"urgency_reason","type":"textarea","label":"Urgency reason (if urgent)","required":false,"order":3,
     "placeholder":"Explain if this is blocking your work"}
  ]'::jsonb,
  'medium',
  NULL,
  true, 3, '00000000-0000-0000-0000-000000000001'
),

-- Software & Access: Access Request
(
  '60000000-0000-0000-0000-000000000004',
  'Access Request',
  'access-request',
  'Request access to systems, applications, or shared resources.',
  '🔑',
  ARRAY['access', 'permission', 'login', 'account', 'system', 'vpn', 'drive'],
  '20000000-0000-0000-0000-000000000001',
  '[
    {"id":"system_name","type":"text","label":"System or application","required":true,"order":1,
     "placeholder":"e.g. Salesforce, VPN, Google Drive folder"},
    {"id":"access_level","type":"select","label":"Access level needed","required":true,"order":2,
     "options":[
       {"value":"read","label":"Read only"},
       {"value":"read_write","label":"Read and write"},
       {"value":"admin","label":"Admin access"}
     ]},
    {"id":"justification","type":"textarea","label":"Justification","required":true,"order":3,
     "placeholder":"Why do you need this access?"},
    {"id":"manager_approved","type":"checkbox","label":"My manager has verbally approved this request","required":true,"order":4}
  ]'::jsonb,
  'medium',
  '50000000-0000-0000-0000-000000000001',
  true, 4, '00000000-0000-0000-0000-000000000001'
),

-- People & HR: New Employee Onboarding
(
  '60000000-0000-0000-0000-000000000005',
  'New Employee Onboarding',
  'new-employee-onboarding',
  'Submit onboarding requests for new team members joining the company.',
  '🎉',
  ARRAY['onboarding', 'new hire', 'employee', 'setup', 'start', 'joining'],
  '20000000-0000-0000-0000-000000000002',
  '[
    {"id":"employee_name","type":"text","label":"Employee full name","required":true,"order":1},
    {"id":"start_date","type":"date","label":"Start date","required":true,"order":2},
    {"id":"role_title","type":"text","label":"Job title","required":true,"order":3,
     "placeholder":"e.g. Software Engineer, Account Manager"},
    {"id":"department","type":"text","label":"Department","required":true,"order":4},
    {"id":"equipment_needed","type":"multiselect","label":"Equipment needed","required":true,"order":5,
     "options":[
       {"value":"laptop","label":"Laptop"},
       {"value":"monitor","label":"Monitor"},
       {"value":"phone","label":"Mobile phone"},
       {"value":"access_card","label":"Access card"}
     ]},
    {"id":"notes","type":"textarea","label":"Additional notes","required":false,"order":6,
     "placeholder":"Any special requirements or notes for this hire"}
  ]'::jsonb,
  'high',
  '50000000-0000-0000-0000-000000000002',
  true, 5, '00000000-0000-0000-0000-000000000001'
),

-- People & HR: General HR Inquiry
(
  '60000000-0000-0000-0000-000000000006',
  'HR General Inquiry',
  'hr-general-inquiry',
  'Ask HR a question or request information about policies, benefits, or payroll.',
  '❓',
  ARRAY['hr', 'policy', 'payroll', 'benefits', 'leave', 'vacation', 'question'],
  '20000000-0000-0000-0000-000000000002',
  '[
    {"id":"topic","type":"select","label":"Topic","required":true,"order":1,
     "options":[
       {"value":"payroll","label":"Payroll & compensation"},
       {"value":"benefits","label":"Benefits & insurance"},
       {"value":"leave","label":"Leave & time off"},
       {"value":"policy","label":"Company policy"},
       {"value":"other","label":"Other"}
     ]},
    {"id":"details","type":"textarea","label":"Your question or request","required":true,"order":2,
     "placeholder":"Please describe your inquiry in detail"}
  ]'::jsonb,
  'low',
  NULL,
  true, 6, '00000000-0000-0000-0000-000000000001'
),

-- Facilities: Office Supplies
(
  '60000000-0000-0000-0000-000000000007',
  'Office Supplies',
  'office-supplies',
  'Request office supplies, stationery, or consumables.',
  '✏️',
  ARRAY['supplies', 'stationery', 'office', 'paper', 'pen', 'desk'],
  '20000000-0000-0000-0000-000000000003',
  '[
    {"id":"items","type":"textarea","label":"Items requested","required":true,"order":1,
     "placeholder":"List the items you need, e.g. 2x notebooks, 1 box of pens"},
    {"id":"delivery_location","type":"text","label":"Delivery location / desk","required":true,"order":2,
     "placeholder":"e.g. Floor 3, Desk 14B"}
  ]'::jsonb,
  'low',
  NULL,
  true, 7, '00000000-0000-0000-0000-000000000001'
),

-- Facilities: Maintenance Request
(
  '60000000-0000-0000-0000-000000000008',
  'Maintenance Request',
  'maintenance-request',
  'Report a facilities issue such as lighting, HVAC, plumbing, or cleaning.',
  '🔨',
  ARRAY['maintenance', 'repair', 'facilities', 'hvac', 'plumbing', 'cleaning', 'building'],
  '20000000-0000-0000-0000-000000000003',
  '[
    {"id":"issue_type","type":"select","label":"Issue type","required":true,"order":1,
     "options":[
       {"value":"lighting","label":"Lighting"},
       {"value":"hvac","label":"Heating / Cooling (HVAC)"},
       {"value":"plumbing","label":"Plumbing"},
       {"value":"cleaning","label":"Cleaning"},
       {"value":"security","label":"Security / Access"},
       {"value":"other","label":"Other"}
     ]},
    {"id":"location","type":"text","label":"Location","required":true,"order":2,
     "placeholder":"e.g. Floor 2 bathroom, Meeting room B"},
    {"id":"description","type":"textarea","label":"Describe the issue","required":true,"order":3,
     "placeholder":"What is the problem? When did it start?"},
    {"id":"safety_hazard","type":"checkbox","label":"This is a safety hazard","required":false,"order":4}
  ]'::jsonb,
  'medium',
  NULL,
  true, 8, '00000000-0000-0000-0000-000000000001'
);

-- ============================================================
-- SERVICE SUB-CATEGORIES
-- ============================================================
INSERT INTO service_sub_categories (id, category_id, name, slug, description, icon, sort_order, is_active) VALUES
  -- Hardware
  ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   'Computers & Laptops',    'computers-laptops',    'New laptops, desktop computers, and replacements.',          '💻', 1, true),
  ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001',
   'Peripherals & Repair',   'peripherals-repair',   'Monitors, keyboards, mice, and device repair.',             '🔧', 2, true),
  -- Software & Access
  ('70000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002',
   'Software Installation',  'software-installation','Install applications, tools, and development environments.', '📦', 1, true),
  ('70000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002',
   'Access & Permissions',   'access-permissions',   'System access, VPN, shared drives, and account setup.',     '🔑', 2, true),
  -- People & HR
  ('70000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000003',
   'Onboarding',             'onboarding',           'New hire setup, equipment, and system access.',             '🎉', 1, true),
  ('70000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000003',
   'HR Support',             'hr-support',           'Benefits, policies, payroll, and general HR inquiries.',    '❓', 2, true),
  -- Facilities
  ('70000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000004',
   'Office Supplies',        'office-supplies',      'Stationery, consumables, and office equipment.',            '✏️', 1, true),
  ('70000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000004',
   'Building & Maintenance', 'building-maintenance', 'Lighting, HVAC, plumbing, cleaning, and safety issues.',   '🏗️', 2, true);

-- ── Wire services to sub-categories ──────────────────────────────────────────
-- Migration 20240101000109 replaced services.sub_category_id (a plain column)
-- with the many-to-many service_sub_category_tags junction table; this seed
-- previously still wrote to the removed column. Updated to insert into the
-- junction table instead — one tag per service, matching the original intent.
INSERT INTO service_sub_category_tags (service_id, sub_category_id) VALUES
  ('60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001'), -- Laptop Request → Computers & Laptops
  ('60000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002'), -- Equipment Repair → Peripherals & Repair
  ('60000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003'), -- Software Installation → Software Installation
  ('60000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000004'), -- Access Request → Access & Permissions
  ('60000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000005'), -- New Employee Onboarding → Onboarding
  ('60000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000006'), -- HR General Inquiry → HR Support
  ('60000000-0000-0000-0000-000000000007', '70000000-0000-0000-0000-000000000007'), -- Office Supplies → Office Supplies
  ('60000000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000008'); -- Maintenance Request → Building & Maintenance

-- ============================================================
-- KNOWLEDGE BASE — starter articles (one per seeded service)
-- ============================================================
INSERT INTO kb_articles (id, org_id, title, slug, content, status, author_id) VALUES
(
  '80000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'How to Request a New Laptop',
  'how-to-request-a-new-laptop',
  '## When to use this

Use the **Laptop Request** service when you need a new laptop for a new hire, a replacement for a broken or lost device, or an upgrade.

## Before you submit

- Have your current asset tag ready if this is a replacement.
- Decide whether you need macOS or Windows.
- If this is for a new hire, note their start date so IT can prepare the device in time.

## What happens next

1. Your request is routed to **IT Support**.
2. Standard turnaround is 1–3 business days depending on priority and stock.
3. You''ll get a notification when the request moves to *In Progress* and again when it''s *Resolved*.

## Related

See also: *Troubleshooting a Flickering or Broken Monitor* if the issue is a peripheral rather than the laptop itself.',
  'published',
  '30000000-0000-0000-0000-000000000004'
),
(
  '80000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Troubleshooting a Flickering or Broken Monitor',
  'troubleshooting-a-flickering-or-broken-monitor',
  '## Quick checks before raising a ticket

1. Try a different cable (HDMI/DisplayPort) if you have one.
2. Try a different port on your laptop or dock.
3. Restart your machine — a driver glitch can look like a hardware fault.

## If it''s still broken

Raise an **Equipment Repair** request under Hardware and include:
- The device type (monitor, keyboard, mouse, etc.)
- A clear description of the issue and when it started
- The asset tag / serial number if visible on a sticker on the device

Marking the request **High** priority is appropriate if the fault blocks you from working.',
  'published',
  '30000000-0000-0000-0000-000000000004'
),
(
  '80000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Requesting Software Installation',
  'requesting-software-installation',
  '## What this covers

Use the **Software Installation** service to get any application, tool, or license installed on your work device — e.g. Adobe Acrobat, Slack, Figma, dev tools.

## What to include

- The exact software name and, if relevant, which edition/tier.
- A short business justification (why you need it for your role).
- Whether it''s urgent and why, if so.

## Note on licensed software

Paid software may require budget approval from your manager before IT can proceed — mention this in the justification if you already have verbal sign-off.',
  'published',
  '30000000-0000-0000-0000-000000000004'
),
(
  '80000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'How to Request System Access (VPN, CRM, Shared Drives)',
  'how-to-request-system-access',
  '## What this covers

Use the **Access Request** service for VPN access, logins to internal systems (e.g. CRM), or access to shared drives/folders.

## Access levels

- **Read only** — view data without changing it.
- **Read and write** — the default for most day-to-day work.
- **Admin access** — reserved for system owners; requires manager approval.

## Approval

Requests for elevated or admin-level access are routed through a **manager approval** step before IT provisions anything. Make sure the "manager has verbally approved" box only checked if that''s actually true — it speeds up approval but is double-checked.',
  'published',
  '30000000-0000-0000-0000-000000000004'
),
(
  '80000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'New Employee Onboarding Checklist',
  'new-employee-onboarding-checklist',
  '## For managers submitting an onboarding request

Raise a **New Employee Onboarding** request as early as possible — ideally at least a week before the start date — so equipment and access are ready on day one.

## Information to have ready

- Full legal name and personal email (for offer/access setup)
- Start date and job title
- Department and reporting manager
- Equipment needed: laptop, monitor, phone, access card

## What HR + IT do with this

- HR prepares the employment paperwork and building/access card.
- IT provisions a laptop and default accounts (email, core tools).
- Both teams coordinate so the new hire has a working setup on day one.',
  'published',
  '30000000-0000-0000-0000-000000000004'
),
(
  '80000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000001',
  'Leave & Time-Off Policy FAQ',
  'leave-and-time-off-policy-faq',
  '## Common questions

**Can I carry over unused leave into next year?**
Check with HR for the current policy — this is configured per fiscal year and may change.

**How do I request leave?**
Raise an **HR General Inquiry** with topic "Leave & time off" and describe your request; HR will confirm balance and approve.

**Who approves leave?**
Your direct manager, via the standard approval workflow.

For anything not covered here, raise a general HR inquiry and someone will get back to you.',
  'published',
  '30000000-0000-0000-0000-000000000004'
),
(
  '80000000-0000-0000-0000-000000000007',
  '00000000-0000-0000-0000-000000000001',
  'Ordering Office Supplies',
  'ordering-office-supplies',
  '## What this covers

Use the **Office Supplies** service for stationery, consumables, and small desk items (notebooks, pens, whiteboard markers, etc.).

## What to include

- A clear list of items and quantities (e.g. "3x A4 notebooks, 1 box of pens").
- Your delivery location — floor and desk number if applicable.

## Turnaround

Low-priority by default; typically fulfilled within a few business days from office stock or a supplier order.',
  'published',
  '30000000-0000-0000-0000-000000000004'
),
(
  '80000000-0000-0000-0000-000000000008',
  '00000000-0000-0000-0000-000000000001',
  'Reporting a Facilities or Maintenance Issue',
  'reporting-a-facilities-or-maintenance-issue',
  '## What this covers

Use the **Maintenance Request** service for lighting, HVAC (heating/cooling), plumbing, cleaning, or security/access issues in the office.

## What to include

- Issue type and exact location (floor + room, e.g. "Meeting Room B").
- A clear description of the problem and when it started.
- Check the **safety hazard** box if the issue poses any risk (e.g. exposed wiring, water leak near electronics) — this raises the priority automatically.

## Response times

Safety-hazard issues are treated as urgent regardless of the selected priority.',
  'published',
  '30000000-0000-0000-0000-000000000004'
);

INSERT INTO kb_article_services (article_id, service_id) VALUES
  ('80000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001'), -- Laptop Request
  ('80000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'), -- Equipment Repair
  ('80000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003'), -- Software Installation
  ('80000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000004'), -- Access Request
  ('80000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000005'), -- New Employee Onboarding
  ('80000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000006'), -- HR General Inquiry
  ('80000000-0000-0000-0000-000000000007', '60000000-0000-0000-0000-000000000007'), -- Office Supplies
  ('80000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000008'); -- Maintenance Request

-- ── Backfill org_id for all seeded data ────────────────────────────────────────
-- All seed data belongs to the default Citykart Desk org
UPDATE profiles          SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE teams             SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE departments       SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE service_categories SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE services          SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE approval_workflows SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- ── Enable all modules for the default org ──────────────────────────────────────
INSERT INTO org_module_access (org_id, module, enabled)
SELECT '00000000-0000-0000-0000-000000000001', m.module::module_slug, true
FROM (VALUES ('tasks'), ('requests'), ('approvals'), ('services'), ('analytics'), ('time_tracking'), ('projects')) m(module)
ON CONFLICT (org_id, module) DO UPDATE SET enabled = true;

-- ── Default AI application patterns for DeskTime hour-splitting ────────────────
INSERT INTO ai_applications (org_id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Remote'),
  ('00000000-0000-0000-0000-000000000001', 'Claude'),
  ('00000000-0000-0000-0000-000000000001', 'Localhost'),
  ('00000000-0000-0000-0000-000000000001', 'Snooker'),
  ('00000000-0000-0000-0000-000000000001', 'WMS'),
  ('00000000-0000-0000-0000-000000000001', 'Sql')
ON CONFLICT (org_id, name) DO NOTHING;
