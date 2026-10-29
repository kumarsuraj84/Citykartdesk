import { createHash } from 'crypto'
import type { SheetsSource } from '@/lib/masters/google'
import { planRemovals, REMOVAL_WAIT_MINUTES } from '@/lib/masters/diff'
import { claimSync, differs, inChunks, must } from '@/lib/masters/sync'
import { fetchAllPages } from '@/lib/queries/paging'
import { matchProgramRows } from './match'
import { parseProgramSheet } from './parse'
import { syncProgramPms, type ProgramPmsSyncReport } from './pms-sync'
import type { ParsedProgramRow, ProgramIssue, ProgramRecord, StoredProgramRow } from './types'

// Copies each program's Google sheet into CK Desk's database (read only: nothing is ever written to a sheet), on the same schedule and with the same safety rules as the
// AC / Genset / CVM sheets (lib/masters/sync.ts): one copy at a time, a sheet that cannot be read or lost a required column is NOT applied (the last good copy stays in
// use), rows that leave the sheet are kept and only removed later, a big disappearance waits at least 30 minutes. Everything else reads the database copy, never Google.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type ProgramSyncReport = { programId: string; name: string; status: 'ok' | 'unchanged' | 'error' | 'unconfigured'; message?: string; added?: number; changed?: number; removed?: number; waiting?: number; /** the program's optional PMS sheet (absent when the program has none) */ pms?: ProgramPmsSyncReport }

const FULL_PASS_MINUTES = 15

const blank = (s: string) => (s === '' ? null : s)
const columnsOf = (r: ParsedProgramRow) => ({
  store_code: r.storeCode, machine_no: blank(r.machineNo), serial: blank(r.serial), vendor: blank(r.vendor), emails: r.emails, po_emails: r.poEmails,
  approver_emails: r.approverEmails, extra: r.extra, is_active: r.isActive, sheet_row: r.sheetRow,
})

async function readRows(db: Db, orgId: string, programId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await fetchAllPages<Record<string, unknown>>((from, to) => db.from('program_rows').select('*').eq('org_id', orgId).eq('program_id', programId).order('id', { ascending: true }).range(from, to))
  return rows
}

async function applyRows(p: { db: Db; orgId: string; program: ProgramRecord; rows: ParsedProgramRow[]; now: Date }) {
  const { db, orgId, program, rows, now } = p
  const nowIso = now.toISOString()
  const stored = await readRows(db, orgId, program.id)
  const byId = new Map(stored.map((s) => [String(s.id), s]))
  const m = matchProgramRows(rows, stored.map((s): StoredProgramRow => ({
    id: String(s.id), storeCode: String(s.store_code), machineNo: (s.machine_no as string | null) ?? null, serial: (s.serial as string | null) ?? null,
    vendor: (s.vendor as string | null) ?? null, removedAt: (s.removed_at as string | null) ?? null, missingSince: (s.missing_since as string | null) ?? null,
  })), program.row_type)

  const upserts: Record<string, unknown>[] = []
  for (const { rowIndex, unitId } of m.matches) {
    const old = byId.get(unitId)!
    const next = columnsOf(rows[rowIndex])
    const revived = !!old.removed_at || !!old.missing_since
    if (!revived && !differs(old, next)) continue
    const prev = (old.previous_serials as string[] | null) ?? []
    const oldSerial = (old.serial as string | null) ?? null
    const newSerial = (next.serial as string | null) ?? null
    const previous_serials = oldSerial && oldSerial !== newSerial ? [...new Set([...prev, oldSerial])] : prev
    upserts.push({ id: unitId, org_id: orgId, program_id: program.id, ...next, previous_serials, last_seen_at: nowIso, missing_since: null, removed_at: null })
  }
  await inChunks(upserts, async (c) => must(await db.from('program_rows').upsert(c, { onConflict: 'id' }), 'update program rows'))
  const inserts = m.inserts.map((i) => ({ org_id: orgId, program_id: program.id, ...columnsOf(rows[i]), first_seen_at: nowIso, last_seen_at: nowIso }))
  await inChunks(inserts, async (c) => must(await db.from('program_rows').insert(c), 'insert program rows'))

  const current = stored.filter((s) => !s.removed_at).length
  const plan = planRemovals({ missing: m.unmatched.map((id) => ({ id, missingSince: (byId.get(id)?.missing_since as string | null) ?? null })), currentTotal: current, now })
  await inChunks(plan.removeNow, async (c) => must(await db.from('program_rows').update({ removed_at: nowIso }).in('id', c), 'remove program rows'))
  await inChunks(plan.markMissing, async (c) => must(await db.from('program_rows').update({ missing_since: nowIso }).in('id', c).is('missing_since', null), 'mark program rows missing'))

  const waitingIssue: ProgramIssue | null = plan.markMissing.length
    ? { severity: 'warning', code: 'big_change_waiting', storeCode: null, sheetRow: null,
      message: `${plan.markMissing.length} row(s) disappeared from the sheet at once. This looks like a mistake, so they stay in CK Desk and are removed at the next update only if they are still missing then (at least ${REMOVAL_WAIT_MINUTES} minutes later). Undo the change in the sheet if it was not intended.` }
    : null
  return { added: inserts.length, changed: upserts.length, removed: plan.removeNow.length, waiting: plan.markMissing.length, waitingIssue }
}

