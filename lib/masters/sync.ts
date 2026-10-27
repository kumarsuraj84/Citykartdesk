import { createHash } from 'crypto'
import { parseAcSheet, parseCvmSheet, parseGensetSheet, parsePmsSheet } from './parse'
import { matchAcUnits, matchGensets, planRemovals, REMOVAL_WAIT_MINUTES } from './diff'
import type { AcRow, CvmRow, GensetRow, MasterIssue, MasterKind, PmsRow } from './types'
import type { SheetsSource } from './google'
import { fetchAllPages } from '@/lib/queries/paging'

// Copies the three master sheets into CK Desk's database (read only: nothing is ever written to a sheet). Run three times a day by the scheduled task (see
// schedule.ts) and on demand by an administrator. Everything else in CK Desk reads the database copy, never Google.
//  - a sheet whose content did not change is not applied again (a quick hash check), except for a full pass every 15 minutes and while a delayed removal is waiting;
//  - a sheet that cannot be read or has lost a required column is NOT applied: the last good copy stays in use and the page "Master data health" shows why;
//  - units that leave a sheet are kept (marked removed); a big disappearance is applied only at a later update (at least 30 minutes on), so a mistake can be undone in time.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type KindReport = { status: 'ok' | 'unchanged' | 'error' | 'unconfigured'; message?: string; added?: number; changed?: number; removed?: number; waiting?: number }
export type SyncReport = Record<MasterKind, KindReport>

const FULL_PASS_MINUTES = 15
const CHUNK = 200

function must<T>(res: { data?: T; error?: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data as T
}

/**
 * Reads every row of a master table of one organisation. QA-D021: the data service cuts ONE answer at 1,000 rows without any error, so reading the stored units in a single
 * request showed the copy only the first 1,000 of 2,316 units; every other sheet row looked new and was added again at every update. Read in pages, in a fixed order.
 */
async function readAll(db: Db, table: string, columns: string, orgId: string, order: string[]): Promise<Record<string, unknown>[]> {
  const { rows } = await fetchAllPages<Record<string, unknown>>((from, to) => {
    let q = db.from(table).select(columns).eq('org_id', orgId)
    for (const o of order) q = q.order(o, { ascending: true })
    return q.range(from, to)
  })
  return rows
}

async function inChunks<T>(items: T[], fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += CHUNK) await fn(items.slice(i, i + CHUNK))
}

const sameList = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
function differs(old: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return Object.keys(next).some((k) => !sameList(old[k], next[k]))
}

// ── column mapping ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const blank = (s: string) => (s === '' ? null : s)
const acColumns = (r: AcRow) => ({
  store_code: r.storeCode, ckdesk_no: r.ckdeskNo, serial: blank(r.serial), floor: blank(r.floor), ac_type: blank(r.acType), tonnage: blank(r.tonnage), brand: blank(r.brand),
  amc_vendor: blank(r.amcVendor), amc_brand: blank(r.amcBrand), zenatix: blank(r.zenatix), store_priority: blank(r.storePriority), festival: blank(r.festival),
  region: blank(r.region), cluster: blank(r.cluster), opening_date: r.openingDate, city: blank(r.city), state: blank(r.state), address: blank(r.address),
  pincode: blank(r.pincode), is_active: r.isActive, emails: r.emails, po_emails: r.poEmails, approver_emails: r.approverEmails, sheet_row: r.sheetRow,
})
const gensetColumns = (r: GensetRow) => ({
  store_code: r.storeCode, brand: blank(r.brand), kva: blank(r.kva), serial: blank(r.serial), cpcb_group: blank(r.cpcbGroup), emails: r.emails, sheet_row: r.sheetRow,
})

// ── store master (AC sheet feeds the store details one way) ──────────────────────────────────────────────────────────────────────
function mostCommon(values: string[]): string | null {
  const count = new Map<string, number>()
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1)
  let best: string | null = null
  let n = 0
  for (const [v, c] of count) if (c > n) { best = v; n = c }
  return best
}

