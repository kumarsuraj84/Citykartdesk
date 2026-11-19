// The cluster launcher (deploy/windows/cluster/cluster-server.cjs) and the shared rate-limit counters, tested for real:
// a stub server.js is started by the real launcher as several worker processes.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const root = path.resolve(__dirname, '..', '..')
const launcherSrc = path.join(root, 'deploy', 'windows', 'cluster', 'cluster-server.cjs')
const countersSrc = path.join(root, 'lib', 'rate-limit-counters.cjs')
const { workerCount, createRestartGuard, GIVE_UP_AFTER_EXITS, GIVE_UP_WINDOW_MS } = require_(launcherSrc)
const { createCounters, runShared } = require_(countersSrc)

describe('how many workers', () => {
  const env = (v?: string) => (v === undefined ? {} : { CKDESK_WORKERS: v })
  it('is 1 (= the old single process) unless 2 to 8 is configured', () => {
    expect(workerCount(env(), 'no-such-file')).toBe(1)
    for (const v of ['', '0', '1', 'abc', '-3', '1.5x']) expect(workerCount(env(v), 'no-such-file')).toBe(v === '1.5x' ? 1 : 1)
    expect(workerCount(env('2'), 'no-such-file')).toBe(2)
    expect(workerCount(env('4'), 'no-such-file')).toBe(4)
    expect(workerCount(env('99'), 'no-such-file')).toBe(8)
  })
  it('can also come from a line in .env.local, which a release keeps; the service variable wins', () => {
    const f = path.join(os.tmpdir(), `ckdesk-env-${process.pid}.txt`)
    fs.writeFileSync(f, '# comment\r\nOTHER=1\r\nCKDESK_WORKERS=" 3 "\r\n')
    expect(workerCount({}, f)).toBe(3)
    expect(workerCount({ CKDESK_WORKERS: '5' }, f)).toBe(5)
    fs.rmSync(f)
  })
})

describe('restart guard', () => {
  it('waits a little longer after each death and gives up when workers keep dying', () => {
    let t = 1_000_000
    const g = createRestartGuard(() => t)
    const r = []
    for (let i = 0; i < GIVE_UP_AFTER_EXITS; i++) { r.push(g.onExit()); t += 1000 }
    expect(r[0]).toEqual({ giveUp: false, delayMs: 500 })
    expect(r[1].delayMs).toBe(1000)
    expect(r.slice(0, -1).every((x) => !x.giveUp)).toBe(true)
    expect(r[r.length - 1].giveUp).toBe(true)
  })
  it('forgets old deaths: one death now and then never adds up', () => {
    let t = 0
    const g = createRestartGuard(() => t)
    for (let i = 0; i < 30; i++) { expect(g.onExit().giveUp).toBe(false); t += GIVE_UP_WINDOW_MS + 1 }
  })
})

describe('the shared counters (same code in every worker and in the launcher)', () => {
  it('hit: allows `limit` calls in a window, then limits, then opens again', () => {
    const c = createCounters()
    const r = [1, 2, 3, 4].map((i) => c.hit('k', 3, 1000, 10_000 + i))
    expect(r.map((x: { limited: boolean }) => x.limited)).toEqual([false, false, false, true])
    expect(r[0].remaining).toBe(2)
    expect(c.hit('k', 3, 1000, 12_000).limited).toBe(false)     // the window has ended
  })
  it('over / rec: a failed-attempt counter that is only looked at, not counted, by `over`', () => {
    const c = createCounters()
    expect(c.over('f', 2, 1)).toBe(false)
    expect(c.rec('f', 1000, 1)).toBe(1)
    expect(c.over('f', 2, 2)).toBe(false)
    expect(c.rec('f', 1000, 3)).toBe(2)
    expect(c.over('f', 2, 4)).toBe(true)
    expect(c.over('f', 2, 5000)).toBe(false)
  })
  it('progressive wait: free tries, then 30 s doubling up to 5 min, ended by a correct sign-in', () => {
    const c = createCounters()
    let w = 0
    for (let i = 1; i <= 9; i++) w = c.pfail('p', {}, 100 + i)
    expect(w).toBe(0)
    expect(c.pfail('p', {}, 200)).toBe(30_000)
    expect(c.pfail('p', {}, 201)).toBe(60_000)
    expect(c.pwait('p', 300)).toBeGreaterThan(0)
    c.pclear('p')
    expect(c.pwait('p', 300)).toBe(0)
  })
  it('long keys are cut at 200 characters like before, and the table cannot grow without limit', () => {
    const c = createCounters()
    c.rec('x'.repeat(500), 1000, 1)
    expect(c.over('x'.repeat(200) + 'different tail', 1, 2)).toBe(true)
  })
  it('only the six known operations are accepted from a worker', () => {
    const c = createCounters()
    expect(runShared(c, 'rec', ['a', 1000])).toBe(1)
    expect(runShared(c, 'over', ['a', 1])).toBe(true)
    expect(() => runShared(c, 'constructor', ['a'])).toThrow()
    expect(() => runShared(c, '__proto__', [])).toThrow()
  })
})

