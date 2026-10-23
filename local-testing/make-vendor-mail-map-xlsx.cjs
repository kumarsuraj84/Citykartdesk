// LOCAL: builds docs/VENDOR-EMAIL-MAP.xlsx (the vendor journey mail map in the owner's layout) from the table below. Run: node local-testing/make-vendor-mail-map-xlsx.cjs
const ExcelJS = require('exceljs')
const path = require('path')

const STORE_ADDR = 'Login e-mail of the store login that raised the ticket (set when the user was created). Ticket booked on behalf of someone: that person.'
const VENDOR_ADDR = 'The vendor technician\'s own login e-mail, typed by the administrator in Admin > Vendors > Add a vendor login (change in Admin > Users).'
const KRISHAN_ADDR = 'Login e-mail of the PO approver chosen in Admin > Vendors > PO approver (default: krishan.patel@citykartstores.com).'
const OEM_MAIL_ID = 'AC sheet column "Mail ID" of the AC chosen on the ticket. Outside addresses go in To; company addresses (@citykartstores.com, @citykart.org) go in CC.'
const OEM_PO = 'AC sheet column "Email for PO detail" of that AC; if empty, the AC\'s "Mail ID". If both are empty nothing is sent and an internal note asks the Citykart technician to inform the OEM.'
const SENDER = 'Sent from CitykartDesk <citykartdesk@citykartstores.com> (the mailbox connected in Admin).'