export function storePatchFromAcRows(rows: AcRow[]): Record<string, unknown> {
  const active = rows.filter((r) => r.isActive)
  const first = (pick: (r: AcRow) => string) => rows.map(pick).find((v) => v) ?? null
  const patch: Record<string, unknown> = { ac_total: active.length }
  const set = (col: string, v: string | null) => { if (v) patch[col] = v }
  set('address', first((r) => r.address))
  set('city', first((r) => r.city))
  set('state', first((r) => r.state))
  set('pincode', first((r) => r.pincode))
  set('cluster', first((r) => r.cluster))
  set('region', first((r) => r.region))
  set('priority_list', first((r) => r.storePriority))
  set('festival', first((r) => r.festival))
  set('ac_brand', mostCommon(active.map((r) => r.brand)))
  set('ac_amc_brand', mostCommon(active.map((r) => r.amcBrand)))
  set('ac_amc_vendor', mostCommon(active.map((r) => r.amcVendor)))
  const date = rows.map((r) => r.openingDate).find((v) => v)
  if (date) patch.open_date = date
  const z = active.map((r) => r.zenatix.toLowerCase()).filter(Boolean)
  if (z.length) patch.zenatix = z.some((v) => v === 'yes' || v === 'y' || v === 'true')
  return patch
}

async function updateStoreMaster(db: Db, orgId: string, rows: AcRow[]) {
  const byStore = new Map<string, AcRow[]>()
  for (const r of rows) byStore.set(r.storeCode, [...(byStore.get(r.storeCode) ?? []), r])
  const codes = [...byStore.keys()]
  const stores: Record<string, unknown>[] = []
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK)
    const cols = 'id, code, ac_total, address, city, state, pincode, cluster, region, priority_list, festival, ac_brand, ac_amc_brand, ac_amc_vendor, open_date, zenatix'
    stores.push(...(must<Record<string, unknown>[]>(await db.from('stores').select(cols).eq('org_id', orgId).in('code', chunk), 'read stores') ?? []))
  }
  for (const s of stores) {
    const patch = storePatchFromAcRows(byStore.get(String(s.code)) ?? [])
    const changed: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) if (!sameList(s[k], v)) changed[k] = v
    if (Object.keys(changed).length) must(await db.from('stores').update(changed).eq('id', s.id).eq('org_id', orgId), 'update store')
  }
}

// ── one sheet ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function replaceIssues(db: Db, orgId: string, kind: MasterKind, issues: MasterIssue[]) {
  must(await db.from('master_issues').delete().eq('org_id', orgId).eq('kind', kind), 'clear issues')
  const rows = issues.slice(0, 500).map((i) => ({ org_id: orgId, kind, severity: i.severity, code: i.code, store_code: i.storeCode, sheet_row: i.sheetRow, message: i.message }))
  await inChunks(rows, async (c) => must(await db.from('master_issues').insert(c), 'save issues'))
}

async function unknownStoreIssues(db: Db, orgId: string, kind: MasterKind, codes: string[]): Promise<MasterIssue[]> {
  const known = new Set<string>()
  const unique = [...new Set(codes)]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const data = must<{ code: string }[]>(await db.from('stores').select('code').eq('org_id', orgId).in('code', unique.slice(i, i + CHUNK)), 'read store codes') ?? []
    for (const s of data) known.add(String(s.code).toUpperCase())
  }
  return unique.filter((c) => !known.has(c)).map((c) => ({
    kind, severity: 'warning' as const, code: 'unknown_store', storeCode: c, sheetRow: null,
    message: kind === 'pms'
      ? `Store ${c} is in the AC PMS sheet but not in the CK Desk store master, so no PMS ticket can be made for it until the store exists.`
      : `Store ${c} is in the sheet but not in the CK Desk store master. Its rows are kept, but nobody can raise a ticket for it until the store exists.`,
  }))
}

