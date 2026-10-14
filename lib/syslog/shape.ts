// System Log: the pure, dependency-free pieces (types, redaction, fingerprints, classification of failed HTTP calls).
// Nothing here touches the database, the network or Next, so it is safe to import anywhere and easy to test.

/** Rows per page on the System Log screen. */
export const SYSTEM_LOG_PAGE_SIZE = 100

export const CATEGORIES = ['audit', 'security', 'error', 'event'] as const
export const SOURCES = ['browser', 'app_server', 'server_action', 'api_route', 'cron', 'database', 'storage', 'auth', 'integration', 'admin', 'process', 'shipper'] as const
export const SEVERITIES = ['debug', 'info', 'warning', 'error', 'critical'] as const
export const OUTCOMES = ['success', 'failure', 'denied', 'unknown'] as const
export type Category = (typeof CATEGORIES)[number]
export type Source = (typeof SOURCES)[number]
export type Severity = (typeof SEVERITIES)[number]
export type Outcome = (typeof OUTCOMES)[number]

/** What a caller supplies. Everything but category / source / action is optional; the writer fills in the request context. */
export interface SystemLogInput {
  category: Category
  source: Source
  action: string
  severity?: Severity
  outcome?: Outcome
  orgId?: string | null
  actorId?: string | null
  actorRole?: string | null
  entityType?: string | null
  entityId?: string | null
  entityLabel?: string | null
  before?: unknown
  after?: unknown
  message?: string | null
  errorCode?: string | null
  stack?: string | null
  requestId?: string | null
  correlationId?: string | null
  sessionId?: string | null
  path?: string | null
  method?: string | null
  ip?: string | null
  userAgent?: string | null
  fromClick?: boolean | null
  clickTarget?: string | null
  detail?: unknown
  at?: number
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
export const isCategory = (v: unknown): v is Category => isOneOf(CATEGORIES, v)
export const isSource = (v: unknown): v is Source => isOneOf(SOURCES, v)
export const isSeverity = (v: unknown): v is Severity => isOneOf(SEVERITIES, v)
export const isOutcome = (v: unknown): v is Outcome => isOneOf(OUTCOMES, v)

// ── redaction ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authoriz(a|e)tion|bearer|cookie|credential|private[-_]?key|otp|session[-_]?id|signature|x-verified/i
const REDACTED = '[redacted]'

/** Removes things that must never be stored or pasted into a chat: tokens, keys, passwords, e-mail addresses, phone numbers. */
export function redactText(input: string): string {
  return input
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[jwt]')                         // JSON web tokens
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]')
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization)\b("?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi, '$1$2[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(?<![\w-])\+\d[\d\s().-]{8,}\d(?![\w-])/g, '[phone]')                                          // +country-code numbers
    .replace(/(?<![\w.-])(?:\+?91[\s-]?)?[6-9]\d{9}(?![\w.-])/g, '[phone]')                                  // 10-digit mobile numbers
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, '[hex]')                                                                 // long hex strings (hashes, keys)
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, '[key]')                                                               // long opaque strings
}

/** Deep copy with secret-looking keys blanked and (unless `textToo` is false, used for audit evidence) every string redacted. Bounded depth and size so it can never hang or balloon. */
export function redactValue(value: unknown, depth = 0, textToo = true): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') { const s = value.length > 4000 ? value.slice(0, 4000) + '…' : value; return textToo ? redactText(s) : s }
  if (typeof value !== 'object') return value
  if (depth > 5) return '[too deep]'
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactValue(v, depth + 1, textToo))
  const out: Record<string, unknown> = {}
  let n = 0
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (++n > 60) { out['…'] = 'more keys omitted'; break }
    out[k] = SECRET_KEY.test(k) ? REDACTED : redactValue(v, depth + 1, textToo)
  }
  return out
}

export const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, n) : null)

/** A JSON value no bigger than about `max` characters, or a marker saying it was cut. */
export function boundedJson(v: unknown, max = 6000): unknown {
  if (v === undefined || v === null) return null
  try {
    const s = JSON.stringify(v)
    if (s === undefined) return null
    return s.length <= max ? JSON.parse(s) : { truncated: s.slice(0, max) }
  } catch {
    return null
  }
}

