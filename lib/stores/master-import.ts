// Reads a "Store Master" sheet (Excel or CSV) into per-store values. Pure, so every rule is easy to test.
//
// The sheet is one row per store with the store code in the first column ("STORE") and any of the store
// fields as columns. Rules:
//  - columns are found by their heading (any case, "_" or spaces), so the sheet the facilities team already
//    keeps ("STORE, AC TOTAL, AC BRAND, AMC BRAND, ...") loads as it is (AMC BRAND / AMC VENDOR are read as AC-AMC BRAND / AC-AMC VENDOR), and so does this app's own export;
//  - only the columns that are in the file are touched, and an empty cell never overwrites what is saved;
//  - spelling that differs only by capitals or extra spaces inside the file ("Blue Star" / "BLUE STAR") is
//    merged into the spelling used most, so the reports do not split one brand into two.

export type StoreMasterField =
  | 'name' | 'address' | 'city' | 'state' | 'pincode' | 'oem' | 'active'
  | 'ac_total' | 'ac_brand' | 'ac_amc_brand' | 'ac_amc_vendor' | 'zenatix' | 'open_date'
  | 'cluster' | 'region' | 'priority_list' | 'festival'

/** The five AC-service details: only the AC service (AC issues, OEM / AMC follow-up) uses them. Every other field is generic to a store. */
export const AC_ONLY_FIELDS: StoreMasterField[] = ['ac_total', 'ac_brand', 'ac_amc_brand', 'ac_amc_vendor', 'zenatix']

/** The heading used for each field (the same wording as the facilities sheet). */
export const STORE_MASTER_HEADINGS: Record<StoreMasterField | 'code', string> = {
  code: 'STORE', name: 'NAME', address: 'ADDRESS', city: 'CITY', state: 'STATE', pincode: 'PIN CODE', oem: 'OEM', active: 'ACTIVE',
  ac_total: 'AC TOTAL', ac_brand: 'AC BRAND', ac_amc_brand: 'AC-AMC BRAND', ac_amc_vendor: 'AC-AMC VENDOR', zenatix: 'ZENATIX', open_date: 'OPEN DATE',
  cluster: 'CLUSTER', region: 'REGION', priority_list: 'STORE PRIORITY LIST AS PER OPS', festival: 'FESTIVAL',
}

const ALIASES: Record<string, StoreMasterField | 'code'> = {
  'store': 'code', 'store code': 'code', 'code': 'code',
  'name': 'name', 'store name': 'name',
  'address': 'address',
  'city': 'city',
  'state': 'state',
  'pincode': 'pincode', 'pin code': 'pincode', 'pin': 'pincode', 'postal code': 'pincode',
  'oem': 'oem', 'oem name': 'oem',
  'active': 'active', 'is active': 'active', 'status': 'active',
  'ac total': 'ac_total', 'total ac': 'ac_total', 'acs': 'ac_total',
  'ac brand': 'ac_brand',
  'ac amc brand': 'ac_amc_brand', 'amc brand': 'ac_amc_brand',
  'ac amc vendor': 'ac_amc_vendor', 'amc vendor': 'ac_amc_vendor',
  'zenatix': 'zenatix',
  'open date': 'open_date', 'opening date': 'open_date',
  'cluster': 'cluster',
  'region': 'region',
  'store priority list as per ops': 'priority_list', 'store priority list': 'priority_list', 'priority list': 'priority_list', 'priority': 'priority_list',
  'festival': 'festival', 'festivals': 'festival',
}

export const normalizeHeader = (h: unknown) => String(h ?? '').toLowerCase().replace(/[_\s-]+/g, ' ').trim()

/** Fields where the same value is typed in several spellings (capitals, spacing): merged to the most used one. */
type TextField = 'ac_brand' | 'ac_amc_brand' | 'ac_amc_vendor' | 'cluster' | 'region' | 'state' | 'priority_list'
const CANONICAL_FIELDS: TextField[] = ['ac_brand', 'ac_amc_brand', 'ac_amc_vendor', 'cluster', 'region', 'state', 'priority_list']

