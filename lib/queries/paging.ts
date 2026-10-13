// Reads every page of a query. The database returns at most 1000 rows per request, so a bigger result has to be read page by page.
// Audit finding D-019: five copies of this loop in the report code treated an error on any page as "no more rows" (the numbers were then
// quietly too small) and stopped at 50,000 rows without saying so. This version never hides either:
//   - an error on any page throws, so a broken query shows up as an error, not as a smaller number;
//   - reaching the row cap returns `truncated: true`, so the screen can say that it is showing only the first rows.

export const PAGE_SIZE = 1000

export class PagingError extends Error {
  constructor(message: string, public readonly offset: number) {
    super(`${message} (while reading rows from ${offset})`)
    this.name = 'PagingError'
  }
}

export type PageResult = { data: unknown; error?: { message: string } | null }

export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult>,
  opts: { maxRows?: number; pageSize?: number } = {},
): Promise<{ rows: T[]; truncated: boolean }> {
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const maxRows = opts.maxRows ?? Number.POSITIVE_INFINITY
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await build(offset, offset + pageSize - 1)
    if (error) throw new PagingError(error.message, offset)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < pageSize) return { rows, truncated: false }
    if (rows.length >= maxRows) return { rows, truncated: true }
  }
}
