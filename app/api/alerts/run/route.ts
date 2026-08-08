import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify, type NotifyInput } from '@/lib/notifications'
import { sendEmail } from '@/lib/email/send'
import type { NotificationType, UserRole } from '@/types'

// notify() requires NotificationType, but these alert-generated notifications
// use values that predate the enum (see the `notification_type_gaps` migration
// comment — they are known DB-insert no-ops, unrelated to this lint pass).
type LegacyAlertNotificationType = 'task_due_soon' | 'task_overdue' | 'daily_digest'
function asNotificationType(type: LegacyAlertNotificationType): NotificationType {
  return type as unknown as NotificationType
}

// profiles has no `email` column in the generated schema — email is fetched
// separately via getUserEmail(). `email` is selected here for backward
// compatibility with callers that may rely on it, but is never populated.
type RoleProfile = { id: string; email?: string }

function formatDueDate(d: string | null): string {
  return d ? new Date(d).toLocaleString() : 'unknown'
}

export async function GET(req: NextRequest) {
  // CRON_SECRET must be configured — no secret = no access (prevents open cron endpoints)
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  const secret = req.headers.get('x-cron-secret')
  if (secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  const results: Record<string, number> = {}

  // Fetch active alert rules
  const { data: rules } = await admin
    .from('alert_rules')
    .select('*')
    .eq('is_active', true)

  if (!rules || rules.length === 0) {
    return NextResponse.json({ ok: true, results })
  }

  // Helper: get profiles by role
  async function getProfilesByRoles(roles: string[]): Promise<RoleProfile[]> {
    // `email` is not part of the generated profiles Row type (no such column
    // exists on the table) — narrow-cast the response rather than the client.
    const { data } = (await admin
      .from('profiles')
      .select('id, email')
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
    try {
      if (rule.alert_type === 'due_soon' && rule.entity_type === 'task') {
        // Tasks due between now and now+threshold_minutes, not done/cancelled
        const windowEnd = new Date(now.getTime() + (rule.threshold_minutes ?? 1440) * 60 * 1000)
        const { data: tasks } = await admin
          .from('tasks')
          .select('id, title, assignee_id, due_date, request_id')
          .not('status', 'in', '("done","cancelled")')
          .gte('due_date', now.toISOString())
          .lte('due_date', windowEnd.toISOString())

        let count = 0
        for (const task of tasks ?? []) {
          // Check if already notified in last 25 hours
          const cutoff = new Date(now.getTime() - 25 * 60 * 60 * 1000)
          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('task_id', task.id)
            .eq('type', asNotificationType('task_due_soon'))
            .gte('created_at', cutoff.toISOString())
            .limit(1)

          if (existing && existing.length > 0) continue

          const recipients: string[] = []
          if (rule.notify_assignee && task.assignee_id) recipients.push(task.assignee_id)
          if (rule.notify_roles?.length) {
            const roleProfiles = await getProfilesByRoles(rule.notify_roles)
            recipients.push(...roleProfiles.map((p) => p.id))
          }
          const uniqueRecipients = [...new Set(recipients)]

          const notifications = uniqueRecipients.map((recipientId: string) => ({
            recipientId,
            actorId: recipientId,
            type: asNotificationType('task_due_soon'),
            title: `Task due soon: ${task.title}`,
            body: `Due at ${formatDueDate(task.due_date)}`,
            taskId: task.id,
            requestId: task.request_id ?? undefined,
            link: task.request_id ? `/requests/${task.request_id}` : undefined,
          }))

          if (notifications.length) {
            await notify(notifications)
            count++
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
        }
        results['due_soon'] = count

      } else if (rule.alert_type === 'overdue' && rule.entity_type === 'task') {
        const { data: tasks } = await admin
          .from('tasks')
          .select('id, title, assignee_id, due_date, request_id')
          .not('status', 'in', '("done","cancelled")')
          .lt('due_date', now.toISOString())

        let count = 0
        for (const task of tasks ?? []) {
          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('task_id', task.id)
            .eq('type', asNotificationType('task_overdue'))
            .gte('created_at', todayStart.toISOString())
            .limit(1)

          if (existing && existing.length > 0) continue

          const recipients: string[] = []
          if (rule.notify_assignee && task.assignee_id) recipients.push(task.assignee_id)
          if (rule.notify_roles?.length) {
            const roleProfiles = await getProfilesByRoles(rule.notify_roles)
            recipients.push(...roleProfiles.map((p) => p.id))
          }
          const uniqueRecipients = [...new Set(recipients)]

          const notifications = uniqueRecipients.map((recipientId: string) => ({
            recipientId,
            actorId: recipientId,
            type: asNotificationType('task_overdue'),
            title: `Task overdue: ${task.title}`,
            body: `Was due at ${formatDueDate(task.due_date)}`,
            taskId: task.id,
            requestId: task.request_id ?? undefined,
            link: task.request_id ? `/requests/${task.request_id}` : undefined,
          }))

          if (notifications.length) {
            await notify(notifications)
            count++
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
        }
        results['overdue'] = count

      } else if (rule.alert_type === 'due_soon' && rule.entity_type === 'milestone') {
        // Milestones ending between now and now+threshold_minutes, not done/cancelled
        const windowEnd = new Date(now.getTime() + (rule.threshold_minutes ?? 1440) * 60 * 1000)
        const { data: milestones } = await admin
          .from('milestones')
          .select('id, name, end_date, project_id, project:projects(id, name, owner_id)')
          .not('status', 'in', '("done","cancelled")')
          .gte('end_date', now.toISOString().slice(0, 10))
          .lte('end_date', windowEnd.toISOString().slice(0, 10))

        let count = 0
        for (const milestone of milestones ?? []) {
          const project = milestone.project as unknown as { id: string; name: string; owner_id: string } | null
          if (!project) continue

          const cutoff = new Date(now.getTime() - 25 * 60 * 60 * 1000)
          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('type', 'milestone_due_soon')
            .eq('metadata->>milestone_id', milestone.id)
            .gte('created_at', cutoff.toISOString())
            .limit(1)

          if (existing && existing.length > 0) continue

          const recipients = new Set<string>()
          if (rule.notify_assignee) recipients.add(project.owner_id)
          const { data: members } = await admin.from('project_members').select('user_id').eq('project_id', project.id)
          for (const m of members ?? []) recipients.add(m.user_id)
          if (rule.notify_roles?.length) {
            const roleProfiles = await getProfilesByRoles(rule.notify_roles)
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
            count++
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
        }
        results['milestone_due_soon'] = count

      } else if (rule.alert_type === 'overdue' && rule.entity_type === 'milestone') {
        const { data: milestones } = await admin
          .from('milestones')
          .select('id, name, end_date, project_id, project:projects(id, name, owner_id)')
          .not('status', 'in', '("done","cancelled")')
          .lt('end_date', now.toISOString().slice(0, 10))

        let count = 0
        for (const milestone of milestones ?? []) {
          const project = milestone.project as unknown as { id: string; name: string; owner_id: string } | null
          if (!project) continue

          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('type', 'milestone_overdue')
            .eq('metadata->>milestone_id', milestone.id)
            .gte('created_at', todayStart.toISOString())
            .limit(1)

          if (existing && existing.length > 0) continue

          const recipients = new Set<string>()
          if (rule.notify_assignee) recipients.add(project.owner_id)
          const { data: members } = await admin.from('project_members').select('user_id').eq('project_id', project.id)
          for (const m of members ?? []) recipients.add(m.user_id)
          if (rule.notify_roles?.length) {
            const roleProfiles = await getProfilesByRoles(rule.notify_roles)
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
            count++
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
        }
        results['milestone_overdue'] = count

      } else if (rule.alert_type === 'unassigned' && rule.entity_type === 'request') {
        const cutoff = new Date(now.getTime() - (rule.threshold_minutes ?? 120) * 60 * 1000)
        const { data: requests } = await admin
          .from('requests')
          .select('id, title, created_at')
          .is('assigned_to', null)
          .not('status', 'in', '("resolved","cancelled","closed")')
          .lt('created_at', cutoff.toISOString())

        let count = 0
        for (const request of requests ?? []) {
          const { data: existing } = await admin
            .from('notifications')
            .select('id')
            .eq('request_id', request.id)
            .eq('type', 'request_unassigned')
            .gte('created_at', todayStart.toISOString())
            .limit(1)

          if (existing && existing.length > 0) continue

          const roleProfiles = await getProfilesByRoles(rule.notify_roles ?? ['manager'])
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
            count++
          }
        }
        results['unassigned'] = count

      } else if (rule.alert_type === 'daily_digest') {
        // Only run at hour 8, once per day
        if (now.getHours() !== 8) continue

        const { data: existingDigest } = await admin
          .from('notifications')
          .select('id')
          .eq('type', asNotificationType('daily_digest'))
          .gte('created_at', todayStart.toISOString())
          .limit(1)

        if (existingDigest && existingDigest.length > 0) continue

        const managers = await getProfilesByRoles(rule.notify_roles ?? ['manager', 'admin'])

        // Build summary counts
        const [
          { count: openRequestsCount },
          { count: overdueTasksCount },
          { count: pendingApprovalsCount },
        ] = await Promise.all([
          admin.from('requests').select('id', { count: 'exact', head: true })
            .not('status', 'in', '("resolved","cancelled","closed")'),
          admin.from('tasks').select('id', { count: 'exact', head: true })
            .not('status', 'in', '("done","cancelled")')
            .lt('due_date', now.toISOString()),
          admin.from('approvals').select('id', { count: 'exact', head: true })
            .eq('status', 'pending'),
        ])

        const digestTitle = `Daily Digest — ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`
        const digestBody = `Open requests: ${openRequestsCount ?? 0} | Overdue tasks: ${overdueTasksCount ?? 0} | Pending approvals: ${pendingApprovalsCount ?? 0}`

        const notifications = managers.map((p) => ({
          recipientId: p.id,
          actorId: p.id,
          type: asNotificationType('daily_digest'),
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
          for (const manager of managers) {
            const email = await getUserEmail(manager.id)
            if (email) {
              await sendEmail({
                to: email,
                subject: digestTitle,
                html,
              })
            }
          }
        }

        results['daily_digest'] = managers.length
      }
    } catch (err) {
      console.error(`[alerts/run] Error processing rule ${rule.id} (${rule.alert_type}):`, err instanceof Error ? err.message : String(err))
    }
  }

  return NextResponse.json({ ok: true, results })
}
