'use strict'
// Starts the Citykart Desk web app (the Next.js "standalone" server.js) as SEVERAL worker processes behind the same port, so that a server with many CPUs uses them.
// One Node process runs on ONE CPU core; with 10 cores free, 9 of them did nothing. This file is the whole mechanism: it lives next to server.js in the app folder
// (scripts/windows/build-for-deploy.ps1 puts it there) and is started instead of server.js:   node cluster-server.cjs
//
// How many workers:  CKDESK_WORKERS=4 (a service environment variable, or a line CKDESK_WORKERS=4 in the app's .env.local, which a release keeps).
//   Not set, 0 or 1  ->  exactly the old behaviour: this file just loads server.js in this one process, nothing else changes.
//   2..8             ->  this process becomes the launcher and starts that many workers; every worker is a normal copy of the app.
//
// What the launcher does, and nothing more:
//  * hands each new connection to a worker in turn (round-robin, so the work spreads evenly);
//  * starts a worker again if one dies, and gives up (exit code 1, so the Windows service manager restarts everything) if workers keep dying: 8 deaths inside 60 s;
//  * stops all workers when it is stopped, and workers stop by themselves if the launcher disappears (no leftover processes holding the port);
//  * keeps the sign-in and other rate-limit counters ONCE for the whole site (lib/rate-limit.ts asks for them over the process channel), so that
//    "10 wrong passwords, then wait" does not become 10 per worker.
// It never touches requests, cookies, the database or any file other than reading .env.local for the one setting above.

const path = require('node:path')
const fs = require('node:fs')

const MAX_WORKERS = 8
const GIVE_UP_AFTER_EXITS = 8
const GIVE_UP_WINDOW_MS = 60_000

/** The value of NAME in a KEY=value file (comments and blanks ignored), or undefined. */
function readEnvFileValue(file, name) {
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const i = line.indexOf('=')
      if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* no file: the setting is simply not there */ }
  return undefined
}

/** How many workers to run: 1 (= just run server.js) unless a number from 2 to 8 is configured. Anything unreadable means 1, never a failure. */
function workerCount(env, envFile) {
  const raw = env.CKDESK_WORKERS !== undefined ? env.CKDESK_WORKERS : readEnvFileValue(envFile, 'CKDESK_WORKERS')
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isInteger(n) || n < 2) return 1
  return Math.min(n, MAX_WORKERS)
}

/** Decides when workers keep dying so fast that restarting them again is pointless. */
function createRestartGuard(now = () => Date.now()) {
  const exits = []
  return {
    /** Record one unexpected exit; returns { giveUp, delayMs } - how long to wait before starting its replacement. */
    onExit() {
      const t = now()
      exits.push(t)
      while (exits.length && t - exits[0] > GIVE_UP_WINDOW_MS) exits.shift()
      return { giveUp: exits.length >= GIVE_UP_AFTER_EXITS, delayMs: Math.min(500 * exits.length, 5000) }
    },
  }
}

function runLauncher(count) {
  const cluster = require('node:cluster')
  const { createCounters, runShared } = require('./rate-limit-counters.cjs')
  const counters = createCounters()
  const guard = createRestartGuard()
  let stopping = false
  let sharedCalls = 0, lastLogged = 0
  const log = (msg) => console.log(`[cluster] ${new Date().toISOString()} ${msg}`)

  // round-robin even on Windows (where Node would otherwise leave the choice to the operating system, which tends to favour one worker)
  cluster.schedulingPolicy = cluster.SCHED_RR

  function start(slot) {
    const w = cluster.fork({ CKDESK_SHARED_COUNTERS: '1', CKDESK_WORKER_SLOT: String(slot) })
    w.slot = slot
    return w
  }

  cluster.on('message', (worker, msg) => {
    if (!msg || msg.ckrl !== 1 || typeof msg.id !== 'number') return
    sharedCalls++
    let v
    try { v = runShared(counters, String(msg.op), Array.isArray(msg.args) ? msg.args : []) } catch { return }   // a bad request gets no answer; the worker then counts for itself
    try { worker.send({ ckrl: 2, id: msg.id, v }) } catch { /* the worker has just gone */ }
  })

  cluster.on('online', (w) => log(`worker ${w.slot} (process ${w.process.pid}) is up`))
  cluster.on('exit', (w, code, signal) => {
    if (stopping) return
    const { giveUp, delayMs } = guard.onExit()
    log(`worker ${w.slot} (process ${w.process.pid}) stopped (code ${code}, signal ${signal || 'none'})`)
    if (giveUp) {
      log(`${GIVE_UP_AFTER_EXITS} workers stopped within ${GIVE_UP_WINDOW_MS / 1000} s - giving up so the service manager restarts everything`)
      shutdown(1)
      return
    }
    setTimeout(() => { if (!stopping) start(w.slot) }, delayMs)
  })

  function shutdown(exitCode) {
    if (stopping) return
    stopping = true
    for (const w of Object.values(cluster.workers || {})) { try { w.process.kill() } catch { /* already gone */ } }
    setTimeout(() => process.exit(exitCode), 3000).unref()
    const alive = () => Object.values(cluster.workers || {}).filter((w) => !w.isDead()).length
    const poll = setInterval(() => { if (alive() === 0) { clearInterval(poll); process.exit(exitCode) } }, 100)
    poll.unref()
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) { try { process.on(sig, () => { log(`${sig}: stopping all workers`); shutdown(0) }) } catch { /* signal not supported here */ } }

  // a line in the service log every 10 minutes (only when something was counted): proves the workers really use the shared counters
  const everyMs = Math.max(1, Number(process.env.CKDESK_CLUSTER_LOG_SECONDS) || 600) * 1000
  setInterval(() => {
    if (sharedCalls === lastLogged) return
    const n = counters.size()
    log(`shared counters: ${sharedCalls - lastLogged} calls in the last period, ${n.keys} keys, ${n.progressive} wait entries, ${Object.keys(cluster.workers || {}).length} workers`)
    lastLogged = sharedCalls
  }, everyMs).unref()

  log(`starting ${count} workers`)
  for (let i = 1; i <= count; i++) start(i)
}

function main() {
  const count = workerCount(process.env, path.join(__dirname, '.env.local'))
  const cluster = require('node:cluster')
  if (count < 2) { require('./server.js'); return }                      // the old behaviour, exactly
  if (cluster.isPrimary) { runLauncher(count); return }
  // a worker: stop if the launcher goes away, so a hard kill of the launcher can never leave processes holding the port
  process.on('disconnect', () => process.exit(0))
  require('./server.js')
}

if (require.main === module) main()

module.exports = { workerCount, createRestartGuard, readEnvFileValue, MAX_WORKERS, GIVE_UP_AFTER_EXITS, GIVE_UP_WINDOW_MS }
