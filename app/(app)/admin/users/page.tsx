import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { UserManagementClient } from './UserManagementClient'
import { listAuthEmails } from '@/lib/auth/emails'
import type { Profile, Team, TeamMember } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any }

export type UserWithTeams = Profile & {
  email: string | null
  team_members: (TeamMember & { team: Team })[]
  /** Many:1 as of migration 20240101000140 — several numbers (e.g. every
   *  cashier's phone for a shared store login) can resolve to one profile. */
  mobile_numbers: string[]
}

export type Department  = { id: string; name: string; code: string | null }
export type Location    = { id: string; name: string; city: string | null; country: string | null }
export type Store       = { id: string; code: string; name: string }
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

  const [profilesResult, deptsResult, locsResult, storesResult, ccResult, funcResult, desigResult, teamsResult, mobileNumbersResult] = await Promise.all([
    admin
      .from('profiles')
      .select(`*, team_members (team_id, is_lead, joined_at, team:teams (*))`)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin.from('departments').select('id, name, code').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('locations').select('id, name, city, country').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('stores').select('id, code, name').eq('org_id', orgId).eq('is_active', true).order('code'),
    admin.from('cost_centers').select('id, name, code').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('job_functions').select('id, name, code').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('designations').select('id, name, code').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('teams').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name'),
    admin.from('profile_mobile_numbers').select('profile_id, mobile_number').eq('org_id', orgId),
  ])

  const { data, error } = profilesResult
  // every page of the sign-in accounts is read (lib/auth/emails.ts), not only the first 1000; the list still opens (without addresses) if the sign-in service cannot be read
  const scanned = await listAuthEmails(admin, ((data ?? []) as { id: string }[]).map((p) => p.id))
  if (!scanned.ok) console.error('[admin/users] the sign-in accounts could not be read', scanned.error)
  const emailMap = scanned.ok ? scanned.value : new Map<string, string>()

  const mobileNumbersByProfile = new Map<string, string[]>()
  for (const row of (mobileNumbersResult.data ?? []) as { profile_id: string; mobile_number: string }[]) {
    const list = mobileNumbersByProfile.get(row.profile_id) ?? []
    list.push(row.mobile_number)
    mobileNumbersByProfile.set(row.profile_id, list)
  }

  // the database's own error text is for the log, not for the screen
  if (error) console.error('[admin/users] could not load the users', error)

  const users: UserWithTeams[] = (data ?? []).map((p: Profile & { team_members: (TeamMember & { team: Team })[] }) => ({
    ...p,
    email: emailMap.get(p.id) ?? null,
    mobile_numbers: mobileNumbersByProfile.get(p.id) ?? [],
  }))

  const profileMinis: ProfileMini[] = (data ?? [])
    .map((p: Profile) => ({ id: p.id, full_name: p.full_name ?? '' }))
    .filter((p: ProfileMini) => p.full_name)

  return (
    <div className="space-y-8">
      <PageHeader
        title="User Management"
        description="Manage users — set roles, departments, managers, and org structure."
      />

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          The list of users could not be loaded. Please refresh the page. If it keeps happening, tell your admin.
        </p>
      )}

      <UserManagementClient
        initialUsers={users}
        currentUserId={profile.id}
        isAdmin={profile.role === 'admin' || profile.role === 'platform_owner'}
        departments={deptsResult.data ?? []}
        locations={locsResult.data ?? []}
        stores={storesResult.data ?? []}
        costCenters={ccResult.data ?? []}
        jobFunctions={funcResult.data ?? []}
        designations={desigResult.data ?? []}
        profiles={profileMinis}
        teams={teamsResult.data ?? []}

      />
    </div>
  )
}
