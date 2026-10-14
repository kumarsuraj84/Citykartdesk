// Parsers for the log lines of the services Citykart Desk runs on (PostgREST, Supabase Auth, Supabase Storage, PostgreSQL).
// Each parser turns a raw line into a System Log entry, or ignores it (null): only problems are worth a row.
// Pure functions with no dependencies, so scripts/log-shipper.mjs can use them and tests can feed them real samples.
//
// An entry is what POST /api/system-log/ingest accepts:
//   { category: 'error', source, severity, action, message, errorCode, path, detail, at }
// Nothing here copies request headers, cookies or bodies: only the method, path, status and the service's own error text.

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined)
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '')

// ── PostgREST ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// "14/Oct/2026:01:26:00 +0000: Config reloaded"
const POSTGREST_LINE = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}): (.*)$/
const POSTGREST_NORMAL = /^(Listening on|Admin server listening|Schema cache|Config reloaded|Connection Pool|Successfully connected|Attempting to connect|Received a schema cache|Received a config reload|Starting PostgREST|Using |Listener|Connection successful|Reconnected)/i
const POSTGREST_PROBLEM = /fail|error|could not|couldn't|unable|refus|lost|retry|timed? ?out|exception|fatal|denied|PGRST\d{3}/i

function postgrestTime(m) {
  const ms = Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6])
  const offset = (+m[8] * 60 + +m[9]) * 60_000 * (m[7] === '-' ? -1 : 1)
  return ms - offset
}

export function parsePostgrestLine(raw) {
  const line = stripAnsi(raw).trim()
  if (!line) return null
  const m = POSTGREST_LINE.exec(line)
  if (!m) {
    // a JSON error object printed on its own line
    if (line.startsWith('{')) {
      try {
        const j = JSON.parse(line)
        if (typeof j.code === 'string' && /^PGRST\d{3}$/.test(j.code)) return { category: 'error', source: 'database', severity: 'error', action: 'postgrest.error', message: clip([j.message, j.details].filter(Boolean).join(' — '), 2000), errorCode: j.code }
      } catch { /* not JSON */ }
    }
    return null
  }
  const text = m[10]
  if (POSTGREST_NORMAL.test(text) || !POSTGREST_PROBLEM.test(text)) return null
  const code = /\bPGRST\d{3}\b/.exec(text)?.[0]
  return { category: 'error', source: 'database', severity: 'error', action: 'postgrest.log', message: clip(text, 2000), errorCode: code, at: postgrestTime(m) }
}

// ── Supabase Auth (GoTrue) ──────────────────────────────────────────────────────────────────────────────────────────────────────
// {"component":"api","level":"info","msg":"request completed","path":"/token","status":200,"time":"2026-10-14T01:27:19Z"}
export function parseAuthLine(raw) {
  const line = stripAnsi(raw).trim()
  if (!line.startsWith('{')) return null
  let j
  try { j = JSON.parse(line) } catch { return null }
  const level = String(j.level ?? '').toLowerCase()
  const status = typeof j.status === 'number' ? j.status : undefined
  const fatal = level === 'fatal' || level === 'panic'
  // 4xx answers are people's mistakes (wrong password, expired link); the sign-in action records those as security events itself
  if (!fatal && status !== undefined && status >= 400 && status < 500 && status !== 429) return null
  const serverFault = status !== undefined && status >= 500
  const isError = fatal || level === 'error' || serverFault
  const isWarning = level === 'warning' || level === 'warn' || status === 429
  if (!isError && !isWarning) return null
  const message = [j.msg, typeof j.error === 'string' ? j.error : undefined].filter(Boolean).join(': ')
  return {
    category: 'error', source: 'auth', severity: fatal ? 'critical' : isError ? 'error' : 'warning',
    action: 'auth.log', message: clip(message || 'auth service reported a problem', 2000),
    errorCode: clip(j.error_code ?? (status ? String(status) : undefined), 100),
    path: clip(j.path, 500),
    detail: { component: j.component, method: j.method, status, request_id: j.request_id, duration_ns: j.duration },
    at: j.time ? Date.parse(j.time) : undefined,
  }
}

// ── Supabase Storage (pino JSON) ────────────────────────────────────────────────────────────────────────────────────────────────
// level 30 info, 40 warn, 50 error, 60 fatal. Request lines carry headers; those are never copied.
export function parseStorageLine(raw) {
  const line = stripAnsi(raw).trim()
  if (!line.startsWith('{')) return null
  let j
  try { j = JSON.parse(line) } catch { return null }
  const level = Number(j.level)
  if (!Number.isFinite(level) || level < 40) return null
  const status = j.res?.statusCode
  // warnings are only interesting when the service itself failed; "object not found" etc. are normal 4xx answers
  if (level < 50 && !(typeof status === 'number' && status >= 500)) return null
  if (level >= 50 && typeof status === 'number' && status >= 400 && status < 500) return null
  const err = j.error ?? j.err
  const message = err?.message ?? j.msg
  const path = typeof j.req?.url === 'string' ? j.req.url.split('?')[0] : undefined
  return {
    category: 'error', source: 'storage', severity: level >= 60 ? 'critical' : 'error',
    action: 'storage.log', message: clip(String(message ?? 'storage reported a problem'), 2000),
    errorCode: clip(err?.errorCode ? String(err.errorCode) : err?.code ? String(err.code) : typeof status === 'number' ? String(status) : undefined, 100),
    path: clip(path, 500),
    detail: { operation: j.operation, method: j.req?.method, status, response_ms: j.responseTime, request_id: j.reqId },
    stack: clip(typeof err?.stack === 'string' && err.stack ? err.stack : undefined, 6000),
    at: j.time ? Date.parse(j.time) : undefined,
  }
}

