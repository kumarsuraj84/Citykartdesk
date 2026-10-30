// scripts/cron-tick.mjs end to end against a fake app (G-01, G-02, G-13): a job whose HTTP answer is 200 but whose JSON says the work failed is a FAILURE; a failure is
// reported to the System Log with the cron secret and the runner says so when that report is refused; a hung job is cut off by the timeout.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { spawn } from 'node:child_process'
import type { AddressInfo } from 'node:net'

const SECRET = 'cron-test-secret-0123456789'
type Plan = { status?: number; body?: string; delayMs?: number; redirectTo?: string }
let plan: Plan = {}
let refuseIngest = false
const ingested: { secret: string | undefined; entries: { source: string; message: string; action: string }[] }[] = []
let server: http.Server
let url: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.url === '/api/system-log/ingest') {
        ingested.push({ secret: req.headers['x-cron-secret'] as string | undefined, entries: JSON.parse(body).entries })
        res.statusCode = refuseIngest ? 401 : 200
        res.setHeader('content-type', 'application/json'); res.end(refuseIngest ? '{"error":"Unauthorized"}' : '{"ok":true}')
        return
      }
      if (req.url === '/login') { res.statusCode = 200; res.setHeader('content-type', 'text/html'); res.end('<html>login</html>'); return }
      const send = () => {
        if (plan.redirectTo) { res.statusCode = 307; res.setHeader('location', plan.redirectTo); res.end(); return }
        res.statusCode = plan.status ?? 200
        res.setHeader('content-type', 'application/json')
        res.end(plan.body ?? '{"ok":true}')
      }
      if (plan.delayMs) setTimeout(send, plan.delayMs); else send()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close() })
beforeEach(() => { plan = {}; refuseIngest = false; ingested.length = 0 })

const run = (job: string, extra: Record<string, string> = {}) => new Promise<{ status: number | null; out: string }>((resolve) => {
  const child = spawn(process.execPath, ['scripts/cron-tick.mjs'], { env: { ...process.env, CRON_SECRET: SECRET, CRON_TARGET_URL: url, CRON_JOBS: job, ...extra } })
  let out = ''
  child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c))
  const t = setTimeout(() => child.kill(), 30_000)
  child.on('close', (status) => { clearTimeout(t); resolve({ status, out }) })
})

describe('what counts as a failed cron job', () => {
  it('a clean 200 answer is a success and reports nothing', async () => {
    plan = { body: '{"ok":true,"processed":3,"failed":0,"failures":[]}' }
    const r = await run('alerts')
    expect(r.status).toBe(0)
    expect(ingested).toEqual([])
  })
  it('a 200 answer with ok:false is a failure and is reported with the cron secret as a cron entry', async () => {
    plan = { body: '{"ok":false,"error":"archive failed"}' }
    const r = await run('csat')
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/csat.*work failed/)
    expect(ingested).toHaveLength(1)
    expect(ingested[0].secret).toBe(SECRET)
    expect(ingested[0].entries[0]).toMatchObject({ source: 'cron', action: 'cron.job_failed' })
    expect(ingested[0].entries[0].message).toContain('csat')
  })
  it('a per-organization { error } entry makes masters-sync a failure; a skipped or empty one does not', async () => {
    plan = { body: '{"orgs":{"org-1":{"error":"failed"}}}' }
    expect((await run('masters-sync')).status).toBe(1)
    plan = { body: '{"orgs":{"org-1":{"skipped":"Google Sheets is not connected"}}}' }
    expect((await run('pms-daily')).status).toBe(0)
    plan = { body: '{"orgs":{}}' }
    expect((await run('pms-daily')).status).toBe(0)
  })
  it('an error key at the top (desktime / email sync) is a failure; a list called failures is not looked into', async () => {
    plan = { body: '{"synced":1,"results":{"org-1":{"error":"sync failed"}}}' }
    expect((await run('desktime-sync')).status).toBe(1)
    plan = { body: '{"ok":true,"failures":[{"error":"one rule"}],"failed":1}' }
    expect((await run('alerts')).status).toBe(0)      // a partial failure inside a list stays a success (the route's own contract)
  })
  it('a non-JSON 2xx answer is accepted; a non-2xx answer is a failure', async () => {
    plan = { body: 'done' }
    expect((await run('alerts')).status).toBe(0)
    plan = { status: 502, body: '{"error":"bad gateway"}' }
    const r = await run('alerts')
    expect(r.status).toBe(1)
    expect(ingested[0].entries[0].message).toContain('HTTP 502')
  })
  it('a redirect to the login page (route missing from the proxy public list) is a failure', async () => {
    plan = { redirectTo: '/login' }
    const r = await run('alerts')
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/redirected/)
  })
  it('a refused failure report is printed, not swallowed (G-01)', async () => {
    plan = { status: 500, body: 'x' }
    refuseIngest = true
    const r = await run('alerts')
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/could not record the failure of alerts.*401/)
  })
  it('a job that does not answer in time is cut off and reported as a timeout (G-13)', async () => {
    plan = { delayMs: 3000 }
    const r = await run('alerts', { CRON_TIMEOUT_MS: '300' })
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/timed out/)
    expect(ingested[0]?.entries[0].message).toMatch(/timed out/)
  })
})
