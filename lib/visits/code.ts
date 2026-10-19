import { createHmac, timingSafeEqual } from 'crypto'
import { getSecret } from '@/lib/secrets'

// The store's daily VISIT CODE. The store gives it to the OEM engineer when he arrives; the engineer needs it, with the store code, on the public report page.
// It proves he is at the store and the store knows about the visit. Stateless: six digits worked out from a secret, the store and the day (Indian time), so
// nothing is stored and nobody can work it out without the secret. Valid for today and yesterday (a visit that runs past midnight).

const TZ = 'Asia/Kolkata'

export function istDay(d: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)   // yyyy-mm-dd
  return p
}

function codeFor(secret: string, orgId: string, storeCode: string, day: string): string {
  const digest = createHmac('sha256', secret).update(`visit|${orgId}|${storeCode.toUpperCase()}|${day}`).digest()
  const n = digest.readUInt32BE(0) % 1_000_000
  return String(n).padStart(6, '0')
}

/** Today's code for a store, or null when the server has no visit-code secret (the feature is then off). */
export function visitCodeFor(orgId: string, storeCode: string, now: Date = new Date()): string | null {
  const secret = getSecret('visit_code')
  return secret ? codeFor(secret, orgId, storeCode, istDay(now)) : null
}

/** True when the typed code is today's or yesterday's code of this store. Constant-time comparison. */
export function visitCodeValid(orgId: string, storeCode: string, typed: string, now: Date = new Date()): boolean {
  const secret = getSecret('visit_code')
  const clean = String(typed ?? '').replace(/\D/g, '')
  if (!secret || clean.length !== 6) return false
  const yesterday = new Date(now.getTime() - 24 * 3600_000)
  return [istDay(now), istDay(yesterday)].some((day) => {
    const expected = Buffer.from(codeFor(secret, orgId, storeCode, day))
    const given = Buffer.from(clean)
    return expected.length === given.length && timingSafeEqual(expected, given)
  })
}
