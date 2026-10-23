// LOCAL: builds docs/CKDESK-MANAGEMENT-FEATURE-STATUS.xlsx for management: 1) what is LIVE on main, 2) what is built and READY to go live, 3) what is planned for the FUTURE.
// The feature rows come from make-features-by-role-xlsx.cjs. Run: node local-testing/make-management-status-xlsx.cjs
const ExcelJS = require('exceljs')
const path = require('path')
const { rows, gaps, D, P, OFF } = require('./make-features-by-role-xlsx.cjs')

const CORE = 'Before 20 Sep 2026 (core)'
const since = {
  'Forgot password and invitation by e-mail': '21 Sep 2026', 'Password rules': '19 Oct 2026', 'Permission matrix with owner switches': '19 Oct 2026',
  'Technician groups and many groups per technician': '1 Oct 2026', 'Create Request page': '24 Sep 2026', 'Number and text limits in the form builder': '22 Oct 2026',
  'Fields limited to categories': '19 Oct 2026', 'Attachments with preview': '3 Oct 2026', 'Ticket title from the Subject field': '21 Sep 2026', 'No double tickets': '19 Oct 2026',
  'Start working with first response': '5 Oct 2026', 'Hold due to Purchase from HO': '30 Sep 2026', 'Resolution note rules': '15 Oct 2026', 'Cancel with a remark': '22 Sep 2026',
  'Reopen a resolved request': '22 Sep 2026', 'Reopen after a rejected approval': '22 Sep 2026', 'Priority from the sub category': '15 Oct 2026', 'Service of a ticket is locked': '15 Oct 2026',
  '"Catch me up" summary': '15 Oct 2026', 'Ticket as PDF': '9 Oct 2026', 'CC a comment': '9 Oct 2026', 'Reply by e-mail': '22 Sep 2026', 'OEM e-mail on AC and Genset tickets': '3 Oct 2026',
  'Ticket e-mails': '21 Sep 2026', 'Bell, unread count and pop-up': '9 Oct 2026', 'Approve from the e-mail link': '12 Oct 2026', 'Quick approve': '24 Sep 2026',
  'Add approvers and delegate': '5 Oct 2026', 'Separation of duties': '19 Oct 2026', 'Daily approval reminder': '15 Oct 2026', 'Automatic CVM approval': '19 Oct 2026', 'Rule search': '14 Oct 2026',
  'OEMs by type (AC and Genset)': '19 Oct 2026', 'Red-flag stores': '12 Oct 2026', 'AC and AMC reports': '12 Oct 2026', 'Store Master': '12 Oct 2026', 'Store CVM': '19 Oct 2026',
  'Interactive Smart Dashboard': '8 Oct 2026', 'KPI scorecard with trend': '8 Oct 2026', 'Click-to-drill pop-up (4 steps)': '8 Oct 2026', 'Cascading filter bar': '8 Oct 2026', 'Time periods': '8 Oct 2026',
  'Priority highlights strip': '8 Oct 2026', 'Stores and Regions view': '12 Oct 2026', 'Group and OEM matrix': '8 Oct 2026', 'Workload and Approvals view': '8 Oct 2026', 'Heatmap and ticket explorer': '8 Oct 2026',
  'Export from the dashboard': '9 Oct 2026', 'Technician dashboard and workload': '24 Sep 2026', 'Drag-and-drop dashboard widgets': '1 Oct 2026', 'Saved reports': '1 Oct 2026',
  'Report Analytics': '8 Oct 2026', 'Predefined Reports': '12 Oct 2026', 'India-time reporting': '14 Oct 2026', 'Rate the fix (CSAT)': '8 Oct 2026', 'Security hardening': '13 - 19 Oct 2026',
  'System Log (tamper-evident)': '14 Oct 2026', 'Monitoring and health': '14 Oct 2026', 'Notification rules': '14 Sep 2026', 'Browser push notifications': '14 Sep 2026',
}

