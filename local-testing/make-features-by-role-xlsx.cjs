// LOCAL: builds docs/CKDESK-FEATURES-BY-ROLE.xlsx (every CK Desk feature by Requester / Technician-Manager-Admin / Vendor, with the status on this PC and on main).
// Run: node local-testing/make-features-by-role-xlsx.cjs
const ExcelJS = require('exceljs')
const path = require('path')

const D = 'Done', P = 'Pending'

const requester = [
  ['Sign in, forgot password, invitation', 'Log in with your e-mail. Reset a forgotten password or accept an invitation by e-mail.', D, D],
  ['Home page', 'Your open requests and quick numbers on one page.', D, D],
  ['Create a request', 'One page with three panels and personal shortcuts: pick the service, category and sub category, fill the form, attach files.', D, D],
  ['Form rules', 'Required fields, number limits (for example Qty 1 to 10000), text length limits, warning if a file is too big.', D, D],
  ['Choose your own AC', 'For an AC problem the form lists the ACs of your store (from the AC Google Sheet), so you pick the right one.', D, P],
  ['My Requests', 'See all your requests and their status; managers also see their team.', D, D],
  ['Conversation on the ticket', 'Write messages, add files, preview files without downloading, see the technician\'s comments.', D, D],
  ['E-mail updates', 'Mails when the request is logged, assigned, changes status, is resolved or cancelled, with the technician\'s comment.', D, D],
  ['Reply by e-mail', 'Answer a ticket mail and your reply is added to the conversation (checked every minute).', D, D],
  ['Bell and pop-up notifications', 'A bell with unread count and a small pop-up in the corner when something new arrives. You can switch event types off.', D, D],
  ['Cancel your request', 'Cancel your own request; a remark is compulsory.', D, D],
  ['Reopen a resolved request', 'Not fixed? Reopen it from a banner with a countdown; a remark is compulsory.', D, D],
  ['Reopen after a rejected approval', 'If an approval was rejected you can reopen within 48 hours.', D, D],
  ['Rate the fix', 'One-click 1 to 5 stars in the "resolved" mail, or "not fixed, reopen". One reminder if you do not answer.', D, D],
  ['Approve from your e-mail', 'If you are an approver: approve or reject from a personal link in the mail (comment compulsory), or from the Approvals page. A daily 10:00 reminder lists what is waiting.', D, D],
  ['Download a ticket as PDF', 'The ticket, your form, the whole conversation and the history in one PDF.', D, D],
  ['My dashboard', 'A dashboard with only your own requests (numbers, ages, status).', D, D],
  ['Raise tickets by e-mail or WhatsApp', 'Send an e-mail or WhatsApp message and a ticket is made for you.', D, D],
  ['Projects and Tasks', 'Plan project work and tasks with files and comments.', D, D],
  ['Knowledge Base', 'Read help articles before raising a ticket.', D, D],
  ['My Profile', 'See who you report to and your team; set notification choices.', D, D],
  ['No double tickets', 'Pressing Submit twice within 15 seconds makes one ticket, not two.', D, D],
  ['Your AC repair done by a vendor', 'If an OEM engineer handles your AC, you see his name, his messages, the parts list or quote, and get a mail when he changes the parts list.', D, P],
  ['Cancelled after a PO is not approved', 'You get a plain mail ("the cost of the repair was not approved") and can reopen within 48 hours.', D, P],
  ['Ticket Calendar for your store', 'A green / yellow / red calendar of your store\'s faulty ACs, with the fault history of each AC.', D, P],
]

