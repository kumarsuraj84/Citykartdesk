// Each store's details from the Store Master, in the form the Analytics dashboard filters by (see lib/analytics/store-filter.ts), looked up by the
// requester of a ticket (a store logs in as a user linked to its store) or by store code. The AC health is the store's own position: its open AC
// tickets against its AC total, the same figure as the Store AC report and the Smart Dashboard.

import { isNsoStore, DEFAULT_RED_FLAG_PERCENT } from '@/lib/reporting/analytics/facts'
import { NOT_SET, NO_AC_DATA, RED_FLAG, WITHIN_LIMIT } from '@/lib/reporting/executive/engine'
import { loadAcContext } from '@/lib/queries/store-ac-stats'
import { matchesStoreFilter, type StoreDims, type StoreFilter } from '@/lib/analytics/store-filter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const PAGE = 1000
const MAX_ROWS = 50_000

interface RawStore {
  code: string; name: string; state: string | null; cluster: string | null; region: string | null
  priority_list: string | null; ac_total: number | null; open_date: string | null
}

const clean = (v: string | null | undefined) => v?.trim() || NOT_SET

export function storeDimsOf(s: RawStore, openAc: number, asOf: Date): StoreDims {
  const acTotal = s.ac_total ?? null
  const acPct = acTotal && acTotal > 0 ? (openAc / acTotal) * 100 : null
  return {
    code: s.code,
    name: s.name,
    region: clean(s.region),
    state: clean(s.state),
    cluster: clean(s.cluster),
    stype: isNsoStore(s.open_date, asOf) ? 'NSO' : 'Regular',
    plist: clean(s.priority_list),
    ac: acPct === null ? NO_AC_DATA : acPct > DEFAULT_RED_FLAG_PERCENT ? RED_FLAG : WITHIN_LIMIT,
    acOpen: openAc,
    acTotal,
    acPct,
  }
}

export interface StoreDimsLookup {
  /** by the requester's profile id (only requesters that are linked to a store) */
  byRequester: Map<string, StoreDims>
  byCode: Map<string, StoreDims>
}

export async function loadStoreDims(admin: AnyClient, orgId: string, asOf: Date = new Date()): Promise<StoreDimsLookup> {
  const { openAcByStore } = await loadAcContext(admin, orgId)
  const byRequester = new Map<string, StoreDims>()
  const byCode = new Map<string, StoreDims>()
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data } = await admin.from('profiles')
      .select('id, store:stores(code, name, state, cluster, region, priority_list, ac_total, open_date)')
      .eq('org_id', orgId).not('store_id', 'is', null)
      .order('id', { ascending: true }).range(offset, offset + PAGE - 1)
    const page = (data ?? []) as { id: string; store: RawStore | null }[]
    for (const p of page) {
      if (!p.store) continue
      let d = byCode.get(p.store.code)
      if (!d) { d = storeDimsOf(p.store, openAcByStore.get(p.store.code) ?? 0, asOf); byCode.set(p.store.code, d) }
      byRequester.set(p.id, d)
    }
    if (page.length < PAGE) break
  }
  return { byRequester, byCode }
}

/** The codes of the stores that pass a filter (used to narrow a ticket list in the database). */
export async function storeCodesMatching(admin: AnyClient, orgId: string, filter: StoreFilter): Promise<string[]> {
  const { byCode } = await loadStoreDims(admin, orgId)
  return [...byCode.values()].filter((d) => matchesStoreFilter(d, filter)).map((d) => d.code)
}
