// Copies only the named keys that are present in `source`. Admin update actions write with the server's all-powerful database client, so a
// payload from the browser must never be spread into an update as it arrives: anything not listed (organization, ids, timestamps, who created
// the row) would be written too (audit D-013).
export function pickFields<T extends Record<string, unknown>, K extends keyof T & string>(source: T | null | undefined, allowed: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {}
  if (!source || typeof source !== 'object') return out
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) out[key] = source[key]
  return out
}
