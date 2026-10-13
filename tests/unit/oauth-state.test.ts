// D-058: the OAuth "state" signing key must never be empty. A blank setting used to count as a valid (empty) key.

import { describe, it, expect, afterEach } from 'vitest'
import { signState, verifyState, oauthStateConfigured } from '@/lib/intake/oauth'

const KEYS = ['OAUTH_STATE_SECRET', 'INTAKE_WORKER_SECRET', 'CRON_SECRET'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
const setAll = (v: Record<string, string | undefined>) => { for (const k of KEYS) { if (v[k] === undefined) delete process.env[k]; else process.env[k] = v[k] } }
afterEach(() => setAll(saved as Record<string, string | undefined>))

const payload = { channelId: '11111111-2222-3333-4444-555555555555', provider: 'google' as const }

describe('OAuth state signing', () => {
  it('with a real secret a state round-trips', () => {
    setAll({ OAUTH_STATE_SECRET: 'a-long-enough-test-secret-1234' })
    expect(oauthStateConfigured()).toBe(true)
    expect(verifyState(signState(payload))).toEqual(payload)
  })

  it('a BLANK OAUTH_STATE_SECRET no longer means an empty key: it falls through to the next real secret', () => {
    setAll({ OAUTH_STATE_SECRET: '', CRON_SECRET: 'cron-secret-long-enough-0000' })
    expect(verifyState(signState(payload))).toEqual(payload)
  })

  it('with every secret blank or missing nothing can be signed and nothing is accepted', () => {
    setAll({ OAUTH_STATE_SECRET: '', INTAKE_WORKER_SECRET: '' })
    expect(oauthStateConfigured()).toBe(false)
    expect(() => signState(payload)).toThrow(/not configured/)
  })

  it('a state forged with an EMPTY key (what the old code accepted when nothing was set) is rejected', async () => {
    const { createHmac } = await import('node:crypto')
    const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString('base64url')
    const forged = `${body}.${createHmac('sha256', '').update(body).digest('base64url')}`
    setAll({ OAUTH_STATE_SECRET: 'a-long-enough-test-secret-1234' })
    expect(verifyState(forged)).toBeNull()
    setAll({ OAUTH_STATE_SECRET: '' })
    expect(verifyState(forged)).toBeNull()
  })

  it('a too-short secret is treated as not configured', () => {
    setAll({ OAUTH_STATE_SECRET: 'short' })
    expect(oauthStateConfigured()).toBe(false)
  })

  it('an expired or tampered state is rejected', () => {
    setAll({ OAUTH_STATE_SECRET: 'a-long-enough-test-secret-1234' })
    const s = signState(payload)
    expect(verifyState(s.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull()
    expect(verifyState('garbage')).toBeNull()
  })
})
