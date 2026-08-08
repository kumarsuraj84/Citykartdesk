import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { verifyCronSecret } from '@/lib/cron-auth'

export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Fetch open requests with an SLA deadline
  const { data: requests, error: reqError } = await db
    .from('requests')
    .select('id,title,created_at,resolution_due_at,priority,team_id,assigned_to,requester_id,org_id')
    .not('resolution_due_at', 'is', null)
    .not('status', 'in', '("resolved","cancelled","closed")')

  if (reqError) {
    console.error('[escalation] Failed to fetch requests', reqError.message)
    return NextResponse.json({ error: reqError.message }, { status: 500 })
  }

  // Fetch all escalation rules
  const { data: rules, error: rulesError } = await db
    .from('sla_escalation_rules')
    .select('*')

  if (rulesError) {
    console.error('[escalation] Failed to fetch rules', rulesError.message)
    return NextResponse.json({ error: rulesError.message }, { status: 500 })
  }

  const now = Date.now()
  let escalatedCount = 0

  // Cache managers/admins per org so we fetch them once per org instead of once per fired
  // escalation event (service-role bypasses RLS, so org_id filter is required for isolation).
  const managersByOrg = new Map<string | null, string[]>()
  async function getOrgManagers(orgId: string | null): Promise<string[]> {
    if (!orgId) return []
    const cached = managersByOrg.get(orgId)
    if (cached) return cached
    const { data } = await db
      .from('profiles')
      .select('id')
      .eq('org_id', orgId)
      .in('role', ['manager', 'admin'])
    const ids = (data ?? []).map((m) => m.id)
    managersByOrg.set(orgId, ids)
    return ids
  }

  for (const req of requests ?? []) {
    const createdTs = new Date(req.created_at).getTime()
    const deadlineTs = new Date(req.resolution_due_at).getTime()
    const totalDuration = deadlineTs - createdTs
    if (totalDuration <= 0) continue

    const pctElapsed = ((now - createdTs) / totalDuration) * 100

    for (const rule of rules ?? []) {
      if (rule.tier !== req.priority) continue
      if (pctElapsed < rule.trigger_pct) continue

      // Check if this escalation event already fired
      const { data: existing } = await db
        .from('sla_escalation_events')
        .select('id')
        .eq('request_id', req.id)
        .eq('rule_id', rule.id)
        .maybeSingle()

      if (existing) continue

      // Insert the escalation event
      const { error: insertError } = await db
        .from('sla_escalation_events')
        .insert({ request_id: req.id, rule_id: rule.id })

      if (insertError) {
        console.error('[escalation] Failed to insert event', insertError.message)
        continue
      }

      const notifType = pctElapsed >= 100 ? 'sla_breached' : 'sla_warning'
      const title =
        pctElapsed >= 100
          ? `SLA Breached: ${req.title}`
          : `SLA Warning (${rule.trigger_pct}%): ${req.title}`
      const body =
        pctElapsed >= 100
          ? `Request "${req.title}" has exceeded its SLA deadline.`
          : `Request "${req.title}" has reached ${rule.trigger_pct}% of its SLA time (${Math.round(pctElapsed)}% elapsed).`
      const link = `/requests/${req.id}`

      // Managers/admins for this request's org (cached across events — see getOrgManagers).
      const managerIds = await getOrgManagers(req.org_id)
      const recipientIds = [...new Set([...managerIds, req.assigned_to].filter(Boolean))] as string[]

      // System actor id: use a known system UUID or fall back to requester
      const actorId = req.requester_id

      await notify(
        recipientIds.map((recipientId) => ({
          recipientId,
          actorId,
          type: notifType,
          title,
          body,
          requestId: req.id,
          link,
        }))
      )

      escalatedCount++
    }
  }

  return NextResponse.json({
    processed: (requests ?? []).length,
    escalated: escalatedCount,
  })
}
