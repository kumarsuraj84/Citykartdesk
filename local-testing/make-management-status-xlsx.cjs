// LOCAL: builds docs/CKDESK-MANAGEMENT-FEATURE-STATUS.xlsx for management.
// Features are shown the way the business thinks about them:
//   A. the REQUESTER's journey (raise a ticket -> resolve),
//   B. the TECHNICIAN's journey (open -> resolve),
//   C. ENHANCEMENTS that automate the technician's work and give visibility (clock, dashboards, reports, OEM mails ...),
//   D. the AC ticket handled directly by the VENDOR (journey and how it works),
//   E. FUTURE enhancements (not built yet) and a sheet for user / management feedback.
// Every row has a stage: LIVE on main, READY (built and tested, not live yet) or FUTURE (not built). Run: node local-testing/make-management-status-xlsx.cjs
const ExcelJS = require('exceljs')
const path = require('path')
const { gaps } = require('./make-features-by-role-xlsx.cjs')

const L = 'LIVE on main', RD = 'READY - built, not live', FU = 'FUTURE - not built'
const CORE = 'Before 20 Sep 2026'
const rows = { A: [], B: [], C: [], D: [], E: [] }
// sheet, step, feature, what happens (simple words), stage, live-since or release, note
const add = (sheet, step, feature, desc, stage, ref, note = '') => rows[sheet].push({ step, feature, desc, stage, ref, note })

// ═══ A. REQUESTER JOURNEY ═══════════════════════════════════════════════════════════════════
const a = (...x) => add('A', ...x)
a('1. Get in', 'Sign in, forgot password, invitation', 'Log in with your e-mail. Reset a forgotten password or accept an invitation by e-mail.', L, '21 Sep 2026')
a('1. Get in', 'Home page', 'Your open requests and quick numbers on one page.', L, CORE)
a('2. Raise the ticket', 'Create Request page', 'One page with three panels and personal shortcuts: pick what you need and raise it fast.', L, '24 Sep 2026')
a('2. Raise the ticket', 'Choose service, category and sub category', 'A catalogue of services; each category and sub category sets the priority and who handles it.', L, CORE)
a('2. Raise the ticket', 'Smart form for the service', 'Each service has its own form with required fields and rules.', L, CORE)
a('2. Raise the ticket', 'Number and text limits on the form', 'For example Qty must be 1 to 10000; text must be a sensible length. Checked on the screen and again on the server.', L, '22 Oct 2026')
a('2. Raise the ticket', 'Fields only for the right categories', 'A field such as Qty appears only for Fixtures and Hangers.', L, '19 Oct 2026')
a('2. Raise the ticket', 'Attach files', 'Add files, get a clear popup if one is too big, preview without downloading.', L, '3 Oct 2026')
a('2. Raise the ticket', 'Ticket title from the Subject', 'The ticket is named after the Subject you typed.', L, '21 Sep 2026')
a('2. Raise the ticket', 'No double tickets', 'Pressing Submit twice within 15 seconds makes one ticket.', L, '19 Oct 2026')
a('2. Raise the ticket', 'Ticket number and "request logged" e-mail', 'You get a ticket number and a mail straight away.', L, '21 Sep 2026')
a('2. Raise the ticket', 'Pick your own AC from a list', 'For an AC problem the form lists your store\'s own ACs, so the right AC is on the ticket.', RD, 'R1 AC sheet')
a('3. Track it', 'My Requests', 'All your requests with their status; managers also see their team.', L, CORE)
a('3. Track it', 'Who has it - "assigned to" mail', 'You are told which technician has your ticket.', L, '21 Sep 2026')
a('3. Track it', 'SLA clock on the ticket', 'See the time left, when it is paused, and when it is overdue.', L, CORE)
a('3. Track it', 'Bell and corner pop-up', 'A bell with an unread count and a small pop-up when something new arrives; you choose which events you want.', L, '9 Oct 2026')
a('3. Track it', 'Status mails with the technician\'s comment', 'Every status change is mailed with what the technician wrote.', L, '22 Sep 2026')
a('3. Track it', 'Ticket history', 'Every change is recorded in a timeline.', L, CORE)
a('3. Track it', 'Download as PDF', 'The ticket, your form, the whole conversation and the history in one PDF.', L, '9 Oct 2026')
a('3. Track it', 'My dashboard', 'A dashboard with only your own requests.', L, '8 Oct 2026')
a('4. Talk to the technician', 'Conversation with files', 'Write messages, add files, see replies and the technician\'s comments.', L, CORE)
a('4. Talk to the technician', 'Reply by e-mail', 'Answer a ticket mail and your reply is added to the conversation within a minute.', L, '22 Sep 2026')
a('4. Talk to the technician', 'Waiting on you', 'When the technician needs something from you the ticket waits (the clock pauses); your reply continues it.', L, CORE)
a('5. Approvals', 'Told when sent for approval', 'You are told that your request went for approval and to whom.', L, '22 Sep 2026')
a('5. Approvals', 'Automatic approval by the store\'s CVM', 'Fixtures and Hangers requests go to your store\'s CVM by themselves.', L, '19 Oct 2026', 'Works once your store\'s CVM is assigned in Admin (set-up in progress)')
a('5. Approvals', 'Rejected? Reopen within 48 hours', 'If the approval is rejected you can reopen the request within 48 hours.', L, '22 Sep 2026')
a('6. Resolution', 'Resolved mail with the note', 'You get the technician\'s resolution note in the mail.', L, '22 Sep 2026')
a('6. Resolution', 'Rate the fix', 'One click 1 to 5 stars in the mail; one reminder if you forget.', L, '8 Oct 2026')
a('6. Resolution', '"Not fixed" link', 'Reopen straight from the rating mail.', L, '8 Oct 2026')
a('7. If it is still broken', 'Reopen a resolved request', 'A banner with a live countdown, a compulsory remark and an expiry message.', L, '22 Sep 2026')
a('7. If it is still broken', 'Cancel your request', 'Cancel your own request; a remark is compulsory.', L, '22 Sep 2026')
a('7. If it is still broken', 'OEM mailed again when you reopen', 'A reopened AC or genset ticket goes to the OEM again.', RD, 'R1 AC sheet')
a('8. AC repaired by the vendor', 'See the vendor working on your AC', 'You see the vendor engineer\'s name and messages, the parts list or the quote.', RD, 'R8 - R10 Vendor')
a('8. AC repaired by the vendor', 'Mail when the parts list changes', 'If the vendor corrects the list of parts you get the new list.', RD, 'R9 Vendor parts')
a('8. AC repaired by the vendor', 'Plain mail if the repair is not approved', 'The ticket is cancelled with a simple message ("the cost of the repair was not approved") and you can reopen within 48 hours.', RD, 'R10 Vendor PO')
a('8. AC repaired by the vendor', 'Calendar of your store\'s faulty ACs', 'A green, yellow and red calendar of your own store with the fault history of each AC.', RD, 'R12 Calendar')
a('9. Also for requesters', 'Projects and Tasks', 'Plan project work and tasks with files and comments.', L, CORE)
a('9. Also for requesters', 'Knowledge Base', 'Read help articles before raising a ticket.', L, CORE)
a('9. Also for requesters', 'My Profile and notification choices', 'See who you report to; switch event types on or off.', L, CORE)

