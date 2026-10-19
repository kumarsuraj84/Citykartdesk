import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { getVisitSettings } from '@/lib/visits/settings'
import { VisitsClient, type ReportRow, type PartsRow } from './VisitsClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export const dynamic = 'force-dynamic'
export const metadata = { title: 'AC visit reports' }

type Joined = {
  id: string; report_id: string; store_code: string; ckdesk_no: string; ac_details: string | null; request_ids: string[]; engineer_status: string; reason: string | null
  parts: { name: string; qty: number }[]; engineer_remarks: string | null; fsr: { attachmentId: string; fileName: string }[]; store_status: string | null; store_remarks: string | null
  outcome: string; auto_resolve_at: string | null; created_at: string; po_status: string | null; po_number: string | null; po_date: string | null; po_vendor: string | null; oem_parts_note: string | null
  ac_visit_reports: { engineer_name: string; engineer_mobile: string; visit_date: string; is_void: boolean; submitted_at: string } | { engineer_name: string; engineer_mobile: string; visit_date: string; is_void: boolean; submitted_at: string }[] | null
}

export default async function VisitsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['agent', 'manager', 'admin', 'platform_owner'].includes(profile.role) || !profile.org_id) redirect('/home')
  const admin = createAdminClient() as unknown as AnyClient

  const { data } = await admin
    .from('ac_visit_items')
    .select('id, report_id, store_code, ckdesk_no, ac_details, request_ids, engineer_status, reason, parts, engineer_remarks, fsr, store_status, store_remarks, outcome, auto_resolve_at, created_at, po_status, po_number, po_date, po_vendor, oem_parts_note, ac_visit_reports(engineer_name, engineer_mobile, visit_date, is_void, submitted_at)')
    .eq('org_id', profile.org_id).order('created_at', { ascending: false }).limit(300)
  const rows = (data ?? []) as Joined[]
  const rep = (r: Joined) => (Array.isArray(r.ac_visit_reports) ? r.ac_visit_reports[0] : r.ac_visit_reports)

  // ticket numbers for display
  const ids = [...new Set(rows.flatMap((r) => r.request_ids))]
  const numbers = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: t } = await admin.from('requests').select('id, request_no').in('id', ids.slice(i, i + 200))
    for (const x of (t ?? []) as { id: string; request_no: string }[]) numbers.set(x.id, x.request_no)
  }
  const reports: ReportRow[] = rows.map((r) => {
    const p = rep(r)
    return {
      id: r.id, reportId: r.report_id, storeCode: r.store_code, ckdeskNo: r.ckdesk_no, acDetails: r.ac_details, tickets: r.request_ids.map((id) => numbers.get(id) ?? '?'),
      engineerName: p?.engineer_name ?? '', engineerMobile: p?.engineer_mobile ?? '', visitDate: p?.visit_date ?? '', submittedAt: p?.submitted_at ?? r.created_at, isVoid: !!p?.is_void,
      engineerStatus: r.engineer_status, reason: r.reason, parts: r.parts ?? [], engineerRemarks: r.engineer_remarks, fsr: r.fsr ?? [], storeStatus: r.store_status, storeRemarks: r.store_remarks,
      outcome: r.outcome, autoResolveAt: r.auto_resolve_at,
    }
  })
  const parts: PartsRow[] = rows.filter((r) => r.reason === 'parts_po' && r.outcome !== 'void' && r.po_status && r.po_status !== 'done').map((r) => {
    const p = rep(r)
    return {
      id: r.id, storeCode: r.store_code, ckdeskNo: r.ckdesk_no, acDetails: r.ac_details, tickets: r.request_ids.map((id) => numbers.get(id) ?? '?'),
      engineerName: p?.engineer_name ?? '', visitDate: p?.visit_date ?? '', parts: r.parts ?? [], oemPartsNote: r.oem_parts_note, poNumber: r.po_number, poDate: r.po_date, poVendor: r.po_vendor, poStatus: r.po_status ?? 'to_raise',
    }
  })
  const settings = await getVisitSettings(admin, profile.org_id)
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="AC visit reports" description="What the OEM engineers reported, what the stores answered, and the parts that need a PO." />
      <VisitsClient reports={reports} parts={parts} settings={settings} isAdmin={['admin', 'platform_owner'].includes(profile.role)} />
    </div>
  )
}