const groups = [
  { name: 'A. The ticket is raised and given to the vendor', rows: [
    ['Mail 1', 'The store submits the AC ticket', 'Store', '-', 'Request created: CKSD-… — <title>', 'Your request … has been submitted via ADMIN - AC. + link to the ticket.', STORE_ADDR],
    ['Mail 2', 'Same moment: the ticket is sent to the AC\'s OEM (category set to send to OEM)', 'OEM', 'Citykart addresses of that sheet row', 'New AC Issue Ticket - CKSD-… - <store code>', 'A table: ticket no, contact person, e-mail, phone, store address, store code, AC number, serial, AC details, the issue and its description. No link (the OEM has no login).', OEM_MAIL_ID],
    ['Mail 3', 'A Business Rule gives the ticket to the vendor technician', 'Vendor technician', '-', 'Request assigned to you: CKSD-… — <title>', '<assigner> assigned you to … + link (he lands on his own ticket page).', VENDOR_ADDR],
    ['Mail 4', 'Same moment', 'Store', '-', 'Your request has been assigned: CKSD-… — <title>', '<Vendor name> is now handling your request. + link.', STORE_ADDR],
  ] },
  { name: 'B. The vendor works the ticket', rows: [
    ['Mail 5', 'Vendor presses Start working (enters the OEM ticket number)', 'Store', '-', 'Request updated: CKSD-… — <title>', 'Status changed from Open to In Progress. + the line "<vendor> (vendor) started work on this ticket. OEM ticket number: …". Nobody else is mailed (not Krishan, not the OEM).', STORE_ADDR],
    ['Mail 6', 'Vendor presses Part required (no PO) and lists parts', 'Store', '-', 'Request updated: CKSD-… — <title>', 'Status changed from In Progress to Hold due to Purchase from HO. + "Part required (no PO). <vendor> needs these parts:" and the list. Krishan is NOT mailed (no PO).', STORE_ADDR],
    ['(no mail)', 'Vendor changes the parts list while on hold', 'Nobody', '-', '-', 'Only the conversation message "Parts list updated (version N)" and the bell.', '-'],
    ['Mail 7', 'Vendor presses Parts received (remark compulsory)', 'Store', '-', 'Request updated: CKSD-… — <title>', 'Status changed from Hold due to Purchase from HO to In Progress. + "Parts received. <remark>".', STORE_ADDR],
    ['Mail 8', 'Vendor withdraws a parts request (reason compulsory)', 'Store', '-', 'Request updated: CKSD-… — <title>', 'Hold to In Progress + "Parts request withdrawn by <vendor>. Reason: …".', STORE_ADDR],
    ['Mail 9', 'A Citykart technician ends the hold himself', 'Store', '-', 'Request updated: CKSD-… — <title>', 'Hold to In Progress + his remark. The pending vendor request is closed as cancelled.', STORE_ADDR],
    ['Mail 10', 'The vendor writes a message on the ticket', 'Store', '-', 'New comment on: CKSD-… — <title>', '<name> commented on …: + the text + link.', STORE_ADDR],
    ['Mail 11', 'The store writes a message on the ticket', 'Vendor technician', '-', 'New comment on: CKSD-… — <title>', '<name> commented on …: + the text + link to the ticket.', VENDOR_ADDR],
  ] },
  { name: 'C. PO required: the quote, revised price, approval', rows: [
    ['Mail 12', 'Vendor sends the quote (items, prices without GST, quote file) = PO required', 'PO approver (Krishan)', '-', 'PO approval needed - CKSD-… - <vendor>', '<vendor> needs a purchase order to repair the AC on the ticket below. Ticket, store, AC, vendor, the item lines, total without GST, and a sign-in link to the approval page. (The quote file is on the ticket under the message, not attached to the mail.)', KRISHAN_ADDR],
    ['Mail 13', 'Same moment', 'Store', '-', 'Request updated: CKSD-… — <title>', 'In Progress to Hold due to Purchase from HO + "PO required from Citykart (quote version 1)", the quote lines and total. Prices are visible to the store by decision.', STORE_ADDR],
    ['Mail 14', 'Krishan presses Ask for revised price (note compulsory)', 'Vendor technician', '-', 'Revised price needed - CKSD-… - <store>', '<Krishan> has asked for a revised price. + "What was asked: <his note>" + link to the ticket to send the revised quote. Nobody else is mailed. The ticket moves to the vendor\'s "Revise price required" box.', VENDOR_ADDR],
    ['Mail 15', 'Vendor sends the revised quote (new prices + new quote file)', 'PO approver (Krishan)', '-', 'Revised quote (version 2) - PO approval needed - CKSD-… - <vendor>', '<vendor> sent a revised quote (version 2), the earlier total was X + the new lines and total + the approval link. The old link now says "replaced by a newer version".', KRISHAN_ADDR],
    ['Mail 16', 'Krishan approves (PO number, PO date, PO document)', 'OEM', 'Citykart addresses of that row', 'PO <number> approved - CKSD-… - <store>', 'Citykart has approved the purchase order: ticket, store, AC, vendor, PO number, PO date, the item lines, total. The PO document is attached to the mail.', OEM_PO],
    ['Mail 17', 'Same moment', 'Vendor technician', '-', 'PO <number> approved - CKSD-… - <store>', '<Krishan> has approved your quote. The ticket is back In Progress. PO number, date, lines, total, the PO document attached, link to the ticket.', VENDOR_ADDR],
    ['Mail 18', 'Same moment', 'Store', '-', 'Request updated: CKSD-… — <title>', 'Hold to In Progress + "PO approved by <Krishan> on quote version N. PO number …, date …" with lines and total.', STORE_ADDR],
    ['Mail 19', 'Krishan rejects ONLY the quote (reason compulsory) - the ticket goes on', 'Vendor technician', '-', 'Quote not approved - arrange the parts yourself - CKSD-… - <store>', '<Krishan> has not approved your quote. The ticket is NOT cancelled. Please arrange the parts yourself (no PO) and press Parts received. + the reason + the parts list kept on the ticket (no prices). The OEM and the store are not mailed.', VENDOR_ADDR],
    ['Mail 20', 'Krishan rejects the quote AND cancels the ticket (reason compulsory)', 'OEM', 'Citykart addresses of that row', 'PO request rejected - CKSD-… - <store>', 'Citykart has not approved the purchase order … and the ticket has been cancelled. + the reason.', OEM_PO],
    ['Mail 21', 'Same moment', 'Store', '-', 'Request cancelled: CKSD-… — <title>', 'Request cancelled. + "PO request rejected by <Krishan>. Reason: …". The store may reopen within 48 hours.', STORE_ADDR],
    ['Mail 22', 'Same moment', 'Vendor technician', '-', 'Quote rejected and ticket cancelled - CKSD-… - <store>', '<Krishan> has rejected your quote and cancelled the ticket. + the reason + link.', VENDOR_ADDR],
    ['Mail 23', 'Vendor withdraws a quote that Krishan has not decided yet (reason compulsory)', 'PO approver (Krishan)', '-', 'Quote withdrawn by the vendor - CKSD-… - <vendor>', '<vendor technician> (<vendor>) has withdrawn quote version N. Nothing more is needed from you for now. + the reason + link.', KRISHAN_ADDR],
    ['Mail 24', 'Same moment', 'Store', '-', 'Request updated: CKSD-… — <title>', 'Hold to In Progress + "PO request withdrawn by <vendor>. Reason: …".', STORE_ADDR],
  ] },
  { name: 'D. Resolved and reopened', rows: [
    ['Mail 25', 'Vendor resolves the ticket (AC RESOLUTION choice or Other + FSR)', 'Store', '-', 'Resolved: CKSD-… — <title>', 'Your request has been marked resolved by <vendor>. Resolution: <words>. Then five one-click rating links (1-5 stars) and a "not fixed - reopen" link. This is the only "resolved" mail.', STORE_ADDR],
    ['Mail 26', 'The store has not rated after 2 days (admin setting)', 'Store', '-', 'Rating reminder', 'One reminder with the same rating / reopen links.', STORE_ADDR],
    ['Mail 27', 'The store reopens the ticket (reason compulsory)', 'OEM', 'Citykart addresses of that row', 'REOPENED - New AC Issue Ticket - CKSD-… - <store>', 'The same table as Mail 2, with "REOPENED:" in the issue and the store\'s reason.', OEM_MAIL_ID],
    ['Mail 28', 'Same moment', 'Vendor technician', '-', 'Request updated: CKSD-… — <title>', 'Status changed from Resolved to Open. + the store\'s reason. The OEM number and date are emptied: he must enter the OEM\'s NEW ticket number to start again.', VENDOR_ADDR],
    ['Mail 29', 'Same moment', 'Store', '-', 'Request updated: CKSD-… — <title>', 'Resolved to Open. It\'s with <vendor>. + the reason.', STORE_ADDR],
  ] },
]

