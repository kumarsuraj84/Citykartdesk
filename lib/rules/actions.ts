import { notify } from '@/lib/notifications'
import { sendEmail } from '@/lib/email/send'
import { notifyRequesterOfAssignment } from '@/lib/requests/notify-requester'
import { escapeHtml } from '@/lib/email/escape'
import { logActivity } from '@/lib/activity'
import { logger } from '@/lib/observability/logger'
import { alertOperator } from '@/lib/observability/alert'
import { STATUS_LABELS } from '@/lib/constants/requests'
import { getResolvedReopenWindowHours } from '@/lib/settings/reopenWindow'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import type { SLAConfig, FormSection, FormField } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

export type RuleAction =
  | { type: 'assign'; params: { strategy: 'direct' | 'round_robin' | 'load_balanced'; assigneeIds: string[] } }
  | { type: 'set_priority'; params: { priority: string } }
  | { type: 'set_status'; params: { status: string } }
  // Re-routes the ticket to a different Team without changing its Service —
  // e.g. one Service's Categories are actually split across several
  // sub-teams of technicians; visibility (Team Queue, RLS) follows team_id,
  // so a Category-conditioned rule can route each Category to the right
  // sub-team's members only, instead of everyone on one big Team seeing
  // every Category's tickets.
  | { type: 'set_team'; params: { teamId: string } }
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
  team_id: string
  created_at: string
  form_data: Record<string, unknown>
  waiting_since: string | null
  response_due_at: string | null
  resolution_due_at: string | null
  reopen_count: number
  responded_at: string | null
  paused_ms_total: number
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

  // A rule authored (or left stale) with an assigneeIds list that no longer
  // matches the request's current team — teams/services get reorganized —
  // could otherwise silently place a ticket with someone who has no RLS
  // visibility into it, effectively orphaning it. assignRequest() (the
  // interactive equivalent) already guards this; this direct admin-client
  // write bypassed it entirely until now.
  const { count: onTeam } = await admin
    .from('team_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('team_id', request.team_id)
    .eq('user_id', chosenId)
  if (!onTeam) {
    console.error(`[business-rules] assign action for rule ${ctx.ruleId} chose user ${chosenId}, who is not on request ${request.id}'s team — skipped.`)
    return
  }

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
  notifyRequesterOfAssignment({ requestId: request.id, assigneeId: chosenId, actorId: chosenId }).catch(() => {})
}

async function runSetPriority(admin: AnyClient, request: ActionRequest, priority: string, ctx: RuleActionContext): Promise<void> {
  // Recompute deadlines the same way the interactive changePriority() action
  // does — from created_at, field override > the service's mapped SLA Policy,
  // business-hours aware — instead of leaving the old priority's due dates in
  // place under a new priority.
  const allFields = resolveServiceFormSections(request.service).flatMap((s) => s.fields)
  let { responseDueAt, resolutionDueAt } = await resolveSlaDeadlines(admin, {
    serviceId: request.service_id,
    priority: priority as 'low' | 'medium' | 'high' | 'urgent',
    servicePolicyConfig: request.service.sla_policy?.config ?? null,
    allFields,
    formData: request.form_data,
    from: new Date(request.created_at),
  })

  // Preserve every pause this request has ever accumulated (the ledger,
  // plus one currently in progress) — same fix as changePriority()'s.
  const creditMs =
    request.paused_ms_total + (request.waiting_since ? Date.now() - new Date(request.waiting_since).getTime() : 0)
  if (creditMs > 0) {
    if (responseDueAt) responseDueAt = new Date(new Date(responseDueAt).getTime() + creditMs).toISOString()
    if (resolutionDueAt) resolutionDueAt = new Date(new Date(resolutionDueAt).getTime() + creditMs).toISOString()
  }

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

  if (status === 'resolved') {
    update.resolved_at = nowIso
    // Same admin-configurable "not satisfied? reopen it" window
    // updateRequestStatus() grants an interactively-resolved ticket (Request
    // Configuration → General) — a rule-resolved one needs it too, or
    // autoCloseRequests()'s sweep (keyed off reopen_deadline_at) never picks
    // it up and it stays open forever.
    const reopenWindowHours = await getResolvedReopenWindowHours()
    update.reopen_deadline_at = new Date(now.getTime() + reopenWindowHours * 3_600_000).toISOString()
  }
  if (status === 'closed') update.closed_at = nowIso
  if (status === 'cancelled') {
    update.cancellation_reason = 'manual'
    update.reopen_deadline_at = null
  }
  if (status === 'open') {
    update.resolved_at = null
    update.closed_at = null
    // Reopening out of resolved/closed counts the same as an interactive
    // reopen — same reopen_count metric, same cleared cancellation state.
    if (request.status === 'resolved' || request.status === 'closed') {
      update.cancellation_reason = null
      update.reopen_deadline_at = null
      update.reopen_count = (request.reopen_count ?? 0) + 1
    }
  }

  // Leaving waiting_user: extend both deadlines by the paused duration,
  // clear waiting_since, and credit the ledger — same bookkeeping
  // updateRequestStatus does, so a later priority/category change doesn't
  // discard this pause once it's no longer the active one.
  if (request.status === 'waiting_user' && status !== 'waiting_user' && request.waiting_since) {
    const pausedMs = now.getTime() - new Date(request.waiting_since).getTime()
    if (request.response_due_at) {
      update.response_due_at = new Date(new Date(request.response_due_at).getTime() + pausedMs).toISOString()
    }
    if (request.resolution_due_at) {
      update.resolution_due_at = new Date(new Date(request.resolution_due_at).getTime() + pausedMs).toISOString()
    }
    update.waiting_since = null
    update.paused_ms_total = request.paused_ms_total + pausedMs
  }
  if (status === 'waiting_user') update.waiting_since = nowIso

  // responded_at: same "first time this request left the untouched state"
  // bookkeeping updateRequestStatus() captures — a rule that moves a fresh
  // ticket straight to in_progress/assigned shouldn't leave first-response
  // metrics blank forever.
  if (!request.responded_at && (status === 'in_progress' || status === 'assigned')) {
    update.responded_at = nowIso
  }

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
    // A reopen starts a brand-new SLA clock from now — old pause credit
    // belonged to the clock that just ended.
    update.paused_ms_total = 0
  }

  await admin.from('requests').update(update).eq('id', request.id)

  // CSAT: same as updateRequestStatus() — a rule-resolved ticket needs a
  // survey record too, or the requester never gets asked to rate it.
  // Upsert-ignore dedupes against UNIQUE(request_id) for a reopen->resolve cycle.
  if (status === 'resolved' && request.requester_id && request.org_id) {
    const { error: csatError } = await admin.from('csat_surveys').upsert(
      { org_id: request.org_id, request_id: request.id, requester_id: request.requester_id, sent_at: nowIso },
      { onConflict: 'request_id', ignoreDuplicates: true }
    )
    if (csatError) console.error('[business-rules] CSAT survey creation failed', csatError)
  }

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

