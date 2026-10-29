import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTemplate } from '@/lib/masters/mail'
import { programReadiness, type ReadinessItem } from './readiness'
import { resolvePoApprover } from '@/lib/vendor/po'
import type { IssueView, SourceView, TemplateView } from '@/app/(app)/admin/masters/MastersClient'

// AC and Genset on the Vendor Programs screens. They keep their own engines (sheet tables, OEM mail, vendor portal, PO approval, PMS): this only reads their settings
// into the same kind of picture the other programs have, so one screen shows all lines. Nothing here changes behaviour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type BuiltInKind = 'ac' | 'genset'
export const BUILT_IN: Record<BuiltInKind, { name: string; rowType: 'machine' | 'store'; table: 'master_ac_units' | 'master_gensets'; sheetTitle: string; hint: string }> = {
  ac: { name: 'AC', rowType: 'machine', table: 'master_ac_units', sheetTitle: 'AC DETAILS MASTER SHEET-ADMIN', hint: 'One row per AC. Gives the AC choices in the ticket form, the OEM e-mail addresses (Ticket Mail To, PO Mail To, Quote Approver Mail To), and the store address and opening date.' },
  genset: { name: 'Genset', rowType: 'store', table: 'master_gensets', sheetTitle: 'GENSET Detail MASTER SHEET-ADMIN', hint: 'One row per genset. Gives the OEM e-mail addresses (Ticket Mail To) for genset tickets.' },
}
export const isBuiltInKind = (k: string): k is BuiltInKind => k === 'ac' || k === 'genset'

export type BuiltInListItem = { kind: BuiltInKind; name: string; rowType: 'machine' | 'store'; categories: number; rows: number; problems: number; last_status: 'ok' | 'error' | null; last_checked_at: string | null }

export async function listBuiltInPrograms(orgId: string): Promise<BuiltInListItem[]> {
  const db = createAdminClient() as unknown as Db
  const out: BuiltInListItem[] = []
  for (const kind of ['ac', 'genset'] as const) {
    const spec = BUILT_IN[kind]
    const [cats, rows, issues, src] = await Promise.all([
      db.from('service_categories').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('auto_oem_kind', kind),
      db.from(spec.table).select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('removed_at', null),
      db.from('master_issues').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('kind', kind),
      db.from('master_sources').select('last_status, last_checked_at').eq('org_id', orgId).eq('kind', kind).maybeSingle(),
    ])
    out.push({ kind, name: spec.name, rowType: spec.rowType, categories: cats.count ?? 0, rows: rows.count ?? 0, problems: issues.count ?? 0, last_status: src.data?.last_status ?? null, last_checked_at: src.data?.last_checked_at ?? null })
  }
  return out
}

export type BuiltInCategoryChoice = { id: string; name: string; selected: boolean; blocked: string | null; /** the Vendor Program this category is in now (it can be moved back to the old setting) */ inProgram: string | null }
export type BuiltInEditorData = {
  kind: BuiltInKind
  name: string
  categories: BuiltInCategoryChoice[]
  source: SourceView | undefined
  issues: IssueView[]
  template: TemplateView
  activeRows: number
  readiness: { items: ReadinessItem[]; ready: boolean }
  connected: boolean
  /** AC only: the people who may be the default PO approver and the one now in use (the AC sheet's approvers come first; this one decides when the sheet names nobody) */
  staff: { id: string; full_name: string; role: string }[]
  approverId: string
}

export async function loadBuiltInEditor(orgId: string, kind: BuiltInKind): Promise<BuiltInEditorData> {
  const db = createAdminClient() as unknown as Db
  const spec = BUILT_IN[kind]
  const activeQuery = db.from(spec.table).select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('removed_at', null)
  const [cats, src, issues, tpl, active, conn, progs] = await Promise.all([
    db.from('service_categories').select('id, name, program_id, auto_oem_kind, is_pms').eq('org_id', orgId).order('name', { ascending: true }),
    db.from('master_sources').select('kind, spreadsheet_id, tab_name, last_checked_at, last_applied_at, last_status, last_error, row_count').eq('org_id', orgId).eq('kind', kind).maybeSingle(),
    db.from('master_issues').select('kind, severity, code, store_code, sheet_row, message').eq('org_id', orgId).eq('kind', kind).order('severity').limit(300),
    db.from('master_mail_templates').select('kind, subject, body_html').eq('org_id', orgId).eq('kind', kind).maybeSingle(),
    kind === 'ac' ? activeQuery.eq('is_active', true) : activeQuery,
    db.from('master_google_connection').select('status').eq('org_id', orgId).maybeSingle(),
    db.from('vendor_programs').select('id, name').eq('org_id', orgId),
  ])
  const programNames = new Map<string, string>(((progs.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))
  const categories: BuiltInCategoryChoice[] = ((cats.data ?? []) as { id: string; name: string; program_id: string | null; auto_oem_kind: string | null; is_pms: boolean }[]).map((c) => ({
    id: c.id,
    name: c.name,
    selected: c.auto_oem_kind === kind,
    inProgram: c.program_id ? programNames.get(c.program_id) ?? 'a Vendor Program' : null,
    blocked: c.auto_oem_kind && c.auto_oem_kind !== kind ? `Already sends to the ${c.auto_oem_kind === 'ac' ? 'AC' : 'Genset'} OEM`
        : c.is_pms ? 'This is the AC PMS category' : null,
  }))
  const source = (src.data ?? undefined) as SourceView | undefined
  const issueList = (issues.data ?? []) as IssueView[]
  const saved = tpl.data ?? null
  const t = resolveTemplate(saved, kind)
  const template: TemplateView = { kind, subject: t.subject, body: t.body, custom: !!saved }
  const readiness = programReadiness({
    categories: categories.filter((c) => c.selected).length,
    hasSheet: !!source?.spreadsheet_id,
    lastStatus: source?.last_status ?? null,
    lastError: source?.last_error ?? null,
    activeRows: active.count ?? 0,
    rowsWithoutMail: issueList.filter((i) => i.code === 'no_email' || i.code === 'no_valid_email').length,
    unknownStores: 0,
    unknownFields: [],
  })
  let staff: { id: string; full_name: string; role: string }[] = []
  let approverId = ''
  if (kind === 'ac') {
    const [{ data: s }, current] = await Promise.all([
      db.from('profiles').select('id, full_name, role').eq('org_id', orgId).eq('is_active', true).is('vendor_company_id', null).in('role', ['agent', 'manager', 'admin', 'platform_owner']).order('full_name', { ascending: true }),
      resolvePoApprover(orgId),
    ])
    staff = (s ?? []) as typeof staff
    approverId = current?.id ?? ''
  }
  return { kind, name: spec.name, categories, source, issues: issueList, template, activeRows: active.count ?? 0, readiness, connected: conn.data?.status === 'connected', staff, approverId }
}
