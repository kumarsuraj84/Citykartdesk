// AC master and Genset master: the copy of the sheets as lists the screens, the Excel export and the dashboards can use. Read only, server side.
// The same columns serve every dashboard: counts by brand, tonnage, region, AMC vendor, store.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type FleetKind = 'ac' | 'genset'
export const isFleetKind = (v: unknown): v is FleetKind => v === 'ac' || v === 'genset'

export type FleetFilters = { q?: string; status?: 'active' | 'inactive' | 'removed' | 'all'; brand?: string; region?: string; vendor?: string }

export type AcMasterRow = {
  id: string; store_code: string; ckdesk_no: string; serial: string | null; floor: string | null; ac_type: string | null; tonnage: string | null; brand: string | null
  amc_vendor: string | null; amc_brand: string | null; region: string | null; cluster: string | null; city: string | null; state: string | null
  is_active: boolean; emails: string[]; removed_at: string | null
}
export type GensetMasterRow = {
  id: string; store_code: string; brand: string | null; kva: string | null; serial: string | null; cpcb_group: string | null; emails: string[]; removed_at: string | null
}

export const AC_COLUMNS = [
  { key: 'store_code', label: 'Store' }, { key: 'ckdesk_no', label: 'CKDESK no' }, { key: 'serial', label: 'Serial' }, { key: 'floor', label: 'Floor' },
  { key: 'ac_type', label: 'Type' }, { key: 'tonnage', label: 'Tonnage' }, { key: 'brand', label: 'Brand' }, { key: 'amc_vendor', label: 'AMC vendor' },
  { key: 'amc_brand', label: 'AMC brand' }, { key: 'region', label: 'Region' }, { key: 'cluster', label: 'Cluster' }, { key: 'city', label: 'City' },
  { key: 'state', label: 'State' }, { key: 'state_label', label: 'Status' }, { key: 'mail', label: 'OEM mail' },
]
export const GENSET_COLUMNS = [
  { key: 'store_code', label: 'Store' }, { key: 'brand', label: 'Brand' }, { key: 'kva', label: 'KVA' }, { key: 'serial', label: 'Serial' },
  { key: 'cpcb_group', label: 'CPCB group' }, { key: 'state_label', label: 'Status' }, { key: 'mail', label: 'OEM mail' },
]

export const MAX_LIST_ROWS = 20000

const AC_COLS = 'id, store_code, ckdesk_no, serial, floor, ac_type, tonnage, brand, amc_vendor, amc_brand, region, cluster, city, state, is_active, emails, removed_at'
const GS_COLS = 'id, store_code, brand, kva, serial, cpcb_group, emails, removed_at'

export async function loadFleet(db: Db, orgId: string, kind: 'ac'): Promise<AcMasterRow[]>
export async function loadFleet(db: Db, orgId: string, kind: 'genset'): Promise<GensetMasterRow[]>
export async function loadFleet(db: Db, orgId: string, kind: FleetKind): Promise<(AcMasterRow | GensetMasterRow)[]> {
  const table = kind === 'ac' ? 'master_ac_units' : 'master_gensets'
  const { data, error } = await db.from(table).select(kind === 'ac' ? AC_COLS : GS_COLS).eq('org_id', orgId).order('store_code').limit(MAX_LIST_ROWS)
  if (error) throw new Error(`fleet list failed: ${error.message}`)
  return (data ?? []) as (AcMasterRow | GensetMasterRow)[]
}

/** The state of one row as the screens and the export say it. */
export function stateOf(r: { removed_at: string | null; is_active?: boolean }): 'removed' | 'inactive' | 'active' {
  if (r.removed_at) return 'removed'
  if (r.is_active === false) return 'inactive'
  return 'active'
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

export function filterFleet<T extends AcMasterRow | GensetMasterRow>(rows: T[], f: FleetFilters): T[] {
  const status = f.status ?? 'active'
  const q = norm(f.q)
  return rows.filter((r) => {
    if (status !== 'all' && stateOf(r) !== status) return false
    if (f.brand && norm(r.brand) !== norm(f.brand)) return false
    const a = r as Partial<AcMasterRow>
    if (f.region && norm(a.region) !== norm(f.region)) return false
    if (f.vendor && norm(a.amc_vendor) !== norm(f.vendor)) return false
    if (q) {
      const hay = [r.store_code, r.serial, r.brand, (r as AcMasterRow).ckdesk_no, (r as AcMasterRow).city, (r as AcMasterRow).amc_vendor, (r as GensetMasterRow).cpcb_group, ...r.emails].map(norm).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Count of rows per value of a column (empty = "(blank)"), biggest first: the figures behind a dashboard's "by brand", "by region"... */
export function countBy<T>(rows: T[], pick: (r: T) => string | null | undefined): { value: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const v = (pick(r) ?? '').trim() || '(blank)'
    m.set(v, (m.get(v) ?? 0) + 1)
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

export const distinct = <T,>(rows: T[], pick: (r: T) => string | null | undefined): string[] =>
  [...new Set(rows.map((r) => (pick(r) ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))

/** Rows ready for the CSV export (the status in words, the OEM addresses in one cell). */
export function exportRows(kind: FleetKind, rows: (AcMasterRow | GensetMasterRow)[]): Record<string, unknown>[] {
  return rows.map((r) => ({ ...r, state_label: stateOf(r as AcMasterRow).replace(/^./, (c) => c.toUpperCase()), mail: r.emails.join('; ') }))
}
