import 'server-only'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { assembleHistory, tickedFields, HISTORY_MONTHS, type ApprovalHistory, type EarlierInput } from '@/lib/approvals/history-model'
import type { FormSection } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
const asSections = (v: unknown): FormSection[] => (Array.isArray(v) ? (v as FormSection[]) : [])
const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * The "earlier requests of this store" box for the request an approval is about: what is being asked now, and the last decisions on requests of the same store and the
 * same sub-category (the same category when the request has no sub-category) in the last 12 months, whoever decided them. A requester without a store is compared
 * with their own earlier requests. Returns null when the category has the box switched off (service_categories.show_approval_history) or the approval cannot be found.
 * Read-only; never throws (the approval request must go out even if this box cannot be built).
 */
export async function loadApprovalHistory(admin: AnyClient, approvalId: string): Promise<ApprovalHistory | null> {
  try {
    const { data: approval } = await admin.from('approvals').select('id, request_id').eq('id', approvalId).maybeSingle()
    if (!approval) return null
    const { data: req } = await admin.from('requests')
      .select('id, org_id, requester_id, service_id, category_id, sub_category_id, form_data, form_sections_snapshot, category:service_categories(name, show_approval_history), sub:service_sub_categories(name)')
      .eq('id', approval.request_id).maybeSingle()
    if (!req || !req.org_id) return null
    const cat = one(req.category as { name: string; show_approval_history: boolean } | { name: string; show_approval_history: boolean }[] | null)
    if (!cat || cat.show_approval_history !== true) return null
    const subName = one(req.sub as { name: string } | { name: string }[] | null)?.name ?? ''
    const categoryLabel = [cat.name, subName].filter(Boolean).join(' > ')

    // The ticked answers come from the live form (so ticking a field today also shows it for the old tickets); the ticket's own frozen form is the fallback.
    const { data: service } = await admin.from('services').select('form_sections, form_fields, template:form_templates(form_sections)').eq('id', req.service_id).maybeSingle()
    const live = service ? resolveServiceFormSections({ form_sections: service.form_sections, form_fields: service.form_fields, template: one(service.template as { form_sections?: unknown } | { form_sections?: unknown }[] | null) }) : []
    const currentSections = asSections(req.form_sections_snapshot)
    const ticked = tickedFields(live.length > 0 ? live : currentSections)

    // Who counts as "this store": every person linked to the requester's store; a requester without a store stands alone.
    const { data: requester } = await admin.from('profiles').select('store_id').eq('id', req.requester_id).maybeSingle()
    let storeName = ''
    let peerIds: string[] = [req.requester_id]
    if (requester?.store_id) {
      const [{ data: store }, { data: people }] = await Promise.all([
        admin.from('stores').select('name, code').eq('id', requester.store_id).maybeSingle(),
        admin.from('profiles').select('id').eq('store_id', requester.store_id).eq('org_id', req.org_id),
      ])
      storeName = store ? [store.name, store.code ? `(${store.code})` : ''].filter(Boolean).join(' ') : ''
      peerIds = [...new Set([req.requester_id, ...((people ?? []) as { id: string }[]).map((p) => p.id)])]
    }

    // exactly 12 calendar months back (QA-D007: it used to be 12 x 31 days = 372 days)
    const sinceDate = new Date(); sinceDate.setMonth(sinceDate.getMonth() - HISTORY_MONTHS)
    const since = sinceDate.toISOString()
    let q = admin.from('approvals')
      .select('id, status, created_at, request_id, requests!inner(request_no, requester_id, category_id, sub_category_id, form_data, form_sections_snapshot)')
      .in('status', ['approved', 'rejected', 'pending'])
      .neq('request_id', req.id)
      .gte('created_at', since)
      .in('requests.requester_id', peerIds)
    q = req.sub_category_id ? q.eq('requests.sub_category_id', req.sub_category_id) : q.eq('requests.category_id', req.category_id).is('requests.sub_category_id', null)
    const { data: rows } = await q.order('created_at', { ascending: false }).limit(1000)
    const found = (rows ?? []) as { id: string; status: 'approved' | 'rejected' | 'pending'; created_at: string; requests: unknown }[]

    const ids = found.map((r) => r.id)
    const { data: decisions } = ids.length === 0 ? { data: [] } : await admin.from('approval_decisions')
      .select('approval_id, comment, decided_at, decider:profiles!approval_decisions_decided_by_fkey(full_name)')
      .in('approval_id', ids).order('decided_at', { ascending: true })
    const lastDecision = new Map<string, { comment: string | null; decided_at: string; by: string }>()
    for (const d of (decisions ?? []) as { approval_id: string; comment: string | null; decided_at: string; decider: { full_name: string } | { full_name: string }[] | null }[]) {
      lastDecision.set(d.approval_id, { comment: d.comment, decided_at: d.decided_at, by: one(d.decider)?.full_name ?? '' })
    }

    const earlier: EarlierInput[] = found.map((r) => {
      const rq = (one(r.requests as Record<string, unknown> | Record<string, unknown>[] | null) ?? {}) as { request_no?: string; form_data?: unknown; form_sections_snapshot?: unknown }
      const d = lastDecision.get(r.id)
      return {
        requestNo: rq.request_no ?? '',
        formData: asObject(rq.form_data),
        sections: asSections(rq.form_sections_snapshot),
        outcome: r.status === 'pending' ? 'waiting' : r.status,
        at: r.status === 'pending' ? r.created_at : (d?.decided_at ?? r.created_at),
        decidedBy: r.status === 'pending' ? '' : (d?.by ?? ''),
        comment: r.status === 'pending' ? null : (d?.comment ?? null),
      }
    })

    return assembleHistory({ storeName, category: categoryLabel, ticked, currentFormData: asObject(req.form_data), currentSections: live.length > 0 ? live : currentSections, earlier })
  } catch (e) {
    console.error('[loadApprovalHistory] failed', e)
    return null
  }
}