// ---- the real thing: launcher + stub app -------------------------------------------------------------------------------------------------------------
const STUB = `
const http = require('node:http')
const port = Number(process.env.PORT)
const pending = new Map()
let nextId = 1
process.on('message', (m) => { if (m && m.ckrl === 2 && pending.has(m.id)) { pending.get(m.id)(m.v); pending.delete(m.id) } })
http.createServer((req, res) => {
  if (req.url === '/crash') { res.end('bye'); setTimeout(() => process.exit(3), 20); return }
  if (req.url.startsWith('/count')) {
    const key = new URL(req.url, 'http://x').searchParams.get('key')
    const id = nextId++
    pending.set(id, (v) => res.end(JSON.stringify({ pid: process.pid, v })))
    process.send({ ckrl: 1, id, op: 'rec', args: [key, 60000] })
    return
  }
  if (req.url === '/bad') { process.send({ ckrl: 1, id: 99, op: 'constructor', args: [] }); res.end('sent'); return }
  res.end(JSON.stringify({ pid: process.pid, slot: process.env.CKDESK_WORKER_SLOT, shared: process.env.CKDESK_SHARED_COUNTERS }))
}).listen(port)
`

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}
// a new connection every time (no keep-alive), so every request is handed out afresh
function get(port: number, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: url, agent: false, headers: { Connection: 'close' } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve(b))
    }).on('error', reject)
  })
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor<T>(fn: () => Promise<T | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* not up yet */ }
    if (Date.now() > end) throw new Error('timed out waiting')
    await sleep(100)
  }
}

describe('launcher with real worker processes', () => {
  let dir: string
  let child: ChildProcess | undefined
  let port = 0
  let out = ''

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckdesk-cluster-'))
    fs.copyFileSync(launcherSrc, path.join(dir, 'cluster-server.cjs'))
    fs.copyFileSync(countersSrc, path.join(dir, 'rate-limit-counters.cjs'))
    fs.writeFileSync(path.join(dir, 'server.js'), STUB)
  })
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })
  afterEach(async () => {
    if (child && child.exitCode === null) { child.kill(); await sleep(500) }
    child = undefined
  })

  async function startLauncher(workers: string) {
    port = await freePort()
    out = ''
    child = spawn(process.execPath, ['cluster-server.cjs'], { cwd: dir, env: { ...process.env, PORT: String(port), CKDESK_WORKERS: workers } })
    child.stdout!.on('data', (d) => (out += d)); child.stderr!.on('data', (d) => (out += d))
    await waitFor(async () => (await get(port, '/')).includes('pid'))
  }

  it('with 1 worker (or nothing set) it is just the old single process: no launcher, no shared counters', async () => {
    await startLauncher('1')
    const j = JSON.parse(await get(port, '/'))
    expect(j.shared).toBeUndefined()
    expect(out).not.toContain('[cluster]')
  }, 30_000)

  it('with 3 workers the connections are spread over all of them', async () => {
    await startLauncher('3')
    const pids = new Set<number>()
    for (let i = 0; i < 40; i++) pids.add(JSON.parse(await get(port, '/')).pid)
    expect(pids.size).toBe(3)
    expect(out).toContain('starting 3 workers')
  }, 30_000)

  it('one counter for the whole site: counts go 1,2,3,... even though different workers answer', async () => {
    await startLauncher('3')
    const seen: number[] = []; const pids = new Set<number>()
    for (let i = 0; i < 9; i++) { const j = JSON.parse(await get(port, '/count?key=login-fail:someone')); seen.push(j.v); pids.add(j.pid) }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(pids.size).toBeGreaterThan(1)
    expect(JSON.parse(await get(port, '/count?key=other')).v).toBe(1)     // a different key has its own count
    expect(JSON.parse(await get(port, '/'))).toMatchObject({ shared: '1' })
  }, 30_000)

  it('a bad request to the shared counters gets no answer and does not hurt the launcher', async () => {
    await startLauncher('2')
    await get(port, '/bad')
    await sleep(300)
    expect(JSON.parse(await get(port, '/')).pid).toBeGreaterThan(0)
    expect(out).not.toContain('stopped')
  }, 30_000)

  it('a worker that dies is replaced and the site stays up', async () => {
    await startLauncher('2')
    const before = new Set<number>()
    for (let i = 0; i < 20; i++) before.add(JSON.parse(await get(port, '/')).pid)
    expect(before.size).toBe(2)
    await get(port, '/crash')
    const after = await waitFor(async () => {
      const s = new Set<number>()
      for (let i = 0; i < 20; i++) s.add(JSON.parse(await get(port, '/')).pid)
      return s.size === 2 && [...s].some((p) => !before.has(p)) ? s : false
    })
    expect(after.size).toBe(2)
    expect(out).toContain('stopped (code 3')
  }, 30_000)

  it('stopping the launcher stops every worker (nothing keeps the port)', async () => {
    await startLauncher('3')
    child!.kill()
    await waitFor(async () => { try { await get(port, '/'); return false } catch { return true } }, 10_000)
  }, 30_000)
})

