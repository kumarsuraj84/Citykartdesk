/**
 * D-07 — the alerts cron route (app/api/alerts/run/route.ts) called notify()
 * (the in-app bell notification) unconditionally for every branch, only
 * gating the separate direct sendEmail() call on rule.channels.includes
 * ('email'). Unchecking "In-App" on an alert rule therefore had no effect —
 * recipients still got a bell notification regardless of what the rule's
 * channel toggles said.
 *
 * Fix: notifyRespectingChannels() always calls notify() (so the existing
 * created_at-window dedup check each branch relies on keeps working — an
 * email-only rule must not resend on every cron tick just because no row
 * ever got created) and, when 'in_app' isn't selected, immediately archives
 * the just-inserted row (read_at + archived_at) so it doesn't surface as an
 * unread bell notification.
 *
 * Calls the real route's exported GET handler directly (not over HTTP) with
 * a constructed NextRequest carrying the correct cron secret.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

describe('D-07: alert rule channels are respected', () => {
  let fx: D03Fixtures
  const ruleIds: string[] = []
  const taskIds: string[] = []
  let deactivatedRuleIds: string[] = []

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    // The shared test org ships with real, always-active default alert
    // rules (e.g. "Task Overdue") that would independently process this
    // same task and corrupt the dedup-check assertions below — deactivate
    // them for the duration of this suite, restored in afterAll.
    const admin = getAdmin()
    const { data: seeded } = await admin
      .from('alert_rules')
      .select('id')
      .eq('org_id', fx.orgId)
      .eq('is_active', true)
    deactivatedRuleIds = (seeded ?? []).map((r) => r.id)
    if (deactivatedRuleIds.length > 0) {
      await admin.from('alert_rules').update({ is_active: false }).in('id', deactivatedRuleIds)
    }
  }, 60_000)

  afterAll(async () => {
    const admin = getAdmin()
    if (ruleIds.length > 0) await admin.from('alert_rules').delete().in('id', ruleIds)
    if (taskIds.length > 0) await admin.from('tasks').delete().in('id', taskIds)
    if (deactivatedRuleIds.length > 0) {
      await admin.from('alert_rules').update({ is_active: true }).in('id', deactivatedRuleIds)
    }
    await fx.cleanup()
  }, 60_000)

  async function runAlertsCron() {
    const { GET } = await import('@/app/api/alerts/run/route')
    const req = new NextRequest('http://localhost/api/alerts/run', {
      headers: { 'x-cron-secret': process.env.CRON_SECRET! },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    return res.json()
  }

  it('an email-only rule (in_app unchecked) does not create a visible bell notification, and does not resend on a second tick', async () => {
    const admin = getAdmin()

    const { data: rule } = await admin
      .from('alert_rules')
      .insert({
        name: 'D-07 email-only overdue',
        alert_type: 'overdue',
        entity_type: 'task',
        notify_assignee: true,
        notify_roles: [],
        channels: ['email'], // in_app deliberately NOT selected
        is_active: true,
        org_id: fx.orgId,
      })
      .select('id')
      .single()
    ruleIds.push(rule!.id)

    const { data: task } = await admin
      .from('tasks')
      .insert({
        title: 'D-07 overdue task',
        task_type: 'personal',
        created_by: fx.agentA.id,
        assignee_id: fx.agentA.id,
        org_id: fx.orgId,
        due_date: new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10),
        status: 'open',
      })
      .select('id')
      .single()
    taskIds.push(task!.id)

    await runAlertsCron()

    const { data: rows1 } = await admin
      .from('notifications')
      .select('id, read_at, archived_at')
      .eq('user_id', fx.agentA.id)
      .eq('task_id', task!.id)
      .eq('type', 'task_overdue')
    expect(rows1).toHaveLength(1)
    expect(rows1![0].read_at).not.toBeNull()
    expect(rows1![0].archived_at).not.toBeNull()

    // Second cron tick — the dedup check must find the (now-archived) row
    // and skip re-processing, proving the email won't resend indefinitely.
    await runAlertsCron()

    const { data: rows2 } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', fx.agentA.id)
      .eq('task_id', task!.id)
      .eq('type', 'task_overdue')
    expect(rows2).toHaveLength(1)

    // Deactivate this rule before the next test — alert_rules aren't scoped
    // to a specific task, so leaving it active would have it independently
    // (and correctly, but confusingly for this test) reprocess the next
    // test's task too.
    await admin.from('alert_rules').update({ is_active: false }).eq('id', rule!.id)
  })

  it('an in_app + email rule creates a normal, unread, unarchived bell notification', async () => {
    const admin = getAdmin()

    const { data: rule } = await admin
      .from('alert_rules')
      .insert({
        name: 'D-07 in-app overdue',
        alert_type: 'overdue',
        entity_type: 'task',
        notify_assignee: true,
        notify_roles: [],
        channels: ['in_app', 'email'],
        is_active: true,
        org_id: fx.orgId,
      })
      .select('id')
      .single()
    ruleIds.push(rule!.id)

    const { data: task } = await admin
      .from('tasks')
      .insert({
        title: 'D-07 overdue task (in-app)',
        task_type: 'personal',
        created_by: fx.agentB.id,
        assignee_id: fx.agentB.id,
        org_id: fx.orgId,
        due_date: new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10),
        status: 'open',
      })
      .select('id')
      .single()
    taskIds.push(task!.id)

    await runAlertsCron()

    const { data: rows } = await admin
      .from('notifications')
      .select('id, read_at, archived_at')
      .eq('user_id', fx.agentB.id)
      .eq('task_id', task!.id)
      .eq('type', 'task_overdue')
    expect(rows).toHaveLength(1)
    expect(rows![0].read_at).toBeNull()
    expect(rows![0].archived_at).toBeNull()
  })
})
