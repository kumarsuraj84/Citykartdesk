import { parseEmails } from './emails'
import type { AcRow, CvmRow, GensetRow, MasterIssue, MasterKind, ParseResult, PmsRow } from './types'

// Pure: turns the cells of a master sheet (as the Sheets API returns them) into typed rows plus a list of problems. No database, no network.
// Columns are found by their heading (case, spaces and punctuation do not matter), so the team can move columns around or add new ones.

export const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** A cell as trimmed text. Numbers keep their plain form (3 -> "3", 58.5 -> "58.5"). */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  return String(v).replace(/ /g, ' ').trim()
}

export type Grid = { header: Map<string, number>; body: { sheetRow: number; cells: unknown[] }[] }

export function toGrid(values: unknown[][]): Grid | null {
  let h = 0
  while (h < values.length && !(values[h] ?? []).some((c) => cell(c) !== '')) h++
  if (h >= values.length) return null
  const header = new Map<string, number>()
  ;(values[h] ?? []).forEach((c, i) => { const k = norm(c); if (k && !header.has(k)) header.set(k, i) })
  const body = values.slice(h + 1).map((cells, i) => ({ sheetRow: h + 2 + i, cells: cells ?? [] }))
  return { header, body }
}

export function reader(grid: Grid) {
  return (cells: unknown[], ...names: string[]): string => {
    for (const n of names) {
      const i = grid.header.get(n)
      if (i !== undefined) return cell(cells[i])
    }
    return ''
  }
}

export const rowIsBlank = (cells: unknown[]) => !cells.some((c) => cell(c) !== '')

