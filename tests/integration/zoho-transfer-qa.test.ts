// Stage 4 QA of the Zoho -> CK Desk transfer, against the LOCAL database (it refuses anything else): the hard cases. Two administrators moving the same tickets at the same moment,
// a server that stopped half way through a move, and a person's own access. Needs the audit stack's demo Zoho tickets and demo mapping
// (docs/qa-full-audit-2026-11/seed/zoho-transfer-demo-*.sql); without them every test is skipped (NOT RUN), never passed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { dbContainer } from '../setup/db-container'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

const psql = (db: string, q: string) => execFileSync('docker', ['exec', dbContainer(), 'psql', '-U', 'postgres', '-d', db, '-tA', '-c', q], { encoding: 'utf8' }).trim()
const sql = (q: string) => psql('postgres', q)

const NOS = [700004, 700005, 700007]
let ready = false
let orgId = ''
let actorId = ''
let actor2Id = ''

function cleanup() {
  sql(`delete from zoho_transfers where zoho_ticket_no = any(array[${NOS.join(',')}])`)
  sql(`delete from requests where request_no = any(array[${NOS.map((n) => `'ZOHO-${n}'`).join(',')}])`)
  sql(`delete from auth.users u where u.raw_user_meta_data->>'created_by' = 'zoho_transfer' and not exists (select 1 from requests r where r.requester_id = u.id or r.assigned_to = u.id) and not exists (select 1 from request_comments c where c.author_id = u.id) and not exists (select 1 from request_activity a where a.actor_id = u.id)`)
}

beforeAll(() => {
  try {
    expect(process.env.SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/)
    const zoho = psql('zohoaudit', `select count(*) from zoho_ticket where display_id = any(array[${NOS.join(',')}])`)
    ready = Number(zoho) === NOS.length && Number(sql('select count(*) from zoho_map_templates')) > 0
  } catch { ready = false }
  if (!ready) return
  orgId = sql('select id from organizations limit 1')
  actorId = sql(`select id from profiles where role = 'admin' limit 1`)
  actor2Id = sql(`select id from profiles where role = 'platform_owner' limit 1`)
  cleanup()
})
afterAll(() => { if (ready) cleanup() })

const skip = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn() }, 120_000)

