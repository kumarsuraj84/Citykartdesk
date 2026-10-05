import type { WorkloadRow } from '@/lib/queries/workload'

/**
 * The technician(s) carrying the most open tickets right now: one name when one person is clearly
 * highest, two names when two are tied for the most, and so on. Nobody is shown when no one has any
 * open ticket.
 */
export function highestOpenAgents(rows: WorkloadRow[]): WorkloadRow[] {
  const max = Math.max(0, ...rows.map((r) => r.totalOpen))
  if (max === 0) return []
  return rows.filter((r) => r.totalOpen === max).sort((a, b) => a.agentName.localeCompare(b.agentName))
}
