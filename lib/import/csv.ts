// Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes ("")
// commas/newlines inside quotes, and CRLF/LF line endings.
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += char; i++; continue
    }
    if (char === '"') { inQuotes = true; i++; continue }
    if (char === ',') { row.push(field); field = ''; i++; continue }
    if (char === '\r') { i++; continue }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += char; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }

  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// First row is treated as the header; keys are lowercased + trimmed.
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim() })
    return obj
  })
}
