// The daily approval reminder (scheduled job, 10:00 every day, no days skipped). Every approver who still has approvals waiting for their decision gets ONE
// e-mail listing all of them. An approval stays out of the list as soon as it is decided by anyone (when several people were asked at once, whoever answers first
// decides it for all), or its ticket is cancelled or closed, and a step-by-step approval is listed only for the person whose turn it is. Nobody is e-mailed when
// everything waiting for them was sent today (they already got the original e-mail). The job runs once a day even if it is called twice.

import { sendEmail as realSendEmail } from '@/lib/email/send'
import { absoluteAppUrl } from '@/lib/email/notify-email'
import { approvalReminderEmail, type ReminderItem } from '@/lib/email/approval-reminder'
import { approvalLinkUrls } from '@/lib/approvals/email-link'
import { getActionableApprovalsForUser, type PendingApprovalItem } from '@/lib/queries/approvals'
import { istDay } from '@/lib/reporting/ist'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

export const LAST_RUN_KEY = 'approval_reminder_last_run'
const DAY_MS = 86_400_000

export interface ReminderDeps {
  now?: Date
  getPending?: (userId: string, role: string, orgId: string) => Promise<PendingApprovalItem[]>
  send?: (p: { to: string; subject: string; html: string; text?: string }) => Promise<{ error?: string }>
  /** a test: send ONE sample e-mail (the compiled list of the approver with most waiting) to this address only, nobody else, and do not use up today's run */
  sampleTo?: string
}

export interface ReminderResult {
  /** already sent for today (the job was called again) */
  alreadyRan?: boolean
  /** approvers who have something waiting */
  approvers: number
  /** e-mails sent */
  sent: number
  /** approvers left out because everything waiting for them was sent today */
  skippedFresh: number
  failed: number
  /** approvals listed in the e-mails sent */
  listed: number
  /** a sample was sent (to the address asked for) instead of the day's reminders */
  sampleOf?: string
}

/** Claims today's run: true for the one call that gets it. */
async function claimToday(admin: AnyClient, today: string): Promise<{ claimed: boolean; previous: string | null }> {
  const { data: row } = await admin.from('app_settings').select('value').eq('key', LAST_RUN_KEY).maybeSingle()
  const previous: string | null = row?.value ?? null
  if (previous === today) return { claimed: false, previous }
  if (previous === null) {
    const { error } = await admin.from('app_settings').insert({ key: LAST_RUN_KEY, value: today })
    return { claimed: !error, previous }
  }
  // only the call that still sees yesterday's value changes it
  const { data: updated } = await admin.from('app_settings').update({ value: today }).eq('key', LAST_RUN_KEY).eq('value', previous).select('key')
  return { claimed: (updated?.length ?? 0) > 0, previous }
}

export async function sendApprovalReminders(admin: AnyClient, deps: ReminderDeps = {}): Promise<ReminderResult> {
  const now = deps.now ?? new Date()
  const getPending = deps.getPending ?? getActionableApprovalsForUser
  const send = deps.send ?? realSendEmail
  const today = istDay(now)
  const result: ReminderResult = { approvers: 0, sent: 0, skippedFresh: 0, failed: 0, listed: 0 }

  const sample = deps.sampleTo
  const { claimed, previous } = sample ? { claimed: true, previous: null as string | null } : await claimToday(admin, today)
  if (!claimed) return { ...result, alreadyRan: true }
  const release = async () => {
    if (sample) return
    if (previous) await admin.from('app_settings').update({ value: previous }).eq('key', LAST_RUN_KEY)
    else await admin.from('app_settings').delete().eq('key', LAST_RUN_KEY)
  }

  try {
    // the people who are asked to decide something that is still waiting
    const { data: pending } = await admin.from('approvals').select('id, workflow_id').eq('status', 'pending').limit(5000)
    const workflowIds = [...new Set(((pending ?? []) as { workflow_id: string }[]).map((a) => a.workflow_id))]
    if (workflowIds.length === 0) return result
    const approverIds = new Set<string>()
    for (let i = 0; i < workflowIds.length; i += 200) {
      const { data: steps } = await admin.from('approval_workflow_steps').select('approver_user_id').in('workflow_id', workflowIds.slice(i, i + 200)).eq('approver_type', 'specific_user')
      for (const s of (steps ?? []) as { approver_user_id: string | null }[]) if (s.approver_user_id) approverIds.add(s.approver_user_id)
    }
    if (approverIds.size === 0) return result
    const { data: people } = await admin.from('profiles').select('id, full_name, role, org_id, is_active').in('id', [...approverIds])

    type Person = { id: string; full_name: string; role: string; org_id: string | null; is_active: boolean }
    let best: { p: Person; waiting: PendingApprovalItem[] } | null = null
    /** the approver's e-mail: every waiting approval, the longest waiting first, each with their own Approve / Reject links */
    const compose = (p: Person, waiting: PendingApprovalItem[]) => {
      const items: ReminderItem[] = [...waiting]
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
        .map((w) => {
          const links = approvalLinkUrls(w.approvalId, p.id)
          return {
            requestNo: w.requestNo, requestTitle: w.requestTitle, requesterName: w.requesterName, sentByName: w.sentByName,
            waitingDays: Math.max(0, Math.round((Date.parse(today) - Date.parse(istDay(w.createdAt))) / DAY_MS)),   // calendar days: sent yesterday = 1
            requestUrl: absoluteAppUrl(`/requests/${w.requestId}?tab=approvals`),
            ...(links ? { approveUrl: links.approveUrl, rejectUrl: links.rejectUrl } : {}),
          }
        })
      return approvalReminderEmail({ approverName: (p.full_name ?? '').split(' ')[0] || p.full_name, items, approvalsUrl: absoluteAppUrl('/approvals') })
    }

    for (const p of (people ?? []) as Person[]) {
      if (!p.is_active || !p.org_id) continue
      const waiting = await getPending(p.id, p.role, p.org_id)
      if (waiting.length === 0) continue
      result.approvers++
      // everything waiting for them went out today: the original e-mail was their notice
      if (!waiting.some((w) => istDay(w.createdAt) < today)) { result.skippedFresh++; continue }

      if (sample) { if (!best || waiting.length > best.waiting.length) best = { p, waiting }; continue }

      const { data: u } = await admin.auth.admin.getUserById(p.id)
      const to: string | undefined = u?.user?.email
      if (!to) { result.failed++; continue }

      const mail = compose(p, waiting)
      const res = await send({ to, subject: mail.subject, html: mail.html, text: mail.text })
      if (res.error) result.failed++
      else { result.sent++; result.listed += waiting.length }
    }
    // a test: ONE sample, to the address asked for
    if (sample && best) {
      const mail = compose(best.p, best.waiting)
      const res = await send({ to: sample, subject: `[SAMPLE of ${best.p.full_name}'s reminder] ${mail.subject}`, html: mail.html, text: mail.text })
      result.sampleOf = best.p.full_name
      if (res.error) result.failed++
      else { result.sent++; result.listed += best.waiting.length }
    }
    // nothing could be sent at all: let the next call today try again
    if (result.sent === 0 && result.failed > 0) await release()
  } catch (e) {
    await release()
    throw e
  }
  return result
}
