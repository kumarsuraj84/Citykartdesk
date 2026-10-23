// LOCAL: builds docs/CKDESK-FEATURES-BY-ROLE.xlsx - every CK Desk feature, one row each, with who uses it, the status on this PC and on main, and the nearest ManageEngine
// ServiceDesk Plus area (for the comparison). Run: node local-testing/make-features-by-role-xlsx.cjs
const ExcelJS = require('exceljs')
const path = require('path')

const D = 'Done', P = 'Pending', OFF = 'Built - switched off'
const R = 'Requester', T = 'Technician', M = 'Manager/Admin', V = 'Vendor'
const ALL = [R, T, M, V]
const rows = []
const f = (module, name, desc, who, local, main, me = '', note = '') => rows.push({ module, name, desc, who, local, main, me, note })

// ── Sign-in and accounts
const A = 'Sign-in and accounts'
f(A, 'Sign in with e-mail and password', 'Everyone logs in with their e-mail; no public sign-up.', ALL, D, D, 'Self-service portal login')
f(A, 'Forgot password and invitation by e-mail', 'Reset a password or accept an invitation by e-mail (sent through the app mailbox).', ALL, D, D, 'Self-service portal login')
f(A, 'Password rules', 'No shared default password; random one-time passwords or invitations; must change on first sign-in.', ALL, D, D, 'Security settings')
f(A, 'My Profile', 'See who you report to and your team; set which notifications you want.', [R, T, M], D, D, 'My profile')
f(A, 'Roles', 'Requester, technician, manager, admin, platform owner, each with its own pages and rights.', [M], D, D, 'Roles and permissions')
f(A, 'Permission matrix with owner switches', 'Four switches the owner controls; defaults keep today\'s behaviour.', [M], D, D, 'Roles and permissions')
f(A, 'User administration', 'Invite or create users, bulk Excel import, change role, change sign-in e-mail, deactivate, reset password.', [M], D, D, 'Users')
f(A, 'Technician groups and many groups per technician', 'Create groups; one technician can belong to several.', [T, M], D, D, 'Technician groups')
f(A, 'Vendor logins (technician and manager)', 'OEM engineers and their managers get their own limited logins.', [M, V], D, P, 'Vendor portal (no direct equivalent)')

// ── Raising requests
const B = 'Raising a request'
f(B, 'Create Request page', 'One page with three panels and personal shortcuts to raise a request quickly.', [R, T], D, D, 'New request / self-service portal')
f(B, 'Service catalogue', 'Services with categories and sub categories, tags and locations.', [R, M], D, D, 'Service catalog')
f(B, 'Dynamic forms per service', 'Each service has its own form: field types, required fields, conditions.', [R, M], D, D, 'Request templates')
f(B, 'Form Templates and Field Library', 'Reusable forms and reusable field definitions.', [M], D, D, 'Request templates / custom fields')
f(B, 'Number and text limits in the form builder', 'Smallest and largest number, whole numbers only, shortest and longest text.', [M, R], D, D, 'Field validation')
f(B, 'Fields limited to categories', 'A field (for example Qty) appears only for chosen categories.', [M, R], D, D, 'Conditional fields')
f(B, 'Attachments with preview', 'Add files, get a clear popup if a file is too big, preview without downloading.', [R, T], D, D, 'Attachments')
f(B, 'Ticket title from the Subject field', 'The ticket is named after the Subject the requester typed.', [R], D, D, 'Request subject')
f(B, 'No double tickets', 'Pressing Submit twice within 15 seconds makes one ticket.', [R], D, D, 'Duplicate prevention')
f(B, 'Ticket numbers', 'Every request gets a number such as CKSD-000385.', ALL, D, D, 'Request ID')
f(B, 'Pick your own AC', 'For an AC problem the form lists the store\'s own ACs from the AC sheet.', [R], D, P, 'Asset selection on request')

