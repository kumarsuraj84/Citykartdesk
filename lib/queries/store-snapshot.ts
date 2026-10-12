// The small "Stores & regions" picture on the Home page of managers and admins: where the open tickets are (by region), which stores are over the
// AC red-flag limit, and how many tickets new stores raised in the last 30 days. Limited to the viewer's own technician groups, like every report.

import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentlyBreached } from '@/lib/sla/breach'
import { loadStoreDims } from '@/lib/queries/store-dims'
import { RED_FLAG } from '@/lib/reporting/executive/engine'
import type { ReportViewerScope } from '@/lib/reporting/access'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const NO_TEAM_ID = '00000000-0000-0000-0000-000000000000'
const PAGE = 1000
const MAX_ROWS = 50_000
const DAY = 86_400_000

export interface RegionLoad { name: string; open: number; breached: number }
export interface RedFlagRow { code: string; cluster: string; region: string; acOpen: number; acTotal: number | null; acPct: number | null }
export interface StoreSnapshot {
  /** open tickets raised by a store */
  openFromStores: number
  byRegion: RegionLoad[]
  redFlagCount: number
  redFlagStores: RedFlagRow[]
  nsoTickets30d: number
  nsoStores30d: number
}

function teamIdsOf(scope: ReportViewerScope): string[] | null {
  if (scope.kind === 'all') return null
  if (scope.kind === 'team' || scope.kind === 'agent') return scope.teamIds.length > 0 ? scope.teamIds : [NO_TEAM_ID]
  return [NO_TEAM_ID]
}

export async function getStoreSnapshot(orgId: string, scope: ReportViewerScope, now: Date = new Date()): Promise<StoreSnapshot> {
  const admin = createAdminClient() as unknown as AnyClient
  const teamIds = teamIdsOf(scope)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inScope = (q: any) => (teamIds ? q.in('team_id', teamIds) : q)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageAll = async <T,>(build: (from: number, to: number) => any): Promise<T[]> => {
    const rows: T[] = []
    for (let o = 0; o < MAX_ROWS; o += PAGE) {
      const { data, error } = await build(o, o + PAGE - 1)
      if (error || !data) break
      rows.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return rows
  }

  const since = new Date(now.getTime() - 30 * DAY).toISOString()
  const [open, recent, lookup] = await Promise.all([
    pageAll<{ requester_id: string; status: string; resolution_due_at: string | null }>((from, to) => inScope(admin
      .from('requests').select('requester_id, status, resolution_due_at').eq('org_id', orgId)
      .not('status', 'in', '("resolved","closed","cancelled")'))
      .order('id', { ascending: true }).range(from, to)),
    pageAll<{ requester_id: string }>((from, to) => inScope(admin
      .from('requests').select('requester_id').eq('org_id', orgId).gte('created_at', since))
      .order('id', { ascending: true }).range(from, to)),
    loadStoreDims(admin, orgId, now),
  ])

  const regions = new Map<string, RegionLoad>()
  const storesWithOpen = new Map<string, NonNullable<ReturnType<typeof lookup.byRequester.get>>>()
  let openFromStores = 0
  for (const r of open) {
    const d = lookup.byRequester.get(r.requester_id)
    if (!d) continue
    openFromStores++
    storesWithOpen.set(d.code, d)
    const row = regions.get(d.region) ?? { name: d.region, open: 0, breached: 0 }
    row.open++
    if (isCurrentlyBreached(r, now)) row.breached++
    regions.set(d.region, row)
  }
  const red = [...storesWithOpen.values()].filter((d) => d.ac === RED_FLAG).sort((a, b) => (b.acPct ?? 0) - (a.acPct ?? 0) || a.code.localeCompare(b.code))
  const nso = recent.map((r) => lookup.byRequester.get(r.requester_id)).filter((d) => d?.stype === 'NSO')

  return {
    openFromStores,
    byRegion: [...regions.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 6),
    redFlagCount: red.length,
    redFlagStores: red.slice(0, 3).map((d) => ({ code: d.code, cluster: d.cluster, region: d.region, acOpen: d.acOpen, acTotal: d.acTotal, acPct: d.acPct })),
    nsoTickets30d: nso.length,
    nsoStores30d: new Set(nso.map((d) => d!.code)).size,
  }
}
