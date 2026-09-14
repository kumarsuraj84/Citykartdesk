export type TitleGenerationInput = {
  serviceName: string
  subCategoryName?: string | null
  description?: string | null
}

/** Pluggable AI hook — optional, never required. Nothing in this codebase
 *  wires a default implementation today: the root Next.js app's package.json
 *  has no AI/LLM SDK dependency (only api/package.json, a separate service,
 *  depends on @anthropic-ai/sdk) — confirmed during the Stage 3 audit. A
 *  future caller may pass one in; until then generateRequestTitle() always
 *  takes the deterministic path below. */
export type AiTitleProvider = (input: TitleGenerationInput) => Promise<string | null>

const MAX_TITLE_LENGTH = 120
const AI_TIMEOUT_MS = 3000
// A phrase extracted from the description shorter than this (in words) reads
// as ambiguous on its own ("Not Working") — paired with the sub-category
// name instead of standing alone. See extractPhraseFromDescription()/
// deterministicTitle() below.
const MIN_SUBSTANTIVE_PHRASE_WORDS = 3
const MAX_PHRASE_WORDS = 8

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}

// Minor words (articles/coordinating conjunctions/short prepositions) stay
// lowercase in the middle of a title-cased phrase — standard subject-line
// convention (e.g. "Unable to Generate Invoice", not "Unable To Generate").
const TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'with',
])

function toTitleCase(phrase: string): string {
  const words = phrase.split(/\s+/).filter(Boolean)
  return words
    .map((w, i) => {
      // A word already fully uppercase (AC, POS, IT…) is very likely an
      // acronym written that way on purpose by the requester — preserved
      // as-is rather than collapsed to "Ac"/"Pos"/"It".
      if (w.length > 1 && w === w.toUpperCase()) return w
      const lower = w.toLowerCase()
      if (i !== 0 && i !== words.length - 1 && TITLE_CASE_MINOR_WORDS.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

/**
 * Deterministic, dependency-free extraction of a short subject-like phrase
 * from the start of a free-text description — no NLP, no AI. Cuts at the
 * first clause boundary (sentence-ending punctuation, a comma, or a small
 * set of joining conjunctions like "and"/"since"/"because") so the result
 * reads like a subject line instead of a restated sentence, then caps it to
 * a handful of words. Returns null only for an empty/whitespace-only input.
 */
function extractPhraseFromDescription(description: string): string | null {
  const cleaned = description.trim().replace(/\s+/g, ' ')
  if (!cleaned) return null

  const clauseMatch = cleaned.match(/^(.*?)(?:[.;!?]|,\s|\s+(?:and|since|because|so|which|that|due to)\s)/i)
  let phrase = (clauseMatch ? clauseMatch[1] : cleaned).trim()

  const words = phrase.split(/\s+/).filter(Boolean)
  if (words.length > MAX_PHRASE_WORDS) phrase = words.slice(0, MAX_PHRASE_WORDS).join(' ')

  phrase = phrase.replace(/[.,;:]+$/, '').trim()
  return phrase || null
}

/**
 * Mandatory fallback — deterministic, synchronous, always produces a usable
 * title with no I/O and no failure mode. Description-focused per the Stage
 * 3.1 correction: a substantive phrase extracted from the requester's own
 * words ("Billing Counter Printer Is Not Printing") is far more useful than
 * the bare sub-category name ("Printer Issue") alone. Falls back to pairing
 * a too-short/ambiguous phrase with the sub-category for context, then the
 * sub-category alone, then the service name — see MIN_SUBSTANTIVE_PHRASE_WORDS.
 */
function deterministicTitle(input: TitleGenerationInput): string {
  const subCategoryName = input.subCategoryName?.trim() || null
  const description = input.description?.trim() || null
  const phrase = description ? extractPhraseFromDescription(description) : null
  const phraseWordCount = phrase ? phrase.split(/\s+/).filter(Boolean).length : 0

  let base: string | null = null
  if (phrase && phraseWordCount >= MIN_SUBSTANTIVE_PHRASE_WORDS) {
    base = toTitleCase(phrase)
  } else if (phrase && subCategoryName) {
    base = `${subCategoryName}: ${toTitleCase(phrase)}`
  } else if (subCategoryName) {
    base = subCategoryName
  } else if (phrase) {
    base = toTitleCase(phrase)
  }

  const full = base ? `${input.serviceName}: ${base}` : input.serviceName
  return truncate(full, MAX_TITLE_LENGTH)
}

/**
 * Step 7: Subject/Title generation. The deterministic fallback above is
 * mandatory and always available; `aiProvider` is strictly optional and is
 * never allowed to block or fail ticket progression — a rejected promise, an
 * empty/whitespace-only result, or a response slower than AI_TIMEOUT_MS all
 * silently fall back to the deterministic title rather than propagating an
 * error to the caller.
 */
export async function generateRequestTitle(
  input: TitleGenerationInput,
  aiProvider?: AiTitleProvider
): Promise<string> {
  const fallback = deterministicTitle(input)
  if (!aiProvider) return fallback

  try {
    const aiTitle = await Promise.race([
      aiProvider(input),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS)),
    ])
    const trimmed = aiTitle?.trim()
    return trimmed ? truncate(trimmed, MAX_TITLE_LENGTH) : fallback
  } catch {
    return fallback
  }
}