// which release each "ready, not live" feature belongs to
const rel = {}
const put = (r, names) => names.forEach((n) => { rel[n] = r })
put('R1', ['Pick your own AC', 'OEM mail again on reopen', 'Google Sheets as master data', 'Sheet health page'])
put('R3', ['CVM from the sheet'])
put('R5', ['AC and Genset master screens'])
put('R8', ['Vendor logins (technician and manager)', 'Hand AC tickets to a vendor technician', 'End a vendor hold yourself', 'Rules for vendor technicians', 'Vendor dashboard', 'Vendor manager view', 'Start working with the OEM ticket number', 'Resolve with AC RESOLUTION list and FSR', 'Messages with the store', 'Safe vendor access'])
put('R9', ['Part required (no PO)'])
put('R10', ['PO required with a quote', 'Revise price required', 'Quote versions', 'Reject only the quote', 'PO approval page', 'Approvers from the AC sheet', 'Default PO approver', 'Purchase orders register', 'OEM mail on PO decision'])
put('R11', ['Vendor e-mails', 'Reopened tag'])
put('R12', ['Service, Category and Sub category filters', 'Daily weather job'])
for (const r of rows) if (r.module === 'Ticket Calendar') rel[r.name] = 'R12'

const releases = [
  ['R1', 'AC Google Sheet is the master', 'The AC sheet is copied into CK Desk three times a day; the ticket form shows the store\'s own ACs; the OEM mail comes from the sheet.', 'Yes (new tables only)', 'Nothing', 'Connect Google (needs a one-time localhost step), give the sheet address, add one scheduled task', 'Medium'],
  ['R2', 'Genset Google Sheet', 'Same idea for gensets: one mail to every OEM address of the store\'s gensets.', 'Yes', 'R1', 'Switch on in Admin', 'Low-Medium'],
  ['R3', 'CVM Google Sheet', 'The store\'s CVM comes from the CVM sheet.', 'Yes', 'R1', 'Switch on in Admin', 'Medium'],
  ['R5', 'AC and Genset master screens', 'Lists with filters, counts and Excel download.', 'No', 'R1', 'Nothing', 'Low'],
  ['R8', 'Vendor technicians - core', 'OEM engineers log in and work their AC tickets; vendor manager sees the company, view only.', 'Yes', 'R1', 'Create vendor companies and logins; write the routing rules (they must run before the old "Krishan" rule)', 'Medium-High'],
  ['R9', 'Vendor - Part required', 'Parts list, ticket on hold, Parts received.', 'Yes', 'R8', 'Nothing', 'Medium'],
  ['R10', 'Vendor - PO required', 'Quote with file, approval, revised price, quote versions, PO register; approvers from the AC sheet.', 'Yes', 'R1, R8, R9', 'Add the three AC sheet columns (OEM Ticket Mail To, OEM PO Mail To, CK PO Approver Mail To); set the default approver', 'Medium-High'],
  ['R11', 'Vendor mails and the Reopened tag', 'All the vendor, store and OEM mails of the vendor flow.', 'No', 'R8 to R10 (ships with them)', 'Nothing', 'Low'],
  ['R12', 'Ticket Calendar and the new filters', 'Calendar for every group; Service, Category and Sub category filters; daily outside temperature.', 'Yes (weather tables)', 'The ticket-count view needs nothing; the AC and genset view needs R1 (and R2)', 'Add one scheduled task at 08:00 (the server can already reach the weather service)', 'Medium'],
]