export interface StoreMasterValues {
  name?: string; address?: string; city?: string; state?: string; pincode?: string
  /** an OEM's name — resolved to the OEM by the caller */
  oem?: string
  active?: boolean
  ac_total?: number; ac_brand?: string; ac_amc_brand?: string; ac_amc_vendor?: string; zenatix?: boolean
  /** yyyy-mm-dd */
  open_date?: string
  cluster?: string; region?: string; priority_list?: string; festival?: string
}

export interface StoreMasterEntry { row: number; code: string; values: StoreMasterValues }

export interface PreparedStoreMaster {
  /** The columns of the file that were understood, by the wording used in this app. */
  recognised: StoreMasterField[]
  /** Headings in the file that are not store fields (left alone). */
  ignored: string[]
  entries: StoreMasterEntry[]
  /** Rows that cannot be used, each with the reason. */
  problems: string[]
  /** Things worth knowing that are not errors. */
  notes: string[]
}

const cleanText = (v: unknown): string => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()

/** Words typed in a cell instead of a value: the store simply has no value yet. */
const NOT_SET_WORDS = new Set(['pending', 'na', 'n/a', 'n.a.', 'tbd', 'tba', '-', '--', 'nil', 'none', 'not opened', 'upcoming'])
const EMPTY_DATE_WORDS = NOT_SET_WORDS

function pad(n: number) { return String(n).padStart(2, '0') }
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

function validDay(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return y >= 1900 && y <= 2100 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

type DateResult = { date: string } | { empty: true } | { error: string }

/** A cell as a date: a real date cell, an Excel serial number, or text as dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd. */
export function parseOpenDate(v: unknown): DateResult {
  if (v == null || v === '') return { empty: true }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { error: 'is not a valid date' }
    // Excel dates arrive as midnight UTC of the day shown in the sheet
    return { date: ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) }
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return { error: 'is not a valid date' }
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000)
    return { date: ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) }
  }
  const s = cleanText(v)
  if (s === '' || EMPTY_DATE_WORDS.has(s.toLowerCase())) return { empty: true }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s)
  if (m && validDay(+m[1], +m[2], +m[3])) return { date: ymd(+m[1], +m[2], +m[3]) }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m && validDay(+m[3], +m[2], +m[1])) return { date: ymd(+m[3], +m[2], +m[1]) }
  return { error: `"${s}" is not a valid date (use dd/mm/yyyy or yyyy-mm-dd)` }
}

export function parseYesNo(v: unknown): boolean | null | undefined {
  if (typeof v === 'boolean') return v
  const s = cleanText(v).toLowerCase()
  if (s === '') return undefined
  if (['yes', 'y', 'true', '1', 'active'].includes(s)) return true
  if (['no', 'n', 'false', '0', 'inactive'].includes(s)) return false
  return null
}

function parseCount(v: unknown): number | null | undefined {
  if (v == null || cleanText(v) === '') return undefined
  const n = typeof v === 'number' ? v : Number(cleanText(v).replace(/,/g, ''))
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null
}

