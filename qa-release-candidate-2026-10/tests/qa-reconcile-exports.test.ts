// QA reconciliation of the CSV export of requests with the database: the file must hold exactly the tickets that SQL counts, per status, per priority and for a date range,
// and every cell with a comma, quote or line break must survive reading the file back (isolated audit stack, synthetic data).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, type D03Fixtures } from '../../tests/setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { exportRequestsCSV } from '@/lib/export/reports'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
let fx: D03Fixtures

/** reads CSV text with quotes, doubled quotes and line breaks inside cells */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const mk = (title: string, status: string, priority: string) => db().from('requests').insert({ request_no: '', title, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, status, priority }).select('id').single()
  await mk('qa-export plain', 'open', 'high')
  await mk('qa-export, with comma', 'in_progress', 'urgent')
  await mk('qa-export "quoted" title', 'resolved', 'low')
  await mk('qa-export two\nlines', 'closed', 'medium')
  await mk('=cmd|calc qa-export formula', 'cancelled', 'medium')
  void seedRequestLike
}, 240_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

describe('CSV export of requests agrees with the database', () => {
  it('has one data row per ticket of the organisation (header + rows), the same number SQL counts', async () => {
    const { count } = await db().from('requests').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId)
    const rows = parseCsv(await exportRequestsCSV(fx.orgId))
    expect(rows.length - 1).toBe(count)
  })

  it('filtering by status, priority and date range returns exactly what SQL counts', async () => {
    for (const [col, val] of [['status', 'open'], ['status', 'resolved'], ['priority', 'urgent'], ['priority', 'low']] as const) {
      const { count } = await db().from('requests').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId).eq(col, val)
      const rows = parseCsv(await exportRequestsCSV(fx.orgId, { [col]: val }))
      expect(rows.length - 1, `${col}=${val}`).toBe(count)
    }
    const from = new Date(Date.now() - 7 * 86400_000).toISOString()
    const { count } = await db().from('requests').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId).gte('created_at', from)
    expect((parseCsv(await exportRequestsCSV(fx.orgId, { date_from: from })).length - 1)).toBe(count)
  })

  it('cells with comma, quote and line break read back unchanged', async () => {
    const rows = parseCsv(await exportRequestsCSV(fx.orgId, { teamId: fx.teamA.id }))
    const titles = rows.slice(1).map((r) => r[1] ?? r[0])
    const all = rows.flat()
    expect(all).toContain('qa-export, with comma')
    expect(all).toContain('qa-export "quoted" title')
    expect(all).toContain('qa-export two\nlines')
    void titles
  })

  it('a title that starts with = + - or @ cannot run as a formula when the file is opened in Excel', async () => {
    const text = await exportRequestsCSV(fx.orgId, { teamId: fx.teamA.id })
    const cell = parseCsv(text).flat().find((c) => c.includes('qa-export formula'))
    expect(cell).toBeDefined()
    expect(/^[=+\-@\t\r]/.test(cell!)).toBe(false)     // the export must neutralise a leading formula character
  })
})
