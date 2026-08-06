import { headers } from 'next/headers'

type Entry = { count: number; resetAt: number }
const store = new Map<string, Entry>()

function cleanup() {
  const now = Date.now()
  for (const [k, v] of store) if (v.resetAt < now) store.delete(k)
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

export async function getClientIp(): Promise<string> {
  const h = await headers()
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip') ??
    'unknown'
  )
}
