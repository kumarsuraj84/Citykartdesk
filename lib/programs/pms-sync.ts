import { createHash } from 'crypto'
import type { SheetsSource } from '@/lib/masters/google'
import { claimSync, inChunks, must } from '@/lib/masters/sync'
import { parsePmsSheet } from '@/lib/masters/parse'
import type { ProgramIssue, ProgramRecord } from './types'

// Copying a Vendor Program's PMS sheet (Store Code + PMS Date) into program_pms_dates. OPTIONAL: a program with no PMS sheet saved does nothing here. Read only towards Google.
// The tickets made from these dates are in lib/programs/pms.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export const PMS_TICKET_PROBLEM_CODE = 'pms_no_ticket'
export type ProgramPmsSyncReport = { status: 'ok' | 'unchanged' | 'error' | 'unconfigured'; message?: string; rows?: number }

const forProgram = (program: Pick<ProgramRecord, 'name'>, text: string) => text.replace(/AC PMS/g, `${program.name} PMS`)

// ── 1. copying the sheet ──

export async function syncProgramPms(p: { db: Db; orgId: string; program: ProgramRecord; source: SheetsSource; now: Date; force: boolean }): Promise<ProgramPmsSyncReport> {
  const { db, orgId, program, now } = p
  if (!program.pms_spreadsheet_id) return { status: 'unconfigured' }
  const lock = await claimSync(db, orgId, `program-pms:${program.id}`, now)
  if (!lock.claimed) return { status: 'unchanged', message: 'Another update of this PMS sheet is already running; this one was skipped.' }
  try {
    const nowIso = now.toISOString()
    const fail = async (message: string): Promise<ProgramPmsSyncReport> => {
      await db.from('vendor_programs').update({ pms_last_checked_at: nowIso, pms_last_status: 'error', pms_last_error: message }).eq('id', program.id).eq('org_id', orgId)
      return { status: 'error', message }
    }
    let values: unknown[][]
    try { values = await p.source.fetchValues(program.pms_spreadsheet_id, program.pms_tab_name ?? null) } catch (e) { return await fail(e instanceof Error ? e.message : 'The PMS sheet could not be read.') }
    const hash = createHash('sha1').update(JSON.stringify(values)).digest('hex')
    if (!p.force && program.pms_content_hash === hash && program.pms_last_status === 'ok') {
      await db.from('vendor_programs').update({ pms_last_checked_at: nowIso }).eq('id', program.id).eq('org_id', orgId)
      return { status: 'unchanged' }
    }
    try {
      const parsed = parsePmsSheet(values)
      if (parsed.fatal) return await fail(forProgram(program, parsed.fatal))

      const { data: stored } = await db.from('program_pms_dates').select('store_code, pms_date, sheet_row').eq('program_id', program.id)
      const key = (s: string, d: string) => `${s}|${d}`
      const have = new Map(((stored ?? []) as { store_code: string; pms_date: string; sheet_row: number | null }[]).map((s) => [key(s.store_code, s.pms_date), s]))
      const want = new Set(parsed.rows.map((r) => key(r.storeCode, r.pmsDate)))
      const adds = parsed.rows.filter((r) => !have.has(key(r.storeCode, r.pmsDate)))
      const moved = parsed.rows.filter((r) => { const o = have.get(key(r.storeCode, r.pmsDate)); return o && o.sheet_row !== r.sheetRow })
      const gone = [...have.values()].filter((s) => !want.has(key(s.store_code, s.pms_date)))
      const row = (r: { storeCode: string; pmsDate: string; sheetRow: number }) => ({ org_id: orgId, program_id: program.id, store_code: r.storeCode, pms_date: r.pmsDate, sheet_row: r.sheetRow, last_seen_at: nowIso })
      await inChunks(adds, async (c) => must(await db.from('program_pms_dates').insert(c.map((r) => ({ ...row(r), first_seen_at: nowIso }))), 'add PMS dates'))
      await inChunks(moved, async (c) => must(await db.from('program_pms_dates').upsert(c.map(row), { onConflict: 'program_id,store_code,pms_date' }), 'update PMS dates'))
      // a date that left the sheet no longer makes a ticket; tickets already made are ordinary tickets and stay
      for (const g of gone) must(await db.from('program_pms_dates').delete().eq('program_id', program.id).eq('store_code', g.store_code).eq('pms_date', g.pms_date), 'remove PMS date')

      // problems of the PMS sheet (codes pms_...) are shown with the program's other problems; the ticket problems (pms_no_ticket) are rewritten by the ticket step
      const issues: ProgramIssue[] = parsed.issues.map((i) => ({ severity: i.severity, code: `pms_${i.code}`, storeCode: i.storeCode, sheetRow: i.sheetRow, message: forProgram(program, i.message) }))
      const unique = [...new Set(parsed.rows.map((r) => r.storeCode))]
      const known = new Set<string>()
      for (let i = 0; i < unique.length; i += 200) {
        const data = must<{ code: string }[]>(await db.from('stores').select('code').eq('org_id', orgId).in('code', unique.slice(i, i + 200)), 'read store codes') ?? []
        for (const s of data) known.add(String(s.code).toUpperCase())
      }
      for (const c of unique) if (!known.has(c)) issues.push({ severity: 'warning', code: 'pms_unknown_store', storeCode: c, sheetRow: null, message: `Store ${c} is in the ${program.name} PMS sheet but not in the CK Desk store master, so no PMS ticket can be made for it until the store exists.` })
      await replacePmsIssues(db, orgId, program.id, issues, (code) => code !== PMS_TICKET_PROBLEM_CODE)
      must(await db.from('vendor_programs').update({ pms_last_checked_at: nowIso, pms_last_status: 'ok', pms_last_error: null, pms_content_hash: hash, pms_row_count: parsed.rows.length }).eq('id', program.id).eq('org_id', orgId), 'save PMS status')
      return { status: 'ok', rows: parsed.rows.length }
    } catch (e) {
      return await fail(e instanceof Error ? e.message : 'The PMS sheet could not be applied.')
    }
  } finally {
    await lock.release().catch(() => {})
  }
}

/** Rewrites the PMS problems of one program: those whose code `replaces` accepts are deleted first, then `issues` are saved. */
export async function replacePmsIssues(db: Db, orgId: string, programId: string, issues: ProgramIssue[], replaces: (code: string) => boolean) {
  const codes = replaces(PMS_TICKET_PROBLEM_CODE) ? [PMS_TICKET_PROBLEM_CODE] : ['pms_bad_date', 'pms_blank_store', 'pms_duplicate_row', 'pms_unknown_store']
  must(await db.from('program_issues').delete().eq('org_id', orgId).eq('program_id', programId).in('code', codes), 'clear PMS problems')
  const rows = issues.slice(0, 300).map((i) => ({ org_id: orgId, program_id: programId, severity: i.severity, code: i.code, store_code: i.storeCode, sheet_row: i.sheetRow, message: i.message }))
  await inChunks(rows, async (c) => must(await db.from('program_issues').insert(c), 'save PMS problems'))
}

