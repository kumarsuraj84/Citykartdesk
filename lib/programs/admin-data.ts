import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/queries/paging'
import { allowedFields, programTemplate, unknownFields } from './mail'
import { programReadiness, type ReadinessItem } from './readiness'
import { loadStoreFacts, type StoreFacts } from '@/lib/stores/details'
import type { ProgramRowRecord } from './mail'
import type { ProgramRecord } from './types'

// What the Vendor Programs screens show, read in one place so the page and the "switch on" action use the same check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type ProgramListItem = { id: string; name: string; is_active: boolean; level: string; row_type: string; last_status: string | null; last_checked_at: string | null; categories: number; rows: number; problems: number }

export async function listPrograms(orgId: string): Promise<ProgramListItem[]> {
  const db = createAdminClient() as unknown as Db
  const { data } = await db.from('vendor_programs').select('*').eq('org_id', orgId).order('created_at', { ascending: true })
  const out: ProgramListItem[] = []
  for (const p of (data ?? []) as ProgramRecord[]) {
    const [cats, rows, issues] = await Promise.all([
      db.from('service_categories').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('program_id', p.id),
      db.from('program_rows').select('id', { count: 'exact', head: true }).eq('program_id', p.id).is('removed_at', null),
      db.from('program_issues').select('id', { count: 'exact', head: true }).eq('program_id', p.id),
    ])
    out.push({ id: p.id, name: p.name, is_active: p.is_active, level: p.level, row_type: p.row_type, last_status: p.last_status, last_checked_at: p.last_checked_at, categories: cats.count ?? 0, rows: rows.count ?? 0, problems: issues.count ?? 0 })
  }
  return out
}

export type CategoryChoice = { id: string; name: string; in_program: boolean; blocked: string | null; /** the old AC / Genset setting this category has now (it can be moved to the program) */ old_kind: 'ac' | 'genset' | null }
export type ProgramIssueView = { severity: 'error' | 'warning'; code: string; store_code: string | null; sheet_row: number | null; message: string }
export type StaffChoice = { id: string; full_name: string; role: string }
export type ProgramEditorData = {
  /** active Citykart technicians, managers and administrators (who may be a default PO approver) */
  staff: StaffChoice[]
  program: ProgramRecord
  categories: CategoryChoice[]
  /** the first 300 problems (the screen lists these); the readiness counts and issueTotal cover ALL of them */
  issues: ProgramIssueView[]
  issueTotal: number
  extraHeadings: string[]
  activeRows: number
  readiness: { items: ReadinessItem[]; ready: boolean }
  /** the first active sheet row of the program, its store card and the program's first category: the example the mail preview and the test mail are filled with */
  sampleRow: ProgramRowRecord | null
  sampleStore: StoreFacts | null
  sampleCategory: string | null
}

/** The example row of a program (its first active row), read in one place for the editor and for "Send a test to me". */
export async function loadProgramSample(db: Db, orgId: string, programId: string): Promise<{ row: ProgramRowRecord | null; store: StoreFacts | null; category: string | null }> {
  const [rowRes, catRes] = await Promise.all([
    db.from('program_rows').select('id, store_code, machine_no, serial, vendor, emails, po_emails, approver_emails, extra, is_active, sheet_row').eq('program_id', programId).eq('is_active', true).is('removed_at', null).order('sheet_row', { ascending: true }).limit(1),
    db.from('service_categories').select('name').eq('org_id', orgId).eq('program_id', programId).order('name', { ascending: true }).limit(1),
  ])
  const row = ((rowRes.data ?? [])[0] ?? null) as ProgramRowRecord | null
  const store = row ? await loadStoreFacts(db, orgId, { code: row.store_code }) : null
  return { row, store, category: ((catRes.data ?? [])[0] as { name: string } | undefined)?.name ?? null }
}

