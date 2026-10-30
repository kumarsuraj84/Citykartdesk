import { notify } from '@/lib/notifications'
import { sendEmail } from '@/lib/email/send'
import { absoluteAppUrl } from '@/lib/email/notify-email'
import { notifyRequesterOfAssignment } from '@/lib/requests/notify-requester'
import { escapeHtml } from '@/lib/email/escape'
import { logActivity } from '@/lib/activity'
import { logger } from '@/lib/observability/logger'
import { alertOperator } from '@/lib/observability/alert'
import { STATUS_LABELS, CLOSED_LIKE_REQUEST_STATUSES, isClosedLikeStatus } from '@/lib/constants/requests'
import { getResolvedReopenWindowHours } from '@/lib/settings/reopenWindow'
import { resolveSlaDeadlines, slaClockStart } from '@/lib/sla/resolve'
import { pauseCreditMs, shiftDeadlineByCredit } from '@/lib/sla/business-hours'
import { inBatches } from '@/lib/queries/in-batches'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import type { SLAConfig, FormSection, FormField } from '@/types'
import { isServerTransitionAllowed } from '@/lib/constants/request-transitions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

/** PostgREST `in` list of the finished statuses ("resolved","closed","cancelled"). */
const CLOSED_SQL_LIST = `(${CLOSED_LIKE_REQUEST_STATUSES.map((st) => `"${st}"`).join(',')})`

export type RuleAction =
  // vendorCompanyId: instead of a fixed list of people, ALL the active technicians of that vendor company (so a technician added later takes part without editing the rule)
  | { type: 'assign'; params: { strategy: 'direct' | 'round_robin' | 'load_balanced'; assigneeIds: string[]; vendorCompanyId?: string } }
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
  /** What fired the rule. An assign action behaves differently on an edit ('updated'): it only fills an empty slot (B-02). */
  trigger?: 'created' | 'updated' | 'schedule'
  /** Set for a deliberate re-routing (the category was changed): then an assign action of an 'updated' rule may replace the current assignee. */
  allowReassign?: boolean
}

