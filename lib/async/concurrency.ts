/**
 * Runs `fn` over `items` with at most `limit` in flight at once — a
 * worker-pool pattern rather than a flat `Promise.all` (which would fire
 * everything at once and risk overwhelming the DB connection pool or an
 * email-sending rate limit) or a plain sequential `for...of` (which is
 * needlessly slow for cron/batch jobs processing many independent rows).
 * Only safe for items whose processing doesn't share mutable state across
 * iterations (e.g. a running counter/index one item's processing depends on
 * another's) — for that case, keep the loop sequential.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
