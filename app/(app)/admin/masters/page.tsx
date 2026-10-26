import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { resolveTemplate } from '@/lib/masters/mail'
import { demoSheetsDir } from '@/lib/masters/demo'
import { istNow } from '@/lib/pms/window'
import { MastersClient, type SourceView, type IssueView, type TemplateView, type CountsView, type PmsView } from './MastersClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sheet Masters' }

export default async function SheetMastersPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner'].includes(profile.role)) redirect('/home')
  const orgId = profile.org_id
  if (!orgId) redirect('/home')
  const { google } = await searchParams

  const admin = createAdminClient() as unknown as AnyClient
  const count = async (table: string, active: boolean) => {
    let q = admin.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId)
    q = active ? q.is('removed_at', null) : q.not('removed_at', 'is', null)
    return (await q).count ?? 0
  }
  const [conn, sources, issues, templates, acActive, acRemoved, gsActive, gsRemoved, cvmActive, acInactive] = await Promise.all([
    admin.from('master_google_connection').select('account_email, status, last_error, connected_at').eq('org_id', orgId).maybeSingle(),
    admin.from('master_sources').select('kind, spreadsheet_id, tab_name, last_checked_at, last_applied_at, last_status, last_error, row_count').eq('org_id', orgId),
    admin.from('master_issues').select('kind, severity, code, store_code, sheet_row, message').eq('org_id', orgId).order('severity').order('kind').limit(400),
    admin.from('master_mail_templates').select('kind, subject, body_html').eq('org_id', orgId),
    count('master_ac_units', true), count('master_ac_units', false), count('master_gensets', true), count('master_gensets', false), count('master_store_cvm', true),
    admin.from('master_ac_units').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('removed_at', null).eq('is_active', false),
  ])

  const [pmsUpcoming, pmsLog] = await Promise.all([
    admin.from('master_pms_dates').select('store_code', { count: 'exact', head: true }).eq('org_id', orgId).gte('pms_date', istNow(new Date()).date),
    admin.from('pms_ticket_log').select('store_code, pms_date, status, note, request:requests(request_no)').eq('org_id', orgId).order('pms_date', { ascending: false }).order('store_code').limit(12),
  ])
  const pms: PmsView = {
    upcoming: pmsUpcoming.count ?? 0,
    log: ((pmsLog.data ?? []) as { store_code: string; pms_date: string; status: PmsView['log'][number]['status']; note: string | null; request: { request_no: string } | { request_no: string }[] | null }[])
      .map((l) => ({ store_code: l.store_code, pms_date: l.pms_date, status: l.status, note: l.note, request_no: (Array.isArray(l.request) ? l.request[0] : l.request)?.request_no ?? null })),
  }

  const tpl = (kind: 'ac' | 'genset'): TemplateView => {
    const saved = (templates.data ?? []).find((t: { kind: string }) => t.kind === kind) ?? null
    const t = resolveTemplate(saved, kind)
    return { kind, subject: t.subject, body: t.body, custom: !!saved }
  }
  const counts: CountsView = {
    acActive: acActive - (acInactive.count ?? 0), acInactive: acInactive.count ?? 0, acRemoved, gensetActive: gsActive, gensetRemoved: gsRemoved, cvmStores: cvmActive,
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Sheet Masters"
        description="The AC, Genset, CVM and AC PMS Google Sheets are the master list. CK Desk copies them into its own database at 11:00, 15:00 and 19:00 and never changes them. The AC PMS tickets are made at 09:00 on each PMS date."
      />
      <MastersClient
        googleResult={google ?? null}
        connection={conn.data ?? (demoSheetsDir() ? { account_email: 'demo files on this computer (local test only)', status: 'connected', last_error: null, connected_at: new Date().toISOString() } : null)}
        sources={(sources.data ?? []) as SourceView[]}
        issues={(issues.data ?? []) as IssueView[]}
        templates={[tpl('ac'), tpl('genset')]}
        counts={counts}
        pms={pms}
      />
    </div>
  )
}