// ── Handling requests
const C = 'Handling requests'
f(C, 'Agent Requests (my queue and team queue)', 'Work queue with search by requester, store, technician, service and description; resolved hidden by default.', [T, M], D, D, 'Request list and views')
f(C, 'Assignment', 'Assign by hand, by Business Rules, round-robin or load-balanced.', [T, M], D, D, 'Assign / auto-assign')
f(C, 'Start working with first response', 'One click starts work and posts an automatic first response.', [T], D, D, 'First response')
f(C, 'Status flow with compulsory remarks', 'Open, In Progress, Waiting on user, Hold due to Purchase from HO, Resolved, Closed, Cancelled; remarks required.', [T], D, D, 'Request status')
f(C, 'Hold due to Purchase from HO', 'A status for tickets waiting for a Head Office purchase; the clock pauses.', [T], D, D, 'On hold status')
f(C, 'Resolution note rules', 'A resolution note must say what was done (10+ characters) and never carry a password.', [T], D, D, 'Closure rules')
f(C, 'Cancel with a remark', 'Requester or technician cancels; a remark is compulsory.', [R, T], D, D, 'Close / cancel request')
f(C, 'Reopen a resolved request', 'Banner with a countdown, compulsory remark, expiry message.', [R, T], D, D, 'Reopen request')
f(C, 'Reopen after a rejected approval', 'The requester can reopen within 48 hours.', [R], D, D, 'Reopen request')
f(C, 'Priority from the sub category', 'Priority comes from the sub category; nobody can change it by hand.', [T, M], D, D, 'Priority matrix')
f(C, 'Service of a ticket is locked', 'Nobody can change the service of an existing ticket.', [M], D, D, 'Request lock')
f(C, 'Collaborators and related requests', 'Add people to a ticket; see related requests.', [T], D, D, 'Collaborators / linked requests')
f(C, '"Catch me up" summary', 'A short summary of what happened and what is pending on a ticket.', [T, M], D, D, 'No direct equivalent (AI summary in ME\'s AI add-on)')
f(C, 'Ticket as PDF', 'Download the ticket, the form, the whole conversation and the history in one PDF.', [R, T, M], D, D, 'Print / export request')
f(C, 'Automatic time tracking', 'Time starts when work starts and stops when it leaves In Progress.', [T], D, D, 'Worklogs and timers')
f(C, 'Nudge', 'Remind the handling technician from the dashboard.', [M, T], D, D, 'Reminders / escalation')
f(C, 'Bulk actions', 'Act on many tickets at once (up to 500).', [T, M], D, D, 'Bulk actions')
f(C, 'Ticket history', 'Every change recorded and shown as a timeline.', [R, T], D, D, 'Request history')
f(C, 'Hand AC tickets to a vendor technician', 'Rules give the AC ticket to the OEM\'s engineer; the ticket shows "With vendor".', [M, T], D, P, 'No direct equivalent')
f(C, 'End a vendor hold yourself', 'A Citykart technician can take the ticket back from hold; the vendor is told.', [T], D, P, 'No direct equivalent')

// ── Conversation and e-mail
const E = 'Conversation and e-mail'
f(E, 'Public conversation', 'Messages between requester and technician with files under each message.', [R, T, V], D, D, 'Conversation / replies')
f(E, 'Internal notes', 'Notes only Citykart staff can see.', [T, M], D, D, 'Notes')
f(E, 'CC a comment', 'Send a comment, with the whole ticket, to CK Desk users and OEM contacts.', [T], D, D, 'Forward / CC on reply')
f(E, 'Reply by e-mail', 'A reply to a ticket mail is read from the mailbox every minute and added to the conversation.', [R, T], D, D, 'E-mail reply to request')
f(E, 'OEM e-mail on AC and Genset tickets', 'A table-style mail goes to the store\'s OEM automatically; OEM replies show in the conversation.', [T], D, D, 'Notify vendor')
f(E, 'Ticket e-mails', 'Mails for logged, assigned, status change, resolved, cancelled, with the technician\'s comment and real ticket title.', [R, T], D, D, 'Notification templates')
f(E, 'Notification rules', 'Admin chooses, per event, in-app, e-mail or push; users can opt out.', [M, R, T], D, D, 'Notification rules')
f(E, 'Bell, unread count and pop-up', 'A bell and a small corner pop-up for new notifications.', ALL, D, D, 'Notifications')
f(E, 'Browser push notifications', 'Optional push messages in the browser (asks once).', ALL, D, D, 'Mobile / push notifications')
f(E, 'Mailbox settings', 'Admin sets the sending mailbox without a redeploy.', [M], D, D, 'Mail server settings')

