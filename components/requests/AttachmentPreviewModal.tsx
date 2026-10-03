'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'

export interface PreviewableAttachment {
  file_name: string
  file_size: number
  mime_type: string
  signedUrl: string
}

type Kind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'sheet' | 'none'

// Types a browser can show on its own, plus .xlsx workbooks (read on the server and shown as a
// table). Word/PowerPoint, legacy .xls and zips have no viewer, so they get a clear "download to
// open" message instead of a blank frame.
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024
const MAX_SHEET_PREVIEW_BYTES = 5 * 1024 * 1024
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type SheetData = { name: string; rows: string[][]; totalRows: number; totalCols: number; truncated: boolean }
type SheetsState = { sheets: SheetData[]; sheetsTruncated: boolean } | { error: 'too_large' | 'unreadable' } | null

export function previewKind(mimeType: string, fileSize: number): Kind {
  if (mimeType === XLSX_MIME) return fileSize <= MAX_SHEET_PREVIEW_BYTES ? 'sheet' : 'none'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if ((mimeType === 'text/plain' || mimeType === 'text/csv') && fileSize <= MAX_TEXT_PREVIEW_BYTES) return 'text'
  return 'none'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function columnLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

function SheetView({ state, active, onActive }: { state: SheetsState; active: number; onActive: (i: number) => void }) {
  if (state === null) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  }
  if ('error' in state) {
    return (
      <div className="px-6 text-center">
        <p className="text-sm font-medium text-foreground">
          {state.error === 'too_large' ? 'This spreadsheet is too large to preview' : "Couldn't preview this spreadsheet"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Use the Download button to open it on your computer.</p>
      </div>
    )
  }
  const sheet = state.sheets[Math.min(active, state.sheets.length - 1)]
  if (!sheet) {
    return <p className="text-sm text-muted-foreground">This workbook has no visible sheets.</p>
  }
  return (
    <div className="flex h-full w-full flex-col bg-card">
      <div className="min-h-0 flex-1 overflow-auto">
        {sheet.rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">This sheet is empty.</p>
        ) : (
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 w-10 border border-border bg-muted px-2 py-1" />
                {sheet.rows[0].map((_, c) => (
                  <th key={c} className="sticky top-0 z-10 border border-border bg-muted px-2 py-1 font-semibold text-muted-foreground">
                    {columnLetter(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <th className="sticky left-0 z-10 border border-border bg-muted px-2 py-1 text-right font-medium text-muted-foreground">{r + 1}</th>
                  {row.map((cell, c) => (
                    <td key={c} className="max-w-[320px] truncate whitespace-nowrap border border-border px-2 py-1 text-foreground" title={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {state.sheets.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              onClick={() => onActive(i)}
              className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium ${i === active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
        {(sheet.truncated || state.sheetsTruncated) && (
          <p className="shrink-0 text-[11px] text-muted-foreground">
            Showing the first {sheet.rows.length} of {sheet.totalRows} rows
            {sheet.rows[0] && sheet.rows[0].length < sheet.totalCols ? ` and ${sheet.rows[0].length} of ${sheet.totalCols} columns` : ''} — download for everything
          </p>
        )}
      </div>
    </div>
  )
}

export function AttachmentPreviewModal({ attachment, onClose }: { attachment: PreviewableAttachment; onClose: () => void }) {
  const kind = previewKind(attachment.mime_type, attachment.file_size)
  const [text, setText] = useState<string | null>(null)
  const [textError, setTextError] = useState(false)
  const [sheets, setSheets] = useState<SheetsState>(null)
  const [activeSheet, setActiveSheet] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  useEffect(() => {
    if (kind !== 'text') return
    let cancelled = false
    fetch(attachment.signedUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('failed'))))
      .then((t) => { if (!cancelled) setText(t) })
      .catch(() => { if (!cancelled) setTextError(true) })
    return () => { cancelled = true }
  }, [kind, attachment.signedUrl])

  useEffect(() => {
    if (kind !== 'sheet') return
    let cancelled = false
    fetch(`${attachment.signedUrl}/preview`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) return { error: body.error === 'too_large' ? 'too_large' : 'unreadable' } as const
        return body
      })
      .then((data) => { if (!cancelled) setSheets(data) })
      .catch(() => { if (!cancelled) setSheets({ error: 'unreadable' }) })
    return () => { cancelled = true }
  }, [kind, attachment.signedUrl])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${attachment.file_name}`}
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{attachment.file_name}</p>
            <p className="text-[11px] text-muted-foreground">{formatBytes(attachment.file_size)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={attachment.signedUrl}
              download={attachment.file_name}
              className="btn-gradient flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/30">
          {kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachment.signedUrl} alt={attachment.file_name} className="max-h-full max-w-full object-contain" />
          )}
          {kind === 'pdf' && (
            <iframe src={attachment.signedUrl} title={attachment.file_name} className="h-full w-full border-0 bg-white" />
          )}
          {kind === 'video' && (
            <video src={attachment.signedUrl} controls className="max-h-full max-w-full" />
          )}
          {kind === 'audio' && <audio src={attachment.signedUrl} controls />}
          {kind === 'text' && (
            <div className="h-full w-full overflow-auto bg-card p-4">
              {text === null && !textError && (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
              {textError && <p className="text-sm text-muted-foreground">Couldn&apos;t load the preview. Use Download instead.</p>}
              {text !== null && <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">{text}</pre>}
            </div>
          )}
          {kind === 'sheet' && (
            <SheetView state={sheets} active={activeSheet} onActive={setActiveSheet} />
          )}
          {kind === 'none' && (
            <div className="px-6 text-center">
              <p className="text-sm font-medium text-foreground">No preview for this file type</p>
              <p className="mt-1 text-xs text-muted-foreground">Use the Download button to open it on your computer.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
