import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { vendorBoxOf, VENDOR_BOX_ORDER, type VendorBox, type VendorHoldKind } from '@/lib/vendor/access'
import { holdKindsFor } from '@/lib/vendor/requests'
import type { RequestPriority, RequestStatus } from '@/types'

// What a vendor (OEM engineer) reads. The list of tickets comes through the vendor's OWN login, so row security decides which tickets he may see
// (his own, or those of his company's technicians for a vendor manager); the server's key is used only to add the store name and the AC details
// of exactly those tickets.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type VendorTicketRow = {
  id: string
  request_no: string
  title: string
  status: RequestStatus
  priority: RequestPriority
  created_at: string
  updated_at: string
  assigned_to: string | null
  assignee_name: string | null
  store_code: string | null
  store_name: string | null
  ac_label: string | null
  oem_ticket_no: string | null
  /** how many times the store reopened this ticket after it was resolved */
  reopen_count: number
  box: VendorBox
  hold_kind: VendorHoldKind
}

const MAX_ROWS = 1000

export async function getVendorTickets(): Promise<VendorTicketRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('requests')
    .select('id, request_no, title, status, priority, created_at, updated_at, assigned_to, requester_id, reopen_count, form_data, form_sections_snapshot, assignee:profiles!requests_assigned_to_fkey(full_name), requester:profiles!requests_requester_id_fkey(store_id)')
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  const rows = (data ?? []) as unknown as Array<{
    id: string; request_no: string; title: string; status: RequestStatus; priority: RequestPriority; created_at: string; updated_at: string
    assigned_to: string | null; reopen_count: number | null; form_data: Record<string, unknown> | null; form_sections_snapshot: unknown
    assignee: { full_name: string } | null; requester: { store_id: string | null } | null
  }>
  if (rows.length === 0) return []

  const admin = createAdminClient() as unknown as Db
  const storeIds = [...new Set(rows.map((r) => r.requester?.store_id).filter((s): s is string => !!s))]
  const ids = rows.map((r) => r.id)
  const [{ data: stores }, { data: snaps }, holdKinds] = await Promise.all([
    storeIds.length ? admin.from('stores').select('id, code, name').in('id', storeIds) : Promise.resolve({ data: [] }),
    admin.from('request_master_snapshots').select('request_id, snapshot').eq('kind', 'ac').in('request_id', ids),
    holdKindsFor(ids),
  ])
  const storeById = new Map(((stores ?? []) as { id: string; code: string; name: string }[]).map((s) => [s.id, s]))
  const acByRequest = new Map(((snaps ?? []) as { request_id: string; snapshot: Array<{ ckdesk_no?: string; brand?: string; tonnage?: string }> }[])
    .map((s) => [s.request_id, s.snapshot?.[0] ?? null]))

  const { findVendorFields } = await import('@/lib/vendor/fields')
  return rows.map((r) => {
    const store = r.requester?.store_id ? storeById.get(r.requester.store_id) : undefined
    const ac = acByRequest.get(r.id)
    const sections = Array.isArray(r.form_sections_snapshot) ? (r.form_sections_snapshot as never) : []
    const oemField = findVendorFields(sections).oemNumber
    const oem = oemField ? String((r.form_data ?? {})[oemField.id] ?? '').trim() : ''
    const hold_kind = holdKinds.get(r.id) ?? null
    return {
      id: r.id, request_no: r.request_no, title: r.title, status: r.status, priority: r.priority,
      created_at: r.created_at, updated_at: r.updated_at, assigned_to: r.assigned_to, assignee_name: r.assignee?.full_name ?? null,
      store_code: store?.code ?? null, store_name: store?.name ?? null,
      ac_label: ac ? [ac.ckdesk_no, [ac.brand, ac.tonnage].filter(Boolean).join(' ')].filter(Boolean).join(' - ') : null,
      oem_ticket_no: oem || null, reopen_count: r.reopen_count ?? 0,
      box: vendorBoxOf(r.status, hold_kind), hold_kind,
    }
  })
}

export function countByBox(rows: VendorTicketRow[]): Record<VendorBox, number> {
  const out = Object.fromEntries(VENDOR_BOX_ORDER.map((b) => [b, 0])) as Record<VendorBox, number>
  for (const r of rows) out[r.box] += 1
  return out
}

/** Free-text search over the columns a vendor sees in the list. */
export function searchVendorTickets(rows: VendorTicketRow[], q: string): VendorTicketRow[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((r) => [r.request_no, r.title, r.store_code, r.store_name, r.ac_label, r.oem_ticket_no, r.assignee_name]
    .some((v) => (v ?? '').toLowerCase().includes(needle)))
}
