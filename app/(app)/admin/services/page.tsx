import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getCategoryTreeForAdmin, getActiveFormTemplatesForPicker, getActiveSlaPoliciesForPicker, getAllServicesForAdmin } from '@/lib/queries/services'
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

async function getLocations(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('locations')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  return (data ?? []) as { id: string; name: string }[]
}

export default async function AdminServicesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const [services, categoryTree, teams, profiles, templates, slaPolicies, locations] = await Promise.all([
    getAllServicesForAdmin(),
    getCategoryTreeForAdmin(),
    getTeams(),
    getProfiles(),
    getActiveFormTemplatesForPicker(),
    getActiveSlaPoliciesForPicker(),
    getLocations(),
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Service Management"
        description="Create and manage services in the catalog. Tag categories/sub-categories the requester can pick, and a Form Template to give it an intake form."
      />
      <ServicesAdminClient services={services} categoryTree={categoryTree} teams={teams} profiles={profiles} templates={templates} slaPolicies={slaPolicies} locations={locations} />
    </div>
  )
}
