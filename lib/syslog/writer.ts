// System Log writer: a buffered queue that can never throw into the caller, drops floods of the same failure, and — when the database cannot be
// reached (which is exactly when database errors happen) — keeps the rows in a spool and sends them later. Dependencies are injected so the logic
// can be tested without a database or a disk.

import type { SystemLogRow } from './row'

export interface Spool {
  append(rows: SystemLogRow[]): void
  /** Take everything out (the spool is empty afterwards). */
  drain(): SystemLogRow[]
  size(): number
}

export interface WriterDeps {
  insert(rows: SystemLogRow[]): Promise<void>
  spool?: Spool
  now?: () => number
  /** Last-resort output when neither the database nor the spool can take a row. */
  onDrop?: (rows: SystemLogRow[], reason: string) => void
}

export interface WriterOptions {
  maxBuffer?: number
  batchSize?: number
  /** Rows with the same flood key beyond this many per window are dropped (and counted). */
  floodLimit?: number
  floodWindowMs?: number
  /** After a failed insert, go straight to the spool for this long before trying the database again. */
  backoffMs?: number
}

export class SystemLogWriter {
  private buffer: SystemLogRow[] = []
  private flood = new Map<string, { start: number; count: number; suppressed: number }>()
  private downUntil = 0
  private flushing: Promise<void> | null = null
  readonly stats = { written: 0, spooled: 0, dropped: 0, suppressed: 0 }
  private readonly o: Required<WriterOptions>
  private readonly now: () => number

  constructor(private deps: WriterDeps, opts: WriterOptions = {}) {
    this.o = { maxBuffer: 500, batchSize: 50, floodLimit: 10, floodWindowMs: 60_000, backoffMs: 15_000, ...opts }
    this.now = deps.now ?? Date.now
  }

  /** Queue one row. Never throws. `floodKey` groups repeats of the same failure. */
  enqueue(row: SystemLogRow, floodKey?: string): void {
    try {
      if (floodKey && this.tooMany(floodKey)) return
      if (this.buffer.length >= this.o.maxBuffer) {
        this.stats.dropped++
        this.deps.onDrop?.([row], 'buffer full')
        return
      }
      this.buffer.push(row)
    } catch { /* logging must never break the caller */ }
  }

  get pending(): number { return this.buffer.length }

  private tooMany(key: string): boolean {
    const t = this.now()
    const e = this.flood.get(key)
    if (!e || t - e.start >= this.o.floodWindowMs) {
      if (e && e.suppressed > 0) this.enqueueSummary(key, e.suppressed)
      this.flood.set(key, { start: t, count: 1, suppressed: 0 })
      if (this.flood.size > 2000) this.flood.delete(this.flood.keys().next().value as string)
      return false
    }
    e.count++
    if (e.count > this.o.floodLimit) { e.suppressed++; this.stats.suppressed++; return true }
    return false
  }

  private enqueueSummary(key: string, n: number): void {
    this.buffer.push({
      created_at: new Date(this.now()).toISOString(), org_id: null, category: 'error', source: 'process', severity: 'warning', outcome: 'unknown',
      action: 'system_log.flood_suppressed', actor_id: null, actor_role: null, entity_type: null, entity_id: null, entity_label: null, before_data: null, after_data: null,
      message: `${n} more of the same failure were not stored in the last minute`, error_code: null, stack: null, fingerprint: null, request_id: null, correlation_id: null,
      session_id: null, path: null, method: null, ip: null, user_agent: null, from_click: null, click_target: null, detail: { key, suppressed: n },
    })
  }

  /** Send what is queued. Safe to call often; concurrent calls share one run. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing
    this.flushing = this.run().finally(() => { this.flushing = null })
    return this.flushing
  }

  private async run(): Promise<void> {
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.o.batchSize)
      await this.send(batch)
    }
  }

  private async send(rows: SystemLogRow[]): Promise<void> {
    if (this.now() < this.downUntil) return this.toSpool(rows, 'database recently unreachable')
    try {
      await this.deps.insert(rows)
      this.stats.written += rows.length
    } catch (e) {
      this.downUntil = this.now() + this.o.backoffMs
      this.toSpool(rows, e instanceof Error ? e.message : 'insert failed')
    }
  }

  private toSpool(rows: SystemLogRow[], reason: string): void {
    try {
      if (this.deps.spool) { this.deps.spool.append(rows); this.stats.spooled += rows.length; return }
    } catch { /* fall through to drop */ }
    this.stats.dropped += rows.length
    this.deps.onDrop?.(rows, reason)
  }

  /** Try to send what an earlier outage left in the spool. Call on start-up and every little while. */
  async retrySpool(): Promise<number> {
    const spool = this.deps.spool
    if (!spool || spool.size() === 0 || this.now() < this.downUntil) return 0
    const rows = spool.drain()
    let sent = 0
    for (let i = 0; i < rows.length; i += this.o.batchSize) {
      const batch = rows.slice(i, i + this.o.batchSize)
      try {
        await this.deps.insert(batch)
        sent += batch.length
        this.stats.written += batch.length
      } catch {
        this.downUntil = this.now() + this.o.backoffMs
        spool.append(rows.slice(i))        // keep the rest for the next try
        break
      }
    }
    return sent
  }
}