// ═══ B. TECHNICIAN JOURNEY ══════════════════════════════════════════════════════════════════
const b = (...x) => add('B', ...x)
b('1. Receive', 'Work queue (my queue and team queue)', 'New tickets appear in your queue; search by requester, store, technician, service, description; resolved ones are hidden by default.', L, '9 Oct 2026')
b('1. Receive', 'Automatic assignment', 'Business Rules give the ticket to the right technician (direct, round-robin or load-balanced).', L, CORE)
b('1. Receive', '"Assigned to you" bell and mail', 'You are told as soon as a ticket is yours.', L, '21 Sep 2026')
b('2. Take it', 'Start working', 'One click starts work and posts an automatic first response to the requester.', L, '5 Oct 2026')
b('2. Take it', 'Automatic time tracking', 'Time starts when you start work and stops when the ticket leaves In Progress.', L, CORE)
b('2. Take it', 'Priority from the sub category', 'Priority comes from the sub category; nobody can change it by hand, so it stays fair.', L, '15 Oct 2026')
b('2. Take it', '"Catch me up" summary', 'A short summary of what happened and what is pending, for a ticket you pick up late.', L, '15 Oct 2026')
b('2. Take it', 'SLA clock', 'Response and resolution clocks with time left, paused and breached.', L, CORE)
b('3. Work on it', 'Read the requester\'s form and files', 'Everything the requester filled in, with file preview.', L, '3 Oct 2026')
b('3. Work on it', 'Technician-only fields', 'Fields only staff fill in (for example the AC OEM ticket number).', L, CORE)
b('3. Work on it', 'Internal notes', 'Notes only Citykart staff can see.', L, CORE)
b('3. Work on it', 'Public reply with files', 'Reply to the requester with files; replies by e-mail also land here.', L, CORE)
b('3. Work on it', 'CC a comment to people and OEM contacts', 'Send a comment, with the whole ticket, to CK Desk users and OEM contacts.', L, '9 Oct 2026')
b('4. Wait or hold', 'Waiting on user', 'The clock pauses; a remark is compulsory; the requester\'s reply continues it.', L, CORE)
b('4. Wait or hold', 'Hold due to Purchase from HO', 'A status for tickets waiting for a Head Office purchase; clock pauses; remark needed to start and to end.', L, '30 Sep 2026')
b('4. Wait or hold', 'Pause credit', 'Paused time is added back to the due time when work resumes.', L, CORE)
b('5. Approvals', 'Send for approval', 'Send to approvers; add approvers while pending; first answer decides; nobody approves their own request. Fixtures and Hangers go to the store\'s CVM by themselves.', L, '5 Oct 2026', 'The automatic CVM part works once each store\'s CVM is assigned in Admin')
b('5. Approvals', 'Approvals page and quick approve', 'See what waits for you and decide from the list or the bell; approve from the e-mail link.', L, '12 Oct 2026')
b('5. Approvals', 'Daily approval reminder', 'One mail at 10:00 listing everything still waiting for your decision.', L, '15 Oct 2026')
b('6. Equipment tickets', 'OEM contact in the conversation', 'The full mail sent to the OEM and the OEM\'s replies appear in the ticket.', L, '14 Oct 2026')
b('6. Equipment tickets', 'Hand the ticket to a vendor engineer', 'A rule gives the AC ticket to the OEM\'s own engineer; the ticket shows "With vendor".', RD, 'R8 Vendor')
b('6. Equipment tickets', 'End a vendor hold yourself', 'You can take the ticket back from hold; the vendor is told and his request is closed.', RD, 'R9 Vendor parts')
b('6. Equipment tickets', 'PO approval page', 'Approve a vendor quote (PO number, date, document), ask for a revised price, reject only the quote, or reject and cancel.', RD, 'R10 Vendor PO')
b('7. Resolve', 'Resolve with a proper note', 'The note must say what was done (10+ characters) and never carry a password.', L, '15 Oct 2026')
b('7. Resolve', 'Cancel with a remark', 'A remark is compulsory.', L, '22 Sep 2026')
b('7. Resolve', 'Resolved mail with rating links', 'The requester gets your note and one-click rating and reopen links.', L, '8 Oct 2026')
b('8. After resolve', 'Reopened ticket comes back to you', 'A reopened ticket returns with the reason; the reopen count is kept.', L, '22 Sep 2026')
b('8. After resolve', 'Auto-close after the reopen window', 'A resolved ticket closes by itself when nobody reopens it in time.', L, CORE, 'Runs whenever someone opens the Home page (there is no scheduled job)')
b('9. Day-to-day tools', 'Bulk actions', 'Act on many tickets at once (up to 500).', L, CORE)
b('9. Day-to-day tools', 'Nudge', 'Remind the handling technician from the dashboard.', L, '9 Oct 2026')
b('9. Day-to-day tools', 'Several technician groups', 'One technician can belong to many groups.', L, '1 Oct 2026')
b('9. Day-to-day tools', 'Ticket as PDF', 'Download the ticket, conversation and history.', L, '9 Oct 2026')
b('9. Day-to-day tools', 'Projects and Tasks', 'Plan project work and tasks.', L, CORE)
b('10. Manager and admin set-up', 'Business Rules', 'Rules that assign, set status, priority or team and notify; searchable.', L, '14 Oct 2026')
b('10. Manager and admin set-up', 'Services, forms, SLA, approval flows, users, roles', 'All the screens that define how tickets are handled and who can do what.', L, CORE)
b('10. Manager and admin set-up', 'Store Master', 'Stores with cluster, region, state, AC brand and priority; Excel upload and export.', L, '12 Oct 2026')
b('10. Manager and admin set-up', 'AC and Genset master screens', 'Lists with filters, counts by brand, tonnage, region and Excel download.', RD, 'R5 Master screens')
b('10. Manager and admin set-up', 'Admin: vendors', 'Create vendor companies and engineer logins; set the default PO approver.', RD, 'R8 Vendor')

