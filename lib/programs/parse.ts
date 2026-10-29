import { parseEmails } from '@/lib/masters/emails'
import { cell, norm, reader, rowIsBlank, toGrid, type Grid } from '@/lib/masters/parse'
import { DEFAULT_HEADINGS, FIELD_LABEL, type ParsedProgramRow, type ProgramColumns, type ProgramField, type ProgramIssue, type ProgramParseResult, type ProgramRowType } from './types'

// Pure: turns the cells of a program's sheet into rows plus a list of problems. No database, no network. Columns are found by their heading (case, spaces and punctuation do
// not matter), so the team can move columns around or add new ones; every column that has no meaning for the engine is kept as an "extra detail" by its heading.

/** The heading keys that mean `field`: the one the administrator typed first, then the usual names (so an old sheet keeps working after the setting is filled in). */
export function headingKeys(field: ProgramField, columns: ProgramColumns | null | undefined): string[] {
  const typed = (columns?.[field] ?? '').trim()
  return [...new Set([...(typed ? [norm(typed)] : []), ...DEFAULT_HEADINGS[field].map(norm)])].filter(Boolean)
}

// compared after removing spaces and punctuation, so "Not Active", "Non-Active" and "In active" all count as off
const FALSE_WORDS = new Set(['no', 'n', 'false', '0', 'inactive', 'nonactive', 'notactive', 'off', 'closed', 'removed', 'scrap', 'scrapped'])

