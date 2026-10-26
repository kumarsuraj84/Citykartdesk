// QA performance of whole WORKFLOWS (not only data-API reads) on the isolated audit stack with synthetic data. Output: qa-release-candidate-2026-10/evidence/perf/qa-perf-<PERF_LABEL>.json
// Measures, as real signed-in users: ticket creation (sequential and in bursts), queue loading, search, executive dashboard load, CSV export, vendor list, approval decisions
// (sequential and concurrent), AC PMS generation, and Google-sheet synchronisation (large sheet, first copy and unchanged copy).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, clientForToken, createTestUser, getAdmin, type D03Fixtures, type TestUser } from '../../tests/setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequest } from '@/lib/actions/requests'
import { approveApproval } from '@/lib/actions/approvals'
import { createAdHocApproval } from '@/lib/approvals/adhoc'
import { getRequests } from '@/lib/queries/requests'
import { loadExecutiveRows } from '@/lib/queries/executive-dashboard'
import { getVendorTickets } from '@/lib/queries/vendor'
import { exportRequestsCSV } from '@/lib/export/reports'
import { createDuePmsTickets } from '@/lib/pms/tickets'
import { syncMasters } from '@/lib/masters/sync'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 1_800_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const DB = 'supabase_db_ckdesk_audit'
const LABEL = process.env.PERF_LABEL ?? 'run'
const RUNS = Number(process.env.PERF_RUNS ?? 15)
const tag = `qp${String(Date.now()).slice(-6)}`
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10 : 0 }
const stats = (xs: number[]) => ({ p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), runs: xs.length })
const psql = (sql: string) => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql], { encoding: 'utf8' }).trim()
import { AsyncLocalStorage } from 'node:async_hooks'
const als = new AsyncLocalStorage<string>()
let defaultToken = ''
vi.mocked(createClient).mockImplementation((async () => clientForToken(als.getStore() ?? defaultToken)) as never)
const actAs = (u: { accessToken: string }) => { defaultToken = u.accessToken }
async function timed(fn: () => Promise<unknown>, runs = RUNS) {
  await fn().catch(() => {})                                 // warm-up
  const xs: number[] = []; let errors = 0
  for (let i = 0; i < runs; i++) { const t = performance.now(); try { await fn() } catch { errors++ } xs.push(performance.now() - t) }
  return { ...stats(xs), errors }
}

let fx: D03Fixtures
let vendor: TestUser
const ids = { cat: '', sub: '', catPms: '', subPms: '', co: '', stores: [] as string[], storeCodes: [] as string[], approvalCat: '' }
const made: string[] = []
const out: Record<string, unknown> = {}

const setAside: { categories: string[]; source: Record<string, unknown> | null } = { categories: [], source: null }

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  // isolation: other AC PMS categories / an existing PMS sheet source of the same organisation (for example the QA seed company) are set aside while this file runs and put back afterwards
  const keepPms = ((await a.from('service_categories').select('id').eq('is_pms', true)).data ?? []).map((c: { id: string }) => c.id)
  if (keepPms.length) await a.from('service_categories').update({ is_pms: false }).in('id', keepPms)
  setAside.categories = keepPms
  setAside.source = (await a.from('master_sources').select('*').eq('org_id', fx.orgId).eq('kind', 'pms').maybeSingle()).data ?? null
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} cat`, slug: `${tag}-cat` }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} sub`, slug: `${tag}-sub` }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.sub })
  ids.catPms = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} pms`, slug: `${tag}-pms`, is_pms: true }).select('id').single()).data.id
  ids.subPms = (await a.from('service_sub_categories').insert({ category_id: ids.catPms, name: `${tag} pms sub`, slug: `${tag}-pmssub` }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.subPms })
  await a.from('services').update({ form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }, { id: 'desc', type: 'textarea', label: 'Description', required: false, order: 2 }] }).eq('id', fx.teamA.serviceId)
  ids.co = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} co` }).select('id').single()).data.id
  vendor = await createTestUser(`${tag}-vendor`, 'QA Perf Vendor')
  await a.from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: ids.co, vendor_role: 'technician' }).eq('id', vendor.id)
}, 600_000)

