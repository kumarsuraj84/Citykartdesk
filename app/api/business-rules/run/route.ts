import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { computeElapsedBusinessMinutes, pauseCreditMs } from '@/lib/sla/business-hours'
import { slaClockStart } from '@/lib/sla/resolve'
import { matchesConditions, type RuleCondition, type RuleConditionsLogic } from '@/lib/rules/evaluate'
import { executeActionsWithResult, type RuleAction } from '@/lib/rules/actions'
import { buildRuleEvaluationRequest, toActionRequest, RULE_REQUEST_SELECT, type RawRequest } from '@/lib/rules/run'
import { isSlaPausedStatus, CLOSED_LIKE_REQUEST_STATUSES } from '@/lib/constants/requests'
import { fetchAllPages } from '@/lib/queries/paging'
import { logger } from '@/lib/observability/logger'
import { alertOperator } from '@/lib/observability/alert'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

type BusinessRuleRow = {
  id: string
  name: string
  org_id: string
  schedule_check: 'sla_pct_elapsed' | 'unassigned_minutes'
  schedule_threshold: number
  conditions: RuleCondition[]
  conditions_logic: RuleConditionsLogic
  actions: RuleAction[]
}

/**
 * Evaluates every active `schedule`-trigger business rule against the requests
 * it applies to — the schedule-trigger counterpart to the `created`/`updated`
 * triggers run inline from lib/actions/requests.ts. Same verifyCronSecret +
 * admin-client pattern as app/api/alerts/run;
 * registered as the `business-rules` job in scripts/cron-tick.mjs.
 */
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient() as unknown as AnyClient
  const now = new Date()
  let fired = 0

  const { data: rules, error: rulesError } = await admin
    .from('business_rules')
    .select('id, name, org_id, schedule_check, schedule_threshold, conditions, conditions_logic, actions')
    .contains('trigger', ['schedule'])
    .eq('is_active', true)

  // G-11: a failed read of the rules is a failure, not "there are no scheduled rules tonight" (it used to answer ok:true with nothing processed)
  if (rulesError) {
    logger.error({
      event: 'cron.business_rules.rules_unreadable',
      message: 'The scheduled Business Rules could not be read',
      route: 'app/api/business-rules/run',
      errorCode: 'business_rules_read_failed',
      error: rulesError,
    })
    return NextResponse.json({ ok: false, error: 'The scheduled Business Rules could not be read.', fired: 0, processed: 0, succeeded: 0, failed: 0, failures: [] }, { status: 500 })
  }

  // DESK-OBS-001 — same cron-health semantics as app/api/alerts/run: per-rule
  // isolation already existed (one rule's exception doesn't stop the loop),
  // but the response never distinguished "every rule failed" from "nothing
  // fired tonight." succeeded/failed/failures[] make that machine-detectable.
  const allRules = (rules ?? []) as BusinessRuleRow[]
  let succeeded = 0
  const failures: Array<{ ruleId: string; scheduleCheck: string; code: string }> = []

  for (const rule of allRules) {
    try {
      if (rule.schedule_check === 'sla_pct_elapsed') {
        fired += await runSlaPctElapsed(admin, rule, now)
      } else if (rule.schedule_check === 'unassigned_minutes') {
        fired += await runUnassignedMinutes(admin, rule, now)
      }
      succeeded++
    } catch (e) {
      const code = `business_rule_${rule.schedule_check}_failed`
      failures.push({ ruleId: rule.id, scheduleCheck: rule.schedule_check, code })
      logger.error({
        event: 'cron.business_rules.rule_failed',
        message: `Rule ${rule.id} (${rule.schedule_check}) failed`,
        route: 'app/api/business-rules/run',
        orgId: rule.org_id,
        errorCode: code,
        context: { ruleId: rule.id, scheduleCheck: rule.schedule_check },
        error: e,
      })
    }
  }

  const processed = allRules.length
  const failed = failures.length

  if (processed > 0 && failed === processed) {
    await alertOperator({
      key: 'cron.business_rules.total_failure',
      severity: 'critical',
      title: `Business-rules cron: all ${failed} scheduled rule(s) failed`,
      detail: { processed, failed, failures },
    })
  }

  return NextResponse.json(
    { ok: failed < processed || processed === 0, fired, processed, succeeded, failed, failures },
    { status: processed > 0 && failed === processed ? 502 : 200 }
  )
}

/** The tickets this rule has already acted on (one read per rule instead of one per ticket). The unique claim row below stays the real guard. */
async function firedTickets(admin: AnyClient, ruleId: string): Promise<Set<string>> {
  const { rows } = await fetchAllPages<{ request_id: string }>((from, to) =>
    admin.from('business_rule_events').select('request_id').eq('rule_id', ruleId).order('request_id', { ascending: true }).range(from, to)
  )
  return new Set(rows.map((r) => r.request_id))
}