// ═══ C. ENHANCEMENTS ════════════════════════════════════════════════════════════════════════
const c = (...x) => add('C', ...x)
c('Automates the technician\'s work', 'AC ticket: automatic mail to the store\'s OEM', 'When a store raises an AC ticket, the OEM gets a table-style mail by itself and the ticket moves to In Progress. No manual mail.', L, '3 Oct 2026', 'Removes: writing to the OEM and starting the ticket. Confirmed working on main; works when the store has an AC OEM mapped')
c('Automates the technician\'s work', 'Genset ticket: automatic OEM mail and In Progress', 'The same for genset tickets. The code is already on main but is NOT switched on: it needs the category set to Genset in Admin and a Genset OEM on each store. The Genset sheet (R2) would supply the addresses.', RD, 'Set-up now; R2 for the sheet', 'Removes: writing to the OEM and starting the ticket')
c('Automates the technician\'s work', 'OEM by type (AC and Genset)', 'One OEM per type per store; a category can be set to send to the store\'s OEM.', L, '19 Oct 2026', 'Removes: choosing the right OEM by hand')
c('Automates the technician\'s work', 'OEM replies come back into the ticket', 'OEM mail replies are posted into the conversation.', L, '14 Oct 2026', 'Removes: copying OEM replies')
c('Automates the technician\'s work', 'Automatic assignment rules', 'Rules assign tickets by service, category, store or AC vendor.', L, CORE, 'Removes: manual assignment')
c('Automates the technician\'s work', 'Automatic first response', 'Start working posts the first response by itself.', L, '5 Oct 2026', 'Removes: typing a first reply')
c('Automates the technician\'s work', 'Automatic CVM approval', 'Fixtures and Hangers go to the store\'s CVM for approval by themselves.', L, '19 Oct 2026', 'Removes: finding and asking the CVM. Works once each store\'s CVM is assigned in Admin')
c('Automates the technician\'s work', 'Automatic mails to the requester', 'Logged, assigned, status changes, resolved: all mailed with the technician\'s comment.', L, '21 Sep 2026', 'Removes: telling the requester')
c('Automates the technician\'s work', 'Automatic time tracking', 'Time is recorded without start and stop buttons.', L, CORE, 'Removes: timers')
c('Automates the technician\'s work', 'Reply by e-mail', 'Mail replies are read every minute and posted into the ticket.', L, '22 Sep 2026', 'Removes: logging in to answer')
c('Automates the technician\'s work', 'Daily approval reminder', 'Approvers get one mail a day listing what waits.', L, '15 Oct 2026', 'Removes: chasing approvers')
c('Automates the technician\'s work', 'SLA alerts and escalation', 'Rules check every 15 minutes and mail alerts; a daily digest at 08:00.', L, CORE, 'Removes: watching clocks')
c('Automates the technician\'s work', 'Automatic close after the reopen window', 'Resolved tickets close by themselves.', L, CORE, 'Removes: closing tickets. Runs whenever someone opens the Home page')
c('Automates the technician\'s work', 'No double tickets', 'Identical submissions within 15 seconds make one ticket.', L, '19 Oct 2026', 'Removes: merging duplicates')
c('Automates the technician\'s work', 'AC and Genset data from Google Sheets', 'The AC, Genset and CVM sheets are copied into CK Desk three times a day; no more typing OEM lists in admin screens.', RD, 'R1 / R2 / R3 Sheets', 'Removes: keeping OEM addresses by hand')
c('Automates the technician\'s work', 'OEM mailed again on reopen', 'A reopened AC or genset ticket goes to the OEM again.', RD, 'R1 AC sheet', 'Removes: writing to the OEM again')
c('Automates the technician\'s work', 'AC tickets handled directly by the vendor', 'A rule gives the AC ticket to the OEM\'s engineer, who works it himself (see sheet D).', RD, 'R8 - R11 Vendor', 'Removes: the Citykart technician acting as a go-between')
c('Visibility - the clock', 'SLA clock on every ticket', 'Time left, paused and overdue shown on the ticket, lists and dashboards.', L, CORE, 'Shows: which tickets are at risk')
c('Visibility - the clock', 'Reopen countdown banner', 'A live countdown on a resolved ticket for the time left to reopen.', L, '22 Sep 2026', 'Shows: how long the requester can reopen')
c('Visibility - the clock', 'Highest-open and backlog banners', 'A banner with the technician groups that have the most open tickets.', L, '5 Oct 2026', 'Shows: where the backlog is')
c('Visibility - the clock', 'Nine-bucket ageing', 'Open tickets counted by age (0-5, 6-10 ... over 90 days).', L, '24 Sep 2026', 'Shows: how old the backlog is')
c('Interactive dashboards', 'Smart Dashboard', 'One interactive dashboard for every role, narrowed to what the viewer may see.', L, '8 Oct 2026')
c('Interactive dashboards', 'KPI scorecard with trend', 'Created, resolved, backlog, breaches, SLA %, resolution time, CSAT, reopened, first response, each with a trend.', L, '8 Oct 2026')
c('Interactive dashboards', 'Click-to-drill pop-up', 'Click a number to go from the group to stores and technicians to the ticket and its history.', L, '8 Oct 2026')
c('Interactive dashboards', 'Cascading filters and periods', 'Group, technician, region, state, cluster, store type, OEM brand, AC health, status, SLA, search; 30/60/90/120 days, financial year or custom.', L, '8 Oct 2026')
c('Interactive dashboards', 'Highlights, Stores and Regions, Group and OEM matrix, Workload', 'Priority signals and several views of the same data.', L, '8 - 12 Oct 2026')
c('Interactive dashboards', 'Export from the dashboard', 'Download the filtered tickets as CSV.', L, '9 Oct 2026')
c('Interactive dashboards', 'Technician dashboard and workload', 'Group workload, daily activity and ageing for technicians and managers.', L, '24 Sep 2026')
c('Interactive dashboards', 'Service, Category and Sub category filters', 'Three more filters, each narrowing the next.', RD, 'R12 Calendar')
c('Ticket Calendar', 'Ticket Calendar for every group', 'A month calendar named after the group ("IT Ticket Calendar"); days green, yellow, red; grey for the future; by store, cluster, region or state.', RD, 'R12 Calendar')
c('Ticket Calendar', 'Faulty AC and genset calendar', 'Share of faulty machines per day, with ACs that fail again and again by serial number and the worst places.', RD, 'R12 Calendar (needs R1)')
c('Ticket Calendar', 'Break-down and same-issue-again lists', 'By technician, cluster, region, state, store, category; and the same store raising the same issue again.', RD, 'R12 Calendar')
c('Ticket Calendar', 'Outside temperature', 'The day\'s highest and lowest temperature for AC and genset views, collected once a day at 08:00.', RD, 'R12 Calendar')
c('Predefined reports', 'Predefined Reports', '12 fixed Excel-style reports plus weekly, monthly, priority-wise and repeated AC complaint reports; search by name.', L, '12 Oct 2026')
c('Predefined reports', 'Report Analytics', 'Age bucket, ticket status, store-wise, AC Not Working and AMC vendor reports with expand and collapse.', L, '8 Oct 2026')
c('Predefined reports', 'Report Builder and saved reports', 'Build your own report, save it, export to Excel.', L, '1 Oct 2026')
c('Predefined reports', 'Excel and CSV exports', 'Download a report or a list as CSV or Excel; every export is logged.', L, CORE)
c('Automates the technician\'s work', 'Browser push notifications', 'Push messages in the browser for new events. The code is on main but the live server has no push keys, so it is switched off.', RD, 'Set-up only (add push keys)', 'Removes: having to look at the bell')
c('Predefined reports', 'Red-flag stores and AC reports', 'Stores whose open AC tickets exceed a share of their ACs.', L, '12 Oct 2026')
c('Control and trust', 'System Log (tamper-evident)', 'One Logs menu with a log that cannot be changed quietly, ticket activity and errors.', L, '14 Oct 2026')
c('Control and trust', 'Security hardening', 'All audit findings fixed (Critical, High, Medium).', L, '13 - 19 Oct 2026')

