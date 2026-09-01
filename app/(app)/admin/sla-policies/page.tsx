import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getSlaPolicies } from '@/lib/queries/services'
import SlaPoliciesAdminClient from './SlaPoliciesAdminClient'

export default async function AdminSlaPoliciesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const policies = await getSlaPolicies()

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA Policies"
        description="Create a named response/resolution table once, then map it onto any Service in Service Catalog — every service mapped to it shares the same targets."
        breadcrumbs={[{ label: 'Admin' }, { label: 'SLA Policies' }]}
      />
      <SlaPoliciesAdminClient policies={policies} />
    </div>
  )
}
