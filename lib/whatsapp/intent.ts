// Step 8 — a small, deterministic "friendly greeting" mapper. Stage 4's own
// parseCommand() already recognizes the literal words new/cancel/restart/
// create/edit regardless of transport; this only adds the natural phrases a
// WhatsApp user is likely to open with. Deliberately NOT a synonym table for
// every command (Step 8: "Keep this deterministic... do NOT add AI intent
// classification") and deliberately excludes "Help" — the brief lists it as
// something users may type but does not include it in the recommended
// mapping to NEW, so an unmatched "help" simply falls through to whatever
// the current conversation state (or lack of one) already does with
// unrecognized text.
const GREETING_PHRASES = new Set(['hi', 'hello', 'hey', 'new', 'ticket', 'create ticket', 'raise ticket'])

/**
 * Returns 'new' if the raw inbound text is an exact (case-insensitive,
 * whitespace-collapsed) match for one of the recognized entry phrases,
 * otherwise null. Exact-match only — never substring matching — so a
 * requester's real answer to a question (e.g. a description that happens to
 * contain the word "new") is never misread as a command.
 */
export function mapFriendlyGreetingToNew(text: string): 'new' | null {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  return GREETING_PHRASES.has(normalized) ? 'new' : null
}