/** Excel / Sheets date number (days since 1899-12-30) or text (2026-08-17, 17/08/2026) -> yyyy-mm-dd, or null. */
export function toIsoDate(raw: string): string | null {
  if (!raw) return null
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw)
    if (n < 20000 || n > 80000) return null
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // 25-Oct-2026, 25 Oct 2026, 25 October 2026 (the form a sheet shows when the cell is formatted as a long date)
  m = /^(\d{1,2})[\s/.-]([A-Za-z]{3,9})[\s/.,-]+(\d{4})$/.exec(raw)
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    if (mon >= 0) return `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** True when yyyy-mm-dd is a real calendar day (31 Feb is not). */
function realDay(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

export function missingColumns(grid: Grid, required: { label: string; keys: string[] }[]): string[] {
  return required.filter((r) => !r.keys.some((k) => grid.header.has(k))).map((r) => r.label)
}

/** The AC sheet headings, newest name first (the first one that exists in the sheet is used). Older names keep working so a sheet is never broken by the rename. */
const AC_TICKET_MAIL = { label: 'Ticket Mail To', keys: ['ticketmailto', 'oemticketmailto', 'oememailticket', 'mailid'] }
const AC_PO_MAIL = { label: 'PO Mail To', keys: ['pomailto', 'oempomailto', 'oememailpo', 'emailforpodetail'] }
const AC_APPROVER_MAIL = { label: 'Quote Approver Mail To', keys: ['quoteapprovermailto', 'ckpoapprovermailto', 'ckemailpoapprover', 'poapprovermailto'] }
/** The Genset sheet's ticket address column: "Ticket Mail To" now, "Mail ID" before. */
const GENSET_TICKET_MAIL = { label: 'Ticket Mail To', keys: ['ticketmailto', 'mailid'] }
const present = (grid: Grid, keys: string[]) => keys.some((k) => grid.header.has(k))

function addEmailIssues(
  issues: MasterIssue[], kind: MasterKind, storeCode: string, sheetRow: number, raw: string, e: ReturnType<typeof parseEmails>, wantAny: boolean, column = 'Ticket Mail To',
) {
  const at = (code: string, message: string, severity: 'error' | 'warning' = 'warning') => issues.push({ kind, severity, code, storeCode, sheetRow, message })
  for (const bad of e.invalid) { at('bad_email', `Row ${sheetRow} (${storeCode}): "${bad}" in the ${column} is not an e-mail address and is skipped. The other addresses are still used.`); issues[issues.length - 1].token = bad }
  for (const t of e.typoDomains) { at('probable_typo_domain', `Row ${sheetRow} (${storeCode}): ${t} looks like a misspelt company address. It is still used, but the mail to it will bounce.`); issues[issues.length - 1].token = t }
  if (wantAny && e.valid.length === 0 && raw !== '') at('no_valid_email', `Row ${sheetRow} (${storeCode}): the ${column} has no usable address.`, 'error')
  if (wantAny && raw === '') at('no_email', `Row ${sheetRow} (${storeCode}): the ${column} is empty, so a ticket for it cannot be mailed to the OEM.`)
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The same wrong address on many rows is ONE line on the health page (with the rows and stores), not one line per row. */
export function groupEmailIssues(issues: MasterIssue[]): MasterIssue[] {
  const groups = new Map<string, MasterIssue[]>()
  const out: MasterIssue[] = []
  for (const i of issues) {
    if ((i.code === 'bad_email' || i.code === 'probable_typo_domain') && i.token && i.kind !== 'cvm') {
      const k = `${i.kind}|${i.code}|${i.token}`
      groups.set(k, [...(groups.get(k) ?? []), i])
    } else out.push(i)
  }
  for (const list of groups.values()) {
    const first = list[0]
    if (list.length === 1) { out.push(first); continue }
    const rows = list.map((i) => i.sheetRow).filter((r): r is number => r !== null)
    const stores = [...new Set(list.map((i) => i.storeCode).filter((s): s is string => !!s))]
    const more = (n: number, shown: number) => (n > shown ? ` and ${n - shown} more` : '')
    out.push({
      ...first,
      message: first.code === 'bad_email'
        ? `"${first.token}" in the ${first.kind === 'ac' ? AC_TICKET_MAIL.label : GENSET_TICKET_MAIL.label} is not an e-mail address and is skipped, on ${list.length} rows (rows ${rows.slice(0, 8).join(', ')}${more(rows.length, 8)}; stores ${stores.slice(0, 6).join(', ')}${more(stores.length, 6)}). The other addresses are still used.`
        : `${first.token} looks like a misspelt company address, on ${list.length} rows (rows ${rows.slice(0, 8).join(', ')}${more(rows.length, 8)}; stores ${stores.slice(0, 6).join(', ')}${more(stores.length, 6)}). It is still used, but the mail to it will bounce.`,
    })
  }
  return out
}

export function parseAcSheet(values: unknown[][]): ParseResult<AcRow> {
  const grid = toGrid(values)
  if (!grid) return { rows: [], issues: [], fatal: 'The AC sheet is empty.' }
  const missing = missingColumns(grid, [
    { label: 'Store Code', keys: ['storecode'] },
    { label: 'AC CKDESK SERIAL NO', keys: ['acckdeskserialno', 'ckdeskserialno'] },
    // without the address column every OEM address would be wiped on the next copy, so such a sheet is not applied (the last good copy stays in use)
    { label: AC_TICKET_MAIL.label, keys: AC_TICKET_MAIL.keys },
  ])
  if (missing.length) return { rows: [], issues: [], fatal: `The AC sheet is missing the column(s): ${missing.join(', ')}.` }

  const get = reader(grid)
  const rows: AcRow[] = []
  const issues: MasterIssue[] = []
  const hasStatus = grid.header.has('status')
  const hasMail = present(grid, AC_TICKET_MAIL.keys)
  const hasPoMail = present(grid, AC_PO_MAIL.keys)
  const hasApprover = present(grid, AC_APPROVER_MAIL.keys)
  if (!hasStatus) issues.push({ kind: 'ac', severity: 'warning', code: 'no_status_column', storeCode: null, sheetRow: null, message: 'The AC sheet has no Status column, so every AC is treated as Active.' })
  if (!hasMail) issues.push({ kind: 'ac', severity: 'warning', code: 'no_mail_column', storeCode: null, sheetRow: null, message: `The AC sheet has no "${AC_TICKET_MAIL.label}" column, so no AC ticket can be mailed to an OEM.` })
  if (!hasApprover) issues.push({ kind: 'ac', severity: 'warning', code: 'no_approver_column', storeCode: null, sheetRow: null, message: `The AC sheet has no "${AC_APPROVER_MAIL.label}" column, so every vendor quote goes to the default PO approver (Admin > Vendors).` })

  const seenNumber = new Map<string, number>()
  const seenSerial = new Map<string, number>()
  const seenSquashed = new Map<string, { serial: string; row: number }>()
  for (const { sheetRow, cells } of grid.body) {
    if (rowIsBlank(cells)) continue
    const storeCode = get(cells, 'storecode').toUpperCase()
    const ckdeskNo = get(cells, 'acckdeskserialno', 'ckdeskserialno')
    if (!storeCode) { issues.push({ kind: 'ac', severity: 'error', code: 'blank_store', storeCode: null, sheetRow, message: `Row ${sheetRow}: the Store Code is empty, the row is skipped.` }); continue }
    if (!ckdeskNo) { issues.push({ kind: 'ac', severity: 'error', code: 'blank_number', storeCode, sheetRow, message: `Row ${sheetRow} (${storeCode}): the AC CKDESK SERIAL NO is empty, the row is skipped.` }); continue }

    const statusRaw = hasStatus ? get(cells, 'status') : 'active'
    const status = statusRaw.toLowerCase().replace(/[^a-z]/g, '')
    let isActive: boolean
    if (status === '' || status === 'active') {
      isActive = true
      if (status === '' && hasStatus) issues.push({ kind: 'ac', severity: 'warning', code: 'blank_status', storeCode, sheetRow, message: `Row ${sheetRow} (${storeCode}): the Status is empty, the AC is treated as Active.` })
    } else if (['inactive', 'nonactive', 'notactive', 'no', 'closed', 'removed', 'scrap', 'scrapped'].includes(status)) {
      isActive = false
    } else {
      isActive = false
      issues.push({ kind: 'ac', severity: 'warning', code: 'unknown_status', storeCode, sheetRow, message: `Row ${sheetRow} (${storeCode}): the Status "${statusRaw}" is not Active or Inactive, the AC is treated as Inactive.` })
    }

    const serial = get(cells, 'acserialno', 'serialno')
    const numKey = `${storeCode}|${ckdeskNo.toLowerCase()}`
    if (seenNumber.has(numKey)) {
      issues.push({ kind: 'ac', severity: 'error', code: 'duplicate_number', storeCode, sheetRow, message: `Rows ${seenNumber.get(numKey)} and ${sheetRow}: ${storeCode} has the AC number ${ckdeskNo} twice. Both are kept and shown with their serial, please correct one of them.` })
    } else seenNumber.set(numKey, sheetRow)
    if (serial) {
      const sKey = `${storeCode}|${serial.toLowerCase()}`
      if (seenSerial.has(sKey)) issues.push({ kind: 'ac', severity: 'warning', code: 'duplicate_serial', storeCode, sheetRow, message: `Rows ${seenSerial.get(sKey)} and ${sheetRow}: ${storeCode} has the serial ${serial} twice.` })
      else {
        seenSerial.set(sKey, sheetRow)
        const q = `${storeCode}|${squash(serial)}`
        const near = seenSquashed.get(q)
        if (near) issues.push({ kind: 'ac', severity: 'warning', code: 'similar_serial', storeCode, sheetRow, message: `Rows ${near.row} and ${sheetRow}: ${storeCode} has the serials ${near.serial} and ${serial}, which differ only by a dash, space or capital letter.` })
        else seenSquashed.set(q, { serial, row: sheetRow })
      }
    }

    const mailRaw = hasMail ? get(cells, ...AC_TICKET_MAIL.keys) : ''
    const emails = parseEmails(mailRaw)
    if (hasMail && isActive) addEmailIssues(issues, 'ac', storeCode, sheetRow, mailRaw, emails, true, AC_TICKET_MAIL.label)

    // the OEM's address for PO details: bad addresses are skipped with a note; an empty cell is fine (the ticket's normal OEM address is used then)
    const poRaw = hasPoMail ? get(cells, ...AC_PO_MAIL.keys) : ''
    const poEmails = parseEmails(poRaw)
    if (isActive) for (const bad of poEmails.invalid) issues.push({ kind: 'ac', severity: 'warning', code: 'bad_po_email', storeCode, sheetRow, token: bad, message: `Row ${sheetRow} (${storeCode}): "${bad}" in the ${AC_PO_MAIL.label} is not an e-mail address and is skipped.` })

    // the Citykart people who approve a vendor's quote for this AC: bad addresses are skipped with a note; an empty cell is fine (the default approver is used then)
    const apRaw = hasApprover ? get(cells, ...AC_APPROVER_MAIL.keys) : ''
    const approverEmails = parseEmails(apRaw)
    if (isActive) for (const bad of approverEmails.invalid) issues.push({ kind: 'ac', severity: 'warning', code: 'bad_approver_email', storeCode, sheetRow, token: bad, message: `Row ${sheetRow} (${storeCode}): "${bad}" in the ${AC_APPROVER_MAIL.label} is not an e-mail address and is skipped.` })

    rows.push({
      sheetRow, storeCode, ckdeskNo, serial,
      floor: get(cells, 'acfloor', 'floor'), acType: get(cells, 'actype'), tonnage: get(cells, 'actonnage'), brand: get(cells, 'acbrand'),
      amcVendor: get(cells, 'acamcvendor'), amcBrand: get(cells, 'acamcbrand'), zenatix: get(cells, 'zenatixyesno', 'zenatix'),
      storePriority: get(cells, 'storeprioritylist', 'storepriority'), festival: get(cells, 'festival'), region: get(cells, 'region'), cluster: get(cells, 'cluster'),
      openingDate: toIsoDate(get(cells, 'openingdate', 'opendate')), city: get(cells, 'city'), state: get(cells, 'state'), address: get(cells, 'address'), pincode: get(cells, 'pincode'),
      isActive, emails: emails.valid, poEmails: poEmails.valid, approverEmails: approverEmails.valid,
    })
  }
  return { rows, issues: groupEmailIssues(issues) }
}

export function parseGensetSheet(values: unknown[][]): ParseResult<GensetRow> {
  const grid = toGrid(values)
  if (!grid) return { rows: [], issues: [], fatal: 'The Genset sheet is empty.' }
  const missing = missingColumns(grid, [
    { label: 'Store Code', keys: ['storecode'] },
    { label: GENSET_TICKET_MAIL.label, keys: GENSET_TICKET_MAIL.keys },
  ])
  if (missing.length) return { rows: [], issues: [], fatal: `The Genset sheet is missing the column(s): ${missing.join(', ')}.` }

  const get = reader(grid)
  const rows: GensetRow[] = []
  const issues: MasterIssue[] = []
  const perStore = new Map<string, number[]>()
  for (const { sheetRow, cells } of grid.body) {
    if (rowIsBlank(cells)) continue
    const storeCode = get(cells, 'storecode').toUpperCase()
    if (!storeCode) { issues.push({ kind: 'genset', severity: 'error', code: 'blank_store', storeCode: null, sheetRow, message: `Row ${sheetRow}: the Store Code is empty, the row is skipped.` }); continue }
    const mailRaw = get(cells, ...GENSET_TICKET_MAIL.keys)
    const emails = parseEmails(mailRaw)
    addEmailIssues(issues, 'genset', storeCode, sheetRow, mailRaw, emails, true, GENSET_TICKET_MAIL.label)
    const serial = get(cells, 'gensetserialno', 'serialno')
    if (!serial) issues.push({ kind: 'genset', severity: 'warning', code: 'no_serial', storeCode, sheetRow, message: `Row ${sheetRow} (${storeCode}): the Genset Serial No is empty.` })
    perStore.set(storeCode, [...(perStore.get(storeCode) ?? []), sheetRow])
    rows.push({ sheetRow, storeCode, brand: get(cells, 'gensetbrand', 'brand'), kva: get(cells, 'gensetkva', 'kva'), serial, cpcbGroup: get(cells, 'cpcbgroup'), emails: emails.valid })
  }
  for (const [store, rowNos] of perStore) {
    if (rowNos.length > 1) issues.push({ kind: 'genset', severity: 'warning', code: 'store_has_several_gensets', storeCode: store, sheetRow: rowNos[1], message: `${store} has ${rowNos.length} genset rows (rows ${rowNos.join(', ')}). One mail goes to all their addresses and lists every genset. If that is a mistake, please correct the sheet.` })
  }
  return { rows, issues: groupEmailIssues(issues) }
}

export function parseCvmSheet(values: unknown[][]): ParseResult<CvmRow> {
  const grid = toGrid(values)
  if (!grid) return { rows: [], issues: [], fatal: 'The CVM sheet is empty.' }
  const missing = missingColumns(grid, [
    { label: 'Store Code', keys: ['storecode'] },
    { label: 'CVM EMAIL ID', keys: ['cvmemailid', 'cvmemail', 'emailid'] },
  ])
  if (missing.length) return { rows: [], issues: [], fatal: `The CVM sheet is missing the column(s): ${missing.join(', ')}.` }

  const get = reader(grid)
  const rows: CvmRow[] = []
  const issues: MasterIssue[] = []
  const seen = new Map<string, { email: string; row: number }>()
  for (const { sheetRow, cells } of grid.body) {
    if (rowIsBlank(cells)) continue
    const storeCode = get(cells, 'storecode').toUpperCase()
    if (!storeCode) { issues.push({ kind: 'cvm', severity: 'error', code: 'blank_store', storeCode: null, sheetRow, message: `Row ${sheetRow}: the Store Code is empty, the row is skipped.` }); continue }
    const raw = get(cells, 'cvmemailid', 'cvmemail', 'emailid')
    const parsed = parseEmails(raw)
    if (parsed.valid.length === 0) { issues.push({ kind: 'cvm', severity: 'error', code: 'bad_email', storeCode, sheetRow, message: `Row ${sheetRow} (${storeCode}): "${raw}" is not an e-mail address, so no approval can be sent for this store.` }); continue }
    if (parsed.valid.length > 1) issues.push({ kind: 'cvm', severity: 'warning', code: 'several_cvm', storeCode, sheetRow, message: `Row ${sheetRow} (${storeCode}): more than one address; only the first (${parsed.valid[0]}) is used.` })
    const email = parsed.valid[0]
    const prev = seen.get(storeCode)
    if (prev) {
      issues.push({ kind: 'cvm', severity: prev.email === email ? 'warning' : 'error', code: 'duplicate_store', storeCode, sheetRow, message: `Rows ${prev.row} and ${sheetRow}: ${storeCode} is listed twice${prev.email === email ? '' : ` with different CVMs; the first (${prev.email}) is used`}.` })
      continue
    }
    seen.set(storeCode, { email, row: sheetRow })
    rows.push({ sheetRow, storeCode, cvmEmail: email })
  }
  return { rows, issues }
}

/**
 * The AC PMS sheet: one row per store and PMS date (columns Store Code and AC PMS Date; other columns are ignored). A store with no date is simply not due. Several dates
 * for one store are fine (several rows). A date that cannot be read is reported and skipped; the same store and date twice counts once.
 */
export function parsePmsSheet(values: unknown[][]): ParseResult<PmsRow> {
  const grid = toGrid(values)
  if (!grid) return { rows: [], issues: [], fatal: 'The AC PMS sheet is empty.' }
  const STORE = ['storecode', 'store', 'storeid']
  const DATE = ['acpmsdate', 'pmsdate', 'pmsdates', 'acpmsdates', 'pmsvisitdate']
  const missing = missingColumns(grid, [
    { label: 'Store Code', keys: STORE },
    { label: 'AC PMS Date', keys: DATE },
  ])
  if (missing.length) return { rows: [], issues: [], fatal: `The AC PMS sheet is missing the column(s): ${missing.join(', ')}.` }

  const get = reader(grid)
  const rows: PmsRow[] = []
  const issues: MasterIssue[] = []
  const seen = new Map<string, number>()
  for (const { sheetRow, cells } of grid.body) {
    if (rowIsBlank(cells)) continue
    const storeCode = get(cells, ...STORE).toUpperCase()
    const rawDate = get(cells, ...DATE)
    if (!storeCode) {
      if (rawDate) issues.push({ kind: 'pms', severity: 'error', code: 'blank_store', storeCode: null, sheetRow, message: `Row ${sheetRow}: the Store Code is empty, so the PMS date ${rawDate} is skipped.` })
      continue
    }
    if (!rawDate) continue   // no date = no PMS due for this store
    const iso = toIsoDate(rawDate.replace(/[ T]\d{1,2}:\d{2}.*$/, '').trim())
    if (!iso || !realDay(iso)) {
      issues.push({ kind: 'pms', severity: 'error', code: 'bad_date', storeCode, sheetRow, message: `Row ${sheetRow} (${storeCode}): "${rawDate}" is not a date CK Desk can read, so no PMS ticket is made for it. Please write it like 25/10/2026.` })
      continue
    }
    const key = `${storeCode}|${iso}`
    const prev = seen.get(key)
    if (prev) {
      issues.push({ kind: 'pms', severity: 'warning', code: 'duplicate_row', storeCode, sheetRow, message: `Rows ${prev} and ${sheetRow}: ${storeCode} has the PMS date ${iso} twice. Only one ticket is made.` })
      continue
    }
    seen.set(key, sheetRow)
    rows.push({ sheetRow, storeCode, pmsDate: iso })
  }
  return { rows, issues }
}