const future = [
  ['Reminder for a waiting quote', 'Mail the approver after 1 day if a quote is waiting, and the vendor after 2 days if a revised price is not answered.', 'Stops quotes getting stuck.', 'Our list'],
  ['Vendor replies by e-mail', 'A vendor answers a ticket mail and the reply appears in the conversation (to be tested for vendors).', 'Easier for engineers in the field.', 'Our list'],
  ['More dashboard figures from the sheets', 'ACs by brand, region and AMC vendor; repeat-failure ACs on the main dashboard.', 'Management view of equipment health.', 'Our list'],
  ['Calendar: correct reopened tickets', 'Use the ticket history so a reopened ticket is counted only for the time it was really open.', 'More accurate calendar colours.', 'Our list'],
  ['Calendar: year view and weekday pattern', 'Twelve small months side by side; which weekdays are busiest.', 'Shows the summer peak at a glance.', 'Our list'],
  ['Weather fallback by nearest store', 'For cities the weather service cannot find, use the nearest store of the same cluster.', 'Every store gets a temperature.', 'Our list'],
  ['Fix city names in the Store Master', 'Correct about 20 misspelt or wrong-state city names so each store has a temperature.', 'Data quality.', 'Our list'],
  ['Preventive maintenance', 'Create AC servicing tickets automatically every month or quarter.', 'Fewer breakdowns; ManageEngine has this.', 'ManageEngine comparison'],
  ['Problem management for repeat faults', 'Open a "problem" for an AC that keeps failing and track the root cause and the replacement decision.', 'Turns the repeat list into action.', 'ManageEngine comparison'],
  ['Asset register beyond AC and Genset', 'A list of other equipment (fans, fixtures, water coolers) with history.', 'One view of all equipment.', 'ManageEngine comparison'],
  ['Mobile app', 'An installable app for technicians and stores (today: the website works on phones, with browser push).', 'Field staff convenience.', 'ManageEngine comparison'],
  ['Technician shifts and on-call', 'Who is available and who is on call.', 'Better assignment.', 'ManageEngine comparison'],
  ['Several escalation levels', 'More than one escalation step when an SLA is at risk.', 'Faster response to risk.', 'ManageEngine comparison'],
  ['Merge duplicate tickets', 'Combine two tickets about the same problem.', 'Cleaner queues.', 'ManageEngine comparison'],
  ['CK Desk Bot', 'Ask questions in plain words about tickets and the knowledge base.', 'Quicker answers.', 'Our list (plan only)'],
  ['Google Workspace user sync', 'Create and update users from Google Workspace.', 'Less admin work.', 'Our list (plan only)'],
  ['Switch on e-mail intake', 'Turn on the already-built e-mail intake with human review (decision needed).', 'Tickets from mail.', 'Decision pending'],
  ['Secure web address (HTTPS)', 'A company web address with HTTPS; also removes the Google sign-in restriction.', 'Safer and simpler Google set-up.', 'Operations'],
  ['Remove the temporary security setting', 'Turn off the temporary shared-secret setting that is still on in the live system.', 'Security housekeeping.', 'Operations'],
  ['Make the permission matrix real', 'Today it is only a display; decide to wire it up or remove it.', 'Clear permissions.', 'Decision pending'],
  ['First-response clock after a reopen', 'Decide whether the response time restarts when a ticket is reopened (today only the resolution time restarts).', 'Fair SLA reporting.', 'Decision pending'],
  ['Remaining small security items', 'The few low-risk findings left in the audit register.', 'Security housekeeping.', 'Operations'],
]

const border = { top: { style: 'thin', color: { argb: 'FFB0B7C3' } }, bottom: { style: 'thin', color: { argb: 'FFB0B7C3' } }, left: { style: 'thin', color: { argb: 'FFB0B7C3' } }, right: { style: 'thin', color: { argb: 'FFB0B7C3' } } }
const head = (row, argb = 'FF1F3F6E') => row.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; c.alignment = { vertical: 'middle', wrapText: true } })
const body = (row) => row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = border })
const title = (ws, text, cols, argb) => {
  const r = ws.addRow([text]); ws.mergeCells(1, 1, 1, cols)
  r.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; r.height = 26
  r.getCell(1).alignment = { vertical: 'middle' }
}

