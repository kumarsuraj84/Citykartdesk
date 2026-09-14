/**
 * D-05: outbound HTML email interpolates user-controlled content (request
 * titles, comments, task titles, names, rejection reasons, ...) directly
 * into template literals with no escaping — a request titled
 * `<img src=x onerror=alert(1)>` would render as live HTML/script in the
 * recipient's mail client. No escaping helper existed anywhere in the repo.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Returns a shallow copy of `data` with every string field HTML-escaped,
 * except the keys listed in `trustedKeys` (e.g. URLs this app constructed
 * itself — `${NEXT_PUBLIC_APP_URL}/requests/${id}` — never user input, and
 * escaping them would double-encode the query string). Non-string values
 * (booleans, undefined) pass through untouched.
 *
 * Used at the top of every lib/email/templates.ts builder so a future field
 * added to one of those `d: {...}` objects is escaped by default instead of
 * requiring every call site to remember to escape it individually.
 */
export function escapeEmailFields<T extends Record<string, unknown>>(
  data: T,
  trustedKeys: (keyof T)[] = []
): T {
  const trusted = new Set(trustedKeys)
  const out = { ...data }
  for (const key of Object.keys(out) as (keyof T)[]) {
    const value = out[key]
    if (typeof value === 'string' && !trusted.has(key)) {
      out[key] = escapeHtml(value) as T[keyof T]
    }
  }
  return out
}
