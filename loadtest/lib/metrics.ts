// Per-worker metrics recorder. Each worker process writes its own JSON file
// (no shared-file write contention across concurrent workers); loadtest/report.mjs
// merges them afterward.
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export type Sample = { scenario: string; ms: number; ok: boolean; error?: string; at: string }

export class MetricsRecorder {
  private filePath: string
  constructor(runId: string, workerId: string) {
    const dir = path.resolve(__dirname, '../results', runId)
    mkdirSync(dir, { recursive: true })
    this.filePath = path.join(dir, `${workerId}.ndjson`)
  }

  record(scenario: string, ms: number, ok: boolean, error?: string) {
    const sample: Sample = { scenario, ms, ok, error, at: new Date().toISOString() }
    appendFileSync(this.filePath, JSON.stringify(sample) + '\n')
  }

  // Most action functions in this codebase return `{ error?: string }`
  // rather than throwing on a rejected/invalid operation (permission denied,
  // invalid transition, etc.) - only a thrown exception is a genuine
  // infrastructure failure. Recording both distinctly matters: an
  // `appError` under concurrent contention (e.g. two technicians racing to
  // start the same ticket) is an EXPECTED, correctly-enforced rejection,
  // not a bug - conflating it with `ok: true` would hide it entirely,
  // conflating it with a thrown `ok: false` would misreport it as an
  // infrastructure error.
  async timed<T extends { error?: string } | unknown>(scenario: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      const result = await fn()
      const appError = (result as { error?: string } | null)?.error
      if (appError) {
        this.record(scenario, performance.now() - start, false, `[app-rejected] ${appError}`)
      } else {
        this.record(scenario, performance.now() - start, true)
      }
      return result
    } catch (err) {
      this.record(scenario, performance.now() - start, false, `[thrown] ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
  }
}