async function fireRule(admin: AnyClient, rule: BusinessRuleRow, request: RawRequest, fired: Set<string>): Promise<boolean> {
  if (fired.has(request.id)) return false

  // B-25 / H-01: the very same facts the created/updated rules are checked against (AC, vendor, store ... included), from one shared builder
  const evalRequest = await buildRuleEvaluationRequest(admin, request)
  if (!matchesConditions(evalRequest, rule.conditions ?? [], rule.conditions_logic)) return false

  const actionRequest = toActionRequest(request)
  // D-042 / D-063: the "already fired" record is written FIRST, as a claim (the table is unique on rule + ticket). Two overlapping runs can no
  // longer both act: the one that loses the claim skips.
  const { error: claimError } = await admin.from('business_rule_events').insert({ rule_id: rule.id, request_id: request.id })
  if (claimError) {
    if (claimError.code === '23505') return false
    throw new Error(`Could not record rule ${rule.id} as fired: ${claimError.message ?? 'unknown error'}`)
  }
  fired.add(request.id)
  // G-11: the claim is kept once any action has happened. Removing it after a partial success made the next run repeat the actions that already worked
  // (a second assignment, a second e-mail). It is removed only when NOTHING worked, so the ticket is tried again.
  let result: Awaited<ReturnType<typeof executeActionsWithResult>>
  try {
    result = await executeActionsWithResult(admin, actionRequest, rule.actions ?? [], { ruleId: rule.id, ruleName: rule.name, trigger: 'schedule' })
  } catch (e) {
    logger.error({
      event: 'cron.business_rules.actions_threw',
      message: `Rule ${rule.id} threw while running its actions; the "already fired" record is kept so nothing is repeated`,
      route: 'app/api/business-rules/run',
      requestId: request.id,
      orgId: rule.org_id,
      errorCode: 'business_rule_actions_threw',
      error: e,
    })
    throw e
  }
  if (result.attempted > 0 && result.succeeded === 0) {
    const { error: releaseError } = await admin.from('business_rule_events').delete().eq('rule_id', rule.id).eq('request_id', request.id)
    if (!releaseError) fired.delete(request.id)
  }
  return true
}

const CLOSED_SQL_LIST = `(${CLOSED_LIKE_REQUEST_STATUSES.map((st) => `"${st}"`).join(',')})`

/** Every open ticket of the organisation that matches the filter, page by page (a plain select stops at 1000 rows). A failed page throws. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openTickets(admin: AnyClient, orgId: string, narrow: (q: any) => any): Promise<RawRequest[]> {
  const { rows } = await fetchAllPages<RawRequest>((from, to) =>
    narrow(
      admin.from('requests').select(RULE_REQUEST_SELECT).eq('org_id', orgId).not('status', 'in', CLOSED_SQL_LIST)
    ).order('id', { ascending: true }).range(from, to)
  )
  return rows
}

async function runSlaPctElapsed(admin: AnyClient, rule: BusinessRuleRow, now: Date): Promise<number> {
  const requests = await openTickets(admin, rule.org_id, (q) => q.not('resolution_due_at', 'is', null))
  const fired = await firedTickets(admin, rule.id)

  let count = 0
  for (const request of requests) {
    if (fired.has(request.id)) continue
    // a reopened ticket's clock started when it was reopened, not when it was created (its deadline was counted from then)
    const startedAt = await slaClockStart(admin, request)
    const deadlineAt = new Date(request.resolution_due_at!)
    if (deadlineAt <= startedAt) continue

    // F-14: the deadline already includes the pauses that ended (paused_ms_total), so they come off the length; the elapsed side must not count paused time either,
    // including a pause still going on (that one is added to the deadline only when it ends). Without this a paused ticket's percentage climbed past 100.
    const creditMin = Number(request.paused_ms_total ?? 0) / 60_000
    const livePauseMin = request.waiting_since && isSlaPausedStatus(request.status) ? (await pauseCreditMs(new Date(request.waiting_since), now)) / 60_000 : 0
    const totalBusinessMinutes = await computeElapsedBusinessMinutes(startedAt, deadlineAt)
    const slaLengthMinutes = totalBusinessMinutes - creditMin
    const pctElapsed =
      slaLengthMinutes > 0
        ? (Math.max(0, (await computeElapsedBusinessMinutes(startedAt, now)) - creditMin - livePauseMin) / slaLengthMinutes) * 100
        : (Math.max(0, now.getTime() - startedAt.getTime() - creditMin * 60_000 - livePauseMin * 60_000) / Math.max(1, deadlineAt.getTime() - startedAt.getTime() - creditMin * 60_000)) * 100

    if (pctElapsed < rule.schedule_threshold) continue
    if (await fireRule(admin, rule, request, fired)) count++
  }
  return count
}

async function runUnassignedMinutes(admin: AnyClient, rule: BusinessRuleRow, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - rule.schedule_threshold * 60 * 1000)
  const requests = await openTickets(admin, rule.org_id, (q) => q.is('assigned_to', null).lt('created_at', cutoff.toISOString()))
  const fired = await firedTickets(admin, rule.id)

  let count = 0
  for (const request of requests) {
    if (await fireRule(admin, rule, request, fired)) count++
  }
  return count
}
