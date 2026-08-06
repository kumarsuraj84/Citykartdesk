import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getCategoryTreeForAdmin } from '@/lib/queries/services'
import { createClient } from '@/lib/supabase/server'
import ServicesAdminClient from './ServicesAdminClient'
import type { Profile, Team } from '@/types'

async function getTeams(): Promise<Team[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('teams').select('*').order('name')
  return (data ?? []) as Team[]
}

async function getProfiles(): Promise<Pick<Profile, 'id' | 'full_name'>[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .order('full_name')
  return (data ?? []) as Pick<Profile, 'id' | 'full_name'>[]
}

export default async function AdminServicesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const [categories, teams, profiles] = await Promise.all([
    getCategoryTreeForAdmin(),
    getTeams(),
    getProfiles(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Management"
        description="Create and manage services in the catalog. Click Edit Form to design a service's intake form."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Services' }]}
      />
      <ServicesAdminClient categories={categories} teams={teams} profiles={profiles} />
    </div>
  )
}
