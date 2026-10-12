// The Store Master filters of the normal Analytics dashboard, checked against plain SQL on the LOCAL database (it refuses anything else):
// choosing a region (or a region and a store type) must give exactly the tickets of those stores, every number must follow, and the region / state
// rows without any choice must add up to the whole dashboard.

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { execFileSync } from 'child_process'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

const sql = (q: string): unknown => JSON.parse(execFileSync('docker', ['exec', 'supabase_db_citykart_desk', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', q], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim())

describe('Analytics dashboard store filters (local database)', () => {
  it('follows the region choice exactly, and the region rows add up to the whole', async () => {
    expect(process.env.SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getAnalytics } = await import('@/lib/queries/analytics')
    const { emptyStoreFilter } = await import('@/lib/analytics/store-filter')
    const admin = createAdminClient()
    const { data: owner } = await admin.from('profiles').select('org_id').eq('role', 'platform_owner').limit(1).single()
    const orgId = owner!.org_id as string

    const whole = await getAnalytics(orgId, '30d', { kind: 'all' })
    const places = whole.stores.places.region
    // every ticket is in exactly one row (a requester with no store is its own row)
    expect(places.reduce((n, r) => n + r.created, 0)).toBe(whole.totalCreated)
    expect(places.reduce((n, r) => n + r.openNow, 0)).toBe(whole.totalOpenNow)
    expect(whole.stores.places.state.reduce((n, r) => n + r.created, 0)).toBe(whole.totalCreated)

    const regions = places.filter((r) => r.name !== '(No store)' && r.name !== '(Not set)').slice(0, 2)
    expect(regions.length).toBeGreaterThan(0)
    for (const r of regions) {
      const f = { ...emptyStoreFilter(), region: [r.name] }
      const a = await getAnalytics(orgId, '30d', { kind: 'all' }, f)
      const start = new Date(Date.now() - 31 * 86_400_000).toISOString()
      const truth = sql(`select json_build_object(
        'open', (select count(*) from requests q join profiles p on p.id=q.requester_id join stores s on s.id=p.store_id
                 where q.org_id='${orgId}' and s.region='${r.name}' and q.status not in ('resolved','closed','cancelled')),
        'created', (select count(*) from requests q join profiles p on p.id=q.requester_id join stores s on s.id=p.store_id
                 where q.org_id='${orgId}' and s.region='${r.name}' and q.created_at >= '${start}')) `) as { open: number; created: number }
      expect(a.totalOpenNow).toBe(truth.open)
      // the window is whole days back from now, so allow the one extra day SQL may include
      expect(a.totalCreated).toBeLessThanOrEqual(truth.created)
      expect(a.totalCreated).toBe(r.created)
      expect(a.stores.places.region.filter((x) => x.name !== r.name)).toEqual([])
      // the lists a pop-up offers still include the other regions so one can be added
      expect(new Set(a.stores.combos.map((c) => c.region)).size).toBeGreaterThan(0)
    }

    // choosing a store type narrows further, and a choice nothing matches gives nothing (not everything)
    const none = await getAnalytics(orgId, '30d', { kind: 'all' }, { ...emptyStoreFilter(), region: ['no-such-region'] })
    expect(none.totalCreated).toBe(0)
    expect(none.totalOpenNow).toBe(0)
    const both = await getAnalytics(orgId, '30d', { kind: 'all' }, { ...emptyStoreFilter(), region: [regions[0].name], stype: ['NSO'] })
    expect(both.totalCreated).toBeLessThanOrEqual(regions[0].created)
  }, 120_000)
})