const who = [
  ['Vendor technician', 'Mail 3 assigned to you; Mail 11 store message; Mail 14 revised price needed; Mail 17 PO approved (with PO document); Mail 19 quote not approved, arrange the parts; Mail 22 ticket cancelled; Mail 28 reopened. He is never mailed about his own actions.'],
  ['PO approver (Krishan)', 'Mail 12 PO approval needed; Mail 15 revised quote; Mail 23 quote withdrawn. Nothing else: not for parts-only requests and not for ordinary ticket events.'],
  ['OEM', 'Mail 2 new ticket; Mail 16 PO approved (with PO document); Mail 20 PO rejected and ticket cancelled; Mail 27 reopened. NOT mailed when only a quote is rejected, when a quote is revised, or when the vendor starts, holds or resolves.'],
  ['Store', 'Mail 1 created; Mail 4 assigned; every status change (5, 6, 7, 8, 9, 13, 18, 24); Mail 10 vendor message; Mail 21 cancelled; Mail 25 resolved with rating links; Mail 26 reminder; Mail 29 reopened. NOT mailed for revised-price requests, revised quotes, or a quote rejected while the ticket goes on.'],
]

;(async () => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CityKart Desk'
  const ws = wb.addWorksheet('Mail map', { views: [{ state: 'frozen', ySplit: 2 }] })
  ws.columns = [
    { key: 'a', width: 20 }, { key: 'b', width: 44 }, { key: 'c', width: 22 }, { key: 'd', width: 24 }, { key: 'e', width: 44 }, { key: 'f', width: 70 }, { key: 'g', width: 62 },
  ]
  ws.addRow([`Vendor journey - who gets which e-mail, when, with what words, and where the address comes from (checked ${new Date().toISOString().slice(0, 10)})`])
  ws.mergeCells('A1:G1')
  ws.getCell('A1').font = { bold: true, size: 13 }
  const head = ws.addRow(['Journey name', 'Trigger', 'To', 'CC', 'Subject', 'What it says', 'Where it comes from (the address)'])
  head.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3F6E' } }; c.alignment = { vertical: 'middle', wrapText: true } })
  const border = { top: { style: 'thin', color: { argb: 'FFB0B7C3' } }, bottom: { style: 'thin', color: { argb: 'FFB0B7C3' } }, left: { style: 'thin', color: { argb: 'FFB0B7C3' } }, right: { style: 'thin', color: { argb: 'FFB0B7C3' } } }
  for (const g of groups) {
    const gr = ws.addRow([g.name])
    ws.mergeCells(`A${gr.number}:G${gr.number}`)
    gr.getCell(1).font = { bold: true, size: 12 }
    gr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } }
    for (const r of g.rows) {
      const row = ws.addRow(r)
      row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = border })
      row.getCell(1).font = { bold: true }
      const to = String(r[2])
      const tone = to.startsWith('Vendor') ? 'FFFFF4D6' : to.startsWith('PO approver') ? 'FFE8F5E9' : to === 'OEM' ? 'FFFDE8E8' : to === 'Store' ? 'FFEFF3F8' : null
      if (tone) row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone } }
    }
  }
  ws.addRow([])
  ws.addRow(['Sender (From)', SENDER]).getCell(1).font = { bold: true }
  ws.addRow(['Opt-outs', 'A person can switch an event type off for himself; an administrator can switch an event type off for everybody (Request Configuration > Notification Rules). Default: all on. Most events also give a bell message in the app.']).getCell(1).font = { bold: true }
  ws.addRow(['Rule order', 'The vendor routing rule must have a LOWER order number than the old "ADMIN AC TICKET RULE_KRISHAN" rule (0), otherwise Krishan gets a wrong "assigned to you" mail and the store gets two "assigned" mails.']).getCell(1).font = { bold: true }
  for (const n of [ws.rowCount - 2, ws.rowCount - 1, ws.rowCount]) { ws.mergeCells(`B${n}:G${n}`); ws.getCell(`B${n}`).alignment = { wrapText: true, vertical: 'top' }; ws.getRow(n).height = 32 }

  const w2 = wb.addWorksheet('Who gets what')
  w2.columns = [{ width: 26 }, { width: 140 }]
  const h2 = w2.addRow(['Person', 'Mails they receive'])
  h2.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3F6E' } } })
  for (const r of who) { const row = w2.addRow(r); row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = border }); row.getCell(1).font = { bold: true } }

  const out = path.resolve(__dirname, '..', 'docs', 'VENDOR-EMAIL-MAP.xlsx')
  await wb.xlsx.writeFile(out)
  console.log('written', out)
})()
