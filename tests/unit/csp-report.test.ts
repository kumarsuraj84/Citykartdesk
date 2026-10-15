import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const record = vi.hoisted(() => vi.fn(async () => {}))
const limit = vi.hoisted(() => vi.fn(async () => ({ limited: false, remaining: 10 })))
vi.mock('@/lib/syslog/record', () => ({ recordSystemLog: record }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: limit, getClientIp: async () => null }))

import { POST } from '@/app/api/csp-report/route'
import { buildCspReportOnly } from '@/lib/http/csp'

const post = (body: unknown, raw = false) => POST(new NextRequest('http://localhost:3210/api/csp-report', { method: 'POST', body: raw ? (body as string) : JSON.stringify(body), headers: { 'content-type': 'application/csp-report', 'x-forwarded-for': '9.9.9.9' } }))
beforeEach(() => { record.mockClear(); limit.mockClear(); limit.mockResolvedValue({ limited: false, remaining: 10 }) })

describe('the report-only Content-Security-Policy (D-033)', () => {
  it('reports only: it never uses the blocking header, and names the report address and the database origin', () => {
    const p = buildCspReportOnly('http://10.0.0.205:8000/')
    expect(p).toContain('report-uri /api/csp-report')
    expect(p).toContain("frame-ancestors 'self'")
    expect(p).toContain("object-src 'none'")
    expect(p).toContain('connect-src')
    expect(p).toContain('http://10.0.0.205:8000')
    expect(buildCspReportOnly(undefined)).not.toContain('undefined')
    expect(buildCspReportOnly('not a url')).toContain("default-src 'self'")
  })
})

describe('/api/csp-report', () => {
  it('records a violation (old format) with the page and what was blocked, without query strings', async () => {
    const res = await post({ 'csp-report': { 'document-uri': 'http://app.test/requests/1?token=SECRET', 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js?k=SECRET', 'line-number': 12 } })
    expect(res.status).toBe(204)
    expect(record).toHaveBeenCalledTimes(1)
    const [entry, opts] = record.mock.calls[0] as unknown as [Record<string, unknown>, { floodKey: string }]
    expect(entry).toMatchObject({ category: 'event', source: 'browser', action: 'security.csp_violation', path: '/requests/1' })
    expect(JSON.stringify(entry)).not.toContain('SECRET')
    expect(String(entry.message)).toContain('https://evil.example/x.js')
    expect(opts.floodKey).toContain('script-src')
  })
  it('understands the newer list format too', async () => {
    await post([{ type: 'csp-violation', body: { documentURL: 'http://app.test/home', effectiveDirective: 'img-src', blockedURL: 'https://x.example/a.png' } }])
    expect(record).toHaveBeenCalledTimes(1)
  })
  it('ignores rubbish, oversize bodies, reports without a directive, and callers over the limit — always with 204', async () => {
    for (const body of ['not json', '{}', JSON.stringify({ 'csp-report': {} }), 'x'.repeat(9000)]) expect((await post(body, true)).status).toBe(204)
    limit.mockResolvedValue({ limited: true, remaining: 0 })
    expect((await post({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'x' } })).status).toBe(204)
    expect(record).not.toHaveBeenCalled()
  })
})
