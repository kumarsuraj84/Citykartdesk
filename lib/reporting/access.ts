import { getCurrentProfile } from '@/lib/queries/profiles'
import type { EntityKey } from './field-registry'
import type { ProfileWithTeams } from '@/types'

/**
 * Which rows of the `requests` entity a viewer's report is scoped to. Every
 * other entity (tasks/projects/milestones/approvals) stays Admin/Manager/
 * Platform-Owner-only, unaffected by this — see resolveReportAccess().
 */
export type ReportViewerScope =
  | { kind: 'all' }
  | { kind: 'own'; userId: string }
  | { kind: 'agent'; userId: string; teamIds: string[] }
  | { kind: 'team'; teamIds: string[] }
  /** a person who has people reporting to them (the Manager box on an account): the tickets those people raised or work on */
  | { kind: 'reports'; userId: string; reportIds: string[] }

/** PostgREST `or()` filter for an agent: their own tickets plus every technician group they belong to. */
export function agentScopeOrFilter(scope: Extract<ReportViewerScope, { kind: 'agent' }>): string {
  const own = `assigned_to.eq.${scope.userId},requester_id.eq.${scope.userId}`
  return scope.teamIds.length > 0 ? `${own},team_id.in.(${scope.teamIds.join(',')})` : own
}

const NO_ONE = '00000000-0000-0000-0000-000000000000'

/** PostgREST `or()` filter for a person's team: tickets raised by, or assigned to, the people who report to them. */
export function reportsScopeOrFilter(scope: Extract<ReportViewerScope, { kind: 'reports' }>): string {
  const ids = (scope.reportIds.length > 0 ? scope.reportIds : [NO_ONE]).join(',')
  return `requester_id.in.(${ids}),assigned_to.in.(${ids})`
}

export function resolveReportAccess(
  profile: ProfileWithTeams,
  entity: EntityKey
): { scope: ReportViewerScope } | { error: string } {
  if (entity !== 'requests') {
    if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) {
      return { error: "You don't have access to this report." }
    }
    return { scope: { kind: 'all' } }
  }
  switch (profile.role) {
    case 'admin':
    case 'platform_owner':
      return { scope: { kind: 'all' } }
    case 'manager':
      return { scope: { kind: 'team', teamIds: profile.team_members.map((tm) => tm.team_id) } }
    case 'agent':
      return { scope: { kind: 'agent', userId: profile.id, teamIds: profile.team_members.map((tm) => tm.team_id) } }
    case 'user':
      return { scope: { kind: 'own', userId: profile.id } }
    default:
      return { error: "You don't have access to this report." }
  }
}

export async function authorizeReportAccess(
  entity: EntityKey
): Promise<{ profile: ProfileWithTeams; scope: ReportViewerScope } | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  const access = resolveReportAccess(profile, entity)
  if ('error' in access) return { error: access.error }
  return { profile, scope: access.scope }
}
