import { describe, expect, it } from 'vitest'
import { checkUpstream } from '@/lib/ckoneai/path'
import { inPilot, readCkoneaiConfig } from '@/lib/ckoneai/config'

const ok = (p: string, s = '', m = 'GET') => checkUpstream(p, s, m)

describe('which addresses may be forwarded (the exact list)', () => {
  const ID = '3f2a91c4-0b7e-4d21-9a55-6c1e0f8b2d10'
  it.each([
    ['GET', '/api/ckoneai/health'], ['GET', '/api/ckoneai/capabilities'], ['GET', '/api/ckoneai/starters'],
    ['POST', '/api/ckoneai/chat'], ['POST', '/api/ckoneai/chat/stop'], ['POST', '/api/ckoneai/feedback'], ['POST', '/api/ckoneai/events/navigation'],
    ['GET', '/api/ckoneai/conversations'], ['POST', '/api/ckoneai/conversations'],
    ['GET', `/api/ckoneai/conversations/${ID}`], ['PATCH', `/api/ckoneai/conversations/${ID}`], ['DELETE', `/api/ckoneai/conversations/${ID}`],
    ['DELETE', '/api/ckoneai/history'], ['GET', `/api/ckoneai/messages/${ID}`],
    ['GET', '/ckoneai-ui'], ['GET', '/ckoneai-ui/'], ['HEAD', '/ckoneai-ui/index.html'], ['GET', '/ckoneai-ui/assets/index-a1B2.js'], ['GET', '/ckoneai-ui/favicon.svg'],
  ])('accepts %s %s', (m, p) => { expect(ok(p, '', m)).toMatchObject({ ok: true }) })

  it('the query is kept exactly as received (never re-sorted); the page address is normalised once', () => {
    const r = ok('/api/ckoneai/conversations', '?z=1&a=2&z=3')
    expect(r.ok && r.value.target).toBe('/api/ckoneai/conversations?z=1&a=2&z=3')
    const u = ok('/ckoneai-ui', '?embed=1&bridge=ckdesk')
    expect(u.ok && u.value.target).toBe('/ckoneai-ui/?embed=1&bridge=ckdesk')
  })

  it('the chat page is served by CKOneAI from its root: /ckoneai-ui/<x> goes upstream as /<x>; the API address is unchanged', () => {
    const up = (p: string, s = '', m = 'GET') => { const r = ok(p, s, m); return r.ok ? r.value.upstream : r }
    expect(up('/ckoneai-ui', '?embed=1&bridge=ckdesk')).toBe('/?embed=1&bridge=ckdesk')
    expect(up('/ckoneai-ui/')).toBe('/')
    expect(up('/ckoneai-ui/assets/index-DLPDNTnL.js')).toBe('/assets/index-DLPDNTnL.js')
    expect(up('/ckoneai-ui/favicon.svg')).toBe('/favicon.svg')
    expect(up('/api/ckoneai/chat', '', 'POST')).toBe('/api/ckoneai/chat')
    expect(up('/api/ckoneai/conversations', '?z=1&a=2')).toBe('/api/ckoneai/conversations?z=1&a=2')
  })

  it.each([
    ['an address CKOneAI closes for CK Desk', '/api/ckoneai/question-library'],
    ['coverage', '/api/ckoneai/coverage'],
    ['handoff', '/api/ckoneai/handoff/selection'],
    ['anything under admin', '/api/ckoneai/admin/users'],
    ['an unknown name', '/api/ckoneai/whatever'],
    ['a different prefix', '/api/other/chat'],
    ['the bare prefix', '/api/ckoneai/'],
    ['a dot-dot segment', '/api/ckoneai/../admin'],
    ['a dot-dot in a file name', '/ckoneai-ui/a..b.js'],
    ['an encoded slash', '/api/ckoneai/conversations/a%2Fb'],
    ['an encoded dot', '/api/ckoneai/%2e%2e/x'],
    ['a backslash', '/api/ckoneai/chat\\x'],
    ['an empty segment', '/api/ckoneai/conversations//'],
    ['an id with other characters', '/api/ckoneai/conversations/not_an_id!'],
    ['a short id', '/api/ckoneai/conversations/abc'],
    ['a hidden file', '/ckoneai-ui/.env'],
    ['a directory slash', '/ckoneai-ui/assets/'],
    ['a deeper ui path', '/ckoneai-ui/a/b/c.js'],
    ['another folder than assets', '/ckoneai-ui/other/x.js'],
    ['a control character', '/api/ckoneai/chat\u0000'],
    ['the other app prefix', '/ckoneai-ui-evil/x'],
  ])('refuses %s', (_name, p) => { expect(ok(p)).toMatchObject({ ok: false, status: 400 }) })

  it.each([
    ['a fragment in the query', '?a=1#x'],
    ['a second question mark', '?a=1?b=2'],
    ['a newline in the query', '?a=1\nx-ckdesk-user: y'],
    ['a backslash in the query', '?a=\\x'],
    ['a query that does not start with ?', 'a=1'],
    ['a very long query', '?a=' + 'x'.repeat(2100)],
  ])('refuses %s', (_name, s) => { expect(ok('/api/ckoneai/capabilities', s)).toMatchObject({ ok: false, status: 400 }) })

  it('refuses a method the address does not take', () => {
    expect(ok('/api/ckoneai/chat', '', 'GET')).toMatchObject({ ok: false, status: 405 })
    expect(ok('/api/ckoneai/chat', '', 'PUT')).toMatchObject({ ok: false, status: 405 })
    expect(ok('/api/ckoneai/capabilities', '', 'POST')).toMatchObject({ ok: false, status: 405 })
    expect(ok('/api/ckoneai/history', '', 'GET')).toMatchObject({ ok: false, status: 405 })
    expect(ok('/ckoneai-ui/', '', 'POST')).toMatchObject({ ok: false, status: 405 })
    expect(ok('/ckoneai-ui/', '', 'DELETE')).toMatchObject({ ok: false, status: 405 })
  })
})

