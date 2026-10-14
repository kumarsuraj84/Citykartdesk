// The common shape of every fixed report: a table that looks like the Excel pivot it replaces (heading band, rows, "Total" lines, Grand Total) where every
// number knows which tickets are behind it, so a click can open them. The screen (components/reports/analytics/ReportTableView.tsx) and the Excel file
// (report-table-xlsx.ts) are both drawn from this one model, so they always agree.

/** One ticket behind the numbers. Cells point at tickets by their position in `ReportTable.tickets` (small numbers, not ids, so the page stays light). */
export interface ReportTicket {
  id: string
  no: string
  subject: string
  /** the requester account: a store code, or a person's name for head office staff */
  store: string
  cluster: string
  tech: string
  cat: string
  sub: string
  service: string
  status: string
  /** yyyy-mm-dd */
  created: string
  /** whole days old */
  age: number
  bucket: string
}

export interface ReportColumn {
  key: string
  label: string
  /** pixel width on screen (fixed layout, so the frozen first columns line up) */
  width: number
  align?: 'left' | 'center' | 'right'
  /** peach heading, like the Excel total columns (otherwise the blue heading band) */
  peach?: boolean
  /** shown as a percentage (the cell value is a fraction: 0.125 → 12.5%) */
  pct?: boolean
  /** a percentage shown in whole numbers (0.125 → 13%) */
  pctWhole?: boolean
  /** the body cells are tinted light green, like the Resolved columns of the Excel weekly sheet */
  tint?: 'green'
  /** the heading of this column (under a group heading) is peach like the total columns */
  headTone?: 'peach'
  /** the cell is shaded by its sign: green when above 0, red when below 0 (a difference in percent) */
  diff?: boolean
}

/** A heading above a run of columns (for example "Ticket" over the age-bucket columns). */
export interface HeadGroup { label: string; from: number; span: number; /** peach instead of blue */ peach?: boolean }

export type RowKind = 'row' | 'subtotal' | 'grand'
export type Cell = string | number | null

export interface ReportRow {
  key: string
  kind: RowKind
  /** one value per column ('' for blank). A subtotal or grand total row writes its label in the first cell, which spans the leading columns. */
  cells: Cell[]
  /** per column: the tickets behind the number (positions in `tickets`); a cell without them is not clickable */
  refs: (number[] | undefined)[]
}

export interface ReportTable {
  slug: string
  title: string
  columns: ReportColumn[]
  headGroups: HeadGroup[]
  rows: ReportRow[]
  tickets: ReportTicket[]
  /** how many leading columns are frozen (and are spanned by a Total line's label) */
  lead: number
  /** what the report counts, in words (statuses, scope): one line under the title */
  scopeText: string
  /** the day the "today" columns are about, when the report has them ("today" or "on 7 Oct 2026") */
  dayWord?: string
  /** a narrow table (few columns): drawn only as wide as its columns need, not stretched to the page */
  compact?: boolean
}

// ── Small helpers every report builder uses ──────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-02" → "02-Oct-26". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1].slice(2)}` : iso
}

/** The on-screen text of a cell: whole numbers as they are, fractions as percentages, blanks as nothing. */
export function cellText(v: Cell, col: ReportColumn): string {
  if (v === null || v === '') return ''
  if (typeof v === 'number') return col.pct ? `${col.pctWhole ? Math.round(v * 100) : Math.round(v * 1000) / 10}%` : String(v)
  return v
}

/** Natural order for names and codes: "BR2" before "BR10", case-insensitive. */
export const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export function emptyTable(slug: string, title: string, scopeText: string): ReportTable {
  return { slug, title, columns: [], headGroups: [], rows: [], tickets: [], lead: 1, scopeText }
}
