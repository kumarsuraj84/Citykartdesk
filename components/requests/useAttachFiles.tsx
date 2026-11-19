'use client'

import { useCallback, useRef, useState } from 'react'
import { FileIcon, Paperclip, X } from 'lucide-react'
import { validateAttachment, formatFileSize } from '@/lib/attachments/validate'
import { filesToAttachFromTransfer } from '@/lib/attachments/paste'

/** The file types the Attach button offers (the same list as the conversation box). */
export const ATTACH_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.xlsb,.ppt,.pptx,.txt,.csv,.zip,.mp4,.webm,.mp3,.wav'

/**
 * Optional files for a small message box (for example the message asked when a technician changes a ticket's status): pick files with the Attach button,
 * press Ctrl+V to paste a copied file or a screenshot, or drop files on the box. Every file is checked exactly like in the conversation box (type, size, content);
 * a bad file is reported and the good ones are kept.
 */
export function useAttachFiles() {
  const [files, setFiles] = useState<File[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  const addFiles = useCallback(async (incoming: File[]) => {
    setProblem(null)
    const valid: File[] = []
    const problems: string[] = []
    for (const file of incoming) {
      const r = await validateAttachment(file)
      if (r.valid) valid.push(file)
      else problems.push(r.code === 'too_large' ? `"${file.name}" is larger than 25 MB.` : `"${file.name}": ${r.error ?? 'Invalid file.'}`)
    }
    if (problems.length) setProblem(problems.join(' · '))
    if (valid.length) setFiles((cur) => [...cur, ...valid])
  }, [])

  /** Ctrl+V of a copied file or a screenshot attaches it; plain text still pastes as text. */
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const pasted = filesToAttachFromTransfer(e.clipboardData)
    if (pasted.length === 0) return
    e.preventDefault()
    void addFiles(pasted)
  }, [addFiles])

  const onDrop = useCallback((e: React.DragEvent) => {
    const dropped = filesToAttachFromTransfer(e.dataTransfer, new Date(), { textWins: false })
    if (dropped.length === 0) return
    e.preventDefault()
    void addFiles(dropped)
  }, [addFiles])

  const removeAt = useCallback((i: number) => setFiles((cur) => cur.filter((_, k) => k !== i)), [])
  const clear = useCallback(() => { setFiles([]); setProblem(null) }, [])

  return { files, problem, addFiles, onPaste, onDrop, removeAt, clear }
}

/** The "Attach a file (optional)" button and the list of the chosen files. */
export function AttachFilesField({ files, problem, addFiles, removeAt, disabled }: {
  files: File[]
  problem: string | null
  addFiles: (f: File[]) => Promise<void>
  removeAt: (i: number) => void
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50">
          <Paperclip className="h-3 w-3" aria-hidden /> Attach a file
        </button>
        <span className="text-[10px] text-muted-foreground">optional · or press Ctrl+V to paste an image</span>
        <input ref={input} type="file" multiple accept={ATTACH_ACCEPT} className="hidden" aria-label="Attach files (optional)"
          onChange={(e) => { const picked = Array.from(e.target.files ?? []); if (picked.length) void addFiles(picked); e.target.value = '' }} />
      </div>
      {problem && <p role="alert" className="text-[11px] text-destructive">{problem}</p>}
      {files.length > 0 && (
        <ul className="space-y-1" aria-label="Files to attach">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-[11px]">
              <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatFileSize(f.size)}</span>
              <button type="button" onClick={() => removeAt(i)} disabled={disabled} aria-label={`Remove ${f.name}`} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
