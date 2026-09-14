import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getCategoryTreeForAdmin } from '@/lib/queries/services'
import { PageHeader } from '@/components/ui/PageHeader'
import CategoriesAdminClient from './CategoriesAdminClient'

export default async function AdminCategoriesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const categories = await getCategoryTreeForAdmin()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Category Management"
        description="Manage service categories and their sub-categories. Click Edit to rename inline, or Manage to configure sub-categories."
      />
      <CategoriesAdminClient categories={categories} />
    </div>
  )
}
