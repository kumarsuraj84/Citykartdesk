import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { sendEmail } from '@/lib/email/send'
import { acMailTarget, loadActiveAcUnits, type AcUnitRecord } from '@/lib/masters/resolve'
import { masterSentComment, renderMasterMail, resolveTemplate } from '@/lib/masters/mail'
import { clip } from './constants'
import { resolveTicketForVisit } from './tickets'

type Admin = ReturnType<typeof createAdminClient>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (a: Admin) => a as unknown as { from: (t: string) => any }

export type VisitItemRow = {
  id: string; org_id: string; report_id: string; store_code: string; ac_unit_id: string | null; ckdesk_no: string; ac_details: string | null; request_ids: string[]
  engineer_status: 'resolved' | 'not_resolved'; reason: string | null; engineer_remarks: string | null
  store_status: string | null; outcome: string; po_status: string | null
}
type ReportRow = { id: string; engineer_name: string; engineer_mobile: string; visit_date: string; is_void: boolean }

/** The outcome after the store's answer. This is the whole rule table in one place (tests/unit/visit-rules.test.ts checks every row). */
export function outcomeAfterStoreAnswer(engineer: 'resolved' | 'not_resolved', store: 'resolved' | 'not_resolved'): 'resolved_both' | 'resolved_by_store' | 'disputed' | 'open' {
  if (store === 'resolved') return engineer === 'resolved' ? 'resolved_both' : 'resolved_by_store'
  return engineer === 'resolved' ? 'disputed' : 'open'
}

export type ConfirmResult = { ok: true; outcome: string; resolvedTickets: number; oemMailed: boolean } | { ok: false; error: string }

/** The store's answer for one AC of an engineer's report. The caller has already checked that this person belongs to the item's store. */
export async function applyStoreAnswer(admin: Admin, p: {
  itemId: string; decision: 'resolved' | 'not_resolved'; remarks: string; actor: { id: string; fullName: string }
}): Promise<ConfirmResult> {
  const db = loose(admin)
  const { data: item } = await db.from('ac_visit_items').select('*').eq('id', p.itemId).maybeSingle()
  const it = item as VisitItemRow | null
  if (!it) return { ok: false, error: 'This visit report was not found.' }
  if (!['pending_store', 'open'].includes(it.outcome)) return { ok: false, error: 'This report has already been answered.' }
  const { data: rep } = await db.from('ac_visit_reports').select('id, engineer_name, engineer_mobile, visit_date, is_void').eq('id', it.report_id).maybeSingle()
  const report = rep as ReportRow | null
  if (!report || report.is_void) return { ok: false, error: 'This report was marked wrong and cannot be answered.' }

  const remarks = clip(p.remarks, 500)
  if (p.decision === 'not_resolved' && remarks.length < 3) return { ok: false, error: 'Please write in the remarks what is still wrong.' }
  const outcome = outcomeAfterStoreAnswer(it.engineer_status, p.decision)
  const nowIso = new Date().toISOString()

  // Claim the answer first, so two people (or two clicks) cannot answer the same report twice.
  const { data: claimed } = await db.from('ac_visit_items')
    .update({ store_status: p.decision, store_remarks: remarks || null, store_decided_by: p.actor.id, store_decided_at: nowIso, outcome, auto_resolve_at: null, ...(p.decision === 'resolved' && it.po_status ? { po_status: 'done' } : {}) })
    .eq('id', it.id).in('outcome', ['pending_store', 'open']).select('id').maybeSingle()
  if (!claimed) return { ok: false, error: 'This report has just been answered by someone else.' }

  let resolvedTickets = 0
  let oemMailed = false
  const ac = `AC ${it.ckdesk_no}`
  if (p.decision === 'resolved') {
    const note = `${p.actor.fullName} (store) confirmed that ${ac} is resolved after the visit of engineer ${report.engineer_name} on ${report.visit_date}.${remarks ? ` Store remarks: ${remarks}` : ''}`
    for (const id of it.request_ids) if (await resolveTicketForVisit(admin, { requestId: id, actorId: p.actor.id, actorName: p.actor.fullName, via: 'store', note })) resolvedTickets++
  } else {
    const note = `${p.actor.fullName} (store) says ${ac} is NOT resolved after the visit of engineer ${report.engineer_name} on ${report.visit_date}. Store remarks: ${remarks}`
    for (const id of it.request_ids) await db.from('request_comments').insert({ request_id: id, author_id: p.actor.id, body: note, is_internal: false })
    if (outcome === 'disputed') oemMailed = await mailOemToRevisit(admin, it, report, remarks, p.actor)
    // the technician hears of a disagreement
    const { data: tickets } = await db.from('requests').select('id, request_no, assigned_to').in('id', it.request_ids)
    for (const tech of [...new Set(((tickets ?? []) as { assigned_to: string | null }[]).map((t) => t.assigned_to).filter((x): x is string => !!x))]) {
      notify({ recipientId: tech, actorId: p.actor.id, type: 'status_changed', requestId: it.request_ids[0], link: '/visits', title: `Store says ${ac} at ${it.store_code} is not resolved`, body: remarks }).catch(() => {})
    }
  }
  return { ok: true, outcome, resolvedTickets, oemMailed }
}

