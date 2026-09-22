// Best-effort removal of the quoted "previous message" text a mail client automatically
// includes below a reply, so the conversation shows just what the person actually typed.
// This is inherently heuristic — there is no universal format — so it only ever cuts at a
// clearly-recognized boundary, and NEVER returns something (close to) empty: if stripping
// would remove almost everything, the original text is kept in full instead. Nothing is
// ever silently lost, worst case is some extra quoted text stays visible.

const BOUNDARY_PATTERNS: RegExp[] = [
  // Gmail / Apple Mail / most webmail: "On Mon, Jan 1, 2026 at 10:00 AM Name <a@b.com> wrote:"
  // Allows up to 2 extra wrapped lines — a long sender name/address routinely gets
  // soft-wrapped mid-clause by the mail client, splitting this onto 2-3 lines.
  /^\s*On\s[^\n]*(?:\n[^\n]*){0,2}?\swrote:\s*$/im,
  // Outlook desktop: a line of dashes then "Original Message"
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  // Outlook web / mobile: a "From: ... Sent: ... To: ... Subject: ..." header block.
  // The labels are sometimes wrapped in "*" (e.g. "*From:*") when Outlook renders
  // its bold field labels down to plain text, hence the optional `\*?` around each.
  /^\s*\*?From:\*?\s.+\n\s*\*?Sent:\*?\s.+\n\s*\*?To:\*?\s.+\n\s*\*?Subject:\*?\s.+$/im,
  // Generic mailing-list style
  /^\s*-{3,}\s*$/m,
]

/** Strips a trailing run of "> " quoted lines (any client that quotes with leading ">"). */
function stripTrailingQuoteLines(text: string): string {
  const lines = text.split('\n')
  let cut = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.trim() === '' || /^\s*>/.test(line)) { cut = i; continue }
    break
  }
  return lines.slice(0, cut).join('\n')
}

export function stripQuotedReply(rawText: string): string {
  const text = (rawText ?? '').replace(/\r\n/g, '\n')
  if (!text.trim()) return text

  let cutAt = text.length
  for (const re of BOUNDARY_PATTERNS) {
    const m = re.exec(text)
    if (m && m.index < cutAt) cutAt = m.index
  }

  let result = stripTrailingQuoteLines(text.slice(0, cutAt)).trim()

  // Guard: if that removed nearly everything, the boundary match was probably a false
  // positive (e.g. the person's own reply happened to start with "On ..." or similar) —
  // keep the original rather than hide real content.
  if (result.length < 3 || result.length < text.trim().length * 0.05) {
    result = text.trim()
  }
  return result
}
