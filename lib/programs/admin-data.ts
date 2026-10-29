import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { allowedFields, programTemplate, unknownFields } from './mail'
import { programReadiness, type ReadinessItem } from './readiness'
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

export type CategoryChoice = { id: string; name: string; in_program: boolean; blocked: string | null }
export type ProgramIssueView = { severity: 'error' | 'warning'; code: string; store_code: string | null; sheet_row: number | null; message: string }
export type StaffChoice = { id: string; full_name: string; role: string }
export type ProgramEditorData = {
  /** active Citykart technicians, managers and administrators (who may be a default PO approver) */
  staff: StaffChoice[]
  program: ProgramRecord
  categories: CategoryChoice[]
  issues: ProgramIssueView[]
  extraHeadings: string[]
  activeRows: number
  readiness: { items: ReadinessItem[]; ready: boolean }
}

export async function loadProgramEditor(orgId: string, id: string): Promise<ProgramEditorData | null> {
  const db = createAdminClient() as unknown as Db
  const { data: program } = await db.from('vendor_programs').select('*').eq('org_id', orgId).eq('id', id).maybeSingle()
  if (!program) return null
  const p = program as ProgramRecord
  const [cats, issues, rows, activeCount, programs, noApprover, staffRes] = await Promise.all([
    db.from('service_categories').select('id, name, program_id, auto_oem_kind, is_pms').eq('org_id', orgId).order('name', { ascending: true }),
    db.from('program_issues').select('severity, code, store_code, sheet_row, message').eq('program_id', id).order('severity').limit(300),
    db.from('program_rows').select('extra').eq('program_id', id).is('removed_at', null).limit(1000),
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
      : c.auto_oem_kind ? `Already sends to the ${c.auto_oem_kind === 'ac' ? 'AC' : 'Genset'} OEM`
        : c.is_pms ? 'This is the AC PMS category' : null,
  }))
  const extra = new Set<string>()
  for (const r of (rows.data ?? []) as { extra: Record<string, string> | null }[]) for (const k of Object.keys(r.extra ?? {})) extra.add(k)
  const extraHeadings = [...extra].sort()
  // a program that works in the vendor portal needs its own list of resolutions
  const portal = p.level === 'portal' ? { resolutions: (p.resolution_options ?? []).length, defaultApprovers: (p.default_approver_ids ?? []).length, rowsWithoutApprover: noApprover.count ?? 0 } : undefined
  const issueList = (issues.data ?? []) as ProgramIssueView[]
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
  return { staff: (staffRes.data ?? []) as StaffChoice[], program: p, categories, issues: issueList, extraHeadings, activeRows: activeCount.count ?? 0, readiness }
}
