import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { sendEmail } from '@/lib/email/send'
import { splitRecipients } from '@/lib/masters/emails'
import { isHtmlTemplate, plainToHtml } from '@/lib/email/oem-template'
import { masterSentComment, renderMasterMail } from '@/lib/masters/mail'
import { programTemplate, programVars, type ProgramRowRecord } from './mail'
import { programNoteLabel, type ProgramRecord } from './types'
import { isAssignedToVendor } from '@/lib/vendor/ticket-fields'
import { findSelectedMachine } from './machines'

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

/** The rows a ticket was first mailed for (saved with the ticket); empty when there is no saved copy or it holds no address. */
export async function loadSnapshotRows(db: Db, requestId: string, programId: string): Promise<ProgramRowRecord[]> {
  const { data } = await db.from('request_program_snapshots').select('snapshot').eq('request_id', requestId).eq('program_id', programId).maybeSingle()
  const rows = (Array.isArray(data?.snapshot) ? data.snapshot : []) as ProgramRowRecord[]
  return rows.some((r) => (r.emails ?? []).length > 0) ? rows : []
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
  /** The machine the requester chose (one row per machine): the mail names only it and the ticket keeps only that row. */
  machineValue?: string
  /** Set when a reopened ticket is sent to the vendor again: the reason the store gave. */
  reopen?: { reason: string }
}): Promise<void> {
  const { admin, orgId, request, program } = p
  if (!program.is_active) return
  const db = admin as unknown as Db
  const label = programNoteLabel(program.name)
  const note = async (body: string) => { await admin.from('request_comments').insert({ request_id: request.id, author_id: p.actorId, body, is_internal: true }) }
  // a reopened ticket goes to the SAME vendor as the first time (the rows saved with the ticket), even when the sheet has changed since (for example the warranty ended)
  const saved = p.reopen ? await loadSnapshotRows(db, request.id, program.id) : []
  if (!p.storeCode && saved.length === 0) { await note(`This requester is not linked to a store, so the ticket was not sent to the ${label} vendor automatically. Please send it to them yourself.`); return }

  const allRows = saved.length > 0 ? saved : await loadActiveProgramRows(db, orgId, program.id, p.storeCode ?? '')
  // the machine the requester chose: only that row is mailed and kept with the ticket (when it has no address, the addresses of the store's other machines are used)
  const chosenRow = !p.reopen && p.machineValue ? findSelectedMachine(allRows, p.machineValue) : null
  const rows = chosenRow ? [chosenRow] : allRows
  if (rows.length === 0) { await note(`Store ${p.storeCode} has no active row in the ${label} sheet, so the ticket was not sent to the vendor automatically. Please send it to them yourself.`); return }
  const pool = chosenRow && chosenRow.emails.length === 0 ? allRows.flatMap((r) => r.emails) : rows.flatMap((r) => r.emails)
  const target = splitRecipients(pool)

  // The rows the ticket belongs to are saved FIRST, so the vendor portal, the quote / PO approval and a later reopen work from them even when the mail cannot be sent.
  if (!p.reopen) {
    await db.from('request_program_snapshots').upsert(
      { request_id: request.id, program_id: program.id, row_ids: rows.map((r) => r.id), snapshot: rows as unknown, mailed_to: target.to, mailed_cc: target.cc },
      { onConflict: 'request_id,program_id' },
    )
    // level "portal": who gets the ticket is decided in CK Desk only (Business Rules assign a vendor technician, as they do for Citykart technicians, or Citykart staff assign it by
    // hand): nothing in the sheet routes a ticket. The Business Rules have already run when the ticket was created, so a ticket still without a vendor technician says so.
    if (program.level === 'portal' && !(await isAssignedToVendor(request.id))) {
      await note(`The ${label} ticket is for the vendor portal but no vendor technician has it yet. Assign it to a vendor technician (or create a Business Rule that does it for tickets like this).`)
    }
  }
  if (pool.length === 0) { await note(`The ${label} sheet has no e-mail address for store ${p.storeCode}, so the ticket was not sent to the vendor automatically. Please send it to them yourself.`); return }

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
    store_code: p.storeCode ?? rows[0]?.store_code ?? '',
    category: p.categoryName || '(no category)',
    ...programVars(program, rows),
  })
  const mail = p.reopen ? { ...rendered, subject: `REOPENED - ${rendered.subject}` } : rendered

  const sent = await sendEmail({ to: target.to, cc: target.cc, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: request.request_no })
  if (sent.error) { await note(`The automatic e-mail to the ${label} vendor could not be sent. Please send this ticket to them yourself.`); return }
  await admin.from('request_comments').insert({
    request_id: request.id, author_id: p.actorId, is_internal: false,
    body: masterSentComment({ label, to: target.to, cc: target.cc, subject: mail.subject, html: mail.html }),
  })

  if (program.level !== 'mail') return   // "portal": the ticket stays Open for the vendor technician it was given to
  const { data: moved } = await admin
    .from('requests')
    .update(p.reopen ? { status: 'in_progress' } : { status: 'in_progress', responded_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'open')
    .select('id')
    .maybeSingle()
  if (moved) await logActivity({ requestId: request.id, actorId: p.actorId, action: 'status_changed', metadata: { from: 'open', to: 'in_progress', automated: true, oem: label } })
}