async function runSetTeam(admin: AnyClient, request: ActionRequest, teamId: string, ctx: RuleActionContext): Promise<void> {
  if (!teamId) return // rule saved with no team selected yet — nothing to do
  const { error } = await admin.from('requests').update({ team_id: teamId }).eq('id', request.id)
  if (error) return
  await logActivity({
    requestId: request.id,
    actorId: request.requester_id,
    action: 'reclassified',
    metadata: { team_id: teamId, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName },
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
    // notify() itself never throws (see lib/notifications.ts), but this
    // .catch stays as a belt-and-suspenders guard against an unexpected
    // rejection — DESK-OBS-002: previously fully silent (`.catch(() => {})`)
    // with no trace an admin could ever find; now at least structured-logged
    // so a repeated in-app delivery failure is diagnosable.
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
    ).catch((err) => {
      logger.error({
        event: 'business_rules.notify.in_app_failed',
        message: 'In-app notify() rejected for a business-rule notify action',
        route: 'lib/rules/actions.ts#runNotify',
        requestId: request.id,
        orgId: request.org_id ?? undefined,
        errorCode: 'notify_in_app_failed',
        context: { ruleId: ctx.ruleId, ruleName: ctx.ruleName, recipientCount: recipients.size },
        error: err,
      })
    })
  }

  if (params.channels.includes('email')) {
    // Independent per-recipient — was one at a time, so a rule notifying
    // every manager+admin on an SLA breach took N sequential round trips
    // before executeActions could move to the rule's next action.
    // D-05: title/body embed the (admin-authored, but not necessarily
    // trusted-safe) rule name and the request's own title — escape for the
    // HTML email specifically; the in-app notify() above renders as plain
    // text through React, which is already safe.
    const safeBody = escapeHtml(body)
    const results = await Promise.all([...recipients].map(async (recipientId) => {
      const email = await getUserEmail(admin, recipientId)
      if (!email) return { recipientId, skipped: true as const }
      // DESK-OBS-002: sendEmail() never throws — it returns `{ error }` on
      // failure — and this call site previously never read that result, so
      // a Resend outage or a bad address silently dropped the notification
      // with zero trace anywhere.
      const { error } = await sendEmail({ to: email, subject: title, html: `<p>${safeBody}</p><p><a href="/requests/${request.id}">View request</a></p>` })
      return { recipientId, skipped: false as const, error }
    }))

    const failures = results.filter((r) => !r.skipped && r.error)
    if (failures.length > 0) {
      logger.error({
        event: 'business_rules.notify.email_failed',
        message: `${failures.length}/${results.length} business-rule notify emails failed to send`,
        route: 'lib/rules/actions.ts#runNotify',
        requestId: request.id,
        orgId: request.org_id ?? undefined,
        errorCode: 'email_send_failed',
        context: { ruleId: ctx.ruleId, ruleName: ctx.ruleName, failedCount: failures.length, totalCount: results.length },
      })
      // Repeated/permanent failure (not a single flaky send) is what an
      // operator actually needs paged for — deduped per-rule by alertOperator
      // so a rule that fires often doesn't spam the same alert every tick.
      await alertOperator({
        key: `business_rule.email_failed.${ctx.ruleId}`,
        severity: failures.length === results.length ? 'critical' : 'warning',
        title: `Business rule "${ctx.ruleName}" failed to send ${failures.length} notification email(s)`,
        detail: { ruleId: ctx.ruleId, requestId: request.id, failedCount: failures.length, totalCount: results.length },
        orgId: request.org_id ?? undefined,
      })
    }
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
      else if (action.type === 'set_team') await runSetTeam(admin, request, action.params.teamId, ctx)
      else if (action.type === 'notify') await runNotify(admin, request, action.params, ctx)
    } catch (e) {
      logger.error({
        event: 'business_rules.action_failed',
        message: `Action "${action.type}" failed for rule ${ctx.ruleId}`,
        route: 'lib/rules/actions.ts#executeActions',
        requestId: request.id,
        orgId: request.org_id ?? undefined,
        errorCode: `business_rule_action_${action.type}_failed`,
        context: { ruleId: ctx.ruleId, ruleName: ctx.ruleName, actionType: action.type },
        error: e,
      })
    }
  }
}