// ═══ D. AC TICKET HANDLED BY THE VENDOR ═════════════════════════════════════════════════════
const d = (...x) => add('D', ...x)
d('1', 'Store raises the AC ticket', 'The store picks its own AC from a list. A copy of the AC details is saved with the ticket.', RD, 'R1', 'Store')
d('2', 'Rule picks the vendor engineer', 'A Business Rule reads the AC\'s AMC vendor (for example Voltas) and gives the ticket to one of that vendor\'s engineers, round-robin. The rule must run before the old "Krishan" rule.', RD, 'R8', 'System')
d('3', 'Everybody is told', 'The vendor gets "assigned to you"; the store gets "assigned"; the OEM gets the ticket mail from the sheet\'s OEM Ticket Mail To column. The ticket stays Open.', RD, 'R8', 'System')
d('4', 'Vendor opens his dashboard', 'He sees his own tickets in boxes: Revise price required, Open, In process, Part required, PO required, Resolved, Cancelled, each with whose turn it is.', RD, 'R8', 'Vendor')
d('5', 'Start working', 'He enters the OEM\'s ticket number; the ticket goes to In Progress; the store is told.', RD, 'R8', 'Vendor')
d('6a', 'Repair done: resolve', 'He picks the fix from the AC RESOLUTION list (or Other with a note) and attaches the FSR (compulsory). The store gets the rating mail.', RD, 'R8', 'Vendor')
d('6b', 'Part needed (no PO): Part required', 'He lists the parts; the ticket goes on hold and the clock pauses; the store is told. He can correct the list (the store gets the new list) or withdraw. When the parts come he presses Parts received with a remark.', RD, 'R9', 'Vendor')
d('6c', 'Part needed with a PO: PO required', 'He lists items and prices (without GST) and attaches his quote (compulsory). The ticket goes on hold; the approver(s) named in the AC sheet column CK PO Approver Mail To (or the default approver) get one mail; any one can decide.', RD, 'R10', 'Vendor')
d('7a', 'Approver approves', 'He enters the PO number, date and document. The ticket returns to In Progress; the OEM gets the PO with the document; the vendor and the store are mailed.', RD, 'R10', 'Approver')
d('7b', 'Approver asks for a lower price', 'The ticket moves to the vendor\'s "Revise price required" box. He sends a new quote (new file, new version); the old version can no longer be approved; the approver is mailed again.', RD, 'R10', 'Approver / Vendor')
d('7c', 'Approver rejects only the quote', 'The ticket is NOT cancelled. The vendor arranges the parts himself and presses Parts received.', RD, 'R10', 'Approver')
d('7d', 'Approver rejects and cancels', 'The ticket is cancelled. The OEM, the store and the vendor get plain mails ("do not do any further work"; the store may reopen within 48 hours).', RD, 'R10', 'Approver')
d('8', 'Citykart can step in', 'A Citykart technician can end a hold himself; the vendor is told and his request is closed. The vendor can also withdraw his own request.', RD, 'R9', 'Technician / Vendor')
d('9', 'Rating and reopen', 'The store rates the fix. If it reopens, the vendor gets a "REOPENED" mail and a red "Reopened xN" tag, his old OEM ticket number is cleared and he must enter the new one; the OEM is mailed again.', RD, 'R8 / R11', 'Store / Vendor')
d('10', 'Registers and views', 'Vendors see "My POs"; Citykart sees the Purchase orders register; both can download Excel. A vendor manager sees his company\'s tickets, view only.', RD, 'R10', 'Vendor / Citykart')
d('11', 'Set-up needed before it goes live', 'Create the vendor companies and engineer logins (Admin, Vendors); write the routing rules; fill the three AC sheet columns (OEM Ticket Mail To, OEM PO Mail To, CK PO Approver Mail To); choose the default approver.', RD, 'R8 - R10', 'Admin')