export type ActionRequest = {
  id: string
  request_no: string
  title: string
  requester_id: string
  assigned_to: string | null
  org_id: string | null
  // Needed by set_priority/set_status to recompute SLA deadlines and replicate
  // the pause/resume + reopen bookkeeping that the interactive
  // updateRequestStatus() action already does — a raw status/
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

/** What an action changed on the ticket. executeActions folds it into the request the NEXT action of the same rule sees (B-20), so "assign, then notify the assignee" notifies the new person. */
type RequestPatch = Partial<Pick<ActionRequest, 'assigned_to' | 'status' | 'priority' | 'team_id' | 'response_due_at' | 'resolution_due_at' | 'waiting_since' | 'paused_ms_total' | 'reopen_count' | 'responded_at'>>

/**
 * Which of these people may take THIS ticket (B-19): active, in the ticket's organisation, and on its team. A vendor technician (an OEM engineer) is on no team and sees only
 * the tickets assigned to him (row security), so he is the one exception to the team rule. A rule authored (or left stale) with a list that no longer matches the ticket's
 * team could otherwise place a ticket with someone who has no access to it, effectively orphaning it; assignRequest() (the interactive equivalent) guards the same.
 */
async function validAssignees(admin: AnyClient, request: ActionRequest, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const [profiles, members] = await Promise.all([
    inBatches<{ id: string; is_active: boolean | null; org_id: string | null; vendor_company_id: string | null; vendor_role: string | null }>(ids, (batch) =>
      admin.from('profiles').select('id, is_active, org_id, vendor_company_id, vendor_role').in('id', batch)),
    inBatches<{ user_id: string }>(ids, (batch) => admin.from('team_members').select('user_id').eq('team_id', request.team_id).in('user_id', batch)),
  ])
  if (profiles.error || members.error) throw new Error(`Could not check who may take ticket ${request.id}: ${(profiles.error ?? members.error)?.message ?? 'unknown error'}`)
  const onTeam = new Set(members.data.map((m) => m.user_id))
  const valid = new Set<string>()
  for (const p of profiles.data) {
    if (p.is_active === false) continue
    if (request.org_id && p.org_id !== request.org_id) continue
    const isVendorTech = p.vendor_role === 'technician' && !!p.vendor_company_id
    if (onTeam.has(p.id) || isVendorTech) valid.add(p.id)
  }
  return valid
}

async function runAssign(
  admin: AnyClient,
  request: ActionRequest,
  params: Extract<RuleAction, { type: 'assign' }>['params'],
  ctx: RuleActionContext
): Promise<RequestPatch | void> {
  const { strategy } = params
  let assigneeIds = params.assigneeIds
  if (params.vendorCompanyId) {
    // C-13: a vendor company an administrator has switched OFF gets no new tickets (its technicians are also refused by the vendor pages and actions).
    const { data: company, error: companyError } = await admin.from('vendor_companies').select('is_active').eq('id', params.vendorCompanyId).eq('org_id', request.org_id).maybeSingle()
    if (companyError) throw new Error(`Could not read the vendor company: ${companyError.message ?? 'unknown error'}`)
    if (!company || company.is_active === false) return
    const { data: techs, error: techsError } = await admin.from('profiles').select('id').eq('org_id', request.org_id).eq('vendor_company_id', params.vendorCompanyId).eq('vendor_role', 'technician').eq('is_active', true).order('full_name', { ascending: true }).order('id', { ascending: true })
    if (techsError) throw new Error(`Could not read the technicians of the vendor company: ${techsError.message ?? 'unknown error'}`)
    assigneeIds = ((techs ?? []) as { id: string }[]).map((t) => t.id)
  }
  if (!assigneeIds || assigneeIds.length === 0) return

  if (request.assigned_to) {
    const { data: current, error: currentError } = await admin.from('profiles').select('vendor_company_id, vendor_role, is_active').eq('id', request.assigned_to).maybeSingle()
    if (currentError) throw new Error(`Could not read the current assignee of ticket ${request.id}: ${currentError.message ?? 'unknown error'}`)
    // A ticket that is with a vendor technician (an OEM engineer) is never taken away by a rule - not by an "edited" rule that re-runs after he starts work, and not by
    // a round-robin that would pass it to the next person. Only an administrator moves it (so a rule that always sends AC tickets to a Citykart technician cannot undo the vendor routing).
    if (current?.vendor_company_id && current.vendor_role === 'technician') return
    // B-02: when the ticket is EDITED, an assign rule only fills an empty slot (or replaces a person who is no longer active). Almost every rule is "created + edited" with a fixed
    // person, so after any edit it used to take the ticket back from whoever a manager had just given it to.
    if (ctx.trigger === 'updated' && !ctx.allowReassign && current && current.is_active !== false) return
  }

  // B-19: only people who can really take this ticket are candidates; an invalid one is skipped, and the next valid one is used (a round-robin used to advance and give up).
  const valid = await validAssignees(admin, request, assigneeIds)
  if (valid.size === 0) {
    logger.warn({ event: 'rules.assign_no_valid_candidate', message: `Assign action of rule ${ctx.ruleId} has nobody who is active and on the team of the ticket`, route: 'lib/rules/actions.ts#runAssign', requestId: request.id, context: { ruleId: ctx.ruleId, candidates: assigneeIds.length } })
    return
  }

  let chosenId: string | null = null

  if (strategy === 'direct') {
    chosenId = assigneeIds.find((id) => valid.has(id)) ?? null
  } else if (strategy === 'round_robin') {
    // The position is taken with a compare-and-set (QA-D018): two tickets created at the very same moment used to read the same position and both went to one person.
    // Whoever changes the stored position first keeps it; the other reads the new position and tries again.
    const n = assigneeIds.length
    for (let attempt = 0; attempt < 12; attempt++) {
      const { data: rule } = await admin
        .from('business_rules')
        .select('last_assigned_index')
        .eq('id', ctx.ruleId)
        .single()
      const stored = (rule?.last_assigned_index ?? null) as number | null
      const start = (stored ?? 0) % n
      let index = -1
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n
        if (valid.has(assigneeIds[i])) { index = i; break }
      }
      if (index < 0) break
      let claim = admin.from('business_rules').update({ last_assigned_index: (index + 1) % n }).eq('id', ctx.ruleId)
      claim = stored === null ? claim.is('last_assigned_index', null) : claim.eq('last_assigned_index', stored)
      const { data: won } = await claim.select('id')
      if (won && won.length > 0) { chosenId = assigneeIds[index] ?? null; break }
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 40)))
    }
    if (!chosenId) {
      // twelve lost races in a row: do not leave the ticket without a person; fall back to the first listed technician who can take it
      chosenId = assigneeIds.find((id) => valid.has(id)) ?? null
    }
  } else if (strategy === 'load_balanced') {
    const counts = await Promise.all(
      assigneeIds.filter((id) => valid.has(id)).map(async (id) => {
        const { count, error } = await admin
          .from('requests')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', id)
          .not('status', 'in', CLOSED_SQL_LIST)
        if (error) throw new Error(`Could not count the open tickets of ${id}: ${error.message ?? 'unknown error'}`)
        return { id, count: count ?? 0 }
      })
    )
    counts.sort((a: { count: number }, b: { count: number }) => a.count - b.count)
    chosenId = counts[0]?.id ?? null
  }

  if (!chosenId) return

  // Already exactly this person's ticket (this rule matching again — e.g. the same
  // "created + updated" rule re-running when the technician clicks Start Working — or a
  // second overlapping rule choosing the same assignee): nothing actually changed, so
  // don't re-log it or re-send "assigned to you" / "your ticket has been assigned" a
  // second time for the same assignment.
  if (chosenId === request.assigned_to) return

  // A rule gives the ticket a person and leaves its status as it is (an "open" ticket stays "open" with its technician, as it always has on the live system).
  // Whether a rule-assigned ticket should become "assigned" like a manual assignment is the owner's decision (audit B-31), so it is not changed here.
  // Only if the ticket is still in the status this rule read (D-044): when someone changed it in between, the rule does not overwrite that.
  const nextStatus = request.status
  const { data: moved, error: assignError } = await admin
    .from('requests')
    .update({ assigned_to: chosenId, ...(nextStatus !== request.status ? { status: nextStatus } : {}) })
    .eq('id', request.id)
    .eq('status', request.status)
    .select('id')
    .maybeSingle()
  if (assignError) throw new Error(`Could not assign ticket ${request.id}: ${assignError.message ?? 'unknown error'}`)
  if (!moved) {
    logger.warn({ event: 'rules.assign_ticket_changed', message: 'The ticket changed while the assign action was running; nothing was assigned', route: 'lib/rules/actions.ts#runAssign', requestId: request.id, context: { ruleId: ctx.ruleId } })
    return
  }
  await logActivity({
    requestId: request.id,
    actorId: null,
    action: 'assigned',
    metadata: { assigned_to: chosenId, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName },
  })
  // B-20: nobody "assigned" this - a rule did - so no person is named as the actor (it used to read "assigned by <the assignee>")
  notify([
    {
      recipientId: chosenId,
      actorId: null,
      type: 'request_assigned',
      title: 'Request assigned to you',
      body: request.title,
      requestId: request.id,
      link: `/requests/${request.id}`,
      metadata: { assignerName: `Business rule: ${ctx.ruleName}` },
    },
  ]).catch(() => {})
  // (this helper wants a person for the actor: the ticket's requester stands in, the same way the automatic close does)
  notifyRequesterOfAssignment({ requestId: request.id, assigneeId: chosenId, actorId: request.requester_id }).catch(() => {})
  return { assigned_to: chosenId, status: nextStatus }
}

