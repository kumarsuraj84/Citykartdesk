// What a reply, reply-all or forward may contain when it leaves the Intake inbox. A plain module (not inside the 'use server' file that calls it) so the
// rules can be tested on their own. Everything that arrives from the browser is untrusted: only the known fields are copied, addresses are checked, sizes
// are bounded, and the HTML goes through the same sanitiser the e-mail templates use.

import { sanitizeTemplateHtml } from '@/lib/email/sanitize-template'
import { isEmailShape } from '@/lib/requests/cc-recipients'

export type SendAction = 'reply' | 'reply_all' | 'forward'

export const SEND_ACTIONS: SendAction[] = ['reply', 'reply_all', 'forward']
export const MAX_SEND_RECIPIENTS = 20

export interface CleanSendPayload {
  action: SendAction
  toAddresses: string[]
  ccAddresses: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
}

/** The cleaned copy of what the browser sent: only the known fields, valid addresses (lower-case, no duplicates), a bounded size, a safe subject and sanitised HTML. */
export function cleanSendPayload(payload: unknown): CleanSendPayload | { error: string } {
  if (!payload || typeof payload !== 'object') return { error: 'Nothing to send.' }
  const p = payload as Record<string, unknown>
  const action = p.action as SendAction
  if (!SEND_ACTIONS.includes(action)) return { error: 'Unknown send action.' }

  const list = (v: unknown): string[] | null => {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v)) return null
    const out: string[] = []
    for (const item of v) {
      if (typeof item !== 'string') return null
      const a = item.trim().toLowerCase()
      if (!a) continue
      if (a.length > 254 || !isEmailShape(a)) return null
      if (!out.includes(a)) out.push(a)
    }
    return out
  }
  const toAddresses = list(p.toAddresses)
  const ccAddresses = list(p.ccAddresses)
  if (!toAddresses || !ccAddresses) return { error: 'One of the e-mail addresses is not valid.' }
  if (toAddresses.length === 0) return { error: 'Recipient required.' }
  if (toAddresses.length + ccAddresses.length > MAX_SEND_RECIPIENTS) return { error: `At most ${MAX_SEND_RECIPIENTS} recipients are allowed on one message.` }

  // a line break in a subject would let the sender add header lines of their own
  const subject = typeof p.subject === 'string' ? p.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 300) : ''
  if (!subject) return { error: 'A subject is required.' }
  const bodyText = typeof p.bodyText === 'string' ? p.bodyText : ''
  if (bodyText.length > 200_000) return { error: 'The message is too long.' }
  if (typeof p.bodyHtml === 'string' && p.bodyHtml.length > 400_000) return { error: 'The message is too long.' }
  const bodyHtml = typeof p.bodyHtml === 'string' && p.bodyHtml.trim() ? sanitizeTemplateHtml(p.bodyHtml) : undefined
  return { action, toAddresses, ccAddresses, subject, bodyText, ...(bodyHtml ? { bodyHtml } : {}) }
}
