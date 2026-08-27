import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getFormTemplates } from '@/lib/queries/services'
import FormTemplatesAdminClient from './FormTemplatesAdminClient'

export default async function AdminFormTemplatesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const templates = await getFormTemplates()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Form Templates"
        description="Design a form once, then tag any service to it from Service Catalog — editing a template updates every service tagged to it."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Form Templates' }]}
      />
      <FormTemplatesAdminClient templates={templates} />
    </div>
  )
}
