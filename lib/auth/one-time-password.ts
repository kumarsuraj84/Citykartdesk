// A random, single-use starting password for a newly created account (VAPT-003, earlier D-011). Replaces the shared default password: every account gets its own
// password, shown to the administrator once, and the account is flagged "must change password" so the person chooses their own at first sign-in.
import { randomInt } from 'node:crypto'

// no characters that are easy to mix up when read out or typed (0/O, 1/l/I)
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const DIGIT = '23456789'
const SYMBOL = '!@#$%&*?'
const ALL = UPPER + LOWER + DIGIT + SYMBOL

const pick = (set: string) => set[randomInt(0, set.length)]

/** A random password of `length` characters (at least 12) with at least one upper-case letter, lower-case letter, digit and symbol. */
export function generateOneTimePassword(length = 14): string {
  const n = Math.max(12, Math.floor(length))
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)]
  while (chars.length < n) chars.push(pick(ALL))
  // Fisher-Yates shuffle with the same secure generator, so the guaranteed characters are not always at the front
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