/** Sends the one e-mail that tells the OEM its engineer said "resolved" but the store disagrees, and leaves a note in every ticket. */
async function mailOemToRevisit(admin: Admin, it: VisitItemRow, report: ReportRow, storeRemarks: string, actor: { id: string; fullName: string }): Promise<boolean> {
  const db = loose(admin)
  const { data: tickets } = await db.from('requests').select('id, request_no, org_id').in('id', it.request_ids)
  const nos = ((tickets ?? []) as { request_no: string }[]).map((t) => t.request_no)
  const note = async (body: string, internal: boolean) => { for (const id of it.request_ids) await db.from('request_comments').insert({ request_id: id, author_id: actor.id, body, is_internal: internal }) }

  const units = await loadActiveAcUnits(db, it.org_id, it.store_code)
  const selected: AcUnitRecord | null = units.find((u) => u.id === it.ac_unit_id) ?? null
  const target = acMailTarget(units, selected)
  if (!target) { await note(`The store says ${it.ckdesk_no} is not resolved, but the AC sheet has no e-mail address for this store, so the OEM could not be asked to send an engineer again. Please contact the OEM yourself.`, true); return false }

  const { data: saved } = await db.from('master_mail_templates').select('subject, body_html').eq('org_id', it.org_id).eq('kind', 'revisit').maybeSingle()
  const { data: store } = await db.from('stores').select('address').eq('org_id', it.org_id).eq('code', it.store_code).maybeSingle()
  const mail = renderMasterMail(resolveTemplate(saved, 'revisit'), {
    ticket_no: nos.join(', '), store_code: it.store_code, store_address: store?.address || '(no address on file)', ac_number: it.ckdesk_no, ac_details: it.ac_details || '',
    engineer_name: report.engineer_name, engineer_mobile: report.engineer_mobile, visit_date: report.visit_date, engineer_remarks: it.engineer_remarks || '(none)', store_remarks: storeRemarks,
  })
  const sent = await sendEmail({ to: target.to, cc: target.cc, subject: mail.subject, html: mail.html, text: mail.text, threadRequestNo: nos[0] })
  if (sent.error) { await note('The e-mail asking the OEM to send an engineer again could not be sent. Please contact the OEM yourself.', true); return false }
  await db.from('ac_visit_items').update({ oem_notified_at: new Date().toISOString() }).eq('id', it.id)
  await note(masterSentComment({ label: 'AC', to: target.to, cc: target.cc, subject: mail.subject, body: mail.text }).replace('Ticket sent to the AC OEM for servicing.', 'The OEM was asked to send an engineer again (the engineer said resolved, the store says not resolved).'), false)
  return true
}
