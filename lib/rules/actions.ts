import { notify } from '@/lib/notifications'
import { sendEmail } from '@/lib/email/send'
import { logActivity } from '@/lib/activity'
import { STATUS_LABELS } from '@/lib/constants/requests'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import type { SLAConfig, FormSection, FormField } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

export type RuleAction =
  | { type: 'assign'; params: { strategy: 'direct' | 'round_robin' | 'load_balanced'; assigneeIds: string[] } }
  | { type: 'set_priority'; params: { priority: string } }
  | { type: 'set_status'; params: { status: string } }
  | {
      type: 'notify'
      params: {
        roles: string[]
        notifyAssignee: boolean
        notifyRequester: boolean
        channels: ('in_app' | 'email')[]
      }
    }

export type RuleActionContext = {
  ruleId: string
  ruleName: string
}

export type ActionRequest = {
  id: string
  title: string
  requester_id: string
  assigned_to: string | null
  org_id: string | null
  // Needed by set_priority/set_status to recompute SLA deadlines and replicate
  // the pause/resume + reopen bookkeeping that the interactive
  // changePriority()/updateRequestStatus() actions already do — a raw status/
  // priority write with none of that leaves stale or wrong due dates behind.
  status: string
  priority: string
  service_id: string
  created_at: string
  form_data: Record<string, unknown>
  waiting_since: string | null
  response_due_at: string | null
  resolution_due_at: string | null
  service: {
    sla_policy: { config: SLAConfig | null } | null
    form_sections: FormSection[] | null
    form_fields: FormField[] | null
    template: { form_sections: FormSection[] | null } | null
  }
}

async function getUserEmail(admin: AnyClient, userId: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId)
    return data?.user?.email ?? null
  } catch {
    return null
  }
}

async function runAssign(
  admin: AnyClient,
  request: ActionRequest,
  params: Extract<RuleAction, { type: 'assign' }>['params'],
  ctx: RuleActionContext
): Promise<void> {
  const { strategy, assigneeIds } = params
  if (!assigneeIds || assigneeIds.length === 0) return

  let chosenId: string | null = null

  if (strategy === 'direct') {
    chosenId = assigneeIds[0] ?? null
  } else if (strategy === 'round_robin') {
    const { data: rule } = await admin
      .from('business_rules')
      .select('last_assigned_index')
      .eq('id', ctx.ruleId)
      .single()
    const index = ((rule?.last_assigned_index ?? 0) as number) % assigneeIds.length
    chosenId = assigneeIds[index] ?? null
    await admin
      .from('business_rules')
      .update({ last_assigned_index: (index + 1) % assigneeIds.length })
      .eq('id', ctx.ruleId)
  } else if (strategy === 'load_balanced') {
    const counts = await Promise.all(
      assigneeIds.map(async (id) => {
        const { count } = await admin
          .from('requests')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', id)
          .not('status', 'in', '("resolved","cancelled","closed")')
        return { id, count: count ?? 0 }
      })
    )
    counts.sort((a: { count: number }, b: { count: number }) => a.count - b.count)
    chosenId = counts[0]?.id ?? null
  }

  if (!chosenId) return

  await admin.from('requests').update({ assigned_to: chosenId }).eq('id', request.id)
  await logActivity({
    requestId: request.id,
    actorId: chosenId,
    action: 'assigned',
    metadata: { assigned_to: chosenId, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName },
  })
  notify([
    {
      recipientId: chosenId,
      actorId: chosenId,
      type: 'request_assigned',
      title: 'Request assigned to you',
      body: request.title,
      requestId: request.id,
      link: `/requests/${request.id}`,
    },
  ]).catch(() => {})
}

async function runSetPriority(admin: AnyClient, request: ActionRequest, priority: string, ctx: RuleActionContext): Promise<void> {
  // Recompute deadlines the same way the interactive changePriority() action
  // does — from created_at, field override > the service's mapped SLA Policy,
  // business-hours aware — instead of leaving the old priority's due dates in
  // place under a new priority.
  const allFields = resolveServiceFormSections(request.service).flatMap((s) => s.fields)
  const { responseDueAt, resolutionDueAt } = await resolveSlaDeadlines(admin, {
    serviceId: request.service_id,
    priority: priority as 'low' | 'medium' | 'high' | 'urgent',
    servicePolicyConfig: request.service.sla_policy?.config ?? null,
    allFields,
    formData: request.form_data,
    from: new Date(request.created_at),
  })

  await admin
    .from('requests')
    .update({ priority, response_due_at: responseDueAt, resolution_due_at: resolutionDueAt })
    .eq('id', request.id)
  await logActivity({
    requestId: request.id,
    actorId: request.requester_id,
    action: 'priority_changed',
    metadata: { priority_to: priority, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName },
  })
}

