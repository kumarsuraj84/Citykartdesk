// A small append-only spool on local disk for System Log rows that could not be sent to the database (it is down, or the app is crashing).
// One JSON row per line. Capped so a long outage cannot fill the disk. Node only.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SystemLogRow } from './row'
import type { Spool } from './writer'

const MAX_BYTES = 5 * 1024 * 1024

// The default folder is put together at run time on purpose: written as a plain path.join(os.tmpdir(), '...') Next.js's file tracer works the
// path out while building and then tries to copy that folder (which exists only on the build PC) into the release, which fails the build.
function defaultSpoolDir(): string {
  return [os.tmpdir(), ['ckdesk', 'system', 'log'].join('-')].join(path.sep)
}

export function spoolPath(dir = process.env.SYSTEM_LOG_SPOOL_DIR || defaultSpoolDir()): string {
  return [dir, 'spool.jsonl'].join(path.sep)
}

export function fileSpool(file = spoolPath()): Spool {
  const ensure = () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }) } catch { /* ignore */ } }
  return {
    append(rows) {
      if (rows.length === 0) return
      ensure()
      let size = 0
      try { size = fs.statSync(file).size } catch { /* no file yet */ }
      if (size >= MAX_BYTES) throw new Error('spool full')
      fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    },
    drain() {
      const taking = `${file}.${process.pid}.${Date.now()}.taking`
      try { fs.renameSync(file, taking) } catch { return [] }          // nothing there, or another process took it
      try {
        const rows = fs.readFileSync(taking, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as SystemLogRow] } catch { return [] } })
        return rows
      } finally {
        try { fs.unlinkSync(taking) } catch { /* ignore */ }
      }
    },
    size() {
      try { return fs.statSync(file).size } catch { return 0 }
    },
  }
}