afterAll(async () => {
  const a = db()
  const reqs = ((await a.from('requests').select('id').like('title', `${tag}%`)).data ?? []).map((r: { id: string }) => r.id)
  const all = [...new Set([...made, ...reqs])]
  for (let i = 0; i < all.length; i += 200) {
    const chunk = all.slice(i, i + 200)
    const aps = ((await a.from('approvals').select('id, workflow_id').in('request_id', chunk)).data ?? []) as { id: string; workflow_id: string }[]
    if (aps.length) {
      await a.from('approval_decisions').delete().in('approval_id', aps.map((x) => x.id))
      await a.from('approvals').delete().in('id', aps.map((x) => x.id))
      await a.from('approval_workflow_steps').delete().in('workflow_id', aps.map((x) => x.workflow_id)); await a.from('approval_workflows').delete().in('id', aps.map((x) => x.workflow_id))
    }
    await a.from('request_activity').delete().in('request_id', chunk); await a.from('request_comments').delete().in('request_id', chunk); await a.from('requests').delete().in('id', chunk)
  }
  await a.from('pms_ticket_log').delete().like('store_code', `${tag.toUpperCase()}%`)
  await a.from('master_pms_dates').delete().like('store_code', `${tag.toUpperCase()}%`)
  await a.from('master_ac_units').delete().like('store_code', `${tag.toUpperCase()}%`)
  await a.from('master_sources').delete().eq('org_id', fx.orgId).in('spreadsheet_id', [`${tag}-ac`, `${tag}-pms`])
  await a.from('profiles').update({ vendor_company_id: null, vendor_role: null, store_id: null }).in('id', [vendor.id, fx.requesterA.id])
  await a.from('vendor_companies').delete().eq('id', ids.co)
  await a.from('stores').delete().like('code', `${tag.toUpperCase()}%`)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', [ids.sub, ids.subPms])
  await a.from('service_sub_categories').delete().in('id', [ids.sub, ids.subPms])
  await a.from('service_categories').delete().in('id', [ids.cat, ids.catPms])
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  if (setAside.categories.length) await a.from('service_categories').update({ is_pms: true }).in('id', setAside.categories)
  if (setAside.source) await a.from('master_sources').upsert(setAside.source, { onConflict: 'org_id,kind' })
  await fx?.cleanup()
}, 900_000)

const form = (title: string, sub = ids.sub) => { const f = new FormData(); f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub); f.set('form_data', JSON.stringify({ subject: title })); return f }

