// A list of ids put into one `.in('id', [...])` becomes part of the request address. Past a few thousand characters the request is refused
// (Kong / PostgREST / the client), so a screen that works with 50 ids quietly fails or shows nothing at 500 (audit D-047, the same class as
// D-019). This runs the query in batches and joins the answers, with the same `{ data, error }` shape as a single query so call sites change
// very little. An error in any batch is reported (the first one), and the rows from the other batches are still returned.

export const IN_BATCH = 100

type Result = { data: unknown; error: { message: string } | null }

export async function inBatches<T = Record<string, unknown>>(
  ids: readonly string[],
  run: (batch: string[]) => PromiseLike<Result>,
  size: number = IN_BATCH,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const unique = [...new Set(ids)]
  const data: T[] = []
  let error: { message: string } | null = null
  for (let i = 0; i < unique.length; i += size) {
    const res = await run(unique.slice(i, i + size))
    if (res.error) { error ??= res.error; continue }
    data.push(...((res.data ?? []) as T[]))
  }
  return { data, error }
}

/** The same for a write that names its rows by id: stops at the first error. */
export async function inBatchesDo(
  ids: readonly string[],
  run: (batch: string[]) => PromiseLike<{ error: { message: string } | null }>,
  size: number = IN_BATCH,
): Promise<{ error: { message: string } | null }> {
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += size) {
    const { error } = await run(unique.slice(i, i + size))
    if (error) return { error }
  }
  return { error: null }
}
