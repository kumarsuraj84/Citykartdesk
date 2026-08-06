import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { getAuditLogs } from '@/lib/queries/admin'
import { AuditLogClient } from './AuditLogClient'
import type { Profile } from '@/types'

export default async function AuditLogPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const admin = createAdminClient()
  const orgId = profile.org_id ?? ''

  const [{ data: auditResult }, { data: profilesData }] = await Promise.all([
    getAuditLogs({ perPage: 50 }),
    admin.from('profiles').select('id, full_name').eq('org_id', orgId).order('full_name', { ascending: true }),
  ])

  const profiles = (profilesData ?? []) as Pick<Profile, 'id' | 'full_name'>[]

  return (
    <div className="space-y-8 max-w-6xl">
      <PageHeader
        title="Audit Log"
        description="Track all system activity across requests and tasks."
      />
      <AuditLogClient
        initialEntries={auditResult}
        profiles={profiles}
      />
    </div>
  )
}
