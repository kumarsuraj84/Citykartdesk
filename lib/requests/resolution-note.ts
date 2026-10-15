// The note a technician writes when marking a ticket resolved. It is read by the requester, by the next technician who meets the same problem, and (later) by
// anything that learns from solved tickets, so it must say what was wrong and what was done, and it must never carry a password.

/** The shortest note accepted (characters, spaces ignored at both ends). */
export const MIN_RESOLUTION_NOTE_CHARS = 20

export const RESOLUTION_NOTE_HINT = 'Write what the cause was and what you did to fix it, for example: "Cable was damaged. Replaced the cable and tested the payment." Never type a password here.'
export const RESOLUTION_NOTE_PLACEHOLDER = 'Cause: …  What I did: …'

// a note that is only one of these words says nothing about the fix
const EMPTY_WORDS = new Set([
  'done', 'ok', 'okay', 'resolved', 'resolve', 'solved', 'solve', 'fixed', 'fix', 'completed', 'complete', 'closed', 'close', 'sorted', 'noted', 'checked', 'working',
  'issue resolved', 'issue solved', 'issue fixed', 'problem solved', 'problem resolved', 'ticket resolved', 'done sir', 'resolved sir', 'done mam', 'resolved mam',
  'we are resolving the ticket', 'we are resolving the ticket.', 'we are closing the ticket',
])

/** A password written into text: "Pass: Abcd@1234", "password is Abcd@1234", "pwd=Abcd1234", or a word with a symbol and digits that looks like one ("Abcd@1234"). */
export function looksLikePassword(text: string): boolean {
  if (/\b(?:pass(?:word)?|passwd|pwd)\b\s*(?:[:=]|-+|\bis\b|\bwill be\b|\bset to\b|\bchanged to\b)\s*\S{3,}/i.test(text)) return true
  // a word + symbol + digits ("Abcd@1234", "Welcome#2026"), but not an e-mail address
  return /(?<![\w.+-])[A-Za-z]{3,}[@#$!%&*][0-9]{2,}\b(?!\.[a-z]{2,})/.test(text)
}

export const PASSWORD_IN_NOTE_MESSAGE = 'Please do not write a password in the note. Share it privately with the requester and write only that it was reset or created.'
export const NOTE_TOO_SHORT_MESSAGE = `Please write a little more: what was the cause, and what did you do to fix it? (at least ${MIN_RESOLUTION_NOTE_CHARS} characters)`
export const NOTE_REQUIRED_MESSAGE = 'Please add a resolution message before marking this resolved.'

/** What is wrong with a resolution note, in words for the technician; null when it is fine. */
export function checkResolutionNote(note: string | null | undefined): string | null {
  const text = (note ?? '').trim()
  if (!text) return NOTE_REQUIRED_MESSAGE
  if (looksLikePassword(text)) return PASSWORD_IN_NOTE_MESSAGE
  if (text.length < MIN_RESOLUTION_NOTE_CHARS || EMPTY_WORDS.has(text.toLowerCase().replace(/[.!\s]+$/, ''))) return NOTE_TOO_SHORT_MESSAGE
  return null
}