;(async () => {
  const live = rows.filter((r) => r.main === D)
  const ready = rows.filter((r) => r.main === P && r.local === D)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CityKart Desk'
  const today = new Date().toISOString().slice(0, 10)

  // ── Summary
  const s = wb.addWorksheet('Summary')
  s.columns = [{ width: 36 }, { width: 12 }, { width: 100 }]
  title(s, 'CK Desk - what is live, what is ready, what is next', 3, 'FF1F3F6E')
  s.addRow([`As on ${today}. Live server build 20261022-154801 (checked read-only). Local = the development PC.`])
  s.addRow([])
  head(s.addRow(['Stage', 'Features', 'What it means']))
  const mk = (a, b, c, argb) => { const r = s.addRow([a, b, c]); body(r); r.getCell(1).font = { bold: true }; r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } } }
  mk('1. LIVE on main', live.length, 'Built, tested and working on the live server today. Everyone can use it.', 'FFDFF3E3')
  mk('2. READY to go live', ready.length, 'Built and tested on the development PC. Not on the live server yet. Each can go live as one release; the order and what each needs first are on sheet "2 Ready to go live".', 'FFE3EDFB')
  mk('3. FUTURE enhancements', future.length, 'Not built yet. Ideas from our own review, the ManageEngine comparison and pending decisions. Feedback from users and management is added on sheet "Feedback to add".', 'FFFFF1CC')
  s.addRow([])
  head(s.addRow(['Area', 'Live', 'Ready to go live']))
  for (const m of [...new Set(rows.map((r) => r.module))].filter((m) => m !== 'Not built yet')) {
    const r = s.addRow([m, live.filter((x) => x.module === m).length, ready.filter((x) => x.module === m).length]); body(r)
  }
  s.addRow([])
  s.addRow(['Built but switched off: e-mail intake with human review (it is a decision, see sheet 3).'])
  s.addRow(['WhatsApp and DeskTime are not part of this list (left out on purpose).'])

  // ── 1 Live
  const l = wb.addWorksheet('1 Live on main', { views: [{ state: 'frozen', ySplit: 2 }] })
  l.columns = [{ width: 5 }, { width: 30 }, { width: 40 }, { width: 80 }, { width: 24 }, { width: 24 }]
  title(l, '1. LIVE on the main server', 6, 'FF1B6B2F')
  head(l.addRow(['#', 'Area', 'Feature', 'What it does (simple words)', 'Used by', 'Live since']), 'FF1B6B2F')
  live.forEach((r, i) => { const row = l.addRow([i + 1, r.module, r.name, r.desc, r.who.join(', '), since[r.name] ?? CORE]); body(row); row.getCell(3).font = { bold: true } })
  l.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 6 } }

  // ── 2 Ready
  const g = wb.addWorksheet('2 Ready to go live', { views: [{ state: 'frozen', ySplit: 2 }] })
  g.columns = [{ width: 8 }, { width: 30 }, { width: 40 }, { width: 76 }, { width: 22 }, { width: 22 }]
  title(g, '2. BUILT and READY to go live (not on the live server yet)', 6, 'FF2B4C8C')
  head(g.addRow(['Release', 'Area', 'Feature', 'What it does (simple words)', 'Used by', 'Needs first']), 'FF2B4C8C')
  const relInfo = new Map(releases.map((x) => [x[0], x]))
  const order = ['R1', 'R2', 'R3', 'R5', 'R8', 'R9', 'R10', 'R11', 'R12']
  const sorted = [...ready].sort((a, b) => order.indexOf(rel[a.name] ?? 'R99') - order.indexOf(rel[b.name] ?? 'R99'))
  for (const r of sorted) { const rr = rel[r.name] ?? '?'; const row = g.addRow([rr, r.module, r.name, r.desc, r.who.join(', '), relInfo.get(rr)?.[4] ?? '']); body(row); row.getCell(3).font = { bold: true } }
  g.addRow([])
  const rh = g.addRow(['Release', 'What the release is', '', 'What it contains', 'Database step on the server', 'Risk']); head(rh, 'FF2B4C8C')
  for (const x of releases) { const row = g.addRow([x[0], x[1], '', `${x[2]}  Your steps: ${x[5]}.  Needs first: ${x[4]}.`, x[3], x[6]]); body(row); row.getCell(1).font = { bold: true } }
  g.addRow([])
  g.addRow(['Suggested order: R1, then R5, then R2 and R3 after a few calm days, then the vendor set R8, R9, R10 (+R11), and R12 (the ticket-count calendar can go earlier). Each is pushed only when you say so, one at a time.'])

  // ── 3 Future
  const f = wb.addWorksheet('3 Future enhancements', { views: [{ state: 'frozen', ySplit: 2 }] })
  f.columns = [{ width: 5 }, { width: 38 }, { width: 80 }, { width: 38 }, { width: 26 }, { width: 14 }, { width: 14 }]
  title(f, '3. FUTURE enhancements (not built yet)', 7, 'FF8A5A00')
  head(f.addRow(['#', 'Enhancement', 'What it would do (simple words)', 'Why it helps', 'Where the idea came from', 'Priority', 'Status']), 'FF8A5A00')
  future.forEach((x, i) => { const row = f.addRow([i + 1, x[0], x[1], x[2], x[3], '', 'Not started']); body(row); row.getCell(2).font = { bold: true } })
  f.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 7 } }

  // ── Feedback to add
  const fb = wb.addWorksheet('Feedback to add', { views: [{ state: 'frozen', ySplit: 2 }] })
  fb.columns = [{ width: 8 }, { width: 14 }, { width: 22 }, { width: 70 }, { width: 44 }, { width: 12 }, { width: 16 }, { width: 16 }]
  title(fb, 'Feedback from users and management - paste your feedback rows here', 8, 'FF5A3E8A')
  head(fb.addRow(['ID', 'Date', 'Raised by', 'Feedback / request (as received)', 'Proposed feature', 'Priority', 'Status', 'Target release']), 'FF5A3E8A')
  for (let i = 1; i <= 12; i++) { const row = fb.addRow([`F-${String(i).padStart(3, '0')}`, '', '', '', '', '', 'New', '']); body(row) }

  // ── detail
  const d = wb.addWorksheet('All features (detail)', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] })
  d.columns = [{ width: 38 }, { width: 80 }, { width: 18 }, { width: 18 }, { width: 28 }, { width: 24 }, { width: 34 }, { width: 10 }]
  head(d.addRow(['Feature name', 'What it does', 'Local dev server', 'Main (live) server', 'Area', 'Used by', 'Nearest area in ManageEngine ServiceDesk Plus', 'Release']))
  for (const r of rows) {
    const row = d.addRow([r.name, r.desc, r.local, r.main, r.module, r.who.join(', '), r.me, rel[r.name] ?? ''])
    body(row); row.getCell(1).font = { bold: true }
    for (const col of [3, 4]) { const v = row.getCell(col).value; row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: v === D ? 'FFDFF3E3' : v === OFF ? 'FFE3E8F5' : 'FFFFF1CC' } }; row.getCell(col).alignment = { horizontal: 'center', vertical: 'top', wrapText: true } }
  }
  d.autoFilter = { from: 'A1', to: 'H1' }

  const me = wb.addWorksheet('ManageEngine has more')
  me.columns = [{ width: 38 }, { width: 70 }, { width: 18 }, { width: 70 }]
  head(me.addRow(['ManageEngine ServiceDesk Plus area', 'What it gives', 'In CK Desk?', 'Notes (from general knowledge of the product - check against your edition)']))
  for (const x of gaps) { const row = me.addRow(x); body(row); row.getCell(1).font = { bold: true } }

  const out = path.resolve(__dirname, '..', 'docs', 'CKDESK-MANAGEMENT-FEATURE-STATUS.xlsx')
  await wb.xlsx.writeFile(out)
  console.log('written', out, '| live', live.length, '| ready', ready.length, '| future', future.length)
  const unmapped = ready.filter((r) => !rel[r.name]).map((r) => r.name)
  if (unmapped.length) console.log('NO RELEASE for:', unmapped.join(' | '))
})()