async function runSetPriority(admin: AnyClient, request: ActionRequest, priority: string, ctx: RuleActionContext): Promise<RequestPatch | void> {
  // B-30: the priority is already this one (the rule matches again after every edit): nothing to change, so no deadline rewrite and no "priority changed" entry.
  if (priority === request.priority) return
  // Recompute deadlines the same way a sub-category change does (updateRequestCategory())
  // does — from the start of the SLA clock, field override > the service's mapped SLA Policy,
  // business-hours aware — instead of leaving the old priority's due dates in
  // place under a new priority.
  // A finished ticket keeps the deadlines it finished with (D-044): only its priority is recorded.
  if (isClosedLikeStatus(request.status)) {
    const { error } = await admin.from('requests').update({ priority }).eq('id', request.id)
    if (error) throw new Error(`Could not set the priority of ticket ${request.id}: ${error.message ?? 'unknown error'}`)
    await logActivity({ requestId: request.id, actorId: null, action: 'priority_changed', metadata: { priority_to: priority, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName } })
    return { priority }
  }
  const allFields = resolveServiceFormSections(request.service).flatMap((s) => s.fields)
  // a reopened ticket's clock started when it was reopened (F-13), and the pauses that already ended are part of the length; a pause still in progress is NOT
  // added here - it is credited once, when the pause ends (adding it here as well counted it twice)
  const from = await slaClockStart(admin, request)
  const { responseDueAt, resolutionDueAt } = await resolveSlaDeadlines(admin, {
    serviceId: request.service_id,
    priority: priority as 'low' | 'medium' | 'high' | 'urgent',
    servicePolicyConfig: request.service.sla_policy?.config ?? null,
    allFields,
    formData: request.form_data,
    from,
    pauseCreditMs: request.paused_ms_total,
  })

  // B-01: a deadline that could not be worked out (no SLA for this priority, or the calendar could not be read; the latter is already logged and alerted at its source)
  // is NOT written: the ticket keeps the deadline it has instead of losing it.
  const update: Record<string, unknown> = { priority }
  if (responseDueAt) update.response_due_at = responseDueAt
  if (resolutionDueAt) update.resolution_due_at = resolutionDueAt
  const { error } = await admin.from('requests').update(update).eq('id', request.id)
  if (error) throw new Error(`Could not set the priority of ticket ${request.id}: ${error.message ?? 'unknown error'}`)
  await logActivity({
    requestId: request.id,
    actorId: null,
    action: 'priority_changed',
    metadata: { priority_to: priority, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName },
  })
  return { priority, ...(responseDueAt ? { response_due_at: responseDueAt } : {}), ...(resolutionDueAt ? { resolution_due_at: resolutionDueAt } : {}) }
}

