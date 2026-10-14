import { describe, it, expect } from 'vitest'
import { redactText, redactValue, fingerprintOf, normalizeMessage, sourceOfUrl, errorCodeOfBody, judgeResponse, sourceOfLoggerEvent, boundedJson } from '@/lib/syslog/shape'

describe('redactText', () => {
  it('removes tokens, keys, passwords, e-mail addresses and phone numbers', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz'
    expect(redactText(`auth failed with ${jwt}`)).toBe('auth failed with [jwt]')
    expect(redactText('Authorization: Bearer abcdef1234567890xyz')).not.toContain('abcdef1234567890xyz')
    expect(redactText('sent header Bearer abcdef1234567890xyz today')).toBe('sent header Bearer [redacted] today')
    expect(redactText('login password=hunter2 for x')).toBe('login password=[redacted] for x')
    expect(redactText('{"api_key": "sk_live_abcdefghijk"}')).toContain('[redacted]')
    expect(redactText('mail to suraj@citykart.org failed')).toBe('mail to [email] failed')
    expect(redactText('call +91 98765 43210 now')).toBe('call [phone] now')
    expect(redactText('mobile 9876543210 invalid')).toBe('mobile [phone] invalid')
    expect(redactText('hash ' + 'a'.repeat(64))).toBe('hash [hex]')
  })
  it('leaves ordinary diagnostic text readable (ids, ticket numbers, timestamps, status codes)', () => {
    const t = 'Request 49762e2f-9499-414b-b2c3-707c023683fa CKSD-1099337 failed at 2026-10-14T00:56:07 with status 500 after 1791939349464 ms'
    expect(redactText(t)).toBe(t)
  })
})

describe('redactValue', () => {
  it('blanks secret-looking keys at any depth, redacts strings, and is bounded', () => {
    const out = redactValue({ user: 'a@b.com', password: 'x', nested: { authorization: 'Bearer abc', ok: 1 }, list: [{ token: 't' }] }) as Record<string, unknown>
    expect(out.user).toBe('[email]')
    expect(out.password).toBe('[redacted]')
    expect((out.nested as Record<string, unknown>).authorization).toBe('[redacted]')
    expect((out.nested as Record<string, unknown>).ok).toBe(1)
    expect(((out.list as Record<string, unknown>[])[0]).token).toBe('[redacted]')
    const deep: Record<string, unknown> = {}; let cur = deep
    for (let i = 0; i < 20; i++) { cur.n = {}; cur = cur.n as Record<string, unknown> }
    expect(JSON.stringify(redactValue(deep))).toContain('[too deep]')
    expect(Object.keys(redactValue(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]))) as object).length).toBeLessThanOrEqual(61)
  })
  it('boundedJson cuts a huge value instead of storing it', () => {
    const out = boundedJson({ a: 'x'.repeat(10_000) }, 500) as { truncated: string }
    expect(out.truncated.length).toBe(500)
    expect(boundedJson(undefined)).toBeNull()
  })
})

describe('fingerprints group the same problem', () => {
  it('ignores ids, numbers and addresses but not the cause', () => {
    const a = fingerprintOf({ source: 'database', code: '57014', message: 'canceling statement after 8000 ms on 49762e2f-9499-414b-b2c3-707c023683fa', where: '/rest/v1/requests' })
    const b = fingerprintOf({ source: 'database', code: '57014', message: 'canceling statement after 9100 ms on 11111111-2222-3333-4444-555555555555', where: '/rest/v1/requests' })
    const c = fingerprintOf({ source: 'database', code: '42501', message: 'canceling statement after 8000 ms', where: '/rest/v1/requests' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{14}$/)
    expect(normalizeMessage('Ticket CKSD-1099337 http://x.test/a?b=1 failed 12 times')).toBe('ticket cksd-<n> <url> failed <n> times')
  })
})

describe('classifying a failed call', () => {
  it('knows which service a URL belongs to', () => {
    expect(sourceOfUrl('http://h/rest/v1/requests?select=id')).toBe('database')
    expect(sourceOfUrl('http://h/auth/v1/token')).toBe('auth')
    expect(sourceOfUrl('http://h/storage/v1/object/x')).toBe('storage')
    expect(sourceOfUrl('https://api.resend.com/emails')).toBe('integration')
  })
  it('reads the error code from a PostgREST / auth body', () => {
    expect(errorCodeOfBody('{"code":"57014","message":"canceling statement due to statement timeout"}')).toEqual({ code: '57014', message: 'canceling statement due to statement timeout' })
    expect(errorCodeOfBody('not json at all')).toEqual({ code: null, message: 'not json at all' })
  })
  it('records server errors and denials, ignores the expected "no row" / duplicate / wrong password cases', () => {
    expect(judgeResponse(500, 'database', null)).toMatchObject({ record: true, severity: 'error', category: 'error' })
    expect(judgeResponse(503, 'integration', null)).toMatchObject({ record: true, severity: 'error' })
    expect(judgeResponse(403, 'database', '42501')).toMatchObject({ record: true, category: 'security', outcome: 'denied' })
    expect(judgeResponse(400, 'database', 'PGRST100')).toMatchObject({ record: true, severity: 'warning' })
    expect(judgeResponse(429, 'integration', null)).toMatchObject({ record: true, severity: 'warning' })
    expect(judgeResponse(404, 'database', 'PGRST205')).toMatchObject({ record: true, severity: 'error' })   // table / function missing
    for (const v of [judgeResponse(200, 'database', null), judgeResponse(404, 'database', null), judgeResponse(406, 'database', 'PGRST116'), judgeResponse(409, 'database', '23505'),
                     judgeResponse(400, 'auth', 'invalid_credentials'), judgeResponse(422, 'auth', null), judgeResponse(400, 'database', '23505')]) {
      expect(v.record).toBe(false)
    }
  })
  it('maps logger events onto sources', () => {
    expect(sourceOfLoggerEvent('cron.business_rules.rule_failed')).toBe('cron')
    expect(sourceOfLoggerEvent('email.send_failed')).toBe('integration')
    expect(sourceOfLoggerEvent('error_sanitized', 'requests.ts#assignRequest')).toBe('server_action')
    expect(sourceOfLoggerEvent('error_sanitized', 'app/api/storage/x')).toBe('api_route')
    expect(sourceOfLoggerEvent('something', undefined)).toBe('app_server')
  })
})