// ═══ E. FUTURE ══════════════════════════════════════════════════════════════════════════════
const e = (...x) => add('E', ...x)
e('Reports', 'Send scheduled reports by e-mail', 'The screens to define a schedule exist, but no job sends the reports yet.', FU, '', 'Found while verifying')
e('Vendor flow', 'Reminder for a waiting quote', 'Mail the approver after 1 day if a quote is waiting, and the vendor after 2 days if a revised price is not answered.', FU, '', 'Our list')
e('Vendor flow', 'Vendor replies by e-mail', 'A vendor answers a ticket mail and the reply appears in the conversation (to be tested for vendors).', FU, '', 'Our list')
e('Dashboards', 'More figures from the sheets', 'ACs by brand, region and AMC vendor; repeat-failure ACs on the main dashboard.', FU, '', 'Our list')
e('Calendar', 'Correct reopened tickets', 'Use the ticket history so a reopened ticket counts only for the time it was really open.', FU, '', 'Our list')
e('Calendar', 'Year view and weekday pattern', 'Twelve small months side by side; which weekdays are busiest.', FU, '', 'Our list')
e('Calendar', 'Weather fallback by the nearest store', 'For cities the weather service cannot find, use the nearest store of the same cluster.', FU, '', 'Our list')
e('Data quality', 'Fix city names in the Store Master', 'Correct about 20 misspelt or wrong-state city names so each store has a temperature.', FU, '', 'Our list')
e('Equipment', 'Preventive maintenance', 'Create AC servicing tickets automatically every month or quarter.', FU, '', 'ManageEngine comparison')
e('Equipment', 'Problem management for repeat faults', 'Open a "problem" for an AC that keeps failing and track the root cause and the replacement decision.', FU, '', 'ManageEngine comparison')
e('Equipment', 'Asset register beyond AC and Genset', 'Fans, fixtures, water coolers and other equipment with history.', FU, '', 'ManageEngine comparison')
e('Field staff', 'Mobile app', 'An installable app (today the website works on phones, with browser push).', FU, '', 'ManageEngine comparison')
e('Field staff', 'Technician shifts and on-call', 'Who is available and who is on call.', FU, '', 'ManageEngine comparison')
e('Service', 'Several escalation levels', 'More than one escalation step when an SLA is at risk.', FU, '', 'ManageEngine comparison')
e('Service', 'Merge duplicate tickets', 'Combine two tickets about the same problem.', FU, '', 'ManageEngine comparison')
e('Assistants', 'CK Desk Bot', 'Ask questions in plain words about tickets and the knowledge base (plan only).', FU, '', 'Our list')
e('Assistants', 'Google Workspace user sync', 'Create and update users from Google Workspace (plan only).', FU, '', 'Our list')
e('Channels', 'Switch on e-mail intake', 'Turn on the already-built e-mail intake with human review (a decision is needed).', FU, '', 'Decision pending')
e('Operations', 'Secure web address (HTTPS)', 'A company web address with HTTPS; also removes the Google sign-in restriction.', FU, '', 'Operations')
e('Operations', 'Remove the temporary security setting', 'Turn off the temporary shared-secret setting still on in the live system.', FU, '', 'Operations')
e('Operations', 'Make the permission matrix real', 'Today it is only a display; decide to wire it up or remove it.', FU, '', 'Decision pending')
e('Operations', 'First-response clock after a reopen', 'Decide whether the response time restarts on a reopen (today only the resolution time restarts).', FU, '', 'Decision pending')
e('Operations', 'Remaining small security items', 'The few low-risk findings left in the audit register.', FU, '', 'Operations')

const releases = [
  ['R1', 'AC Google Sheet is the master', 'AC sheet copied three times a day; the ticket form shows the store\'s own ACs; the OEM mail comes from the sheet; OEM mailed again on reopen.', 'Yes (new tables only)', 'Nothing', 'Connect Google (one-time localhost step), give the sheet address, add one scheduled task', 'Medium'],
  ['R2', 'Genset Google Sheet', 'Same for gensets.', 'Yes', 'R1', 'Switch on in Admin', 'Low-Medium'],
  ['R3', 'CVM Google Sheet', 'The store\'s CVM comes from the CVM sheet.', 'Yes', 'R1', 'Switch on in Admin', 'Medium'],
  ['R5', 'AC and Genset master screens', 'Lists with filters, counts, Excel.', 'No', 'R1', 'Nothing', 'Low'],
  ['R8', 'Vendor - core', 'Vendor engineers log in, work their AC tickets; manager view; rules route AC tickets to them.', 'Yes', 'R1', 'Vendor companies and logins; routing rules before the old Krishan rule', 'Medium-High'],
  ['R9', 'Vendor - Part required', 'Parts list, hold, Parts received; Citykart can end a hold.', 'Yes', 'R8', 'Nothing', 'Medium'],
  ['R10', 'Vendor - PO required', 'Quote, approval, revised price, versions, PO register; approvers from the AC sheet.', 'Yes', 'R1, R8, R9', 'The three AC sheet columns; the default approver', 'Medium-High'],
  ['R11', 'Vendor mails and Reopened tag', 'All the vendor, store and OEM mails of the vendor flow.', 'No', 'ships with R8 - R10', 'Nothing', 'Low'],
  ['R12', 'Ticket Calendar and new filters', 'Calendar for every group; Service, Category, Sub category filters; daily temperature.', 'Yes (weather tables)', 'Ticket-count view: nothing. AC / genset view: R1 (and R2)', 'One scheduled task at 08:00 (the server can already reach the weather service)', 'Medium'],
]

