// Migration 193: the alert claim table (audit G-20). The run of /api/alerts/run that inserts a claim owns the alert; a second run at the same moment finds the row and skips it.
// The claim time is the database's own clock. Runs on the isolated audit stack only.
import { describe, it, expect, afterAll } from 'vitest'
import { getAdmin, createTestUser, clientForToken } from '../setup/fixtures-d03'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const key = `alert:test:t57${Date.now()}`

async function claim(k: string) {
  const { data, error } = await db().from('alert_claims').upsert({ key: k }, { onConflict: 'key', ignoreDuplicates: true }).select('claimed_at')
  expect(error).toBeNull()
  return (data as { claimed_at: string }[])[0] ?? null
}

afterAll(async () => { await db().from('alert_claims').delete().like('key', 'alert:test:t57%') })

describe('alert claims', () => {
  it('only one of two overlapping runs owns an alert', async () => {
    const [a, b] = await Promise.all([claim(key), claim(key)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(await claim(key)).toBeNull()
  })

  it('the claim time is the database clock (close to now, set by the database, not sent by the app)', async () => {
    const k = `${key}-clock`
    const got = await claim(k)
    expect(got).not.toBeNull()
    expect(Math.abs(Date.now() - new Date(got!.claimed_at).getTime())).toBeLessThan(5 * 60_000)
  })

  it('a released claim can be taken again (a failed send gives it back)', async () => {
    const k = `${key}-release`
    expect(await claim(k)).not.toBeNull()
    await db().from('alert_claims').delete().eq('key', k)
    expect(await claim(k)).not.toBeNull()
  })

  it('a signed-in user cannot read or write the table', async () => {
    const user = await createTestUser(`t57${Date.now() % 100000}`, 'T57 User')
    const client = clientForToken(user.accessToken)
    const read = await client.from('alert_claims' as never).select('key').limit(1)
    expect(read.error).not.toBeNull()
    const write = await client.from('alert_claims' as never).insert({ key: `alert:test:t57-user` } as never)
    expect(write.error).not.toBeNull()
    await getAdmin().auth.admin.deleteUser(user.id)
  })
})