async function applyUnits<R extends { storeCode: string }>(p: {
  db: Db; orgId: string; table: 'master_ac_units' | 'master_gensets'; rows: R[]; now: Date
  match: (rows: R[], stored: { id: string; storeCode: string; ckdeskNo: string; serial: string | null; removedAt: string | null; missingSince: string | null }[]) => ReturnType<typeof matchGensets>
  columns: (r: R) => Record<string, unknown>
}): Promise<{ added: number; changed: number; removed: number; waiting: number; waitingIssue: MasterIssue | null }> {
  const { db, orgId, table, rows, now } = p
  const nowIso = now.toISOString()
  const stored = await readAll(db, table, '*', orgId, ['id'])
  const byId = new Map(stored.map((s) => [String(s.id), s]))
  const m = p.match(rows, stored.map((s) => ({
    id: String(s.id), storeCode: String(s.store_code), ckdeskNo: String(s.ckdesk_no ?? ''), serial: (s.serial as string | null) ?? null,
    removedAt: (s.removed_at as string | null) ?? null, missingSince: (s.missing_since as string | null) ?? null,
  })))

  const upserts: Record<string, unknown>[] = []
  for (const { rowIndex, unitId } of m.matches) {
    const old = byId.get(unitId)!
    const next = p.columns(rows[rowIndex])
    const revived = !!old.removed_at || !!old.missing_since
    if (!revived && !differs(old, next)) continue
    const prev = (old.previous_serials as string[] | null) ?? []
    const oldSerial = (old.serial as string | null) ?? null
    const newSerial = (next.serial as string | null) ?? null
    const previous_serials = oldSerial && oldSerial !== newSerial ? [...new Set([...prev, oldSerial])] : prev
    upserts.push({ id: unitId, org_id: orgId, ...next, previous_serials, last_seen_at: nowIso, missing_since: null, removed_at: null })
  }
  const changedCount = upserts.length
  await inChunks(upserts, async (c) => must(await db.from(table).upsert(c, { onConflict: 'id' }), `update ${table}`))

  const inserts = m.inserts.map((i) => ({ org_id: orgId, ...p.columns(rows[i]), first_seen_at: nowIso, last_seen_at: nowIso }))
  await inChunks(inserts, async (c) => must(await db.from(table).insert(c), `insert ${table}`))

  const current = stored.filter((s) => !s.removed_at).length
  const plan = planRemovals({ missing: m.unmatched.map((id) => ({ id, missingSince: (byId.get(id)?.missing_since as string | null) ?? null })), currentTotal: current, now })
  await inChunks(plan.removeNow, async (c) => must(await db.from(table).update({ removed_at: nowIso }).in('id', c), `remove ${table}`))
  await inChunks(plan.markMissing, async (c) => must(await db.from(table).update({ missing_since: nowIso }).in('id', c).is('missing_since', null), `mark missing ${table}`))

  let waitingIssue: MasterIssue | null = null
  if (plan.markMissing.length) {
    waitingIssue = {
      kind: table === 'master_ac_units' ? 'ac' : 'genset', severity: 'warning', code: 'big_change_waiting', storeCode: null, sheetRow: null,
      message: `${plan.markMissing.length} unit(s) disappeared from the sheet at once. This looks like a mistake, so they stay in CK Desk and are removed at the next update only if they are still missing then (at least ${REMOVAL_WAIT_MINUTES} minutes later). Undo the change in the sheet if it was not intended.`,
    }
  }
  return { added: inserts.length, changed: changedCount, removed: plan.removeNow.length, waiting: plan.markMissing.length, waitingIssue }
}

