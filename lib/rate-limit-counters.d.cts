export interface ProgressiveOptions { free?: number; baseMs?: number; maxMs?: number }
export interface Counters {
  hit(key: string, limit: number, windowMs: number, now?: number): { limited: boolean; remaining: number }
  over(key: string, limit: number, now?: number): boolean
  rec(key: string, windowMs: number, now?: number): number
  pwait(key: string, now?: number): number
  pfail(key: string, opts?: ProgressiveOptions, now?: number): number
  pclear(key: string): void
  size(): { keys: number; progressive: number }
}
export function createCounters(): Counters
export function runShared(counters: Counters, op: string, args: unknown[]): unknown
