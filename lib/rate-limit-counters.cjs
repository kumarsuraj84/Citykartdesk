'use strict'
// The counting behind lib/rate-limit.ts, as plain CommonJS so that TWO places can run exactly the same code:
//  * every app process uses it for its own counters (one process = the whole site, as before), and
//  * the cluster launcher (deploy/windows/cluster/cluster-server.cjs) keeps ONE shared set when the app runs as several worker processes,
//    so that "10 wrong passwords, then wait" still means 10 for the whole site and not 10 per worker.
// Nothing here knows about Next.js, the database or the network.

const MAX_KEYS = 50_000
const PROGRESSIVE_FORGET_MS = 30 * 60_000          // a quiet half hour clears the wrong-password count

const cut = (key) => (key.length > 200 ? key.slice(0, 200) : key)    // VAPT VA-API-03

function createCounters() {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const store = new Map()
  /** @type {Map<string, {fails: number, lastAt: number, until: number}>} */
  const progressive = new Map()
  let lastCleanup = 0

  function cleanup(now) {
    // at most once a second (it used to scan the whole table on every call), and the table can never grow without limit
    if (now - lastCleanup < 1000 && store.size <= MAX_KEYS) return
    lastCleanup = now
    for (const [k, v] of store) if (v.resetAt < now) store.delete(k)
    for (const k of store.keys()) { if (store.size <= MAX_KEYS) break; store.delete(k) }
  }

  function progressiveCleanup(now) {
    if (progressive.size <= MAX_KEYS) return
    for (const [k, v] of progressive) if (now - v.lastAt > PROGRESSIVE_FORGET_MS) progressive.delete(k)
    for (const k of progressive.keys()) { if (progressive.size <= MAX_KEYS) break; progressive.delete(k) }
  }

  return {
    /** Count one call on `key`; says whether it is now over `limit` inside the window. */
    hit(key, limit, windowMs, now = Date.now()) {
      cleanup(now)
      key = cut(key)
      const entry = store.get(key)
      if (!entry || entry.resetAt < now) {
        store.set(key, { count: 1, resetAt: now + windowMs })
        return { limited: false, remaining: limit - 1 }
      }
      entry.count++
      if (entry.count > limit) return { limited: true, remaining: 0 }
      return { limited: false, remaining: limit - entry.count }
    },
    /** Is this key already at or over its limit? Counts nothing. */
    over(key, limit, now = Date.now()) {
      const entry = store.get(cut(key))
      return !!entry && entry.resetAt >= now && entry.count >= limit
    },
    /** Count one event on a key (a failed sign-in) and return how many there have been in the window. */
    rec(key, windowMs, now = Date.now()) {
      cleanup(now)
      key = cut(key)
      const entry = store.get(key)
      if (!entry || entry.resetAt < now) { store.set(key, { count: 1, resetAt: now + windowMs }); return 1 }
      entry.count++
      return entry.count
    },
    /** Milliseconds still to wait before this key may try again (0 = free to try). Counts nothing. */
    pwait(key, now = Date.now()) {
      const e = progressive.get(cut(key))
      return e && e.until > now ? e.until - now : 0
    },
    /** Count one failure; once `free` failures have happened a wait starts and every further failure doubles it (baseMs, 2x, 4x ... up to maxMs). Returns the wait that now applies. */
    pfail(key, opts = {}, now = Date.now()) {
      key = cut(key)
      const { free = 10, baseMs = 30_000, maxMs = 300_000 } = opts
      progressiveCleanup(now)
      let e = progressive.get(key)
      if (!e || now - e.lastAt > PROGRESSIVE_FORGET_MS) e = { fails: 0, lastAt: now, until: 0 }
      e.fails++
      e.lastAt = now
      const over = e.fails - free + 1                       // the `free`-th failure already starts the first wait
      e.until = over > 0 ? now + Math.min(baseMs * 2 ** (over - 1), maxMs) : 0
      progressive.set(key, e)
      return e.until > now ? e.until - now : 0
    },
    /** A correct sign-in ends the count. */
    pclear(key) { progressive.delete(cut(key)) },
    /** For tests and the launcher's log line. */
    size() { return { keys: store.size, progressive: progressive.size } },
  }
}

/** The operations a worker may ask the shared set to do, by the short names used on the wire. Anything else is refused. */
function runShared(counters, op, args) {
  switch (op) {
    case 'hit': return counters.hit(String(args[0]), Number(args[1]), Number(args[2]))
    case 'over': return counters.over(String(args[0]), Number(args[1]))
    case 'rec': return counters.rec(String(args[0]), Number(args[1]))
    case 'pwait': return counters.pwait(String(args[0]))
    case 'pfail': return counters.pfail(String(args[0]), args[1] && typeof args[1] === 'object' ? args[1] : {})
    case 'pclear': counters.pclear(String(args[0])); return null
    default: throw new Error('unknown counter operation')
  }
}

module.exports = { createCounters, runShared }