async function applyCvm(p: { db: Db; orgId: string; rows: CvmRow[]; now: Date }) {
  const { db, orgId, rows, now } = p
  const nowIso = now.toISOString()
  const stored = await readAll(db, 'master_store_cvm', '*', orgId, ['id'])
  const byStore = new Map(stored.map((s) => [String(s.store_code), s]))
  const upserts: Record<string, unknown>[] = []
  for (const r of rows) {
    const old = byStore.get(r.storeCode)
    const next = { store_code: r.storeCode, cvm_email: r.cvmEmail, sheet_row: r.sheetRow }
    if (old && !old.removed_at && !old.missing_since && !differs(old, next)) continue
    upserts.push({ ...(old ? { id: old.id } : {}), org_id: orgId, ...next, last_seen_at: nowIso, missing_since: null, removed_at: null })
  }
  const withId = upserts.filter((u) => u.id)
  const without = upserts.filter((u) => !u.id)
  await inChunks(withId, async (c) => must(await db.from('master_store_cvm').upsert(c, { onConflict: 'id' }), 'update CVM'))
  await inChunks(without, async (c) => must(await db.from('master_store_cvm').insert(c), 'insert CVM'))

  const seen = new Set(rows.map((r) => r.storeCode))
  const gone = stored.filter((s) => !s.removed_at && !seen.has(String(s.store_code)))
  const plan = planRemovals({ missing: gone.map((s) => ({ id: String(s.id), missingSince: (s.missing_since as string | null) ?? null })), currentTotal: stored.filter((s) => !s.removed_at).length, now })
  await inChunks(plan.removeNow, async (c) => must(await db.from('master_store_cvm').update({ removed_at: nowIso }).in('id', c), 'remove CVM'))
  await inChunks(plan.markMissing, async (c) => must(await db.from('master_store_cvm').update({ missing_since: nowIso }).in('id', c).is('missing_since', null), 'mark CVM missing'))
  const waitingIssue: MasterIssue | null = plan.markMissing.length
    ? { kind: 'cvm', severity: 'warning', code: 'big_change_waiting', storeCode: null, sheetRow: null, message: `${plan.markMissing.length} store(s) disappeared from the CVM sheet at once. They stay and are removed at the next update only if still missing then.` }
    : null
  return { added: without.length, changed: withId.length, removed: plan.removeNow.length, waiting: plan.markMissing.length, waitingIssue }
}

/** The AC PMS sheet is copied as it is: new dates are added, dates that left the sheet are dropped (tickets already made stay: they are ordinary tickets). */
async function applyPms(p: { db: Db; orgId: string; rows: PmsRow[]; now: Date }) {
  const { db, orgId, rows, now } = p
  const nowIso = now.toISOString()
  const stored = await readAll(db, 'master_pms_dates', 'store_code, pms_date, sheet_row', orgId, ['store_code', 'pms_date'])
  const key = (store: string, date: string) => `${store}|${date}`
  const have = new Map(stored.map((s) => [key(String(s.store_code), String(s.pms_date)), s]))
  const want = new Set(rows.map((r) => key(r.storeCode, r.pmsDate)))
  const adds = rows.filter((r) => !have.has(key(r.storeCode, r.pmsDate)))
  const moved = rows.filter((r) => { const o = have.get(key(r.storeCode, r.pmsDate)); return o && o.sheet_row !== r.sheetRow })
  const gone = stored.filter((s) => !want.has(key(String(s.store_code), String(s.pms_date))))
  await inChunks(adds.map((r) => ({ org_id: orgId, store_code: r.storeCode, pms_date: r.pmsDate, sheet_row: r.sheetRow, first_seen_at: nowIso, last_seen_at: nowIso })), async (c) => must(await db.from('master_pms_dates').insert(c), 'insert PMS dates'))
  await inChunks(moved.map((r) => ({ org_id: orgId, store_code: r.storeCode, pms_date: r.pmsDate, sheet_row: r.sheetRow, last_seen_at: nowIso })), async (c) => must(await db.from('master_pms_dates').upsert(c, { onConflict: 'org_id,store_code,pms_date' }), 'update PMS dates'))
  for (const g of gone) must(await db.from('master_pms_dates').delete().eq('org_id', orgId).eq('store_code', g.store_code).eq('pms_date', g.pms_date), 'remove PMS date')
  return { added: adds.length, changed: moved.length, removed: gone.length, waiting: 0, waitingIssue: null as MasterIssue | null }
}

async function pendingCount(db: Db, orgId: string, kind: MasterKind): Promise<number> {
  if (kind === 'pms') return 0   // the PMS copy has no delayed removals
  const table = kind === 'ac' ? 'master_ac_units' : kind === 'genset' ? 'master_gensets' : 'master_store_cvm'
  const { count } = await db.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('removed_at', null).not('missing_since', 'is', null)
  return count ?? 0
}

