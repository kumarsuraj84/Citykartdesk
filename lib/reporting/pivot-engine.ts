// Pure, framework-free pivot computation: raw rows + a pivot configuration in,
// a fully-aggregated row/column tree out. No DB/React imports here on purpose —
// this runs identically server-side (for the export path) and client-side (for
// live re-pivoting as the user drags fields around, without a round-trip).

import type { ReportField, FieldDataType } from './field-registry'
import { labelForFieldValue } from './field-registry'
import type { ReportRow } from '@/lib/queries/reporting'

export type AggFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'countDistinct' | 'countTrue' | 'countFalse'

export interface ValueFieldConfig {
  field: string
  agg: AggFunc
}

export type FilterOp = 'eq' | 'neq' | 'in' | 'notIn' | 'gte' | 'lte' | 'contains'

export interface FieldFilter {
  field: string
  op: FilterOp
  value: string | number | boolean | Array<string | number>
}

export interface PivotConfig {
  rowFields: string[]
  colFields: string[]
  valueFields: ValueFieldConfig[]
  filters: FieldFilter[]
}

/** A relative date-range shortcut ("Today", "Last 7 days", …) — stored instead of
 *  fixed dates so a saved report's range stays current every time it's run, not
 *  frozen at whatever it resolved to on the day it was saved. `null` means the
 *  user picked an explicit from/to pair instead of one of the presets. */
export type DatePreset = 'today' | 'last7' | 'last30' | 'thisMonth' | null

/** Everything PivotBuilder needs to fully reproduce a report layout — saved as
 *  one JSON blob (saved_reports.config) and restored verbatim on load. */
export interface SavedReportConfig {
  mode: 'table' | 'pivot'
  columns: string[]
  rowFields: string[]
  colFields: string[]
  valueFields: ValueFieldConfig[]
  filters: FieldFilter[]
  dateRangeField: string
  datePreset: DatePreset
  /** Only meaningful when datePreset is null (an explicit custom range). */
  dateFrom: string
  dateTo: string
}

// ── Formatting a raw cell value into the string used as a group key/label ──────

function displayValue(raw: unknown, field: ReportField): string {
  if (raw === null || raw === undefined || raw === '') return '(blank)'
  if (field.type === 'boolean') return raw === true || raw === 'true' ? 'Yes' : 'No'
  if (field.type === 'date') return String(raw).slice(0, 10)
  if (field.type === 'enum') return labelForFieldValue(field, raw)
  return String(raw)
}

const NATURAL = new Intl.Collator(undefined, { numeric: true })

const UNKNOWN_FIELD = (key: string): ReportField => ({ key, label: key, type: 'string' })

// ── Filtering ────────────────────────────────────────────────────────────────

export function applyFilters(rows: ReportRow[], filters: FieldFilter[]): ReportRow[] {
  if (filters.length === 0) return rows
  return rows.filter((row) =>
    filters.every((f) => {
      const v = row[f.field]
      switch (f.op) {
        case 'eq': return String(v ?? '') === String(f.value)
        case 'neq': return String(v ?? '') !== String(f.value)
        case 'in': return Array.isArray(f.value) && f.value.map(String).includes(String(v ?? ''))
        case 'notIn': return Array.isArray(f.value) && !f.value.map(String).includes(String(v ?? ''))
        case 'gte': return v !== null && v !== undefined && v >= f.value
        case 'lte': return v !== null && v !== undefined && v <= f.value
        case 'contains': return String(v ?? '').toLowerCase().includes(String(f.value).toLowerCase())
        default: return true
      }
    })
  )
}

// ── Aggregation accumulator ─────────────────────────────────────────────────

interface Accumulator {
  sum: number
  count: number // non-blank value count
  min: number | string | null
  max: number | string | null
  countTrue: number
  countFalse: number
  distinct: Set<string>
}

function newAccumulator(): Accumulator {
  return { sum: 0, count: 0, min: null, max: null, countTrue: 0, countFalse: 0, distinct: new Set() }
}

function accumulate(acc: Accumulator, rows: ReportRow[], fieldKey: string, type: FieldDataType) {
  for (const row of rows) {
    const raw = fieldKey === '__count__' ? 1 : row[fieldKey]
    if (raw === null || raw === undefined || raw === '') continue
    if (type === 'number') {
      const n = Number(raw)
      acc.sum += n
      acc.count++
      if (acc.min === null || n < (acc.min as number)) acc.min = n
      if (acc.max === null || n > (acc.max as number)) acc.max = n
    } else if (type === 'date') {
      const s = String(raw)
      acc.count++
      if (acc.min === null || s < (acc.min as string)) acc.min = s
      if (acc.max === null || s > (acc.max as string)) acc.max = s
    } else if (type === 'boolean') {
      acc.count++
      if (raw === true || raw === 'true') acc.countTrue++
      else acc.countFalse++
    } else {
      acc.sum += 1
      acc.count++
      acc.distinct.add(String(raw))
    }
  }
}

function finalize(acc: Accumulator, agg: AggFunc): number | string | null {
  switch (agg) {
    case 'sum': return acc.sum
    case 'avg': return acc.count > 0 ? acc.sum / acc.count : null
    case 'min': return acc.min
    case 'max': return acc.max
    case 'count': return acc.count
    case 'countDistinct': return acc.distinct.size
    case 'countTrue': return acc.countTrue
    case 'countFalse': return acc.countFalse
  }
}

