import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'

// The data-service proxy (deploy/windows/proxy/server.js) keeps pooled connections to Auth / PostgREST. Load review of 4 Nov 2026: a pooled connection the other side had closed made
// requests fail ("socket hang up"), and the single retry could pick ANOTHER dead pooled connection, so 430 requests failed outright. The retry now opens a fresh connection, and an
// idle pooled connection is dropped by the proxy itself after IDLE_SOCKET_MS, before the other side closes it.

const requireCjs = createRequire(import.meta.url)
const { createProxyServer, pooledAgent, IDLE_SOCKET_MS } = requireCjs('../../deploy/windows/proxy/server.js') as {
  createProxyServer: (routes: { prefix: string; target: { host: string; port: number }; pooled: boolean }[]) => http.Server
  pooledAgent: http.Agent
  IDLE_SOCKET_MS: number
}

const closers: (() => void)[] = []
afterEach(() => { while (closers.length) closers.pop()!(); pooledAgent.destroy() })

const listen = (server: http.Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
const get = (port: number, path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  // keep-alive like real traffic (a browser / the app): the connection header is passed on to the upstream, which is what makes the proxy keep its upstream connection
  http.get({ host: '127.0.0.1', port, path, agent: false, headers: { connection: 'keep-alive' } }, (res) => {
    let body = ''
    res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
  }).on('error', reject)
})

// an upstream that behaves like a server that has closed an idle connection: the SECOND request on any connection is answered by dropping the connection
function flakyUpstream() {
  const seen = new WeakMap<object, number>()
  const server = http.createServer((req, res) => {
    const n = (seen.get(req.socket) ?? 0) + 1
    seen.set(req.socket, n)
    if (n > 1) { req.socket.destroy(); return }
    res.writeHead(200, { 'content-type': 'application/json', connection: 'keep-alive' })
    res.end('{"ok":true}')
  })
  closers.push(() => { server.closeAllConnections(); server.close() })
  return server
}

async function proxyTo(upstream: http.Server) {
  const upstreamPort = await listen(upstream)
  const proxy = createProxyServer([{ prefix: '/rest/v1', target: { host: '127.0.0.1', port: upstreamPort }, pooled: true }])
  closers.push(() => { proxy.closeAllConnections(); proxy.close() })
  return listen(proxy)
}

describe('the proxy and connections that died while they sat in the pool', () => {
  it('answers every request: a request that finds a dead pooled connection is retried on a fresh one', async () => {
    const port = await proxyTo(flakyUpstream())
    // six at once: six pooled connections, each has now served one request
    const first = await Promise.all(Array.from({ length: 6 }, () => get(port, '/rest/v1/a')))
    expect(first.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200])
    // three more: each takes a pooled connection, the upstream drops it, and the retry must NOT take another (equally dead) pooled connection
    const second = await Promise.all(Array.from({ length: 3 }, () => get(port, '/rest/v1/b')))
    expect(second.map((r) => r.status)).toEqual([200, 200, 200])
    expect(second.every((r) => r.body === '{"ok":true}')).toBe(true)
  })

  it('an idle pooled connection is dropped by the proxy before the other side can close it', async () => {
    expect(IDLE_SOCKET_MS).toBeLessThanOrEqual(10_000)
    expect((pooledAgent as unknown as { options: { timeout?: number } }).options.timeout).toBe(IDLE_SOCKET_MS)
  })

  it('still reuses connections under steady traffic (the pool is not switched off)', async () => {
    expect((pooledAgent as unknown as { keepAlive: boolean }).keepAlive).toBe(true)
  })
})
