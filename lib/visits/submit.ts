import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { loadOpenAcIssues, type AcIssue } from './issues'
import { getVisitSettings } from './settings'
import { holdTicketForPurchase, releaseTicketFromHold } from './tickets'
import { clip, MAX_PARTS, NOT_RESOLVED_REASONS, REASON_LABEL, type NotResolvedReason, type Part } from './constants'
import { istDay } from './code'

type Admin = ReturnType<typeof createAdminClient>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (a: Admin) => a as unknown as { from: (t: string) => any; storage: Admin['storage'] }

export type EngineerItemInput = {
  unitId: string
  status: 'resolved' | 'not_resolved'
  reason?: string | null
  parts?: { name?: unknown; qty?: unknown }[]
  remarks?: string | null
}
export type EngineerFile = { name: string; mimeType: string; bytes: Buffer }

export type EngineerReportInput = {
  orgId: string
  storeCode: string
  engineerName: string
  engineerMobile: string
  visitDate: string
  items: EngineerItemInput[]
  files: EngineerFile[]
  ipHash?: string | null
  now?: Date
}

export type SubmitResult =
  | { ok: true; reportId: string; items: { ckdeskNo: string; tickets: string[]; resolved: boolean }[] }
  | { ok: false; error: string }

const MOBILE = /^[6-9]\d{9}$/

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 80) || 'fsr'
}

function cleanParts(raw: EngineerItemInput['parts']): Part[] | { error: string } {
  const out: Part[] = []
  for (const p of raw ?? []) {
    const name = clip(p?.name, 80)
    if (!name) continue
    const qty = Math.round(Number(p?.qty ?? 1))
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) return { error: `Part "${name}": the quantity must be a number from 1 to 999.` }
    out.push({ name, qty })
  }
  if (out.length > MAX_PARTS) return { error: `At most ${MAX_PARTS} parts can be listed for one AC.` }
  return out
}

export const partsText = (parts: Part[]) => parts.map((p) => `${p.name} x ${p.qty}`).join(', ')