export function prepareStoreMaster(headers: unknown[], rows: unknown[][]): PreparedStoreMaster {
  const fieldAt: (StoreMasterField | 'code' | null)[] = headers.map((h) => ALIASES[normalizeHeader(h)] ?? null)
  const ignored = headers.map((h, i) => (fieldAt[i] ? null : cleanText(h))).filter((h): h is string => !!h)
  const problems: string[] = []
  const notes: string[] = []

  const seenField = new Set<string>()
  for (let i = 0; i < fieldAt.length; i++) {
    const f = fieldAt[i]
    if (!f) continue
    // a heading used twice would silently lose one of the columns
    if (seenField.has(f)) { problems.push(`The file has two columns for ${STORE_MASTER_HEADINGS[f]}. Keep one and upload again.`); fieldAt[i] = null }
    seenField.add(f)
  }
  const codeCol = fieldAt.indexOf('code')
  const recognised = fieldAt.filter((f): f is StoreMasterField => !!f && f !== 'code')
  if (codeCol < 0) {
    return { recognised, ignored, entries: [], problems: [...problems, 'The first column must be the store code, headed STORE.'], notes }
  }

  const entries: StoreMasterEntry[] = []
  const seenCodes = new Map<string, number>()
  let notSetCells = 0

  rows.forEach((cells, idx) => {
    const rowNo = idx + 2
    if (!cells || cells.every((c) => cleanText(c) === '')) return
    const code = cleanText(cells[codeCol]).toUpperCase()
    if (!code) { problems.push(`Row ${rowNo}: store code is empty, skipped.`); return }
    if (seenCodes.has(code)) { problems.push(`Row ${rowNo}: ${code} is already on row ${seenCodes.get(code)}, skipped.`); return }
    seenCodes.set(code, rowNo)

    const values: StoreMasterValues = {}
    let bad: string | null = null
    for (let i = 0; i < fieldAt.length && !bad; i++) {
      const f = fieldAt[i]
      if (!f || f === 'code') continue
      const raw = cells[i]
      switch (f) {
        case 'ac_total': {
          const n = parseCount(raw)
          if (n === null) bad = `AC TOTAL "${cleanText(raw)}" must be a whole number`
          else if (n !== undefined) values.ac_total = n
          break
        }
        case 'zenatix': {
          const b = parseYesNo(raw)
          if (b === null) bad = `ZENATIX "${cleanText(raw)}" must be Yes or No`
          else if (b !== undefined) values.zenatix = b
          break
        }
        case 'active': {
          const b = parseYesNo(raw)
          if (b === null) bad = `ACTIVE "${cleanText(raw)}" must be Yes or No`
          else if (b !== undefined) values.active = b
          break
        }
        case 'open_date': {
          const d = parseOpenDate(raw)
          if ('error' in d) bad = `OPEN DATE ${d.error}`
          else if ('date' in d) values.open_date = d.date
          else if (cleanText(raw) !== '') notSetCells++
          break
        }
        default: {
          const t = cleanText(raw)
          if (NOT_SET_WORDS.has(t.toLowerCase())) notSetCells++
          else if (t !== '') (values as Record<string, string>)[f] = t
        }
      }
    }
    if (bad) { problems.push(`Row ${rowNo} (${code}): ${bad}, skipped.`); return }
    entries.push({ row: rowNo, code, values })
  })

  if (notSetCells > 0) notes.push(`${notSetCells} cell${notSetCells === 1 ? ' says' : 's say'} "Pending" (or NA / TBD / -) instead of a value, so ${notSetCells === 1 ? 'it stays' : 'they stay'} empty.`)

  // merge spellings that differ only by capitals / spacing, per column
  for (const field of CANONICAL_FIELDS) {
    if (!recognised.includes(field)) continue
    const spellings = new Map<string, Map<string, number>>() // lower-case form -> spelling -> uses
    for (const e of entries) {
      const v = e.values[field]
      if (!v) continue
      const key = v.toLowerCase()
      const m = spellings.get(key) ?? new Map<string, number>()
      m.set(v, (m.get(v) ?? 0) + 1)
      spellings.set(key, m)
    }
    const best = new Map<string, string>()
    for (const [key, m] of spellings) {
      const sorted = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] === a[0].toUpperCase() ? -1 : 1))
      best.set(key, sorted[0][0])
      if (m.size > 1) notes.push(`${STORE_MASTER_HEADINGS[field]}: ${[...m.keys()].map((s) => `"${s}"`).join(' / ')} treated as "${sorted[0][0]}".`)
    }
    for (const e of entries) {
      const v = e.values[field]
      if (v) e.values[field] = best.get(v.toLowerCase())
    }
  }

  return { recognised, ignored, entries, problems, notes }
}

/** The label of a field for messages ("AC TOTAL"). */
export const fieldHeading = (f: StoreMasterField) => STORE_MASTER_HEADINGS[f]
