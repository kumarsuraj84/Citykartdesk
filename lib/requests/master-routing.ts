import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { sendEmail } from '@/lib/email/send'
import {
  acMailTarget, findSelectedUnit, gensetMailTarget, loadActiveAcUnits, loadGensetsForStore, type AcUnitRecord, type GensetRecord, type MailTarget,
} from '@/lib/masters/resolve'
import { isAssignedToVendor } from '@/lib/vendor/ticket-fields'
import { acVars, gensetVars, masterSentComment, renderMasterMail, resolveTemplate, type MailKind } from '@/lib/masters/mail'

// Sends a ticket to the OEM using the AC / Genset sheet (replaces the old "OEM bucket" routing). Fires once, right after the ticket is created.
//  - AC: the unit the requester chose gives the addresses (without a choice, the store's other active units do);
//  - Genset: every genset row of the store is mailed in one message;
//  - company addresses (@citykartstores.com, @citykart.org) are copied (CC), the OEM addresses are in To;
//  - anything missing (store not linked, not in the sheet, no address) leaves the ticket Open as a normal ticket with an internal note for the technician.
// Uses the server's client: a system action with no interactive person.

type Admin = ReturnType<typeof createAdminClient>

export async function saveMasterSnapshot(admin: Admin, p: { requestId: string; kind: MailKind; units: (AcUnitRecord | GensetRecord)[]; to?: string[]; cc?: string[] }) {
  if (p.units.length === 0) return
  await (admin as unknown as { from: (t: string) => any }) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from('request_master_snapshots')
    .upsert({
      request_id: p.requestId, kind: p.kind, unit_ids: p.units.map((u) => u.id), snapshot: p.units as unknown,
      mailed_to: p.to ?? [], mailed_cc: p.cc ?? [],
    }, { onConflict: 'request_id,kind' })
}