// ── SLA
const S = 'SLA'
f(S, 'SLA policies and business hours', 'Response and resolution targets per service and priority, business hours, holidays.', [M], D, D, 'SLAs')
f(S, 'Field-level SLA overrides', 'A form answer can set a shorter SLA.', [M], D, D, 'SLA rules')
f(S, 'Pause and resume', 'The clock pauses while waiting on the user or on hold and resumes with the paused time credited.', [T], D, D, 'SLA hold')
f(S, 'Breach views and highlights', '"Currently breached", SLA compliance %, breach counts on dashboards and in reports.', [T, M], D, D, 'SLA reports')
f(S, 'Escalation and alert rules', 'Rules at 15-minute checks for SLA % used or unassigned tickets; alerts by e-mail.', [M], D, D, 'Escalations')
f(S, 'Daily alert digest', 'One summary mail every morning at 08:00.', [M], D, D, 'Scheduled reports')

// ── Approvals
const Ap = 'Approvals'
f(Ap, 'Approval flows', 'Single or multi-step, sequential or parallel; flows set per service.', [T, M], D, D, 'Approvals')
f(Ap, 'Approve from the e-mail link', 'Approve or reject from a personal link with identity check and compulsory comment; links expire after 7 days.', [R, T, M], D, D, 'Approve by e-mail')
f(Ap, 'Quick approve', 'Approve from the Approvals list or the bell.', [T, M], D, D, 'Approvals')
f(Ap, 'Add approvers and delegate', 'Add approvers while pending; delegate a step; first answer decides.', [T, M], D, D, 'Approvals')
f(Ap, 'Separation of duties', 'Nobody approves what they raised or sent.', [M], D, D, 'Approval rules')
f(Ap, 'Daily approval reminder', 'One mail at 10:00 to each approver listing what is waiting.', [M], D, D, 'Approval reminders')
f(Ap, 'Automatic CVM approval', 'Fixtures / Hangers tickets go to the store\'s CVM for approval by themselves.', [T, R], D, D, 'No direct equivalent')

// ── Automation
const U = 'Automation'
f(U, 'Business Rules', 'No-code rules on create, update or schedule: assign, set status, priority, team, notify.', [M], D, D, 'Business rules')
f(U, 'Round-robin and load-balanced assignment', 'Spread tickets over technicians.', [M], D, D, 'Auto-assign')
f(U, 'Rule search', 'Find a rule by typing part of its name or description.', [M], D, D, 'Business rules')
f(U, 'Rules for vendor technicians', 'A rule can give a ticket to a vendor technician and never takes it away from him.', [M], D, P, 'No direct equivalent')

// ── Equipment and OEM
const Q = 'Equipment (AC, Genset) and OEM'
f(Q, 'OEMs by type (AC and Genset)', 'One OEM per type per store; a category can send its tickets to the store\'s OEM.', [M], D, D, 'Vendors')
f(Q, 'Red-flag stores', 'Stores whose open AC tickets exceed a percentage of their ACs.', [T, M], D, D, 'Reports')
f(Q, 'AC and AMC reports', 'Store AC Not Working, AMC vendor, AC issues, repeated AC complaints.', [T, M], D, D, 'Asset reports')
f(Q, 'OEM mail again on reopen', 'When a store reopens a resolved ticket the OEM is mailed again.', [T], D, P, 'Notify vendor')
f(Q, 'AC and Genset master screens', 'Lists with filters, counts by brand, tonnage and region, Excel download.', [M], D, P, 'Asset list')

