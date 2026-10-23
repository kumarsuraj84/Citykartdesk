import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { notify } from '@/lib/notifications'
import { absoluteAppUrl } from '@/lib/email/notify-email'
import { userEmail } from './po'
import { buildStorePartsUpdatedMail, buildVendorHoldEndedMail, buildVendorReopenedMail, type PoMailBase } from './po-mail'
import type { RequestLine } from './lines'

// Mails and bell messages about a vendor's ticket that are not about a PO decision: the store told of a corrected parts list, the vendor told that Citykart ended
// the hold or that the ticket was reopened. Server only. Nothing here throws: a failed mail never undoes the ticket change that caused it.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }
const db = (): Db => createAdminClient() as unknown as Db

type Facts = { requestNo: string; mailBase: PoMailBase; vendorPerson: { id: string; full_name: string } | null; requester: { id: string; full_name: string } | null }

async function ticketFacts(requestId: string): Promise<Facts | null> {
  const d = db()
  const { data: req } = await d.from('requests').select('id, request_no, requester_id, assigned_to').eq('id', requestId).maybeSingle()
  if (!req) return null
  const [{ data: requester }, { data: person }, { data: snap }] = await Promise.all([
    d.from('profiles').select('id, full_name, store_id').eq('id', req.requester_id).maybeSingle(),
    req.assigned_to ? d.from('profiles').select('id, full_name, vendor_company_id').eq('id', req.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
    d.from('request_master_snapshots').select('snapshot').eq('request_id', requestId).eq('kind', 'ac').maybeSingle(),
  ])
  const [{ data: store }, { data: company }] = await Promise.all([
    requester?.store_id ? d.from('stores').select('code, name').eq('id', requester.store_id).maybeSingle() : Promise.resolve({ data: null }),
    person?.vendor_company_id ? d.from('vendor_companies').select('name').eq('id', person.vendor_company_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const unit = (Array.isArray(snap?.snapshot) ? snap.snapshot[0] : null) as { ckdesk_no?: string; brand?: string; tonnage?: string } | null
  const storeLabel = store ? `${store.name} (${store.code})` : '(store not known)'
  const acLabel = unit ? [unit.ckdesk_no, [unit.brand, unit.tonnage].filter(Boolean).join(' ')].filter(Boolean).join(' - ') || '(AC)' : '(AC not recorded)'
  return {
    requestNo: req.request_no,
    mailBase: { requestNo: req.request_no, storeLabel, acLabel, vendorName: company?.name ?? person?.full_name ?? 'Vendor', lines: [] },
    vendorPerson: person?.vendor_company_id ? { id: person.id, full_name: person.full_name } : null,
    requester: requester ? { id: requester.id, full_name: requester.full_name } : null,
  }
}

/** The store hears that the vendor corrected the parts list (the list is in the mail). */
export async function tellStorePartsUpdated(requestId: string, actorId: string, version: number, lines: RequestLine[]): Promise<void> {
  try {
    const f = await ticketFacts(requestId)
    if (!f?.requester) return
    const to = await userEmail(f.requester.id)
    if (to) {
      const mail = buildStorePartsUpdatedMail({ ...f.mailBase, lines, link: absoluteAppUrl(`/requests/${requestId}`), storeContactName: f.requester.full_name, version })
      await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: f.requestNo })
    }
    await notify({ recipientId: f.requester.id, actorId, type: 'status_changed', title: `Parts list updated: ${f.requestNo}`, body: `${f.mailBase.vendorName} corrected the parts list (version ${version}).`, requestId, link: `/requests/${requestId}`, skipEmail: true })
  } catch (e) {
    console.error('[tellStorePartsUpdated] failed', e)
  }
}

/** The vendor hears that Citykart ended the hold himself (his parts / quote request is closed). Only a ticket that is with a vendor technician sends anything. */
export async function tellVendorHoldEnded(requestId: string, actorId: string, byName: string, remark: string, kind: 'parts' | 'po'): Promise<void> {
  try {
    const f = await ticketFacts(requestId)
    if (!f?.vendorPerson) return
    const to = await userEmail(f.vendorPerson.id)
    if (to) {
      const mail = buildVendorHoldEndedMail({ ...f.mailBase, link: absoluteAppUrl(`/vendor/tickets/${requestId}`), vendorPersonName: f.vendorPerson.full_name, byName, remark, kind })
      await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: f.requestNo })
    }
    await notify({ recipientId: f.vendorPerson.id, actorId, type: 'status_changed', title: `Hold ended by Citykart: ${f.requestNo}`, body: `Your ${kind === 'po' ? 'quote' : 'parts'} request is closed. ${remark}`.slice(0, 200), requestId, link: `/vendor/tickets/${requestId}`, skipEmail: true })
  } catch (e) {
    console.error('[tellVendorHoldEnded] failed', e)
  }
}

/** The vendor hears the ticket was reopened: clearly marked, with the reason, and (after a resolved ticket) a reminder to enter the NEW OEM ticket number. Returns true when he was told. */
export async function tellVendorReopened(requestId: string, actorId: string, byName: string, reason: string, reopenCount: number, needsNewOemNumber: boolean): Promise<boolean> {
  try {
    const f = await ticketFacts(requestId)
    if (!f?.vendorPerson) return false
    const to = await userEmail(f.vendorPerson.id)
    if (to) {
      const mail = buildVendorReopenedMail({ ...f.mailBase, link: absoluteAppUrl(`/vendor/tickets/${requestId}`), vendorPersonName: f.vendorPerson.full_name, byName, reason, reopenCount, needsNewOemNumber })
      await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: f.requestNo })
    }
    await notify({ recipientId: f.vendorPerson.id, actorId, type: 'request_reopened', title: `REOPENED - please attend again: ${f.requestNo}`, body: (reason || 'The problem is not fixed.').slice(0, 200), requestId, link: `/vendor/tickets/${requestId}`, skipEmail: true })
    return true
  } catch (e) {
    console.error('[tellVendorReopened] failed', e)
    return false
  }
}
