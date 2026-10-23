import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { splitRecipients } from '@/lib/masters/emails'
import type { PoMailBase } from './po-mail'
import { getRequestItems, type VendorRequestItemRow, type VendorRequestRow } from './requests'
import { totalOf, type RequestLine } from './lines'

// The PO side of the vendor module that needs the database: who approves, what a PO is about, and the e-mail to the OEM. Server only.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; auth: any; storage: any }
const db = (): Db => createAdminClient() as unknown as Db

/** Krishan approves purchase orders unless an administrator names somebody else (Admin > Vendors). */
export const DEFAULT_PO_APPROVER_EMAIL = 'krishan.patel@citykartstores.com'
export const PO_APPROVER_SETTING = 'vendor_po_approver_id'

const APPROVER_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

export type PoApprover = { id: string; full_name: string }

async function approverIfValid(orgId: string, id: string): Promise<PoApprover | null> {
  const { data } = await db().from('profiles').select('id, full_name, role, is_active, org_id, vendor_company_id').eq('id', id).maybeSingle()
  if (!data || data.org_id !== orgId || data.is_active === false || data.vendor_company_id || !APPROVER_ROLES.includes(data.role)) return null
  return { id: data.id, full_name: data.full_name }
}

/** The person who decides PO requests: the one set by an administrator, else the default (Krishan), else nobody. */
export async function resolvePoApprover(orgId: string): Promise<PoApprover | null> {
  const d = db()
  const { data: setting } = await d.from('app_settings').select('value').eq('key', PO_APPROVER_SETTING).maybeSingle()
  const chosen = (setting?.value ?? '').trim()
  if (chosen) {
    const ok = await approverIfValid(orgId, chosen)
    if (ok) return ok
  }
  for (let page = 1; page <= 5; page++) {
    const { data } = await d.auth.admin.listUsers({ page, perPage: 1000 })
    const users = (data?.users ?? []) as { id: string; email?: string }[]
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === DEFAULT_PO_APPROVER_EMAIL)
    if (hit) return approverIfValid(orgId, hit.id)
    if (users.length < 1000) break
  }
  return null
}

export async function userEmail(userId: string): Promise<string | null> {
  try {
    const { data } = await db().auth.admin.getUserById(userId)
    return (data?.user?.email as string | undefined) ?? null
  } catch {
    return null
  }
}

type Unit = { ckdesk_no?: string; brand?: string; tonnage?: string; emails?: string[]; po_emails?: string[] } | null

export type PoContext = {
  vendorRequest: VendorRequestRow
  items: VendorRequestItemRow[]
  lines: RequestLine[]
  request: { id: string; request_no: string; title: string; org_id: string; requester_id: string; assigned_to: string | null; status: string; service_id: string }
  vendorName: string
  vendorPerson: { id: string; full_name: string } | null
  storeLabel: string
  acLabel: string
  unit: Unit
  mailBase: PoMailBase
  /** the quote file(s) the vendor attached to this version */
  quoteFiles: { id: string; file_name: string }[]
  /** the total (without GST) of the version this one replaced, when it is a revised quote */
  previousTotal: number | null
}

