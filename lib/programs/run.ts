import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SheetsSource } from '@/lib/masters/google'
import { sheetsSourceForOrg } from '@/lib/masters/source'
import { syncPrograms, type ProgramSyncReport } from './sync'
import { createDueProgramPmsTickets } from './pms'
import type { ProgramRecord } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }> }

/**
 * One check of the Vendor Programs' sheets (all programs, or one). Part of the scheduled sheet copy (lib/masters/run.ts) and the "Update from sheet now" button.
 * The administrators are told once when a sheet stops working (not at every check while it stays broken).
 */
export async function runProgramsSync(p: {
  db: Db; orgId: string; source: SheetsSource; force?: boolean; programId?: string
  tellAdmins?: (db: Db, orgId: string, subject: string, message: string) => Promise<void>
}): Promise<ProgramSyncReport[]> {
  const before = new Map<string, string | null>()
  const { data } = await p.db.from('vendor_programs').select('id, last_status').eq('org_id', p.orgId)
  for (const r of (data ?? []) as { id: string; last_status: string | null }[]) before.set(r.id, r.last_status)
  const report = await syncPrograms({ db: p.db, orgId: p.orgId, source: p.source, force: p.force, programId: p.programId })
  for (const r of report) {
    if (r.status === 'error' && before.get(r.programId) !== 'error' && p.tellAdmins) {
      await p.tellAdmins(p.db, p.orgId, `CK Desk could not read the ${r.name} sheet`, `The ${r.name} Google Sheet could not be read: ${r.message ?? 'unknown problem'}. CK Desk keeps working from the last good copy, so tickets are not affected.`)
    }
  }
  return report
}

/** "Update from sheet now" for one program. */
export async function runProgramSyncNow(orgId: string, programId: string): Promise<ProgramSyncReport | { error: string }> {
  const db = createAdminClient() as unknown as Db
  const resolved = await sheetsSourceForOrg(db, orgId)
  if ('error' in resolved) return { error: resolved.error === 'not connected' ? 'Google Sheets is not connected yet (Admin > Sheet Masters > Connect Google Sheets).' : resolved.error }
  const [report] = await runProgramsSync({ db, orgId, source: resolved.source, force: true, programId })
  // a program with a PMS sheet: the PMS tickets that are due now are made right away (never twice: the log keeps one row per store and date)
  if (report?.pms && report.pms.status !== 'error') {
    const { data: program } = await db.from('vendor_programs').select('*').eq('org_id', orgId).eq('id', programId).maybeSingle()
    if (program) await createDueProgramPmsTickets(db, orgId, program as ProgramRecord)
  }
  return report ?? { error: 'That program has no sheet saved yet.' }
}
