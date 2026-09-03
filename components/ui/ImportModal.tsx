'use client'

import { useRef, useState, useTransition } from 'react'
import { toCSV, downloadCSV } from '@/lib/export/csv'
import { parseCSV, rowsToObjects } from '@/lib/import/csv'

interface ImportModalProps {
  title: string
  sampleFilename: string
  sampleColumns: { key: string; label: string }[]
  sampleRows: Record<string, string>[]
  onImport: (rows: Record<string, string>[]) => Promise<{ error?: string; data?: { imported: number; errors: string[] } }>
  onClose: () => void
  onDone: () => void
}

export function ImportModal({ title, sampleFilename, sampleColumns, sampleRows, onImport, onClose, onDone }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [parsedRows, setParsedRows] = useState<Record<string, string>[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null)

  function handleDownloadSample() {
    downloadCSV(sampleFilename, toCSV(sampleRows, sampleColumns))
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setResult(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer
      // Excel's plain "CSV (Comma delimited)" export (as opposed to "CSV
      // UTF-8") writes non-ASCII characters in the system codepage — usually
      // Windows-1252 — not UTF-8. Decoding that as UTF-8 turns every such
      // character into U+FFFD ("�"), corrupting names right at the start of
      // import. Detect that and re-decode as Windows-1252, which recovers
      // the original text correctly.
      let text = new TextDecoder('utf-8').decode(buffer)
      if (text.includes('�')) {
        text = new TextDecoder('windows-1252').decode(buffer)
      }
      const rows = rowsToObjects(parseCSV(text))
      if (rows.length === 0) { setError('No data rows found in this file.'); setParsedRows(null); return }
      setParsedRows(rows)
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsArrayBuffer(file)
  }

  function handleImport() {
    if (!parsedRows) return
    setError(null)
    startTransition(async () => {
      const res = await onImport(parsedRows)
      if (res.error) { setError(res.error); return }
      setResult(res.data ?? { imported: 0, errors: [] })
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Import {title}</h2>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
            <span aria-hidden>×</span>
          </button>
        </div>

        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Don&apos;t have a file yet? Download a sample CSV with the expected columns, fill it in, then upload it below.
          </p>
          <button
            type="button"
            onClick={handleDownloadSample}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40"
          >
            Download sample CSV
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">CSV file</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="block w-full text-xs text-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground hover:file:bg-muted/40"
          />
          {fileName && parsedRows && (
            <p className="text-xs text-muted-foreground">
              {fileName}: {parsedRows.length} row{parsedRows.length === 1 ? '' : 's'} ready to import.
            </p>
          )}
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

        {result && (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 space-y-1">
            <p className="text-xs font-semibold text-emerald-700">Imported {result.imported} row{result.imported === 1 ? '' : 's'}.</p>
            {result.errors.length > 0 && (
              <ul className="text-xs text-amber-700 list-disc list-inside space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-soft">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={pending || !parsedRows}
              className="btn-gradient disabled:opacity-40"
            >
              {pending ? 'Importing…' : `Import${parsedRows ? ` ${parsedRows.length} row${parsedRows.length === 1 ? '' : 's'}` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