const REL = {}
;[['R1', ['Pick your own AC', 'OEM mail again on reopen', 'Google Sheets as master data', 'Sheet health page']], ['R3', ['CVM from the sheet']], ['R5', ['AC and Genset master screens']],
  ['R8', ['Vendor logins (technician and manager)', 'Hand AC tickets to a vendor technician', 'End a vendor hold yourself', 'Rules for vendor technicians', 'Vendor dashboard', 'Vendor manager view', 'Start working with the OEM ticket number', 'Resolve with AC RESOLUTION list and FSR', 'Messages with the store', 'Safe vendor access']],
  ['R9', ['Part required (no PO)']], ['R10', ['PO required with a quote', 'Revise price required', 'Quote versions', 'Reject only the quote', 'PO approval page', 'Approvers from the AC sheet', 'Default PO approver', 'Purchase orders register', 'OEM mail on PO decision']],
  ['R11', ['Vendor e-mails', 'Reopened tag']], ['R12', ['Service, Category and Sub category filters', 'Daily weather job']], ['Set-up now', ['Genset ticket: automatic OEM e-mail and In Progress', 'Browser push notifications']]].forEach(([r, names]) => names.forEach((n) => { REL[n] = r }))
for (const r of require('./make-features-by-role-xlsx.cjs').rows) if (r.module === 'Ticket Calendar') REL[r.name] = 'R12'

// feature, evidence, finding, result, final stage
const VERIFY = [
  ['AC ticket: automatic OEM mail and In Progress', 'Code on main: lib/requests/create-request-core.ts (runOemAutoRouting, then status In Progress). Confirmed by the owner as working live.', 'The OEM gets one table-style mail and the ticket moves to In Progress by itself. With no AC OEM on the store it stays a normal ticket, silently.', 'Confirmed (code + owner)', L],
  ['Genset ticket: automatic OEM mail and In Progress', 'Code on main: lib/oems/route.ts and create-request-core.ts. Owner: "genset tickets are not triggering on main".', 'The code CAN do it, but only for a category switched to "Genset" in Admin and a store that has a Genset OEM; otherwise it only leaves a note. Not switched on today.', 'Code present, NOT switched on', RD],
  ['Automatic CVM approval', 'Code on main: lib/cvm/auto-approval.ts; records say the CVM screens went live 19 Oct with the set-up still to be done.', 'Works for a category switched to "send to CVM" once the store has a CVM assigned. Set-up of store CVMs is in progress.', 'Code live; needs set-up', L],
  ['Automatic assignment by Business Rules', 'Code: lib/rules; the live app server has the BusinessRules scheduled task.', 'Rules run on create and on a schedule.', 'Confirmed (code + live task)', L],
  ['Automatic first response', 'Code on main: lib/requests/status-change.ts (first response on Start working).', 'Start working posts the first response.', 'Confirmed (code)', L],
  ['Automatic time tracking', 'Code on main: status-change.ts (time entry opened and stopped).', 'Starts and stops with the status.', 'Confirmed (code)', L],
  ['Reply by e-mail into the ticket', 'Code: app/api/email/inbound-sync; the live server has the EmailReplySync task.', 'Replies are read every minute. The mailbox itself is set in Platform Settings (not readable here).', 'Confirmed (code + live task)', L],
  ['Daily approval reminder 10:00', 'Code: app/api/approvals/reminders; the live server has the ApprovalReminders task.', 'One mail per approver listing what waits.', 'Confirmed (code + live task)', L],
  ['Rate the fix (CSAT)', 'Code: app/api/csat/run; the live server has the Csat task.', 'Rating mail and reminder.', 'Confirmed (code + live task)', L],
  ['SLA alerts, escalation and daily digest', 'Code: app/api/alerts/run and business-rules/run; the live server has the Alerts and BusinessRules tasks.', 'Alert rules and schedule rules run.', 'Confirmed (code + live tasks)', L],
  ['Auto-close after the reopen window', 'Code on main: autoCloseRequests is called when the Home page opens; no scheduled job calls it.', 'Works while the system is in use, but not by a timer.', 'Confirmed with a limit', L],
  ['Scheduled reports sent by e-mail', 'Code on main: only the admin screens (lib/actions/admin/reports.ts) exist; nothing in the scheduled jobs sends a report.', 'You can define a schedule, but nothing is sent. Earlier lists said it was working; that was wrong.', 'NOT working (corrected)', FU],
  ['Browser push notifications', 'Code on main: lib/push/send.ts needs VAPID keys; the live server settings list has no push keys (names checked, values hidden).', 'Not switched on.', 'Code present, NOT switched on', RD],
  ['E-mail intake with human review', 'Design record: the intake module is disabled for the organisation; no intake job on the live server.', 'Built, switched off.', 'Built, off', FU],
  ['SLA clock on tickets', 'Code on main: ticket components with the countdown, reopen banners.', 'Time left, paused, overdue are shown.', 'Confirmed (code)', L],
  ['Smart Dashboard and its views', 'Code on main: app/(app)/dashboards/executive; the live build equals main.', 'All views are part of the live build.', 'Confirmed (code + live build)', L],
  ['Predefined Reports, Report Analytics, Report Builder, saved reports', 'Code on main: lib/queries/fixed-reports.ts, reports/analytics, lib/actions/reporting.ts.', 'Present in the live build.', 'Confirmed (code)', L],
  ['"Catch me up", ticket PDF, reopen banner, Hold due to Purchase from HO', 'Code on main: requests/[id] page, api/requests/[id]/pdf, constants for hold_purchase_ho.', 'Present in the live build.', 'Confirmed (code)', L],
  ['Number and text limits', 'Release 7 deployed 22 Oct; the live build id equals main 03959d0.', 'Live.', 'Confirmed (deploy record + build id)', L],
  ['OEM by type, store CVM, category fields', 'Migrations 172-174 recorded as applied on 19 Oct; code on main.', 'Live in code; the live database was not queried.', 'Confirmed (records)', L],
  ['Security fixes and System Log', 'Migrations 156-171 recorded as applied; the live server has the SystemLogArchive and LogShipper tasks.', 'Live.', 'Confirmed (records + live tasks)', L],
  ['Google Sheets as master data', 'Main has no sheet code or sheet tables; the live server has no Google settings and no sheet sync task.', 'Not on main. The live server CAN reach Google.', 'Confirmed not live', RD],
  ['Vendor technicians, parts, PO', 'Main has no vendor tables or pages.', 'Not on main.', 'Confirmed not live', RD],
  ['Ticket Calendar, new filters, weather', 'Main has no calendar, no Service / Category / Sub category filters and no weather job. The live server CAN reach the weather service.', 'Not on main.', 'Confirmed not live', RD],
  ['Tests', 'A clean copy of main: type check and 1456 unit tests pass. This PC: 1539 unit tests and the sheet, vendor, mail and calendar integration suites pass.', 'Both pass.', 'Confirmed', L],
]

