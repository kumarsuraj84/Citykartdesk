import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify, type NotifyInput } from '@/lib/notifications'
import { sendEmail } from '@/lib/email/send'
import { verifyCronSecret } from '@/lib/cron-auth'
import { mapWithConcurrency } from '@/lib/async/concurrency'
import type { UserRole } from '@/types'

// profiles has no `email` column in the generated schema — email is fetched
// separately via getUserEmail(). `email` is selected here for backward
// compatibility with callers that may rely on it, but is never populated.
type RoleProfile = { id: string; email?: string }

function formatDueDate(d: string | null): string {
  return d ? new Date(d).toLocaleString() : 'unknown'
}

export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  const results: Record<string, number> = {}
  // Bounds how many rows within one rule's batch are processed at once —
  // each iteration below does its own independent notification-dedup check
  // + notify + optional email round trips, previously fully sequential.
  const ALERT_ITEM_CONCURRENCY = 5

  // Fetch active alert rules
  const { data: rules } = await admin
    .from('alert_rules')
    .select('*')
    .eq('is_active', true)

  if (!rules || rules.length === 0) {
    return NextResponse.json({ ok: true, results })
  }

  // Helper: get profiles by role, scoped to one org (service-role client
  // bypasses RLS, so every query in this route must filter by org_id itself —
  // alert_rules is per-org, and each rule's own org_id is the source of truth
  // for every entity/recipient lookup inside its branch below).
  async function getProfilesByRoles(roles: string[], orgId: string | null): Promise<RoleProfile[]> {
    if (!orgId) return []
    // `email` is not part of the generated profiles Row type (no such column
    // exists on the table) — narrow-cast the response rather than the client.
    const { data } = (await admin
      .from('profiles')
      .select('id, email')
      .eq('org_id', orgId)
      .in('role', roles as unknown as UserRole[])) as unknown as { data: RoleProfile[] | null }
    return data ?? []
  }

  // Helper: get user email
  async function getUserEmail(userId: string): Promise<string | null> {
    try {
      const { data } = await admin.auth.admin.getUserById(userId)
      return data?.user?.email ?? null
    } catch {
      return null
    }
  }

  for (const rule of rules) {
    if (!rule.org_id) continue // orphaned rule with no org context — nothing safe to scope its queries to
    try {
      if (rule.alert_type === 'due_soon' && rule.entity_type === 'task') {
        // Tasks due between now and now+threshold_minutes, not done/cancelled
        const windowEnd = new Date(now.getTime() + (rule.threshold_minutes ?? 1440) * 60 * 1000)
        const { data: tasks } = await admin
          .from('tasks')
          .select('id, title, assignee_id, due_date, request_id')
          .eq('org_id', rule.org_id)
          .not('status', 'in', '("done","cancelled")')
          .gte('due_date', now.toISOString())
          .lte('due_date', windowEnd.toISOString())

        const dueSoonFlags = await mapWithConcurrency(tasks ?? [], ALERT_ITEM_CONCURRENCY, async (task) => {
          // Check if already notified in last 25 hours
          const cutoff = new Date(now.getTime() - 25 * 60 * 60 * 1000)
          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('task_id', task.id)
            .eq('type', 'task_due_soon')
            .gte('created_at', cutoff.toISOString())
            .limit(1)

          if (existing && existing.length > 0) return false

          const recipients: string[] = []
          if (rule.notify_assignee && task.assignee_id) recipients.push(task.assignee_id)
          if (rule.notify_roles?.length) {
            const roleProfiles = await getProfilesByRoles(rule.notify_roles, rule.org_id)
            recipients.push(...roleProfiles.map((p) => p.id))
          }
          const uniqueRecipients = [...new Set(recipients)]

          const notifications = uniqueRecipients.map((recipientId: string): NotifyInput => ({
            recipientId,
            actorId: recipientId,
            type: 'task_due_soon',
            title: `Task due soon: ${task.title}`,
            body: `Due at ${formatDueDate(task.due_date)}`,
            taskId: task.id,
            requestId: task.request_id ?? undefined,
            link: task.request_id ? `/requests/${task.request_id}` : undefined,
          }))

          if (notifications.length) {
            await notify(notifications)
          }

          // Email channel
          if (rule.channels?.includes('email')) {
            for (const recipientId of uniqueRecipients) {
              const email = await getUserEmail(recipientId)
              if (email) {
                await sendEmail({
                  to: email,
                  subject: `Task due soon: ${task.title}`,
                  html: `<p>Task <strong>${task.title}</strong> is due at ${formatDueDate(task.due_date)}.</p>`,
                })
              }
            }
          }

          return notifications.length > 0
        })
        results['due_soon'] = dueSoonFlags.filter(Boolean).length

      } else if (rule.alert_type === 'overdue' && rule.entity_type === 'task') {
        const { data: tasks } = await admin
          .from('tasks')
          .select('id, title, assignee_id, due_date, request_id')
          .eq('org_id', rule.org_id)
          .not('status', 'in', '("done","cancelled")')
          .lt('due_date', now.toISOString())

        const overdueFlags = await mapWithConcurrency(tasks ?? [], ALERT_ITEM_CONCURRENCY, async (task) => {
          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('task_id', task.id)
            .eq('type', 'task_overdue')
            .gte('created_at', todayStart.toISOString())
            .limit(1)

          if (existing && existing.length > 0) return false

          const recipients: string[] = []
          if (rule.notify_assignee && task.assignee_id) recipients.push(task.assignee_id)
          if (rule.notify_roles?.length) {
            const roleProfiles = await getProfilesByRoles(rule.notify_roles, rule.org_id)
            recipients.push(...roleProfiles.map((p) => p.id))
          }
          const uniqueRecipients = [...new Set(recipients)]

          const notifications = uniqueRecipients.map((recipientId: string): NotifyInput => ({
            recipientId,
            actorId: recipientId,
            type: 'task_overdue',
            title: `Task overdue: ${task.title}`,
            body: `Was due at ${formatDueDate(task.due_date)}`,
            taskId: task.id,
            requestId: task.request_id ?? undefined,
            link: task.request_id ? `/requests/${task.request_id}` : undefined,
          }))

          if (notifications.length) {
            await notify(notifications)
          }

          if (rule.channels?.includes('email')) {
            for (const recipientId of uniqueRecipients) {
              const email = await getUserEmail(recipientId)
              if (email) {
                await sendEmail({
                  to: email,
                  subject: `Task overdue: ${task.title}`,
                  html: `<p>Task <strong>${task.title}</strong> was due at ${formatDueDate(task.due_date)} and is now overdue.</p>`,
                })
              }
            }
          }

          return notifications.length > 0
        })
        results['overdue'] = overdueFlags.filter(Boolean).length

      } else if (rule.alert_type === 'due_soon' && rule.entity_type === 'milestone') {
        // Milestones ending between now and now+threshold_minutes, not done/cancelled
        const windowEnd = new Date(now.getTime() + (rule.threshold_minutes ?? 1440) * 60 * 1000)
        const { data: milestones } = await admin
          .from('milestones')
          .select('id, name, end_date, project_id, project:projects(id, name, owner_id)')
          .eq('org_id', rule.org_id)
          .not('status', 'in', '("done","cancelled")')
          .gte('end_date', now.toISOString().slice(0, 10))
          .lte('end_date', windowEnd.toISOString().slice(0, 10))

        const milestoneDueSoonFlags = await mapWithConcurrency(milestones ?? [], ALERT_ITEM_CONCURRENCY, async (milestone) => {
          const project = milestone.project as unknown as { id: string; name: string; owner_id: string } | null
          if (!project) return false

          const cutoff = new Date(now.getTime() - 25 * 60 * 60 * 1000)
          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('type', 'milestone_due_soon')
            .eq('metadata->>milestone_id', milestone.id)
            .gte('created_at', cutoff.toISOString())
            .limit(1)

          if (existing && existing.length > 0) return false

          const recipients = new Set<string>()
          if (rule.notify_assignee) recipients.add(project.owner_id)
          const { data: members } = await admin.from('project_members').select('user_id').eq('project_id', project.id)
          for (const m of members ?? []) recipients.add(m.user_id)
          if (rule.notify_roles?.length) {
            const roleProfiles = await getProfilesByRoles(rule.notify_roles, rule.org_id)
            for (const p of roleProfiles) recipients.add(p.id)
          }

          const notifications: NotifyInput[] = [...recipients].map((recipientId) => ({
            recipientId,
            actorId: recipientId,
            type: 'milestone_due_soon',
            title: `Milestone due soon: ${milestone.name}`,
            body: `"${project.name}" — due ${formatDueDate(milestone.end_date)}`,
            link: `/projects/${project.id}`,
            metadata: { milestone_id: milestone.id },
          }))

          if (notifications.length) {
            await notify(notifications)
          }

          if (rule.channels?.includes('email')) {
            for (const recipientId of recipients) {
              const email = await getUserEmail(recipientId)
              if (email) {
                await sendEmail({
                  to: email,
                  subject: `Milestone due soon: ${milestone.name}`,
                  html: `<p>Milestone <strong>${milestone.name}</strong> on project <strong>${project.name}</strong> is due ${formatDueDate(milestone.end_date)}.</p>`,
                })
              }
            }
          }

          return notifications.length > 0
        })
        results['milestone_due_soon'] = milestoneDueSoonFlags.filter(Boolean).length

      } else if (rule.alert_type === 'overdue' && rule.entity_type === 'milestone') {
        const { data: milestones } = await admin
          .from('milestones')
          .select('id, name, end_date, project_id, project:projects(id, name, owner_id)')
          .eq('org_id', rule.org_id)
          .not('status', 'in', '("done","cancelled")')
          .lt('end_date', now.toISOString().slice(0, 10))

        const milestoneOverdueFlags = await mapWithConcurrency(milestones ?? [], ALERT_ITEM_CONCURRENCY, async (milestone) => {
          const project = milestone.project as unknown as { id: string; name: string; owner_id: string } | null
          if (!project) return false

          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('type', 'milestone_overdue')
            .eq('metadata->>milestone_id', milestone.id)
            .gte('created_at', todayStart.toISOString())
            .limit(1)

          if (existing && existing.length > 0) return false

          const recipients = new Set<string>()
          if (rule.notify_assignee) recipients.add(project.owner_id)
          const { data: members } = await admin.from('project_members').select('user_id').eq('project_id', project.id)
          for (const m of members ?? []) recipients.add(m.user_id)
          if (rule.notify_roles?.length) {
            const roleProfiles = await getProfilesByRoles(rule.notify_roles, rule.org_id)
            for (const p of roleProfiles) recipients.add(p.id)
          }

          const notifications: NotifyInput[] = [...recipients].map((recipientId) => ({
            recipientId,
            actorId: recipientId,
            type: 'milestone_overdue',
            title: `Milestone overdue: ${milestone.name}`,
            body: `"${project.name}" — was due ${formatDueDate(milestone.end_date)}`,
            link: `/projects/${project.id}`,
            metadata: { milestone_id: milestone.id },
          }))

          if (notifications.length) {
            await notify(notifications)
          }

          if (rule.channels?.includes('email')) {
            for (const recipientId of recipients) {
              const email = await getUserEmail(recipientId)
              if (email) {
                await sendEmail({
                  to: email,
                  subject: `Milestone overdue: ${milestone.name}`,
                  html: `<p>Milestone <strong>${milestone.name}</strong> on project <strong>${project.name}</strong> was due ${formatDueDate(milestone.end_date)} and is now overdue.</p>`,
                })
              }
            }
          }

          return notifications.length > 0
        })
        results['milestone_overdue'] = milestoneOverdueFlags.filter(Boolean).length

      } else if (rule.alert_type === 'unassigned' && rule.entity_type === 'request') {
        const cutoff = new Date(now.getTime() - (rule.threshold_minutes ?? 120) * 60 * 1000)
        const { data: requests } = await admin
          .from('requests')
          .select('id, title, created_at')
          .eq('org_id', rule.org_id)
          .is('assigned_to', null)
          .not('status', 'in', '("resolved","cancelled","closed")')
          .lt('created_at', cutoff.toISOString())

        const unassignedFlags = await mapWithConcurrency(requests ?? [], ALERT_ITEM_CONCURRENCY, async (request) => {
          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('request_id', request.id)
            .eq('type', 'request_unassigned')
            .gte('created_at', todayStart.toISOString())
            .limit(1)

          if (existing && existing.length > 0) return false

          const roleProfiles = await getProfilesByRoles(rule.notify_roles ?? ['manager'], rule.org_id)
          const notifications: NotifyInput[] = roleProfiles.map((p) => ({
            recipientId: p.id,
            actorId: p.id,
            type: 'request_unassigned',
            title: `Unassigned request: ${request.title}`,
            body: `Request has been unassigned for over ${rule.threshold_minutes ?? 120} minutes.`,
            requestId: request.id,
            link: `/requests/${request.id}`,
          }))

          if (notifications.length) {
            await notify(notifications)
          }

          return notifications.length > 0
        })
        results['unassigned'] = unassignedFlags.filter(Boolean).length

      } else if (rule.alert_type === 'daily_digest') {
        // Only run at hour 8, once per day
        if (now.getHours() !== 8) continue

        const managers = await getProfilesByRoles(rule.notify_roles ?? ['manager', 'admin'], rule.org_id)
        if (managers.length === 0) continue

        // notifications has no org_id of its own — "already sent today" is scoped
        // by recipient instead, so one org firing its digest doesn't skip another's.
        const { data: existingDigest } = await admin
          .from('notifications')
          .select('id')
          .eq('type', 'daily_digest')
          .in('user_id', managers.map((m) => m.id))
          .gte('created_at', todayStart.toISOString())
          .limit(1)

        if (existingDigest && existingDigest.length > 0) continue

        // Build summary counts
        const [
          { count: openRequestsCount },
          { count: overdueTasksCount },
          { count: pendingApprovalsCount },
        ] = await Promise.all([
          admin.from('requests').select('id', { count: 'exact', head: true })
            .eq('org_id', rule.org_id)
            .not('status', 'in', '("resolved","cancelled","closed")'),
          admin.from('tasks').select('id', { count: 'exact', head: true })
            .eq('org_id', rule.org_id)
            .not('status', 'in', '("done","cancelled")')
            .lt('due_date', now.toISOString()),
          // approvals has no org_id of its own — scope via its parent request.
          admin.from('approvals').select('id, request:requests!inner(org_id)', { count: 'exact', head: true })
            .eq('status', 'pending')
            .eq('request.org_id', rule.org_id),
        ])

        const digestTitle = `Daily Digest — ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`
        const digestBody = `Open requests: ${openRequestsCount ?? 0} | Overdue tasks: ${overdueTasksCount ?? 0} | Pending approvals: ${pendingApprovalsCount ?? 0}`

        const notifications = managers.map((p): NotifyInput => ({
          recipientId: p.id,
          actorId: p.id,
          type: 'daily_digest',
          title: digestTitle,
          body: digestBody,
          link: '/home',
        }))

        if (notifications.length) {
          await notify(notifications)
        }

        if (rule.channels?.includes('email')) {
          const html = `
            <h2>${digestTitle}</h2>
            <ul>
              <li><strong>Open requests:</strong> ${openRequestsCount ?? 0}</li>
              <li><strong>Overdue tasks:</strong> ${overdueTasksCount ?? 0}</li>
              <li><strong>Pending approvals:</strong> ${pendingApprovalsCount ?? 0}</li>
            </ul>
            <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/home">View Dashboard</a></p>
          `
          await mapWithConcurrency(managers, ALERT_ITEM_CONCURRENCY, async (manager) => {
            const email = await getUserEmail(manager.id)
            if (email) {
              await sendEmail({
                to: email,
                subject: digestTitle,
                html,
              })
            }
          })
        }

        results['daily_digest'] = managers.length
      }
    } catch (err) {
      console.error(`[alerts/run] Error processing rule ${rule.id} (${rule.alert_type}):`, err instanceof Error ? err.message : String(err))
    }
  }

  return NextResponse.json({ ok: true, results })
}