export async function runMasterOemRouting(p: {
  admin: Admin
  actorId: string
  orgId: string
  request: { id: string; request_no: string }
  kind: MailKind
  /** stores.code of the requester's store (null = the requester is not linked to a store). */
  storeCode: string | null
  /** The value the requester picked in the AC number field (AC tickets). */
  chosenAcValue?: string | null
  /** Set when a reopened ticket is sent to the OEM again: the unit it was first sent for, and the reason the store gave. */
  reopen?: { unit: AcUnitRecord | null; reason: string }
  /** True for the AC Issues service flag (not a category): when the store has nothing in the sheet the ticket simply stays a normal ticket, with no note. */
  quiet?: boolean
  categoryName?: string | null
  title: string
  description: string
  requesterName: string
  requesterEmail: string
  requesterPhone: string
  storeAddress: string | null
}): Promise<void> {
  const { admin, orgId, request } = p
  const db = admin as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const label = p.kind === 'genset' ? 'Genset' : 'AC'
  const note = async (body: string) => {
    if (p.quiet) return
    await admin.from('request_comments').insert({ request_id: request.id, author_id: p.actorId, body, is_internal: true })
  }
  if (!p.storeCode) { await note(`This requester is not linked to a store, so the ticket was not sent to the ${label} OEM automatically. Please send it to the OEM yourself.`); return }

  let target: MailTarget | null
  let vars: Record<string, string>
  let units: (AcUnitRecord | GensetRecord)[]
  if (p.kind === 'ac') {
    const active = await loadActiveAcUnits(db, orgId, p.storeCode)
    if (active.length === 0) { await note(`Store ${p.storeCode} has no active AC in the AC sheet, so the ticket was not sent to the AC OEM automatically. Please send it to the OEM yourself.`); return }
    const selected = p.reopen?.unit ? active.find((u) => u.id === p.reopen!.unit!.id) ?? p.reopen.unit : findSelectedUnit(active, p.chosenAcValue)
    target = acMailTarget(active, selected)
    vars = acVars(selected)
    units = selected ? [selected] : []
  } else {
    const gensets = await loadGensetsForStore(db, orgId, p.storeCode)
    if (gensets.length === 0) { await note(`Store ${p.storeCode} is not in the Genset sheet, so the ticket was not sent to the Genset OEM automatically. Please send it to the OEM yourself.`); return }
    target = gensetMailTarget(gensets)
    vars = gensetVars(gensets)
    units = gensets
  }
  if (!target) { await note(`The ${label} sheet has no e-mail address for store ${p.storeCode}, so the ticket was not sent to the OEM automatically. Please send it to the OEM yourself.`); return }

  const { data: saved } = await db.from('master_mail_templates').select('subject, body_html').eq('org_id', orgId).eq('kind', p.kind).maybeSingle()
  const tpl = resolveTemplate(saved, p.kind)
  const rendered = renderMasterMail(tpl, {
    ticket_no: request.request_no,
    subject: p.reopen ? `REOPENED: ${p.title}` : p.title,
    description: p.reopen
      ? `This ticket was RESOLVED earlier and the store has REOPENED it, so the issue is not fixed yet. Reason given by the store: ${p.reopen.reason || '(none given)'}

Original issue: ${p.description || '(no description provided)'}`
      : p.description || '(no description provided)',
    requester_name: p.requesterName,
    requester_email: p.requesterEmail,
    requester_phone: p.requesterPhone || '(not provided)',
    store_address: p.storeAddress || '(no address on file)',
    store_code: p.storeCode,
    category: p.categoryName || '(no category)',
    ...vars,
  })
  // a reopened ticket is easy to spot in the OEM's inbox: the subject starts with REOPENED
  const mail = p.reopen ? { ...rendered, subject: `REOPENED - ${rendered.subject}` } : rendered

  // ONE e-mail to every OEM address (company staff copied), so the OEM's people can all see it and reply-all.
  const sent = await sendEmail({ to: target.to, cc: target.cc, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: request.request_no })
  if (sent.error) {
    await note(`The automatic e-mail to the ${label} OEM could not be sent. Please send this ticket to them yourself.`)
    return
  }
  if (!p.reopen) await saveMasterSnapshot(admin, { requestId: request.id, kind: p.kind, units, to: target.to, cc: target.cc })

  await admin.from('request_comments').insert({
    request_id: request.id, author_id: p.actorId, is_internal: false,
    body: masterSentComment({ label, to: target.to, cc: target.cc, subject: mail.subject, body: mail.text }),
  })

  // A ticket a Business Rule gave to a vendor technician stays Open: the vendor starts it himself (with the OEM ticket number).
  if (await isAssignedToVendor(request.id)) return

  // Conditioned on Open: a Business Rule may already have moved the ticket.
  const { data: moved } = await admin
    .from('requests')
    .update(p.reopen ? { status: 'in_progress' } : { status: 'in_progress', responded_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'open')
    .select('id')
    .maybeSingle()
  if (moved) {
    await logActivity({ requestId: request.id, actorId: p.actorId, action: 'status_changed', metadata: { from: 'open', to: 'in_progress', automated: true, oem: label } })
  }
}

// A reopened ticket is a ticket that is not fixed, so the OEM is told again, exactly like a new ticket (same OEM, same unit, subject marked REOPENED).
// Called by the status change after a RESOLVED ticket goes back to Open. Does nothing for tickets that were never sent to an OEM by the sheets. Never throws.
export async function resendOemOnReopen(p: { requestId: string; actorId: string; reason: string }): Promise<void> {
  try {
    const admin = createAdminClient()
    const db = admin as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: r } = await db.from('requests')
      .select('id, request_no, org_id, title, description, form_data, form_sections_snapshot, requester_id, category_id, service_id')
      .eq('id', p.requestId).maybeSingle()
    if (!r) return
    const [{ data: cat }, { data: svc }, { data: snaps }] = await Promise.all([
      r.category_id ? db.from('service_categories').select('name, auto_oem_kind').eq('id', r.category_id).maybeSingle() : Promise.resolve({ data: null }),
      r.service_id ? db.from('services').select('auto_oem_routing').eq('id', r.service_id).maybeSingle() : Promise.resolve({ data: null }),
      db.from('request_master_snapshots').select('kind, snapshot').eq('request_id', r.id),
    ])
    const kind: MailKind | null = cat?.auto_oem_kind === 'ac' || cat?.auto_oem_kind === 'genset' ? cat.auto_oem_kind : svc?.auto_oem_routing ? 'ac' : null
    if (!kind) return
    const { data: prof } = await db.from('profiles').select('full_name, store_id').eq('id', r.requester_id).maybeSingle()
    let storeCode: string | null = null
    let storeAddress: string | null = null
    if (prof?.store_id) {
      const { data: st } = await db.from('stores').select('code, address').eq('id', prof.store_id).maybeSingle()
      storeCode = st?.code ? String(st.code).toUpperCase() : null
      storeAddress = st?.address ?? null
    }
    const { data: authUser } = await admin.auth.admin.getUserById(r.requester_id)
    // description and phone come from the form the store filled in (the same fields the first e-mail used)
    const sections = (Array.isArray(r.form_sections_snapshot) ? r.form_sections_snapshot : []) as { fields?: { id: string; type: string }[] }[]
    const fields = sections.flatMap((s) => s.fields ?? [])
    const data = (r.form_data ?? {}) as Record<string, unknown>
    const textarea = fields.find((f) => f.type === 'textarea')
    const phone = fields.find((f) => f.type === 'phone')
    const unit = kind === 'ac' ? ((snaps ?? []).find((s: { kind: string }) => s.kind === 'ac')?.snapshot as AcUnitRecord[] | undefined)?.[0] ?? null : null
    await runMasterOemRouting({
      admin, actorId: p.actorId, orgId: r.org_id, request: { id: r.id, request_no: r.request_no }, kind, storeCode,
      quiet: !(cat?.auto_oem_kind === 'ac' || cat?.auto_oem_kind === 'genset'), categoryName: cat?.name ?? null,
      title: r.title, description: r.description || (textarea ? String(data[textarea.id] ?? '').trim() : ''),
      requesterName: prof?.full_name ?? '', requesterEmail: authUser?.user?.email ?? '', requesterPhone: phone ? String(data[phone.id] ?? '').trim() : '',
      storeAddress, reopen: { unit, reason: p.reason },
    })
  } catch (e) {
    console.error('[resendOemOnReopen] failed', e)
  }
}
