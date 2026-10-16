#!/usr/bin/env node
/**
 * System Log shipper — copies the PROBLEM lines of PostgREST, Supabase Auth, Supabase Storage and PostgreSQL into the Citykart Desk
 * System Log, so database, storage and sign-in service faults show up on the same screen as application errors.
 *
 * No dependencies (Node 18+). Reads either log FILES (production: the NSSM service logs) or DOCKER container logs (the local audit stack),
 * keeps a cursor file so nothing is shipped twice, and posts batches to POST /api/system-log/ingest with a shared secret.
 * It only ever reads logs and only ever adds error rows; if the app is unreachable it keeps its place and tries again.
 *
 * Environment:
 *   SYSTEM_LOG_TARGET_URL      base URL of the app (falls back to CRON_TARGET_URL)
 *   SYSTEM_LOG_INGEST_SECRET   shared secret, at least 16 characters (falls back to CRON_SECRET) — never put it on the command line
 *
 * Options (repeat --file / --docker for several sources; kind is one of postgrest, auth, storage, postgres, backup):
 *   --file   <kind>=<path>         e.g. --file postgrest=C:\CitykartDesk\logs\CkDeskPostgrest.err.log
 *   --docker <kind>=<container>    e.g. --docker postgres=supabase_db_ckdesk_audit
 *   --audit-stack                  shorthand for the four containers of the local audit stack
 *   --interval <seconds>           poll every N seconds (default 15)
 *   --once                         one pass, then exit (0 = all shipped, 1 = something failed)
 *   --dry-run                      print what would be sent; send nothing, keep no cursor
 *   --from-start                   on the very first run read files from their beginning (default: start at the end)
 *   --cursor <path>                where the cursor is kept (default ./.system-log-shipper-cursor.json)
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createParser, collapseEntries, PARSER_KINDS } from './lib/log-parsers.mjs'

const MAX_READ = 2 * 1024 * 1024
const BATCH = 100

// ── command line ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { files: [], dockers: [], interval: 15, once: false, dryRun: false, fromStart: false, cursor: '.system-log-shipper-cursor.json' }
  const spec = (v, flag) => {
    const i = (v ?? '').indexOf('=')
    const kind = i > 0 ? v.slice(0, i) : ''
    if (!PARSER_KINDS.includes(kind) || i === v.length - 1) throw new Error(`${flag} needs <kind>=<value> with kind one of ${PARSER_KINDS.join(', ')}`)
    return { kind, target: v.slice(i + 1) }
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--file') o.files.push(spec(argv[++i], a))
    else if (a === '--docker') o.dockers.push(spec(argv[++i], a))
    else if (a === '--audit-stack') {
      o.dockers.push({ kind: 'postgrest', target: 'supabase_rest_ckdesk_audit' }, { kind: 'auth', target: 'supabase_auth_ckdesk_audit' },
        { kind: 'storage', target: 'supabase_storage_ckdesk_audit' }, { kind: 'postgres', target: 'supabase_db_ckdesk_audit' })
    }
    else if (a === '--interval') o.interval = Math.max(2, Number(argv[++i]) || 15)
    else if (a === '--once') o.once = true
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--from-start') o.fromStart = true
    else if (a === '--cursor') o.cursor = argv[++i]
    else throw new Error(`Unknown option ${a}`)
  }
  if (o.files.length + o.dockers.length === 0) throw new Error('Nothing to read: give at least one --file, --docker or --audit-stack')
  return o
}

// ── cursor ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function loadCursor(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {} } catch { return {} }
}
function saveCursor(path, cursor) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(cursor, null, 2))
  renameSync(tmp, path)
}

// ── readers: each returns { lines, next } where `next` is the cursor value to keep once the lines have been delivered ─────────────
async function readFileLines(path, cursor, fromStart) {
  const info = await stat(path)
  let offset = cursor?.offset
  if (offset === undefined) offset = fromStart ? 0 : info.size            // first run: only what happens from now on
  if (info.size < offset) offset = 0                                        // truncated or rotated
  if (info.size === offset) return { lines: [], next: { offset } }
  const length = Math.min(info.size - offset, MAX_READ)
  const buf = Buffer.alloc(length)
  const fh = await open(path, 'r')
  try { await fh.read(buf, 0, length, offset) } finally { await fh.close() }
  const end = buf.lastIndexOf(0x0a)
  if (end < 0) return { lines: [], next: { offset: length >= MAX_READ ? offset + length : offset } }   // a partial line: wait for the rest (unless absurdly long)
  const text = buf.subarray(0, end + 1).toString('utf8').replace(/^\uFEFF/, '')
  return { lines: text.slice(0, -1).split('\n').map((l) => l.replace(/\r$/, '')), next: { offset: offset + end + 1 } }
}

const TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z /
const tsKey = (m) => BigInt(Math.floor(Date.parse(`${m[1]}Z`) / 1000)) * 1_000_000_000n + BigInt((m[2] ?? '').padEnd(9, '0').slice(0, 9))

function dockerLogs(container, sinceIso) {
  return new Promise((resolve, reject) => {
    execFile('docker', ['logs', '--timestamps', '--since', sinceIso, container], { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return reject(err)
      resolve(`${stdout}\n${stderr}`)
    })
  })
}

async function readDockerLines(container, cursor) {
  const last = cursor?.ts ? BigInt(cursor.ts) : BigInt(Date.now() - 5_000) * 1_000_000n   // first run: from now
  const sinceIso = new Date(Number(last / 1_000_000_000n) * 1000).toISOString()
  const raw = await dockerLogs(container, sinceIso)
  const rows = []
  for (const line of raw.split('\n')) {
    const m = TS.exec(line)
    if (!m) continue
    const key = tsKey(m)
    if (key <= last) continue
    rows.push({ key, text: line.slice(m[0].length) })
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))   // stdout and stderr arrive separately
  return { lines: rows.map((r) => r.text), next: { ts: String((rows.length ? rows[rows.length - 1].key : last)) } }
}

// ── delivery ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function post(url, secret, entries) {
  const res = await fetch(`${url}/api/system-log/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-system-log-secret': secret },
    body: JSON.stringify({ entries }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`ingest answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function pass(opts, target, secret) {
  const cursor = loadCursor(opts.cursor)
  const sources = [...opts.files.map((s) => ({ ...s, type: 'file' })), ...opts.dockers.map((s) => ({ ...s, type: 'docker' }))]
  let failures = 0
  let shipped = 0
  for (const s of sources) {
    const key = `${s.type}:${s.kind}=${s.target}`
    try {
      const { lines, next } = s.type === 'file' ? await readFileLines(s.target, cursor[key], opts.fromStart) : await readDockerLines(s.target, cursor[key])
      const parser = createParser(s.kind)
      const entries = []
      for (const l of lines) entries.push(...parser.push(l))
      entries.push(...parser.flush())
      const batch = collapseEntries(entries)
      if (opts.dryRun) {
        for (const e of batch) console.log(JSON.stringify(e))
        console.log(`[dry-run] ${key}: ${lines.length} lines, ${batch.length} problems`)
        continue
      }
      for (let i = 0; i < batch.length; i += BATCH) await post(target, secret, batch.slice(i, i + BATCH))
      cursor[key] = next                      // only after everything from this source was delivered
      saveCursor(opts.cursor, cursor)
      shipped += batch.length
      if (batch.length) console.log(`${new Date().toISOString()} ${key}: shipped ${batch.length} problem(s) from ${lines.length} line(s)`)
    } catch (e) {
      failures++
      console.error(`${new Date().toISOString()} ${key}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return { failures, shipped }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const target = (process.env.SYSTEM_LOG_TARGET_URL ?? process.env.CRON_TARGET_URL ?? '').replace(/\/$/, '')
  const secret = process.env.SYSTEM_LOG_INGEST_SECRET ?? (process.env.ALLOW_SHARED_SECRET_FALLBACK === '1' ? process.env.CRON_SECRET : '') ?? ''
  if (!opts.dryRun && (!target || secret.length < 16)) throw new Error('Set SYSTEM_LOG_TARGET_URL and SYSTEM_LOG_INGEST_SECRET (16+ characters), or use --dry-run')
  if (opts.once || opts.dryRun) {
    const r = await pass(opts, target, secret)
    process.exit(r.failures ? 1 : 0)
  }
  console.log(`System Log shipper started: ${opts.files.length} file(s), ${opts.dockers.length} container(s), every ${opts.interval}s -> ${target}`)
  let stop = false
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop = true })
  let delay = opts.interval
  while (!stop) {
    const r = await pass(opts, target, secret)
    delay = r.failures ? Math.min(delay * 2, 300) : opts.interval      // back off while the app is unreachable
    for (let waited = 0; waited < delay && !stop; waited++) await new Promise((res) => setTimeout(res, 1000))
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2) })
