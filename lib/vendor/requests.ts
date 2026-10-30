import { createAdminClient } from '@/lib/supabase/admin'
import type { VendorHoldKind } from './access'
import type { RequestLine } from './lines'
import { inBatches } from '@/lib/queries/in-batches'

// The records of what a vendor asked for while a ticket is on hold (migrations 178-180). Server only: they are read and written with the server's key
// after the caller has proven that the ticket is theirs (through row security on the ticket itself).
//
// A request is a parts list or a PO QUOTE. Changing the list or the price makes a new VERSION; the earlier one becomes "superseded" and can no longer be approved.
// The PO itself exists only when the approver approves the final quote (po_number / po_date / the PO document are stored on that approved version).
//   pending            - waiting for the approver (PO) / for the parts to arrive (parts)
//   revision_requested - the approver asked for a revised price: the vendor's turn
//   approved / rejected / received / cancelled / withdrawn / superseded - finished

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }
const db = (): Db => createAdminClient() as unknown as Db

export type VendorRequestStatus = 'pending' | 'revision_requested' | 'approved' | 'rejected' | 'received' | 'cancelled' | 'superseded' | 'withdrawn'

export const OPEN_STATUSES: VendorRequestStatus[] = ['pending', 'revision_requested']

export type VendorRequestRow = {
  id: string
  org_id: string
  request_id: string
  kind: 'parts' | 'po'
  status: VendorRequestStatus
  created_by: string | null
  created_at: string
  decided_by: string | null
  decided_at: string | null
  decision_reason: string | null
  version: number
  replaces_id: string | null
  quote_attachment_ids: string[]
  revision_note: string | null
  revision_requested_by: string | null
  revision_requested_at: string | null
  approver_id?: string | null
  /** every approver the quote was sent to; any one of them can decide (the first decision wins) */
  approver_ids?: string[] | null
  po_number?: string | null
  po_date?: string | null
  po_attachment_id?: string | null
}

export type VendorRequestItemRow = { id: string; line_no: number; item_name: string; qty: number; price_excl_gst: number | null }

/** The ticket's open request (at most one): waiting for the approver, or waiting for the vendor's revised price. Null when there is none. */
export async function getOpenRequest(requestId: string): Promise<VendorRequestRow | null> {
  const { data } = await db().from('vendor_requests').select('*').eq('request_id', requestId).in('status', OPEN_STATUSES).maybeSingle()
  return (data as VendorRequestRow | null) ?? null
}

export async function getRequestItems(vendorRequestId: string): Promise<VendorRequestItemRow[]> {
  const { data } = await db().from('vendor_request_items').select('id, line_no, item_name, qty, price_excl_gst').eq('vendor_request_id', vendorRequestId).order('line_no', { ascending: true })
  return ((data ?? []) as VendorRequestItemRow[]).map((r) => ({ ...r, qty: Number(r.qty), price_excl_gst: r.price_excl_gst === null ? null : Number(r.price_excl_gst) }))
}

/** Every version ever made on a ticket, newest first, with its lines. */
export async function listRequestsWithItems(requestId: string): Promise<(VendorRequestRow & { items: VendorRequestItemRow[] })[]> {
  const { data } = await db().from('vendor_requests').select('*').eq('request_id', requestId).order('created_at', { ascending: false })
  const rows = (data ?? []) as VendorRequestRow[]
  return Promise.all(rows.map(async (r) => ({ ...r, items: await getRequestItems(r.id) })))
}

/** For each ticket on hold: what its hold is waiting for ('po' = the approver, 'revise' = the vendor's revised price, 'parts'). Only tickets with an open request. */
export async function holdKindsFor(ids: string[]): Promise<Map<string, VendorHoldKind>> {
  const out = new Map<string, VendorHoldKind>()
  if (ids.length === 0) return out
  // in batches of 100 ids (a long list makes a request line the production proxy refuses); a failed batch throws instead of showing every ticket as "not on hold"
  const res = await inBatches<{ request_id: string; kind: 'parts' | 'po'; status: VendorRequestStatus }>(ids, (b) => db().from('vendor_requests').select('request_id, kind, status').in('status', OPEN_STATUSES).in('request_id', b))
  if (res.error) throw new Error(`holdKindsFor: ${res.error.message}`)
  for (const r of res.data as { request_id: string; kind: 'parts' | 'po'; status: VendorRequestStatus }[]) {
    out.set(r.request_id, r.kind === 'parts' ? 'parts' : r.status === 'revision_requested' ? 'revise' : 'po')
  }
  return out
}

type NewRequest = { orgId: string; requestId: string; kind: 'parts' | 'po'; createdBy: string; lines: RequestLine[]; quoteAttachmentIds?: string[]; extra?: Record<string, unknown> }

