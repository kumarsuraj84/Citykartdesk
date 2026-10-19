'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { logAdminAudit } from './audit'
import { readStoreMasterFile } from '@/lib/stores/master-file'
import { buildStoreMasterSampleWorkbook } from '@/lib/stores/master-sample'
import { prepareStoreMaster, fieldHeading, type StoreMasterEntry, type StoreMasterField, type StoreMasterValues } from '@/lib/stores/master-import'
import type { Database } from '@/types/database'

type ActionResult<T = undefined> = { error?: string; data?: T }
type StoreRow = Database['public']['Tables']['stores']['Row']
type StoreUpdate = Database['public']['Tables']['stores']['Update']

export interface StoreMasterPreview {
  fileName: string
  /** Columns of the file that will be loaded, by the app's wording. */
  columns: string[]
  /** Headings that are not store fields (left alone). */
  ignored: string[]
  stores: number
  /** Stores in the file that exist in CK Desk and would change / are already as in the file. */
  willChange: number
  unchanged: number
  /** Store codes in the file that are not in CK Desk yet. */
  missing: string[]
  problems: string[]
  notes: string[]
}

export interface StoreMasterResult { updated: number; unchanged: number; created: number; skipped: number; problems: string[] }

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' as const }
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Admin or manager role required.' as const }
  if (!profile.org_id) return { error: 'No organization.' as const }
  return { profile, orgId: profile.org_id }
}

const MAX_LISTED = 40

/** Store values to save, in the database's column names (oem resolved to its id by the caller). */
function toColumns(v: StoreMasterValues, oems: { ac?: string | null; genset?: string | null } | undefined): StoreUpdate {
  const out: StoreUpdate = {}
  if (v.name !== undefined) out.name = v.name
  if (v.address !== undefined) out.address = v.address
  if (v.city !== undefined) out.city = v.city
  if (v.state !== undefined) out.state = v.state
  if (v.pincode !== undefined) out.pincode = v.pincode
  if (oems?.ac) out.oem_id = oems.ac
  if (oems?.genset) out.genset_oem_id = oems.genset
  if (v.active !== undefined) out.is_active = v.active
  if (v.ac_total !== undefined) out.ac_total = v.ac_total
  if (v.ac_brand !== undefined) out.ac_brand = v.ac_brand
  if (v.ac_amc_brand !== undefined) out.ac_amc_brand = v.ac_amc_brand
  if (v.ac_amc_vendor !== undefined) out.ac_amc_vendor = v.ac_amc_vendor
  if (v.zenatix !== undefined) out.zenatix = v.zenatix
  if (v.open_date !== undefined) out.open_date = v.open_date
  if (v.cluster !== undefined) out.cluster = v.cluster
  if (v.region !== undefined) out.region = v.region
  if (v.priority_list !== undefined) out.priority_list = v.priority_list
  if (v.festival !== undefined) out.festival = v.festival
  return out
}

/** Only the columns whose value differs from what the store has now. */
function changedColumns(store: StoreRow, wanted: StoreUpdate): StoreUpdate {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(wanted)) {
    if ((store as unknown as Record<string, unknown>)[k] !== v) out[k] = v
  }
  return out as StoreUpdate
}

async function loadAllStores(orgId: string): Promise<StoreRow[]> {
  const admin = createAdminClient()
  const all: StoreRow[] = []
  // PostgREST returns at most 1000 rows per request
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('stores').select('*').eq('org_id', orgId).order('code').range(from, from + 999)
    const page = (data ?? []) as StoreRow[]
    all.push(...page)
    if (page.length < 1000) break
  }
  return all
}

interface Plan {
  prepared: ReturnType<typeof prepareStoreMaster>
  existing: Map<string, StoreRow>
  /** existing stores with something to change */
  changes: { store: StoreRow; set: StoreUpdate }[]
  unchanged: number
  /** entries whose store is not in CK Desk yet */
  missing: StoreMasterEntry[]
  problems: string[]
  oemIdByEntry: Map<string, { ac?: string | null; genset?: string | null }>
}

