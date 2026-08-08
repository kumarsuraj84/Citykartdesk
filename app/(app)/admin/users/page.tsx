import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { UserManagementClient } from './UserManagementClient'
import type { Profile, Team, TeamMember } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any }

export type UserWithTeams = Profile & {
  email: string | null
  team_members: (TeamMember & { team: Team })[]
}

export type Department  = { id: string; name: string; code: string | null }
export type Location    = { id: string; name: string; city: string | null; country: string | null }
export type CostCenter  = { id: string; name: string; code: string | null }
export type JobFunction = { id: string; name: string; code: string | null }
export type Designation = { id: string; name: string; code: string | null }
export type ProfileMini = { id: string; full_name: string }
export type TeamOption  = { id: string; name: string }

export default async function UsersPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const admin = createAdminClient() as unknown as AnyClient
  const orgId = profile.org_id ?? ''

  const [profilesResult, authResult, deptsResult, locsResult, ccResult, funcResult, desigResult, teamsResult] = await Promise.all([
    admin
      .from('profiles')
      .select(`*, team_members (team_id, is_lead, joined_at, team:teams (*))`)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('departments').select('id, name, code').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('locations').select('id, name, city, country').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('cost_centers').select('id, name, code').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('job_functions').select('id, name, code').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('designations').select('id, name, code').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('teams').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name'),
  ])

  const { data, error } = profilesResult
  const emailMap = new Map<string, string>()
  for (const u of authResult.data?.users ?? []) {
    if (u.email) emailMap.set(u.id, u.email)
  }

  const users: UserWithTeams[] = (data ?? []).map((p: Profile & { team_members: (TeamMember & { team: Team })[] }) => ({
    ...p,
    email: emailMap.get(p.id) ?? null,
  }))

  const profileMinis: ProfileMini[] = (data ?? [])
    .map((p: Profile) => ({ id: p.id, full_name: p.full_name ?? '' }))
    .filter((p: ProfileMini) => p.full_name)

  return (
    <div className="space-y-8 max-w-6xl">
      <PageHeader
        title="User Management"
        description="Manage users — set roles, departments, managers, and org structure."
      />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          Failed to load users: {(error as { message: string }).message}
        </p>
      )}

      <UserManagementClient
        initialUsers={users}
        currentUserId={profile.id}
        isAdmin={profile.role === 'admin' || profile.role === 'platform_owner'}
        departments={deptsResult.data ?? []}
        locations={locsResult.data ?? []}
        costCenters={ccResult.data ?? []}
        jobFunctions={funcResult.data ?? []}
        designations={desigResult.data ?? []}
        profiles={profileMinis}
        teams={teamsResult.data ?? []}

      />
    </div>
  )
}
