'use client'

import { useRef, useState, useCallback } from 'react'
import { Paperclip, X, Loader2, AlertCircle, FileIcon } from 'lucide-react'
import { validateAttachment } from '@/lib/attachments/validate'

// Mirrors components/requests/AttachmentUpload.tsx's dropzone, but that component
// requires an existing request_id (attachments have a NOT NULL request_id FK) — this
// one runs during request CREATION, before a request exists, so it only collects and
// client-validates File objects locally. The actual upload happens after createRequest
// returns a real request id (see DynamicForm's handleSubmit).

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.mp4,.webm,.mp3,.wav'

interface PendingFileFieldProps {
  id?: string
  value: File[]
  onChange: (files: File[]) => void
  multiple?: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PendingFileField({ id, value, onChange, multiple = true }: PendingFileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addFiles = useCallback(
    async (incoming: File[]) => {
      setError(null)
      setValidating(true)
      try {
        for (const file of incoming) {
          const result = await validateAttachment(file)
          if (!result.valid) {
            setError(`"${file.name}": ${result.error ?? 'Invalid file.'}`)
            return
          }
        }
        onChange(multiple ? [...value, ...incoming] : incoming.slice(0, 1))
      } finally {
        setValidating(false)
      }
    },
    [value, onChange, multiple]
  )

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function onDragEnter(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }
  function onDragLeave(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); e.stopPropagation() }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) addFiles(files)
  }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) addFiles(files)
    e.target.value = ''
  }

  return (
    <div className="space-y-2">
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => !validating && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors ${
          isDragging
            ? 'border-primary bg-primary/5'
            : validating
            ? 'cursor-not-allowed border-border bg-muted/30 opacity-60'
            : 'border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/40'
        }`}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPT}
          multiple={multiple}
          className="hidden"
          onChange={onInputChange}
          disabled={validating}
        />
        {validating ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Checking file…</span>
          </div>
        ) : (
          <>
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-foreground">
                Drop a file here or <span className="text-primary">browse</span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                PNG, JPG, PDF, DOCX, XLSX, CSV, ZIP, MP4 · Max 25 MB
              </p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 rounded-sm hover:text-red-900">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((file, i) => (
            <li
              key={`${file.name}-${file.lastModified}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs"
            >
              <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-foreground">{file.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="shrink-0 rounded-sm text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
