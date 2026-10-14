import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuditLogs } from '@/lib/queries/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { SystemLogClient } from './SystemLogClient'
import { AuditLogClient } from './AuditLogClient'
import { EventLogClient } from './EventLogClient'
import { resolveLogsView } from '@/lib/syslog/log-tabs'
import type { Profile } from '@/types'

// One place for every log. The System Log holds the important records; its "Ticket and task activity" view is what the old Audit Log tab showed. The Event Log (page views
// and clicks, kept for a short time) stays separate because it is bulky. Administrators see both tabs; a manager sees the ticket and task activity only.
const DESCRIPTIONS = {
  all: 'One record of who changed what (with before and after values), security events, and every error — from the browser, the app, the database, storage and scheduled jobs. Audit records are kept for years and cannot be edited or deleted; errors are kept for the number of days set in Platform Settings, then archived.',
  activity: 'Ticket and task activity: who did what and when.',
  events: 'Page views, clicks and errors from every signed-in user, kept for the number of days set in Platform Settings. Browser errors and crashes are also in the System Log, together with server, database, storage and scheduled-job errors.',
} as const

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  const { tab, view } = await searchParams
  const resolved = resolveLogsView(profile.role, tab, view)
  if (!resolved) redirect('/home')

  const admin = createAdminClient()
  const { data: profilesData } = await admin.from('profiles').select('id, full_name').eq('org_id', profile.org_id ?? '').order('full_name', { ascending: true })
  const users = (profilesData ?? []) as Pick<Profile, 'id' | 'full_name'>[]
  const showActivity = resolved.tab === 'system' && resolved.view === 'activity'
  const auditResult = showActivity ? (await getAuditLogs({ perPage: 50 })).data : []

  const tabs = [{ key: 'system', label: 'System Log' }, ...(resolved.isAdmin ? [{ key: 'events', label: 'Event Log' }] : [])]
  const views = [{ key: 'all', label: 'All records', href: '/admin/logs?tab=system' }, { key: 'activity', label: 'Ticket and task activity', href: '/admin/logs?tab=system&view=activity' }]

  return (
    <div className="space-y-6">
      <PageHeader title="Logs" description={resolved.tab === 'events' ? DESCRIPTIONS.events : DESCRIPTIONS[resolved.view]} />
      {tabs.length > 1 && (
        <nav className="flex gap-1 border-b border-[#E2E8F4]" aria-label="Log type">
          {tabs.map((t) => (
            <Link key={t.key} href={`/admin/logs?tab=${t.key}`} aria-current={t.key === resolved.tab ? 'page' : undefined}
              className={`px-3 py-2 text-[13px] font-medium ${t.key === resolved.tab ? 'border-b-2 border-[#1B2559] text-[#1B2559]' : 'text-muted-foreground hover:text-foreground'}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {resolved.tab === 'system' && resolved.isAdmin && (
        <div className="inline-flex rounded-lg border border-[#E2E8F4] bg-[#F8FAFD] p-0.5" role="group" aria-label="Which records">
          {views.map((v) => (
            <Link key={v.key} href={v.href} aria-current={v.key === resolved.view ? 'true' : undefined}
              className={`rounded-md px-3 py-1 text-[12px] font-medium ${v.key === resolved.view ? 'bg-white text-[#1B2559] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {v.label}
            </Link>
          ))}
        </div>
      )}
      {resolved.tab === 'system' && resolved.view === 'all' && <SystemLogClient users={users} />}
      {showActivity && <div className="max-w-6xl"><AuditLogClient initialEntries={auditResult} profiles={users} /></div>}
      {resolved.tab === 'events' && <EventLogClient users={users} />}
    </div>
  )
}
