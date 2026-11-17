// Stage 4 QA: how fast is the Zoho -> CK Desk transfer with a LARGE set? Runs only when ZOHO_SCALE=1 and the 10,000-ticket made-up set is in the audit Zoho database
// (docs/qa-full-audit-2026-11/seed/zoho-transfer-scale-seed.sql); otherwise every test is skipped (NOT RUN). LOCAL database only (it refuses anything else).
// It MOVES 1,000 tickets for real, measures every step, and writes the numbers to docs/qa-full-audit-2026-11/evidence/perf-zoho/scale.json.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { NextRequest } from 'next/server'
import { dbContainer } from '../setup/db-container'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

const psql = (db: string, q: string) => execFileSync('docker', ['exec', dbContainer(), 'psql', '-U', 'postgres', '-d', db, '-tA', '-c', q], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sql = (q: string) => psql('postgres', q)

const MOVE_COUNT = Number(process.env.ZOHO_SCALE_MOVE ?? 1000)
const OUT = 'docs/qa-full-audit-2026-11/evidence/perf-zoho/scale.json'
const result: Record<string, unknown> = { startedAt: new Date().toISOString(), moveCount: MOVE_COUNT }
let ready = false
let orgId = ''
let actorId = ''
let moved: number[] = []

function cleanup() {
  sql(`delete from business_rules where name = 'ZOHO-SCALE-TEST'`)
  sql(`delete from app_settings where key = 'zoho.moved_tickets_active'`)
  sql(`delete from zoho_transfer_runs where filters->>'numbers' = '800001-810000'`)
  sql(`delete from zoho_transfers where zoho_ticket_no between 800001 and 810000`)
  sql(`delete from requests where request_no like 'ZOHO-8%'`)
  sql(`delete from auth.users u where u.raw_user_meta_data->>'created_by' = 'zoho_transfer' and not exists (select 1 from requests r where r.requester_id = u.id or r.assigned_to = u.id) and not exists (select 1 from request_comments c where c.author_id = u.id) and not exists (select 1 from request_activity a where a.actor_id = u.id)`)
}

beforeAll(() => {
  try {
    expect(process.env.SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/)
    ready = process.env.ZOHO_SCALE === '1' && Number(psql('zohoaudit', `select count(*) from zoho_ticket where display_id between 800001 and 810000`)) === 10000 && Number(sql('select count(*) from zoho_map_templates')) > 0
  } catch { ready = false }
  if (!ready) return
  orgId = sql('select id from organizations limit 1')
  actorId = sql(`select id from profiles where role = 'admin' limit 1`)
  cleanup()
})
afterAll(() => {
  if (!ready) return
  fs.mkdirSync('docs/qa-full-audit-2026-11/evidence/perf-zoho', { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify({ ...result, finishedAt: new Date().toISOString() }, null, 2))
  cleanup()
})

const skip = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn() }, 3 * 60 * 60 * 1000)
const ms = async <T>(f: () => Promise<T>): Promise<[T, number]> => { const t = performance.now(); const r = await f(); return [r, Math.round(performance.now() - t)] }

