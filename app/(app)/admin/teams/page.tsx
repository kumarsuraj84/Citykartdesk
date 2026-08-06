import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/PageHeader'
import { TeamManagementClient } from './TeamManagementClient'

export const dynamic = 'force-dynamic'

export interface TeamWithMembers {
  id: string
  name: string
  slug: string
  prefix: string
  is_active: boolean
  created_at: string
  updated_at: string
  member_count: number
  members: { id: string; full_name: string; is_lead: boolean }[]
  service_names: string[]
}

export interface UserOption {
  id: string
  full_name: string
}

export default async function AdminTeamsPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any

  // Fetch all teams with members and services
  const { data: teamsRaw } = await supabase
    .from('teams')
    .select(`
      id, name, slug, prefix, is_active, created_at, updated_at,
      team_members (
        is_lead,
        user:profiles!team_members_user_id_fkey (id, full_name)
      ),
      services (name)
    `)
    .order('name', { ascending: true })

  // Fetch all profiles for member picker
  const { data: profilesRaw } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  const teams: TeamWithMembers[] = (teamsRaw ?? []).map((t: any) => {
    const members = (t.team_members ?? [])
      .map((tm: any) => tm.user ? { id: tm.user.id, full_name: tm.user.full_name, is_lead: tm.is_lead } : null)
      .filter(Boolean) as { id: string; full_name: string; is_lead: boolean }[]

    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      prefix: t.prefix,
      is_active: t.is_active,
      created_at: t.created_at,
      updated_at: t.updated_at,
      member_count: members.length,
      members,
      service_names: (t.services ?? []).map((s: any) => s.name),
    }
  })

  const allUsers: UserOption[] = (profilesRaw ?? []).map((p: any) => ({
    id: p.id,
    full_name: p.full_name,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        description="Manage teams, their members, and associated services."
        breadcrumbs={[
          { label: 'Admin' },
          { label: 'Teams' },
        ]}
      />
      <TeamManagementClient initialTeams={teams} allUsers={allUsers} />
    </div>
  )
}
