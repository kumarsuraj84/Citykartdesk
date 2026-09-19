import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getFieldLibraryOverview } from '@/lib/queries/field-library'
import FieldLibraryClient from './FieldLibraryClient'

export default async function AdminFieldLibraryPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const { fields, duplicates } = await getFieldLibraryOverview()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Field Library"
        description="Create a field once (e.g. Contact Number), then add it to any form template. Reports show one column per library field across all templates."
      />
      <FieldLibraryClient fields={fields} duplicates={duplicates} />
    </div>
  )
}
