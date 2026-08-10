import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { BusinessRulesClient } from './BusinessRulesClient'
import type { Profile } from '@/types'

export default async function BusinessRulesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const orgId = profile.org_id ?? ''

  const [
    rulesResult,
    servicesResult,
    categoriesResult,
    subCategoriesResult,
    teamsResult,
    profilesResult,
    assignmentRulesCount,
    escalationRulesCount,
  ] = await Promise.all([
    admin.from('business_rules').select('*').eq('org_id', orgId).order('execution_order', { ascending: true }),
    admin.from('services').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('service_categories').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('service_sub_categories').select('id, name, category_id').order('name', { ascending: true }),
    admin.from('teams').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('profiles').select('id, full_name, role').eq('org_id', orgId).order('full_name', { ascending: true }),
    admin.from('assignment_rules').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
    admin.from('sla_escalation_rules').select('id', { count: 'exact', head: true }),
  ])

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Business Rules"
        description="Automate what happens when a request is created, edited, or reaches a scheduled condition — assign, change priority/status, or notify."
      />
      <BusinessRulesClient
        rules={rulesResult.data ?? []}
        services={servicesResult.data ?? []}
        categories={categoriesResult.data ?? []}
        subCategories={subCategoriesResult.data ?? []}
        teams={teamsResult.data ?? []}
        profiles={(profilesResult.data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[]}
        legacyRulesAvailable={(assignmentRulesCount.count ?? 0) + (escalationRulesCount.count ?? 0) > 0}
      />
    </div>
  )
}
