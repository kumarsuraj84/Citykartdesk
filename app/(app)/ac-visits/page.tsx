import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { loadOpenAcIssues } from '@/lib/visits/issues'
import { visitCodeFor } from '@/lib/visits/code'
import { getVisitSettings } from '@/lib/visits/settings'
import { AcVisitsClient, type VisitCard, type WaitingAc, type DoneCard } from './AcVisitsClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export const dynamic = 'force-dynamic'
export const metadata = { title: 'AC visits' }

type ItemRow = {
  id: string; ckdesk_no: string; ac_details: string | null; request_ids: string[]; engineer_status: 'resolved' | 'not_resolved'; reason: string | null
  parts: { name: string; qty: number }[]; engineer_remarks: string | null; fsr: { attachmentId: string; fileName: string }[]
  store_status: string | null; store_remarks: string | null; outcome: string; auto_resolve_at: string | null; created_at: string; po_status: string | null; po_number: string | null
  ac_visit_reports: { engineer_name: string; engineer_mobile: string; visit_date: string; is_void: boolean } | { engineer_name: string; engineer_mobile: string; visit_date: string; is_void: boolean }[] | null
}

export default async function AcVisitsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  const admin = createAdminClient() as unknown as AnyClient

  if (!profile.store_id) {
    // technicians and managers have their own page
    if (['agent', 'manager', 'admin', 'platform_owner'].includes(profile.role)) redirect('/visits')
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader title="AC visits" description="This page is for store logins." />
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Your login is not linked to a store, so there are no AC visits to confirm here.</p>
      </div>
    )
  }
  const { data: store } = await admin.from('stores').select('code, name').eq('id', profile.store_id).eq('org_id', profile.org_id).maybeSingle()
  if (!store) redirect('/home')
  const storeCode = String(store.code).toUpperCase()

  const { data: rows } = await admin
    .from('ac_visit_items')
    .select('id, ckdesk_no, ac_details, request_ids, engineer_status, reason, parts, engineer_remarks, fsr, store_status, store_remarks, outcome, auto_resolve_at, created_at, po_status, po_number, ac_visit_reports(engineer_name, engineer_mobile, visit_date, is_void)')
    .eq('org_id', profile.org_id).eq('store_code', storeCode).neq('outcome', 'void')
    .order('created_at', { ascending: false }).limit(120)
  const items = (rows ?? []) as ItemRow[]
  const report = (i: ItemRow) => (Array.isArray(i.ac_visit_reports) ? i.ac_visit_reports[0] : i.ac_visit_reports)

  // the newest unanswered report of each AC is the one to answer
  const seenAc = new Set<string>()
  const actionable: VisitCard[] = []
  for (const i of items) {
    if (!['pending_store', 'open'].includes(i.outcome) || seenAc.has(i.ckdesk_no)) continue
    const r = report(i)
    if (!r || r.is_void) continue
    seenAc.add(i.ckdesk_no)
    actionable.push({
      id: i.id, ckdeskNo: i.ckdesk_no, acDetails: i.ac_details, engineerName: r.engineer_name, engineerMobile: r.engineer_mobile, visitDate: r.visit_date,
      engineerStatus: i.engineer_status, reason: i.reason, parts: i.parts ?? [], engineerRemarks: i.engineer_remarks, fsr: i.fsr ?? [], autoResolveAt: i.auto_resolve_at,
      outcome: i.outcome, poStatus: i.po_status, poNumber: i.po_number, ticketCount: i.request_ids.length,
    })
  }
  const done: DoneCard[] = items.filter((i) => !['pending_store', 'open'].includes(i.outcome)).slice(0, 15).map((i) => {
    const r = report(i)
    return { id: i.id, ckdeskNo: i.ckdesk_no, outcome: i.outcome, engineerName: r?.engineer_name ?? '', visitDate: r?.visit_date ?? '', storeRemarks: i.store_remarks, decidedOn: i.created_at.slice(0, 10) }
  })

  const issues = await loadOpenAcIssues(admin, profile.org_id, storeCode)
  const waiting: WaitingAc[] = issues
    .filter((g) => !items.some((i) => i.ckdesk_no === g.ckdeskNo && ['pending_store', 'open'].includes(i.outcome)))
    .map((g) => ({ ckdeskNo: g.ckdeskNo, details: g.details, tickets: g.tickets.map((t) => ({ requestNo: t.requestNo, title: t.title, loggedOn: t.createdAt.slice(0, 10) })) }))

  const settings = await getVisitSettings(admin, profile.org_id)
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="AC visits" description={`${storeCode} - ${store.name}. Check what the OEM engineer reported for each AC and tell us whether it is resolved.`} />
      <AcVisitsClient
        storeCode={storeCode}
        visitCode={visitCodeFor(profile.org_id, storeCode)}
        autoResolveHours={settings.autoResolveHours}
        actionable={actionable}
        waiting={waiting}
        done={done}
      />
    </div>
  )
}