// ── Master data
const Md = 'Master data'
f(Md, 'Store Master', 'Stores with cluster, region, state, AC brand, priority list; Excel upload (with sample) and export.', [M], D, D, 'Sites / locations')
f(Md, 'Organisation structure', 'Departments, locations, cost centres, job functions, designations.', [M], D, D, 'Departments / sites')
f(Md, 'Store CVM', 'One CVM per store; one CVM can have many stores.', [M], D, D, 'No direct equivalent')
f(Md, 'Google Sheets as master data', 'AC, Genset and CVM sheets copied into CK Desk at 11:00, 15:00, 19:00 or by "Update now".', [M], D, P, 'Asset import')
f(Md, 'Sheet health page', 'Shows bad rows, bad addresses, approvers who are not CK Desk users.', [M], D, P, 'Import log')
f(Md, 'CVM from the sheet', 'The store\'s CVM comes from the CVM sheet.', [M], D, P, 'No direct equivalent')

// ── Vendor portal
const Vp = 'Vendor portal'
f(Vp, 'Vendor dashboard', 'Boxes: Revise price required, Open, In process, Part required, PO required, Resolved, Cancelled, each with whose turn it is.', [V], D, P, 'Technician portal')
f(Vp, 'Vendor manager view', 'A vendor manager sees all tickets of his company, view only.', [V], D, P, 'No direct equivalent')
f(Vp, 'Start working with the OEM ticket number', 'The engineer enters the OEM\'s ticket number to start; the store is told.', [V], D, P, 'No direct equivalent')
f(Vp, 'Resolve with AC RESOLUTION list and FSR', 'Pick the fix from the list (or Other with a note) and attach the FSR (compulsory).', [V], D, P, 'Resolution')
f(Vp, 'Messages with the store', 'Two-way conversation with files.', [V, R], D, P, 'Conversation')
f(Vp, 'Part required (no PO)', 'Parts list, ticket on hold, correct the list, withdraw, "Parts received" with a remark.', [V, R], D, P, 'Purchase request')
f(Vp, 'PO required with a quote', 'Items with prices (without GST) and a compulsory quote file; approver told.', [V], D, P, 'Purchase order request')
f(Vp, 'Revise price required', 'The approver asks for a lower price; the ticket moves to a box; send a new quote.', [V], D, P, 'Quote negotiation')
f(Vp, 'Quote versions', 'Every change is a new version; old versions cannot be approved.', [V, M], D, P, 'Purchase order versions')
f(Vp, 'Reject only the quote', 'The ticket goes on; the vendor arranges the parts himself.', [V, M], D, P, 'No direct equivalent')
f(Vp, 'Vendor e-mails', 'Mails for assigned, revised price, PO approved (with document), quote not approved, cancelled, reopened, hold ended.', [V], D, P, 'Notification templates')
f(Vp, 'Reopened tag', 'A red "Reopened xN" tag and the old OEM ticket number cleared.', [V], D, P, 'No direct equivalent')
f(Vp, 'Safe vendor access', 'A vendor sees only his own tickets, cannot raise requests, never sees internal notes.', [V], D, P, 'Roles')

// ── Purchase orders
const Po = 'Purchase orders'
f(Po, 'PO approval page', 'Approve (PO number, date, document), ask for a revised price, reject quote only, or reject and cancel.', [M], D, P, 'Purchase approval')
f(Po, 'Approvers from the AC sheet', 'The AC sheet names the approvers per AC (several allowed); one mail to all; first decision wins.', [M], D, P, 'Approval by site / group')
f(Po, 'Default PO approver', 'Used when the sheet names nobody.', [M], D, P, 'Approval settings')
f(Po, 'Purchase orders register', 'All POs with search and Excel download; vendors see their own.', [M, V], D, P, 'Purchase orders list')
f(Po, 'OEM mail on PO decision', 'The OEM gets the approved PO with the document, or a short rejection note.', [M], D, P, 'Purchase order e-mail')