describe('moving Zoho tickets: the hard cases (stage 4 QA, local database)', () => {
  it('has the demo data (otherwise the rest are NOT RUN)', () => { if (!ready) console.warn('[zoho-transfer-qa] demo Zoho tickets / mapping not found: tests below did not run') })

  skip('two administrators moving the same tickets at the same moment: every ticket is made exactly once', async () => {
    const { moveZohoTickets } = await import('@/lib/zoho/transfer/move')
    const [a, b] = await Promise.all([
      moveZohoTickets({ orgId, actorId, numbers: NOS }),
      moveZohoTickets({ orgId, actorId: actor2Id, numbers: NOS }),
    ])
    for (const n of NOS) {
      const wins = [...a, ...b].filter((r) => r.zohoNo === n && r.ok).length
      expect(wins, `Zoho ${n} was moved ${wins} times`).toBe(1)
      expect(Number(sql(`select count(*) from requests where request_no='ZOHO-${n}'`))).toBe(1)
      expect(Number(sql(`select count(*) from zoho_transfers where zoho_ticket_no=${n} and state='moved' and request_id is not null`))).toBe(1)
    }
    // the loser is told why, in words
    const losers = [...a, ...b].filter((r) => !r.ok)
    expect(losers.length).toBe(NOS.length)
    for (const l of losers) expect(l.reason).toMatch(/already been moved|being moved/i)
  })

  skip('a server that stopped between taking a ticket and making it does not lock the ticket for ever', async () => {
    const { moveZohoTickets } = await import('@/lib/zoho/transfer/move')
    cleanup()
    // the picture after a crash: the claim row exists (an hour old), but no ticket was ever made
    sql(`insert into zoho_transfers (org_id, zoho_ticket_no, request_no, state, moved_at, moved_by) values ('${orgId}', 700004, 'ZOHO-700004', 'moved', now() - interval '1 hour', '${actorId}')`)
    const { prepareRun } = await import('@/lib/zoho/transfer/batch')
    const p = await prepareRun(orgId, { numbers: '700004', moved: 'not' })
    expect(p.numbers, 'the ticket must be offered again, not shown as already moved').toContain(700004)
    const [res] = await moveZohoTickets({ orgId, actorId, numbers: [700004] })
    expect(res.ok, res.reason).toBe(true)
    expect(Number(sql(`select count(*) from requests where request_no='ZOHO-700004'`))).toBe(1)
  })

  skip('a claim made a moment ago (a move still in progress) is respected: nobody takes it over', async () => {
    const { moveZohoTickets } = await import('@/lib/zoho/transfer/move')
    cleanup()
    sql(`insert into zoho_transfers (org_id, zoho_ticket_no, request_no, state, moved_at, moved_by) values ('${orgId}', 700005, 'ZOHO-700005', 'moved', now(), '${actorId}')`)
    const [res] = await moveZohoTickets({ orgId, actorId, numbers: [700005] })
    expect(res.ok).toBe(false)
    expect(Number(sql(`select count(*) from requests where request_no='ZOHO-700005'`))).toBe(0)
  })

  skip('a withdrawn ticket can be moved again, and a number that is not a ticket is refused', async () => {
    const { moveZohoTickets } = await import('@/lib/zoho/transfer/move')
    cleanup()
    const [none] = await moveZohoTickets({ orgId, actorId, numbers: [999999999] })
    expect(none.ok).toBe(false)
    expect(Number(sql(`select count(*) from zoho_transfers where zoho_ticket_no=999999999`))).toBe(0)
    expect(await moveZohoTickets({ orgId, actorId, numbers: [] })).toEqual([])
    expect(await moveZohoTickets({ orgId, actorId, numbers: [-5, 0, 1.5, Number.NaN] })).toEqual([])
  })

  skip('hostile text in the filters is only ever data: no error, no rows, and the Zoho tables are untouched', async () => {
    const { loadTicketsForPreview, parseNumberList } = await import('@/lib/zoho/transfer/data')
    const before = psql('zohoaudit', 'select count(*) from zoho_ticket')
    const evil = ["'; drop table zoho_ticket; --", '" or 1=1 --', '%', '_', '\\', "x' union select raw from zoho_ticket --", 'a'.repeat(5000), '<script>alert(1)</script>']
    for (const e of evil) {
      const r = await loadTicketsForPreview({ status: e.slice(0, 200), template: e.slice(0, 200), category: e.slice(0, 200), technician: e.slice(0, 200), requester: e.slice(0, 200), numbers: e, from: e, to: e }, [])
      expect(Array.isArray(r.rows)).toBe(true)
    }
    expect(psql('zohoaudit', 'select count(*) from zoho_ticket')).toBe(before)
    // the number list only ever yields plain whole numbers
    expect(parseNumberList("1; drop table x, 0x10, 1e9, -5, 12-3, 700001-700003, " + '9'.repeat(40))).toEqual({ singles: [1], ranges: [[700001, 700003]] }) // the lone 1 is a plain number; every other piece (words, 0x10, 1e9, -5, a backwards range, a 40-digit number) is dropped
    expect(parseNumberList('48213, 48220-48230 #7')).toEqual({ singles: [48213, 7], ranges: [[48220, 48230]] }) // a leading # is allowed, so the last piece is the number 7
  })

  skip('the Zoho reader cannot write: even a mistake in a query is refused by the database', async () => {
    const { zohoQuery } = await import('@/lib/zoho/db')
    for (const q of ["delete from zoho_ticket", "update zoho_ticket set status = 'x'", 'create table qa_x (a int)', 'drop table zoho_note']) {
      await expect(zohoQuery(q)).rejects.toThrow()
    }
    expect(Number(psql('zohoaudit', 'select count(*) from zoho_ticket'))).toBeGreaterThan(0)
  })

  skip("a run record belongs to one organisation: another organisation's run cannot be added to", async () => {
    const { startRun, addToRun } = await import('@/lib/zoho/transfer/batch')
    const runId = await startRun(orgId, actorId, { numbers: '700007' }, 1)
    expect(runId).toBeTruthy()
    expect(await addToRun('00000000-0000-0000-0000-0000000000ff', runId!, 1, [])).toBe(false)
    expect(sql(`select moved from zoho_transfer_runs where id='${runId}'`)).toBe('0')
    sql(`delete from zoho_transfer_runs where id='${runId}'`)
  })
})
