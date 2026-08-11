export function toCSV(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[]
): string {
  function quoteCell(value: unknown): string {
    let str = value == null ? '' : String(value)
    // Neutralize formula injection — Excel/Sheets treat a leading =, +, -, @,
    // tab, or CR as the start of a formula for any cell from an untrusted
    // source (e.g. a user-supplied request title).
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str
    }
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

export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
