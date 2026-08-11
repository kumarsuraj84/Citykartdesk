import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { resolveFormSections } from '@/lib/forms/sections'
import { BusinessRulesClient, type RuleFormFieldRef } from './BusinessRulesClient'
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
    servicesWithFormsResult,
    categoriesResult,
    subCategoriesResult,
    teamsResult,
    profilesResult,
    departmentsResult,
    locationsResult,
    designationsResult,
    functionsResult,
    assignmentRulesCount,
    escalationRulesCount,
  ] = await Promise.all([
    admin.from('business_rules').select('*').eq('org_id', orgId).order('execution_order', { ascending: true }),
    admin.from('services').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('services').select('id, name, form_sections, form_fields').eq('org_id', orgId).eq('is_active', true),
    admin.from('service_categories').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('service_sub_categories').select('id, name, category_id').order('name', { ascending: true }),
    admin.from('teams').select('id, name').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('profiles').select('id, full_name, role').eq('org_id', orgId).order('full_name', { ascending: true }),
    admin.from('departments').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('locations').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('designations').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('job_functions').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name', { ascending: true }),
    admin.from('assignment_rules').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
    admin.from('sla_escalation_rules').select('id', { count: 'exact', head: true }),
  ])

  // Flatten every active service's form fields into one lookup list for the
  // Conditions builder's "custom field" picker, grouped by service in the UI.
  const formFields: RuleFormFieldRef[] = (servicesWithFormsResult.data ?? []).flatMap(
    (service: { id: string; name: string; form_sections: unknown; form_fields: unknown }) =>
      resolveFormSections(service).flatMap((section) =>
        section.fields.map((field) => ({
          id: field.id,
          label: field.label,
          type: field.type,
          options: field.options,
          serviceId: service.id,
          serviceName: service.name,
        }))
      )
  )

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
        departments={departmentsResult.data ?? []}
        locations={locationsResult.data ?? []}
        designations={designationsResult.data ?? []}
        functions={functionsResult.data ?? []}
        formFields={formFields}
        legacyRulesAvailable={(assignmentRulesCount.count ?? 0) + (escalationRulesCount.count ?? 0) > 0}
      />
    </div>
  )
}
