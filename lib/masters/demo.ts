import 'server-only'
import { readFile } from 'fs/promises'
import path from 'path'
import { parseCsv } from './csv'
import type { SheetsSource } from './google'

// LOCAL DEMO ONLY. With MASTERS_DEMO_DIR set, the three sheets are read from CSV files in that folder instead of from Google, so the whole feature can be tried on a
// development machine without a Google account. It is ignored in a production build (NODE_ENV=production), so it can never replace the real sheets on the live system.
// The "sheet id" of a source is the file name without .csv (for example demo-ac -> <dir>/demo-ac.csv).

export function demoSheetsDir(): string | null {
  if (process.env.NODE_ENV === 'production') return null
  const dir = (process.env.MASTERS_DEMO_DIR ?? '').trim()
  return dir ? path.resolve(dir) : null
}

export function csvDirSource(dir: string): SheetsSource {
  return {
    async fetchValues(spreadsheetId) {
      if (!/^[a-z0-9-]{1,60}$/.test(spreadsheetId)) throw new Error('This is not a demo sheet name.')
      const text = await readFile(path.join(dir, `${spreadsheetId}.csv`), 'utf8').catch(() => { throw new Error(`The demo file ${spreadsheetId}.csv was not found.`) })
      return parseCsv(text)
    },
  }
}
