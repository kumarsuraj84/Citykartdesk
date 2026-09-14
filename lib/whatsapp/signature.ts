import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies Meta's `X-Hub-Signature-256` header: `sha256=<hex>`, an
 * HMAC-SHA256 of the RAW request body keyed with the receiving app's App
 * Secret (per current Meta Cloud API webhook documentation). Must be
 * computed over the exact bytes Meta sent — this is why the webhook route
 * reads the body with `req.text()` before any JSON parsing, mirroring the
 * built-in `crypto.createHmac` + `timingSafeEqual` pattern already
 * established in this codebase for OAuth state signing (lib/intake/oauth.ts)
 * rather than introducing a signature-verification package.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader) return false
  const prefix = 'sha256='
  if (!signatureHeader.startsWith(prefix)) return false
  const provided = signatureHeader.slice(prefix.length)

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')

  const providedBuf = Buffer.from(provided, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}
