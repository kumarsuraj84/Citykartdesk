import type { ReportViewerScope } from '@/lib/reporting/access'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `?groups=id1,id2` → the ids (valid, de-duplicated). */
export function parseGroupsParam(raw: string | undefined): string[] {
  if (!raw) return []
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)))]
}

/**
 * Narrows what a viewer sees to the technician groups they picked on the dashboard. The picked
 * groups can only ever shrink the viewer's own scope, never widen it: ids outside the groups they
 * may pick from are dropped. No valid pick, or every group picked, leaves the scope unchanged
 * ("all my groups"), and `selected` comes back empty to mean exactly that.
 */
export function narrowScopeToGroups(
  scope: ReportViewerScope,
  picked: string[],
  allowedIds: string[]
): { scope: ReportViewerScope; selected: string[] } {
  const allowed = new Set(allowedIds)
  const selected = picked.filter((id) => allowed.has(id))
  if (selected.length === 0 || selected.length === allowed.size) return { scope, selected: [] }

  if (scope.kind === 'agent') return { scope: { ...scope, teamIds: selected }, selected }
  if (scope.kind === 'all' || scope.kind === 'team') return { scope: { kind: 'team', teamIds: selected }, selected }
  return { scope, selected: [] }
}

/** The team ids a scope is limited to, or null when it is not limited by group. */
export function teamIdsForScope(scope: ReportViewerScope): string[] | null {
  if (scope.kind === 'all') return null
  if (scope.kind === 'team' || scope.kind === 'agent') return scope.teamIds
  return []
}
