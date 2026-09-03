import { timingSafeEqual } from 'crypto'

/**
 * Constant-time string comparison for secrets (cron/webhook tokens). A plain
 * `===` short-circuits on the first mismatched byte, which in principle lets
 * a network attacker recover a secret one byte at a time by measuring
 * response timing — negligible practical risk over typical serverless
 * network jitter, but comparing secrets this way is cheap and standard
 * practice. Buffer.from + differing-length check first, since
 * timingSafeEqual throws (rather than returning false) on unequal lengths.
 */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