// ── Dashboards
const Db = 'Dashboards - interactive'
f(Db, 'Home dashboard', 'Counts and lists for you: my open, my queue, team open, my requests.', ALL.slice(0, 3), D, D, 'Home / dashboard')
f(Db, 'Interactive Smart Dashboard', 'One dashboard for every role, narrowed to what the viewer may see; every number, bar and name can be clicked.', [R, T, M], D, D, 'Dashboards and widgets')
f(Db, 'KPI scorecard with trend', 'Created, resolved, backlog, breaches, SLA %, resolution time, CSAT, reopened, first response, each with a trend and the previous period.', [T, M], D, D, 'Dashboard widgets')
f(Db, 'Click-to-drill pop-up (4 steps)', 'Click a number: cohort, then stores and technicians, then the ticket list, then one ticket with its history.', [T, M], D, D, 'Drill-down on widgets')
f(Db, 'Cascading filter bar', 'Group, technician, region, state, cluster, store type, OEM brand, AC health, status, SLA, search; each list shows only what fits the others.', [T, M], D, D, 'Dashboard filters')
f(Db, 'Time periods', '30, 60, 90, 120 days, this financial year or custom dates, with a compare-to-previous switch.', [T, M], D, D, 'Date range')
f(Db, 'Priority highlights strip', 'Six signals such as SLA risk, workload, OEM, approvals, AC red flags, new stores.', [T, M], D, D, 'No direct equivalent')
f(Db, 'Stores and Regions view', 'Regions, states, clusters and stores side by side with AC position.', [M], D, D, 'No direct equivalent')
f(Db, 'Group and OEM matrix', 'Group by OEM brand matrices with clickable cells.', [M], D, D, 'Pivot widgets')
f(Db, 'Workload and Approvals view', 'Technician workload and approvals waiting, with Nudge.', [M], D, D, 'Technician workload')
f(Db, 'Heatmap and ticket explorer', 'A ticket list that follows every filter, with heatmap.', [T, M], D, D, 'Request list')
f(Db, 'Export from the dashboard', 'Download the filtered tickets as CSV.', [T, M], D, D, 'Export')
f(Db, 'Technician dashboard and workload', 'Group workload, 9-bucket ageing, daily activity, highest-open banner.', [T, M], D, D, 'Technician dashboard')
f(Db, 'Drag-and-drop dashboard widgets', 'Reorder widgets on the normal dashboards.', [T, M], D, D, 'Dashboard personalisation')
f(Db, 'Service, Category and Sub category filters', 'Three more filters in the dashboard bar, each narrowing the next.', [T, M], D, P, 'Dashboard filters')

const Cal = 'Ticket Calendar'
f(Cal, 'Ticket Calendar for every group', 'A month calendar named after the group ("IT Ticket Calendar"); days coloured green, yellow, red, grey for the future.', [T, M], D, P, 'No direct equivalent (ME has a calendar for tasks and changes only)')
f(Cal, 'Colour by the group\'s own normal', 'For groups without assets the colour compares each day with that group\'s usual open level over 90 days.', [T, M], D, P, 'No direct equivalent')
f(Cal, 'Place picker', 'Look at all Citykart, a state, region, cluster or one store.', [T, M, R], D, P, 'No direct equivalent')
f(Cal, 'Faulty AC and genset calendar', 'For AC and Genset work: share of faulty machines per day (above 10% yellow, above 30% red), raised and fixed.', [T, M, R], D, P, 'Asset health (partial)')
f(Cal, 'ACs that fail again and again', 'Repeat-fault ACs by serial number (4+ = repeat, 2-3 = watch) with "came back within 30 days of a fix" and who fixed it last.', [T, M], D, P, 'Asset history (partial)')
f(Cal, 'Same issue again', 'Same store and same issue raised again; the repeat list for groups without assets.', [T, M], D, P, 'Problem management (partial)')
f(Cal, 'Break it down by', 'Technician, cluster, region, state, store, category, sub category: open now, raised, fixed.', [T, M], D, P, 'Dashboard widgets')
f(Cal, 'Day pop-up', 'Click a day to see the tickets raised, fixed and still open that day.', [T, M, R], D, P, 'Drill-down on widgets')
f(Cal, 'Worst places right now', 'Ranking of stores, clusters, regions or states by share of faulty ACs; click to open.', [M], D, P, 'No direct equivalent')
f(Cal, 'Outside temperature', 'Highest and lowest temperature per day for the place, collected once a day at 08:00 (AC and genset views only).', [T, M], D, P, 'No direct equivalent')

