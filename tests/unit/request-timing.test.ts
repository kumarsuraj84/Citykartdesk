import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createTimingCollector, installRequestTiming, normalizeRoute } from '@/lib/observability/request-timing'

// Per-route request timing (load review 4 Nov 2026). Nothing personal is recorded: ids and the query string are removed.

describe('the route that is recorded', () => {
  it('removes ids, ticket numbers and the query string', () => {
    expect(normalizeRoute('/requests/123e4567-e89b-12d3-a456-426614174000?tab=approvals')).toBe('/requests/:id')
    expect(normalizeRoute('/requests/CKSD-000741')).toBe('/requests/:no')
    expect(normalizeRoute('/api/pms/20261104')).toBe('/api/pms/:n')
    expect(normalizeRoute('/api/notifications/new?since=2026-11-04T10%3A00')).toBe('/api/notifications/new')
    expect(normalizeRoute('/')).toBe('/')
    expect(normalizeRoute(undefined)).toBe('/')
  })
  it('leaves static files out', () => {
    expect(normalizeRoute('/_next/static/chunks/abc.js')).toBeNull()
    expect(normalizeRoute('/favicon.ico')).toBeNull()
  })
})

describe('the figures of a window', () => {
  it('gives count, median, 95th percentile, slowest and failures per route, busiest first', () => {
    const c = createTimingCollector()
    for (let i = 1; i <= 100; i++) c.record('GET', '/home', 200, i)          // 1..100 ms
    c.record('GET', '/dashboards/executive', 200, 1200)
    c.record('GET', '/dashboards/executive', 500, 1400)
    const out = c.flush()
    expect(out.map((r) => r.route)).toEqual(['/home', '/dashboards/executive'])   // /home has the larger total time
    const home = out[0]
    expect(home).toMatchObject({ n: 100, max: 100, errors5xx: 0 })
    expect(home.p50).toBeGreaterThanOrEqual(50); expect(home.p50).toBeLessThanOrEqual(51)
    expect(home.p95).toBeGreaterThanOrEqual(95)
    expect(out[1]).toMatchObject({ n: 2, max: 1400, errors5xx: 1 })
    expect(c.flush()).toEqual([])   // emptied by the flush
  })
  it('does not grow without limit when routes keep changing', () => {
    const c = createTimingCollector()
    for (let i = 0; i < 1000; i++) c.record('GET', `/r${i}`, 200, 1)
    expect(c.size()).toBeLessThanOrEqual(200)
  })
})

describe('the hook on the HTTP server', () => {
  it('records a real request, logs a slow one at once and a summary at the end of the window, and can be switched off again', async () => {
    const lines: { kind: 'log' | 'warn'; text: string }[] = []
    const timing = installRequestTiming({
      httpServer: http.Server as never, slowMs: 30, windowMs: 3_600_000,
      log: { log: (t) => lines.push({ kind: 'log', text: t }), warn: (t) => lines.push({ kind: 'warn', text: t }) },
    })
    const server = http.createServer((req, res) => {
      const wait = req.url?.startsWith('/slow') ? 60 : 0
      setTimeout(() => { res.writeHead(200); res.end('ok') }, wait)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as AddressInfo).port
    const get = (path: string) => new Promise<void>((resolve, reject) => { http.get({ host: '127.0.0.1', port, path, agent: false }, (res) => { res.resume(); res.on('end', () => resolve()) }).on('error', reject) })
    try {
      await get('/fast/123e4567-e89b-12d3-a456-426614174000')
      await get('/slow/page?secret=1')
      await new Promise((r) => setTimeout(r, 20))
      const warns = lines.filter((l) => l.kind === 'warn').map((l) => JSON.parse(l.text).slow_request)
      expect(warns).toHaveLength(1)
      expect(warns[0]).toMatchObject({ method: 'GET', route: '/slow/page', status: 200 })
      expect(warns[0].ms).toBeGreaterThanOrEqual(30)
      expect(JSON.stringify(lines)).not.toContain('secret')                     // the query string is never written
      timing.flushNow()
      const summary = JSON.parse(lines.filter((l) => l.kind === 'log').pop()!.text).request_timing
      expect(summary.routes.map((r: { route: string }) => r.route).sort()).toEqual(['/fast/:id', '/slow/page'])
    } finally {
      timing.stop()
      server.closeAllConnections(); server.close()
    }
    // switched off: a request after stop() is not recorded
    const before = lines.length
    const server2 = http.createServer((_req, res) => { res.writeHead(200); res.end('ok') })
    await new Promise<void>((r) => server2.listen(0, '127.0.0.1', () => r()))
    await new Promise<void>((resolve) => http.get({ host: '127.0.0.1', port: (server2.address() as AddressInfo).port, path: '/x', agent: false }, (res) => { res.resume(); res.on('end', () => resolve()) }))
    expect(lines.length).toBe(before)
    server2.closeAllConnections(); server2.close()
    vi.restoreAllMocks()
  })
})
