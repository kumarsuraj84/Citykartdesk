// The database server (10.0.0.205) as seen by its own small reporter (scripts/windows/db-host-agent.ps1, run once a minute there): processor use, memory, free space on every
// disk. The reporter is read-only (it only reads Windows counters) and posts a few numbers to /api/health/db-host with its own shared secret. These pure functions check what
// arrives and turn it into the three checks and the chart numbers. No database, no clock: every rule has a test.
import { SERVER_LIMITS } from './catalog'
import type { Verdict } from './evaluate'

export type DbHostDisk = { name: string; totalBytes: number; freeBytes: number }
export type DbHostReport = { cpuPct: number; memTotalBytes: number; memFreeBytes: number; disks: DbHostDisk[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The report from the request body, or null when it is not a sensible report (wrong shape, impossible numbers). Never trusts the sender: every number is range-checked. */
export function parseDbHostReport(body: unknown): DbHostReport | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (!isNum(b.cpuPct) || b.cpuPct < 0 || b.cpuPct > 100) return null
  if (!isNum(b.memTotalBytes) || !isNum(b.memFreeBytes) || b.memTotalBytes <= 0 || b.memFreeBytes < 0 || b.memFreeBytes > b.memTotalBytes) return null
  if (!Array.isArray(b.disks) || b.disks.length > 12) return null
  const disks: DbHostDisk[] = []
  for (const d of b.disks) {
    if (!d || typeof d !== 'object') return null
    const x = d as Record<string, unknown>
    if (typeof x.name !== 'string' || !/^[A-Za-z]:?$/.test(x.name.trim()) || !isNum(x.totalBytes) || !isNum(x.freeBytes) || x.totalBytes <= 0 || x.freeBytes < 0 || x.freeBytes > x.totalBytes) return null
    disks.push({ name: x.name.trim().toUpperCase().replace(/:?$/, ':'), totalBytes: x.totalBytes, freeBytes: x.freeBytes })
  }
  return { cpuPct: Math.round(b.cpuPct * 10) / 10, memTotalBytes: b.memTotalBytes, memFreeBytes: b.memFreeBytes, disks }
}

const gb = (bytes: number) => bytes / 1024 ** 3
const pct1 = (v: number) => Math.round(v * 10) / 10

export function dbHostCpuVerdict(cpuPct: number): Verdict {
  return cpuPct >= SERVER_LIMITS.cpuPct ? { ok: false, detail: `CPU use is ${cpuPct}% (limit ${SERVER_LIMITS.cpuPct}%)` } : { ok: true, detail: `CPU use ${cpuPct}%` }
}

export function dbHostMemoryVerdict(totalBytes: number, freeBytes: number): { pct: number } & Verdict {
  const pct = pct1(((totalBytes - freeBytes) / totalBytes) * 100)
  const text = `${pct}% (${gb(totalBytes - freeBytes).toFixed(1)} of ${gb(totalBytes).toFixed(1)} GB)`
  return pct >= SERVER_LIMITS.memoryPct ? { pct, ok: false, detail: `memory in use is ${text}; limit ${SERVER_LIMITS.memoryPct}%` } : { pct, ok: true, detail: `memory in use ${text}` }
}

/** A disk is low when under 10% free OR under 5 GB free (the same rule as the app server). */
export function dbHostDiskVerdict(disks: DbHostDisk[]): { lowestFreePct: number | null } & Verdict {
  if (disks.length === 0) return { lowestFreePct: null, ok: true, detail: 'no disks reported' }
  const rows = disks.map((d) => ({ name: d.name, freePct: pct1((d.freeBytes / d.totalBytes) * 100), freeGb: gb(d.freeBytes) }))
  const low = rows.filter((r) => r.freePct < SERVER_LIMITS.diskFreePct || r.freeGb < SERVER_LIMITS.diskFreeGb)
  const text = (r: { name: string; freePct: number; freeGb: number }) => `${r.name} ${r.freePct}% free (${r.freeGb.toFixed(r.freeGb >= 100 ? 0 : 1)} GB)`
  const lowestFreePct = Math.min(...rows.map((r) => r.freePct))
  return low.length ? { lowestFreePct, ok: false, detail: `low space: ${low.map(text).join(', ')}` } : { lowestFreePct, ok: true, detail: rows.map(text).join('; ') }
}

/** Everything the route stores for one report: one sample per check and the numbers for the charts. */
export function dbHostRows(r: DbHostReport): { samples: { check_key: string; ok: boolean; ms: number; detail: string }[]; metrics: { metric: string; value: number }[] } {
  const cpu = dbHostCpuVerdict(r.cpuPct)
  const mem = dbHostMemoryVerdict(r.memTotalBytes, r.memFreeBytes)
  const disk = dbHostDiskVerdict(r.disks)
  const metrics = [{ metric: 'dbhost_cpu_pct', value: r.cpuPct }, { metric: 'dbhost_mem_pct', value: mem.pct }]
  if (disk.lowestFreePct !== null) metrics.push({ metric: 'dbhost_disk_free_pct', value: disk.lowestFreePct })
  return {
    samples: [
      { check_key: 'dbhost_cpu', ok: cpu.ok, ms: 0, detail: cpu.detail },
      { check_key: 'dbhost_memory', ok: mem.ok, ms: 0, detail: mem.detail },
      ...(r.disks.length ? [{ check_key: 'dbhost_disk', ok: disk.ok, ms: 0, detail: disk.detail }] : []),
    ],
    metrics,
  }
}