// ── Reports
const Rp = 'Reports'
f(Rp, 'Report Builder', 'Build your own pivot or table report from requests, tasks, projects, milestones and approvals.', [T, M], D, D, 'Report builder')
f(Rp, 'Saved reports', 'Save a report and open it again.', [T, M], D, D, 'Custom reports')
f(Rp, 'Report Analytics', 'Fixed reports: age bucket, ticket status, store-wise, AC Not Working, AMC vendor (Excel-style, expand and collapse).', [T, M], D, D, 'Standard reports')
f(Rp, 'Predefined Reports', '12 fixed Excel-style reports plus weekly, monthly, priority-wise and repeated AC complaint reports; search by name.', [T, M], D, D, 'Standard reports')
f(Rp, 'Scheduled reports and exports', 'CSV and Excel exports; scheduled daily, weekly or monthly reports to company addresses.', [M], D, D, 'Scheduled reports')
f(Rp, 'India-time reporting', 'Dates and weeks use India time everywhere.', [T, M], D, D, 'Time zone settings')

// ── Projects, tasks, knowledge
const Pj = 'Projects, tasks, knowledge'
f(Pj, 'Projects and milestones', 'Projects with owner, team, dates, milestones, updates and progress %.', [T, M, R], D, D, 'Projects')
f(Pj, 'Tasks', 'Personal and team tasks with subtasks, dependencies, templates, custom fields, comments, files.', [T, M, R], D, D, 'Tasks')
f(Pj, 'Knowledge Base', 'Help articles per service.', [R, T, M], D, D, 'Solutions')
f(Pj, 'Runbooks', 'A documentation browser for the admin set-up.', [M], D, D, 'No direct equivalent')

// ── Satisfaction
const Cs = 'Customer satisfaction'
f(Cs, 'Rate the fix (CSAT)', 'One-click 1-5 stars in the "resolved" mail, or "not fixed, reopen"; one reminder.', [R], D, D, 'Surveys')
f(Cs, 'Low-rating alert', 'An alert when a rating is low.', [M], D, D, 'Survey alerts')

// ── Intake
const In = 'Intake channels'
f(In, 'E-mail intake with human review', 'Mails are classified (rules, optional AI) and a reviewer turns them into tickets.', [M], D, OFF, 'E-mail commands / mail fetching', 'Built, switched off for the organisation')
f(In, 'Intake rules and classification', 'Rules and an optional AI model sort incoming messages.', [M], D, OFF, 'Zia / AI add-on', 'Part of the e-mail intake')

// ── Administration, security, logs
const Ad = 'Administration, security and logs'
f(Ad, 'Categories, services and SLA set-up screens', 'All admin screens to define categories, services, templates, SLA, priorities, business hours.', [M], D, D, 'Admin settings')
f(Ad, 'Platform settings', 'Retention, integrations, sending mailbox.', [M], D, D, 'Admin settings')
f(Ad, 'Security hardening', 'Server-only writes, row-level security, per-purpose secrets, rate limits, report-only content policy, Next.js 16.3.8.', [M], D, D, 'Security')
f(Ad, 'System Log (tamper-evident)', 'One Logs menu: system log with a hash chain, ticket activity, event log, errors, retention.', [M], D, D, 'Audit / logs')
f(Ad, 'Monitoring and health', 'Live stats, health address, version address, log shipper.', [M], D, D, 'Server monitoring')
f(Ad, 'Daily weather job', 'A scheduled task at 08:00 that saves the day\'s highest and lowest temperature of each city.', [M], D, P, 'No direct equivalent')

