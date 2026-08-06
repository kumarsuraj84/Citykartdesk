-- ============================================================
-- FlowDesk — Seed Data (local development)
-- Passwords are all: Password123!
-- ============================================================

-- ============================================================
-- DEPARTMENTS
-- ============================================================
INSERT INTO departments (id, name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Information Technology'),
  ('10000000-0000-0000-0000-000000000002', 'Human Resources'),
  ('10000000-0000-0000-0000-000000000003', 'Operations');

-- ============================================================
-- TEAMS
-- ============================================================
INSERT INTO teams (id, name, slug, prefix, department_id, notification_email, is_active) VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    'IT Support',
    'it-support',
    'IT',
    '10000000-0000-0000-0000-000000000001',
    'it-support@flowdesk.dev',
    true
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'HR Operations',
    'hr-operations',
    'HR',
    '10000000-0000-0000-0000-000000000002',
    'hr@flowdesk.dev',
    true
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'Facilities',
    'facilities',
    'FAC',
    '10000000-0000-0000-0000-000000000003',
    'facilities@flowdesk.dev',
    true
  );

-- ============================================================
-- AUTH USERS + PROFILES
-- Trigger handle_new_user creates profiles automatically.
-- We then update roles for manager/admin.
-- ============================================================

-- user: Alex Johnson (regular user / requester)
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'user@flowdesk.dev',
  crypt('Password123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Alex Johnson"}',
  now(), now(),
  '', '', '', ''
);

