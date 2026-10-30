// Turns what a person typed in a search box into a safe "contains" pattern for the database's ilike filter.
//  - , ( ) " and \ would break the filter text (the same filter text can hold several conditions separated by commas), so they are removed;
//  - % and _ are wildcards in a pattern, so they are escaped and match only themselves.
export function containsPattern(raw: string): string {
  const cleaned = raw.replace(/[,()"\\]/g, '').trim().replace(/[%_]/g, (c) => `\\${c}`)
  return `%${cleaned}%`
}
