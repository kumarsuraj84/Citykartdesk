import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getRequestById, getRequestComments } from '@/lib/queries/requests'
import { getRequestAttachments } from '@/lib/queries/attachments'
import { createAdminClient } from '@/lib/supabase/admin'
import { isVendor, vendorBoxOf, vendorRoleOf, VENDOR_BOX_LABELS } from '@/lib/vendor/access'
import { BG_OEM_DATE_KEY, BG_OEM_NUMBER_KEY, displayAnswer, findProgramOemBoxes, findVendorFields, programResolutionChoices, resolutionChoices } from '@/lib/vendor/fields'
import { loadProgramAsset } from '@/lib/vendor/asset'
import { loadLiveResolutionField } from '@/lib/vendor/live-form'
import { VendorTicketActions, type OpenRequestView } from '@/components/vendor/VendorTicketActions'
import { listRequestsWithItems } from '@/lib/vendor/requests'
import { formatMoney } from '@/lib/vendor/lines'
import { AttachmentChips } from '@/components/requests/AttachmentChips'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import { filterFieldsForRequester, filterSectionsForCategory } from '@/lib/forms/sections'
import { formatDateTime } from '@/lib/utils'
import { parseOemComment } from '@/lib/masters/comment-view'
import { OemSentComment } from '@/components/requests/OemSentComment'
import { LinesComment } from '@/components/requests/LinesComment'
import { parseLinesComment } from '@/lib/vendor/lines-comment'
import { isPmsRequest } from '@/lib/pms/is-pms'
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

