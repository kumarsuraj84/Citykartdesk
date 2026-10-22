import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getRequestById, getRequestComments } from '@/lib/queries/requests'
import { getRequestAttachments } from '@/lib/queries/attachments'
import { createAdminClient } from '@/lib/supabase/admin'
import { isVendor, vendorBoxOf, vendorRoleOf, VENDOR_BOX_LABELS } from '@/lib/vendor/access'
import { displayAnswer, findVendorFields, resolutionChoices } from '@/lib/vendor/fields'
import { loadLiveResolutionField } from '@/lib/vendor/live-form'
import { VendorTicketActions } from '@/components/vendor/VendorTicketActions'
import { listRequestsWithItems } from '@/lib/vendor/requests'
import { formatMoney } from '@/lib/vendor/lines'
import { AttachmentChips } from '@/components/requests/AttachmentChips'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import { filterFieldsForRequester, filterSectionsForCategory } from '@/lib/forms/sections'
import { formatDateTime } from '@/lib/utils'
import type { FormSection } from '@/types'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-xs font-medium whitespace-pre-wrap break-words">{value || '—'}</dd>
    </div>
  )
}

export default async function VendorTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!isVendor(profile)) redirect(`/requests/${id}`)

  // read through the vendor's own login: row security lets him read only his own ticket (or his company's, for a manager)
  const request = await getRequestById(id)
  if (!request) notFound()

  const admin = createAdminClient() as unknown as Db
  const requesterStoreId = (request.requester as { store_id?: string | null } | null)?.store_id ?? null
  const [comments, attachments, snapRes, storeRes] = await Promise.all([
    getRequestComments(id),
    getRequestAttachments(id),
    admin.from('request_master_snapshots').select('snapshot').eq('request_id', id).eq('kind', 'ac').maybeSingle(),
    requesterStoreId ? admin.from('stores').select('code, name, address, city, state').eq('id', requesterStoreId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const ac = (Array.isArray(snapRes.data?.snapshot) ? snapRes.data.snapshot[0] : null) as Record<string, string | null> | null
  const store = storeRes.data as { code: string; name: string; address: string | null; city: string | null; state: string | null } | null

  const sections = (Array.isArray(request.form_sections_snapshot) ? request.form_sections_snapshot : []) as unknown as FormSection[]
  const formData = (request.form_data ?? {}) as Record<string, unknown>
  const vf = findVendorFields(sections)
  const liveResolution = await loadLiveResolutionField(request.service_id, sections)
  const vendorRequests = await listRequestsWithItems(id)
  const pendingKind = vendorRequests.find((r) => r.status === 'pending')?.kind ?? null
  const vendorFieldIds = new Set([vf.oemNumber?.id, vf.oemDate?.id, vf.resolution?.id].filter(Boolean) as string[])
  // what the store filled in (the technician-only boxes are shown separately below)
  const storeSections = filterFieldsForRequester(filterSectionsForCategory(sections, request.category_id))
    .map((s) => ({ ...s, fields: s.fields.filter((f) => !vendorFieldIds.has(f.id) && f.type !== 'store_address') }))
    .filter((s) => s.fields.length > 0)

  const isTech = vendorRoleOf(profile) === 'technician' && request.assigned_to === profile.id
  const box = vendorBoxOf(request.status, pendingKind)
  const visibleComments = comments.filter((c) => !c.is_internal)

  return (
    <div className="max-w-5xl space-y-4">
      <Link href="/vendor" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> My tickets</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{request.request_no}</div>
          <h1 className="text-lg font-semibold leading-tight">{request.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{VENDOR_BOX_LABELS[box]}</span>
          <StatusBadge status={request.status} />
          <PriorityBadge priority={request.priority} />
        </div>
      </div>

      <VendorTicketActions
        requestId={request.id}
        status={request.status}
        canAct={isTech}
        resolutionChoices={resolutionChoices(liveResolution)}
        holdKind={pendingKind}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <section className="rounded-xl border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">What the store reported</h2>
            <dl className="divide-y divide-border">
              {storeSections.flatMap((s) => s.fields).map((f) => (
                <Row key={f.id} label={f.label} value={displayAnswer(f, formData[f.id])} />
              ))}
              {storeSections.length === 0 && <Row label="Description" value={request.description} />}
            </dl>
          </section>

          <section className="rounded-xl border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">Conversation</h2>
            <ul className="divide-y divide-border">
              {visibleComments.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No messages yet.</li>}
              {visibleComments.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{c.author?.full_name ?? 'Someone outside'}</span>
                    <span>{formatDateTime(c.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {vendorRequests.length > 0 && (
            <section className="rounded-xl border border-border">
              <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">Parts and PO requests</h2>
              <ul className="divide-y divide-border">
                {vendorRequests.map((r) => (
                  <li key={r.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{r.kind === 'po' ? 'PO required from Citykart' : 'Part required'} - {r.status}</span>
                      <span>{formatDateTime(r.created_at)}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {r.items.map((it) => (
                        <li key={it.id}>{it.line_no}. {it.item_name} - qty {it.qty}{it.price_excl_gst !== null && <> - {formatMoney(it.price_excl_gst)} (without GST)</>}</li>
                      ))}
                    </ul>
                    {r.decision_reason && <p className="mt-1 text-xs text-muted-foreground">{r.decision_reason}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {attachments.length > 0 && (
            <section className="rounded-xl border border-border p-4">
              <h2 className="mb-2 text-sm font-semibold">Files</h2>
              <AttachmentChips attachments={attachments} currentUserId={profile.id} canManageAll={false} />
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">Store</h2>
            <dl className="divide-y divide-border">
              <Row label="Store" value={store ? `${store.name} (${store.code})` : null} />
              <Row label="Address" value={[store?.address, store?.city, store?.state].filter(Boolean).join(', ')} />
              <Row label="Raised" value={formatDateTime(request.created_at)} />
              <Row label="Raised by" value={(request.requester as { full_name?: string } | null)?.full_name} />
            </dl>
          </section>

          <section className="rounded-xl border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">AC</h2>
            <dl className="divide-y divide-border">
              <Row label="CKDESK no." value={ac?.ckdesk_no} />
              <Row label="Brand" value={ac?.brand} />
              <Row label="Type / tonnage" value={[ac?.ac_type, ac?.tonnage].filter(Boolean).join(' ')} />
              <Row label="Floor" value={ac?.floor} />
              <Row label="Serial no." value={ac?.serial} />
              <Row label="AMC vendor" value={ac?.amc_vendor} />
            </dl>
          </section>

          <section className="rounded-xl border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">OEM details</h2>
            <dl className="divide-y divide-border">
              <Row label="OEM ticket number" value={vf.oemNumber ? String(formData[vf.oemNumber.id] ?? '') : null} />
              <Row label="OEM ticket date" value={vf.oemDate ? String(formData[vf.oemDate.id] ?? '') : null} />
              <Row label="Resolution" value={vf.resolution ? String(formData[vf.resolution.id] ?? '') : null} />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}