// ═══ the workbook ═══════════════════════════════════════════════════════════════════════════
const border = { top: { style: 'thin', color: { argb: 'FFB0B7C3' } }, bottom: { style: 'thin', color: { argb: 'FFB0B7C3' } }, left: { style: 'thin', color: { argb: 'FFB0B7C3' } }, right: { style: 'thin', color: { argb: 'FFB0B7C3' } } }
const STAGE_FILL = { [L]: 'FFDFF3E3', [RD]: 'FFDDE9FB', [FU]: 'FFFFF1CC' }
const STAGE_FONT = { [L]: 'FF1B6B2F', [RD]: 'FF1F4F9A', [FU]: 'FF8A5A00' }
const head = (row, argb = 'FF1F3F6E') => row.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; c.alignment = { vertical: 'middle', wrapText: true } })
const body = (row) => row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = border })
const title = (ws, text, cols, argb = 'FF1F3F6E') => {
  const r = ws.addRow([text]); ws.mergeCells(1, 1, 1, cols)
  r.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; r.height = 26; r.getCell(1).alignment = { vertical: 'middle' }
}
const stageCell = (cell, stage) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STAGE_FILL[stage] } }
  cell.font = { bold: true, color: { argb: STAGE_FONT[stage] } }
  cell.alignment = { vertical: 'top', wrapText: true, horizontal: 'center' }
}
const count = (list, st) => list.filter((x) => x.stage === st).length

