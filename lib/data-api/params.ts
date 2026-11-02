// The read-only data API (/api/data/v1): how the request parameters are read. Pure, so every rule is easy to test.
//
// A page is asked for with:   entity=<name>  limit=<1..5000>  updated_since=<ISO date or time>  after=<cursor of the page before>
// The cursor is opaque to the caller: it is handed back as `next_after` and passed in again as `after` (keyset paging on (cursor column, id), so no row is skipped or repeated
// while rows change between two pages).

export const API_VERSION = 1
export const DEFAULT_LIMIT = 1000
export const MAX_LIMIT = 5000

export type Cursor = { t: string | null; id: string }

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ t: c.t, i: c.id }), 'utf8').toString('base64url')
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const o = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as { t?: unknown; i?: unknown }
    if (typeof o.i !== 'string' || o.i === '' || o.i.length > 100) return null
    if (o.t !== null && (typeof o.t !== 'string' || o.t.length > 64)) return null
    // the value goes into a filter: only characters of a timestamp or an id are accepted
    if (!/^[0-9A-Za-z:.+\-_ ]*$/.test(o.i) || (typeof o.t === 'string' && !/^[0-9A-Za-z:.+\-_ ]+$/.test(o.t))) return null
    return { t: (o.t as string | null) ?? null, id: o.i }
  } catch { return null }
}

export type ParsedParams =
  | { ok: true; entity: string; limit: number; since: string | null; after: Cursor | null }
  | { ok: false; error: string }

export function parseParams(sp: URLSearchParams): ParsedParams {
  const entity = (sp.get('entity') ?? '').trim()
  if (!/^[a-z_]{1,60}$/.test(entity)) return { ok: false, error: 'entity is required (letters and underscores only).' }

  let limit = DEFAULT_LIMIT
  const rawLimit = sp.get('limit')
  if (rawLimit !== null && rawLimit !== '') {
    if (!/^\d{1,6}$/.test(rawLimit)) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}.` }
    limit = Number(rawLimit)
    if (limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}.` }
  }

  let since: string | null = null
  const rawSince = sp.get('updated_since')
  if (rawSince !== null && rawSince !== '') {
    const d = new Date(rawSince)
    if (Number.isNaN(d.getTime()) || rawSince.length > 40) return { ok: false, error: 'updated_since must be an ISO date or date-time (UTC), for example 2026-11-01T00:00:00Z.' }
    since = d.toISOString()
  }

  let after: Cursor | null = null
  const rawAfter = sp.get('after')
  if (rawAfter !== null && rawAfter !== '') {
    after = decodeCursor(rawAfter)
    if (!after) return { ok: false, error: 'after is not a cursor given by this API (use next_after of the previous page).' }
  }
  return { ok: true, entity, limit, since, after }
}

/** A database timestamp as ISO text with the database's own precision: "+00:00" becomes "Z", any other offset (the database's time zone, e.g. "-08:00") is KEPT as it is, so every value carries its offset. */
export function isoUtc(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v)
  if (/\+00(:?00)?$/.test(s)) return s.replace(/\+00(:?00)?$/, 'Z').replace(' ', 'T')
  return s
}
