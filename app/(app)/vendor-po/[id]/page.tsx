import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { approversOf, isApproverOf, loadPoContext } from '@/lib/vendor/po'
import { formatMoney, totalOf } from '@/lib/vendor/lines'
import { todayIstDate } from '@/lib/vendor/fields'
import { PageHeader } from '@/components/ui/PageHeader'
import { PoDecisionForm } from '@/components/vendor/PoDecisionForm'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'PO approval' }

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for your decision', revision_requested: 'Revised price asked - waiting for the vendor', approved: 'Approved (PO issued)', rejected: 'Rejected', received: 'Closed',
  cancelled: 'Closed', superseded: 'Replaced by a newer version', withdrawn: 'Withdrawn by the vendor',
}

export default async function VendorPoApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getCurrentProfile()
  if (!profile) redirect(`/login?next=${encodeURIComponent(`/vendor-po/${id}`)}`)
  if (profile.vendor_company_id) redirect('/vendor')

  const po = await loadPoContext(id)
  if (!po || po.vendorRequest.kind !== 'po' || po.request.org_id !== profile.org_id) notFound()
  // Citykart's technicians, managers and administrators may read it; only an approver this was sent to (or an administrator) sees the decision form
  if (!['agent', 'manager', 'admin', 'platform_owner'].includes(profile.role)) notFound()
  const mayDecide = isApproverOf(po.vendorRequest, profile.id) || ['admin', 'platform_owner'].includes(profile.role)

  const vr = po.vendorRequest
  const sentTo = (await approversOf(vr)).map((a) => a.full_name).join(', ')
  const decidedBy = vr.decided_by ? (await createAdminClient().from('profiles').select('full_name').eq('id', vr.decided_by).maybeSingle()).data?.full_name ?? null : null
  const total = totalOf(po.lines)
  const canDecide = po.request.status === 'hold_purchase_ho' && mayDecide && (vr.status === 'pending' || vr.status === 'revision_requested')

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="PO approval" description={`${po.vendorName} needs a purchase order for ticket ${po.request.request_no}.`} />
      <section className="rounded-xl border border-border">
        <dl className="divide-y divide-border text-sm">
          {[['Ticket', po.request.request_no], ['Quote version', String(vr.version)], ['Store', po.storeLabel], ['AC', po.acLabel], ['Vendor', po.vendorName], ['Requested by', po.vendorPerson?.full_name ?? '—'], ['Requested on', formatDateTime(vr.created_at)], ...(sentTo ? [['Sent to', sentTo]] : []), ['Status', STATUS_TEXT[vr.status] ?? vr.status]].map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 px-4 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
          ))}
        </dl>
      </section>

      <section className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Qty</th><th className="px-3 py-2 font-medium">Price (without GST)</th><th className="px-3 py-2 font-medium">Line total</th></tr></thead>
          <tbody className="divide-y divide-border">
            {po.lines.map((l, i) => (
              <tr key={i}><td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2">{l.item_name}</td><td className="px-3 py-2">{l.qty}</td><td className="px-3 py-2">{formatMoney(l.price_excl_gst ?? 0)}</td><td className="px-3 py-2">{formatMoney(l.qty * (l.price_excl_gst ?? 0))}</td></tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-border"><td colSpan={4} className="px-3 py-2 text-right font-medium">Total (without GST)</td><td className="px-3 py-2 font-semibold">{formatMoney(total)}</td></tr></tfoot>
        </table>
      </section>

      <section className="rounded-xl border border-border p-4 text-sm">
        {po.previousTotal !== null && <p className="mb-2">Revised quote: the earlier total was <strong>{formatMoney(po.previousTotal)}</strong>, this one is <strong>{formatMoney(total)}</strong>.</p>}
        <div className="font-medium">Quote from the vendor</div>
        {po.quoteFiles.length === 0 ? <p className="text-muted-foreground">No quote file.</p> : (
          <ul className="mt-1 space-y-0.5">{po.quoteFiles.map((f) => <li key={f.id}><a className="text-primary hover:underline" href={`/api/storage/attachment/request/${f.id}`} target="_blank" rel="noreferrer">{f.file_name}</a></li>)}</ul>
        )}
        {vr.revision_note && <p className="mt-2 text-muted-foreground">You asked: “{vr.revision_note}”</p>}
      </section>

      {canDecide
        ? <PoDecisionForm vendorRequestId={vr.id} today={todayIstDate()} canApprove={vr.status === 'pending'} />
        : (
          <section className="rounded-xl border border-border p-4 text-sm">
            <p className="font-medium">{vr.status === 'pending' && !mayDecide ? 'Waiting for the approver to decide' : (STATUS_TEXT[vr.status] ?? vr.status)}{decidedBy && ['approved', 'rejected'].includes(vr.status) ? ` by ${decidedBy}` : ''}{vr.decided_at ? ` on ${formatDateTime(vr.decided_at)}` : ''}</p>
            {vr.po_number && <p className="mt-1">PO number {vr.po_number}{vr.po_date ? `, dated ${vr.po_date}` : ''}</p>}
            {vr.decision_reason && <p className="mt-1 text-muted-foreground">{vr.decision_reason}</p>}
          </section>
        )}

      <Link href={`/requests/${po.request.id}`} className="text-sm text-primary hover:underline">Open the ticket</Link>
    </div>
  )
}
