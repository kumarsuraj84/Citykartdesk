'use client'

import { useRef, useState, useTransition, useCallback } from 'react'
import { Paperclip, Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { uploadAttachment } from '@/lib/actions/attachments'
import { validateAttachment } from '@/lib/attachments/validate'

interface AttachmentUploadProps {
  requestId: string
}

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.mp4,.webm,.mp3,.wav'

type UploadStatus =
  | { type: 'idle' }
  | { type: 'uploading'; fileName: string }
  | { type: 'success'; fileName: string }
  | { type: 'error'; message: string }

export function AttachmentUpload({ requestId }: AttachmentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [status, setStatus] = useState<UploadStatus>({ type: 'idle' })
  const [isPending, startTransition] = useTransition()

  const handleFile = useCallback(
    (file: File) => {
      // Client-side validation: size, MIME type, and magic bytes
      setStatus({ type: 'uploading', fileName: file.name })

      startTransition(async () => {
        const validation = await validateAttachment(file)
        if (!validation.valid) {
          setStatus({ type: 'error', message: validation.error ?? 'Invalid file.' })
          return
        }

        const fd = new FormData()
        fd.append('file', file)

        const result = await uploadAttachment(requestId, fd)
        if (result.error) {
          setStatus({ type: 'error', message: result.error })
        } else {
          setStatus({ type: 'success', fileName: file.name })
          // Reset to idle after brief success acknowledgement
          setTimeout(() => setStatus({ type: 'idle' }), 2500)
        }
      })
    },
    [requestId]
  )

  // ── Drag-and-drop handlers ────────────────────────────────────────────────

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      handleFile(file)
      // Reset the input so the same file can be re-selected after an error
      e.target.value = ''
    }
  }

  const isUploading = isPending || status.type === 'uploading'

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => !isUploading && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors ${
          isDragging
            ? 'border-primary bg-primary/5'
            : isUploading
            ? 'cursor-not-allowed border-border bg-muted/30 opacity-60'
            : 'border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/40'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onInputChange}
          disabled={isUploading}
        />

        {isUploading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              Uploading
              {status.type === 'uploading' ? ` ${status.fileName}…` : '…'}
            </span>
          </div>
        ) : (
          <>
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-foreground">
                Drop a file here or{' '}
                <span className="text-primary">browse</span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                PNG, JPG, PDF, DOCX, XLSX, CSV, ZIP, MP4 · Max 25 MB
              </p>
            </div>
          </>
        )}
      </div>

      {/* Status feedback */}
      {status.type === 'success' && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">{status.fileName}</span> uploaded successfully.
          </span>
        </div>
      )}
      {status.type === 'error' && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{status.message}</span>
          <button
            type="button"
            onClick={() => setStatus({ type: 'idle' })}
            className="shrink-0 rounded-sm hover:text-red-900"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