async function insertWithLines(p: NewRequest, version: number, replacesId: string | null): Promise<{ id?: string; error?: string }> {
  const d = db()
  const { data, error } = await d.from('vendor_requests').insert({
    org_id: p.orgId, request_id: p.requestId, kind: p.kind, created_by: p.createdBy, version, replaces_id: replacesId, quote_attachment_ids: p.quoteAttachmentIds ?? [], ...(p.extra ?? {}),
  }).select('id').single()
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

/** Creates the first version of a request with its lines. Returns the new id, or an error (for example when the ticket already has an open request). */
export async function createVendorRequest(p: NewRequest): Promise<{ id?: string; error?: string }> {
  return insertWithLines(p, 1, null)
}

/** A new version replaces the open one: the old version becomes "superseded" (it can no longer be approved), the new one is open. Nothing changes if the new one cannot be saved. */
export async function createNextVersion(old: VendorRequestRow, p: NewRequest): Promise<{ id?: string; version?: number; error?: string }> {
  const d = db()
  const { data: moved } = await d.from('vendor_requests')
    .update({ status: 'superseded', decided_by: p.createdBy, decided_at: new Date().toISOString(), decision_reason: `Replaced by version ${old.version + 1}.` })
    .eq('id', old.id).in('status', OPEN_STATUSES).select('id').maybeSingle()
  if (!moved) return { error: 'This request was just changed by someone else. Please refresh and try again.' }
  const made = await insertWithLines(p, old.version + 1, old.id)
  if (made.error || !made.id) {
    await d.from('vendor_requests').update({ status: old.status, decided_by: null, decided_at: null, decision_reason: null }).eq('id', old.id)
    return { error: made.error ?? 'Could not save the request.' }
  }
  return { id: made.id, version: old.version + 1 }
}

/** Closes a request with a final state. Only a request that is still in one of `from` is changed (so a second click does nothing). Returns true when it changed. */
export async function settleRequest(
  vendorRequestId: string, status: Exclude<VendorRequestStatus, 'pending' | 'revision_requested'>, by: string | null, reason?: string | null, extra?: Record<string, unknown>,
  from: VendorRequestStatus[] = ['pending'],
): Promise<boolean> {
  const { data } = await db().from('vendor_requests')
    .update({ status, decided_by: by, decided_at: new Date().toISOString(), decision_reason: reason ?? null, ...(extra ?? {}) })
    .eq('id', vendorRequestId).in('status', from).select('id').maybeSingle()
  return !!data
}

/** The approver asks for a revised price: the request waits for the vendor. Only a request that is still waiting for the approver changes. */
export async function markRevisionRequested(vendorRequestId: string, by: string, note: string): Promise<boolean> {
  const { data } = await db().from('vendor_requests')
    .update({ status: 'revision_requested', revision_note: note, revision_requested_by: by, revision_requested_at: new Date().toISOString() })
    .eq('id', vendorRequestId).eq('status', 'pending').select('id').maybeSingle()
  return !!data
}

/** A Citykart technician takes the ticket back (or the hold ends in another way): whatever the vendor had asked for is closed as cancelled. Returns the kind that was closed, or null when nothing was open. Never throws. */
export async function cancelOpenRequest(requestId: string, by: string | null, reason: string): Promise<'parts' | 'po' | null> {
  try {
    const { data } = await db().from('vendor_requests')
      .update({ status: 'cancelled', decided_by: by, decided_at: new Date().toISOString(), decision_reason: reason })
      .eq('request_id', requestId).in('status', OPEN_STATUSES).select('kind')
    return ((data ?? [])[0]?.kind as 'parts' | 'po' | undefined) ?? null
  } catch (e) {
    console.error('[cancelOpenRequest] failed', e)
    return null
  }
}

/**
 * Ties files (the FSR, a quote, the PO document) to the conversation message they belong to, so they show right under it for everybody.
 * Only files of THIS ticket are touched. Never throws.
 */
export async function linkFilesToComment(requestId: string, commentId: string | undefined, attachmentIds: (string | null | undefined)[]): Promise<void> {
  const ids = attachmentIds.filter((x): x is string => !!x)
  if (!commentId || ids.length === 0) return
  try {
    await db().from('request_attachments').update({ comment_id: commentId }).eq('request_id', requestId).in('id', ids)
  } catch (e) {
    console.error('[linkFilesToComment] failed', e)
  }
}

/** Of the given file ids, those this person uploaded to this ticket (not deleted). Used to check the compulsory quote / FSR. */
export async function ownFiles(requestId: string, uploadedBy: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const { data } = await db().from('request_attachments').select('id').eq('request_id', requestId).eq('uploaded_by', uploadedBy).is('deleted_at', null).in('id', ids)
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

/** Undo an APPROVAL (used when the ticket could not be moved on after it): the quote goes back to waiting for the approver and the PO number, date and document are cleared. Never throws. */
export async function unsettleApproved(vendorRequestId: string): Promise<void> {
  try {
    await db().from('vendor_requests')
      .update({ status: 'pending', decided_by: null, decided_at: null, decision_reason: null, po_number: null, po_date: null, po_attachment_id: null })
      .eq('id', vendorRequestId).eq('status', 'approved')
  } catch (e) {
    console.error('[unsettleApproved] failed', e)
  }
}

/** Undo a settle (used when the follow-up step failed): a request that was just rejected goes back to the state it was in. Never throws. */
export async function unsettleRequest(vendorRequestId: string, backTo: VendorRequestStatus, wasRejected: boolean): Promise<void> {
  try {
    await db().from('vendor_requests')
      .update({ status: backTo, decided_by: null, decided_at: null, decision_reason: null })
      .eq('id', vendorRequestId).eq('status', wasRejected ? 'rejected' : backTo)
  } catch (e) {
    console.error('[unsettleRequest] failed', e)
  }
}
