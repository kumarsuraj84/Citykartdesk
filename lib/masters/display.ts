import type { SheetsSource } from './google'

// The second read of a sheet, "as it is shown". The normal read (UNFORMATTED_VALUE) gives the raw cell: a date is a serial number, '007' is 7, a 16-digit serial is rounded. The
// cells a person reads as text (machine number, serial, the extra details in a mail) are taken from this second read instead. It is optional: a source that cannot do it (the
// demo CSV files already hold text) or a read that fails gives undefined and the raw values are used, so a sheet is never refused because of it.

export async function fetchDisplaySafe(source: SheetsSource, spreadsheetId: string, tabName: string | null): Promise<unknown[][] | undefined> {
  if (!source.fetchDisplayValues) return undefined
  try { return await source.fetchDisplayValues(spreadsheetId, tabName) } catch (e) {
    console.error('[masters] could not read the sheet as shown, using the raw values', e instanceof Error ? e.message : e)
    return undefined
  }
}