// ── PostgreSQL server log ───────────────────────────────────────────────────────────────────────────────────────────────────────
// "172.22.0.7 2026-10-14 01:25:01.557 UTC [89360] authenticator@postgres ERROR:  permission denied for table system_log"
// followed by optional "DETAIL:" / "STATEMENT:" lines. The optional first word (client address) and user@db depend on log_line_prefix.
const PG_LINE = /^(?:(\S+)\s)?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) ([A-Za-z]+) \[(\d+)\] (?:(\S+) )?(DEBUG\d?|LOG|INFO|NOTICE|WARNING|ERROR|FATAL|PANIC|DETAIL|HINT|STATEMENT|CONTEXT|QUERY|LOCATION):\s+(.*)$/
const PG_ZONES = { UTC: 'Z', GMT: 'Z', IST: '+05:30' }

const PG_CODES = [
  [/statement timeout/i, '57014'], [/permission denied|row-level security/i, '42501'], [/deadlock detected/i, '40P01'],
  [/violates foreign key/i, '23503'], [/violates not-null/i, '23502'], [/violates check constraint/i, '23514'],
  [/could not serialize/i, '40001'], [/too many connections|remaining connection slots/i, '53300'],
  [/password authentication failed/i, '28P01'], [/does not exist/i, '42P01'], [/out of memory/i, '53200'], [/No space left|could not extend file/i, '53100'],
]
const PG_EXPECTED = /duplicate key value violates unique constraint/i   // claims and idempotent inserts rely on this; not a fault

function pgTime(date, time, zone) {
  const z = PG_ZONES[zone]
  if (!z) return undefined
  const t = Date.parse(`${date}T${time.length === 8 ? time + '.000' : time}${z}`)
  return Number.isFinite(t) ? t : undefined
}

/** Stateful: DETAIL / STATEMENT lines are attached to the ERROR line before them, so an entry is released when the next primary line (or flush) arrives. */
export function createPostgresParser() {
  let pending = null
  const release = () => { const p = pending; pending = null; return p }
  return {
    push(raw) {
      const line = stripAnsi(raw).replace(/\r$/, '')
      const m = PG_LINE.exec(line)
      if (!m) {
        // a continuation of a long message / statement (indented)
        if (pending && /^\s/.test(line) && line.trim()) { pending.message = clip(`${pending.message}\n${line.trim()}`, 2000) }
        return []
      }
      const level = m[7]
      if (level === 'DETAIL' || level === 'HINT' || level === 'STATEMENT' || level === 'CONTEXT' || level === 'QUERY') {
        if (pending) {
          const key = level.toLowerCase()
          pending.detail = { ...pending.detail, [key]: clip(m[8], key === 'statement' || key === 'query' ? 300 : 500) }
        }
        return []
      }
      const out = release()
      if (level === 'ERROR' || level === 'FATAL' || level === 'PANIC' || level === 'WARNING') {
        const message = m[8]
        if (!PG_EXPECTED.test(message)) {
          const user = m[6]
          pending = {
            category: 'error', source: 'database',
            severity: level === 'PANIC' ? 'critical' : level === 'WARNING' ? 'warning' : 'error',
            action: `postgres.${level.toLowerCase()}`,
            message: clip(message, 2000),
            errorCode: PG_CODES.find(([re]) => re.test(message))?.[1],
            detail: { pid: Number(m[5]), db_user: user ? user.split('@')[0] : undefined, client: m[1] && /^[\d.:a-f]+$/i.test(m[1]) ? m[1] : undefined },
            at: pgTime(m[2], m[3], m[4]),
          }
        }
      }
      return out ? [out] : []
    },
    flush() { const p = release(); return p ? [p] : [] },
  }
}

// ── Nightly backup log (backup.log on the database server) ──────────────────────────────────────────────────────────────────────
// One line per step / run; the log records OK or FAILED for each run. A failed backup is the kind of thing nobody notices until the day it is
// needed, so it becomes an error row. Lines that merely say OK (or anything else) are ignored.
export function parseBackupLine(raw) {
  const line = stripAnsi(raw).trim()
  if (!line || !/\b(FAILED|FAILURE|ERROR|EXCEPTION|could not|denied)\b/i.test(line)) return null
  if (/\bOK\b/.test(line) && !/\b(FAILED|FAILURE|ERROR)\b/i.test(line)) return null
  return { category: 'error', source: 'process', severity: 'critical', action: 'backup.failed', message: clip(line, 2000) }
}

export const PARSER_KINDS = ['postgrest', 'auth', 'storage', 'postgres', 'backup']

/** One parser object per log source, with the same push / flush shape whatever the format. */
export function createParser(kind) {
  if (kind === 'postgres') return createPostgresParser()
  const single = kind === 'postgrest' ? parsePostgrestLine : kind === 'auth' ? parseAuthLine : kind === 'storage' ? parseStorageLine : kind === 'backup' ? parseBackupLine : null
  if (!single) throw new Error(`Unknown log kind "${kind}" (use ${PARSER_KINDS.join(', ')})`)
  return { push: (line) => { const e = single(line); return e ? [e] : [] }, flush: () => [] }
}

/** Collapse identical problems in one batch into one entry with a repeat count, so a flood costs one row. */
export function collapseEntries(entries) {
  const seen = new Map()
  const out = []
  for (const e of entries) {
    const key = [e.source, e.action, e.errorCode ?? '', (e.message ?? '').replace(/\d+/g, '#').slice(0, 120)].join('|')   // numbers (pids, durations, ids) do not make it a different problem
    const first = seen.get(key)
    if (first) { first.detail = { ...first.detail, repeats: (first.detail?.repeats ?? 1) + 1 }; continue }
    seen.set(key, e)
    out.push(e)
  }
  return out
}
