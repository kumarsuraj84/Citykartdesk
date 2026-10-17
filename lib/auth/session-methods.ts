// How the current session was obtained (the "amr" claim of the access token), so the password-reset action can tell a session that came from a recovery or
// invitation link from an ordinary signed-in session (VAPT-061 / VA-TKT-18 a). The token itself was already verified by the auth service when the session was
// read; here only the claim is read.

export type AuthMethod = { method: string; timestamp: number }

export function decodeAmr(accessToken: string | null | undefined): AuthMethod[] {
  try {
    const part = (accessToken ?? '').split('.')[1]
    if (!part) return []
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { amr?: unknown }
    if (!Array.isArray(payload.amr)) return []
    return payload.amr
      .filter((a): a is { method: string; timestamp?: number } => !!a && typeof a === 'object' && typeof (a as { method?: unknown }).method === 'string')
      .map((a) => ({ method: a.method, timestamp: typeof a.timestamp === 'number' ? a.timestamp : 0 }))
  } catch {
    return []
  }
}

/** Ways to get a session without typing the password: a recovery or invitation link, a one-time code. */
const LINK_METHODS = new Set(['recovery', 'invite', 'otp', 'magiclink', 'email/signup'])

/** True when the session was started by such a link within the last `maxAgeMinutes` minutes. */
export function startedByRecentLink(accessToken: string | null | undefined, maxAgeMinutes = 60, now = Date.now()): boolean {
  return decodeAmr(accessToken).some((a) => LINK_METHODS.has(a.method) && a.timestamp > 0 && now / 1000 - a.timestamp <= maxAgeMinutes * 60)
}
