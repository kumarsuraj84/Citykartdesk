import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { getServiceFormFieldsForOrg } from '@/lib/forms/sections'
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
    agentsResult,
    departmentsResult,
    locationsResult,
    designationsResult,
    functionsResult,
    projectsResult,
    templatesResult,
    assignmentRulesCount,
    escalationRulesCount,
    formFields,
  ] = await Promise.all([
    admin.from('business_rules').select('*').eq('org_id', orgId).order('execution_order', { ascending: true }),
    admin.from('services').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('service_categories').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('service_sub_categories').select('id, name, category_id').order('name', { ascending: true }),
    admin.from('teams').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('profiles').select('id, full_name, role').eq('org_id', orgId).order('full_name', { ascending: true }),
    // Agent-tier only — for the "Assign to" action's picker and the Technician
    // *condition* picker. Distinct from `profiles` above (the Requester
    // condition picker), which deliberately stays unfiltered since a requester
    // is normally a plain 'user', not an agent.
    admin.from('profiles').select('id, full_name, role').eq('org_id', orgId).in('role', ['agent', 'manager', 'admin', 'platform_owner']).order('full_name', { ascending: true }),
    admin.from('departments').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('locations').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('designations').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('job_functions').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('projects').select('id, name').eq('org_id', orgId).is('archived_at', null).order('name', { ascending: true }),
    admin.from('form_templates').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('assignment_rules').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
    admin.from('sla_escalation_rules').select('id', { count: 'exact', head: true }),
    // Every active service's custom intake-form fields — the shared source
    // also used by the Report Builder, so a field added to a service's form
    // shows up as a condition here with no code change.
    getServiceFormFieldsForOrg(admin, orgId),
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
        agents={(agentsResult.data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[]}
        departments={departmentsResult.data ?? []}
        locations={locationsResult.data ?? []}
        designations={designationsResult.data ?? []}
        functions={functionsResult.data ?? []}
        projects={projectsResult.data ?? []}
        templates={templatesResult.data ?? []}
        formFields={formFields}
        legacyRulesAvailable={(assignmentRulesCount.count ?? 0) + (escalationRulesCount.count ?? 0) > 0}
      />
    </div>
  )
}