// ── Not built
const Nb = 'Not built yet'
f(Nb, 'Reminder for a waiting quote', 'Remind the approver after 1 day and the vendor after 2 days.', [M, V], P, P, 'Escalations')
f(Nb, 'Vendor replies by e-mail', 'A vendor answers a mail and it lands in the conversation (not tested for vendors).', [V], P, P, 'E-mail reply to request')
f(Nb, 'Weather fallback by the nearest store', 'For cities the weather service cannot find, use the nearest store of the same cluster.', [M], P, P, 'No direct equivalent')
f(Nb, 'Calendar fix for reopened tickets', 'A reopened ticket counts as open for its whole life in the calendar; correct it from the history.', [M], P, P, 'No direct equivalent')
f(Nb, 'CK Desk Bot', 'A question-and-answer assistant on tickets and knowledge (plan only).', [R, T], P, P, 'Zia')
f(Nb, 'Google Workspace user sync', 'Create and update users from Google Workspace (plan only).', [M], P, P, 'AD / LDAP import')

// ── Where ManageEngine ServiceDesk Plus has more (from general knowledge of the product - check against your edition)
const gaps = [
  ['Problem management', 'Find the root cause of repeated incidents and link them.', 'Not in CK Desk', 'Partial idea: "same issue again" lists repeats but there is no Problem record.'],
  ['Change management', 'Plan, approve and track changes with roll-out and back-out plans.', 'Not in CK Desk', ''],
  ['Release management', 'Group changes into releases.', 'Not in CK Desk', ''],
  ['Asset management and CMDB', 'Inventory of all assets, discovery, relationships, lifecycle.', 'Partial', 'CK Desk has AC and Genset lists from Google Sheets, no discovery and no general assets.'],
  ['Software licences and contracts', 'Track licences, contracts, warranty and expiry alerts.', 'Not in CK Desk', 'AMC vendor is only a text on the AC.'],
  ['Purchase module', 'Purchase requests, orders and receipts for all items.', 'Partial', 'CK Desk has vendor quotes and POs for repairs only.'],
  ['Self-service portal extras', 'Announcements, catalogue browsing, solutions suggested while typing.', 'Partial', 'Create Request page and Knowledge Base exist; no announcements or suggestions.'],
  ['Mobile app', 'Native iOS and Android apps for technicians and requesters.', 'Not in CK Desk', 'The web app is responsive and has browser push.'],
  ['AI assistant (Zia) and chatbot', 'Suggestions, auto-summaries, a chatbot.', 'Partial', '"Catch me up" summary exists; Bot is a plan; AI classification is built but switched off.'],
  ['Remote control', 'Take over a user\'s computer.', 'Not in CK Desk', ''],
  ['Preventive maintenance / scheduled requests', 'Auto-create recurring tickets (for example monthly AC service).', 'Not in CK Desk', 'Worth considering for AC servicing.'],
  ['Technician shifts and on-call', 'Availability, shifts, on-call schedules.', 'Not in CK Desk', ''],
  ['Custom modules and orchestration', 'Build your own modules and automate across tools.', 'Not in CK Desk', 'Business Rules cover automation inside CK Desk only.'],
  ['Integrations marketplace', 'Slack, Teams, Jira and many others.', 'Partial', 'CK Desk integrates with Google Sheets, the mailbox and a weather service.'],
  ['Multi-level SLA escalation', 'Several escalation levels per SLA.', 'Partial', 'CK Desk has rule-based escalation and alerts.'],
  ['Request merge and duplicate detection', 'Merge duplicate requests.', 'Partial', 'CK Desk blocks double submits; no merge screen.'],
]

