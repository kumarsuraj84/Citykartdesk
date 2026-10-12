/**
 * The Excel buttons of the fixed reports: each export is built from the same filters as the screen (group, services, dates, statuses,
 * the filter bar's choices, layout, folded rows). Real database.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import ExcelJS from 'exceljs'
import { setupD03Fixtures, seedRequestLike, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

const state = { profile: null as unknown }
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: vi.fn(async () => state.profile) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import {
  exportAgeBucketReportXlsx, exportTicketDetailReportXlsx, exportTicketTreeReportXlsx, exportStoreAcReportXlsx,
} from '@/lib/actions/analyticsReportExport'

vi.setConfig({ testTimeout: 60_000 })

async function open(res: { data?: string; filename?: string; error?: string }, sheet: string) {
  expect(res.error).toBeUndefined()
  expect(res.filename).toMatch(/\.xlsx$/)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(res.data!, 'base64') as unknown as ArrayBuffer)
  return wb.getWorksheet(sheet)!
}
const textOf = (ws: ExcelJS.Worksheet, row: number) => String(ws.getRow(row).getCell(1).value ?? '')

describe('Excel export of the fixed reports', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const made = { oem: '', stores: [] as string[] }

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    state.profile = { id: fx.admin.id, role: 'admin', org_id: fx.orgId, team_members: [] }
    await admin.from('requests').update({ status: 'cancelled' }).in('id', [fx.requestA.id, fx.requestB.id])
    await admin.from('services').update({ auto_oem_routing: true }).eq('id', fx.teamA.serviceId)
    const oem = await admin.from('oems').insert({ org_id: fx.orgId, name: 'EXPORT OEM' }).select('id').single()
    made.oem = oem.data!.id
    const s1 = await admin.from('stores').insert({ org_id: fx.orgId, code: 'EX1', name: 'EX1', oem_id: made.oem, cluster: 'EC1', region: 'ER1', ac_total: 4, open_date: '2020-01-01' }).select('id').single()
    made.stores = [s1.data!.id]
    await admin.from('profiles').update({ store_id: made.stores[0], full_name: 'EX1' }).eq('id', fx.requesterA.id)
    for (let i = 0; i < 3; i++) await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
  }, 120_000)

  afterAll(async () => {
    await admin.from('requests').delete().eq('service_id', fx.teamA.serviceId)
    await admin.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
    if (made.stores.length) await admin.from('stores').delete().in('id', made.stores)
    if (made.oem) await admin.from('oems').delete().eq('id', made.oem)
    await fx?.cleanup()
  }, 120_000)

  const base = () => ({ group: fx.teamA.id })

  it('Ticket Status: the file has the layout\'s headings, the tickets, the filter text and follows what is folded', async () => {
    const ws = await open(await exportTicketTreeReportXlsx('ticket-status-age-bucket', { ...base(), layout: 'cluster-store', filters: { f_region: 'ER1' } }), 'Tickets')
    expect(textOf(ws, 1)).toContain('Ticket Status Report Age bucket wise')
    expect(textOf(ws, 3)).toContain('Region: ER1')
    expect(textOf(ws, 3)).toContain('Tickets: 3')
    const header = (ws.getRow(5).values as unknown[]).slice(1)
    expect(header.slice(0, 3)).toEqual(['Cluster', 'Store', 'Category'])
    expect(header).toContain('AC No') // the AC columns are there because the service goes to an OEM
    // folded to the clusters: one line per cluster plus the grand total
    const folded = await open(await exportTicketTreeReportXlsx('ticket-status-age-bucket', { ...base(), layout: 'cluster-store', collapsed: ['\u0001EC1'] }), 'Tickets')
    const col = (w: ExcelJS.Worksheet) => { const out: string[] = []; w.eachRow((r, n) => { if (n > 5) out.push(String(r.getCell(1).value)) }); return out }
    expect(col(folded)).toEqual(['EC1', 'Grand Total'])
    // a filter that matches nothing
    const none = await open(await exportTicketTreeReportXlsx('ticket-status-age-bucket', { ...base(), filters: { f_cluster: 'NOPE' } }), 'Tickets')
    expect(textOf(none, 3)).toContain('Tickets: 3') // an unknown value is dropped, not applied
  })

  it('Store AC: the store row with its AC total, open AC tickets and %, and the red flag limit the viewer set', async () => {
    const ws = await open(await exportStoreAcReportXlsx('store-ac-age-bucket', { ...base(), groupBy: 'none', redFlagPercent: '50' }), 'Stores')
    expect(textOf(ws, 3)).toContain('Red flag: above 50%')
    const header = (ws.getRow(5).values as unknown[]).slice(1)
    const row = (ws.getRow(6).values as unknown[]).slice(1)
    expect(row[0]).toBe('EX1')
    expect(row[header.indexOf('AC Total')]).toBe(4)
    expect(row[header.indexOf('Open AC Tickets')]).toBe(3)
    expect(row[header.indexOf('AC Not Working %')]).toBe('75%')
    expect(row[header.indexOf('Red Flag')]).toBe('Red Flag')
    const lenient = await open(await exportStoreAcReportXlsx('store-ac-age-bucket', { ...base(), groupBy: 'none', redFlagPercent: '90' }), 'Stores')
    expect((lenient.getRow(6).values as unknown[]).slice(1)[header.indexOf('Red Flag')]).toBe('-')
  })

  it('Tickets Summary and Ticket Detail: the same group and filters', async () => {
    const summary = await open(await exportAgeBucketReportXlsx('tickets-summary-age-bucket', { ...base(), filters: { f_cluster: 'EC1' } }), 'Summary')
    expect(textOf(summary, 3)).toContain('Cluster: EC1')
    expect(textOf(summary, 3)).toContain('Tickets: 3')
    const detail = await open(await exportTicketDetailReportXlsx('ticket-detail-age-bucket', { ...base(), filters: { f_store: 'EX1' } }), 'Tickets')
    expect(textOf(detail, 3)).toContain('Store: EX1')
    expect(textOf(detail, 3)).toContain('Tickets: 3')
  })

  it('refuses without a signed-in user and for a report that does not exist', async () => {
    const keep = state.profile
    state.profile = null
    expect((await exportStoreAcReportXlsx('store-ac-age-bucket', base())).error).toBe('Unauthorized.')
    state.profile = keep
    expect((await exportStoreAcReportXlsx('nope', base())).error).toMatch(/does not exist/)
    // a report asked for through the wrong export is not the report
    expect((await exportTicketTreeReportXlsx('store-ac-age-bucket', base())).error).toMatch(/does not exist/)
  })
})