export function parseProgramSheet(values: unknown[][], opts: { name: string; rowType: ProgramRowType; columns?: ProgramColumns | null }): ProgramParseResult {
  const grid: Grid | null = toGrid(values)
  if (!grid) return { rows: [], issues: [], fatal: `The ${opts.name} sheet is empty.` }
  const keys = (f: ProgramField) => headingKeys(f, opts.columns)
  const has = (f: ProgramField) => keys(f).some((k) => grid.header.has(k))
  const required: ProgramField[] = opts.rowType === 'machine' ? ['store', 'mail', 'machine'] : ['store', 'mail']
  const missing = required.filter((f) => !has(f)).map((f) => `${FIELD_LABEL[f]} (${DEFAULT_HEADINGS[f][0]}${opts.columns?.[f] ? `, or "${opts.columns[f]}"` : ''})`)
  if (missing.length) return { rows: [], issues: [], fatal: `The ${opts.name} sheet is missing the column(s): ${missing.join('; ')}.` }

  // the headings as typed (for the extra details), and which columns have a meaning
  let h = 0
  while (h < values.length && !(values[h] ?? []).some((c) => cell(c) !== '')) h++
  const labels = (values[h] ?? []).map((c) => cell(c))
  const mapped = new Set<number>()
  for (const f of ['store', 'mail', 'vendor', 'machine', 'serial', 'poMail', 'approverMail', 'active'] as ProgramField[]) {
    for (const k of keys(f)) { const i = grid.header.get(k); if (i !== undefined) mapped.add(i) }
  }

  const get = reader(grid)
  const rows: ParsedProgramRow[] = []
  const issues: ProgramIssue[] = []
  const at = (severity: 'error' | 'warning', code: string, storeCode: string | null, sheetRow: number | null, message: string, token?: string) => issues.push({ severity, code, storeCode, sheetRow, message, token })
  const machineSeen = new Map<string, number>()
  const perStore = new Map<string, number[]>()

  for (const { sheetRow, cells } of grid.body) {
    if (rowIsBlank(cells)) continue
    const storeCode = get(cells, ...keys('store')).toUpperCase()
    if (!storeCode) { at('error', 'blank_store', null, sheetRow, `Row ${sheetRow}: the ${DEFAULT_HEADINGS.store[0]} is empty, the row is skipped.`); continue }

    const mailRaw = get(cells, ...keys('mail'))
    const mail = parseEmails(mailRaw)
    for (const bad of mail.invalid) at('warning', 'bad_email', storeCode, sheetRow, `Row ${sheetRow} (${storeCode}): "${bad}" in the mail column is not an e-mail address and is skipped. The other addresses are still used.`, bad)
    for (const t of mail.typoDomains) at('warning', 'probable_typo_domain', storeCode, sheetRow, `Row ${sheetRow} (${storeCode}): ${t} looks like a misspelt company address. It is still used, but the mail to it will bounce.`, t)
    if (mailRaw === '') at('warning', 'no_email', storeCode, sheetRow, `Row ${sheetRow} (${storeCode}): the mail column is empty, so a ticket for it cannot be mailed to the vendor.`)
    else if (mail.valid.length === 0) at('error', 'no_valid_email', storeCode, sheetRow, `Row ${sheetRow} (${storeCode}): the mail column has no usable address.`)

    const machineNo = get(cells, ...keys('machine'))
    const serial = get(cells, ...keys('serial'))
    if (opts.rowType === 'machine') {
      if (!machineNo) { at('error', 'blank_machine', storeCode, sheetRow, `Row ${sheetRow} (${storeCode}): the ${DEFAULT_HEADINGS.machine[0]} is empty, the row is skipped.`); continue }
      const k = `${storeCode}|${machineNo.toLowerCase()}`
      if (machineSeen.has(k)) at('warning', 'duplicate_machine', storeCode, sheetRow, `Row ${sheetRow} (${storeCode}): machine ${machineNo} is also on row ${machineSeen.get(k)}.`)
      else machineSeen.set(k, sheetRow)
    }
    perStore.set(storeCode, [...(perStore.get(storeCode) ?? []), sheetRow])

    const activeRaw = get(cells, ...keys('active')).toLowerCase()
    const extra: Record<string, string> = {}
    labels.forEach((label, i) => { if (label && !mapped.has(i)) { const v = cell(cells[i]); if (v) extra[label] = v } })

    rows.push({
      sheetRow, storeCode, machineNo, serial, vendor: get(cells, ...keys('vendor')),
      emails: mail.valid, poEmails: parseEmails(get(cells, ...keys('poMail'))).valid, approverEmails: parseEmails(get(cells, ...keys('approverMail'))).valid,
      isActive: !FALSE_WORDS.has(activeRaw.replace(/[^a-z0-9]/g, '')), extra,
    })
  }
  if (opts.rowType === 'store') {
    for (const [store, nos] of perStore) if (nos.length > 1) at('warning', 'store_has_several_rows', store, nos[1], `${store} has ${nos.length} rows (rows ${nos.slice(0, 6).join(', ')}). A ticket for it is mailed to all of them in one message.`)
  }
  return { rows, issues: groupIssues(issues) }
}

/** The same wrong address on many rows is ONE line on the screen (with the rows), not one line per row. */
export function groupIssues(issues: ProgramIssue[]): ProgramIssue[] {
  const groups = new Map<string, ProgramIssue[]>()
  const out: ProgramIssue[] = []
  for (const i of issues) {
    if ((i.code === 'bad_email' || i.code === 'probable_typo_domain') && i.token) { const k = `${i.code}|${i.token}`; groups.set(k, [...(groups.get(k) ?? []), i]) } else out.push(i)
  }
  for (const list of groups.values()) {
    const first = list[0]
    if (list.length === 1) { out.push(first); continue }
    const rowNos = list.map((i) => i.sheetRow).filter((r): r is number => r !== null)
    const more = rowNos.length > 8 ? ` and ${rowNos.length - 8} more` : ''
    out.push({
      ...first,
      message: first.code === 'bad_email'
        ? `"${first.token}" in the mail column is not an e-mail address and is skipped, on ${list.length} rows (rows ${rowNos.slice(0, 8).join(', ')}${more}).`
        : `${first.token} looks like a misspelt company address, on ${list.length} rows (rows ${rowNos.slice(0, 8).join(', ')}${more}).`,
    })
  }
  return out
}
