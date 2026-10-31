import { storeMailFields, type StoreFacts } from '@/lib/stores/details'
import { PROGRAM_SAMPLE_VALUES, programVars, type ProgramRowRecord } from './mail'
import { programNoteLabel, type ProgramRecord } from './types'

// The example values the mail editor's preview and "Send a test to me" fill the {{fields}} with. They come from the program's OWN first sheet row, that row's store card and the
// program's first category, so an AC program shows an AC line and a Genset program a genset line (never another program's example). With no row yet the neutral examples are used.
// Pure (no database, no server-only import): the editor screen (browser) and the test-mail action (server) both use it.

export type SampleOptions = { categoryName?: string | null; store?: StoreFacts | null }

export function programSampleValues(
  program: Pick<ProgramRecord, 'name' | 'row_type' | 'details_template'>,
  row: ProgramRowRecord | null,
  opts: SampleOptions = {},
): Record<string, string> {
  const base: Record<string, string> = { ...PROGRAM_SAMPLE_VALUES, program: programNoteLabel(program.name) }
  if (opts.categoryName) base.category = opts.categoryName
  if (opts.store) Object.assign(base, storeMailFields(opts.store), opts.store.address ? { store_address: opts.store.address } : {})
  if (!row) return base
  return { ...base, store_code: row.store_code, ...programVars(program, [row]) }
}
