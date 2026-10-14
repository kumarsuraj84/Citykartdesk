// What an approval link should show right now. The link never goes stale on its own: it is simply read against the live approval,
// so it stops working the moment the request is approved or rejected (on the portal or from the e-mail), when another approver has
// already decided, or when the approval moved to someone else.

import { resolveApprovalContextFor, type ApprovalDb } from '@/lib/approvals/decision'
import { pdfDateTime } from '@/lib/requests/ticket-pdf-model'
import { linkIsExpired, type VerifiedLink } from '@/lib/approvals/email-link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export interface PendingDetail {
  priority: string
  requesterName: string
  sentByName: string
  service: string
  category: string
  description: string
  created: string
  conversation: { author: string; at: string; body: string }[]
}

interface Common { requestNo: string; title: string; sentTo: string[]; approverName: string }

export type LinkState =
  | { kind: 'invalid' }
  | ({ kind: 'decided'; outcome: 'approved' | 'rejected'; by: string; at: string; comment: string | null } & Common)
  | ({ kind: 'closed' } & Common)
  | ({ kind: 'expired' } & Common)
  | ({ kind: 'own_request' } & Common)
  | ({ kind: 'already_by_you'; at: string } & Common)
  | ({ kind: 'not_current'; waitingOn: string[] } & Common)
  | ({ kind: 'pending'; approverId: string; detail: PendingDetail } & Common)

const clip = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/\r\n?/g, '\n').trim(); return t.length > n ? `${t.slice(0, n)} ...` : t }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export async function describeApprovalLink(admin: AnyClient, approvalId: string, approverId: string, link?: Pick<VerifiedLink, 'expiresAt' | 'expired'>): Promise<LinkState> {
  const { data: approval } = await admin.from('approvals').select('id, request_id, workflow_id, current_step, status, requested_by, created_at').eq('id', approvalId).maybeSingle()
  const { data: me } = await admin.from('profiles').select('id, full_name, role, is_active').eq('id', approverId).maybeSingle()
  if (!approval || !me || !me.is_active) return { kind: 'invalid' }

  const [{ data: steps }, { data: decisions }, { data: req }] = await Promise.all([
    admin.from('approval_workflow_steps').select('step_order, approver_type, approver_user_id, approver:profiles!approval_workflow_steps_approver_user_id_fkey(full_name)').eq('workflow_id', approval.workflow_id).order('step_order', { ascending: true }),
    admin.from('approval_decisions').select('step_order, decided_by, decision, comment, decided_at, decider:profiles!approval_decisions_decided_by_fkey(full_name)').eq('approval_id', approvalId).order('decided_at', { ascending: true }),
    admin.from('requests').select('request_no, title, status, priority, description, created_at, requester:profiles!requests_requester_id_fkey(full_name), service:services(name), category:service_categories(name), sub_category:service_sub_categories(name)').eq('id', approval.request_id).maybeSingle(),
  ])
  if (!req) return { kind: 'invalid' }

  type Step = { step_order: number; approver_type: string; approver_user_id: string | null; approver: { full_name: string } | { full_name: string }[] | null }
  type Dec = { step_order: number; decided_by: string; decision: string; comment: string | null; decided_at: string; decider: { full_name: string } | { full_name: string }[] | null }
  const stepList = (steps ?? []) as Step[]
  const decList = (decisions ?? []) as Dec[]
  const nameOf = (s: Step) => (s.approver_type === 'any_manager' ? 'any manager' : (one(s.approver)?.full_name ?? 'an approver'))
  const sentTo = [...new Set(stepList.map(nameOf))]
  const common: Common = { requestNo: req.request_no, title: req.title, sentTo, approverName: me.full_name }

  if (approval.status === 'approved' || approval.status === 'rejected') {
    const last = decList[decList.length - 1]
    return { kind: 'decided', ...common, outcome: approval.status, by: one(last?.decider)?.full_name ?? 'an approver', at: pdfDateTime(last?.decided_at), comment: last?.comment ?? null }
  }
  if (approval.status !== 'pending' || req.status === 'cancelled' || req.status === 'closed') return { kind: 'closed', ...common }

  // a link that is past its time no longer lets anyone decide from the e-mail (the request can still be decided in Citykart Desk)
  if (link && linkIsExpired(link, approval.created_at)) return { kind: 'expired', ...common }

  const ctx = await resolveApprovalContextFor(approvalId, { id: me.id, role: me.role, full_name: me.full_name }, admin as unknown as ApprovalDb)
  if ('error' in ctx) {
    if ('reason' in ctx && ctx.reason === 'own_request') return { kind: 'own_request', ...common }
    const mine = decList.find((d) => d.decided_by === approverId)
    if (mine) return { kind: 'already_by_you', ...common, at: pdfDateTime(mine.decided_at) }
    const decided = new Set(decList.map((d) => d.step_order))
    const waiting = approval.current_step === 0
      ? stepList.filter((s) => !decided.has(s.step_order))
      : stepList.filter((s) => s.step_order === (approval.current_step ?? 1))
    return { kind: 'not_current', ...common, waitingOn: [...new Set(waiting.map(nameOf))] }
  }

  const [{ data: sentBy }, { data: comments }] = await Promise.all([
    approval.requested_by ? admin.from('profiles').select('full_name').eq('id', approval.requested_by).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('request_comments').select('body, created_at, is_internal, author:profiles!request_comments_author_id_fkey(full_name), external_name').eq('request_id', approval.request_id).eq('is_internal', false).order('created_at', { ascending: false }).limit(6),
  ])
  const requesterName = one(req.requester as { full_name: string } | { full_name: string }[] | null)?.full_name ?? ''
  const conversation = ((comments ?? []) as { body: string; created_at: string; author: { full_name: string } | { full_name: string }[] | null; external_name: string | null }[])
    .reverse()
    .map((c) => ({ author: one(c.author)?.full_name ?? c.external_name ?? 'Unknown', at: pdfDateTime(c.created_at), body: clip(c.body, 600) }))
  return {
    kind: 'pending', ...common, approverId,
    detail: {
      priority: req.priority, requesterName, sentByName: (sentBy as { full_name: string } | null)?.full_name ?? '',
      service: one(req.service as { name: string } | { name: string }[] | null)?.name ?? '',
      category: [one(req.category as { name: string } | { name: string }[] | null)?.name, one(req.sub_category as { name: string } | { name: string }[] | null)?.name].filter(Boolean).join(' > '),
      description: clip(req.description, 800), created: pdfDateTime(req.created_at), conversation,
    },
  }
}
