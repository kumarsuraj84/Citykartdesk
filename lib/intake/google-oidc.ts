// Verifies the signed identity token (OIDC JWT) that Google Cloud Pub/Sub can attach to every push delivery (VAPT-042).
// Before this, the Gmail push address trusted one shared token in the URL, which sits in logs and can be replayed. When the audience and the
// service-account address are configured (GMAIL_PUSH_OIDC_AUDIENCE, GMAIL_PUSH_OIDC_EMAIL), a delivery without a valid Google signature for exactly that
// audience and service account is refused. Nothing is contacted unless a token is presented; the signing keys are fetched from Google and cached.
import { createPublicKey, createVerify, type JsonWebKey } from 'crypto'

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

export type GoogleKey = JsonWebKey & { kid?: string }
export type KeyFetcher = () => Promise<GoogleKey[]>

let cache: { at: number; keys: GoogleKey[] } | null = null

async function defaultFetchKeys(): Promise<GoogleKey[]> {
  const res = await fetch(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`certs ${res.status}`)
  const body = (await res.json()) as { keys?: GoogleKey[] }
  return body.keys ?? []
}

async function keys(fetchKeys: KeyFetcher, now: number, force = false): Promise<GoogleKey[]> {
  if (!force && cache && now - cache.at < 3_600_000) return cache.keys
  const fresh = await fetchKeys()
  cache = { at: now, keys: fresh }
  return fresh
}

export function resetGoogleKeyCache() { cache = null }

const b64 = (s: string) => Buffer.from(s, 'base64url')

export type OidcCheck = { ok: true; email: string } | { ok: false; reason: string }

/** `authorization` is the raw Authorization header value. All claims are checked; the audience and e-mail must match exactly. */
export async function verifyGoogleOidc(
  authorization: string | null,
  expected: { audience: string; email: string },
  opts: { fetchKeys?: KeyFetcher; now?: number } = {},
): Promise<OidcCheck> {
  const now = opts.now ?? Date.now()
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization ?? '')
  if (!m) return { ok: false, reason: 'no bearer token' }
  let header: { alg?: string; kid?: string }, claims: { iss?: string; aud?: string; email?: string; email_verified?: boolean; exp?: number; iat?: number }
  try {
    header = JSON.parse(b64(m[1]).toString('utf8'))
    claims = JSON.parse(b64(m[2]).toString('utf8'))
  } catch { return { ok: false, reason: 'malformed token' } }
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'unexpected algorithm' }   // never accept "none" or a symmetric algorithm

  const fetchKeys = opts.fetchKeys ?? defaultFetchKeys
  let jwk: GoogleKey | undefined
  try {
    jwk = (await keys(fetchKeys, now)).find((k) => k.kid === header.kid)
    if (!jwk) jwk = (await keys(fetchKeys, now, true)).find((k) => k.kid === header.kid)   // Google rotates keys
  } catch { return { ok: false, reason: 'signing keys unavailable' } }
  if (!jwk) return { ok: false, reason: 'unknown signing key' }

  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${m[1]}.${m[2]}`)
    if (!verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), b64(m[3]))) return { ok: false, reason: 'bad signature' }
  } catch { return { ok: false, reason: 'bad signature' } }

  const sec = Math.floor(now / 1000)
  if (!claims.iss || !ISSUERS.has(claims.iss)) return { ok: false, reason: 'wrong issuer' }
  if (claims.aud !== expected.audience) return { ok: false, reason: 'wrong audience' }
  if (typeof claims.exp !== 'number' || claims.exp < sec - 30) return { ok: false, reason: 'expired' }
  if (typeof claims.iat === 'number' && claims.iat > sec + 300) return { ok: false, reason: 'issued in the future' }
  if (claims.email_verified !== true || !claims.email || claims.email.toLowerCase() !== expected.email.toLowerCase()) return { ok: false, reason: 'wrong service account' }
  return { ok: true, email: claims.email }
}
