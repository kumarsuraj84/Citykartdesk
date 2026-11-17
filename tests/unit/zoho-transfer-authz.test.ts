import { beforeEach, describe, expect, it, vi } from 'vitest'

// Every action of the Zoho -> CK Desk transfer must refuse anybody who is not an administrator, BEFORE it touches any data. The database and the Zoho reader are mocked to throw,
// so a single call that got past the role check would fail the test.
const profile = vi.hoisted(() => ({ current: null as null | { id: string; role: string; org_id: string | null } }))
const touched = vi.hoisted(() => ({ n: 0 }))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => profile.current }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { touched.n++; throw new Error('the database was touched') } }))
vi.mock('@/lib/actions/admin/audit', () => ({ logAdminAudit: async () => { touched.n++ } }))
vi.mock('@/lib/zoho/db', () => ({ zohoQuery: async () => { touched.n++; throw new Error('Zoho was touched') }, zohoDbStatus: () => ({ ready: true }) }))

import * as actions from '@/lib/actions/zohoTransfer'

const calls: [string, () => Promise<unknown>][] = [
  ['saveTemplateMapping', () => actions.saveTemplateMapping({ zohoTemplate: 'x', formTemplateId: null, services: [], categories: [], items: [], fields: [] })],
  ['saveStatusMapping', () => actions.saveStatusMapping([{ zohoValue: 'Open', ckValue: 'open' }])],
  ['savePersonMapping', () => actions.savePersonMapping({ kind: 'requester', zohoKey: 'a@b.test', zohoName: 'A', profileId: 'x' })],
  ['moveZohoTicketsAction', () => actions.moveZohoTicketsAction([700001])],
  ['prepareMoveRunAction', () => actions.prepareMoveRunAction({})],
  ['startMoveRunAction', () => actions.startMoveRunAction({}, 5)],
  ['moveRunChunkAction', () => actions.moveRunChunkAction('run', [700001])],
  ['finishMoveRunAction', () => actions.finishMoveRunAction('run', false)],
  ['setMovedActiveAction', () => actions.setMovedActiveAction(true)],
]

describe('the transfer actions are for administrators only', () => {
  beforeEach(() => { touched.n = 0 })

  for (const who of [null, { id: 'u', role: 'user', org_id: 'o' }, { id: 'a', role: 'agent', org_id: 'o' }, { id: 'm', role: 'manager', org_id: 'o' }, { id: 'v', role: 'user', org_id: null }]) {
    const label = who ? `${who.role}${who.org_id ? '' : ' without an organisation'}` : 'nobody signed in'
    it(`refuses ${label} for all ${calls.length} actions and touches nothing`, async () => {
      profile.current = who
      for (const [name, call] of calls) {
        const res = (await call()) as { error?: string; results?: unknown; saved?: number }
        expect(res.error, `${name} must refuse`).toBeTruthy()
        expect(res.results, `${name} must not move anything`).toBeUndefined()
      }
      expect(touched.n).toBe(0)
    })
  }

  it('lets an administrator past the role check (the first thing it then does is read data)', async () => {
    profile.current = { id: 'a', role: 'admin', org_id: 'o' }
    // it passes the role check and only then reaches for the (mocked) database, which throws: proof that the guard is the gate
    await expect(actions.setMovedActiveAction(true)).rejects.toThrow(/database was touched/)
  })
})