/** Returns what changed when the ticket was actually moved (null: invalid status, or someone else changed it first). */
async function runSetStatus(admin: AnyClient, request: ActionRequest, status: string, ctx: RuleActionContext): Promise<RequestPatch | null> {
  if (!(status in STATUS_LABELS)) return null // guard against a stale/invalid status baked into an old rule
  // A rule may only make the moves a person could make, plus auto-close (VAPT-008): no jumping to any status, no reviving a cancelled ticket
  if (!isServerTransitionAllowed(request.status, status)) {
    logger.warn({ event: 'rules.status_move_refused', message: 'A Business Rule tried a status move that is not allowed', route: 'rules/actions.ts#runSetStatus', requestId: request.id, context: { from: request.status, to: status, ruleId: ctx.ruleId } })
    return null
  }

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
  // ("paused" = Waiting on User or Hold due to Purchase from HO, exactly as in lib/requests/status-change.ts)
  const pausedNow = request.status === 'waiting_user' || request.status === 'hold_purchase_ho'
  const pausedNext = status === 'waiting_user' || status === 'hold_purchase_ho'
  if (pausedNow && !pausedNext && request.waiting_since) {
    // credited in business time when the calendar has gaps (B-08/B-09), plain wall-clock time otherwise - the same number goes into the deadline and the ledger
    const creditMs = await pauseCreditMs(new Date(request.waiting_since), now)
    if (request.response_due_at) {
      update.response_due_at = (await shiftDeadlineByCredit(new Date(request.response_due_at), creditMs)).toISOString()
    }
    if (request.resolution_due_at) {
      update.resolution_due_at = (await shiftDeadlineByCredit(new Date(request.resolution_due_at), creditMs)).toISOString()
    }
    update.waiting_since = null
    update.paused_ms_total = request.paused_ms_total + creditMs
  }
  if (pausedNext && !pausedNow) update.waiting_since = nowIso   // entering a pause; moving between pauses keeps the original start

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

  // Only if the ticket is still in the status this rule read (D-044): when someone changed it in between, the rule does not overwrite that.
  const { data: changed, error: changeError } = await admin.from('requests').update(update).eq('id', request.id).eq('status', request.status).select('id').maybeSingle()
  if (changeError) throw new Error(`Could not set the status of ticket ${request.id}: ${changeError.message ?? 'unknown error'}`)
  if (!changed) return null

  // CSAT: same as updateRequestStatus() — a rule-resolved ticket gets a survey and the same
  // "resolved + how did we do?" e-mail, or the requester never hears about it or gets asked to rate it.
  if (status === 'resolved' && request.requester_id && request.org_id) {
    try {
      const { data: titleRow } = await admin.from('requests').select('title, request_no, reopen_count').eq('id', request.id).maybeSingle()
      const { issueCsat } = await import('@/lib/csat/issue')
      await issueCsat(admin as never, {
        id: request.id, requestNo: titleRow?.request_no ?? '', title: titleRow?.title ?? '', orgId: request.org_id, requesterId: request.requester_id,
      }, {
        resolutionNote: '', resolverName: ctx.ruleName ? `Business rule: ${ctx.ruleName}` : 'an automatic rule',
        reopenDeadlineIso: (update.reopen_deadline_at as string | null | undefined) ?? null, wasReopened: (titleRow?.reopen_count ?? 0) > 0, nowIso,
      })
    } catch (e) {
      console.error('[business-rules] CSAT survey creation failed', e)
    }
  }

  // Auto time-tracking: a rule-driven status change away from in_progress must
  // close any open timer the same way the interactive updateRequestStatus()
  // does — otherwise an agent's clock keeps running forever on a ticket a rule
  // just resolved/reassigned out from under them.
  // (B-07: also when the ticket is finished, whatever it was before - a timer left over from an earlier move must not run on a closed ticket)
  if ((request.status === 'in_progress' && status !== 'in_progress') || isClosedLikeStatus(status)) {
    const { error: timerError } = await admin
      .from('request_time_entries')
      .update({ stopped_at: nowIso })
      .eq('request_id', request.id)
      .is('stopped_at', null)
    if (timerError) logger.error({ event: 'rules.timer_stop_failed', message: 'The open timer could not be stopped after a rule moved the ticket', route: 'rules/actions.ts#runSetStatus', requestId: request.id, error: timerError })
  }

  await logActivity({
    requestId: request.id,
    actorId: null,   // the system, with the rule named in the details (it used to name the requester: VAPT-060)
    action: 'status_changed',
    metadata: { to: status, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName },
  })
  // a reopen is also recorded as one: it starts the ticket's SLA clock again, and the clock's start is read back from this entry (lib/sla/resolve.ts#slaClockStart)
  if (status === 'open' && (request.status === 'resolved' || request.status === 'closed')) {
    await logActivity({ requestId: request.id, actorId: null, action: 'reopened', metadata: { reason: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName } })
  }
  return {
    status: status as ActionRequest['status'],
    ...(update.waiting_since !== undefined ? { waiting_since: update.waiting_since as string | null } : {}),
    ...(update.paused_ms_total !== undefined ? { paused_ms_total: update.paused_ms_total as number } : {}),
    ...(update.reopen_count !== undefined ? { reopen_count: update.reopen_count as number } : {}),
    ...(update.response_due_at !== undefined ? { response_due_at: update.response_due_at as string } : {}),
    ...(update.resolution_due_at !== undefined ? { resolution_due_at: update.resolution_due_at as string } : {}),
    ...(update.responded_at !== undefined ? { responded_at: update.responded_at as string } : {}),
  }
}

