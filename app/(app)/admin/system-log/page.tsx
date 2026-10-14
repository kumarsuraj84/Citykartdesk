import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { SystemLogClient } from './SystemLogClient'

export default async function SystemLogPage() {
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
        title="System Log"
        description="One record of who changed what (with before and after values), security events, and every error — from the browser, the app, the database, storage and scheduled jobs. Audit records are kept for years and cannot be edited or deleted; errors are kept for 180 days, then archived."
      />
      <SystemLogClient users={(data ?? []) as { id: string; full_name: string }[]} />
    </div>
  )
}