;(async () => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CityKart Desk'
  const today = new Date().toISOString().slice(0, 10)
  const sheetsDef = [
    ['A', 'A Requester journey', 'A. REQUESTER - the journey of a ticket from raise to resolve', 'FF1B6B2F', ['Step', 'Feature', 'What happens (simple words)', 'Stage', 'Live since / release', 'Note']],
    ['B', 'B Technician journey', 'B. TECHNICIAN - how a ticket is handled from open to resolve', 'FF1F3F6E', ['Step', 'Feature', 'What happens (simple words)', 'Stage', 'Live since / release', 'Note']],
    ['C', 'C Enhancements', 'C. ENHANCEMENTS - automate the technician\'s work and give visibility', 'FF5A3E8A', ['Theme', 'Enhancement', 'What it does (simple words)', 'Stage', 'Live since / release', 'Manual work it removes / what it shows']],
    ['D', 'D AC by vendor', 'D. AC TICKET HANDLED DIRECTLY BY THE VENDOR - how it works, step by step', 'FF2B4C8C', ['Step', 'What happens', 'How it works (simple words)', 'Stage', 'Release', 'Who']],
    ['E', 'E Future', 'E. FUTURE ENHANCEMENTS - not built yet', 'FF8A5A00', ['Area', 'Enhancement', 'What it would do (simple words)', 'Stage', 'Priority', 'Where the idea came from']],
  ]

  // Summary
  const s = wb.addWorksheet('Summary')
  s.columns = [{ width: 46 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 70 }]
  title(s, 'CK Desk - what we built, what is live, what is next', 5)
  s.addRow([`As on ${today}. Live server: build 20261022-154801 (checked read-only). Ready = built and tested on the development PC.`])
  s.addRow([])
  head(s.addRow(['Journey / group', 'LIVE on main', 'READY, not live', 'FUTURE', 'What it covers']))
  const cover = {
    A: 'The requester\'s complete journey from raising a ticket to its resolution, reopen and rating.',
    B: 'The technician\'s complete journey from receiving a ticket to resolving it, plus the manager and admin set-up.',
    C: 'Automation of the technician\'s work (auto OEM mails, auto In Progress, auto assignment), visibility (clock, interactive dashboards, calendar) and predefined reports.',
    D: 'The AC ticket worked directly by the OEM vendor: routing, boxes, parts, PO approval, revised price, mails, reopen.',
    E: 'Not built yet: ideas from our own review, the ManageEngine comparison and pending decisions. User and management feedback goes into the Feedback sheet.',
  }
  let tl = 0, tr = 0, tf = 0
  for (const [k, , t] of sheetsDef) {
    const list = rows[k]; tl += count(list, L); tr += count(list, RD); tf += count(list, FU)
    const row = s.addRow([t.replace(/ - .*$/, ''), count(list, L), count(list, RD), count(list, FU), cover[k]]); body(row)
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STAGE_FILL[L] } }; row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STAGE_FILL[RD] } }; row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STAGE_FILL[FU] } }
  }
  const tot = s.addRow(['All sheets (a feature can appear in more than one journey)', tl, tr, tf, '']); tot.eachCell((c) => { c.font = { bold: true }; c.border = border })
  s.addRow([])
  head(s.addRow(['Stage', '', '', '', 'Meaning']))
  for (const [st, m] of [[L, 'Working on the live server today. Everyone can use it.'], [RD, 'Built and tested. Not on the live server yet. Each can go live as one release; see sheet "Release plan".'], [FU, 'Not built yet. To be done in future.']]) { const r = s.addRow([st, '', '', '', m]); body(r); stageCell(r.getCell(1), st) }
  s.addRow([])
  s.addRow(['Verified against the code on main and the live server (sheet G). Corrections found: Genset automatic mail, browser push and scheduled-report mails are NOT working on main; auto-close runs when Home opens; automatic CVM approval needs the store CVMs assigned.'])
  s.addRow(['Built but switched off: e-mail intake with human review (a decision, in sheet E). WhatsApp and DeskTime are left out on purpose.'])
  s.addRow(['Sheet "ManageEngine has more" lists areas the ManageEngine ServiceDesk Plus product has that CK Desk does not; it is from general knowledge of that product, so check it against your edition.'])

  for (const [k, name, ttl, argb, cols] of sheetsDef) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2 }] })
    ws.columns = k === 'C' || k === 'D' ? [{ width: 30 }, { width: 44 }, { width: 84 }, { width: 24 }, { width: 24 }, { width: 38 }]
      : k === 'E' ? [{ width: 18 }, { width: 40 }, { width: 84 }, { width: 22 }, { width: 12 }, { width: 26 }]
      : [{ width: 26 }, { width: 42 }, { width: 84 }, { width: 24 }, { width: 24 }, { width: 44 }]
    title(ws, ttl, cols.length, argb)
    head(ws.addRow(cols), argb)
    for (const x of rows[k]) {
      const line = k === 'C' ? [x.step, x.feature, x.desc, x.stage, x.ref, x.note]
        : k === 'D' ? [x.step, x.feature, x.desc, x.stage, x.ref, x.note]
        : k === 'E' ? [x.step, x.feature, x.desc, x.stage, '', x.note]
        : [x.step, x.feature, x.desc, x.stage, x.ref, x.note]
      const row = ws.addRow(line); body(row); row.getCell(2).font = { bold: true }; stageCell(row.getCell(4), x.stage)
    }
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } }
  }

  // F: every feature of the complete list with its verified stage
  const all = require('./make-features-by-role-xlsx.cjs')
  const relOf = (name) => (REL[name] ?? '')
  const stageOf = (r) => (r.main === all.D ? L : r.local === all.D ? RD : FU)
  const fl = wb.addWorksheet('F All features (complete)', { views: [{ state: 'frozen', ySplit: 2, xSplit: 1 }] })
  fl.columns = [{ width: 38 }, { width: 80 }, { width: 24 }, { width: 14 }, { width: 28 }, { width: 24 }, { width: 34 }, { width: 50 }]
  title(fl, 'F. ALL FEATURES - the complete list with the verified stage', 8, 'FF444444')
  head(fl.addRow(['Feature name', 'What it does (simple words)', 'Stage', 'Release', 'Area', 'Used by', 'Nearest area in ManageEngine ServiceDesk Plus', 'Note']), 'FF444444')
  for (const r of all.rows) { const row = fl.addRow([r.name, r.desc, stageOf(r), relOf(r.name), r.module, r.who.join(', '), r.me, r.note]); body(row); row.getCell(1).font = { bold: true }; stageCell(row.getCell(3), stageOf(r)) }
  fl.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 8 } }

  // G: how each claim was confirmed
  const vg = wb.addWorksheet('G Verification', { views: [{ state: 'frozen', ySplit: 2 }] })
  vg.columns = [{ width: 5 }, { width: 38 }, { width: 62 }, { width: 70 }, { width: 28 }, { width: 24 }]
  title(vg, 'G. VERIFICATION - how each important claim was confirmed (read-only on main and the live server)', 6, 'FF444444')
  head(vg.addRow(['#', 'Feature', 'How it was checked (evidence)', 'What we found', 'Result', 'Final stage']), 'FF444444')
  VERIFY.forEach((v, i) => { const row = vg.addRow([i + 1, ...v]); body(row); row.getCell(2).font = { bold: true }; stageCell(row.getCell(6), v[4]) })
  vg.addRow([])
  vg.addRow(['The live database (10.0.0.205) was NOT queried: that needs the postgres password, which only the owner types. What is configured there (which categories and stores are switched on) comes from the owner. Everything else above was read from the code on main, the live version and health address, and the live app server (services, scheduled task names, setting names with values hidden).'])

  // Release plan
  const rp = wb.addWorksheet('Release plan')
  rp.columns = [{ width: 8 }, { width: 34 }, { width: 80 }, { width: 22 }, { width: 34 }, { width: 50 }, { width: 14 }]
  title(rp, 'READY features: the releases, what each needs, and what you must do', 7, 'FF2B4C8C')
  head(rp.addRow(['Release', 'Name', 'What it contains', 'Database step on the server', 'Needs first', 'Your set-up steps', 'Risk']), 'FF2B4C8C')
  for (const x of releases) { const row = rp.addRow(x); body(row); row.getCell(1).font = { bold: true } }
  rp.addRow([])
  rp.addRow(['Suggested order: R1, then R5; after a few calm days R2 and R3; then the vendor set R8, R9, R10 (with R11); R12 can go earlier in its ticket-count form. Each is pushed only when you say so, one at a time.'])

  // Feedback
  const fb = wb.addWorksheet('Feedback to add', { views: [{ state: 'frozen', ySplit: 2 }] })
  fb.columns = [{ width: 8 }, { width: 14 }, { width: 22 }, { width: 70 }, { width: 44 }, { width: 12 }, { width: 16 }, { width: 16 }]
  title(fb, 'Feedback from users and management - paste your feedback rows here', 8, 'FF5A3E8A')
  head(fb.addRow(['ID', 'Date', 'Raised by', 'Feedback / request (as received)', 'Proposed feature', 'Priority', 'Status', 'Target release']), 'FF5A3E8A')
  for (let i = 1; i <= 15; i++) { const row = fb.addRow([`F-${String(i).padStart(3, '0')}`, '', '', '', '', '', 'New', '']); body(row) }

  const me = wb.addWorksheet('ManageEngine has more')
  me.columns = [{ width: 38 }, { width: 70 }, { width: 18 }, { width: 70 }]
  title(me, 'Where ManageEngine ServiceDesk Plus has more (from general knowledge - check against your edition)', 4, 'FF444444')
  head(me.addRow(['ManageEngine area', 'What it gives', 'In CK Desk?', 'Notes']), 'FF444444')
  for (const x of gaps) { const row = me.addRow(x); body(row); row.getCell(1).font = { bold: true } }

  const out = path.resolve(__dirname, '..', 'docs', 'CKDESK-MANAGEMENT-FEATURE-STATUS.xlsx')
  await wb.xlsx.writeFile(out)
  console.log('written', out)
  for (const [k, , t] of sheetsDef) console.log(t.slice(0, 40).padEnd(42), 'live', count(rows[k], L), '| ready', count(rows[k], RD), '| future', count(rows[k], FU))
})()
