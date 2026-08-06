import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { getAssignmentRules } from '@/lib/queries/routing'
import { RoutingRulesClient } from './RoutingRulesClient'
import type { Profile } from '@/types'

export default async function RoutingRulesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const orgId = profile.org_id ?? ''

  const [rules, servicesResult, categoriesResult, profilesResult] = await Promise.all([
    getAssignmentRules(orgId),
    admin.from('services').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('service_categories').select('id, name, parent_id').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('profiles').select('id, full_name, role').eq('org_id', orgId).order('full_name', { ascending: true }),
  ])

  const services: { id: string; name: string }[] = servicesResult.data ?? []
  const categories: { id: string; name: string; parent_id: string | null }[] = categoriesResult.data ?? []
  const profiles: Pick<Profile, 'id' | 'full_name' | 'role'>[] = profilesResult.data ?? []

  return (
    <div className="space-y-8 max-w-5xl">
      <PageHeader
        title="Request Routing"
        description="Automatically assign new requests to the right agent based on service or category rules."
      />
      <RoutingRulesClient
        rules={rules}
        services={services}
        categories={categories}
        profiles={profiles}
      />
    </div>
  )
}