const technician = [
  ['Agent Requests (my queue / team queue)', 'Work queue with search by requester, store, technician, service, description; resolved tickets hidden by default.', D, D],
  ['Start working and first response', 'One click starts work and posts an automatic first response.', D, D],
  ['Status changes with remarks', 'Waiting on user, Hold due to Purchase from HO, Resolved, Cancelled: each needs a remark; the resolution note must say what was done.', D, D],
  ['SLA clocks', 'Response and resolution clocks that pause while waiting or on hold and show breaches.', D, D],
  ['"Catch me up" summary', 'A short summary of what happened and what is pending on a ticket.', D, D],
  ['Technician in several groups', 'One technician can belong to many technician groups.', D, D],
  ['Automatic time tracking', 'Time starts when work starts and stops when it leaves In Progress.', D, D],
  ['Comments, internal notes, CC', 'Public comments, internal notes, and CC a comment to CK Desk users and OEM contacts with the whole ticket.', D, D],
  ['Send for approval', 'Send a ticket to approvers; add approvers while pending; first answer decides; approver cannot be the requester.', D, D],
  ['Automatic CVM approval', 'Fixtures / Hangers tickets go to the store\'s CVM for approval by themselves.', D, D],
  ['OEM e-mail on AC and Genset tickets', 'The ticket is mailed to the store\'s OEM (by type, AC or Genset) with a table; the full mail and OEM replies show in the conversation.', D, D],
  ['Nudge', 'Send the handling technician a reminder from the dashboard.', D, D],
  ['Technician dashboard and workload', 'Group workload, 9-bucket ageing, daily activity, highest-open banner.', D, D],
  ['Smart Dashboard', 'Click any number to drill from group to store and technician to the ticket and its history. Everything follows the filters.', D, D],
  ['Service / Category / Sub category filters', 'Three new filters in the dashboard bar, each narrowing the next.', D, P],
  ['Ticket Calendar for every group', '"IT Ticket Calendar", "ADMIN Ticket Calendar"... days coloured green / yellow / red, grey for the future; by store, cluster, region or state; break-down lists; same-issue-again.', D, P],
  ['Faulty AC and genset calendar', 'For AC and Genset work: share of faulty machines per day, ACs that fail again and again by serial number, worst places, outside temperature (collected daily at 08:00).', D, P],
  ['Report Builder and saved reports', 'Build your own report, save it, export to Excel (India dates).', D, D],
  ['Report Analytics and Predefined Reports', 'Age bucket, status, store-wise, AC Not Working, AMC vendor, weekly, monthly, priority-wise and repeated AC complaint reports (Excel-style).', D, D],
  ['Business Rules', 'Rules that assign, set status or priority automatically; search by name.', D, D],
  ['Service catalog, categories, form templates, field library', 'Define services, categories and sub categories, the forms with required fields, number and text limits, and the reusable field library.', D, D],
  ['SLA policies, technician groups, approval flows', 'Set response / resolution times, groups and who approves what.', D, D],
  ['Store Master, OEMs, CVM', 'Stores with cluster, region, state, AC brand, priority; Excel upload and export; OEM by type; one CVM per store.', D, D],
  ['Users, roles and permissions', 'Invite users, change roles and e-mail, permission matrix with owner switches.', D, D],
  ['Intake and channels', 'E-mail and WhatsApp intake with classification and rules; Intake dashboard for admins.', D, D],
  ['DeskTime and Projects', 'Time-tracking link and project / task module.', D, D],
  ['Logs and monitoring', 'One Logs menu: System Log (tamper-evident), ticket activity, event log, errors, retention settings.', D, D],
  ['Security and audit fixes', 'All audit findings fixed (Critical, High, Medium), Next.js 16.3.8, no shared default password, server-only writes, rate limits.', D, D],
  ['Number and text limits in the form builder', 'Set smallest / largest number, whole numbers only, shortest / longest text.', D, D],
  ['Google Sheets as master data', 'AC, Genset and CVM Google Sheets copied into CK Desk at 11:00, 15:00, 19:00 or by "Update now"; health page shows bad rows and addresses.', D, P],
  ['AC and Genset master screens', 'Lists with filters, counts by brand, tonnage and region, Excel download.', D, P],
  ['CVM from the sheet', 'The store\'s CVM comes from the CVM sheet.', D, P],
  ['Hand AC tickets to a vendor technician', 'Business rules give an AC ticket to the OEM\'s engineer; the ticket shows "With vendor"; you can end a hold yourself.', D, P],
  ['Admin: Vendors', 'Create vendor companies, vendor technician and manager logins, set the default PO approver.', D, P],
  ['PO approval page', 'Approve a vendor quote (PO number, date, document), ask for a revised price, reject only the quote, or reject and cancel. Several approvers per AC from the sheet: first decision wins.', D, P],
  ['Purchase orders register', 'All POs with search and Excel download.', D, P],
]

