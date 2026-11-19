import { headers } from 'next/headers'
import { createCounters, type ProgressiveOptions } from './rate-limit-counters.cjs'

// The counting itself lives in rate-limit-counters.cjs (also used by the cluster launcher). Each app process counts for itself: with ONE process that is the whole site.
// When the app runs as several worker processes (deploy/windows/cluster/cluster-server.cjs sets CKDESK_SHARED_COUNTERS=1), the counters that protect sign-in and the
// other limits are kept ONCE, in the launcher, and every worker asks it over the process channel, so a limit still means "per site" and not "per worker".
// If the launcher does not answer within 1.5 s, the worker counts on its own for that one call (never a failure for the person).
const local = createCounters()

type Pending = { done: (v: unknown) => void }
const pending = new Map<number, Pending>()
let nextId = 1
let listening = false
const SHARED_TIMEOUT_MS = 1500

function sharedOn(): boolean {
  return process.env.CKDESK_SHARED_COUNTERS === '1' && typeof process.send === 'function'
}

function ask<T>(op: string, args: unknown[], fallback: () => T): Promise<T> {
  if (!sharedOn()) return Promise.resolve(fallback())
  if (!listening) {
    listening = true
    process.on('message', (m: unknown) => {
      const msg = m as { ckrl?: number; id?: number; v?: unknown } | null
      if (!msg || msg.ckrl !== 2 || typeof msg.id !== 'number') return
      const p = pending.get(msg.id)
      if (p) { pending.delete(msg.id); p.done(msg.v) }
    })
  }
  return new Promise<T>((resolve) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); resolve(fallback()) }, SHARED_TIMEOUT_MS)
    pending.set(id, { done: (v) => { clearTimeout(timer); resolve(v as T) } })
    try { process.send!({ ckrl: 1, id, op, args }) } catch { clearTimeout(timer); pending.delete(id); resolve(fallback()) }
  })
}

/**
 * In-process rate limiter (shared across the worker processes when the app runs as a cluster, see above).
 * @param key    Scope key (e.g. ip:email)
 * @param limit  Max requests per window
 * @param windowMs Window in milliseconds
 */
export async function rateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000
): Promise<{ limited: boolean; remaining: number }> {
  return ask('hit', [key, limit, windowMs], () => local.hit(key, limit, windowMs))
}

/** Is this key already over its limit? Does not count the call (used to look before a sign-in attempt; only FAILED attempts are then counted with recordEvent). This process only; see isOverLimitShared. */
export function isOverLimit(key: string, limit: number): boolean {
  return local.over(key, limit)
}

/** Count one event on a key (a failed sign-in) and return how many there have been in the window. This process only; see recordEventShared. */
export function recordEvent(key: string, windowMs: number): number {
  return local.rec(key, windowMs)
}

/**
 * The caller's address, or null when it cannot be known reliably (audit D-017).
 * A client can send any X-Forwarded-For / X-Real-IP it likes, so those are only believed when the number of reverse proxies in front of the
 * app is configured (TRUSTED_PROXY_HOPS=1 for one proxy): the address is then the entry that the proxy nearest to the app appended, which
 * the client cannot choose. With nothing configured no per-address limit is applied; limits then rest on the account being attacked.
 */
export async function getClientIp(): Promise<string | null> {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)
  if (!Number.isInteger(hops) || hops < 1) return null
  const parts = ((await headers()).get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length >= hops ? parts[parts.length - hops] : null
}

// ── Progressive delay per account (audit A-04 / G-09) ──────────────────────────────────────────────────────────────────────────────────
// Without a trusted client address (TRUSTED_PROXY_HOPS not set) the only thing a sign-in limit can follow is the account being tried. A hard 10-minute lock
// after 10 wrong tries then lets ANY stranger who knows a login name lock that person (a store login, an administrator) out for 10 minutes, again and again.
// Instead each further wrong try doubles a short wait (30 s, 1 min, 2 min, 4 min, then at most 5 min), and the wait ends by itself; nothing stays locked.
// The first `free` - 1 wrong tries cost nothing (the 10th starts the first wait, the same allowance as before). Whether the account exists is never part of the answer: the key is simply whatever was typed.

/** Milliseconds still to wait before this key may try again (0 = free to try). Does not count anything. This process only; see progressiveWaitMsShared. */
export function progressiveWaitMs(key: string, now = Date.now()): number {
  return local.pwait(key, now)
}

/** Count one failure; once `free` failures have happened a wait starts and every further failure doubles it (baseMs, 2x, 4x ... up to maxMs). Returns the wait that now applies. This process only. */
export function recordProgressiveFailure(key: string, opts: ProgressiveOptions = {}, now = Date.now()): number {
  return local.pfail(key, opts, now)
}

/** A correct sign-in ends the count. This process only. */
export function clearProgressive(key: string): void {
  local.pclear(key)
}

// ── The same, counted once for the whole site (use these for sign-in) ───────────────────────────────────────────────────────────────────
export const isOverLimitShared = (key: string, limit: number): Promise<boolean> => ask('over', [key, limit], () => local.over(key, limit))
export const recordEventShared = (key: string, windowMs: number): Promise<number> => ask('rec', [key, windowMs], () => local.rec(key, windowMs))
export const progressiveWaitMsShared = (key: string): Promise<number> => ask('pwait', [key], () => local.pwait(key))
export const recordProgressiveFailureShared = (key: string, opts: ProgressiveOptions = {}): Promise<number> => ask('pfail', [key, opts], () => local.pfail(key, opts))
export const clearProgressiveShared = (key: string): Promise<void> => ask<null>('pclear', [key], () => { local.pclear(key); return null }).then(() => undefined)