// Only ONE copy of a sheet runs at a time (QA defect QA-D001): two overlapping copies (the 11:00 job and an administrator pressing "Update from sheets now", or the 09:00 PMS job)
// both found the units missing and both inserted them, so every AC / genset appeared twice or three times. The run that comes second is told to wait for the next update.
// The claim is one row in app_settings (the key is unique); a claim older than STALE_LOCK_MINUTES belongs to a run that died and is taken over.
const STALE_LOCK_MINUTES = 10
async function claimSync(db: Db, orgId: string, kind: MasterKind, now: Date): Promise<{ claimed: boolean; release: () => Promise<void> }> {
  const key = `masters_sync_lock:${orgId}:${kind}`
  const mine = now.toISOString()
  const release = async () => { await db.from('app_settings').delete().eq('key', key).eq('value', mine) }
  const ins = await db.from('app_settings').insert({ key, value: mine })
  if (!ins.error) return { claimed: true, release }
  const { data: row } = await db.from('app_settings').select('value').eq('key', key).maybeSingle()
  const held = row?.value as string | undefined
  if (held && now.getTime() - new Date(held).getTime() < STALE_LOCK_MINUTES * 60_000) return { claimed: false, release: async () => {} }
  // the holder died: only the call that still sees the old value takes it over
  const { data: taken } = await db.from('app_settings').update({ value: mine }).eq('key', key).eq('value', held ?? '').select('key')
  return (taken?.length ?? 0) > 0 ? { claimed: true, release } : { claimed: false, release: async () => {} }
}

async function syncOne(p: { db: Db; orgId: string; kind: MasterKind; source: SheetsSource; now: Date; force: boolean; cvmEmailKnown?: (email: string) => Promise<'ok' | 'unknown'> }): Promise<KindReport> {
  const lock = await claimSync(p.db, p.orgId, p.kind, p.now)
  if (!lock.claimed) return { status: 'unchanged', message: 'Another update of this sheet is already running; this one was skipped.' }
  try { return await syncOneUnlocked(p) } finally { await lock.release().catch(() => {}) }
}

