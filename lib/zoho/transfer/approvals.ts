import 'server-only'
/**
 * Moved tickets that were "pending approval" in Zoho: Zoho had sent the approval to a person, but the move only copied the HISTORY, so CK Desk has no approval for the person to act on.
 * This finds who Zoho sent it to and creates the real CK Desk approval for them, with CK Desk's own approval engine (createAdHocApproval), in its "keep the status" form:
 *  - the ticket stays "pending approval" (nothing changes except that the approval now exists, and the status it returns to after approval is remembered);
 *  - ONLY the approver is told (CK Desk's normal "Approval required" notice and its e-mail); the requester and the technician are not;
 *  - a ticket that already has a CK Desk approval is never touched; an approver without a CK Desk account, an inactive one or a store user is refused (the ticket is listed with the reason);
 *  - it is explicit and administrator-only; nothing here runs by itself.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { createAdHocApproval } from '@/lib/approvals/adhoc'
import { storeLinkedAmong } from '@/lib/approvals/store-users'
import { logger } from '@/lib/observability/logger'
import type { RequestStatus } from '@/types'
import { loadPeopleDirectory } from './data'
import { approverEmailsFromLines } from './approval-targets'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
const db = () => createAdminClient() as unknown as AnyClient

export const APPROVAL_BATCH_LIMIT = 25

export type ApprovalTarget = {
  zohoNo: number
  requestNo: string
  requestId: string
  title: string
  approvers: { email: string; id: string | null; name: string | null; problem: string | null }[]
  /** why this ticket cannot be sent (empty = ready) */
  problems: string[]
  ready: boolean
}

const chunks = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

/** The moved tickets that are in "pending approval", with who Zoho sent the approval to and whether CK Desk can send it. `numbers` limits it to those Zoho numbers (the pilot). */
export async function previewMovedApprovals(orgId: string, numbers?: number[]): Promise<ApprovalTarget[]> {
  const d = db()
  let q = d.from('requests').select('id, request_no, title').eq('org_id', orgId).like('request_no', 'ZOHO-%').eq('status', 'pending_approval').order('request_no')
  if (numbers && numbers.length) q = q.in('request_no', numbers.map((n) => `ZOHO-${n}`))
  const { data: reqs } = await q.limit(2000)
  const rows = (reqs ?? []) as { id: string; request_no: string; title: string }[]
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const withApproval = new Set<string>()
  const linesBy = new Map<string, string[]>()
  for (const part of chunks(ids, 50)) {
    const { data: ap } = await d.from('approvals').select('request_id').in('request_id', part)
    for (const a of (ap ?? []) as { request_id: string }[]) withApproval.add(a.request_id)
    const { data: cm } = await d.from('request_comments').select('request_id, body').in('request_id', part).like('body', '%Zoho approval%')
    for (const c of (cm ?? []) as { request_id: string; body: string }[]) linesBy.set(c.request_id, [...(linesBy.get(c.request_id) ?? []), c.body])
  }

  const dir = await loadPeopleDirectory(orgId)
  const allEmails = [...new Set([...linesBy.values()].flatMap((l) => approverEmailsFromLines(l)))]
  const personIds = allEmails.map((e) => dir.byEmail.get(e)?.id).filter((x): x is string => !!x)
  const storeLinked = new Set(await storeLinkedAmong(d as never, personIds))

  return rows.map((r) => {
    const emails = approverEmailsFromLines(linesBy.get(r.id) ?? [])
    const approvers = emails.map((email) => {
      const p = dir.byEmail.get(email)
      let problem: string | null = null
      if (!p) problem = 'has no CK Desk account'
      else if (!p.active) problem = 'is inactive in CK Desk'
      else if (storeLinked.has(p.id)) problem = 'is a store user (a store user cannot approve)'
      return { email, id: p?.id ?? null, name: p?.name ?? null, problem }
    })
    const problems: string[] = []
    if (withApproval.has(r.id)) problems.push('already has an approval in CK Desk')
    if (emails.length === 0) problems.push('Zoho does not say who the approval was sent to')
    for (const a of approvers) if (a.problem) problems.push(`${a.email} ${a.problem}`)
    return { zohoNo: Number(r.request_no.replace('ZOHO-', '')), requestNo: r.request_no, requestId: r.id, title: r.title, approvers, problems, ready: problems.length === 0 }
  })
}

export type SendApprovalResult = { zohoNo: number; requestNo: string; ok: boolean; approverNames: string[]; reason?: string }

/** Creates the CK Desk approval for each READY ticket among `numbers` (re-checked here: the screen's preview is never trusted). */
export async function sendMovedApprovals(args: { orgId: string; actorId: string; actorName: string; numbers: number[] }): Promise<SendApprovalResult[]> {
  const { orgId, actorId, actorName } = args
  const numbers = [...new Set(args.numbers.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, APPROVAL_BATCH_LIMIT)
  if (numbers.length === 0) return []
  const targets = await previewMovedApprovals(orgId, numbers)
  const d = db()
  const out: SendApprovalResult[] = []
  const found = new Set(targets.map((t) => t.zohoNo))
  for (const n of numbers) if (!found.has(n)) out.push({ zohoNo: n, requestNo: `ZOHO-${n}`, ok: false, approverNames: [], reason: 'This ticket is not a moved ticket in "pending approval".' })
  for (const t of targets) {
    if (!t.ready) { out.push({ zohoNo: t.zohoNo, requestNo: t.requestNo, ok: false, approverNames: [], reason: t.problems.join('; ') }); continue }
    try {
      const { data: r } = await d.from('requests').select('id, request_no, title, status, requester_id, org_id, waiting_since').eq('id', t.requestId).maybeSingle()
      if (!r || r.status !== 'pending_approval') { out.push({ zohoNo: t.zohoNo, requestNo: t.requestNo, ok: false, approverNames: [], reason: 'The ticket is no longer in "pending approval".' }); continue }
      const approvers = t.approvers.map((a) => ({ id: a.id as string, full_name: a.name as string }))
      const res = await createAdHocApproval(createAdminClient(), {
        request: { id: r.id, request_no: r.request_no, title: r.title, status: r.status as RequestStatus, requester_id: r.requester_id, org_id: r.org_id, waiting_since: r.waiting_since },
        approvers, senderId: actorId, senderName: actorName, via: 'zoho_transfer', keepStatus: true,
      })
      if (res.error) { out.push({ zohoNo: t.zohoNo, requestNo: t.requestNo, ok: false, approverNames: [], reason: res.error }); continue }
      const names = approvers.map((a) => a.full_name)
      await d.from('request_comments').insert({
        request_id: r.id, author_id: actorId, is_internal: true, source: 'portal',
        body: `APPROVAL SENT FROM CK DESK — Zoho had already sent this ticket for approval to ${t.approvers.map((a) => `${a.name} (${a.email})`).join(', ')}. The approval now also exists in CK Desk, so they can approve or reject it here. The ticket stays in "Pending approval".`,
      })
      out.push({ zohoNo: t.zohoNo, requestNo: t.requestNo, ok: true, approverNames: names })
    } catch (e) {
      logger.error({ event: 'zoho_transfer.approval_failed', message: `Sending the approval of moved ticket ${t.requestNo} failed`, route: 'lib/zoho/transfer/approvals.ts', orgId, errorCode: 'zoho_approval_failed', context: { requestNo: t.requestNo }, error: e })
      out.push({ zohoNo: t.zohoNo, requestNo: t.requestNo, ok: false, approverNames: [], reason: 'Something went wrong. Nothing was kept for this ticket.' })
    }
  }
  return out
}
