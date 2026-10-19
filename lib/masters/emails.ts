// Pure helpers for the "Mail ID" cells of the master sheets (no Node-only imports).

/** Company addresses: they go in CC of an OEM mail; everything else is the OEM and goes in To. */
export const INTERNAL_EMAIL_DOMAINS = ['citykartstores.com', 'citykart.org']

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/

export type ParsedEmails = {
  valid: string[]
  /** Pieces that are not an address (for example the "kuld" half of "kuld,ep.singh1@jakson.com"). */
  invalid: string[]
  /** Addresses whose domain is one letter away from a company domain (for example citylartstores.com): they are still used. */
  typoDomains: string[]
}

function distance(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 1) return 2
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

export function isProbableTypoDomain(domain: string): boolean {
  const d = domain.toLowerCase()
  if (INTERNAL_EMAIL_DOMAINS.includes(d)) return false
  return INTERNAL_EMAIL_DOMAINS.some((own) => distance(d, own) === 1)
}

/** Splits a cell that holds one or several addresses (comma, semicolon, space or line break between them), lower-cases, removes duplicates. */
export function parseEmails(raw: string | null | undefined): ParsedEmails {
  const out: ParsedEmails = { valid: [], invalid: [], typoDomains: [] }
  if (!raw) return out
  const seen = new Set<string>()
  for (const piece of raw.split(/[,;\s]+/)) {
    const token = piece.trim().replace(/^[<"']+|[>"']+$/g, '')
    if (!token) continue
    const email = token.toLowerCase()
    if (!EMAIL_RE.test(email)) { out.invalid.push(token); continue }
    if (seen.has(email)) continue
    seen.add(email)
    out.valid.push(email)
    if (isProbableTypoDomain(email.split('@')[1])) out.typoDomains.push(email)
  }
  return out
}

export function isInternalEmail(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1] ?? ''
  return INTERNAL_EMAIL_DOMAINS.includes(domain)
}

/** Outside addresses go in To, company addresses in CC. A mail needs a To, so when every address is a company address they all go in To. */
export function splitRecipients(emails: string[]): { to: string[]; cc: string[] } {
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))]
  const external = unique.filter((e) => !isInternalEmail(e))
  if (external.length === 0) return { to: unique, cc: [] }
  return { to: external, cc: unique.filter((e) => isInternalEmail(e)) }
}
