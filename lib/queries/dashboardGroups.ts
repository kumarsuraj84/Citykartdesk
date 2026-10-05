import { createAdminClient } from '@/lib/supabase/admin'
import type { ProfileWithTeams } from '@/types'
import type { ReportViewerScope } from '@/lib/reporting/access'

export type DashboardGroup = { id: string; name: string }

/**
 * The technician groups a viewer can pick between on a dashboard: every group in the organisation
 * for someone who already sees everything (admin / platform owner), otherwise just their own.
 */
export async function getSelectableGroups(profile: ProfileWithTeams, scope: ReportViewerScope): Promise<DashboardGroup[]> {
  if (scope.kind === 'all') {
    if (!profile.org_id) return []
    const admin = createAdminClient()
    const { data } = await admin.from('teams').select('id, name').eq('org_id', profile.org_id).order('name')
    return (data ?? []) as DashboardGroup[]
  }
  const seen = new Map<string, DashboardGroup>()
  for (const tm of profile.team_members) {
    if (tm.team) seen.set(tm.team.id, { id: tm.team.id, name: tm.team.name })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}