describe('the transfer with a large set (stage 4 QA, local database)', () => {
  it('runs only with ZOHO_SCALE=1 and the 10,000-ticket set (otherwise NOT RUN)', () => { if (!ready) console.warn('[zoho-transfer-scale] not run') })

  skip('reads and counts all 10,000 matching tickets', async () => {
    const { prepareRun } = await import('@/lib/zoho/transfer/batch')
    const [p, t] = await ms(() => prepareRun(orgId, { numbers: '800001-810000', moved: 'not' }))
    result.prepare10000 = { ms: t, matching: p.matching, scanned: p.scanned, ready: p.ready, readyOpen: p.readyOpen, readyFinished: p.readyFinished, blocked: p.blocked }
    expect(p.matching).toBe(10000)
    expect(p.scanned).toBe(10000)
    expect(p.ready).toBeGreaterThan(9000)
    moved = p.numbers.slice(0, MOVE_COUNT)
  })

  skip('the preview page query (200 tickets) stays fast', async () => {
    const { loadTicketsForPreview } = await import('@/lib/zoho/transfer/data')
    const times: number[] = []
    for (let i = 0; i < 5; i++) times.push((await ms(() => loadTicketsForPreview({ numbers: '800001-810000' }, [])))[1])
    result.previewQuery200 = { msEach: times }
    expect(Math.max(...times)).toBeLessThan(5000)
  })

  skip('moves the tickets for real, 25 at a time, silently, and measures the speed', async () => {
    const { moveZohoTickets } = await import('@/lib/zoho/transfer/move')
    const before = { size: Number(sql('select pg_database_size(current_database())')), notifications: Number(sql('select count(*) from notifications')), requests: Number(sql('select count(*) from requests')) }
    const chunkMs: number[] = []
    let ok = 0
    const failures: string[] = []
    const t0 = performance.now()
    for (let i = 0; i < moved.length; i += 25) {
      const [res, t] = await ms(() => moveZohoTickets({ orgId, actorId, numbers: moved.slice(i, i + 25) }))
      chunkMs.push(t)
      for (const r of res) { if (r.ok) ok++; else failures.push(`${r.zohoNo}: ${r.reason}`) }
    }
    const total = Math.round(performance.now() - t0)
    const after = { size: Number(sql('select pg_database_size(current_database())')), notifications: Number(sql('select count(*) from notifications')), requests: Number(sql('select count(*) from requests')) }
    const sorted = [...chunkMs].sort((a, b) => a - b)
    result.move = {
      asked: moved.length, moved: ok, failed: failures.length, firstFailures: failures.slice(0, 5), totalMs: total, msPerTicket: Math.round(total / Math.max(1, ok)),
      chunkMsP50: sorted[Math.floor(sorted.length * 0.5)], chunkMsP95: sorted[Math.floor(sorted.length * 0.95)], chunkMsMax: sorted[sorted.length - 1],
      ticketsPerMinute: Math.round((ok / (total / 1000)) * 60),
      estimatedMinutesFor10000: Math.round((total / Math.max(1, ok)) * 10000 / 60000),
      databaseGrowthMB: Math.round((after.size - before.size) / 1048576), commentsMade: Number(sql(`select count(*) from request_comments where request_id in (select id from requests where request_no like 'ZOHO-8%')`)),
      inactiveProfilesMade: Number(sql(`select count(*) from auth.users where raw_user_meta_data->>'created_by'='zoho_transfer'`)),
    }
    expect(ok).toBe(moved.length)
    expect(failures).toEqual([])
    expect(after.requests - before.requests).toBe(moved.length)
    expect(after.notifications).toBe(before.notifications)                       // silent
    expect(Number(sql(`select count(*) from request_automation_state where finished_at is null and request_id in (select id from requests where request_no like 'ZOHO-8%')`))).toBe(0)
  })

  skip('the scheduled jobs: moved tickets cost nothing while silent; switching them on has a measurable price', async () => {
    const route = await import('@/app/api/business-rules/run/route')
    const handler = (route as unknown as Record<string, (r: NextRequest) => Promise<Response>>).GET
    const run = () => handler(new NextRequest('http://localhost:3310/api/business-rules/run', { headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' } }))
    const actions = JSON.stringify([{ type: 'notify', params: { roles: [], channels: ['in_app'], notifyAssignee: false, notifyRequester: true } }])
    sql(`insert into business_rules (org_id, name, is_active, trigger, schedule_check, schedule_threshold, conditions, conditions_logic, actions, execution_order) values ('${orgId}', 'ZOHO-SCALE-TEST', true, '{schedule}', 'unassigned_minutes', 5, '[]', 'AND', '${actions}', 1)`)
    const openUnassigned = Number(sql(`select count(*) from requests where request_no like 'ZOHO-8%' and assigned_to is null and status not in ('resolved','closed','cancelled')`))
    // other scheduled rules in this database also notify about ordinary tickets: count ONLY the notifications about the moved tickets
    const aboutMoved = () => Number(sql(`select count(*) from notifications where request_id in (select id from requests where request_no like 'ZOHO-8%')`))
    const n0 = aboutMoved()
    const [r1, silentMs] = await ms(run)
    expect(r1.status).toBe(200)
    const silentNotes = aboutMoved() - n0
    sql(`insert into app_settings (key, value) values ('zoho.moved_tickets_active', 'true') on conflict (key) do update set value = 'true'`)
    const [r2, activeMs] = await ms(run)
    expect(r2.status).toBe(200)
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 500))
    const activeNotes = aboutMoved() - n0 - silentNotes
    result.scheduledRuleRun = { movedOpenUnassigned: openUnassigned, silentMs, silentNotifications: silentNotes, activeMs, activeNotifications: activeNotes }
    expect(silentNotes).toBe(0)                                                  // the whole point: nobody is told while silent
    expect(activeNotes).toBeGreaterThan(0)
  })
})