/** Saves an engineer's visit report: the report, one item per AC, the FSR photos and a conversation entry on every ticket of those ACs. */
export async function submitEngineerReport(admin: Admin, input: EngineerReportInput): Promise<SubmitResult> {
  const db = loose(admin)
  const now = input.now ?? new Date()
  const name = clip(input.engineerName, 80)
  const mobile = String(input.engineerMobile ?? '').replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')
  if (name.length < 2) return { ok: false, error: 'Please enter the engineer\'s name.' }
  if (!MOBILE.test(mobile)) return { ok: false, error: 'Please enter the engineer\'s 10-digit mobile number.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.visitDate)) return { ok: false, error: 'Please enter the visit date.' }
  const today = istDay(now)
  const oldest = istDay(new Date(now.getTime() - 60 * 86400_000))
  if (input.visitDate > today) return { ok: false, error: 'The visit date cannot be in the future.' }
  if (input.visitDate < oldest) return { ok: false, error: 'The visit date is too old (more than 60 days).' }
  if (input.items.length === 0) return { ok: false, error: 'Choose at least one AC and say whether its issue is resolved.' }
  if (input.files.length === 0) return { ok: false, error: 'Please attach a photo of the signed FSR.' }

  const issues = await loadOpenAcIssues(db, input.orgId, input.storeCode)
  const byUnit = new Map<string, AcIssue>(issues.map((i) => [i.unitId, i]))
  const seen = new Set<string>()
  type Prepared = { issue: AcIssue; status: 'resolved' | 'not_resolved'; reason: NotResolvedReason | null; parts: Part[]; remarks: string }
  const prepared: Prepared[] = []
  for (const it of input.items) {
    const issue = byUnit.get(String(it.unitId))
    if (!issue) return { ok: false, error: 'One of the ACs is no longer open for this store. Please reload the page.' }
    if (seen.has(issue.unitId)) return { ok: false, error: `AC ${issue.ckdeskNo} is listed twice.` }
    seen.add(issue.unitId)
    if (it.status !== 'resolved' && it.status !== 'not_resolved') return { ok: false, error: `AC ${issue.ckdeskNo}: choose Resolved or Not resolved.` }
    let reason: NotResolvedReason | null = null
    let parts: Part[] = []
    if (it.status === 'not_resolved') {
      if (!(NOT_RESOLVED_REASONS as readonly string[]).includes(String(it.reason))) return { ok: false, error: `AC ${issue.ckdeskNo}: say why it is not resolved.` }
      reason = it.reason as NotResolvedReason
      const cleaned = cleanParts(it.parts)
      if ('error' in cleaned) return { ok: false, error: `AC ${issue.ckdeskNo}: ${cleaned.error}` }
      parts = cleaned
      if ((reason === 'parts_po' || reason === 'parts_oem') && parts.length === 0) return { ok: false, error: `AC ${issue.ckdeskNo}: list the parts that are needed.` }
      if (reason === 'other' && clip(it.remarks, 500).length < 3) return { ok: false, error: `AC ${issue.ckdeskNo}: please write the reason in the remarks.` }
    }
    prepared.push({ issue, status: it.status, reason, parts, remarks: clip(it.remarks, 500) })
  }

  const settings = await getVisitSettings(db, input.orgId)
  const { data: report, error: reportError } = await db.from('ac_visit_reports').insert({
    org_id: input.orgId, store_code: input.storeCode.toUpperCase(), engineer_name: name, engineer_mobile: mobile, visit_date: input.visitDate, submitted_at: now.toISOString(), source_ip_hash: input.ipHash ?? null,
  }).select('id').single()
  if (reportError || !report) return { ok: false, error: 'The report could not be saved. Please try again.' }

  const summary: { ckdeskNo: string; tickets: string[]; resolved: boolean }[] = []
  for (const p of prepared) {
    const resolved = p.status === 'resolved'
    const autoResolveAt = resolved ? new Date(now.getTime() + settings.autoResolveHours * 3_600_000).toISOString() : null
    // a newer report replaces an older one for the same AC that nobody has answered yet
    await db.from('ac_visit_items').update({ outcome: 'void' }).eq('org_id', input.orgId).eq('ac_unit_id', p.issue.unitId).eq('outcome', 'pending_store')

    const lines = [
      'OEM engineer visit report (entered by the engineer on the visit page)',
      `Engineer: ${name}, mobile ${mobile}`,
      `Visit date: ${input.visitDate}`,
      `AC ${p.issue.ckdeskNo}${p.issue.details ? ` (${p.issue.details})` : ''}`,
      resolved ? 'Engineer\'s result: Resolved' : `Engineer's result: ${REASON_LABEL[p.reason!]}`,
      ...(p.parts.length ? [`Parts: ${partsText(p.parts)}`] : []),
      ...(p.remarks ? [`Remarks: ${p.remarks}`] : []),
      resolved ? `The store is asked to confirm. If it does not answer within ${settings.autoResolveHours} hours the ticket is resolved automatically.` : 'The ticket stays open.',
    ]
    const fsr: { attachmentId: string; requestId: string; fileName: string }[] = []
    for (const t of p.issue.tickets) {
      const { data: comment } = await db.from('request_comments').insert({ request_id: t.id, author_id: t.requesterId, body: lines.join('\n'), is_internal: false }).select('id').single()
      for (const f of input.files) {
        const path = `${t.id}/${now.getTime()}_${Math.random().toString(36).slice(2, 8)}_${safeName(f.name)}`
        const up = await admin.storage.from('request-attachments').upload(path, f.bytes, { contentType: f.mimeType, upsert: false })
        if (up.error) { console.error('[visits] FSR upload failed', up.error.message); continue }
        const { data: att, error: attError } = await db.from('request_attachments').insert({
          request_id: t.id, comment_id: comment?.id ?? null, uploaded_by: t.requesterId, file_name: f.name.slice(0, 200), file_size: f.bytes.length, mime_type: f.mimeType, storage_path: path, is_internal: false,
        }).select('id').single()
        if (attError || !att) { await admin.storage.from('request-attachments').remove([path]); continue }
        if (t.id === p.issue.tickets[0].id) fsr.push({ attachmentId: att.id, requestId: t.id, fileName: f.name })
      }
      // parts that Citykart must order: the ticket waits for the purchase; any other finding takes a ticket off an earlier hold
      if (!resolved && p.reason === 'parts_po') await holdTicketForPurchase(admin, { requestId: t.id, actorId: t.requesterId, note: `Parts needed after the visit of ${name}: ${partsText(p.parts)}` })
      else if (t.status === 'hold_purchase_ho') await releaseTicketFromHold(admin, { requestId: t.id, actorId: t.requesterId, note: `New visit report from ${name}` })
    }

    await db.from('ac_visit_items').insert({
      org_id: input.orgId, report_id: report.id, store_code: input.storeCode.toUpperCase(), ac_unit_id: p.issue.unitId, ckdesk_no: p.issue.ckdeskNo,
      ac_details: [p.issue.details, p.issue.serial ? `serial ${p.issue.serial}` : ''].filter(Boolean).join(', ') || null,
      request_ids: p.issue.tickets.map((t) => t.id), engineer_status: p.status, reason: p.reason, parts: p.parts, engineer_remarks: p.remarks || null, fsr,
      outcome: resolved ? 'pending_store' : 'open', auto_resolve_at: autoResolveAt, po_status: !resolved && p.reason === 'parts_po' ? 'to_raise' : null,
    })

    const requesters = [...new Set(p.issue.tickets.map((t) => t.requesterId))]
    for (const rid of requesters) {
      notify({
        recipientId: rid, actorId: null, type: 'comment_added', requestId: p.issue.tickets[0].id, link: '/ac-visits',
        title: resolved ? `OEM engineer reports AC ${p.issue.ckdeskNo} resolved - please confirm` : `OEM engineer visited AC ${p.issue.ckdeskNo} - not resolved`,
        body: resolved ? `Please check and confirm within ${settings.autoResolveHours} hours.` : REASON_LABEL[p.reason!],
      }).catch(() => {})
    }
    if (!resolved && p.reason === 'parts_po') {
      for (const tech of [...new Set(p.issue.tickets.map((t) => t.assignedTo).filter((x): x is string => !!x))]) {
        notify({
          recipientId: tech, actorId: null, type: 'status_changed', requestId: p.issue.tickets[0].id, link: '/visits',
          title: `Parts to order for AC ${p.issue.ckdeskNo} at ${input.storeCode.toUpperCase()}`, body: `Engineer ${name}: ${partsText(p.parts)}`,
        }).catch(() => {})
      }
    }
    summary.push({ ckdeskNo: p.issue.ckdeskNo, tickets: p.issue.tickets.map((t) => t.requestNo), resolved })
  }
  return { ok: true, reportId: report.id, items: summary }
}