-- agent: Sam Rivera (IT Support team member)
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES (
  '30000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'agent@flowdesk.dev',
  crypt('Password123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Sam Rivera"}',
  now(), now(),
  '', '', '', ''
);

-- manager: Jordan Lee
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES (
  '30000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'manager@flowdesk.dev',
  crypt('Password123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Jordan Lee"}',
  now(), now(),
  '', '', '', ''
);

-- admin: Admin User
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
  'admin@flowdesk.dev',
  crypt('Password123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Admin User"}',
  now(), now(),
  '', '', '', ''
);

-- Elevate roles (trigger created profiles as 'user')
UPDATE profiles SET role = 'manager' WHERE id = '30000000-0000-0000-0000-000000000003';
UPDATE profiles SET role = 'platform_owner' WHERE id = '30000000-0000-0000-0000-000000000004';

-- ============================================================
-- TEAM MEMBERS
-- ============================================================
INSERT INTO team_members (team_id, user_id, is_lead, org_id) VALUES
  -- IT Support: Sam (agent), Jordan (lead), Admin
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', false, '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', true,  '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', false, '00000000-0000-0000-0000-000000000001'),
  -- HR Operations: Jordan (lead)
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', true,  '00000000-0000-0000-0000-000000000001');

-- ============================================================
-- SERVICE CATEGORIES
-- ============================================================
INSERT INTO service_categories (id, name, slug, icon, description, sort_order, is_active) VALUES
  ('40000000-0000-0000-0000-000000000001', 'Hardware',          'hardware',        '💻', 'Laptops, monitors, peripherals, and device repair.',             1, true),
  ('40000000-0000-0000-0000-000000000002', 'Software & Access', 'software-access', '🔐', 'Software installation, system access, and license management.',  2, true),
  ('40000000-0000-0000-0000-000000000003', 'People & HR',       'people-hr',       '👥', 'Onboarding, offboarding, benefits, and HR inquiries.',           3, true),
  ('40000000-0000-0000-0000-000000000004', 'Facilities',        'facilities',      '🏢', 'Office supplies, building maintenance, and facility requests.',  4, true);

-- ============================================================
-- APPROVAL WORKFLOWS
-- ============================================================
INSERT INTO approval_workflows (id, name, description) VALUES
  (
    '50000000-0000-0000-0000-000000000001',
    'Manager Approval',
    'Single-step approval by any manager'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    'HR Manager Approval',
    'Single-step approval by any manager, used for HR requests'
  );

INSERT INTO approval_workflow_steps (workflow_id, step_order, approver_type, approver_user_id) VALUES
  ('50000000-0000-0000-0000-000000000001', 1, 'any_manager', NULL),
  ('50000000-0000-0000-0000-000000000002', 1, 'any_manager', NULL);

-- ============================================================
-- SERVICES
-- ============================================================
INSERT INTO services (
  id, name, slug, description, icon, keywords,
  category_id, team_id,
  form_fields, default_priority, sla_config, approval_workflow_id,
  is_active, sort_order
) VALUES

-- Hardware: Laptop Request
(
  '60000000-0000-0000-0000-000000000001',
  'Laptop Request',
  'laptop-request',
  'Request a new laptop or replacement for your work.',
  '💻',
  ARRAY['laptop', 'computer', 'hardware', 'equipment', 'macbook', 'windows'],
  '40000000-0000-0000-0000-000000000001',
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
  '{"low":{"response_hours":48,"resolution_hours":120},"medium":{"response_hours":24,"resolution_hours":72},"high":{"response_hours":8,"resolution_hours":24},"urgent":{"response_hours":2,"resolution_hours":8}}'::jsonb,
  '50000000-0000-0000-0000-000000000001',
  true, 1
),

-- Hardware: Equipment Repair
(
  '60000000-0000-0000-0000-000000000002',
  'Equipment Repair',
  'equipment-repair',
  'Report a broken or malfunctioning device for repair.',
  '🔧',
  ARRAY['repair', 'broken', 'hardware', 'fix', 'monitor', 'keyboard', 'mouse'],
  '40000000-0000-0000-0000-000000000001',
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
  '{"low":{"response_hours":24,"resolution_hours":72},"medium":{"response_hours":8,"resolution_hours":48},"high":{"response_hours":4,"resolution_hours":24},"urgent":{"response_hours":1,"resolution_hours":8}}'::jsonb,
  NULL,
  true, 2
),

-- Software & Access: Software Installation
(
  '60000000-0000-0000-0000-000000000003',
  'Software Installation',
  'software-installation',
  'Request installation of software or tools on your device.',
  '📦',
  ARRAY['software', 'install', 'application', 'tool', 'license', 'app'],
  '40000000-0000-0000-0000-000000000002',
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
  '{"low":{"response_hours":48,"resolution_hours":120},"medium":{"response_hours":24,"resolution_hours":72},"high":{"response_hours":8,"resolution_hours":24},"urgent":{"response_hours":2,"resolution_hours":8}}'::jsonb,
  NULL,
  true, 3
),

-- Software & Access: Access Request
(
  '60000000-0000-0000-0000-000000000004',
  'Access Request',
  'access-request',
  'Request access to systems, applications, or shared resources.',
  '🔑',
  ARRAY['access', 'permission', 'login', 'account', 'system', 'vpn', 'drive'],
  '40000000-0000-0000-0000-000000000002',
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
  '{"low":{"response_hours":48,"resolution_hours":96},"medium":{"response_hours":24,"resolution_hours":48},"high":{"response_hours":4,"resolution_hours":24},"urgent":{"response_hours":2,"resolution_hours":8}}'::jsonb,
  '50000000-0000-0000-0000-000000000001',
  true, 4
),

-- People & HR: New Employee Onboarding
(
  '60000000-0000-0000-0000-000000000005',
  'New Employee Onboarding',
  'new-employee-onboarding',
  'Submit onboarding requests for new team members joining the company.',
  '🎉',
  ARRAY['onboarding', 'new hire', 'employee', 'setup', 'start', 'joining'],
  '40000000-0000-0000-0000-000000000003',
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
  '{"low":{"response_hours":48,"resolution_hours":240},"medium":{"response_hours":24,"resolution_hours":120},"high":{"response_hours":8,"resolution_hours":72},"urgent":{"response_hours":4,"resolution_hours":24}}'::jsonb,
  '50000000-0000-0000-0000-000000000002',
  true, 5
),

-- People & HR: General HR Inquiry
(
  '60000000-0000-0000-0000-000000000006',
  'HR General Inquiry',
  'hr-general-inquiry',
  'Ask HR a question or request information about policies, benefits, or payroll.',
  '❓',
  ARRAY['hr', 'policy', 'payroll', 'benefits', 'leave', 'vacation', 'question'],
  '40000000-0000-0000-0000-000000000003',
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
  '{"low":{"response_hours":48,"resolution_hours":120},"medium":{"response_hours":24,"resolution_hours":72},"high":{"response_hours":8,"resolution_hours":24},"urgent":{"response_hours":4,"resolution_hours":12}}'::jsonb,
  NULL,
  true, 6
),

-- Facilities: Office Supplies
(
  '60000000-0000-0000-0000-000000000007',
  'Office Supplies',
  'office-supplies',
  'Request office supplies, stationery, or consumables.',
  '✏️',
  ARRAY['supplies', 'stationery', 'office', 'paper', 'pen', 'desk'],
  '40000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000003',
  '[
    {"id":"items","type":"textarea","label":"Items requested","required":true,"order":1,
     "placeholder":"List the items you need, e.g. 2x notebooks, 1 box of pens"},
    {"id":"delivery_location","type":"text","label":"Delivery location / desk","required":true,"order":2,
     "placeholder":"e.g. Floor 3, Desk 14B"}
  ]'::jsonb,
  'low',
  '{"low":{"response_hours":72,"resolution_hours":168},"medium":{"response_hours":48,"resolution_hours":96},"high":{"response_hours":24,"resolution_hours":48},"urgent":{"response_hours":8,"resolution_hours":24}}'::jsonb,
  NULL,
  true, 7
),

-- Facilities: Maintenance Request
(
  '60000000-0000-0000-0000-000000000008',
  'Maintenance Request',
  'maintenance-request',
  'Report a facilities issue such as lighting, HVAC, plumbing, or cleaning.',
  '🔨',
  ARRAY['maintenance', 'repair', 'facilities', 'hvac', 'plumbing', 'cleaning', 'building'],
  '40000000-0000-0000-0000-000000000004',
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
  '{"low":{"response_hours":72,"resolution_hours":168},"medium":{"response_hours":24,"resolution_hours":72},"high":{"response_hours":8,"resolution_hours":24},"urgent":{"response_hours":2,"resolution_hours":8}}'::jsonb,
  NULL,
  true, 8
);

-- ============================================================
-- SERVICE SUB-CATEGORIES (Phase 3)
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
UPDATE services SET sub_category_id = '70000000-0000-0000-0000-000000000001' WHERE id = '60000000-0000-0000-0000-000000000001'; -- Laptop Request → Computers & Laptops
UPDATE services SET sub_category_id = '70000000-0000-0000-0000-000000000002' WHERE id = '60000000-0000-0000-0000-000000000002'; -- Equipment Repair → Peripherals & Repair
UPDATE services SET sub_category_id = '70000000-0000-0000-0000-000000000003' WHERE id = '60000000-0000-0000-0000-000000000003'; -- Software Installation → Software Installation
UPDATE services SET sub_category_id = '70000000-0000-0000-0000-000000000004' WHERE id = '60000000-0000-0000-0000-000000000004'; -- Access Request → Access & Permissions
UPDATE services SET sub_category_id = '70000000-0000-0000-0000-000000000005' WHERE id = '60000000-0000-0000-0000-000000000005'; -- New Employee Onboarding → Onboarding
UPDATE services SET sub_category_id = '70000000-0000-0000-0000-000000000006' WHERE id = '60000000-0000-0000-0000-000000000006'; -- HR General Inquiry → HR Support
UPDATE services SET sub_category_id = '70000000-0000-0000-0000-000000000007' WHERE id = '60000000-0000-0000-0000-000000000007'; -- Office Supplies → Office Supplies
UPDATE services SET sub_category_id = '70000000-0000-0000-0000-000000000008' WHERE id = '60000000-0000-0000-0000-000000000008'; -- Maintenance Request → Building & Maintenance

-- ============================================================
-- DUMMY REQUESTS  (covers all statuses + ticket flows)
-- Requester = Alex Johnson (30000000-0000-0000-0000-000000000001)
-- Agent     = Sam Rivera   (30000000-0000-0000-0000-000000000002)
-- Manager   = Jordan Lee   (30000000-0000-0000-0000-000000000003)
-- ============================================================

-- NOTE: we bypass the trigger by inserting request_no manually.
-- The trigger only fires on INSERT without request_no set; providing it skips it.

INSERT INTO requests (
  id, request_no, title, description,
  requester_id, assigned_to, service_id, team_id,
  priority, status, form_data,
  response_due_at, resolution_due_at, responded_at, resolved_at, closed_at,
  created_at, updated_at
) VALUES

-- 1. OPEN — new laptop request, unassigned
(
  'A0000000-0000-0000-0000-000000000001',
  'IT-000001',
  'New MacBook Pro for design work',
  'I need a new MacBook Pro M3 for video editing and design. My current machine is 4 years old and struggling.',
  '30000000-0000-0000-0000-000000000001', NULL,
  '60000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'high', 'open',
  '{"reason":"upgrade","os_preference":"macos","additional_notes":"Need minimum 16GB RAM and 512GB SSD for video editing workflow."}'::jsonb,
  now() + interval '8 hours', now() + interval '24 hours',
  NULL, NULL, NULL,
  now() - interval '2 hours', now() - interval '2 hours'
),

-- 2. IN_PROGRESS — equipment repair, assigned to Sam
(
  'A0000000-0000-0000-0000-000000000002',
  'IT-000002',
  'Monitor flickering on second display',
  'My external Dell monitor has started flickering. It makes it impossible to work for more than 30 minutes.',
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  'high', 'in_progress',
  '{"device_type":"monitor","issue_description":"Dell U2722D flickering at random intervals, worse after 30 mins of use. Tried different cables and ports.","asset_tag":"AST-00421"}'::jsonb,
  now() - interval '2 hours', now() + interval '22 hours',
  now() - interval '3 hours', NULL, NULL,
  now() - interval '5 hours', now() - interval '3 hours'
),

-- 3. PENDING_APPROVAL — access request awaiting manager sign-off
(
  'A0000000-0000-0000-0000-000000000003',
  'IT-000003',
  'Admin access to Salesforce CRM',
  'Need admin access to Salesforce to manage lead assignments for the new sales territory rollout.',
  '30000000-0000-0000-0000-000000000001', NULL,
  '60000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000001',
  'medium', 'pending_approval',
  '{"system_name":"Salesforce CRM","access_level":"admin","justification":"New territory assignments require admin-level lead management. Approved verbally by Jordan Lee on Monday.","manager_approved":true}'::jsonb,
  now() + interval '24 hours', now() + interval '48 hours',
  NULL, NULL, NULL,
  now() - interval '1 day', now() - interval '1 day'
),

-- 4. RESOLVED — software install, fully resolved
(
  'A0000000-0000-0000-0000-000000000004',
  'IT-000004',
  'Install Figma desktop app',
  'Please install Figma desktop on my MacBook. Currently using the web version which is slower.',
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000001',
  'low', 'resolved',
  '{"software_name":"Figma","business_justification":"UI/UX design work. Desktop app is significantly faster than browser version.","urgency_reason":""}'::jsonb,
  now() - interval '3 days', now() - interval '2 days',
  now() - interval '4 days', now() - interval '2 days', NULL,
  now() - interval '5 days', now() - interval '2 days'
),

-- 5. CLOSED — office supplies, all done
(
  'A0000000-0000-0000-0000-000000000005',
  'FAC-000001',
  'Notebooks and pens for Q3 planning',
  'Need supplies for the upcoming Q3 planning sessions.',
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000007',
  '20000000-0000-0000-0000-000000000003',
  'low', 'closed',
  '{"items":"3x A4 notebooks, 2x boxes of ballpoint pens, 1x whiteboard markers set","delivery_location":"Floor 2, Desk 7A"}'::jsonb,
  now() - interval '8 days', now() - interval '6 days',
  now() - interval '9 days', now() - interval '7 days', now() - interval '6 days',
  now() - interval '10 days', now() - interval '6 days'
),

-- 6. OPEN — HR onboarding for a new hire, urgent
(
  'A0000000-0000-0000-0000-000000000006',
  'HR-000001',
  'Onboarding setup for Priya Sharma — starts Monday',
  'New senior designer Priya Sharma joins Monday. Need full onboarding pack urgently.',
  '30000000-0000-0000-0000-000000000003',
  NULL,
  '60000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000002',
  'urgent', 'open',
  '{"employee_name":"Priya Sharma","start_date":"2026-06-16","role_title":"Senior Product Designer","department":"Product","equipment_needed":["laptop","monitor","access_card"],"notes":"Priya is relocating from London. Please ensure laptop is pre-configured with Figma, Notion, and Slack before arrival."}'::jsonb,
  now() + interval '2 hours', now() + interval '24 hours',
  NULL, NULL, NULL,
  now() - interval '30 minutes', now() - interval '30 minutes'
),

-- 7. IN_PROGRESS — maintenance (flickering lights)
(
  'A0000000-0000-0000-0000-000000000007',
  'FAC-000002',
  'Broken lighting in meeting room B',
  'Three ceiling lights in meeting room B are out. Hard to hold video calls in there.',
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000008',
  '20000000-0000-0000-0000-000000000003',
  'medium', 'in_progress',
  '{"issue_type":"lighting","location":"Meeting Room B, Floor 3","description":"Three ceiling tube lights have failed. Replacement bulbs may be needed. Issue started last Tuesday.","safety_hazard":false}'::jsonb,
  now() - interval '12 hours', now() + interval '60 hours',
  now() - interval '1 day', NULL, NULL,
  now() - interval '2 days', now() - interval '1 day'
),

-- 8. RESOLVED — HR inquiry about leave policy
(
  'A0000000-0000-0000-0000-000000000008',
  'HR-000002',
  'Question about carry-over leave policy',
  'Can unused annual leave days be carried into next year? Need clarification before year-end.',
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  '60000000-0000-0000-0000-000000000006',
  '20000000-0000-0000-0000-000000000002',
  'low', 'resolved',
  '{"topic":"leave","details":"I have 5 unused annual leave days remaining. Our handbook is unclear on whether these roll over to 2027 or are forfeited."}'::jsonb,
  now() - interval '6 days', now() - interval '4 days',
  now() - interval '7 days', now() - interval '5 days', NULL,
  now() - interval '8 days', now() - interval '5 days'
),

-- 9. OPEN — VPN access request
(
  'A0000000-0000-0000-0000-000000000009',
  'IT-000005',
  'VPN access for remote work',
  'Starting to work from home 3 days a week and need VPN to access internal tools.',
  '30000000-0000-0000-0000-000000000001', NULL,
  '60000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000001',
  'medium', 'open',
  '{"system_name":"Corporate VPN","access_level":"read_write","justification":"Working remotely 3 days/week starting next month. Need VPN for JIRA, Confluence, and internal dev environments.","manager_approved":true}'::jsonb,
  now() + interval '24 hours', now() + interval '48 hours',
  NULL, NULL, NULL,
  now() - interval '4 hours', now() - interval '4 hours'
),

-- 10. CLOSED — laptop repair all done
(
  'A0000000-0000-0000-0000-000000000010',
  'IT-000006',
  'Keyboard keys sticking on ThinkPad',
  'Several keys on my ThinkPad keyboard are sticking, especially the spacebar and Enter key.',
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  'medium', 'closed',
  '{"device_type":"laptop","issue_description":"Spacebar and Enter key are sticking intermittently. Suspect liquid spill residue underneath.","asset_tag":"AST-00087"}'::jsonb,
  now() - interval '15 days', now() - interval '12 days',
  now() - interval '16 days', now() - interval '13 days', now() - interval '12 days',
  now() - interval '17 days', now() - interval '12 days'
);

-- ============================================================
-- APPROVALS  (for requests that need manager sign-off)
-- ============================================================
INSERT INTO approvals (id, request_id, workflow_id, current_step, status, created_at) VALUES
  -- IT-000003 (Salesforce access): pending
  (
    'B0000000-0000-0000-0000-000000000001',
    'A0000000-0000-0000-0000-000000000003',
    '50000000-0000-0000-0000-000000000001',
    1, 'pending', now() - interval '1 day'
  ),
  -- HR-000001 (Onboarding Priya): pending
  (
    'B0000000-0000-0000-0000-000000000002',
    'A0000000-0000-0000-0000-000000000006',
    '50000000-0000-0000-0000-000000000002',
    1, 'pending', now() - interval '30 minutes'
  );

-- ============================================================
-- COMMENTS  (agent notes, customer replies, internal notes)
-- ============================================================
INSERT INTO request_comments (id, request_id, author_id, body, is_internal, created_at) VALUES

-- IT-000002 (monitor flickering)
(
  'C0000000-0000-0000-0000-000000000001',
  'A0000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  'Hi Alex — picked this up. I''ll swing by your desk this afternoon to take a look at the monitor. Could you keep the flickering happening so I can witness it?',
  false, now() - interval '3 hours'
),
(
  'C0000000-0000-0000-0000-000000000002',
  'A0000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  'Thanks Sam! It''s been flickering constantly this morning — shouldn''t be hard to reproduce. I''m at desk 7B.',
  false, now() - interval '2 hours 30 minutes'
),
(
  'C0000000-0000-0000-0000-000000000003',
  'A0000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  'Checked the monitor — display cable looks fine, issue is likely a failing backlight on the panel. Ordering a replacement unit from IT stock. ETA 1–2 business days.',
  true, now() - interval '1 hour'
),

-- IT-000004 (Figma install) — resolved thread
(
  'C0000000-0000-0000-0000-000000000004',
  'A0000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000002',
  'Figma Desktop has been installed and is ready to use. You can find it in your Applications folder. Let me know if anything looks off.',
  false, now() - interval '2 days'
),
(
  'C0000000-0000-0000-0000-000000000005',
  'A0000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000001',
  'Perfect, works great! Much faster than the browser. Thank you.',
  false, now() - interval '2 days' + interval '30 minutes'
),

-- FAC-000002 (meeting room lights)
(
  'C0000000-0000-0000-0000-000000000006',
  'A0000000-0000-0000-0000-000000000007',
  '30000000-0000-0000-0000-000000000002',
  'Logged this with the facilities contractor. They''re scheduled to inspect Meeting Room B on Thursday morning. Room will need to be free 8–10am.',
  false, now() - interval '1 day'
),

-- HR-000002 (leave policy)
(
  'C0000000-0000-0000-0000-000000000007',
  'A0000000-0000-0000-0000-000000000008',
  '30000000-0000-0000-0000-000000000003',
  'Hi Alex — great question. Per our current policy, up to 5 days of unused annual leave can be carried forward to the following calendar year. These must be used by March 31st or they will expire. I''ve updated the HR wiki with a clearer version of this policy.',
  false, now() - interval '5 days'
),
(
  'C0000000-0000-0000-0000-000000000008',
  'A0000000-0000-0000-0000-000000000008',
  '30000000-0000-0000-0000-000000000001',
  'That''s exactly what I needed to know. Thanks Jordan!',
  false, now() - interval '5 days' + interval '1 hour'
);

-- ============================================================
-- ADDITIONAL USERS (more realistic team)
-- ============================================================
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES
-- agent2: Maya Patel (IT Support)
(
  '30000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'maya@flowdesk.dev',
  crypt('Password123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Maya Patel"}',
  now(), now(), '', '', '', ''
),
-- user2: Chris Walker (regular employee)
(
  '30000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'chris@flowdesk.dev',
  crypt('Password123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Chris Walker"}',
  now(), now(), '', '', '', ''
);

INSERT INTO team_members (team_id, user_id, is_lead, org_id) VALUES
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', false, '00000000-0000-0000-0000-000000000001');

-- Chris's requests
INSERT INTO requests (
  id, request_no, title, description,
  requester_id, assigned_to, service_id, team_id,
  priority, status, form_data,
  response_due_at, resolution_due_at, responded_at, resolved_at,
  created_at, updated_at
) VALUES
(
  'A0000000-0000-0000-0000-000000000011',
  'IT-000007',
  'Slack not syncing on mobile',
  'Slack stopped showing new messages on my iPhone. Desktop works fine.',
  '30000000-0000-0000-0000-000000000006',
  '30000000-0000-0000-0000-000000000005',
  '60000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000001',
  'medium', 'in_progress',
  '{"software_name":"Slack (mobile)","business_justification":"Need mobile Slack for on-call alerts.","urgency_reason":"Missing urgent messages."}'::jsonb,
  now() + interval '12 hours', now() + interval '3 days',
  now() - interval '2 hours', NULL,
  now() - interval '3 hours', now() - interval '2 hours'
),
(
  'A0000000-0000-0000-0000-000000000012',
  'IT-000008',
  'New laptop — replacement for cracked screen',
  'Dropped my laptop and the screen cracked. Need a replacement urgently.',
  '30000000-0000-0000-0000-000000000006', NULL,
  '60000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'urgent', 'open',
  '{"reason":"replacement","os_preference":"windows","additional_notes":"Current laptop is a Dell XPS 13, asset tag AST-00233. Screen is cracked, otherwise functional."}'::jsonb,
  now() + interval '2 hours', now() + interval '8 hours',
  NULL, NULL,
  now() - interval '1 hour', now() - interval '1 hour'
);

-- ── Backfill org_id for all seeded data ────────────────────────────────────────
-- All seed data belongs to the default FlowDesk org
UPDATE profiles SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE teams    SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- ── Enable all modules for the default org ──────────────────────────────────────
INSERT INTO org_module_access (org_id, module, enabled)
SELECT '00000000-0000-0000-0000-000000000001', m.module::module_slug, true
FROM (VALUES ('tasks'), ('requests'), ('approvals'), ('services'), ('analytics'), ('time_tracking')) m(module)
ON CONFLICT (org_id, module) DO UPDATE SET enabled = true;
