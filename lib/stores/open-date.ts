/**
 * A store's open date as the Stores screen sends it: a calendar day written YYYY-MM-DD (what a date box produces). It must also be a day that
 * exists (no 31 February). Empty is allowed by the caller (no open date yet).
 *
 * (The check that used to live inline in lib/actions/admin/org.ts had lost the backslashes of its pattern, so it demanded the letter "d" and
 * refused every real date: no store could be saved with an open date.)
 */
export function isValidOpenDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}
