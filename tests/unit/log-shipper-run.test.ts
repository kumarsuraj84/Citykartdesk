// The log shipper script end to end: against a fake ingest endpoint and real files. Starts at the end of a log, ships only new problems,
// never ships the same line twice, keeps its place while the app is down, survives rotation, and refuses to run without a secret.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

const SECRET = 'shipper-test-secret-0123456789'
const received: { secret: string | undefined; entries: { source: string; message: string; detail?: { repeats?: number } }[] }[] = []
let failNext = 0
let server: http.Server
let url: string
let dir: string
let log: string
let cursor: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (failNext > 0) { failNext--; res.statusCode = 503; res.end('down'); return }
      received.push({ secret: req.headers['x-system-log-secret'] as string | undefined, entries: JSON.parse(body).entries })
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close() })
beforeEach(() => {
  received.length = 0; failNext = 0
  dir = mkdtempSync(join(tmpdir(), 'shipper-'))
  log = join(dir, 'postgrest.err.log'); cursor = join(dir, 'cursor.json')
})

// asynchronous on purpose: the fake ingest server lives in this process and must be able to answer while the script runs
const exec = (args: string[], env: Record<string, string>) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(process.execPath, ['scripts/log-shipper.mjs', ...args], { env: { ...process.env, ...env } })
  let stdout = '', stderr = ''
  child.stdout.on('data', (c) => (stdout += c)); child.stderr.on('data', (c) => (stderr += c))
  const t = setTimeout(() => child.kill(), 30_000)
  child.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }) })
})
const run = (extra: string[] = [], env: Record<string, string> = {}) =>
  exec(['--once', '--file', `postgrest=${log}`, '--cursor', cursor, ...extra], { SYSTEM_LOG_TARGET_URL: url, SYSTEM_LOG_INGEST_SECRET: SECRET, ...env })

const bad = (n: number) => `14/Oct/2026:01:26:0${n} +0000: Could not connect to the database: connection refused (${n})\n`
const noise = '14/Oct/2026:01:26:00 +0000: Config reloaded\n'

describe('log shipper', () => {
  it('starts at the end of an existing log, then ships only what is added, once', async () => {
    writeFileSync(log, bad(1) + noise)
    expect((await run()).status).toBe(0)
    expect(received).toHaveLength(0)                                        // the history is not shipped
    appendFileSync(log, noise + bad(2) + bad(3))
    expect((await run()).status).toBe(0)
    expect(received).toHaveLength(1)
    expect(received[0].secret).toBe(SECRET)
    expect(received[0].entries.map((e) => e.source)).toEqual(['database'])  // two similar problems, collapsed into one entry
    expect(received[0].entries[0].detail?.repeats).toBe(2)
    expect((await run()).status).toBe(0)
    expect(received).toHaveLength(1)                                        // nothing new, nothing sent
  })
  it('--from-start ships the whole file on the first run', async () => {
    writeFileSync(log, bad(1) + noise)
    expect((await run(['--from-start'])).status).toBe(0)
    expect(received).toHaveLength(1)
  })
  it('keeps its place while the app is down and delivers when it is back', async () => {
    writeFileSync(log, noise)
    await run()
    appendFileSync(log, bad(4))
    failNext = 1
    expect((await run()).status).toBe(1)
    expect(received).toHaveLength(0)
    expect((await run()).status).toBe(0)
    expect(received).toHaveLength(1)
    expect(received[0].entries[0].message).toContain('(4)')
  })
  it('waits for a half-written line', async () => {
    writeFileSync(log, noise)
    await run()
    appendFileSync(log, '14/Oct/2026:01:26:05 +0000: Could not conn')
    await run()
    expect(received).toHaveLength(0)
    appendFileSync(log, 'ect: connection refused\n')
    await run()
    expect(received).toHaveLength(1)
    expect(received[0].entries[0].message).toContain('connection refused')
  })
  it('reads from the beginning again after the file is rotated (becomes smaller)', async () => {
    writeFileSync(log, noise + noise + noise)
    await run()
    writeFileSync(log, bad(6))
    await run()
    expect(received).toHaveLength(1)
  })
  it('--dry-run prints entries, sends nothing and keeps no cursor', async () => {
    writeFileSync(log, bad(7))
    const r = await run(['--dry-run', '--from-start'], { SYSTEM_LOG_INGEST_SECRET: '' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('"action":"postgrest.log"')
    expect(received).toHaveLength(0)
    expect(existsSync(cursor)).toBe(false)
  })
  it('refuses to run without a proper secret, and does not echo it', async () => {
    writeFileSync(log, noise)
    const r = await run([], { SYSTEM_LOG_INGEST_SECRET: 'tiny-secret' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/SYSTEM_LOG_INGEST_SECRET/)
    expect(r.stderr + r.stdout).not.toContain('tiny-secret')
    expect(existsSync(cursor)).toBe(false)
  })
  it('the cursor file never holds the secret', async () => {
    writeFileSync(log, noise); await run()
    expect(readFileSync(cursor, 'utf8')).not.toContain(SECRET)
  })
  it('rejects bad options', async () => {
    const r = await exec(['--file', 'nginx=/x'], {})
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/kind/)
  })
})
