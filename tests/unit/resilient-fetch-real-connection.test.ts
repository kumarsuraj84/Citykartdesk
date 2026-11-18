import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { HEDGE_AFTER_MS, resetBreakers, resilientFetch } from '@/lib/supabase/resilient-fetch'

// The same protection against a real server and real connections (no fake clock): the first request is accepted and never answered, like a stuck worker or a dead
// pooled connection; the second copy, on a new connection, is answered at once.
describe('resilient fetch against a real server that stops answering one connection', () => {
  let server: http.Server | undefined
  afterEach(async () => { resetBreakers(); await new Promise<void>((r) => (server ? server.closeAllConnections?.() : null, server ? server.close(() => r()) : r())) })

  it('a read stuck on one connection is answered by a second connection after about 3 seconds', async () => {
    let seen = 0
    server = http.createServer((req, res) => {
      seen++
      if (seen === 1) return   // accepted, never answered
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('[{"ok":true}]')
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const t0 = Date.now()
    const res = await resilientFetch(`http://127.0.0.1:${port}/rest/v1/requests?select=id`)
    const took = Date.now() - t0
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ ok: true }])
    expect(seen).toBe(2)
    expect(took).toBeGreaterThanOrEqual(HEDGE_AFTER_MS - 100)
    expect(took).toBeLessThan(HEDGE_AFTER_MS + 1500)
  }, 15_000)

  it('a write stuck the same way is NOT sent again', async () => {
    let seen = 0
    server = http.createServer(() => { seen++ })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const ac = new AbortController()
    const p = resilientFetch(`http://127.0.0.1:${port}/rest/v1/requests`, { method: 'POST', body: '{}', signal: ac.signal }).catch((e) => e)
    await new Promise((r) => setTimeout(r, HEDGE_AFTER_MS + 600))
    expect(seen).toBe(1)
    ac.abort()
    expect(await p).toBeDefined()
  }, 15_000)
})
