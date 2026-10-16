// The proxy (proxy.ts) verifies the session once per request and forwards who the user is to the page/route that handles the request.
// That forwarded value must never be something a client can forge:
//   - the proxy DELETES any client-supplied copy of these headers on every path it lets through, and
//   - the value it does set is SIGNED with a server-only key, so a copy that did not come from the proxy fails verification
//     (for example on a path the proxy matcher skips) and the app falls back to checking the session itself.
// Server only (uses node:crypto): imported by proxy.ts (Node runtime), lib/queries/profiles.ts and route handlers.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const VERIFIED_USER_HEADER = 'x-verified-user-id'
export const VERIFIED_USER_SIG_HEADER = 'x-verified-user-sig'

// The signing key is the server's own service key (never the cron secret, VAPT-030): without it nothing is signed and callers re-check the session.
function key(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

const mac = (k: string, userId: string) => createHmac('sha256', k).update(`verified-user:${userId}`).digest('hex')

/** Signature for a verified user id ('' = verified as signed out). Null when no server key is configured (then nothing is forwarded). */
export function signVerifiedUser(userId: string): string | null {
  const k = key()
  return k ? mac(k, userId) : null
}

/**
 * What the proxy vouched for on this request:
 *   string    - the verified user id
 *   null      - verified as signed out
 *   undefined - nothing trustworthy (header missing, unsigned or wrongly signed): the caller must check the session itself
 */
export function readVerifiedUserId(h: { get(name: string): string | null }): string | null | undefined {
  const id = h.get(VERIFIED_USER_HEADER)
  const sig = h.get(VERIFIED_USER_SIG_HEADER)
  const k = key()
  if (id === null || sig === null || !k) return undefined
  const expected = Buffer.from(mac(k, id))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined
  return id === '' ? null : id
}
