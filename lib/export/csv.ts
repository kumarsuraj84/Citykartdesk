/** A plain number such as -5 or -12.5: it can never be a formula, so it must not get the guard (the guard turned every negative number into the text '-5). */
const PLAIN_NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/

/**
 * The cell's text with the formula-injection guard applied: Excel / Sheets treat a leading =, +, -, @, tab or CR as the start of a formula for any cell from an untrusted source
 * (e.g. a user-supplied request title). A real number (-5) is not text from anybody and stays a number. Every CSV writer in the app uses this one rule.
 */
export function neutraliseFormula(value: unknown): string {
  const str = value == null ? '' : String(value)
  if (typeof value === 'number' && Number.isFinite(value)) return str
  return /^[=+\-@\t\r]/.test(str) && !PLAIN_NEGATIVE_NUMBER.test(str) ? "'" + str : str
}

export function toCSV(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[]
): string {
  function quoteCell(value: unknown): string {
    const str = neutraliseFormula(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"'
    }
    return str
  }

  const header = columns.map((c) => quoteCell(c.label)).join(',')
  const dataRows = rows.map((row) =>
    columns.map((c) => quoteCell(row[c.key])).join(',')
  )

  return [header, ...dataRows].join('\r\n')
}

/** How many records (data rows plus the header) a CSV text holds. A quoted cell may contain line breaks, so lines are not records. */
export function countCsvRecords(csv: string): number {
  if (!csv) return 0
  let records = 1
  let inQuotes = false
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (c === '"') inQuotes = !inQuotes // ("" inside a quoted cell flips twice and ends up inside again)
    else if (!inQuotes && c === '\n') records++
  }
  // a trailing line break does not start another record
  if (/\r?\n$/.test(csv) && !inQuotes) records--
  return records
}

export function downloadCSV(filename: string, csv: string): void {
  // a byte-order mark first, so Excel reads the file as UTF-8 (names and addresses with accents / Hindi letters otherwise show as garbage)
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