async function unknownStoreIssues(db: Db, orgId: string, codes: string[]): Promise<ProgramIssue[]> {
  const unique = [...new Set(codes)]
  const known = new Set<string>()
  for (let i = 0; i < unique.length; i += 200) {
    const data = must<{ code: string }[]>(await db.from('stores').select('code').eq('org_id', orgId).in('code', unique.slice(i, i + 200)), 'read store codes') ?? []
    for (const s of data) known.add(String(s.code).toUpperCase())
  }
  return unique.filter((c) => !known.has(c)).map((c) => ({
    severity: 'warning' as const, code: 'unknown_store', storeCode: c, sheetRow: null,
    message: `Store ${c} is in the sheet but not in the CK Desk store master. Its rows are kept, but nobody can raise a ticket for it until the store exists.`,
  }))
}

async function replaceIssues(db: Db, orgId: string, programId: string, issues: ProgramIssue[]) {
  must(await db.from('program_issues').delete().eq('org_id', orgId).eq('program_id', programId).not('code', 'like', 'pms_%'), 'clear program issues')   // the PMS problems (codes pms_...) belong to the PMS sheet and are kept
  const rows = issues.slice(0, 500).map((i) => ({ org_id: orgId, program_id: programId, severity: i.severity, code: i.code, store_code: i.storeCode, sheet_row: i.sheetRow, message: i.message }))
  await inChunks(rows, async (c) => must(await db.from('program_issues').insert(c), 'save program issues'))
}

export async function syncProgram(p: { db: Db; orgId: string; program: ProgramRecord; source: SheetsSource; now: Date; force: boolean }): Promise<ProgramSyncReport> {
  const { db, orgId, program, now } = p
  const base = { programId: program.id, name: program.name }
  if (!program.spreadsheet_id) return { ...base, status: 'unconfigured' }
  const lock = await claimSync(db, orgId, `program:${program.id}`, now)
  if (!lock.claimed) return { ...base, status: 'unchanged', message: 'Another update of this sheet is already running; this one was skipped.' }
  try {
    const nowIso = now.toISOString()
    const fail = async (message: string): Promise<ProgramSyncReport> => {
      await db.from('vendor_programs').update({ last_checked_at: nowIso, last_status: 'error', last_error: message }).eq('id', program.id).eq('org_id', orgId)
      return { ...base, status: 'error', message }
    }
    let values: unknown[][]
    try { values = await p.source.fetchValues(program.spreadsheet_id, program.tab_name ?? null) } catch (e) { return await fail(e instanceof Error ? e.message : 'The sheet could not be read.') }

    const hash = createHash('sha1').update(JSON.stringify([values, program.row_type, program.columns ?? {}])).digest('hex')
    const { count } = await db.from('program_rows').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('program_id', program.id).is('removed_at', null).not('missing_since', 'is', null)
    const fresh = program.last_applied_at && now.getTime() - new Date(program.last_applied_at).getTime() < FULL_PASS_MINUTES * 60_000
    if (!p.force && program.content_hash === hash && program.last_status === 'ok' && (count ?? 0) === 0 && fresh) {
      await db.from('vendor_programs').update({ last_checked_at: nowIso }).eq('id', program.id).eq('org_id', orgId)
      return { ...base, status: 'unchanged' }
    }

    try {
      const parsed = parseProgramSheet(values, { name: program.name, rowType: program.row_type, columns: program.columns })
      if (parsed.fatal) return await fail(parsed.fatal)
      const result = await applyRows({ db, orgId, program, rows: parsed.rows, now })
      const issues = [...parsed.issues, ...(await unknownStoreIssues(db, orgId, parsed.rows.map((r) => r.storeCode)))]
      if (result.waitingIssue) issues.push(result.waitingIssue)
      await replaceIssues(db, orgId, program.id, issues)
      must(await db.from('vendor_programs').update({ last_checked_at: nowIso, last_applied_at: nowIso, last_status: 'ok', last_error: null, row_count: parsed.rows.length, content_hash: hash }).eq('id', program.id).eq('org_id', orgId), 'save status')
      return { ...base, status: 'ok', added: result.added, changed: result.changed, removed: result.removed, waiting: result.waiting }
    } catch (e) {
      return await fail(e instanceof Error ? e.message : 'The sheet could not be applied.')
    }
  } finally {
    await lock.release().catch(() => {})
  }
}

/** Every program that has a sheet (switched on or not: the copy is how the administrator sees the check list turn green). */
export async function syncPrograms(p: { db: Db; orgId: string; source: SheetsSource; now?: Date; force?: boolean; programId?: string }): Promise<ProgramSyncReport[]> {
  const now = p.now ?? new Date()
  let q = p.db.from('vendor_programs').select('*').eq('org_id', p.orgId).or('spreadsheet_id.not.is.null,pms_spreadsheet_id.not.is.null')
  if (p.programId) q = q.eq('id', p.programId)
  const { data } = await q.order('created_at', { ascending: true })
  const out: ProgramSyncReport[] = []
  for (const program of (data ?? []) as ProgramRecord[]) {
    let report: ProgramSyncReport
    try { report = await syncProgram({ db: p.db, orgId: p.orgId, program, source: p.source, now, force: p.force ?? false }) }
    catch (e) { report = { programId: program.id, name: program.name, status: 'error', message: e instanceof Error ? e.message : 'Unexpected error.' } }
    // the program's OPTIONAL PMS sheet (Store Code + PMS Date); a program without one is not touched. A failure here never stops the rest.
    if (program.pms_spreadsheet_id) {
      try { report.pms = await syncProgramPms({ db: p.db, orgId: p.orgId, program, source: p.source, now, force: p.force ?? false }) }
      catch (e) { report.pms = { status: 'error', message: e instanceof Error ? e.message : 'Unexpected error.' } }
    }
    out.push(report)
  }
  return out
}