describe('the settings', () => {
  const SECRET = 'x'.repeat(40)
  const good = { CKONEAI_ENABLED: '1', CKONEAI_BASE_URL: 'http://10.0.0.82:8100', CKONEAI_BRIDGE_SECRET_CKDESK: SECRET, CKONEAI_PILOT_USER_IDS: '*' }

  it('is OFF unless the switch is exactly 1', () => {
    expect(readCkoneaiConfig({ ...good, CKONEAI_ENABLED: undefined }).on).toBe(false)
    expect(readCkoneaiConfig({ ...good, CKONEAI_ENABLED: 'true' }).on).toBe(false)
    expect(readCkoneaiConfig({ ...good, CKONEAI_ENABLED: '0' }).on).toBe(false)
    expect(readCkoneaiConfig(good).on).toBe(true)
  })

  it('is OFF with a missing or short secret, and never opens', () => {
    expect(readCkoneaiConfig({ ...good, CKONEAI_BRIDGE_SECRET_CKDESK: undefined }).on).toBe(false)
    expect(readCkoneaiConfig({ ...good, CKONEAI_BRIDGE_SECRET_CKDESK: 'short' }).on).toBe(false)
    expect(readCkoneaiConfig({ ...good, CKONEAI_BRIDGE_SECRET_CKDESK: 'x'.repeat(31) }).on).toBe(false)
  })

  it('takes only a plain address', () => {
    for (const bad of ['', 'not a url', 'ftp://10.0.0.82', 'http://u:p@10.0.0.82:8100', 'http://10.0.0.82:8100/api', 'http://10.0.0.82:8100/?x=1', 'http://10.0.0.82:8100/#a']) {
      expect(readCkoneaiConfig({ ...good, CKONEAI_BASE_URL: bad }).on, bad).toBe(false)
    }
    const c = readCkoneaiConfig({ ...good, CKONEAI_BASE_URL: 'http://10.0.0.82:8100/' })
    expect(c.on && c.baseUrl).toBe('http://10.0.0.82:8100')
  })

  it('needs a pilot list: ids, or * for everyone; a bad id switches it off', () => {
    expect(readCkoneaiConfig({ ...good, CKONEAI_PILOT_USER_IDS: '' }).on).toBe(false)
    expect(readCkoneaiConfig({ ...good, CKONEAI_PILOT_USER_IDS: 'not-an-id' }).on).toBe(false)
    const A = '11111111-2222-4333-8444-555555555555'
    const B = '66666666-7777-4888-9999-000000000000'
    const c = readCkoneaiConfig({ ...good, CKONEAI_PILOT_USER_IDS: ` ${A.toUpperCase()} , ${B} ` })
    expect(c.on).toBe(true)
    if (c.on) {
      expect(inPilot(c, A)).toBe(true)
      expect(inPilot(c, B.toUpperCase())).toBe(true)
      expect(inPilot(c, '11111111-2222-4333-8444-555555555556')).toBe(false)
    }
    const all = readCkoneaiConfig(good)
    expect(all.on && inPilot(all, A)).toBe(true)
  })

  it('the reason never contains the secret', () => {
    const c = readCkoneaiConfig({ ...good, CKONEAI_BASE_URL: 'nope' })
    expect(JSON.stringify(c)).not.toContain(SECRET)
  })
})
