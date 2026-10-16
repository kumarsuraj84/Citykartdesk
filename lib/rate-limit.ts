import { headers } from 'next/headers'

type Entry = { count: number; resetAt: number }
const store = new Map<string, Entry>()

const MAX_KEYS = 50_000
let lastCleanup = 0
function cleanup() {
  const now = Date.now()
  // at most once a second (it used to scan the whole table on every call), and the table can never grow without limit
  if (now - lastCleanup < 1000 && store.size <= MAX_KEYS) return
  lastCleanup = now
  for (const [k, v] of store) if (v.resetAt < now) store.delete(k)
  for (const k of store.keys()) { if (store.size <= MAX_KEYS) break; store.delete(k) }
}

/**
 * Simple in-process rate limiter.
 * In production with multiple replicas, replace with Upstash Redis.
 * @param key    Scope key (e.g. ip:email)
 * @param limit  Max requests per window
 * @param windowMs Window in milliseconds
 */
export async function rateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000
): Promise<{ limited: boolean; remaining: number }> {
  cleanup()
  key = key.length > 200 ? key.slice(0, 200) : key   // VAPT VA-API-03
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { limited: false, remaining: limit - 1 }
  }

  entry.count++
  if (entry.count > limit) return { limited: true, remaining: 0 }
  return { limited: false, remaining: limit - entry.count }
}

/** Is this key already over its limit? Does not count the call (used to look before a sign-in attempt; only FAILED attempts are then counted with recordEvent). */
export function isOverLimit(key: string, limit: number): boolean {
  key = key.length > 200 ? key.slice(0, 200) : key
  const entry = store.get(key)
  return !!entry && entry.resetAt >= Date.now() && entry.count >= limit
}

/** Count one event on a key (a failed sign-in) and return how many there have been in the window. */
export function recordEvent(key: string, windowMs: number): number {
  cleanup()
  key = key.length > 200 ? key.slice(0, 200) : key
  const now = Date.now()
  const entry = store.get(key)
  if (!entry || entry.resetAt < now) { store.set(key, { count: 1, resetAt: now + windowMs }); return 1 }
  entry.count++
  return entry.count
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