async function runSetStatus(admin: AnyClient, request: ActionRequest, status: string, ctx: RuleActionContext): Promise<void> {
  if (!(status in STATUS_LABELS)) return // guard against a stale/invalid status baked into an old rule

  const now = new Date()
  const nowIso = now.toISOString()
  const update: Record<string, unknown> = { status }

  if (status === 'resolved') update.resolved_at = nowIso
  if (status === 'closed') update.closed_at = nowIso
  if (status === 'open') {
    update.resolved_at = null
    update.closed_at = null
  }

  // Leaving waiting_user: extend both deadlines by the paused duration and
  // clear waiting_since — same bookkeeping updateRequestStatus does.
  if (request.status === 'waiting_user' && status !== 'waiting_user' && request.waiting_since) {
    const pausedMs = now.getTime() - new Date(request.waiting_since).getTime()
    if (request.response_due_at) {
      update.response_due_at = new Date(new Date(request.response_due_at).getTime() + pausedMs).toISOString()
    }
    if (request.resolution_due_at) {
      update.resolution_due_at = new Date(new Date(request.resolution_due_at).getTime() + pausedMs).toISOString()
    }
    update.waiting_since = null
  }
  if (status === 'waiting_user') update.waiting_since = nowIso

  // Reopen (resolved/closed -> open): recompute resolution_due_at from now,
  // same as the REOPEN branch in updateRequestStatus — otherwise a rule-driven
  // reopen keeps whatever deadline (or null) the request had before it closed.
  if (status === 'open' && (request.status === 'resolved' || request.status === 'closed')) {
    const allFields = resolveServiceFormSections(request.service).flatMap((s) => s.fields)
    const resolved = await resolveSlaDeadlines(admin, {
      serviceId: request.service_id,
      priority: request.priority as 'low' | 'medium' | 'high' | 'urgent',
      servicePolicyConfig: request.service.sla_policy?.config ?? null,
      allFields,
      formData: request.form_data,
      from: now,
    })
    if (resolved.resolutionDueAt) update.resolution_due_at = resolved.resolutionDueAt
    update.waiting_since = null
  }

  await admin.from('requests').update(update).eq('id', request.id)

  // Auto time-tracking: a rule-driven status change away from in_progress must
  // close any open timer the same way the interactive updateRequestStatus()
  // does — otherwise an agent's clock keeps running forever on a ticket a rule
  // just resolved/reassigned out from under them.
  if (request.status === 'in_progress' && status !== 'in_progress') {
    await admin
      .from('request_time_entries')
      .update({ stopped_at: nowIso })
      .eq('request_id', request.id)
      .is('stopped_at', null)
  }

  await logActivity({
    requestId: request.id,
    actorId: request.requester_id,
    action: 'status_changed',
    metadata: { to: status, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName },
  })
}

async function runNotify(
  admin: AnyClient,
  request: ActionRequest,
  params: Extract<RuleAction, { type: 'notify' }>['params'],
  ctx: RuleActionContext
): Promise<void> {
  const recipients = new Set<string>()

  if (params.notifyAssignee && request.assigned_to) recipients.add(request.assigned_to)
  if (params.notifyRequester) recipients.add(request.requester_id)

  if (params.roles.length > 0 && request.org_id) {
    const { data: roleProfiles } = await admin
      .from('profiles')
      .select('id')
      .eq('org_id', request.org_id)
      .in('role', params.roles)
    for (const p of roleProfiles ?? []) recipients.add((p as { id: string }).id)
  }

  if (recipients.size === 0) return

  const title = `Business rule: ${ctx.ruleName}`
  const body = request.title

  if (params.channels.includes('in_app')) {
    notify(
      [...recipients].map((recipientId) => ({
        recipientId,
        actorId: recipientId,
        type: 'business_rule_notification' as const,
        title,
        body,
        requestId: request.id,
        link: `/requests/${request.id}`,
      }))
    ).catch(() => {})
  }

  if (params.channels.includes('email')) {
    // Independent per-recipient — was one at a time, so a rule notifying
    // every manager+admin on an SLA breach took N sequential round trips
    // before executeActions could move to the rule's next action.
    await Promise.all([...recipients].map(async (recipientId) => {
      const email = await getUserEmail(admin, recipientId)
      if (email) {
        await sendEmail({ to: email, subject: title, html: `<p>${body}</p><p><a href="/requests/${request.id}">View request</a></p>` })
      }
    }))
  }
}

/** Executes every action in order. A failure in one action is logged and does not stop the rest. */
export async function executeActions(
  admin: AnyClient,
  request: ActionRequest,
  actions: RuleAction[],
  ctx: RuleActionContext
): Promise<void> {
  for (const action of actions) {
    try {
      if (action.type === 'assign') await runAssign(admin, request, action.params, ctx)
      else if (action.type === 'set_priority') await runSetPriority(admin, request, action.params.priority, ctx)
      else if (action.type === 'set_status') await runSetStatus(admin, request, action.params.status, ctx)
      else if (action.type === 'notify') await runNotify(admin, request, action.params, ctx)
    } catch (e) {
      console.error(`[business-rules] Action "${action.type}" failed for rule ${ctx.ruleId}`, e)
    }
  }
}
