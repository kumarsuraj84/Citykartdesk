import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { sendEmail } from '@/lib/email/send'
import { splitRecipients } from '@/lib/masters/emails'
import { isHtmlTemplate, plainToHtml } from '@/lib/email/oem-template'
import { masterSentComment, renderMasterMail } from '@/lib/masters/mail'
import { programTemplate, programVars, type ProgramRowRecord } from './mail'
import { programNoteLabel, type ProgramRecord } from './types'

// Sends a ticket to the vendor / OEM of a program, right after the ticket is created (and again, marked REOPENED, when the store reopens it). Same rules as the AC /
// Genset routing (lib/requests/master-routing.ts):
//  - ONE e-mail to every address of the store's rows (company addresses are copied, the vendor's are in To);
//  - level "mail": the ticket goes to In Progress; level "portal": the ticket stays Open for the vendor's technician (Phase 2);
//  - anything missing (store not linked, not in the sheet, no address) leaves the ticket Open as a normal ticket with an internal note for the technician;
//  - a program that is switched off does nothing at all.
// Uses the server's client: a system action with no interactive person.

type Admin = ReturnType<typeof createAdminClient>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

const ROW_COLUMNS = 'id, store_code, machine_no, serial, vendor, emails, po_emails, approver_emails, extra, is_active, sheet_row'

export async function loadProgram(db: Db, orgId: string, id: string): Promise<ProgramRecord | null> {
  const { data } = await db.from('vendor_programs').select('*').eq('org_id', orgId).eq('id', id).maybeSingle()
  return (data as ProgramRecord | null) ?? null
}

export async function loadActiveProgramRows(db: Db, orgId: string, programId: string, storeCode: string): Promise<ProgramRowRecord[]> {
  const { data } = await db.from('program_rows').select(ROW_COLUMNS).eq('org_id', orgId).eq('program_id', programId).eq('store_code', storeCode.toUpperCase()).eq('is_active', true).is('removed_at', null).order('sheet_row', { ascending: true })
  return (data ?? []) as ProgramRowRecord[]
}

export async function runProgramRouting(p: {
  admin: Admin
  actorId: string
  orgId: string
  request: { id: string; request_no: string }
  program: ProgramRecord
  storeCode: string | null
  categoryName?: string | null
  title: string
  description: string
  requesterName: string
  requesterEmail: string
  requesterPhone: string
  storeAddress: string | null
  /** Set when a reopened ticket is sent to the vendor again: the reason the store gave. */
  reopen?: { reason: string }
}): Promise<void> {
  const { admin, orgId, request, program } = p
  if (!program.is_active) return
  const db = admin as unknown as Db
  const label = programNoteLabel(program.name)
  const note = async (body: string) => { await admin.from('request_comments').insert({ request_id: request.id, author_id: p.actorId, body, is_internal: true }) }
  if (!p.storeCode) { await note(`This requester is not linked to a store, so the ticket was not sent to the ${label} vendor automatically. Please send it to them yourself.`); return }

  const rows = await loadActiveProgramRows(db, orgId, program.id, p.storeCode)
  if (rows.length === 0) { await note(`Store ${p.storeCode} has no active row in the ${label} sheet, so the ticket was not sent to the vendor automatically. Please send it to them yourself.`); return }
  const pool = rows.flatMap((r) => r.emails)
  if (pool.length === 0) { await note(`The ${label} sheet has no e-mail address for store ${p.storeCode}, so the ticket was not sent to the vendor automatically. Please send it to them yourself.`); return }
  const target = splitRecipients(pool)

  const tpl = programTemplate(program)
  const rendered = renderMasterMail({ subject: tpl.subject, body: isHtmlTemplate(tpl.body) ? tpl.body : plainToHtml(tpl.body) }, {
    ticket_no: request.request_no,
    subject: p.reopen ? `REOPENED: ${p.title}` : p.title,
    description: p.reopen
      ? `This ticket was RESOLVED earlier and the store has REOPENED it, so the issue is not fixed yet. Reason given by the store: ${p.reopen.reason || '(none given)'}\n\nOriginal issue: ${p.description || '(no description provided)'}`
      : p.description || '(no description provided)',
    requester_name: p.requesterName,
    requester_email: p.requesterEmail,
    requester_phone: p.requesterPhone || '(not provided)',
    store_address: p.storeAddress || '(no address on file)',
    store_code: p.storeCode,
    category: p.categoryName || '(no category)',
    ...programVars(program, rows),
  })
  const mail = p.reopen ? { ...rendered, subject: `REOPENED - ${rendered.subject}` } : rendered

  const sent = await sendEmail({ to: target.to, cc: target.cc, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: request.request_no })
  if (sent.error) { await note(`The automatic e-mail to the ${label} vendor could not be sent. Please send this ticket to them yourself.`); return }
  if (!p.reopen) {
    await db.from('request_program_snapshots').upsert(
      { request_id: request.id, program_id: program.id, row_ids: rows.map((r) => r.id), snapshot: rows as unknown, mailed_to: target.to, mailed_cc: target.cc },
      { onConflict: 'request_id,program_id' },
    )
  }
  await admin.from('request_comments').insert({
    request_id: request.id, author_id: p.actorId, is_internal: false,
    body: masterSentComment({ label, to: target.to, cc: target.cc, subject: mail.subject, html: mail.html }),
  })

  if (program.level !== 'mail') return   // "portal": the ticket stays Open for the vendor's own technician (Phase 2)
  const { data: moved } = await admin
    .from('requests')
    .update(p.reopen ? { status: 'in_progress' } : { status: 'in_progress', responded_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'open')
    .select('id')
    .maybeSingle()
  if (moved) await logActivity({ requestId: request.id, actorId: p.actorId, action: 'status_changed', metadata: { from: 'open', to: 'in_progress', automated: true, oem: label } })
}