const REQUEST_STATUS_TEXT: Record<string, string> = {
  pending: 'waiting', revision_requested: 'revised price asked', approved: 'approved (PO issued)', rejected: 'rejected', received: 'parts received', cancelled: 'cancelled',
  superseded: 'replaced by a newer version', withdrawn: 'withdrawn',
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
  const acs = (Array.isArray(snapRes.data?.snapshot) ? snapRes.data.snapshot : []) as Record<string, string | null>[]
  const ac = acs[0] ?? null
  // a ticket of a Vendor Program has no AC row: its saved sheet row and the program's own resolution list are used instead
  const programAsset = ac ? null : await loadProgramAsset(admin, id)
  const store = storeRes.data as { code: string; name: string; address: string | null; city: string | null; state: string | null } | null

  const sections = (Array.isArray(request.form_sections_snapshot) ? request.form_sections_snapshot : []) as unknown as FormSection[]
  const formData = (request.form_data ?? {}) as Record<string, unknown>
  const vf = findVendorFields(sections)
  const liveResolution = await loadLiveResolutionField(request.service_id, sections)
  const vendorRequests = await listRequestsWithItems(id)
  const openRow = vendorRequests.find((r) => r.status === 'pending' || r.status === 'revision_requested') ?? null
  const holdKind = openRow ? (openRow.kind === 'parts' ? 'parts' : openRow.status === 'revision_requested' ? 'revise' : 'po') : null
  const asker = openRow?.revision_requested_by ? ((await admin.from('profiles').select('full_name').eq('id', openRow.revision_requested_by).maybeSingle()).data?.full_name as string | undefined) ?? null : null
  const openRequest: OpenRequestView | null = openRow && (openRow.status === 'pending' || openRow.status === 'revision_requested')
    ? { kind: openRow.kind, status: openRow.status, version: openRow.version, note: openRow.revision_note, asker, lines: openRow.items.map((i) => ({ item_name: i.item_name, qty: i.qty, price_excl_gst: i.price_excl_gst ?? '' })) }
    : null
  // files are shown right under the conversation message they belong to (the FSR, the quote, the PO document); the rest are the store's own
  const filesByComment = new Map<string, typeof attachments>()
  const otherFiles: typeof attachments = []
  for (const att of attachments) {
    const cid = (att as { comment_id?: string | null }).comment_id
    if (cid) filesByComment.set(cid, [...(filesByComment.get(cid) ?? []), att])
    else otherFiles.push(att)
  }
  const programBoxes = findProgramOemBoxes(sections)
  const vendorFieldIds = new Set([vf.oemNumber?.id, vf.oemDate?.id, vf.resolution?.id, programBoxes.number?.id, programBoxes.date?.id].filter(Boolean) as string[])
  const bgText = (k: string) => String(formData[k] ?? '').trim()
  // what the store filled in (the technician-only boxes are shown separately below)
  const storeSections = filterFieldsForRequester(filterSectionsForCategory(sections, request.category_id))
    .map((s) => ({ ...s, fields: s.fields.filter((f) => !vendorFieldIds.has(f.id) && f.type !== 'store_address') }))
    .filter((s) => s.fields.length > 0)

  const pms = await isPmsRequest(admin as never, id)
  const isTech = vendorRoleOf(profile) === 'technician' && request.assigned_to === profile.id
  const box = vendorBoxOf(request.status, holdKind)
  const visibleComments = comments.filter((c) => !c.is_internal)

  return (
    <div className="max-w-5xl space-y-4">
      <Link href={pms ? '/vendor?tab=pms' : '/vendor'} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> {pms ? 'AC PMS tickets' : 'My tickets'}</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{request.request_no}</div>
          <h1 className="text-lg font-semibold leading-tight">{request.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {(request.reopen_count ?? 0) > 0 && <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Reopened ×{request.reopen_count}</span>}
          <span className="text-xs text-muted-foreground">{VENDOR_BOX_LABELS[box]}</span>
          <StatusBadge status={request.status} />
          <PriorityBadge priority={request.priority} />
        </div>
      </div>

      <VendorTicketActions
        requestId={request.id}
        status={request.status}
        canAct={isTech}
        resolutionChoices={programAsset ? programResolutionChoices(programAsset.resolutionOptions) : resolutionChoices(liveResolution)}
        openRequest={openRequest}
        pms={pms}
        programName={programAsset?.programName ?? null}
        oemRequired={programAsset ? programAsset.oemNumberRequired : true}
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
                  {(() => { const oem = parseOemComment(c.body); if (oem) return <OemSentComment view={oem} />; const lines = parseLinesComment(c.body); return lines ? <LinesComment view={lines} /> : <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p> })()}
                  {(filesByComment.get(c.id) ?? []).length > 0 && (
                    <div className="mt-2"><AttachmentChips attachments={filesByComment.get(c.id) ?? []} currentUserId={profile.id} canManageAll={false} /></div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {vendorRequests.length > 0 && (
            <section className="rounded-xl border border-border">
              <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">Parts lists and quotes (all versions)</h2>
              <ul className="divide-y divide-border">
                {vendorRequests.map((r) => (
                  <li key={r.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{r.kind === 'po' ? 'Quote' : 'Parts list'} version {r.version} - {REQUEST_STATUS_TEXT[r.status] ?? r.status}</span>
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

          {otherFiles.length > 0 && (
            <section className="rounded-xl border border-border p-4">
              <h2 className="mb-2 text-sm font-semibold">Files from the store</h2>
              <AttachmentChips attachments={otherFiles} currentUserId={profile.id} canManageAll={false} />
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

          {pms ? (
            // an AC PMS visit is for the whole store: every active AC of the store is listed
            <section className="rounded-xl border border-border">
              <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">ACs to service ({acs.length})</h2>
              {acs.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">The AC sheet lists no active AC for this store. Ask Citykart which ACs are to be serviced.</p>
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {acs.map((u, i) => (
                    <li key={i} className="px-4 py-2">
                      <span className="font-medium">{[u.ckdesk_no, [u.brand, u.tonnage].filter(Boolean).join(' ')].filter(Boolean).join(' - ')}</span>
                      <span className="text-muted-foreground">{[u.ac_type, u.floor, u.serial ? `serial ${u.serial}` : ''].filter(Boolean).length ? ` (${[u.ac_type, u.floor, u.serial ? `serial ${u.serial}` : ''].filter(Boolean).join(', ')})` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : programAsset ? (
          <section className="rounded-xl border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">{programAsset.programName}</h2>
            <dl className="divide-y divide-border">
              <Row label="Vendor" value={programAsset.row?.vendor} />
              <Row label="Machine no." value={programAsset.row?.machine_no} />
              <Row label="Serial no." value={programAsset.row?.serial} />
              {Object.entries(programAsset.row?.extra ?? {}).map(([k, v]) => <Row key={k} label={k} value={v} />)}
            </dl>
          </section>
          ) : (
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
          )}

          {programAsset && (
          <section className="rounded-xl border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">OEM details</h2>
            <dl className="divide-y divide-border">
              <Row label="OEM ticket number" value={(programBoxes.number ? String(formData[programBoxes.number.id] ?? '') : '') || bgText(BG_OEM_NUMBER_KEY)} />
              <Row label="OEM ticket date" value={(programBoxes.date ? String(formData[programBoxes.date.id] ?? '') : '') || bgText(BG_OEM_DATE_KEY)} />
            </dl>
          </section>
          )}
          {!programAsset && (
          <section className="rounded-xl border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">OEM details</h2>
            <dl className="divide-y divide-border">
              <Row label="OEM ticket number" value={vf.oemNumber ? String(formData[vf.oemNumber.id] ?? '') : null} />
              <Row label="OEM ticket date" value={vf.oemDate ? String(formData[vf.oemDate.id] ?? '') : null} />
              <Row label="Resolution" value={vf.resolution ? String(formData[vf.resolution.id] ?? '') : null} />
            </dl>
          </section>
          )}
        </aside>
      </div>
    </div>
  )
}
