import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuditLogs } from '@/lib/queries/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { SystemLogClient } from './SystemLogClient'
import { AuditLogClient } from './AuditLogClient'
import { EventLogClient } from './EventLogClient'
import type { Profile } from '@/types'

// One place for every log. Administrators see all three tabs; managers see only the Audit Log (as before).
const TABS = [
  { key: 'system', label: 'System Log', adminOnly: true,
    description: 'One record of who changed what (with before and after values), security events, and every error — from the browser, the app, the database, storage and scheduled jobs. Audit records are kept for years and cannot be edited or deleted; errors are kept for 180 days, then archived.' },
  { key: 'audit', label: 'Audit Log', adminOnly: false,
    description: 'Activity on requests and tasks: who did what and when. The System Log tab holds this and much more — configuration, security and error records in one place, with before and after values.' },
  { key: 'events', label: 'Event Log', adminOnly: true,
    description: 'Page views, clicks and errors from every signed-in user, kept for 90 days. Browser errors and crashes are also in the System Log, together with server, database, storage and scheduled-job errors.' },
] as const

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  const isAdmin = ['admin', 'platform_owner'].includes(profile.role)
  if (!isAdmin && profile.role !== 'manager') redirect('/home')

  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly)
  const { tab: wanted } = await searchParams
  const active = tabs.find((t) => t.key === wanted) ?? tabs[0]

  const admin = createAdminClient()
  const { data: profilesData } = await admin.from('profiles').select('id, full_name').eq('org_id', profile.org_id ?? '').order('full_name', { ascending: true })
  const users = (profilesData ?? []) as Pick<Profile, 'id' | 'full_name'>[]
  const auditResult = active.key === 'audit' ? (await getAuditLogs({ perPage: 50 })).data : []

  return (
    <div className="space-y-6">
      <PageHeader title="Logs" description={active.description} />
      {tabs.length > 1 && (
        <nav className="flex gap-1 border-b border-[#E2E8F4]" aria-label="Log type">
          {tabs.map((t) => (
            <Link key={t.key} href={`/admin/logs?tab=${t.key}`} aria-current={t.key === active.key ? 'page' : undefined}
              className={`px-3 py-2 text-[13px] font-medium ${t.key === active.key ? 'border-b-2 border-[#1B2559] text-[#1B2559]' : 'text-muted-foreground hover:text-foreground'}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {active.key === 'system' && <SystemLogClient users={users} />}
      {active.key === 'audit' && <div className="max-w-6xl"><AuditLogClient initialEntries={auditResult} profiles={users} /></div>}
      {active.key === 'events' && <EventLogClient users={users} />}
    </div>
  )
}