export async function loadProgramEditor(orgId: string, id: string): Promise<ProgramEditorData | null> {
  const db = createAdminClient() as unknown as Db
  const { data: program } = await db.from('vendor_programs').select('*').eq('org_id', orgId).eq('id', id).maybeSingle()
  if (!program) return null
  const p = program as ProgramRecord
  // The readiness counts (rows without a mail address, unknown stores) are counted over EVERY problem and the extra headings over EVERY row: read in pages, because one answer is cut at 1000 rows without any error
  const [cats, issues, rows, activeCount, programs, noApprover, staffRes] = await Promise.all([
    db.from('service_categories').select('id, name, program_id, auto_oem_kind, is_pms').eq('org_id', orgId).order('name', { ascending: true }),
    fetchAllPages<ProgramIssueView>((from, to) => db.from('program_issues').select('severity, code, store_code, sheet_row, message').eq('program_id', id).order('severity').order('sheet_row', { ascending: true }).order('id', { ascending: true }).range(from, to), { maxRows: 20000 }),
    fetchAllPages<{ extra: Record<string, string> | null }>((from, to) => db.from('program_rows').select('extra').eq('program_id', id).is('removed_at', null).order('id', { ascending: true }).range(from, to), { maxRows: 50000 }),
    db.from('program_rows').select('id', { count: 'exact', head: true }).eq('program_id', id).is('removed_at', null).eq('is_active', true),
    db.from('vendor_programs').select('id, name').eq('org_id', orgId),
    db.from('program_rows').select('id', { count: 'exact', head: true }).eq('program_id', id).is('removed_at', null).eq('is_active', true).eq('approver_emails', '{}'),
    db.from('profiles').select('id, full_name, role').eq('org_id', orgId).eq('is_active', true).is('vendor_company_id', null).in('role', ['agent', 'manager', 'admin', 'platform_owner']).order('full_name', { ascending: true }),
  ])
  const programName = new Map<string, string>(((programs.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]))
  const categories: CategoryChoice[] = ((cats.data ?? []) as { id: string; name: string; program_id: string | null; auto_oem_kind: string | null; is_pms: boolean }[]).map((c) => ({
    id: c.id,
    name: c.name,
    in_program: c.program_id === id,
    blocked: c.program_id && c.program_id !== id ? `Already in "${programName.get(c.program_id) ?? 'another program'}"`
      : c.auto_oem_kind ? `Already sends to the ${c.auto_oem_kind === 'ac' ? 'AC' : 'Genset'} OEM` : null,
    old_kind: !c.program_id && !c.is_pms && (c.auto_oem_kind === 'ac' || c.auto_oem_kind === 'genset') ? c.auto_oem_kind : null,
  }))
  const extra = new Set<string>()
  for (const r of rows.rows) for (const k of Object.keys(r.extra ?? {})) extra.add(k)
  const extraHeadings = [...extra].sort()
  // a program that works in the vendor portal needs its own list of resolutions
  const portal = p.level === 'portal' ? { resolutions: (p.resolution_options ?? []).length, defaultApprovers: (p.default_approver_ids ?? []).length, rowsWithoutApprover: noApprover.count ?? 0 } : undefined
  const issueList = issues.rows
  const tpl = programTemplate(p)
  const readiness = programReadiness({
    categories: categories.filter((c) => c.in_program).length,
    hasSheet: !!p.spreadsheet_id,
    lastStatus: p.last_status,
    lastError: p.last_error,
    activeRows: activeCount.count ?? 0,
    rowsWithoutMail: issueList.filter((i) => i.code === 'no_email' || i.code === 'no_valid_email').length,
    unknownStores: issueList.filter((i) => i.code === 'unknown_store').length,
    unknownFields: unknownFields(`${tpl.subject} ${tpl.body}`, allowedFields(extraHeadings)),
    portal,
  })
  const sample = await loadProgramSample(db, orgId, id)
  return { sampleRow: sample.row, sampleStore: sample.store, sampleCategory: sample.category, staff: (staffRes.data ?? []) as StaffChoice[], program: p, categories, issues: issueList.slice(0, 300), issueTotal: issueList.length, extraHeadings, activeRows: activeCount.count ?? 0, readiness }
}
