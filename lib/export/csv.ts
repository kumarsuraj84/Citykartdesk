export function toCSV(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[]
): string {
  function quoteCell(value: unknown): string {
    const str = value == null ? '' : String(value)
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
