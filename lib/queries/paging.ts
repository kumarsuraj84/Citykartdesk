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

export type CountedPageResult = PageResult & { count?: number | null }

/**
 * Like fetchAllPages, but for a big read: the FIRST page also asks the database for the total number of rows, and the remaining pages are then read a few at a time
 * instead of one after the other (a 9,000-ticket report is 10 pages; read in turn they took ten waits in a row). The result is the same rows in the same order, with the same
 * guarantees: an error on any page throws, and reaching the row cap reports `truncated: true`. If the database does not return a total, it reads the rest in turn exactly as
 * fetchAllPages does.
 * `build(from, to, withCount)` must return a query ordered by a unique key (so every page is a stable slice) and ask for an exact count when `withCount` is true.
 */
export async function fetchAllPagesParallel<T>(
  build: (from: number, to: number, withCount: boolean) => PromiseLike<CountedPageResult>,
  opts: { maxRows?: number; pageSize?: number; concurrency?: number } = {},
): Promise<{ rows: T[]; truncated: boolean }> {
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const maxRows = opts.maxRows ?? Number.POSITIVE_INFINITY
  const concurrency = Math.max(1, opts.concurrency ?? 4)

  const first = await build(0, pageSize - 1, true)
  if (first.error) throw new PagingError(first.error.message, 0)
  const firstRows = (first.data ?? []) as T[]
  if (firstRows.length < pageSize) return { rows: firstRows, truncated: false }

  const total = typeof first.count === 'number' ? first.count : null
  if (total === null) {
    // no total to plan with: continue page by page, as fetchAllPages does
    const rows: T[] = [...firstRows]
    if (rows.length >= maxRows) return { rows, truncated: true }
    for (let offset = pageSize; ; offset += pageSize) {
      const { data, error } = await build(offset, offset + pageSize - 1, false)
      if (error) throw new PagingError(error.message, offset)
      const page = (data ?? []) as T[]
      rows.push(...page)
      if (page.length < pageSize) return { rows, truncated: false }
      if (rows.length >= maxRows) return { rows, truncated: true }
    }
  }

  // read up to the cap (one row more than the cap, so a result of exactly the cap is not called truncated)
  const wanted = Math.min(total, Number.isFinite(maxRows) ? maxRows : total)
  const pageCount = Math.ceil(wanted / pageSize)
  const pages: T[][] = [firstRows]
  for (let start = 1; start < pageCount; start += concurrency) {
    const wave = Array.from({ length: Math.min(concurrency, pageCount - start) }, (_, i) => start + i)
    const got = await Promise.all(wave.map(async (p) => {
      const { data, error } = await build(p * pageSize, p * pageSize + pageSize - 1, false)
      if (error) throw new PagingError(error.message, p * pageSize)
      return (data ?? []) as T[]
    }))
    pages.push(...got)
    // a short page means the data ended earlier than the total said (rows were deleted meanwhile): stop there
    if (got.some((g) => g.length < pageSize)) break
  }
  const rows = pages.flat()
  return { rows, truncated: rows.length >= maxRows && total > rows.length }
}
