// Health & Performance phases 3 and 4: what a browser may report (nothing personal, only sensible numbers) and the page-speed alert rule.
import { describe, it, expect } from 'vitest'
import { sanitizeRum, viewportClass, lcpRating, RUM_GOOD, RUM_POOR } from '@/lib/health/rum'
import { pageSpeedVerdict } from '@/lib/health/evaluate'
import { CHECKS, PAGE_LIMITS } from '@/lib/health/catalog'

describe('screen size groups', () => {
  it('phone under 640, tablet under 1024, laptop under 1440, else large', () => {
    expect([319, 639].map(viewportClass)).toEqual(['phone', 'phone'])
    expect([640, 1023].map(viewportClass)).toEqual(['tablet', 'tablet'])
    expect([1024, 1439].map(viewportClass)).toEqual(['laptop', 'laptop'])
    expect([1440, 2560].map(viewportClass)).toEqual(['desktop', 'desktop'])
  })
})

describe('what the server accepts from a browser', () => {
  const vitals = { kind: 'vitals', route: '/requests/123e4567-e89b-12d3-a456-426614174000?tab=x&secret=1', viewport_w: 1366, ttfb_ms: 180.4, load_ms: 2100, lcp_ms: 1800, cls: 0.0123456, inp_ms: 90 }
  it('a full-load report: the screen has ids and the query string removed, numbers are rounded', () => {
    const r = sanitizeRum(vitals)!
    expect(r).toMatchObject({ kind: 'vitals', route: '/requests/:id', viewport_w: 1366, vclass: 'laptop', ttfb_ms: 180, load_ms: 2100, lcp_ms: 1800, cls: 0.012, inp_ms: 90, overflow_px: null })
    expect(JSON.stringify(r)).not.toContain('secret')
  })
  it('a layout report: only the width and how far the content ran past the page', () => {
    expect(sanitizeRum({ kind: 'layout', route: '/requests/queue', viewport_w: 390, overflow_px: 42 })).toMatchObject({ kind: 'layout', vclass: 'phone', overflow_px: 42, lcp_ms: null, load_ms: null })
    expect(sanitizeRum({ kind: 'layout', route: '/home', viewport_w: 1280 })).toMatchObject({ overflow_px: 0 })
  })
  it('stores nothing personal: extra fields (user, e-mail, name) are never kept', () => {
    const r = sanitizeRum({ ...vitals, user_id: 'u1', email: 'a@b.c', full_name: 'X' })!
    expect(Object.keys(r).sort()).toEqual(['cls', 'inp_ms', 'kind', 'lcp_ms', 'load_ms', 'overflow_px', 'route', 'ttfb_ms', 'vclass', 'viewport_w'])
  })
  it('refuses wrong shapes, other screens than app pages, and impossible numbers', () => {
    expect(sanitizeRum(null)).toBeNull()
    expect(sanitizeRum('x')).toBeNull()
    expect(sanitizeRum({ ...vitals, kind: 'other' })).toBeNull()
    expect(sanitizeRum({ ...vitals, route: 'requests' })).toBeNull()
    expect(sanitizeRum({ ...vitals, route: '/api/admin/audit' })).toBeNull()
    expect(sanitizeRum({ ...vitals, viewport_w: 50 })).toBeNull()
    expect(sanitizeRum({ ...vitals, viewport_w: 'wide' })).toBeNull()
    expect(sanitizeRum({ kind: 'vitals', route: '/home', viewport_w: 1280 })).toBeNull()                  // nothing was measured
    const clamped = sanitizeRum({ ...vitals, lcp_ms: 999_999_999, cls: 50, inp_ms: -5 })!
    expect(clamped).toMatchObject({ lcp_ms: null, cls: null, inp_ms: null })                              // out of range = dropped, not stored
  })
})

describe('largest paint rating', () => {
  it('good up to 2.5 s, poor over 4 s', () => {
    expect(lcpRating(RUM_GOOD.lcpMs)).toBe('good')
    expect(lcpRating(RUM_GOOD.lcpMs + 1)).toBe('needs work')
    expect(lcpRating(RUM_POOR.lcpMs)).toBe('needs work')
    expect(lcpRating(RUM_POOR.lcpMs + 1)).toBe('poor')
    expect(lcpRating(null)).toBeNull()
  })
})

describe('page-speed alert', () => {
  const w = (n: number, p95: number, errors5xx = 0) => ({ n, p95, errors5xx })
  it('is fine with little traffic, whatever the numbers', () => {
    expect(pageSpeedVerdict([])).toMatchObject({ ok: true })
    expect(pageSpeedVerdict([w(10, 9000, 5)])).toMatchObject({ ok: true, detail: expect.stringContaining('not enough') })
  })
  it('fails when the weighted slow-page time reaches 4 s', () => {
    expect(PAGE_LIMITS.p95Ms).toBe(4000)
    expect(pageSpeedVerdict([w(100, 3999)]).ok).toBe(true)
    expect(pageSpeedVerdict([w(100, 4000)])).toMatchObject({ ok: false, detail: expect.stringContaining('4.0 s') })
    // weighted by requests: a busy fast window outweighs a tiny slow one
    expect(pageSpeedVerdict([w(950, 800), w(50, 9000)]).ok).toBe(true)
  })
  it('fails when 5% or more of the requests failed (and at least 5 did)', () => {
    expect(pageSpeedVerdict([w(100, 500, 4)]).ok).toBe(true)                    // 4% and under 5 failures
    expect(pageSpeedVerdict([w(100, 500, 5)])).toMatchObject({ ok: false, detail: expect.stringContaining('5% of requests failed') })
    expect(pageSpeedVerdict([w(1000, 500, 20)]).ok).toBe(true)                  // 2%
    expect(pageSpeedVerdict([w(40, 500, 3)]).ok).toBe(true)                     // 7.5% but only 3 failures: too few to call it an outage
  })
  it('is a check the app measures, in the servers group', () => {
    expect(CHECKS.find((c) => c.key === 'page_speed')).toMatchObject({ by: 'app', group: 'server' })
  })
})
