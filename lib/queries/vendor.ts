import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { vendorBoxOf, VENDOR_BOX_ORDER, type VendorBox, type VendorHoldKind } from '@/lib/vendor/access'
import { holdKindsFor } from '@/lib/vendor/requests'
import { inBatches } from '@/lib/queries/in-batches'
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
  /** an AC PMS ticket (its category is the AC PMS category): shown in the vendor's "AC PMS tickets" tab, never in "My tickets" */
  is_pms: boolean
}

const MAX_ROWS = 1000

/** A list of ids read in batches of 100 (the production proxy refuses a request line of ~16 KB, about 400 ids). A failed batch throws: the vendor must see an error, not a shorter list. */
async function readIn<T>(ids: string[], what: string, run: (batch: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  if (ids.length === 0) return []
  const res = await inBatches<T>(ids, run)
  if (res.error) throw new Error(`Vendor tickets: could not read ${what}: ${res.error.message}`)
  return res.data
}

export async function getVendorTickets(): Promise<VendorTicketRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('requests')
    .select('id, request_no, title, status, priority, created_at, updated_at, assigned_to, requester_id, category_id, reopen_count, form_data, form_sections_snapshot, assignee:profiles!requests_assigned_to_fkey(full_name), requester:profiles!requests_requester_id_fkey(store_id)')
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  const rows = (data ?? []) as unknown as Array<{
    id: string; request_no: string; title: string; status: RequestStatus; priority: RequestPriority; created_at: string; updated_at: string
    assigned_to: string | null; category_id: string | null; reopen_count: number | null; form_data: Record<string, unknown> | null; form_sections_snapshot: unknown
    assignee: { full_name: string } | null; requester: { store_id: string | null } | null
  }>
  if (rows.length === 0) return []

  const admin = createAdminClient() as unknown as Db
  const storeIds = [...new Set(rows.map((r) => r.requester?.store_id).filter((s): s is string => !!s))]
  const ids = rows.map((r) => r.id)
  const categoryIds = [...new Set(rows.map((r) => r.category_id).filter((c): c is string => !!c))]
  const [stores, snaps, holdKinds, pmsCats, progSnaps] = await Promise.all([
    readIn<{ id: string; code: string; name: string }>(storeIds, 'the stores', (b) => admin.from('stores').select('id, code, name').in('id', b)),
    readIn<{ request_id: string; snapshot: Array<{ ckdesk_no?: string; brand?: string; tonnage?: string }> }>(ids, 'the AC details', (b) => admin.from('request_master_snapshots').select('request_id, snapshot').eq('kind', 'ac').in('request_id', b)),
    holdKindsFor(ids),
    readIn<{ id: string }>(categoryIds, 'the categories', (b) => admin.from('service_categories').select('id').eq('is_pms', true).in('id', b)),
    readIn<Record<string, unknown>>(ids, 'the program details', (b) => admin.from('request_program_snapshots').select('request_id, snapshot, program:vendor_programs(name)').in('request_id', b)),
  ])
  // a ticket of a Vendor Program has no AC row: its "machine" is the program (with the machine / serial of the sheet row when there is one)
  const programLabelByRequest = new Map((progSnaps as unknown as { request_id: string; snapshot: Array<{ machine_no?: string | null; serial?: string | null }> | null; program: { name: string } | { name: string }[] | null }[])
    .map((s) => {
      const name = (Array.isArray(s.program) ? s.program[0] : s.program)?.name ?? 'Program'
      const row = Array.isArray(s.snapshot) ? s.snapshot[0] : null
      const id = [row?.machine_no, row?.serial].map((v) => (v ?? '').trim()).filter(Boolean).join(' / ')
      return [s.request_id, id ? name + ' - ' + id : name] as const
    }))
  const pmsCategoryIds = new Set(pmsCats.map((c) => c.id))
  const storeById = new Map(stores.map((s) => [s.id, s]))
  const acByRequest = new Map(snaps.map((s) => [s.request_id, s.snapshot?.[0] ?? null]))

  const { findVendorFields, findProgramOemBoxes, BG_OEM_NUMBER_KEY } = await import('@/lib/vendor/fields')
  return rows.map((r) => {
    const store = r.requester?.store_id ? storeById.get(r.requester.store_id) : undefined
    const ac = acByRequest.get(r.id)
    const sections = Array.isArray(r.form_sections_snapshot) ? (r.form_sections_snapshot as never) : []
    const oemField = findVendorFields(sections).oemNumber ?? findProgramOemBoxes(sections).number
    const oem = (oemField ? String((r.form_data ?? {})[oemField.id] ?? '').trim() : '') || String((r.form_data ?? {})[BG_OEM_NUMBER_KEY] ?? '').trim()
    const hold_kind = holdKinds.get(r.id) ?? null
    return {
      id: r.id, request_no: r.request_no, title: r.title, status: r.status, priority: r.priority,
      created_at: r.created_at, updated_at: r.updated_at, assigned_to: r.assigned_to, assignee_name: r.assignee?.full_name ?? null,
      store_code: store?.code ?? null, store_name: store?.name ?? null,
      ac_label: ac ? [ac.ckdesk_no, [ac.brand, ac.tonnage].filter(Boolean).join(' ')].filter(Boolean).join(' - ') : (programLabelByRequest.get(r.id) ?? null),
      oem_ticket_no: oem || null, reopen_count: r.reopen_count ?? 0,
      box: vendorBoxOf(r.status, hold_kind), hold_kind, is_pms: !!r.category_id && pmsCategoryIds.has(r.category_id),
    }
  })
}

export type VendorTab = 'tickets' | 'pms'

export const isVendorTab = (v: unknown): v is VendorTab => v === 'tickets' || v === 'pms'

/** The two tabs of the vendor dashboard never share a ticket: AC PMS tickets are in "pms", every other ticket in "tickets". */
export function ticketsOfTab(rows: VendorTicketRow[], tab: VendorTab): VendorTicketRow[] {
  return rows.filter((r) => r.is_pms === (tab === 'pms'))
}

/** What waits for the vendor in a tab (a revised price to send, a ticket to start): shown as the number on the tab. */
export function waitingForVendor(rows: VendorTicketRow[]): number {
  return rows.filter((r) => r.box === 'revise_price' || r.box === 'open').length
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