describe('workflow performance', () => {
  it('measures and records', async () => {
    out.label = LABEL; out.at = new Date().toISOString(); out.tickets_in_database = Number(psql('select count(*) from requests')); out.runs_per_operation = RUNS

    // 1. ticket creation, one after another
    actAs(fx.requesterA)
    const seq: number[] = []; let seqErr = 0
    for (let i = 0; i < 30; i++) { const t = performance.now(); const r = await createRequest(form(`${tag} seq ${i}`)); seq.push(performance.now() - t); if (r.error || !r.requestId) seqErr++; else made.push(r.requestId) }
    out.create_ticket_sequential = { ...stats(seq), errors: seqErr }

    // 2. ticket creation in bursts (many stores at once); no ticket may be lost or doubled
    const bursts: Record<string, unknown> = {}
    for (const width of [10, 25]) {
      const per: number[] = []; let errors = 0; const started = performance.now()
      await Promise.all(Array.from({ length: width }, async (_, i) => { const t = performance.now(); const r = await createRequest(form(`${tag} burst${width} ${i}`)); per.push(performance.now() - t); if (r.error || !r.requestId) errors++; else made.push(r.requestId) }))
      const seconds = (performance.now() - started) / 1000
      const stored = Number(psql(`select count(*) from requests where title like '${tag} burst${width} %'`))
      bursts[`${width} at once`] = { ...stats(per), errors, seconds: Math.round(seconds * 100) / 100, tickets_per_second: Math.round((width / seconds) * 10) / 10, stored, lost_or_doubled: stored - (width - errors) }
    }
    out.create_ticket_burst = bursts

    // 3. queue, search, dashboard, export, vendor list
    actAs(fx.agentA)
    out.queue_team_first_page = await timed(async () => { await getRequests({ view: 'queue', userId: fx.agentA.id, pageSize: 50 }) })
    out.queue_search_text = await timed(async () => { await getRequests({ view: 'queue', userId: fx.agentA.id, q: 'seq', pageSize: 50 }) })
    actAs(fx.manager)
    out.queue_manager_first_page = await timed(async () => { await getRequests({ view: 'queue', userId: fx.manager.id, pageSize: 50 }) })
    out.executive_dashboard_load_all_rows = await timed(async () => { await loadExecutiveRows(fx.orgId, 'org' as never, { kind: 'all' } as never) }, Math.min(RUNS, 5))
    out.export_requests_csv = await timed(async () => { await exportRequestsCSV(fx.orgId) }, Math.min(RUNS, 3))
    const t = (await db().from('requests').insert({ request_no: '', title: `${tag} vendor`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: vendor.id, status: 'open', form_sections_snapshot: [], form_data: {} }).select('id').single()).data.id; made.push(t)
    actAs(vendor)
    out.vendor_dashboard_list = await timed(async () => { await getVendorTickets() })

    // 4. approvals: send, then decide one after another and many at once (the first decision of each approval is final)
    const mkApprovals = async (n: number, label: string) => {
      const list: { id: string; req: string }[] = []
      for (let i = 0; i < n; i++) {
        const r = (await db().from('requests').insert({ request_no: '', title: `${tag} ${label} ${i}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, status: 'in_progress', form_sections_snapshot: [], form_data: {} }).select('id, request_no, title, status, requester_id, org_id, waiting_since').single()).data
        made.push(r.id)
        const res = await createAdHocApproval(db(), { request: r, approvers: [{ id: fx.agentA.id, full_name: 'QA' }], senderId: fx.requesterA.id, senderName: 'QA' })
        if (res.error) throw new Error(res.error)
        list.push({ id: (await db().from('approvals').select('id').eq('request_id', r.id).eq('status', 'pending').single()).data.id, req: r.id })
      }
      return list
    }
    actAs(fx.agentA)
    const seqAp = await mkApprovals(15, 'apseq'); const seqTimes: number[] = []; let apErr = 0
    for (const a of seqAp) { const s = performance.now(); const r = await approveApproval(a.id, 'ok'); seqTimes.push(performance.now() - s); if (r.error) apErr++ }
    out.approval_decide_sequential = { ...stats(seqTimes), errors: apErr }
    const conAp = await mkApprovals(20, 'apcon'); const conTimes: number[] = []; let conErr = 0; const cs = performance.now()
    await Promise.all(conAp.map(async (a) => { const s = performance.now(); const r = await approveApproval(a.id, 'ok'); conTimes.push(performance.now() - s); if (r.error) conErr++ }))
    out.approval_decide_20_at_once = { ...stats(conTimes), errors: conErr, seconds: Math.round((performance.now() - cs) / 10) / 100 }
    // two approvers deciding the SAME approval at the same moment: exactly one decision may win
    const dup = await mkApprovals(1, 'apdup')
    await db().from('approval_workflow_steps').insert({ workflow_id: (await db().from('approvals').select('workflow_id').eq('id', dup[0].id).single()).data.workflow_id, step_order: 2, approver_type: 'specific_user', approver_user_id: fx.manager.id })
    const settled = await Promise.all([als.run(fx.agentA.accessToken, () => approveApproval(dup[0].id, 'agent decides')), als.run(fx.manager.accessToken, () => approveApproval(dup[0].id, 'manager decides'))])
    out.approval_same_approval_decided_twice = { results: settled.map((r) => (r.error ? 'refused' : 'accepted')), decisions_stored: Number(psql(`select count(*) from approval_decisions where approval_id = '${dup[0].id}'`)) }

    // 5. AC PMS generation for many stores at once
    const N = Number(process.env.PERF_PMS_STORES ?? 60)
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < N; i++) {
      const code = `${tag}P${String(i).padStart(3, '0')}`.toUpperCase()
      const st = (await db().from('stores').insert({ org_id: fx.orgId, code, name: `${tag} pms store ${i}`, address: 'x' }).select('id').single()).data.id; ids.stores.push(st); ids.storeCodes.push(code)
      const u = await createTestUser(`${tag}-pms${i}`, `QA PMS Store ${i}`)
      await db().from('profiles').update({ org_id: fx.orgId, role: 'user', store_id: st, is_active: true, must_reset_password: false }).eq('id', u.id)
      rows.push({ org_id: fx.orgId, store_code: code, pms_date: today, sheet_row: i + 2 })
    }
    await db().from('master_sources').upsert({ org_id: fx.orgId, kind: 'pms', spreadsheet_id: `${tag}-pms` }, { onConflict: 'org_id,kind' })
    await db().from('master_pms_dates').insert(rows)
    const noon = new Date(`${today}T12:00:00+05:30`)
    const p0 = performance.now(); const pr = await createDuePmsTickets(db(), fx.orgId, noon); const pms = (performance.now() - p0) / 1000
    const again = await createDuePmsTickets(db(), fx.orgId, noon)
    out.pms_generation = { stores_due: N, created: pr.created, skipped: pr.skipped, failed: pr.failed, seconds: Math.round(pms * 100) / 100, tickets_per_second: Math.round((pr.created / pms) * 10) / 10, second_run_created: again.created, setup_problem: pr.setupProblem ?? null }
    for (const r of ((await db().from('pms_ticket_log').select('request_id').like('store_code', `${tag.toUpperCase()}P%`)).data ?? []) as { request_id: string | null }[]) if (r.request_id) made.push(r.request_id)

    // 6. sheet synchronisation of a large AC sheet (first copy, unchanged copy, one changed row)
    const SHEET_ROWS = Number(process.env.PERF_SHEET_ROWS ?? 3000)
    const head = ['Store Code', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC-AMC vendor', 'AC-AMC Brand', 'Zenatix (yes/No)', 'Store Priority list', 'Festival', 'Region', 'Cluster', 'Opening date', 'City', 'State', 'Address', 'pincode', 'Status', 'OEM Ticket Mail To']
    const sheet: unknown[][] = [head]
    for (let i = 0; i < SHEET_ROWS; i++) sheet.push([`${tag}S${String(Math.floor(i / 3)).padStart(4, '0')}`.toUpperCase(), 'GF', 'Ductable', '5.5 TR', 'BRAND', (i % 3) + 1, `${tag}-SER-${i}`, 'VENDOR', 'AMC', 'NO', 'ROS', 'PUJA', 'R1', 'C1', 46250, 'City', 'ST', 'addr', 100000, 'Active', 'oem@qa-oem.test'])
    const sheets: Record<string, unknown[][]> = { [`${tag}-ac`]: sheet }
    const source: SheetsSource = { fetchValues: async (id) => sheets[id] }
    await db().from('master_sources').upsert({ org_id: fx.orgId, kind: 'ac', spreadsheet_id: `${tag}-ac`, content_hash: null }, { onConflict: 'org_id,kind' })
    const s1 = performance.now(); const first = await syncMasters({ db: db(), orgId: fx.orgId, source, force: true }); const firstSec = (performance.now() - s1) / 1000
    const s2 = performance.now(); const second = await syncMasters({ db: db(), orgId: fx.orgId, source, force: false }); const secondSec = (performance.now() - s2) / 1000
    sheet[5][6] = `${tag}-CHANGED`
    const s3 = performance.now(); const third = await syncMasters({ db: db(), orgId: fx.orgId, source, force: true }); const thirdSec = (performance.now() - s3) / 1000
    out.sheet_sync = { rows: SHEET_ROWS, first_copy: { seconds: Math.round(firstSec * 100) / 100, status: first.ac.status, added: first.ac.added }, unchanged_copy: { seconds: Math.round(secondSec * 100) / 100, status: second.ac.status }, one_row_changed: { seconds: Math.round(thirdSec * 100) / 100, status: third.ac.status, changed: third.ac.changed } }

    out.database_after = { requests: Number(psql('select count(*) from requests')), connections: Number(psql('select count(*) from pg_stat_activity')), waiting_locks: Number(psql('select count(*) from pg_locks where not granted')) }
    mkdirSync('qa-release-candidate-2026-10/evidence/perf', { recursive: true })
    writeFileSync(`qa-release-candidate-2026-10/evidence/perf/qa-perf-${LABEL}.json`, JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out, null, 1))
    expect(out.create_ticket_sequential).toBeTruthy()
  }, 1_800_000)
})
