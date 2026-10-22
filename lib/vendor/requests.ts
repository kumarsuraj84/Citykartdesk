import { createAdminClient } from '@/lib/supabase/admin'
import type { VendorHoldKind } from './access'
import type { RequestLine } from './lines'

// The records of what a vendor asked for while a ticket is on hold (migration 178). Server only: they are read and written with the server's key
// after the caller has proven that the ticket is theirs (through row security on the ticket itself).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }
const db = (): Db => createAdminClient() as unknown as Db

export type VendorRequestRow = {
  id: string
  org_id: string
  request_id: string
  kind: 'parts' | 'po'
  status: 'pending' | 'approved' | 'rejected' | 'received' | 'cancelled'
  created_by: string | null
  created_at: string
  decided_by: string | null
  decided_at: string | null
  decision_reason: string | null
  approver_id?: string | null
  po_number?: string | null
  po_date?: string | null
  po_attachment_id?: string | null
}

export type VendorRequestItemRow = { id: string; line_no: number; item_name: string; qty: number; price_excl_gst: number | null }

/** The ticket's open request (at most one), or null. */
export async function getPendingRequest(requestId: string): Promise<VendorRequestRow | null> {
  const { data } = await db().from('vendor_requests').select('*').eq('request_id', requestId).eq('status', 'pending').maybeSingle()
  return (data as VendorRequestRow | null) ?? null
}

export async function getRequestItems(vendorRequestId: string): Promise<VendorRequestItemRow[]> {
  const { data } = await db().from('vendor_request_items').select('id, line_no, item_name, qty, price_excl_gst').eq('vendor_request_id', vendorRequestId).order('line_no', { ascending: true })
  return ((data ?? []) as VendorRequestItemRow[]).map((r) => ({ ...r, qty: Number(r.qty), price_excl_gst: r.price_excl_gst === null ? null : Number(r.price_excl_gst) }))
}

/** Every request ever made on a ticket, newest first, with its lines. */
export async function listRequestsWithItems(requestId: string): Promise<(VendorRequestRow & { items: VendorRequestItemRow[] })[]> {
  const { data } = await db().from('vendor_requests').select('*').eq('request_id', requestId).order('created_at', { ascending: false })
  const rows = (data ?? []) as VendorRequestRow[]
  return Promise.all(rows.map(async (r) => ({ ...r, items: await getRequestItems(r.id) })))
}

/** For each ticket id: what its hold is for (only tickets with an open request). */
export async function holdKindsFor(ids: string[]): Promise<Map<string, VendorHoldKind>> {
  const out = new Map<string, VendorHoldKind>()
  if (ids.length === 0) return out
  const { data } = await db().from('vendor_requests').select('request_id, kind').eq('status', 'pending').in('request_id', ids)
  for (const r of (data ?? []) as { request_id: string; kind: 'parts' | 'po' }[]) out.set(r.request_id, r.kind === 'po' ? 'po' : 'parts')
  return out
}

/** Creates the request with its lines. Returns the new id, or an error (for example when the ticket already has an open request). */
export async function createVendorRequest(p: { orgId: string; requestId: string; kind: 'parts' | 'po'; createdBy: string; lines: RequestLine[]; extra?: Record<string, unknown> }): Promise<{ id?: string; error?: string }> {
  const d = db()
  const { data, error } = await d.from('vendor_requests').insert({ org_id: p.orgId, request_id: p.requestId, kind: p.kind, created_by: p.createdBy, ...(p.extra ?? {}) }).select('id').single()
  if (error || !data) return { error: error?.code === '23505' ? 'This ticket already has an open request.' : 'Could not save the request.' }
  const { error: itemsErr } = await d.from('vendor_request_items').insert(p.lines.map((l, i) => ({
    vendor_request_id: data.id, line_no: i + 1, item_name: l.item_name, qty: l.qty, price_excl_gst: l.price_excl_gst,
  })))
  if (itemsErr) {
    await d.from('vendor_requests').delete().eq('id', data.id)
    return { error: 'Could not save the items.' }
  }
  return { id: data.id as string }
}

/** Closes the ticket's open request with a final state. Only a still-open request is changed (so a second click does nothing). Returns true when it changed. */
export async function settleRequest(vendorRequestId: string, status: 'approved' | 'rejected' | 'received' | 'cancelled', by: string | null, reason?: string | null, extra?: Record<string, unknown>): Promise<boolean> {
  const { data } = await db().from('vendor_requests')
    .update({ status, decided_by: by, decided_at: new Date().toISOString(), decision_reason: reason ?? null, ...(extra ?? {}) })
    .eq('id', vendorRequestId).eq('status', 'pending').select('id').maybeSingle()
  return !!data
}

/** A Citykart technician takes the ticket back (or the hold ends in another way): whatever the vendor had asked for is closed as cancelled. Never throws. */
export async function cancelOpenRequest(requestId: string, by: string | null, reason: string): Promise<void> {
  try {
    await db().from('vendor_requests')
      .update({ status: 'cancelled', decided_by: by, decided_at: new Date().toISOString(), decision_reason: reason })
      .eq('request_id', requestId).eq('status', 'pending')
  } catch (e) {
    console.error('[cancelOpenRequest] failed', e)
  }
}