async function plan(formData: FormData, orgId: string): Promise<{ error: string } | (Plan & { fileName: string })> {
  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'Choose a file first.' }
  const table = await readStoreMasterFile(file.name, await file.arrayBuffer())
  if ('error' in table) return table
  const prepared = prepareStoreMaster(table.headers, table.rows)
  if (prepared.entries.length === 0) return { error: prepared.problems[0] ?? 'No store rows were found in the file.' }
  if (prepared.recognised.length === 0) {
    return { error: `None of the columns were recognised. Expected headings such as ${(['ac_total', 'ac_brand', 'ac_amc_brand', 'cluster'] as StoreMasterField[]).map(fieldHeading).join(', ')}.` }
  }

  const problems = [...prepared.problems]
  const admin = createAdminClient()

  // an OEM column is matched to the OEMs set up in this organisation
  // The OEM column takes only OEMs of type AC, the GENSET OEM column only OEMs of type Genset: a name of the wrong type is refused with the row number.
  const oemIdByEntry = new Map<string, { ac?: string | null; genset?: string | null }>()
  if (prepared.recognised.includes('oem') || prepared.recognised.includes('genset_oem')) {
    const { data: oems } = await admin.from('oems').select('id, name, kind').eq('org_id', orgId)
    const byName = new Map((oems ?? []).map((o: { id: string; name: string; kind: string }) => [o.name.trim().toLowerCase(), o]))
    const resolve = (e: StoreMasterEntry, name: string | undefined, kind: 'ac' | 'genset', heading: string): string | null | undefined => {
      if (!name) return undefined
      const o = byName.get(name.toLowerCase())
      if (!o) { problems.push(`Row ${e.row} (${e.code}): OEM "${name}" is not set up, so the ${heading} was not changed.`); return null }
      if (o.kind !== kind) { problems.push(`Row ${e.row} (${e.code}): "${name}" is a ${o.kind === 'genset' ? 'Genset' : 'AC'} OEM, so it cannot go in the ${heading} column; the ${heading} was not changed.`); return null }
      return o.id
    }
    for (const e of prepared.entries) {
      const ac = resolve(e, e.values.oem, 'ac', 'OEM (AC)')
      const genset = resolve(e, e.values.genset_oem, 'genset', 'GENSET OEM')
      if (ac !== undefined || genset !== undefined) oemIdByEntry.set(e.code, { ac, genset })
    }
  }

  const stores = await loadAllStores(orgId)
  const existing = new Map(stores.map((s) => [s.code.toUpperCase(), s]))
  const changes: Plan['changes'] = []
  const missing: StoreMasterEntry[] = []
  let unchanged = 0
  for (const e of prepared.entries) {
    const store = existing.get(e.code)
    if (!store) { missing.push(e); continue }
    const set = changedColumns(store, toColumns(e.values, oemIdByEntry.get(e.code)))
    if (Object.keys(set).length === 0) unchanged++
    else changes.push({ store, set })
  }
  return { prepared, existing, changes, unchanged, missing, problems, oemIdByEntry, fileName: file.name }
}

/** The sample .xlsx for the upload: the right headings, two example rows and a how-to sheet. */
export async function downloadStoreMasterSample(): Promise<ActionResult<{ data: string; filename: string }>> {
  const guard = await requireAdminOrManager()
  if ('error' in guard) return { error: guard.error }
  const buffer = await buildStoreMasterSampleWorkbook().xlsx.writeBuffer()
  return { data: { data: Buffer.from(buffer).toString('base64'), filename: 'Store Master - sample.xlsx' } }
}

/** Reads the file and says what an upload would do, without changing anything. */
export async function previewStoreMaster(formData: FormData): Promise<ActionResult<StoreMasterPreview>> {
  const guard = await requireAdminOrManager()
  if ('error' in guard) return { error: guard.error }
  const p = await plan(formData, guard.orgId)
  if ('error' in p) return { error: p.error }
  return {
    data: {
      fileName: p.fileName,
      columns: p.prepared.recognised.map(fieldHeading),
      ignored: p.prepared.ignored,
      stores: p.prepared.entries.length,
      willChange: p.changes.length,
      unchanged: p.unchanged,
      missing: p.missing.map((m) => m.code),
      problems: p.problems.slice(0, MAX_LISTED),
      notes: p.prepared.notes,
    },
  }
}

/** Saves the file's values into the stores. `addMissing`: also create the stores that are not in CK Desk yet. */
export async function applyStoreMaster(formData: FormData): Promise<ActionResult<StoreMasterResult>> {
  const guard = await requireAdminOrManager()
  if ('error' in guard) return { error: guard.error }
  const orgId = guard.orgId
  const p = await plan(formData, orgId)
  if ('error' in p) return { error: p.error }
  const addMissing = formData.get('addMissing') === 'true'
  const admin = createAdminClient()
  const problems = [...p.problems]

  let updated = 0
  const BATCH = 10
  for (let i = 0; i < p.changes.length; i += BATCH) {
    const results = await Promise.all(p.changes.slice(i, i + BATCH).map(async ({ store, set }) => {
      const { error } = await admin.from('stores').update(set).eq('id', store.id).eq('org_id', orgId)
      return { store, error }
    }))
    for (const r of results) {
      if (r.error) problems.push(`${r.store.code}: ${sanitizeError(r.error, { route: 'storeMaster.ts#apply', fallback: 'could not be saved' })}`)
      else updated++
    }
  }

  let created = 0
  if (addMissing && p.missing.length > 0) {
    const rows = p.missing.map((e) => ({
      org_id: orgId, code: e.code, name: e.values.name ?? e.code, ...toColumns(e.values, p.oemIdByEntry.get(e.code)),
    }))
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await admin.from('stores').insert(rows.slice(i, i + 100))
      if (error) problems.push(`Adding stores failed: ${sanitizeError(error, { route: 'storeMaster.ts#create', fallback: 'could not be saved' })}`)
      else created += rows.slice(i, i + 100).length
    }
  }

  await logAdminAudit({
    orgId, actorId: guard.profile.id, entityType: 'store', entityId: null, action: 'store_master_upload',
    metadata: { file: p.fileName, updated, created, unchanged: p.unchanged, columns: p.prepared.recognised },
  })
  revalidatePath('/admin/org')
  return {
    data: {
      updated, created, unchanged: p.unchanged,
      skipped: p.problems.length + (addMissing ? 0 : p.missing.length),
      problems: problems.slice(0, MAX_LISTED),
    },
  }
}
