// Deterministic entity extraction for Stage 1. Pulls structured hints (money,
// dates, reference IDs, emails) from the email so conversion can pre-fill a
// service's form fields instead of creating a request with empty form_data.
// Stored on intake_classifications.entities; consumed by the conversion layer.

function uniq(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))]
}

const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'

export interface ExtractedEntities {
  amounts?: string[]   // "$1,234.56", "INR 500", "₹2000"
  dates?: string[]     // "2026-06-22", "22/06/2026", "Jun 22, 2026"
  refs?: string[]      // invoice/order/account/ticket/PO numbers
  emails?: string[]
}

export function extractEntities(subject: string | null, body: string | null): ExtractedEntities {
  const text = `${subject ?? ''}\n${body ?? ''}`
  if (!text.trim()) return {}
  const out: ExtractedEntities = {}

  // Money: symbol-prefixed ($/€/£/₹) or currency-coded (USD/EUR/GBP/INR/Rs).
  const money = text.match(/[$€£₹]\s?\d[\d,]*(?:\.\d+)?|\b(?:USD|EUR|GBP|INR|Rs\.?)\s?\d[\d,]*(?:\.\d+)?/gi)
  if (money) out.amounts = uniq(money)

  // Dates: ISO, slashed, or "Mon DD, YYYY" / "DD Mon YYYY".
  const dates = text.match(
    new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b|\\b${MONTHS}\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b|\\b\\d{1,2}\\s+${MONTHS}\\.?(?:\\s+\\d{4})?\\b`, 'gi'),
  )
  if (dates) out.dates = uniq(dates)

  // Reference numbers: a labelled token (invoice/order/account/ticket/PO/payment)
  // followed by an alphanumeric id. Captures the id only.
  const refs: string[] = []
  const refRe = /\b(?:invoice|order|ref(?:erence)?|account|ticket|payment(?:s)?\s+profile|p\.?o\.?)\s*(?:no\.?|number|id|#)?[:#\s]*([A-Z0-9][A-Z0-9-]{3,})/gi
  for (let m; (m = refRe.exec(text)); ) {
    // Real reference ids contain a digit — this drops captures of the next plain
    // word (e.g. "Reference order ORD-1" capturing "order").
    if (/\d/.test(m[1])) refs.push(m[1])
  }
  if (refs.length) out.refs = uniq(refs)

  // Emails (strip trailing sentence punctuation the greedy match can grab).
  const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g)
  if (emails) out.emails = uniq(emails.map((e) => e.replace(/[.,;:]+$/, '')))

  return out
}