const vendor = [
  ['Vendor login and dashboard', 'An OEM engineer logs in and sees only his tickets in boxes: Revise price required, Open, In process, Part required, PO required, Resolved, Cancelled, each with whose turn it is.', D, P],
  ['Vendor manager view', 'A vendor manager sees all tickets of his company, view only.', D, P],
  ['See the store\'s problem', 'The ticket shows what the store filled in, the AC details, the conversation and files.', D, P],
  ['Start working', 'Press Start working and enter the OEM ticket number; the date is filled in. The store is told.', D, P],
  ['Resolve the ticket', 'Pick the fix from the AC RESOLUTION list (or Other with a note) and attach the FSR (compulsory).', D, P],
  ['Messages with the store', 'Write to the store and get its replies; files stay under the message.', D, P],
  ['Part required (no PO)', 'List the parts and quantities; the ticket goes on hold; correct the list or withdraw; press Parts received with a remark to continue.', D, P],
  ['PO required with a quote', 'List items, quantity and price without GST and attach the quote (compulsory); the approver is told by mail and bell.', D, P],
  ['Revise price required box', 'If the approver asks for a lower price, the ticket moves to this box; send a new quote with a new file.', D, P],
  ['Quote versions', 'Every change is a new version; older versions can no longer be approved; all versions stay visible.', D, P],
  ['Quote not approved, ticket goes on', 'If only the quote is rejected the ticket is not cancelled; you arrange the parts yourself and press Parts received.', D, P],
  ['PO approved', 'You get the PO number, date, items and the PO document by mail and in the conversation; the ticket is back In Progress.', D, P],
  ['Ticket cancelled', 'A clear mail if the quote is rejected and the ticket is cancelled ("do not do any further work").', D, P],
  ['Reopened by the store', 'A "REOPENED" mail, a red "Reopened xN" tag, and the old OEM ticket number is cleared: enter the new one to start again.', D, P],
  ['Hold ended by Citykart', 'If a Citykart technician takes the ticket back, you get a mail and your request is closed.', D, P],
  ['My POs', 'Your own list of quotes and POs with search and Excel download.', D, P],
  ['Search my tickets', 'Search by ticket, store, AC, OEM ticket number.', D, P],
  ['Safe access', 'A vendor sees only his own tickets (a manager only his company\'s), cannot raise requests and cannot see other vendors or Citykart internal notes.', D, P],
]

const notBuilt = [
  ['Reminder for a waiting quote', 'Remind the approver after 1 day, and the vendor after 2 days if a revised price is not answered.', P, P],
  ['Vendor replies by e-mail', 'A vendor answers a mail and it appears in the conversation (not tested for vendors yet).', P, P],
  ['Temperature fallback by nearest store', 'For cities the weather service cannot find, use the nearest store of the same cluster.', P, P],
  ['Fix for reopened tickets in the calendar', 'A reopened ticket currently counts as open for its whole life in the calendar; use the history to correct it.', P, P],
  ['CK Desk Bot (ask CK Desk)', 'A question-and-answer assistant on tickets and knowledge (plan only, deferred).', P, P],
  ['Google Workspace user sync', 'Create and update users from Google Workspace (plan only, deferred).', P, P],
]

const sheets = [
  ['Requester - store or user', requester],
  ['Technician, manager, admin', technician],
  ['Vendor', vendor],
  ['Not built yet', notBuilt],
]

;(async () => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CityKart Desk'
  const border = { top: { style: 'thin', color: { argb: 'FFB0B7C3' } }, bottom: { style: 'thin', color: { argb: 'FFB0B7C3' } }, left: { style: 'thin', color: { argb: 'FFB0B7C3' } }, right: { style: 'thin', color: { argb: 'FFB0B7C3' } } }
  const sum = wb.addWorksheet('Summary')
  sum.columns = [{ width: 32 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }]
  const h0 = sum.addRow(['Who', 'Features', 'Done on local', 'Done on main', 'Pending on main'])
  h0.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3F6E' } } })
  for (const [name, rows] of sheets) {
    const r = sum.addRow([name, rows.length, rows.filter((x) => x[2] === D).length, rows.filter((x) => x[3] === D).length, rows.filter((x) => x[3] === P).length])
    r.eachCell((c) => { c.border = border })
  }
  sum.addRow([])
  sum.addRow([`Checked ${new Date().toISOString().slice(0, 10)}. "Local" = this PC (http://localhost:3210). "Main" = the live server (build 20261022-154801). Done = built and working; Pending = not there yet.`])
  for (const [name, rows] of sheets) {
    const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = [{ width: 38 }, { width: 90 }, { width: 18 }, { width: 18 }]
    const head = ws.addRow(['Feature name', 'What it does (simple words)', 'Local dev server', 'Main (live) server'])
    head.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3F6E' } }; c.alignment = { vertical: 'middle', wrapText: true } })
    for (const r of rows) {
      const row = ws.addRow(r)
      row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = border })
      row.getCell(1).font = { bold: true }
      for (const col of [3, 4]) {
        const done = row.getCell(col).value === D
        row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: done ? 'FFDFF3E3' : 'FFFFF1CC' } }
        row.getCell(col).alignment = { horizontal: 'center', vertical: 'top' }
        row.getCell(col).font = { bold: true, color: { argb: done ? 'FF1B6B2F' : 'FF8A5A00' } }
      }
    }
  }
  const out = path.resolve(__dirname, '..', 'docs', 'CKDESK-FEATURES-BY-ROLE.xlsx')
  await wb.xlsx.writeFile(out)
  console.log('written', out, sheets.map(([n, r]) => `${n}: ${r.length}`).join(' | '))
})()