const mark = (c, v) => {
  const done = v === D
  const off = v === OFF
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: done ? 'FFDFF3E3' : off ? 'FFE3E8F5' : 'FFFFF1CC' } }
  c.alignment = { horizontal: 'center', vertical: 'top', wrapText: true }
  c.font = { bold: true, color: { argb: done ? 'FF1B6B2F' : off ? 'FF2B4C8C' : 'FF8A5A00' } }
}
const border = { top: { style: 'thin', color: { argb: 'FFB0B7C3' } }, bottom: { style: 'thin', color: { argb: 'FFB0B7C3' } }, left: { style: 'thin', color: { argb: 'FFB0B7C3' } }, right: { style: 'thin', color: { argb: 'FFB0B7C3' } } }
const headStyle = (row) => row.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3F6E' } }; c.alignment = { vertical: 'middle', wrapText: true } })

function featureSheet(wb, name, list, withWho) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] })
  ws.columns = [{ width: 38 }, { width: 80 }, { width: 18 }, { width: 18 }, { width: 28 }, { width: 24 }, { width: 34 }, { width: 38 }]
  headStyle(ws.addRow(['Feature name', 'What it does (simple words)', 'Local dev server', 'Main (live) server', 'Area', 'Used by', 'Nearest area in ManageEngine ServiceDesk Plus', 'Note']))
  for (const r of list) {
    const row = ws.addRow([r.name, r.desc, r.local, r.main, r.module, withWho ? r.who.join(', ') : r.who.join(', '), r.me, r.note])
    row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = border })
    row.getCell(1).font = { bold: true }
    mark(row.getCell(3), r.local); mark(row.getCell(4), r.main)
  }
  ws.autoFilter = { from: 'A1', to: 'H1' }
  return ws
}

module.exports = { rows, gaps, D, P, OFF, R, T, M, V }

;(async () => {
  if (require.main !== module) return   // used as a data source by make-management-status-xlsx.cjs
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CityKart Desk'

  const sum = wb.addWorksheet('Summary')
  sum.columns = [{ width: 38 }, { width: 11 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 18 }]
  headStyle(sum.addRow(['Area', 'Features', 'Done on local', 'Done on main', 'Pending on main', 'Built, switched off']))
  const modules = [...new Set(rows.map((r) => r.module))]
  for (const m of modules) {
    const l = rows.filter((r) => r.module === m)
    const r = sum.addRow([m, l.length, l.filter((x) => x.local === D).length, l.filter((x) => x.main === D).length, l.filter((x) => x.main === P).length, l.filter((x) => x.main === OFF).length])
    r.eachCell((c) => { c.border = border })
  }
  const tot = sum.addRow(['TOTAL', rows.length, rows.filter((x) => x.local === D).length, rows.filter((x) => x.main === D).length, rows.filter((x) => x.main === P).length, rows.filter((x) => x.main === OFF).length])
  tot.eachCell((c) => { c.font = { bold: true }; c.border = border })
  sum.addRow([])
  sum.addRow([`Checked ${new Date().toISOString().slice(0, 10)}. Local = this PC (http://localhost:3210). Main = the live server (build 20261022-154801). Done = built and working. Pending = not there yet. Built - switched off = coded and tested but not switched on in the live system.`])
  sum.addRow(['The last column of each list names the nearest ManageEngine ServiceDesk Plus area from general knowledge of that product; check it against the edition you use.'])

  featureSheet(wb, 'All features', rows, true)
  for (const [name, role] of [['Requester', R], ['Technician', T], ['Manager and Admin', M], ['Vendor', V]]) featureSheet(wb, name, rows.filter((r) => r.who.includes(role)), false)

  const g = wb.addWorksheet('ManageEngine has more')
  g.columns = [{ width: 38 }, { width: 70 }, { width: 18 }, { width: 70 }]
  headStyle(g.addRow(['ManageEngine ServiceDesk Plus area', 'What it gives', 'In CK Desk?', 'Notes']))
  for (const x of gaps) { const row = g.addRow(x); row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = border }); row.getCell(1).font = { bold: true } }

  const out = path.resolve(__dirname, '..', 'docs', 'CKDESK-FEATURES-BY-ROLE.xlsx')
  await wb.xlsx.writeFile(out)
  console.log('written', out, '| rows:', rows.length, '| per area:', modules.map((m) => `${m}=${rows.filter((r) => r.module === m).length}`).join(', '))
})()
