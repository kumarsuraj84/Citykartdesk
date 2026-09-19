import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { EventLogClient } from './EventLogClient'

export default async function EventLogPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner'].includes(profile.role)) redirect('/home')

  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('org_id', profile.org_id ?? '')
    .order('full_name')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Event Log"
        description="Page views, clicks and errors from every signed-in user, kept for 90 days. Download it and share it to trace what happened."
      />
      <EventLogClient users={(data ?? []) as { id: string; full_name: string }[]} />
    </div>
  )
}
