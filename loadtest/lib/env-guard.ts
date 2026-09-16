// Phase 8 safety contract for every load-test entry point.
//
// - Requires an explicit target environment; never defaults silently to Main.
// - Requires an extra confirmation for Main.
// - Prints the resolved target before doing anything else.
// - Hands back a stable RUN_ID every script/worker must tag all its data with.

export type LoadTestEnv = 'local' | 'main'

export type ResolvedTarget = {
  env: LoadTestEnv
  runId: string
  baseUrl: string
  supabaseUrl: string
  serviceRoleKey: string
}

function newRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 8)
  return `LOADTEST-${ts}-${rand}`
}

/** Call once per process/worker. Throws (does not run) if the environment
 *  isn't explicitly and correctly specified. */
export function resolveTarget(): ResolvedTarget {
  const rawEnv = process.env.LOADTEST_ENV
  if (rawEnv !== 'local' && rawEnv !== 'main') {
    throw new Error(
      `LOADTEST_ENV must be explicitly set to "local" or "main" (got: ${JSON.stringify(rawEnv)}). ` +
      `Refusing to run without an explicit target - this script never defaults to Main.`
    )
  }
  const env: LoadTestEnv = rawEnv

  if (env === 'main' && process.env.LOADTEST_CONFIRM_MAIN !== 'yes-run-against-main') {
    throw new Error(
      `Targeting MAIN requires LOADTEST_CONFIRM_MAIN=yes-run-against-main to be set explicitly. ` +
      `This is a live shared production server - confirm deliberately, every time.`
    )
  }

  const runId = process.env.LOADTEST_RUN_ID || newRunId()

  const baseUrl = env === 'local'
    ? (process.env.LOADTEST_LOCAL_BASE_URL || 'http://127.0.0.1:3001')
    : (process.env.LOADTEST_MAIN_BASE_URL || 'http://10.0.1.12:3210')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.')
  }

  // Printed on every resolve, not just once - every worker process must show
  // exactly what it's about to hit before doing anything else.
  // eslint-disable-next-line no-console
  console.log(`[loadtest] TARGET=${env.toUpperCase()} baseUrl=${baseUrl} runId=${runId}`)

  return { env, runId, baseUrl, supabaseUrl, serviceRoleKey }
}

/** Simple bounded-concurrency runner - never spawns more than `limit`
 *  in-flight tasks, never retries indefinitely (each task gets exactly one
 *  attempt unless the caller retries explicitly and boundedly itself). */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<{ results: R[]; errors: { index: number; error: string }[] }> {
  const results: R[] = new Array(items.length)
  const errors: { index: number; error: string }[] = []
  let next = 0

  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await task(items[i], i)
      } catch (err) {
        errors.push({ index: i, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return { results, errors }
}

/** Wraps a promise with a hard timeout - never let one hung call stall the
 *  whole run indefinitely. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[timeout] ${label} exceeded ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}
