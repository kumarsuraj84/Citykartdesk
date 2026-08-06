import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { DepartmentsClient } from './DepartmentsClient'

export const dynamic = 'force-dynamic'

export default async function AdminDepartmentsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: departments } = await (supabase as any)
    .from('departments')
    .select('*, teams(id, name, slug)')
    .eq('org_id', profile.org_id ?? '')
    .order('name')

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Departments"
        description="Manage organizational departments and their associated teams."
      />
      <DepartmentsClient departments={departments ?? []} />
    </div>
  )
}