/** Everything a PO screen or mail needs about one vendor request. Null when it does not exist. */
export async function loadPoContext(vendorRequestId: string): Promise<PoContext | null> {
  const d = db()
  const { data: vr } = await d.from('vendor_requests').select('*').eq('id', vendorRequestId).maybeSingle()
  if (!vr) return null
  const vendorRequest = vr as VendorRequestRow
  const [{ data: req }, items, { data: snap }, { data: quotes }, previousItems] = await Promise.all([
    d.from('requests').select('id, request_no, title, org_id, requester_id, assigned_to, status, service_id').eq('id', vendorRequest.request_id).maybeSingle(),
    getRequestItems(vendorRequestId),
    d.from('request_master_snapshots').select('snapshot').eq('request_id', vendorRequest.request_id).eq('kind', 'ac').maybeSingle(),
    (vendorRequest.quote_attachment_ids ?? []).length
      ? d.from('request_attachments').select('id, file_name').in('id', vendorRequest.quote_attachment_ids).is('deleted_at', null)
      : Promise.resolve({ data: [] }),
    vendorRequest.replaces_id ? getRequestItems(vendorRequest.replaces_id) : Promise.resolve(null),
  ])
  if (!req) return null
  const [{ data: requester }, { data: person }] = await Promise.all([
    d.from('profiles').select('store_id').eq('id', req.requester_id).maybeSingle(),
    req.assigned_to ? d.from('profiles').select('id, full_name, vendor_company_id').eq('id', req.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const [{ data: store }, { data: company }] = await Promise.all([
    requester?.store_id ? d.from('stores').select('code, name').eq('id', requester.store_id).maybeSingle() : Promise.resolve({ data: null }),
    person?.vendor_company_id ? d.from('vendor_companies').select('name').eq('id', person.vendor_company_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const unit = (Array.isArray(snap?.snapshot) ? snap.snapshot[0] : null) as Unit
  const lines: RequestLine[] = items.map((i) => ({ item_name: i.item_name, qty: i.qty, price_excl_gst: i.price_excl_gst }))
  const storeLabel = store ? `${store.name} (${store.code})` : '(store not known)'
  const acLabel = unit ? [unit.ckdesk_no, [unit.brand, unit.tonnage].filter(Boolean).join(' ')].filter(Boolean).join(' - ') || '(AC)' : '(AC not recorded)'
  const vendorName = company?.name ?? person?.full_name ?? 'Vendor'
  return {
    vendorRequest, items, lines, request: req, vendorName, vendorPerson: person ? { id: person.id, full_name: person.full_name } : null,
    storeLabel, acLabel, unit,
    mailBase: { requestNo: req.request_no, storeLabel, acLabel, vendorName, lines },
    quoteFiles: (quotes ?? []) as { id: string; file_name: string }[],
    previousTotal: previousItems ? totalOf(previousItems.map((i) => ({ qty: i.qty, price_excl_gst: i.price_excl_gst }))) : null,
  }
}

/** The OEM address(es) for PO details: the AC sheet's "Email for PO detail", else the AC's ordinary OEM addresses. Empty when the sheet has none. */
export function poRecipients(unit: Unit): { to: string[]; cc: string[] } | null {
  const pool = unit?.po_emails?.length ? unit.po_emails : unit?.emails ?? []
  if (pool.length === 0) return null
  return splitRecipients(pool)
}

/** Sends one mail to the OEM about a PO decision. Returns an error text when it could not be sent (the caller leaves an internal note). Never throws. */
export async function sendPoMailToOem(ctx: PoContext, mail: { subject: string; html: string; text: string }, attachmentId?: string | null): Promise<{ error?: string }> {
  try {
    const rec = poRecipients(ctx.unit)
    if (!rec) return { error: 'The AC sheet has no e-mail address for PO details (and no OEM address) for this AC.' }
    let attachments: { filename: string; content: string }[] | undefined
    if (attachmentId) {
      const d = db()
      const { data: att } = await d.from('request_attachments').select('file_name, storage_path').eq('id', attachmentId).maybeSingle()
      if (att) {
        const file = await d.storage.from('request-attachments').download(att.storage_path)
        if (file?.data) attachments = [{ filename: att.file_name, content: Buffer.from(await file.data.arrayBuffer()).toString('base64') }]
      }
    }
    const sent = await sendEmail({ to: rec.to, cc: rec.cc, subject: mail.subject, html: mail.html, text: mail.text, attachments, threadRequestNo: ctx.request.request_no })
    return sent.error ? { error: 'The e-mail to the OEM could not be sent.' } : {}
  } catch (e) {
    console.error('[sendPoMailToOem] failed', e)
    return { error: 'The e-mail to the OEM could not be sent.' }
  }
}

/** A note on the ticket for Citykart staff only (for example "the OEM could not be e-mailed, please tell them yourself"). */
export async function internalNote(requestId: string, authorId: string, body: string): Promise<void> {
  await db().from('request_comments').insert({ request_id: requestId, author_id: authorId, body, is_internal: true })
}

/** A file stored on the ticket, as an e-mail attachment (base64). Null when it cannot be read. Never throws. */
export async function attachmentForMail(attachmentId: string | null | undefined): Promise<{ filename: string; content: string } | null> {
  if (!attachmentId) return null
  try {
    const d = db()
    const { data: att } = await d.from('request_attachments').select('file_name, storage_path').eq('id', attachmentId).maybeSingle()
    if (!att) return null
    const file = await d.storage.from('request-attachments').download(att.storage_path)
    return file?.data ? { filename: att.file_name as string, content: Buffer.from(await file.data.arrayBuffer()).toString('base64') } : null
  } catch (e) {
    console.error('[attachmentForMail] failed', e)
    return null
  }
}