// ── Grouping tree (shared shape for both the row axis and the column axis) ────

export interface GroupNode {
  value: string
  path: string[]
  rows: ReportRow[]
  children: GroupNode[]
}

function buildGroupTree(rows: ReportRow[], fields: string[], fieldsByKey: Map<string, ReportField>, path: string[] = []): GroupNode[] {
  if (fields.length === 0) return []
  const [field, ...rest] = fields
  const fieldDef = fieldsByKey.get(field) ?? UNKNOWN_FIELD(field)
  const buckets = new Map<string, ReportRow[]>()
  for (const row of rows) {
    const key = displayValue(row[field], fieldDef)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(row)
  }
  return [...buckets.entries()]
    // natural order, not plain text order: "0–5 days, 6–10 days, 11–20 days ... 90+ days" (plain text put 11–20 before 6–10), and "Week-2" before "Week-10" (audit F-37)
    .sort(([a], [b]) => NATURAL.compare(a, b))
    .map(([value, groupRows]) => {
      const nodePath = [...path, value]
      return { value, path: nodePath, rows: groupRows, children: buildGroupTree(groupRows, rest, fieldsByKey, nodePath) }
    })
}

export interface ColumnLeaf {
  path: string[]
  key: string
}

function flattenLeaves(nodes: GroupNode[]): ColumnLeaf[] {
  if (nodes.length === 0) return [{ path: [], key: '__all__' }]
  const leaves: ColumnLeaf[] = []
  const walk = (node: GroupNode) => {
    if (node.children.length === 0) leaves.push({ path: node.path, key: node.path.join(' ') })
    else node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return leaves
}

function rowsMatchingColumnPath(rows: ReportRow[], colFields: string[], colPath: string[], fieldsByKey: Map<string, ReportField>): ReportRow[] {
  if (colPath.length === 0) return rows
  return rows.filter((row) => colPath.every((v, i) => displayValue(row[colFields[i]], fieldsByKey.get(colFields[i]) ?? UNKNOWN_FIELD(colFields[i])) === v))
}

// ── Public result shape ──────────────────────────────────────────────────────

export interface PivotCellSet {
  [valueFieldIndex: number]: number | string | null
}

export interface PivotRow {
  path: string[]
  depth: number
  label: string
  isSubtotal: boolean
  recordCount: number
  cells: PivotCellSet[] // one per column leaf, in colLeaves order
  /**
   * The row's "Total" column: each value field aggregated over ALL the row's records, with the field's OWN aggregate (an average of the records, the smallest of them, the number of
   * different ones ...). Adding the cells together is only right for sums and counts; for an average of 5 and an average of 7 it gave 12 (audit F-06).
   */
  rowTotal: PivotCellSet
  children: PivotRow[]
}

export interface PivotResult {
  colLeaves: ColumnLeaf[]
  rows: PivotRow[]
  grandTotal: PivotCellSet[]
  /** the Grand Total row's "Total" column (same rule as PivotRow.rowTotal) */
  grandRowTotal: PivotCellSet
  totalRecords: number
}

export function computePivot(allRows: ReportRow[], config: PivotConfig, fields: ReportField[]): PivotResult {
  const fieldsByKey = new Map(fields.map((f) => [f.key, f]))
  const rows = applyFilters(allRows, config.filters)

  const colTree = buildGroupTree(rows, config.colFields, fieldsByKey)
  const colLeaves = flattenLeaves(colTree)

  function aggregate(matching: ReportRow[]): PivotCellSet {
    const cell: PivotCellSet = {}
    config.valueFields.forEach((vf, i) => {
      const acc = newAccumulator()
      accumulate(acc, matching, vf.field, fieldsByKey.get(vf.field)?.type ?? 'string')
      cell[i] = finalize(acc, vf.agg)
    })
    return cell
  }

  function computeCells(nodeRows: ReportRow[]): PivotCellSet[] {
    return colLeaves.map((leaf) => aggregate(rowsMatchingColumnPath(nodeRows, config.colFields, leaf.path, fieldsByKey)))
  }

  function buildRows(nodes: GroupNode[], depth: number): PivotRow[] {
    return nodes.map((node) => ({
      path: node.path,
      depth,
      label: node.value,
      isSubtotal: node.children.length > 0,
      recordCount: node.rows.length,
      cells: computeCells(node.rows),
      rowTotal: aggregate(node.rows),
      children: buildRows(node.children, depth + 1),
    }))
  }

  const rowTree = buildGroupTree(rows, config.rowFields, fieldsByKey)
  const pivotRows = buildRows(rowTree, 0)
  const grandTotal = computeCells(rows)

  return { colLeaves, rows: pivotRows, grandTotal, grandRowTotal: aggregate(rows), totalRecords: rows.length }
}

/** Flattens a PivotResult back to a simple row-per-record table — used by the
 * "dynamic table" mode (no row/column grouping, just the selected columns). */
export function toFlatTable(allRows: ReportRow[], filters: FieldFilter[], columns: string[]): ReportRow[] {
  const filtered = applyFilters(allRows, filters)
  return filtered.map((row) => {
    const out: ReportRow = {}
    for (const c of columns) out[c] = row[c] ?? null
    return out
  })
}