// ── grouping ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The same problem should get the same fingerprint however its numbers, ids and addresses differ. */
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/\b(ck[a-z]{2,4}-)\d+\b/g, '$1<n>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/https?:\/\/[^\s"')]+/g, '<url>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/** Short stable hash (FNV-1a, 53-bit) — grouping only, not security. */
export function fingerprintOf(parts: { source: string; code?: string | null; message?: string | null; where?: string | null }): string {
  const text = [parts.source, parts.code ?? '', normalizeMessage(parts.message ?? ''), (parts.where ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>')].join('|')
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

// ── which service did a failed call go to, and is the failure worth recording ───────────────────────────────────────────────────
export function sourceOfUrl(url: string): Source {
  if (/\/rest\/v1(\/|\?|$)/.test(url)) return 'database'
  if (/\/auth\/v1(\/|\?|$)/.test(url)) return 'auth'
  if (/\/storage\/v1(\/|\?|$)/.test(url)) return 'storage'
  return 'integration'
}

/** The API error code, when the response body is a PostgREST / auth / storage error object. */
export function errorCodeOfBody(body: string): { code: string | null; message: string | null } {
  try {
    const j = JSON.parse(body) as Record<string, unknown>
    const code = (j.code ?? j.error_code ?? j.error ?? j.statusCode) as unknown
    const message = (j.message ?? j.msg ?? j.error_description ?? j.details) as unknown
    return { code: code === undefined || code === null ? null : String(code), message: typeof message === 'string' ? message : null }
  } catch {
    return { code: null, message: body ? body.slice(0, 300) : null }
  }
}

export interface FailureVerdict { record: boolean; category: Category; severity: Severity; outcome: Outcome }

const IGNORED_CODES = new Set(['23505', 'PGRST116', 'PGRST204'])   // unique clash (claims rely on it), "no row" from .single(), empty result

/** Decide whether an HTTP response from a Supabase service or an outside service is a failure worth a row, and how serious it is. */
export function judgeResponse(status: number, source: Source, code: string | null, method = 'GET'): FailureVerdict {
  const no = { record: false, category: 'error' as Category, severity: 'info' as Severity, outcome: 'success' as Outcome }
  if (status < 400) return no
  if (code && IGNORED_CODES.has(code)) return no
  if (status >= 500) return { record: true, category: 'error', severity: 'error', outcome: 'failure' }
  if (status === 401 || status === 403) {
    // a wrong password is not a platform error: the sign-in action records it as a security event
    if (source === 'auth') return no
    return { record: true, category: 'security', severity: 'warning', outcome: 'denied' }
  }
  // a database 404 that carries an API error code means a table, view or function does not exist (a missing migration): a real fault
  if (status === 404 && source === 'database' && code && /^(PGRST2\d\d|42P01|42883)$/.test(code)) return { record: true, category: 'error', severity: 'error', outcome: 'failure' }
  if (status === 404 || status === 406) return no
  if (status === 409) return no
  if (source === 'auth' && (status === 400 || status === 422)) return no   // invalid credentials / weak password: user mistakes
  if (status === 408 || status === 429) return { record: true, category: 'error', severity: 'warning', outcome: 'failure' }
  if (source === 'integration' && method === 'GET' && status === 400) return { record: true, category: 'error', severity: 'warning', outcome: 'failure' }
  return { record: true, category: 'error', severity: 'warning', outcome: 'failure' }
}

/** Map a structured-logger event onto a System Log source. */
export function sourceOfLoggerEvent(event: string, route?: string): Source {
  const e = event.toLowerCase()
  const r = (route ?? '').toLowerCase()
  if (e.startsWith('cron.') || r.includes('/run') && r.includes('app/api')) return 'cron'
  if (/email|mail|whatsapp|push|oauth|desktime|gmail|graph|webhook|intake/.test(e)) return 'integration'
  if (r.includes('app/api') || r.startsWith('/api/')) return 'api_route'
  if (r.includes('actions') || r.includes('#')) return 'server_action'
  if (e.startsWith('storage')) return 'storage'
  return 'app_server'
}
