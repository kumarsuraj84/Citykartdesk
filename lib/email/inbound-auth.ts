// Was an inbound e-mail really sent by the address it says it is from? (audit D-028)
// The sender of a reply decides who a comment is posted as, and a "From" line can be typed by anyone. The mail server in front of the mailbox
// (Gmail) checks SPF, DKIM and DMARC and records the result in an `Authentication-Results` header it adds at the TOP of the message. This reads
// that result: only the header added by Google's own server is believed (a sender can add more such lines lower down, but never above the one the
// receiving server adds), and a message that clearly failed is not attributed to anyone.
//
// A message with no header from the receiving server at all (for example mail between two people of the same Google Workspace domain, which
// is never checked externally) is "unchecked", not "failed": it is allowed through exactly as before, so ordinary internal replies keep working.

export type SenderAuth = { verdict: 'authentic' | 'failed' | 'unchecked'; reason: string }

const lower = (v: string) => v.toLowerCase()
const domainOf = (address: string) => lower(address.slice(address.lastIndexOf('@') + 1).trim())
/** Same domain, or one is a sub-domain of the other (relaxed alignment, as DMARC allows by default). */
const aligned = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`))

function headerLines(value: unknown): string[] {
  if (value === undefined || value === null) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v && 'text' in v ? String((v as { text: unknown }).text) : String(v)))
}

/** The result recorded by one method ("dkim", "spf", "dmarc"): its verdict word, plus the property values that follow it. */
function methodResults(header: string, method: string): { result: string; props: Record<string, string> }[] {
  const out: { result: string; props: Record<string, string> }[] = []
  // each ";"-separated item looks like  `dkim=pass header.i=@x.com header.s=sel`  or  `spf=fail (comment) smtp.mailfrom=a@b.c`
  for (const part of header.split(';').slice(1)) {
    const item = part.replace(/\([^)]*\)/g, ' ').trim()
    const m = new RegExp(`^${method}\\s*=\\s*([a-z]+)\\b(.*)$`, 'i').exec(item)
    if (!m) continue
    const props: Record<string, string> = {}
    for (const p of m[2].matchAll(/([a-z]+\.[a-z]+)\s*=\s*("[^"]*"|\S+)/gi)) props[lower(p[1])] = p[2].replace(/^"|"$/g, '')
    out.push({ result: lower(m[1]), props })
  }
  return out
}

export function senderAuthenticity(authResults: unknown, fromAddress: string): SenderAuth {
  const fromDomain = domainOf(fromAddress)
  // the first (topmost) header written by Google's own server
  const header = headerLines(authResults).find((h) => /^\s*[\w.-]*google\.com\s*(;|$)/i.test(h.split(';')[0] + ';'))
  if (!header) return { verdict: 'unchecked', reason: 'no result from the receiving mail server' }

  const dmarc = methodResults(header, 'dmarc')
  // a DMARC result names the domain it was about (header.from); a pass for some other domain says nothing about this sender (VAPT VA-INT-07)
  const dmarcPassForSender = dmarc.some((d) => d.result === 'pass' && (!d.props['header.from'] || aligned(lower(d.props['header.from']), fromDomain)))
  if (dmarcPassForSender) return { verdict: 'authentic', reason: 'DMARC pass' }
  if (dmarc.some((d) => d.result === 'fail')) return { verdict: 'failed', reason: 'DMARC fail' }

  // the domain publishes no DMARC rule: accept a DKIM or SPF pass only when it is for the very domain the message says it is from
  for (const d of methodResults(header, 'dkim')) {
    if (d.result !== 'pass') continue
    const signer = lower((d.props['header.d'] ?? d.props['header.i'] ?? '').replace(/^@/, '').replace(/^.*@/, ''))
    if (aligned(signer, fromDomain)) return { verdict: 'authentic', reason: 'DKIM pass for the sender domain' }
  }
  for (const s of methodResults(header, 'spf')) {
    if (s.result !== 'pass') continue
    const envelope = domainOf(s.props['smtp.mailfrom'] ?? s.props['smtp.helo'] ?? '')
    if (aligned(envelope, fromDomain)) return { verdict: 'authentic', reason: 'SPF pass for the sender domain' }
  }
  return { verdict: 'failed', reason: 'neither SPF nor DKIM vouches for the sender domain' }
}
