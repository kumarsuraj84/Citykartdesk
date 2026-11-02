import type { NextRequest } from 'next/server'
import { secureCompare } from '@/lib/secure-compare'
import { isOverLimit, recordEvent } from '@/lib/rate-limit'
import { getSecret } from '@/lib/secrets'

/**
 * The token check of the read-only data API (/api/data/v1/*), used by the data platform (DBA) that pulls CKDesk data into its own database.
 *  - the token is DATA_API_TOKEN (its own secret, never another purpose's); a missing or short one (under 32 characters) switches the API OFF (answer 503), it never opens it;
 *  - only `Authorization: Bearer <token>` is accepted, compared in constant time;
 *  - the app runs on plain HTTP and port 3210 is also forwarded from the internet, so two extra protections:
 *      1. DATA_API_ALLOWED_HOSTS (optional, e.g. "10.0.1.98:3210"): when set, a request whose Host header is not in the list is answered "not found" before anything else, so the
 *         internet side of the router (Host = the public address) never even reaches the token check. This is a first screen, not a lock: a Host header can be written by anybody;
 *      2. wrong tokens are counted per caller and, after FAILED_LIMIT in a minute, further WRONG tokens are refused without being compared. A request with the RIGHT token is never
 *         refused because of other people's wrong guesses, so a flood of bad requests cannot lock the data platform out.
 */
export const MIN_DATA_API_TOKEN = 32
const FAILED_LIMIT = 20
const WINDOW_MS = 60_000

function callerKey(req: NextRequest): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)
  if (!Number.isInteger(hops) || hops < 1) return 'data-api-fail|any'
  const parts = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return `data-api-fail|${parts.length >= hops ? parts[parts.length - hops] : 'any'}`
}

/** True when no host list is configured, or the request's Host header is on it. */
export function hostAllowed(req: NextRequest, env: Record<string, string | undefined> = process.env): boolean {
  const list = (env.DATA_API_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  if (list.length === 0) return true
  const host = (req.headers.get('host') ?? '').trim().toLowerCase()
  return host !== '' && list.includes(host)
}

/** 'off' = no usable token configured, 'hidden' = not asked on an allowed host, 'denied' = wrong / missing token, 'ok'. */
export function verifyDataApiToken(req: NextRequest): 'off' | 'hidden' | 'denied' | 'ok' {
  const token = getSecret('data_api')
  if (!token || token.length < MIN_DATA_API_TOKEN) return 'off'
  if (!hostAllowed(req)) return 'hidden'
  const header = req.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (provided !== '' && secureCompare(provided, token)) return 'ok'
  const key = callerKey(req)
  if (isOverLimit(key, FAILED_LIMIT)) return 'denied'
  recordEvent(key, WINDOW_MS)
  return 'denied'
}
