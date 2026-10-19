import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { sendEmail } from '@/lib/email/send'
import {
  acMailTarget, findSelectedUnit, gensetMailTarget, loadActiveAcUnits, loadGensetsForStore, type AcUnitRecord, type GensetRecord, type MailTarget,
} from '@/lib/masters/resolve'
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
    const selected = findSelectedUnit(active, p.chosenAcValue)
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
  const mail = renderMasterMail(tpl, {
    ticket_no: request.request_no,
    subject: p.title,
    description: p.description || '(no description provided)',
    requester_name: p.requesterName,
    requester_email: p.requesterEmail,
    requester_phone: p.requesterPhone || '(not provided)',
    store_address: p.storeAddress || '(no address on file)',
    store_code: p.storeCode,
    category: p.categoryName || '(no category)',
    ...vars,
  })

  // ONE e-mail to every OEM address (company staff copied), so the OEM's people can all see it and reply-all.
  const sent = await sendEmail({ to: target.to, cc: target.cc, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: request.request_no })
  if (sent.error) {
    await note(`The automatic e-mail to the ${label} OEM could not be sent. Please send this ticket to them yourself.`)
    return
  }
  await saveMasterSnapshot(admin, { requestId: request.id, kind: p.kind, units, to: target.to, cc: target.cc })

  await admin.from('request_comments').insert({
    request_id: request.id, author_id: p.actorId, is_internal: false,
    body: masterSentComment({ label, to: target.to, cc: target.cc, subject: mail.subject, body: mail.text }),
  })

  // Conditioned on Open: a Business Rule may already have moved the ticket.
  const { data: moved } = await admin
    .from('requests')
    .update({ status: 'in_progress', responded_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'open')
    .select('id')
    .maybeSingle()
  if (moved) {
    await logActivity({ requestId: request.id, actorId: p.actorId, action: 'status_changed', metadata: { from: 'open', to: 'in_progress', automated: true, oem: label } })
  }
}
