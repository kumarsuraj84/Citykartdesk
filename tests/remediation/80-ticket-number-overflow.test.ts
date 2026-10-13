// D-069: ticket numbers repeated once the counter passed 999,999 (LPAD truncates), so ticket creation failed. The counter is moved to just below the
// limit on the disposable audit database, three tickets are created across it, and the counter and the test tickets are put back afterwards.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { svc, ORG_A } from './helpers'

const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const tag = `d69-${Date.now()}`
let saved = ''
const ids: string[] = []

beforeAll(() => { saved = psql("select last_no from request_sequences where prefix='CKSD'") })
afterAll(async () => {
  for (const id of ids) await svc('DELETE', `/requests?id=eq.${id}`).catch(() => {})
  psql(`update request_sequences set last_no=${saved} where prefix='CKSD'`)
})

describe('ticket numbers across one million', () => {
  it('stay unique and readable', async () => {
    const service = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
    const requester = (await svc<{ id: string }[]>('GET', '/profiles?select=id&role=eq.user&limit=1')).json[0].id
    psql("update request_sequences set last_no=999998 where prefix='CKSD'")
    const numbers: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await svc<{ id: string; request_no: string }[]>('POST', '/requests', { title: `${tag} ${i}`, requester_id: requester, service_id: service.id, team_id: service.team_id, org_id: ORG_A, status: 'open', request_no: 'TMP' }, { Prefer: 'return=representation' })
      expect(r.status, JSON.stringify(r.json)).toBe(201)
      ids.push(r.json[0].id)
      numbers.push(r.json[0].request_no)
    }
    expect(numbers).toEqual(['CKSD-999999', 'CKSD-1000000', 'CKSD-1000001', 'CKSD-1000002'])
    expect(new Set(numbers).size).toBe(4)
  }, 60_000)
})