async function runSetTeam(admin: AnyClient, request: ActionRequest, teamId: string, ctx: RuleActionContext): Promise<RequestPatch | void> {
  if (!teamId) return // rule saved with no team selected yet — nothing to do
  // the team must belong to the ticket's own organisation, whatever the saved rule says (D-031)
  if (!request.org_id) return
  if (teamId === request.team_id) return
  const { data: team } = await admin.from('teams').select('id').eq('id', teamId).eq('org_id', request.org_id).maybeSingle()
  if (!team) return
  const { error } = await admin.from('requests').update({ team_id: teamId }).eq('id', request.id)
  if (error) throw new Error(`Could not move ticket ${request.id} to another team: ${error.message ?? 'unknown error'}`)
  await logActivity({
    requestId: request.id,
    actorId: null,
    action: 'reclassified',
    metadata: { team_id: teamId, via: 'business_rule', rule_id: ctx.ruleId, rule_name: ctx.ruleName },
  })
  return { team_id: teamId }
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
        actorId: null,   // a rule sent it: no person is named as the sender (it used to name the recipient themself)
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
      const { error } = await sendEmail({
        to: email,
        subject: title,
        html: `<p>${safeBody}</p><p><a href="${absoluteAppUrl(`/requests/${request.id}`)}">View request</a></p>`,
        threadRequestNo: request.request_no,
      })
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

/**
 * Executes every action in order. A failure in one action is logged and does not stop the rest.
 * What an action changed is carried into the next one (B-20): "assign, then notify the assignee" notifies the NEW assignee, and a priority set before a status change is seen by it.
 * (executeActionsWithResult) returns how many actions were tried and how many did not fail, so a caller can tell "nothing worked" (safe to try again) from "some of it worked" (must not be repeated).
 */
export async function executeActionsWithResult(
  admin: AnyClient,
  request: ActionRequest,
  actions: RuleAction[],
  ctx: RuleActionContext
): Promise<{ attempted: number; succeeded: number }> {
  let succeeded = 0
  for (const action of actions) {
    try {
      let patch: RequestPatch | void | null = undefined
      if (action.type === 'assign') patch = await runAssign(admin, request, action.params, ctx)
      else if (action.type === 'set_priority') patch = await runSetPriority(admin, request, action.params.priority, ctx)
      else if (action.type === 'set_status') patch = await runSetStatus(admin, request, action.params.status, ctx)
      else if (action.type === 'set_team') patch = await runSetTeam(admin, request, action.params.teamId, ctx)
      else if (action.type === 'notify') await runNotify(admin, request, action.params, ctx)
      if (patch) request = { ...request, ...patch }
      succeeded++
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
  return { attempted: actions.length, succeeded }
}

/** The same, for a caller that does not need the counts. */
export async function executeActions(admin: AnyClient, request: ActionRequest, actions: RuleAction[], ctx: RuleActionContext): Promise<void> {
  await executeActionsWithResult(admin, request, actions, ctx)
}