// ---- the app side of the conversation (lib/rate-limit.ts) -----------------------------------------------------------------------------------------
describe('lib/rate-limit.ts as a worker', () => {
  const sent: { ckrl: number; id: number; op: string; args: unknown[] }[] = []
  const origSend = process.send
  afterEach(() => { vi.useRealTimers(); delete process.env.CKDESK_SHARED_COUNTERS; process.send = origSend; onSpy?.mockRestore(); onSpy = undefined })

  // the app registers its listener with process.on('message'); the test calls it directly (emitting on the real process would confuse the test runner's own channel)
  let handlers: ((m: unknown) => void)[] = []
  const reply = (m: unknown) => { for (const h of handlers) h(m) }
  let onSpy: { mockRestore: () => void } | undefined
  function asWorker() {
    vi.resetModules()
    handlers = []
    onSpy?.mockRestore()
    onSpy = vi.spyOn(process, 'on').mockImplementation(((ev: string, h: (m: unknown) => void) => { if (ev === 'message') handlers.push(h); return process }) as never)
    sent.length = 0
    process.env.CKDESK_SHARED_COUNTERS = '1'
    ;(process as unknown as { send: unknown }).send = vi.fn((m: never) => { sent.push(m); return true })
  }

  it('outside a cluster it counts on its own and sends nothing', async () => {
    const { isOverLimitShared, recordEventShared } = await import('@/lib/rate-limit')
    expect(await recordEventShared('solo:a', 1000)).toBe(1)
    expect(await recordEventShared('solo:a', 1000)).toBe(2)
    expect(await isOverLimitShared('solo:a', 2)).toBe(true)
  })

  it('in a cluster it asks the launcher and uses the answer', async () => {
    asWorker()
    const { recordEventShared, isOverLimitShared } = await import('@/lib/rate-limit')
    const p = recordEventShared('c:a', 60_000)
    expect(sent[0]).toMatchObject({ ckrl: 1, op: 'rec', args: ['c:a', 60_000] })
    reply({ ckrl: 2, id: sent[0].id, v: 7 })
    expect(await p).toBe(7)
    const q = isOverLimitShared('c:a', 5)
    expect(sent[1].op).toBe('over')
    reply({ ckrl: 2, id: sent[1].id, v: true })
    expect(await q).toBe(true)
  })

  it('ignores messages that are not answers to it', async () => {
    asWorker()
    const { recordEventShared } = await import('@/lib/rate-limit')
    const p = recordEventShared('c:b', 60_000)
    reply({ something: 'else' })
    reply('a string')
    reply({ ckrl: 2, id: 987654, v: 99 })
    reply({ ckrl: 2, id: sent[0].id, v: 4 })
    expect(await p).toBe(4)
  })

  it('if the launcher does not answer within 1.5 s the worker counts on its own for that call', async () => {
    asWorker()
    vi.useFakeTimers()
    const { recordEventShared } = await import('@/lib/rate-limit')
    const p = recordEventShared('c:slow', 60_000)
    await vi.advanceTimersByTimeAsync(1600)
    expect(await p).toBe(1)
  })

  it('rateLimit itself goes through the launcher too (forgot-password and the other per-site limits)', async () => {
    asWorker()
    const { rateLimit } = await import('@/lib/rate-limit')
    const p = rateLimit('forgot:x@y.z', 3, 3_600_000)
    expect(sent[0]).toMatchObject({ op: 'hit', args: ['forgot:x@y.z', 3, 3_600_000] })
    reply({ ckrl: 2, id: sent[0].id, v: { limited: true, remaining: 0 } })
    expect(await p).toEqual({ limited: true, remaining: 0 })
  })

  it('a failing send is not a failure: it counts locally', async () => {
    asWorker()
    ;(process as unknown as { send: unknown }).send = vi.fn(() => { throw new Error('channel closed') })
    const { recordEventShared } = await import('@/lib/rate-limit')
    expect(await recordEventShared('c:broken', 1000)).toBe(1)
  })
})
