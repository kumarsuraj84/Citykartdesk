// Pure (no database): who Zoho sent the approval to, read from the "[Zoho approval]" lines the move copied into the ticket's conversation.
// A line looks like:  [Zoho approval] req_approval — Approval mail sent to suraj@citykart.org In Stage I By: Ajay Kumar
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** The distinct e-mail addresses named after "sent to" in the Zoho approval lines (lower case, in the order found). A line with no "sent to" gives nothing: the person who sent it ("By: ...") is never an approver. */
export function approverEmailsFromLines(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    for (const m of String(line ?? '').matchAll(/sent to\s+([^\n]*)/gi)) {
      // only the part before "In Stage" / "By:" belongs to the approvers
      const part = m[1].split(/\s+In Stage|\s+By\s*:/i)[0]
      for (const e of part.match(EMAIL) ?? []) { const k = e.toLowerCase(); if (!out.includes(k)) out.push(k) }
    }
  }
  return out
}
