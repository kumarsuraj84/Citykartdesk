import { createHash } from 'node:crypto'

// Strips quoted replies and signatures from an email body to produce a clean
// "latest message" text for classification/triage.
export function normalizeBody(bodyText: string): string {
  if (!bodyText) return ''

  const lines = bodyText.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Quoted reply markers — everything from here down is prior conversation.
    if (/^>/.test(trimmed)) break
    if (/^On .+ wrote:$/.test(trimmed)) break
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(trimmed)) break
    if (/^From:\s.+/.test(trimmed) && out.length > 0) break

    // Signature delimiter ("-- ").
    if (trimmed === '--' || trimmed === '-- ') break

    out.push(line)
  }

  return out.join('\n').trim()
}

// Stable hash for near-duplicate detection (same sender + subject + cleaned body).
export function computeDedupHash(parts: {
  fromAddress: string | null
  subject: string | null
  normalizedText: string
}): string {
  const basis = [
    (parts.fromAddress ?? '').toLowerCase().trim(),
    (parts.subject ?? '').toLowerCase().trim(),
    parts.normalizedText.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 2000),
  ].join('|')
  return createHash('sha256').update(basis).digest('hex')
}