async function syncOneUnlocked(p: { db: Db; orgId: string; kind: MasterKind; source: SheetsSource; now: Date; force: boolean; cvmEmailKnown?: (email: string) => Promise<'ok' | 'unknown'> }): Promise<KindReport> {
  const { db, orgId, kind, now } = p
  const { data: src } = await db.from('master_sources').select('*').eq('org_id', orgId).eq('kind', kind).maybeSingle()
  if (!src?.spreadsheet_id) return { status: 'unconfigured' }
  const nowIso = now.toISOString()
  const fail = async (message: string): Promise<KindReport> => {
    await db.from('master_sources').update({ last_checked_at: nowIso, last_status: 'error', last_error: message }).eq('org_id', orgId).eq('kind', kind)
    return { status: 'error', message }
  }

  let values: unknown[][]
  try { values = await p.source.fetchValues(src.spreadsheet_id, src.tab_name ?? null) } catch (e) { return fail(e instanceof Error ? e.message : 'The sheet could not be read.') }

  const hash = createHash('sha1').update(JSON.stringify(values)).digest('hex')
  const pending = await pendingCount(db, orgId, kind)
  const fresh = src.last_applied_at && now.getTime() - new Date(src.last_applied_at).getTime() < FULL_PASS_MINUTES * 60_000
  if (!p.force && src.content_hash === hash && src.last_status === 'ok' && pending === 0 && fresh) {
    await db.from('master_sources').update({ last_checked_at: nowIso }).eq('org_id', orgId).eq('kind', kind)
    return { status: 'unchanged' }
  }

  try {
    let result: { added: number; changed: number; removed: number; waiting: number; waitingIssue: MasterIssue | null }
    let issues: MasterIssue[]
    let rowCount: number
    if (kind === 'ac') {
      const parsed = parseAcSheet(values)
      if (parsed.fatal) return fail(parsed.fatal)
      result = await applyUnits<AcRow>({ db, orgId, table: 'master_ac_units', rows: parsed.rows, now, match: (r, s) => matchAcUnits(r, s as never), columns: acColumns })
      await updateStoreMaster(db, orgId, parsed.rows)
      issues = [...parsed.issues, ...(await unknownStoreIssues(db, orgId, 'ac', parsed.rows.map((r) => r.storeCode)))]
      if (p.cvmEmailKnown) {   // an approver must be an active technician, manager or admin, or a vendor's quote for that AC would never reach anyone
        const active = parsed.rows.filter((r) => r.isActive)
        for (const email of [...new Set(active.flatMap((r) => r.approverEmails))]) {
          if ((await p.cvmEmailKnown(email)) === 'unknown') {
            const stores = [...new Set(active.filter((r) => r.approverEmails.includes(email)).map((r) => r.storeCode))]
            issues.push({ kind: 'ac', severity: 'warning', code: 'approver_no_login', storeCode: stores[0] ?? null, sheetRow: null, message: `${email} (PO approver of ${stores.slice(0, 5).join(', ')}${stores.length > 5 ? ' and more' : ''}) is not an active technician, manager or admin in CK Desk, so that address is skipped and the default PO approver is used.` })
          }
        }
      }
      rowCount = parsed.rows.length
    } else if (kind === 'genset') {
      const parsed = parseGensetSheet(values)
      if (parsed.fatal) return fail(parsed.fatal)
      result = await applyUnits<GensetRow>({ db, orgId, table: 'master_gensets', rows: parsed.rows, now, match: (r, s) => matchGensets(r, s), columns: gensetColumns })
      issues = [...parsed.issues, ...(await unknownStoreIssues(db, orgId, 'genset', parsed.rows.map((r) => r.storeCode)))]
      rowCount = parsed.rows.length
    } else if (kind === 'pms') {
      const parsed = parsePmsSheet(values)
      if (parsed.fatal) return fail(parsed.fatal)
      result = await applyPms({ db, orgId, rows: parsed.rows, now })
      issues = [...parsed.issues, ...(await unknownStoreIssues(db, orgId, 'pms', parsed.rows.map((r) => r.storeCode)))]
      rowCount = parsed.rows.length
    } else {
      const parsed = parseCvmSheet(values)
      if (parsed.fatal) return fail(parsed.fatal)
      result = await applyCvm({ db, orgId, rows: parsed.rows, now })
      issues = [...parsed.issues, ...(await unknownStoreIssues(db, orgId, 'cvm', parsed.rows.map((r) => r.storeCode)))]
      if (p.cvmEmailKnown) {
        for (const email of [...new Set(parsed.rows.map((r) => r.cvmEmail))]) {
          if ((await p.cvmEmailKnown(email)) === 'unknown') {
            const stores = parsed.rows.filter((r) => r.cvmEmail === email).map((r) => r.storeCode)
            issues.push({ kind: 'cvm', severity: 'warning', code: 'cvm_no_login', storeCode: stores[0] ?? null, sheetRow: null, message: `${email} (CVM of ${stores.slice(0, 5).join(', ')}${stores.length > 5 ? ' and more' : ''}) is not an active technician, manager or admin in CK Desk, so approvals for those stores cannot be sent automatically.` })
          }
        }
      }
      rowCount = parsed.rows.length
    }
    if (result.waitingIssue) issues.push(result.waitingIssue)
    await replaceIssues(db, orgId, kind, issues)
    must(await db.from('master_sources').update({ last_checked_at: nowIso, last_applied_at: nowIso, last_status: 'ok', last_error: null, row_count: rowCount, content_hash: hash }).eq('org_id', orgId).eq('kind', kind), 'save status')
    return { status: 'ok', added: result.added, changed: result.changed, removed: result.removed, waiting: result.waiting }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The sheet could not be applied.')
  }
}

export async function syncMasters(p: {
  db: Db; orgId: string; source: SheetsSource; now?: Date; force?: boolean
  /** Tells whether an e-mail address (a CVM, or a PO approver) belongs to an active staff member (used only to report problems). */
  cvmEmailKnown?: (email: string) => Promise<'ok' | 'unknown'>
}): Promise<SyncReport> {
  const now = p.now ?? new Date()
  const report = {} as SyncReport
  for (const kind of ['ac', 'genset', 'cvm', 'pms'] as MasterKind[]) {
    try {
      report[kind] = await syncOne({ db: p.db, orgId: p.orgId, kind, source: p.source, now, force: p.force ?? false, cvmEmailKnown: p.cvmEmailKnown })
    } catch (e) {
      report[kind] = { status: 'error', message: e instanceof Error ? e.message : 'Unexpected error.' }
    }
  }
  return report
}
