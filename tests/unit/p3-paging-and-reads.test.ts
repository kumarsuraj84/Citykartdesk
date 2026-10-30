// Audit fixes (P3): reads that were silently cut at the database's 1000-row answer now read every page.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Rows = Record<string, unknown>[]
const { data, calls } = vi.hoisted(() => ({ data: {} as Record<string, Rows>, calls: [] as { table: string; method: string; args: unknown[] }[] }))

// A fake database: .range(a, b) answers that slice of the table (at most 1000 rows, like the real service); anything else answers an empty list.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: unknown = new Proxy({}, {
        get: (_t, method: string) => {
          if (method === 'then') return (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
          if (method === 'range') {
            return (a: number, b: number) => {
              calls.push({ table, method, args: [a, b] })
              return Promise.resolve({ data: (data[table] ?? []).slice(a, Math.min(b, a + 999) + 1), error: null })
            }
          }
          return (...args: unknown[]) => { calls.push({ table, method, args }); return builder }
        },
      })
      return builder
    },
  }),
}))

import { fetchReportData, MAX_REPORT_ROWS } from '@/lib/queries/reporting'
import { weatherFor } from '@/lib/weather/refresh'

const task = (i: number) => ({
  id: `t${String(i).padStart(6, '0')}`, title: `Task ${i}`, status: 'open', priority: 'low', task_type: 'personal', start_date: null, due_date: i % 2 ? '2000-01-01' : null,
  completed_at: null, created_at: '2026-10-01T00:00:00Z', tags: null, team: null, project: null, milestone: null, request: null, assignee: null, created_by_profile: null,
})

describe('Report Builder reads every page', () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(data)) delete data[k] })

  it('2,500 rows come back as 2,500 rows (not 1,000), read in a stable order', async () => {
    data.tasks = Array.from({ length: 2500 }, (_, i) => task(i))
    const res = await fetchReportData('tasks', 'org-1', { kind: 'all' }, { fresh: true })
    expect(res.rows).toHaveLength(2500)
    expect(res.truncated).toBe(false)
    const orders = calls.filter((c) => c.table === 'tasks' && c.method === 'order').map((c) => c.args[0])
    expect(orders).toContain('id')
    // a task due on a past DAY and not completed is overdue; one with no due date is not
    expect(res.rows.filter((r) => r.is_overdue === true)).toHaveLength(1250)
  })

  it('the truncated flag is true only when there really are more rows than the cap', async () => {
    data.tasks = Array.from({ length: MAX_REPORT_ROWS + 5 }, (_, i) => task(i))
    const res = await fetchReportData('tasks', 'org-1', { kind: 'all' }, { fresh: true })
    expect(res.rows).toHaveLength(MAX_REPORT_ROWS)
    expect(res.truncated).toBe(true)
  })

  it('exactly the cap is not truncated', async () => {
    data.tasks = Array.from({ length: MAX_REPORT_ROWS }, (_, i) => task(i))
    const res = await fetchReportData('tasks', 'org-1', { kind: 'all' }, { fresh: true })
    expect(res.rows).toHaveLength(MAX_REPORT_ROWS)
    expect(res.truncated).toBe(false)
  })
})

describe('regional weather averages use every saved row', () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(data)) delete data[k] })

  it('a city with more than 1,000 saved days is read page by page', async () => {
    data.weather_city_daily = Array.from({ length: 2500 }, (_, i) => ({ city: 'Pune', state: 'MH', day: `d${String(i).padStart(5, '0')}`, tmax: 30, tmin: 20 }))
    const db = { from: (t: string) => ({ select: () => ({ in: () => ({ gte: () => ({ lte: () => ({ order: () => ({ order: () => ({ order: () => ({ range: (a: number, b: number) => Promise.resolve({ data: (data[t] ?? []).slice(a, Math.min(b, a + 999) + 1), error: null }) }) }) }) }) }) }) }) }) }
    const out = await weatherFor(db, [{ city: 'Pune', state: 'MH' }], 'a', 'z')
    expect(Object.keys(out.days)).toHaveLength(2500)
    expect(out.missing).toBe(0)
  })
})
